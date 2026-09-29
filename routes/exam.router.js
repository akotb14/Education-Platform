const router = require("express").Router();
const contro = require("../controllers/quiz.contro");
const model = require("../models/quiz");
const isAdmin = require("../util/aurth");
const degreeQ = require("../models/degreeQuiz");
const student = require("../models/user");
const jwt = require("jsonwebtoken");
const { uploadImage: upload } = require("../middlewares/upload");
const tf = require("../util/tableFilters");
const qt = require("../util/questionTypes");
const gr = require("../util/grading");
const config = require("../config");
const excel = require("../util/excel");
/* Configured in util/csrf.js rather than inline: the csrf({cookie:true}) default
   left the secret cookie script-readable and non-Secure. */
const csrfProtect = require("../util/csrf");

/* Renders admin/quiz.ejs, admin/homework.ejs or admin/exam.ejs — all three are
   thin wrappers around views/admin/_assessment-form.ejs now. csrfProtect is
   here because those pages carry POST delete forms and a POST add form. */
router.get("/admin/:type", csrfProtect, isAdmin, contro.getQuiz);

/* upload must run before csrfProtect: the token arrives in the multipart body,
   and csurf cannot see it until multer has parsed the request.

   .any() rather than .single("image"): the add form now posts one optional
   image per question under a per-question field name (q_0_image, q_1_image …),
   and .single() would reject the second file with LIMIT_UNEXPECTED_FILE. The
   field names are generated, so there is no fixed list to hand .fields().
   makeUploader caps the file count, so .any() is not unbounded. */
router.post(
  "/admin/:type",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.addQuiz
);

//router.all('/quizApp' ,contro.getQuizApp);
router.get("/openExam", contro.getOpenQuiz);
router.get("/startQuiz/:nameQuiz", async (req, res) => {
  try {
    const data = await model.findOne({ _id: req.params.nameQuiz, type: "exam" });

    /* Outside its window, an exam is treated exactly like a missing one: the
       view's "غير متاح" state. The old route answered a bare 404 status page
       here, with no explanation and no way back to /openExam. */
    let open = false;
    if (data) {
      const sda = new Date(data.startTime).getTime();
      const eda = new Date(data.endTime).getTime();
      open = sda <= Date.now() && eda > Date.now();
    }

    let alreadyTaken = false;
    if (open && req.cookies.student) {
      const student = jwt.verify(req.cookies.student, process.env.SecretPassword);
      const deg = await degreeQ.findOne({
        quiz: data._id,
        student: student.studentCard,
        isCheck: "1",
        type: "exam",
        totalDegree: { $ne: null },
      });
      alreadyTaken = !!deg;
    }

    res.status(open ? 200 : 404).render("quiz-intro.ejs", {
      kind: "exam",
      paper: open ? data : null,
      alreadyTaken: alreadyTaken,
      backHref: "/openExam",
    });
  } catch (err) {
    console.log(err);
    res.status(404).render("quiz-intro.ejs", {
      kind: "exam",
      paper: null,
      alreadyTaken: false,
      backHref: "/openExam",
    });
  }
});
router.post("/startQuiz/:nameQuiz", contro.startQuiz);
router.get("/examApp/:nameQuiz", contro.g);

router.post("/examApp/:nameQuiz", contro.postQuizApp);
//router.get('/qw' ,contro.getqw)
/* :type reaches a `find({type})` and, before this, was echoed into the page as
   its own heading. The enum lives in models/degreeQuiz.js; anything else is a
   404 rather than an empty table titled with whatever was in the URL. */
const DEGREE_TYPES = ["quiz", "homework", "exam"];

/* Columns of the degrees table, in the order showStudDegree.ejs renders them.
   Kept beside the route so a column added to one is added to the other. */
const DEGREE_COLUMNS = [
  { header: "الطالب", key: "name", width: 30 },
  { header: "رقم الكارت", key: "card", width: 20 },
  { header: "المجموعة", key: "group", width: 16 },
  { header: "صف الطالب", key: "sGrade", width: 16 },
  { header: "مادة الطالب", key: "sSubject", width: 16 },
  { header: "الورقة", key: "paper", width: 30 },
  { header: "الدرجة", key: "score", width: 14 },
  { header: "من", key: "outOf", width: 10 },
  /* The manual marks and the combined total, beside the automatic score
     rather than folded into it. `score`/`outOf` keep their exact previous
     meaning — the automatic marks only — so an export opened next to an
     older one still lines up column for column. */
  { header: "التصحيح اليدوي", key: "manual", width: 16 },
  { header: "الدرجة النهائية", key: "final", width: 16 },
  { header: "من", key: "finalOutOf", width: 10 },
  { header: "حالة التصحيح", key: "status", width: 18 },
  { header: "النسبة", key: "pct", width: 12, numFmt: "0%" },
];

const DEGREE_SHEETS = { quiz: "الكويزات", homework: "الواجبات", exam: "الامتحانات" };
const DEGREE_FILES = { quiz: "quiz-degrees", homework: "homework-degrees", exam: "exam-degrees" };

/* =========================================================================
   MANUAL GRADING — one queue and one review page across all three kinds.

   WHY THESE LIVE IN THE EXAM ROUTER, which looks arbitrary until you try the
   alternatives. Two constraints pin it here:

     · app.js is out of scope for this change, so a new router file could not
       be mounted at all.
     · routes/units.router.js registers `GET /:edu/:grd` — a TWO-SEGMENT
       CATCH-ALL at the app root. Anything mounted after it never sees a
       two-segment GET, so `/grading/:id` added to dashboard.js (mounted
       after units) would be swallowed and answer with a units page. This
       router is mounted before units, so it matches first.

   This file already carries the cross-cutting degrees pages
   (/showStudentsDegree/:type covers quiz and homework too), so it is not
   exam-only in practice.
   ====================================================================== */

/* The queue's own facets, beside the four shared student filters. English
   values, Arabic labels — the split every other enum in the app uses. */
const GRADING_TYPES = [
  { value: "quiz", label: "كويز" },
  { value: "homework", label: "واجب" },
  { value: "exam", label: "امتحان" },
];

const KIND_LABEL = { quiz: "كويز", homework: "واجب", exam: "امتحان" };

const GRADING_STATUSES = [
  { value: gr.STATUS.PENDING, label: gr.STATUS_LABELS[gr.STATUS.PENDING] },
  { value: gr.STATUS.PARTIAL, label: gr.STATUS_LABELS[gr.STATUS.PARTIAL] },
  { value: gr.STATUS.GRADED, label: gr.STATUS_LABELS[gr.STATUS.GRADED] },
  { value: gr.STATUS.NONE, label: gr.STATUS_LABELS[gr.STATUS.NONE] },
];

const GRADING_COLUMNS = [
  { header: "الطالب", key: "name", width: 30 },
  { header: "رقم الكارت", key: "card", width: 20 },
  { header: "المجموعة", key: "group", width: 16 },
  { header: "الورقة", key: "paper", width: 30 },
  { header: "النوع", key: "kind", width: 12 },
  { header: "تاريخ التسليم", key: "when", width: 22 },
  { header: "عدد الأسئلة", key: "questions", width: 14 },
  { header: "التصحيح التلقائي", key: "auto", width: 18 },
  { header: "من", key: "autoOutOf", width: 10 },
  { header: "بانتظار التصحيح", key: "pending", width: 18 },
  { header: "التصحيح اليدوي", key: "manual", width: 16 },
  { header: "من", key: "manualOutOf", width: 10 },
  { header: "الدرجة النهائية", key: "final", width: 16 },
  { header: "من", key: "finalOutOf", width: 10 },
  { header: "الحالة", key: "status", width: 18 },
];

/* Whitelisted the same way tableFilters.pick does it: an unrecognised value is
   read as "no filter" rather than reaching a query or a redirect. */
const pickFrom = (raw, list) => {
  if (typeof raw !== "string" || raw === "" || raw === "All") return "";
  return list.some((item) => item.value === raw) ? raw : "";
};

/* The queue's extra querystring, appended to whatever tableFilters built, so
   the export link, the toolbar and the post-save redirect all carry the same
   two facets. */
const gradingQuery = (f, kind, status, extra) => {
  const parts = [];
  const base = tf.toQuery(f, extra);
  if (kind) parts.push("type=" + encodeURIComponent(kind));
  if (status) parts.push("status=" + encodeURIComponent(status));
  if (!parts.length) return base;
  return base ? base + "&" + parts.join("&") : "?" + parts.join("&");
};

/* A submission the admin can actually mark. `totalDegree: {$ne: null}` is the
   platform's "handed in" test — an attempt that was opened and abandoned has
   no answers to read and must not appear in a marking queue. */
const SUBMITTED = { totalDegree: { $ne: null } };

/* csrfProtect: the page's toolbar is a GET form, but the rows link into the
   review page whose POST needs a token issued from the same secret. */
router.get("/grading", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const f = tf.parse(req.query);
    const kind = pickFrom(req.query.type, GRADING_TYPES);
    const status = pickFrom(req.query.status, GRADING_STATUSES);
    const wantsExport = req.query.export === "xlsx";

    /* Same shape as /showStudentsDegree: resolve the student ids FIRST so the
       student-side filters become a plain $in on this collection. populate's
       `match` does not drop a non-matching row, it nulls the field — so
       filtering there would return every attempt and leave the count wrong.
       See the long comment on that route. */
    const filter = Object.assign({}, SUBMITTED);
    if (kind) filter.type = kind;

    let orderedIds = null;
    if (f.active || f.sort) {
      const order = tf.mongoSort(f, { _id: 1 });
      let idQuery = student.find(tf.studentFilter(f, {})).select("_id").sort(order.sort).lean();
      if (order.collation) idQuery = idQuery.collation(order.collation);
      const ids = await idQuery;

      orderedIds = ids.map((s) => String(s._id));
      if (f.active) filter.student = { $in: ids.map((s) => s._id) };
    }

    let attempts = await degreeQ
      .find(filter)
      /* Newest first: a marking queue is worked from the most recent hand-in
         backwards. _id descending is insertion order, which is the attempt
         START — close enough for ordering, and the only key every document
         has (submittedAt is absent on everything submitted before it
         existed, so sorting on it would scatter the old rows). */
      .sort({ _id: -1 })
      .populate({ path: "quiz" })
      .populate({ path: "student" })
      .lean();

    if (f.sort && orderedIds) {
      const rank = new Map();
      orderedIds.forEach((id, i) => rank.set(id, i));
      const last = orderedIds.length;
      const keyOf = (row) =>
        row && row.student ? (rank.has(String(row.student._id)) ? rank.get(String(row.student._id)) : last) : last;
      attempts.sort((a, b) => keyOf(a) - keyOf(b));
    }

    /* A deleted student is one the filter excluded; a null quiz is an attempt
       whose paper has been deleted, which has no questions to mark and no
       name to show. Dropped here rather than in the view, so the export and
       the table are provably the same rows. */
    attempts = attempts.filter((it) => it && it.student && it.quiz);

    /* THE STATUS FILTER RUNS IN JS, and has to: status is derived from the
       paper's questions joined against the attempt's marks, not stored. The
       needsReview flag in the documents is only a hint written at submit
       time — filtering on it in Mongo would show attempts that have since
       been marked and hide papers that gained an essay afterwards. */
    if (status) {
      attempts = attempts.filter((it) => gr.statusOf(it.quiz, it) === status);
    }

    if (wantsExport) {
      const rows = [];
      for (const it of attempts) {
        const t = gr.totalsOf(it.quiz, it);
        const when = it.submittedAt || null;
        rows.push({
          name: it.student.fullName || "",
          card: it.student.cardNumber || "",
          group: tf.GROUP_LABEL[it.student.group] || it.student.group || "",
          paper: it.quiz.nameQuiz || "",
          kind: KIND_LABEL[it.type] || it.type || "",
          /* Only a real hand-in time is exported. The queue falls back to the
             attempt-start time on older rows and says so on screen; a
             spreadsheet column has nowhere to carry that caveat, so it stays
             empty rather than shipping a time that means something else. */
          when: when ? when : "",
          questions: Array.isArray(it.quiz.quiz) ? it.quiz.quiz.length : 0,
          auto: t.auto == null ? "" : t.auto,
          autoOutOf: t.autoOutOf,
          pending: t.pending,
          manual: t.manualOutOf > 0 ? t.manual : "",
          manualOutOf: t.manualOutOf,
          final: t.final == null ? "" : t.final,
          finalOutOf: t.finalOutOf,
          status: gr.STATUS_LABELS[t.status] || "",
        });
      }

      return await excel.sendSheet(res, {
        filename: "grading" + (f.touched || kind || status ? "-filtered" : ""),
        sheetName: "التصحيح",
        columns: GRADING_COLUMNS,
        rows: rows,
      });
    }

    res.render(
      "admin/grading.ejs",
      Object.assign({}, tf.viewLocals(f), {
        data: attempts,
        kind: kind,
        status: status,
        KINDS: GRADING_TYPES,
        STATUSES: GRADING_STATUSES,
        KIND_LABEL: KIND_LABEL,
        /* No csrfToken: every control on the queue is a GET — the toolbar, the
           export link, the row links. The marking POST is on the detail page,
           which gets its own. csrfProtect still runs so the secret cookie is
           issued here for the form the admin is on their way to. */
        ...qt.viewLocals(),
        ...gr.viewLocals(),
      })
    );
  } catch (err) {
    next(err);
  }
});

/* Mongo throws a CastError on a malformed id rather than returning null, and
   that would surface as a 500 on a URL an admin merely mistyped. */
const isObjectId = (v) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

router.get("/grading/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.sendStatus(404);

    const attempt = await degreeQ
      .findOne(Object.assign({ _id: req.params.id }, SUBMITTED))
      .populate({ path: "quiz" })
      .populate({ path: "student" })
      .lean();

    /* Deleted between the queue rendering and the row being clicked, or an id
       for an attempt that was never handed in. Back to the queue with the
       filters intact rather than a dead end. */
    if (!attempt || !attempt.quiz || !attempt.student) {
      const f = tf.parse(req.query);
      return res.redirect(
        "/grading" + gradingQuery(f, pickFrom(req.query.type, GRADING_TYPES), pickFrom(req.query.status, GRADING_STATUSES), null)
      );
    }

    const okFlash = req.flash("gradeOk");
    const badFlash = req.flash("gradeBad");

    res.render(
      "admin/gradingDetail.ejs",
      Object.assign({}, tf.viewLocals(tf.parse(req.query)), {
        attempt: attempt,
        paper: attempt.quiz,
        pupil: attempt.student,
        kind: pickFrom(req.query.type, GRADING_TYPES),
        status: pickFrom(req.query.status, GRADING_STATUSES),
        KIND_LABEL: KIND_LABEL,
        flashOk: okFlash.length ? okFlash[0] : "",
        flashBad: badFlash.length ? badFlash[0] : "",
        csrfToken: req.csrfToken ? req.csrfToken() : "",
        ...qt.viewLocals(),
        ...gr.viewLocals(),
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post("/grading/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.sendStatus(404);

    /* The filters the admin was reading, rebuilt from the posted hidden
       fields. req.body is no more trustworthy than req.query, so it goes
       through the same whitelists — these values end up in a redirect. */
    const f = tf.parse(req.body);
    const kind = pickFrom(req.body.type, GRADING_TYPES);
    const status = pickFrom(req.body.status, GRADING_STATUSES);
    const back = "/grading/" + encodeURIComponent(req.params.id) + gradingQuery(f, kind, status, null);

    const attempt = await degreeQ
      .findOne(Object.assign({ _id: req.params.id }, SUBMITTED))
      .populate({ path: "quiz" })
      .lean();

    if (!attempt || !attempt.quiz) {
      return res.redirect("/grading" + gradingQuery(f, kind, status, null));
    }

    /* All the validation lives in util/grading, so the rules the review page
       renders (min, max, this question's own maximum) and the rules the
       server enforces come from one place. An out-of-range mark is REFUSED,
       not clamped: a clamped mark is a mark the admin never chose and would
       never be told about. */
    const applied = gr.applyMarks(attempt.quiz, attempt, req.body);
    if (applied.error) {
      req.flash("gradeBad", applied.error);
      return res.redirect(back);
    }

    /* The admin's own name, off the same cookie isAdmin already verified.
       The payload is built in controllers/signup.contr.js and names it
       `nameStudent` — not fullName, which is the field on the DOCUMENT.
       Wrapped because a token that verified in the middleware can still be
       missing the field, and an audit line is not worth failing a save
       over. */
    let by = "";
    try {
      const who = jwt.verify(req.cookies.student, config.jwtSecret);
      by = who && who.nameStudent ? String(who.nameStudent) : "";
    } catch (e) {
      by = "";
    }

    await degreeQ.findByIdAndUpdate(req.params.id, {
      writtenAnswers: applied.written,
      /* Recomputed from the per-question marks every time, never incremented,
         so re-marking a question cannot accumulate. totalDegree is NOT
         touched: it is the automatic score and the platform's "handed in"
         sentinel, and the final total is derived from the two. */
      manualDegree: applied.manualDegree,
      gradedAt: new Date(),
      gradedBy: by,
      /* Kept in step with what was actually marked, so the flag stays a
         useful hint even though every reader derives the real status. */
      needsReview: applied.marked < applied.essays,
    });

    req.flash(
      "gradeOk",
      applied.marked === applied.essays
        ? "تم حفظ التصحيح."
        : `تم حفظ التصحيح. باقي ${applied.essays - applied.marked} سؤال بدون درجة.`
    );
    res.redirect(back);
  } catch (err) {
    next(err);
  }
});

/* csrfProtect: the page carries one POST delete form per row and needs a token
   to put in them. */
router.get("/showStudentsDegree/:type", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const type = req.params.type;
    if (DEGREE_TYPES.indexOf(type) === -1) {
      return res.sendStatus(404);
    }

    const f = tf.parse(req.query);
    const wantsExport = req.query.export === "xlsx";

    /* WHY THIS IS NOT A populate({match}) ANY MORE

       All four controls filter the STUDENT, which lives in a different
       collection reached through populate. populate's `match` does not drop a
       non-matching row — it sets .student to null on it — so the old filtered
       query still returned every attempt of this type and the view had to skip
       the nulls. Two consequences: the row count was computed from a list that
       still contained the excluded rows, and there was no way to sort by name
       at all, because .sort({"student.fullName": 1}) sorts on a path the degree
       documents do not have and silently does nothing.

       Resolving the student ids FIRST turns it into a plain `student: {$in}`
       filter on the degrees collection. The query then returns exactly the
       matching attempts, and the ids come back already in name order, so the
       name sort is applied by reordering against that list below. */
    let degreeFilter = { type: type };
    let orderedIds = null;

    if (f.active || f.sort) {
      const studentFilter = tf.studentFilter(f, {});
      const order = tf.mongoSort(f, { _id: 1 });

      let idQuery = student.find(studentFilter).select("_id").sort(order.sort).lean();
      if (order.collation) idQuery = idQuery.collation(order.collation);
      const ids = await idQuery;

      orderedIds = ids.map((s) => String(s._id));
      /* Only narrow the degrees query when a real filter is set. With sort
         alone, every student matches and the $in would just be a longer way of
         saying "no filter" — but a costlier one, since it ships every id back
         into the query. */
      if (f.active) {
        degreeFilter.student = { $in: ids.map((s) => s._id) };
      }
    }

    let attempts = await degreeQ
      .find(degreeFilter)
      .populate({ path: "quiz" })
      .populate({ path: "student" })
      .lean();

    if (f.sort && orderedIds) {
      /* Sorted in JS against the id order Mongo already computed with Arabic
         collation, rather than re-comparing names here. A student with several
         attempts keeps them adjacent, and rank lookups are O(1).

         Anything not in the map (a deleted student, so .student is null) sorts
         to the end instead of jumping to the front, which is what a -1 rank
         would do. */
      const rank = new Map();
      orderedIds.forEach((id, i) => rank.set(id, i));
      const last = orderedIds.length;
      const keyOf = (row) =>
        row && row.student ? (rank.has(String(row.student._id)) ? rank.get(String(row.student._id)) : last) : last;
      attempts.sort((a, b) => keyOf(a) - keyOf(b));
    }

    if (wantsExport) {
      const rows = [];
      for (const it of attempts) {
        /* Same two skips as the view: a null student is one the filter
           excluded, a null quiz is an attempt whose paper was deleted. The
           export must contain exactly the visible rows. */
        if (!it || !it.student || !it.quiz) continue;

        /* Out of the AUTO-MARKED questions only. A paper with no essay
           questions gives exactly quiz.length, so every existing export is
           unchanged. */
        const totalQ = qt.autoGradableCount(it.quiz);
        const submitted = it.totalDegree != null && it.totalDegree !== "";
        let score = submitted ? Number(it.totalDegree) : null;
        if (score != null && !isFinite(score)) score = null;
        const pct = score != null && totalQ > 0 ? Math.round((score / totalQ) * 100) : null;

        /* The manual side, recomputed from the stored marks rather than read
           off a running total. A paper with no essay questions gives
           manual 0 / status "none", so those rows are unchanged apart from
           carrying the same number twice. */
        const t = gr.totalsOf(it.quiz, it);

        rows.push({
          name: it.student.fullName || "",
          card: it.student.cardNumber || "",
          group: tf.GROUP_LABEL[it.student.group] || it.student.group || "",
          sGrade: tf.GRADE_LABEL[it.student.grade] || it.student.grade || "",
          sSubject: tf.SUBJECT_LABEL[it.student.educetionlevel] || it.student.educetionlevel || "",
          paper: it.quiz.nameQuiz || "",
          /* Numbers stay numbers so the column is sortable and averageable in
             Excel; an unsubmitted attempt says so in words rather than being a
             blank that reads as a zero. An attempt carrying an essay answer is
             a third case: the auto-score is real but incomplete, so the number
             is kept and annotated rather than replaced.

             The annotation is driven by the DERIVED status, not by the stored
             needsReview flag — that flag is written once at submit time and
             never cleared, so it would keep labelling a fully marked attempt
             as awaiting a teacher. */
          score:
            submitted && score != null
              ? t.status === gr.STATUS.PENDING || t.status === gr.STATUS.PARTIAL
                ? score + " (" + gr.STATUS_LABELS[t.status] + ")"
                : score
              : "لم يُسلّم",
          outOf: totalQ,
          /* Blank rather than 0 on a paper with nothing to mark by hand: a
             zero here would read as "the teacher awarded nothing". */
          manual: t.manualOutOf > 0 ? t.manual : "",
          final: t.final == null ? "" : t.final,
          finalOutOf: t.finalOutOf,
          status: gr.STATUS_LABELS[t.status] || "",
          /* Out of the AUTO-marked questions, exactly as before — the manual
             side has its own columns. A percentage that silently switched
             denominators depending on whether a paper had an essay on it
             would make two rows of this column incomparable. */
          pct: pct == null ? "" : pct / 100,
        });
      }

      return await excel.sendSheet(res, {
        filename: (DEGREE_FILES[type] || "degrees") + (f.touched ? "-filtered" : ""),
        sheetName: DEGREE_SHEETS[type] || "الدرجات",
        columns: DEGREE_COLUMNS,
        rows: rows,
      });
    }

    res.render(
      "admin/showStudDegree.ejs",
      Object.assign({}, tf.viewLocals(f), {
        data: attempts,
        type: type,
        /* Kept as its own local as well as inside `f`: the view read it before
           this change and the delete form posts it back to preserve the
           filter across a redirect. */
        group: f.group,
        csrfToken: req.csrfToken ? req.csrfToken() : "",
        /* autoGradableCount, for the per-row denominator. EJS cannot
           require(). */
        ...qt.viewLocals(),
        /* totalsOf/statusOf, for the status column and the final score. */
        ...gr.viewLocals(),
      })
    );
  } catch (err) {
    /* Was `console.log(err); res.sendStatus(404)` — a server-side failure
       reported to the admin as a bare "not found" with no body. */
    next(err);
  }
});

/* POST, and guarded.
   This was `router.get("/removestudentDegree/:type/:id")` with no isAdmin and
   no CSRF — a permanent delete behind a plain link, reachable by anyone who
   knew the URL, and fired by anything that follows links: a crawler, a browser
   prefetch, a link scanner in a messaging app, a mis-click. Even once guarded,
   a GET delete is still CSRF-able via <img src="…/removestudentDegree/quiz/ID">
   on any third-party page, using a logged-in admin's cookie. */
router.post("/removestudentDegree/:type/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const type = DEGREE_TYPES.indexOf(req.params.type) === -1 ? "quiz" : req.params.type;

    /* findByIdAndDelete takes an id, not a filter; it was being handed
       `{_id: …}`, which mongoose then coerced back out of the object. Passing
       the id directly is what the method is for. */
    await degreeQ.findByIdAndDelete(req.params.id);

    /* Back to the exact list the admin was reading, not the unfiltered one.
       The filters arrive as hidden fields in the delete form and go through
       the same whitelist as a query string — req.body is no more trustworthy
       than req.query, and this value goes straight into a redirect. */
    const f = tf.parse(req.body);
    res.redirect("/showStudentsDegree/" + encodeURIComponent(type) + tf.toQuery(f, null));
  } catch (err) {
    next(err);
  }
});


/* THE SETTINGS PAGE — the exam's own fields: name, description, subject, grade,
   the open/close window and the per-attempt duration. Nothing about its
   questions; those live at /questionsOfExam/:id below.

   No upload.any() on the POST any more: with the question builder gone the form
   has no file input, so it posts as ordinary urlencoded and app.js's body parser
   is enough — which also lets csrfProtect run first, in its usual place, rather
   than having to wait for multer to find the token in a multipart body. */
router.get("/editExam/:id", csrfProtect, isAdmin, contro.editPaperGet("exam"));

router.post("/editExam/:id", csrfProtect, isAdmin, contro.editPaperPost("exam"));
/* POST, not GET. A GET delete fires on link prefetch, on a crawler visit and on
   any mis-click, with no confirmation and no CSRF — see the same change on the
   student routes. The old handler also redirected to /editExam/:id AFTER
   deleting that very exam, so a successful delete landed on a page for a
   document that no longer existed; it goes back to the list now. */
router.post("/removeExam/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findOneAndDelete({ _id: req.params.id });
    /* Exam attempts referenced this paper. Left behind, they show up on the
       degrees pages as rows whose populate('quiz') yields null. */
    await degreeQ.deleteMany({ quiz: req.params.id, type: "exam" });
    res.redirect("/admin/exam");
  } catch (err) {
    next(err);
  }
});
/* ----------------------------------------------------------------------
   MANAGE QUESTIONS. The other half of the edit split: everything here works on
   the exam's question list and nothing here can touch its settings.

   :i is the paper and :id is the question — the order /removeQuestionOfExam has
   always used, kept so all four read alike.

   upload.any() BEFORE csrfProtect on the two routes that carry a question: the
   image field names are generated per question (q_0_image, q_1_image …) so
   .single() would reject the second file, and the CSRF token arrives inside the
   multipart body, where csurf cannot see it until multer has parsed the request.
   The move and remove routes carry no file and take csrfProtect first.
   ---------------------------------------------------------------------- */
router.get(
  "/questionsOfExam/:id",
  csrfProtect,
  isAdmin,
  contro.questionsGet("exam")
);

router.post(
  "/addQuestionsOfExam/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.addQuestionsPost("exam")
);

router.post(
  "/editQuestionOfExam/:i/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.editQuestionPost("exam")
);

router.post(
  "/moveQuestionOfExam/:i/:id",
  csrfProtect,
  isAdmin,
  contro.moveQuestionPost("exam")
);

router.post(
  "/removeQuestionOfExam/:i/:id",
  csrfProtect,
  isAdmin,
  contro.removeQuestion("exam")
);
module.exports = router;

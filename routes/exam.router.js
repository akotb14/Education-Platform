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
const csrfProtect = require("../util/csrf");

router.get("/admin/:type", csrfProtect, isAdmin, contro.getQuiz);

router.post(
  "/admin/:type",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.addQuiz
);

router.get("/openExam", contro.getOpenQuiz);
router.get("/startQuiz/:nameQuiz", async (req, res) => {
  try {
    const data = await model.findOne({ _id: req.params.nameQuiz, type: "exam" });

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
const DEGREE_TYPES = ["quiz", "homework", "exam"];

const DEGREE_COLUMNS = [
  { header: "الطالب", key: "name", width: 30 },
  { header: "رقم الكارت", key: "card", width: 20 },
  { header: "المجموعة", key: "group", width: 16 },
  { header: "صف الطالب", key: "sGrade", width: 16 },
  { header: "مادة الطالب", key: "sSubject", width: 16 },
  { header: "الورقة", key: "paper", width: 30 },
  { header: "الدرجة", key: "score", width: 14 },
  { header: "من", key: "outOf", width: 10 },
  { header: "التصحيح اليدوي", key: "manual", width: 16 },
  { header: "الدرجة النهائية", key: "final", width: 16 },
  { header: "من", key: "finalOutOf", width: 10 },
  { header: "حالة التصحيح", key: "status", width: 18 },
  { header: "النسبة", key: "pct", width: 12, numFmt: "0%" },
];

const DEGREE_SHEETS = { quiz: "الكويزات", homework: "الواجبات", exam: "الامتحانات" };
const DEGREE_FILES = { quiz: "quiz-degrees", homework: "homework-degrees", exam: "exam-degrees" };


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

const pickFrom = (raw, list) => {
  if (typeof raw !== "string" || raw === "" || raw === "All") return "";
  return list.some((item) => item.value === raw) ? raw : "";
};

const gradingQuery = (f, kind, status, extra) => {
  const parts = [];
  const base = tf.toQuery(f, extra);
  if (kind) parts.push("type=" + encodeURIComponent(kind));
  if (status) parts.push("status=" + encodeURIComponent(status));
  if (!parts.length) return base;
  return base ? base + "&" + parts.join("&") : "?" + parts.join("&");
};

const SUBMITTED = { totalDegree: { $ne: null } };

router.get("/grading", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const f = tf.parse(req.query);
    const kind = pickFrom(req.query.type, GRADING_TYPES);
    const status = pickFrom(req.query.status, GRADING_STATUSES);
    const wantsExport = req.query.export === "xlsx";

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

    attempts = attempts.filter((it) => it && it.student && it.quiz);

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
        ...qt.viewLocals(),
        ...gr.viewLocals(),
      })
    );
  } catch (err) {
    next(err);
  }
});

const isObjectId = (v) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

router.get("/grading/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) return res.sendStatus(404);

    const attempt = await degreeQ
      .findOne(Object.assign({ _id: req.params.id }, SUBMITTED))
      .populate({ path: "quiz" })
      .populate({ path: "student" })
      .lean();

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

    const applied = gr.applyMarks(attempt.quiz, attempt, req.body);
    if (applied.error) {
      req.flash("gradeBad", applied.error);
      return res.redirect(back);
    }

    let by = "";
    try {
      const who = jwt.verify(req.cookies.student, config.jwtSecret);
      by = who && who.nameStudent ? String(who.nameStudent) : "";
    } catch (e) {
      by = "";
    }

    await degreeQ.findByIdAndUpdate(req.params.id, {
      writtenAnswers: applied.written,
      manualDegree: applied.manualDegree,
      gradedAt: new Date(),
      gradedBy: by,
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

router.get("/showStudentsDegree/:type", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const type = req.params.type;
    if (DEGREE_TYPES.indexOf(type) === -1) {
      return res.sendStatus(404);
    }

    const f = tf.parse(req.query);
    const wantsExport = req.query.export === "xlsx";

    let degreeFilter = { type: type };
    let orderedIds = null;

    if (f.active || f.sort) {
      const studentFilter = tf.studentFilter(f, {});
      const order = tf.mongoSort(f, { _id: 1 });

      let idQuery = student.find(studentFilter).select("_id").sort(order.sort).lean();
      if (order.collation) idQuery = idQuery.collation(order.collation);
      const ids = await idQuery;

      orderedIds = ids.map((s) => String(s._id));
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
        if (!it || !it.student || !it.quiz) continue;

        const totalQ = qt.autoGradableCount(it.quiz);
        const submitted = it.totalDegree != null && it.totalDegree !== "";
        let score = submitted ? Number(it.totalDegree) : null;
        if (score != null && !isFinite(score)) score = null;
        const pct = score != null && totalQ > 0 ? Math.round((score / totalQ) * 100) : null;

        const t = gr.totalsOf(it.quiz, it);

        rows.push({
          name: it.student.fullName || "",
          card: it.student.cardNumber || "",
          group: tf.GROUP_LABEL[it.student.group] || it.student.group || "",
          sGrade: tf.GRADE_LABEL[it.student.grade] || it.student.grade || "",
          sSubject: tf.SUBJECT_LABEL[it.student.educetionlevel] || it.student.educetionlevel || "",
          paper: it.quiz.nameQuiz || "",
          score:
            submitted && score != null
              ? t.status === gr.STATUS.PENDING || t.status === gr.STATUS.PARTIAL
                ? score + " (" + gr.STATUS_LABELS[t.status] + ")"
                : score
              : "لم يُسلّم",
          outOf: totalQ,
          manual: t.manualOutOf > 0 ? t.manual : "",
          final: t.final == null ? "" : t.final,
          finalOutOf: t.finalOutOf,
          status: gr.STATUS_LABELS[t.status] || "",
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
        group: f.group,
        csrfToken: req.csrfToken ? req.csrfToken() : "",
        ...qt.viewLocals(),
        ...gr.viewLocals(),
      })
    );
  } catch (err) {
    next(err);
  }
});

router.post("/removestudentDegree/:type/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const type = DEGREE_TYPES.indexOf(req.params.type) === -1 ? "quiz" : req.params.type;

    await degreeQ.findByIdAndDelete(req.params.id);

    const f = tf.parse(req.body);
    res.redirect("/showStudentsDegree/" + encodeURIComponent(type) + tf.toQuery(f, null));
  } catch (err) {
    next(err);
  }
});


router.get("/editExam/:id", csrfProtect, isAdmin, contro.editPaperGet("exam"));

router.post("/editExam/:id", csrfProtect, isAdmin, contro.editPaperPost("exam"));
router.post("/removeExam/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findOneAndDelete({ _id: req.params.id });
    await degreeQ.deleteMany({ quiz: req.params.id, type: "exam" });
    res.redirect("/admin/exam");
  } catch (err) {
    next(err);
  }
});
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

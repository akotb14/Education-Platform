const model = require("../models/quiz");
const user = require("../models/user");
const unit = require("../models/unit");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const degreeModel = require("../models/degreeQuiz");
const qt = require("../util/questionTypes");
const gr = require("../util/grading");
const at = require("../util/attemptTime");

const resolveUnitRef = async (unitRef) => {
  if (typeof unitRef !== "string") return null;

  const sep = unitRef.indexOf(":");
  if (sep === -1) return null;

  const docId = unitRef.slice(0, sep);
  const rowId = unitRef.slice(sep + 1);

  if (!/^[a-f0-9]{24}$/i.test(docId) || !/^[a-f0-9]{24}$/i.test(rowId)) {
    return null;
  }

  const doc = await unit.getModel().findOne({ _id: docId });
  if (!doc || !Array.isArray(doc.units)) return null;

  const row = doc.units.find((r) => r && String(r._id) === rowId);
  if (!row) return null;

  return {
    doc: doc,
    row: row,
    educetionlevel: doc.educetionlevel,
    grade: doc.grade,
    month: row.month,
    unit: row.unit,
  };
};

const cleanQuizTime = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s : "";
};

/* A `datetime-local` value, shape-checked. The browser posts
   "YYYY-MM-DDTHH:MM" (a few add ":SS"), and it is stored as that string
   verbatim — same as startTime/endTime, which are Strings because every screen
   prints them and nothing does arithmetic on them.

   Only the NEW field goes through this. startTime and endTime are left reading
   `req.body.x || ""` exactly as they always have: a paper on disk carrying some
   other format would be blanked by a validator applied to it now, and quietly
   erasing an exam's window is a worse outcome than storing an odd one. */
const cleanStamp = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : "";
};

/* The description's cap. Rejected rather than truncated, the same way an
   out-of-range mark is (see parseQuestions): the textarea carries `maxlength`,
   so a form-driven save can never reach this, and anything that does is a
   hand-built POST — which is exactly the case that must not be silently
   rewritten into something the admin never typed. */
const MAX_DESCRIPTION = 500;

/* Text as POSTED, or null when the field was not in the body at all.

   The distinction is the whole point. "" is the admin clearing the field and
   has to be written; absent means the form does not carry this field and the
   stored value must be left alone. Collapsing the two is the mistake that made
   the quiz duration unassignable on the edit form — cleanQuizTime(undefined)
   returns "", so an unguarded write untimed every paper whose form did not
   include the field. `typeof === "string"` is the same test the placement
   picker already uses for the same reason.

   It also happens to be the check that rejects a REPEATED key: express
   .urlencoded runs querystring.parse, which turns `description` sent twice into
   an ARRAY, and a String() of that would store "a,b". */
const postedText = (raw) => (typeof raw === "string" ? raw.trim() : null);

const MAX_QUESTIONS = 50;

const parseQuestions = (req, options) => {
  const opts = options || {};
  const startNo = Number(opts.startNo) > 0 ? Number(opts.startNo) : 1;
  const allowEmpty = !!opts.allowEmpty;

  const body = req.body || {};

  const indices = [];
  for (const key of Object.keys(body)) {
    const m = /^q_(\d+)_question$/.exec(key);
    if (m) indices.push(Number(m[1]));
  }
  indices.sort((a, b) => a - b);

  /* upload.any() gives a flat array; each file knows the field it came from. */
  const filesBy = {};
  for (const f of Array.isArray(req.files) ? req.files : []) {
    if (f && f.fieldname) filesBy[f.fieldname] = f.path;
  }

  const questions = []; // to save
  const echo = []; // to redisplay if this submission is rejected

  for (const i of indices) {
    const text = String(body[`q_${i}_question`] || "").trim();

    /* WHITELISTED, not trusted. This value reaches a schema enum, and a
       hand-crafted POST can put anything in it — an unrecognised string would
       throw a ValidationError on save. typeOf() reads anything it does not
       know as "mcq", which is also what a form submitted with the field
       missing entirely should mean. */
    const qType = qt.typeOf({ qType: body[`q_${i}_type`] });

    /* Choices come back as a VARIABLE number now (2–6, was exactly 4), so the
       trailing empties of a question with three options are dropped rather
       than failing the old "all four must be filled" check. A gap in the
       middle is still an empty string and still rejected below — that is a
       half-filled row, not a shorter list. */
    const rawOptions = [];
    /* The index each surviving option was SUBMITTED under. Removing an option
       row leaves its name index unused, exactly like removing a question block
       does — so `a0, a2` with no `a1` is normal input, and the radio marking
       the answer carries 2, not "the second one". Keeping the two lists in
       step is what lets a gap resolve to the right text instead of silently
       marking every answer wrong. */
    const optionIdx = [];
    /* <= MAX_OPTIONS, so one index PAST the limit is read. Stopping at the
       limit would make an over-long submission silently lose its extra
       options instead of being rejected — the browser caps the repeater at
       MAX_OPTIONS, but a hand-crafted POST is not obliged to. */
    for (let c = 0; c <= qt.MAX_OPTIONS; c++) {
      const key = `q_${i}_a${c}`;
      if (!(key in body)) continue;
      rawOptions.push(String(body[key] == null ? "" : body[key]).trim());
      optionIdx.push(c);
    }
    while (rawOptions.length && rawOptions[rawOptions.length - 1] === "") {
      rawOptions.pop();
      optionIdx.pop();
    }

    const correctRaw = body[`q_${i}_correct`];
    const correct =
      correctRaw === undefined || correctRaw === null || correctRaw === ""
        ? -1
        : Number(correctRaw);
    /* Submitted index → position in the compacted list. The echo and the
       stored answer both work in positions, because the redisplayed form
       renumbers its option rows contiguously from the echo. */
    const correctPos = correct < 0 ? -1 : optionIdx.indexOf(correct);

    const tfRaw = body[`q_${i}_tf`];
    const tf =
      tfRaw === undefined || tfRaw === null || tfRaw === "" ? -1 : Number(tfRaw);

    const modelAnswer = String(body[`q_${i}_model`] || "").trim();

    /* Explain only: what the question is worth when a teacher marks it. Left
       as the RAW STRING here so the echo can hand back exactly what was typed
       on a rejected submission; it is parsed in the explain branch below,
       where a bad value can be reported against the right question number. */
    const maxRaw = String(body[`q_${i}_max`] == null ? "" : body[`q_${i}_max`]).trim();

    /* What goes back into the form if this submission is rejected. Carries the
       type, the options as submitted and the model answer, so a rejected
       Explain question does not come back as an empty MC block. */
    echo.push({
      type: qType,
      question: text,
      answers: rawOptions,
      correct: correctPos >= 0 && correctPos < rawOptions.length ? correctPos : "",
      tf: tf === 0 || tf === 1 ? tf : "",
      modelAnswer: modelAnswer,
      maxScore: maxRaw,
    });

    const pos = echo.length; // what the admin sees, 1-based

    /* BLANKNESS IS PER-TYPE. A block the admin added and never filled in is
       skipped rather than rejected — that is how the "add question" button can
       leave an empty block at the end harmlessly. But what counts as empty
       differs: an Explain block with only a model answer typed is NOT blank,
       and must produce the "write the question text" error rather than being
       silently thrown away along with what was typed. */
    let blank;
    if (qType === "explain") {
      /* maxScore is deliberately NOT part of this test. The input renders
         pre-filled with the default, so a block the admin switched to Explain
         and then left alone always submits a value — counting it as content
         would make every untouched trailing block fail with "write the
         question text" instead of being skipped. */
      blank = !text && !modelAnswer;
    } else if (qType === "truefalse") {
      blank = !text && tf < 0;
    } else {
      blank = !text && rawOptions.every((a) => a === "") && correct < 0;
    }
    if (blank) {
      echo.pop();
      continue;
    }

    if (!text) {
      return { error: `السؤال ${pos}: اكتب نص السؤال.`, echo: echo };
    }

    /* Per-type: what to store in answer / correctAnswer. Every branch ends up
       with the SAME SHAPE — options in answer[0], the winning text in
       correctAnswer — which is why nothing downstream of here needed to learn
       about types to handle True/False. */
    let answers;
    let correctAnswer;
    /* Auto-graded questions are worth exactly one mark and ignore this field
       entirely — util/grading.pointsOf() returns 1 for them whatever is
       stored. Only the explain branch below assigns it. */
    let maxScore = gr.DEFAULT_EXPLAIN_POINTS;

    if (qType === "explain") {
      /* No options and no key: there is nothing to auto-mark against. Stored
         as an empty list rather than omitted, so answer[0] is still an array
         for every reader that indexes it. */
      answers = [];
      correctAnswer = "";

      /* Blank falls back to the default rather than erroring: the input is
         deliberately not `required`, because a required control inside a
         display:none group makes the browser block submit on an unfocusable
         element. Anything typed must be a whole number in range — rejected,
         never clamped, since a clamped mark is a mark the admin never chose
         and would never be told about. */
      if (maxRaw !== "") {
        if (!/^\d+$/.test(maxRaw)) {
          return { error: `السؤال ${pos}: أدخل الدرجة كرقم صحيح.`, echo: echo };
        }
        const n = Number(maxRaw);
        if (n < gr.MIN_POINTS || n > gr.MAX_POINTS) {
          return {
            error: `السؤال ${pos}: الدرجة من ${gr.MIN_POINTS} إلى ${gr.MAX_POINTS}.`,
            echo: echo,
          };
        }
        maxScore = n;
      }
    } else if (qType === "truefalse") {
      if (!(tf === 0 || tf === 1)) {
        return {
          error: `السؤال ${pos}: علّم إن كانت العبارة صحيحة أم خاطئة.`,
          echo: echo,
        };
      }
      /* Deliberately the multiple-choice shape, with the option text coming
         from the one shared constant. */
      answers = qt.TF_OPTIONS.slice();
      correctAnswer = qt.TF_OPTIONS[tf];
    } else {
      if (rawOptions.length < qt.MIN_OPTIONS) {
        return {
          error: `السؤال ${pos}: اكتب ${qt.MIN_OPTIONS} اختيارات على الأقل.`,
          echo: echo,
        };
      }
      if (rawOptions.length > qt.MAX_OPTIONS) {
        return {
          error: `السؤال ${pos}: الحد الأقصى ${qt.MAX_OPTIONS} اختيارات.`,
          echo: echo,
        };
      }
      /* An empty box between two filled ones. */
      if (rawOptions.some((a) => a === "")) {
        return { error: `السؤال ${pos}: لا تترك اختيارًا فارغًا.`, echo: echo };
      }

      /* Two identical choices make the question unanswerable-as-intended: the
         answer key is stored as text and the grader compares text, so a
         student picking either copy is marked correct. */
      const unique = new Set(rawOptions);
      if (unique.size !== rawOptions.length) {
        return {
          error: `السؤال ${pos}: لا يمكن تكرار نفس الاختيار مرتين.`,
          echo: echo,
        };
      }

      /* Bounded by how many options were actually submitted, not by a fixed
         4 — an index pointing past the end would store correctAnswer:
         undefined and mark every answer wrong. */
      if (!(correctPos >= 0 && correctPos < rawOptions.length)) {
        return { error: `السؤال ${pos}: علّم الإجابة الصحيحة.`, echo: echo };
      }

      answers = rawOptions;
      correctAnswer = rawOptions[correctPos];
    }

    questions.push({
      image: filesBy[`q_${i}_image`] || "",
      /* Position, not a number the admin picks. The old form had a select
         going up to 30 that let any question claim any number, including one
         already used, while the student paper reads questions by array
         position and ignores `no` entirely. */
      no: String(startNo + questions.length),
      question: text,
      qType: qType,
      /* Array of arrays — models/quiz.js declares `answer: [Array]` and
         views/quiz-paper.ejs reads q.answer[0]. Do not flatten. */
      answer: [answers],
      correctAnswer: correctAnswer,
      modelAnswer: qType === "explain" ? modelAnswer : "",
      /* Written for every type so the stored document is uniform, but read
         only for Explain. On an auto-graded question this is the schema
         default and pointsOf() ignores it. */
      maxScore: maxScore,
    });
  }

  if (!questions.length && !allowEmpty) {
    return { error: "أضف سؤالًا واحدًا على الأقل.", echo: echo };
  }
  if (questions.length > MAX_QUESTIONS) {
    return {
      error: `الحد الأقصى ${MAX_QUESTIONS} سؤالًا في المرة الواحدة.`,
      echo: echo,
    };
  }

  return { questions: questions, echo: echo };
};

/* multer writes every uploaded file to disk before any of this runs, so a
   rejected submission has already left its images in images/. Without this a
   50-question form rejected three times leaves 150 orphans nothing will ever
   reference. Best effort — a failed unlink must not turn a validation message
   into a 500. */
const discardUploads = (req) => {
  for (const f of Array.isArray(req.files) ? req.files : []) {
    if (f && f.path) fs.unlink(f.path, () => {});
  }
};

/* Hand the whole submission back to the form. Every failure below ends in a
   redirect — correct, because a refresh must not resubmit — but a redirect
   renders a blank form, and blanking a form that held twenty questions because
   one choice was left empty is not a usable way to work. getQuiz reads this
   back out. Images are not restored: a browser will not let a page set the
   value of <input type=file>, and a question whose image the admin believes is
   attached and is not would be worse than the note the form shows instead. */
const keepSubmission = (req, questionsEcho) => {
  req.flash("addForm", {
    unitRef: req.body.unitRef || "",
    educetionlevel: req.body.educetionlevel || "",
    grade: req.body.grade || "",
    nameQuiz: req.body.nameQuiz || "",
    description: req.body.description || "",
    startTime: req.body.startTime || "",
    endTime: req.body.endTime || "",
    dueDate: req.body.dueDate || "",
    quizTime: req.body.quizTime || "",
    questions: Array.isArray(questionsEcho) ? questionsEcho : [],
  });
};

const addQuiz = async (req, res) => {
  try {
    const type = req.params.type;
    if (type !== "quiz" && type !== "exam" && type !== "homework") {
      discardUploads(req);
      return res.sendStatus(400);
    }

    const back = `/admin/${type}`;
    const LABEL = { quiz: "الكويز", exam: "الامتحان", homework: "الواجب" }[type];

    const nameQuiz = (req.body.nameQuiz || "").trim();
    const parsed = parseQuestions(req);

    /* One exit for every rejection: undo the uploads, keep what was typed,
       say what is wrong, go back. */
    const reject = (message) => {
      discardUploads(req);
      keepSubmission(req, parsed.echo);
      req.flash("addBad", message);
      return res.redirect(back);
    };

    if (!nameQuiz) {
      return reject(`اكتب اسم ${LABEL}.`);
    }

    /* Optional on every kind. Offered on the add form as well as the edit form
       on purpose: a field that can only ever be filled in by going back and
       editing is a field most papers will never have. */
    const description = postedText(req.body.description) || "";
    if (description.length > MAX_DESCRIPTION) {
      return reject(`الوصف طويل جدًا — الحد ${MAX_DESCRIPTION} حرفًا.`);
    }

    if (parsed.error) {
      return reject(parsed.error);
    }

    const questions = parsed.questions;
    const quizTime = cleanQuizTime(req.body.quizTime);

    /* ---- EXAM: standalone, carries its own subject/grade and a window ---- */
    if (type === "exam") {
      const educetionlevel = req.body.educetionlevel;
      const grade = req.body.grade;

      if (!educetionlevel || !grade) {
        return reject("اختر المادة والصف.");
      }

      const dupe = await model.findOne({
        educetionlevel: educetionlevel,
        grade: grade,
        nameQuiz: nameQuiz,
        type: type,
      });
      if (dupe) {
        return reject(`يوجد ${LABEL} بنفس الاسم لهذه المادة والصف.`);
      }

      await new model({
        educetionlevel: educetionlevel,
        grade: grade,
        nameQuiz: nameQuiz,
        description: description,
        quiz: questions,
        type: type,
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        quizTime: quizTime,
      }).save();

      req.flash(
        "addOk",
        `تم إنشاء ${LABEL} «${nameQuiz}» بـ${questions.length} سؤالًا.`
      );
      return res.redirect(back);
    }

    /* ---- HOMEWORK / QUIZ: attached to one unit row ---- */
    const place = await resolveUnitRef(req.body.unitRef);
    if (!place) {
      /* The case that used to be silent. */
      return reject("الدرس المختار غير موجود. حدّث الصفحة واختر درسًا من القائمة.");
    }

    const dupe = await model.findOne({
      educetionlevel: place.educetionlevel,
      grade: place.grade,
      nameQuiz: nameQuiz,
      type: type,
    });
    if (dupe) {
      return reject(`يوجد ${LABEL} بنفس الاسم لهذه المادة والصف.`);
    }

    /* One paper of each kind per unit row. The old code expressed this as
       `val.quizId == undefined` / `val.homeId == undefined` and, when the slot
       was already filled, did nothing at all — same silent redirect. */
    const occupied = type === "quiz" ? place.row.quizId : place.row.homeId;
    if (occupied) {
      return reject(`هذا الدرس مرتبط بـ${LABEL} بالفعل. احذف القديم أولًا.`);
    }

    const paper = new model({
      educetionlevel: place.educetionlevel,
      grade: place.grade,
      nameQuiz: nameQuiz,
      description: description,
      quiz: questions,
      unit: place.unit,
      month: place.month,
      type: type,
      quizTime: quizTime,
      /* Homework only, and informational — see the field's comment in
         models/quiz.js. A quiz has a duration instead; an exam has a window. */
      dueDate: type === "homework" ? cleanStamp(req.body.dueDate) : "",
    });
    await paper.save();

    /* Point the unit row at the new paper. Matched by the row's own _id — the
       old update matched on { unit, month } inside $elemMatch, which updates
       the FIRST row whose unit name and month happen to match, not necessarily
       the row the admin picked. Two rows with the same name in one month were
       enough to attach the paper to the wrong one. */
    const field = type === "quiz" ? "units.$.quizId" : "units.$.homeId";
    await unit.getModel().updateOne(
      { _id: place.doc._id, "units._id": place.row._id },
      { $set: { [field]: paper._id } }
    );

    req.flash(
      "addOk",
      `تم إنشاء ${LABEL} «${nameQuiz}» بـ${questions.length} سؤالًا.`
    );
    return res.redirect(back);
  } catch (err) {
    discardUploads(req);
    console.log(err);
    res.sendStatus(400);
  }
};

const getQuiz = async (req, res, next) => {
  try {
    if (
      req.params.type == "quiz" ||
      req.params.type == "exam" ||
      req.params.type == "homework"
    ) {
      const data = await model.find({ type: req.params.type });
      const units = await unit.getModel().find();

      const okFlash = req.flash("addOk");
      const badFlash = req.flash("addBad");
      const formFlash = req.flash("addForm");

      res.render(`admin/${req.params.type}.ejs`, {
        data,
        units,
        /* The delete buttons on these pages are POST forms now, so the page
           needs a token. */
        csrfToken: req.csrfToken ? req.csrfToken() : "",
        flashOk: okFlash.length ? okFlash[0] : "",
        flashBad: badFlash.length ? badFlash[0] : "",
        /* The rejected submission, if the last request was one. Reading the
           flash also clears it, so a later refresh gets a clean form. */
        formData: formFlash.length ? formFlash[0] : "",
        /* Question-type constants for _question-block.ejs. Spread rather than
           required in the template: EJS cannot require(). */
        ...qt.viewLocals(),
        /* …and the Explain mark bounds the same block's score input needs. */
        ...gr.viewLocals(),
      });
    } else {
      res.sendStatus(400);
    }
  } catch (err) {
    /* Was unhandled: getQuiz had no try/catch at all, so a database failure
       here became an unhandled rejection rather than a response. */
    next(err);
  }
};
/* The module-level `d` / `isStart` / `countCorrect` countdown state that used
   to live here is gone. Each attempt's deadline now lives on its own
   degreeQuiz record. The three remaining module-level variables (`index`,
   `deName`, `arrAns`) are never read by any handler or view and can be
   deleted. */

/* The "HH:MM" → seconds parse, the remaining-time computation and the
   late-submission check all live in util/attemptTime.js now. This file and
   routes/quiz.router.js each carried their own byte-identical copy of the
   parse; one module means the clock the student sees and the clock the grader
   enforces cannot drift apart. */
const allowanceSeconds = at.allowanceSeconds;

const g = async (req, res) => {
  try {
    let id = req.params.nameQuiz;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const data = await model.findOne({ _id: id, type: "exam" });

    let open = false;
    if (data) {
      const sda = new Date(data.startTime).getTime();
      const eda = new Date(data.endTime).getTime();
      open = sda <= Date.now() && eda > Date.now();
    }

    if (!open) {
      /* Was a bare 404 status page. */
      return res.status(404).render("quiz-paper.ejs", {
        kind: "exam",
        paper: null,
        secondsLeft: null,
        totalSeconds: null,
        alreadyTaken: false,
        backHref: "/openExam",
      });
    }

    /* An attempt must exist before the paper is served. Without this check
       /examApp/:id was reachable directly, skipping the POST that creates the
       degree record — so a student could open and re-open an exam with no
       attempt recorded and no deadline attached to anything. */
    const attempt = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "exam",
    });
    if (!attempt) {
      return res.redirect("/startQuiz/" + data._id);
    }

    /* Clamped at 0: a reopened expired attempt gets a stopped clock and an
       automatic submit, not a negative countdown. Attempts created before the
       deadline field existed have none and fall back to untimed. */
    const total = allowanceSeconds(data.quizTime);
    const secondsLeft = at.secondsLeft(attempt);

    res.render("quiz-paper.ejs", {
      kind: "exam",
      paper: data,
      secondsLeft: secondsLeft,
      totalSeconds: total,
      alreadyTaken: attempt.totalDegree != null,
      backHref: "/openExam",
      /* The question-type whitelist, so the paper renders the right input per
         question. EJS cannot require(). */
      ...qt.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
};

/* Arabic-locale date for the exam window chips. Rendered server-side so every
   student sees the same string regardless of their device locale, and marked
   dir="ltr" in the view because a date is a Latin digit run in an RTL line. */
const SUBJECTS = { biology: "الأحياء", geology: "الجيولوجيا" };

const whenText = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (isNaN(t)) return null;
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
};

const getOpenQuiz = async (req, res) => {
  try {
    if (!req.cookies.student) {
      return res.redirect("/");
    }

    /* Local. This used to assign the module-level `deName`, i.e. one variable
       shared by every student on the server — and because the two awaits below
       yield, a second request arriving mid-handler overwrote it and the first
       student got the second student's papers. */
    const student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const papers = await model.find({
      educetionlevel: student.educetionlevel,
      grade: student.grade,
      type: "exam",
    });

    const degrees = await degreeModel.find({
      student: student.studentCard,
      type: "exam",
    });

    /* Keyed lookup instead of the template's per-card degree.find(). That
       callback did `val.quiz.toString()` with no guard, so one degree row whose
       paper had been deleted threw inside the render — and a render error does
       not reach this catch, it goes to Express's own handler, so the student
       got a 500 rather than the intended 404. */
    const byPaper = new Map();
    for (const d of degrees) {
      if (d.quiz) byPaper.set(String(d.quiz), d);
    }

    const now = Date.now();

    const items = papers.map((p) => {
      const id = String(p._id);
      const deg = byPaper.get(id);
      const submitted = !!(deg && deg.totalDegree != null);

      const start = new Date(p.startTime).getTime();
      const end = new Date(p.endTime).getTime();

      /* An unparseable or missing window used to make both branch tests false,
         which is one of the ways an exam silently vanished from this page.
         Treat it as open rather than hiding the paper. */
      let state = "open";
      if (!isNaN(start) && start > now) {
        state = "soon";
      } else if (!isNaN(end) && end <= now) {
        state = "closed";
      }

      return {
        id: id,
        name: p.nameQuiz,
        unit: p.unit || "",
        month: p.month || "",
        subject: SUBJECTS[p.educetionlevel] || "",
        total: Array.isArray(p.quiz) ? p.quiz.length : 0,
        state: state,
        started: !!deg,
        submitted: submitted,
        score: submitted ? Number(deg.totalDegree) : null,
        opensAt: whenText(p.startTime),
        closesAt: whenText(p.endTime),
      };
    });

    res.render("assessment-list.ejs", { kind: "exam", items: items });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
};
const postQuizApp = async (req, res) => {
  try {
    let name = req.params.nameQuiz;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const data = await model.findOne({
      _id: name,
    });
    /* One shared grader, in util/questionTypes.js — the third of three
       near-identical copies of this loop. `i` was assigned with no declaration,
       making it an implicit global shared by every concurrent submission, and
       the loop body's per-question console.log printed the answer key to the
       server log on every submit. */
    const graded = qt.gradeSubmission(data, req.body);
    const count = graded.count;
    const checkCount = await degreeModel.findOne({
      /* `data.id` before — the mongoose virtual, inconsistent with the
         `data._id` used in the update below. */
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "exam",
    });
    if (checkCount && checkCount.totalDegree == null) {
      /* THE SERVER'S OWN VIEW OF THE CLOCK — the check this grader was missing.
         The countdown was always anchored to the attempt's stored `deadline`,
         so a refresh could not buy time, but nothing compared that deadline to
         the moment the answers arrived: clearing the interval in the console
         kept an exam open indefinitely and the late answers were graded as
         though they were on time. util/attemptTime.js explains why a late
         submission is recorded and flagged rather than refused. */
      const late = at.lateFields(checkCount);

      let up = await degreeModel.findOneAndUpdate(
        {
          quiz: data._id,
          student: student.studentCard,
          isCheck: "1",
          type: "exam",
        },
        {
          totalDegree: count,
          writtenAnswers: graded.written,
          ...late,
          /* See the quiz.router.js copy: the student's own choices, the
             hand-in time, and a needsReview that means "this paper has essays
             on it" so blank ones still reach the marking queue — or, now, that
             it was handed in late. */
          answers: graded.answers,
          submittedAt: new Date(),
          needsReview: graded.written.length > 0 || late.late === true,
        }

      );
    }
    return res.redirect("/openExam");
  } catch (err) {
    res.redirect("/openExam");
      console.log(err);
  }
};

const startQuiz = async (req, res) => {
  try {
    /* The old handler wrapped its whole body in `if (req.body.btn ==
       "continue")` with no else, so any other POST fell off the end of the
       function with no response written and the request hung until the browser
       gave up. */
    if (req.body.btn != "continue") {
      return res.redirect("/startQuiz/" + req.params.nameQuiz);
    }

    let name = req.params.nameQuiz;
    const qutime = await model.findOne({ _id: name, type: "exam" });
    if (!qutime) {
      return res.redirect("/openExam");
    }

    /* The window is re-checked here, not just on the intro page. Without it a
       student could sit on the intro past endTime and still start the exam. */
    const sda = new Date(qutime.startTime).getTime();
    const eda = new Date(qutime.endTime).getTime();
    if (!(sda <= Date.now() && eda > Date.now())) {
      return res.redirect("/openExam");
    }

    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const checkDegree = await degreeModel.findOne({
      isCheck: "1",
      quiz: qutime._id,
      student: student.studentCard,
      type: "exam",
    });

    if (!checkDegree) {
      const secs = allowanceSeconds(qutime.quizTime);
      const deg = new degreeModel({
        isCheck: "1",
        quiz: qutime._id,
        student: student.studentCard,
        totalDegree: null,
        type: "exam",
        /* THE DEADLINE, on this student's own attempt. What used to happen
           instead: `d` was set to the allowance and a setInterval decremented
           it once a second for the life of the process. Every student's exam
           page rendered that one shared number, so two concurrent attempts
           fought over one clock and a third student inherited the remainder of
           somebody else's. The interval also outlived the response, and a
           restart wiped the countdown entirely. */
        deadline: secs ? new Date(Date.now() + secs * 1000) : undefined,
      });
      await deg.save();

      res.redirect("/examApp/" + qutime._id);
    } else if (checkDegree.totalDegree == null) {
      /* Started but never submitted — back in on their remaining time. The old
         code answered 400 and the English string "you cant entered Exam agian"
         for this case and a graded attempt alike, so a student whose connection
         dropped mid-exam lost the whole thing. */
      res.redirect("/examApp/" + qutime._id);
    } else {
      res.redirect("/openExam");
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
};
/* ======================================================================
   EDITING A PAPER — TWO SEPARATE JOBS, TWO SEPARATE FORMS

   There used to be one form that did both, and it made the common job the
   expensive one. An admin who wanted to fix a typo in a quiz's name opened a
   page that led with a question builder, scrolled past an empty question
   block, and pressed save on a form whose submit button carried a question
   count. Nothing was lost by doing that — the builder's empty block was
   skipped — but the page never said so, and "am I about to add a blank
   question?" is not a question a rename should raise.

   So the two are split, and the split is in the URLs:

     /editQuiz/:id          the paper's own settings. Name, description,
                            placement, window, duration. NO questions.
     /questionsOfQuiz/:id   the questions. Add a batch, edit one, reorder,
                            delete. NOTHING about the paper itself.

   editPaperPost below therefore does not call parseQuestions, does not $push,
   and its route no longer runs upload.any() — there is no file input on that
   form any more, so there is nothing to discard on a rejection either. Renaming
   a paper cannot touch its questions because the handler that renames it never
   looks at them.

   WHAT THE SPLIT REPLACED — the two bugs the combined handler was written to
   fix, both of which stay fixed:

   1. IT WAS EITHER/OR. The original three per-router handlers were one
      if/else: if any meta field differed, update the meta and ignore the
      question; otherwise append the question. Fixing the name AND filling in a
      question in one submission — which the single form invited — silently lost
      the question. There is no longer one submission that can do both, so
      there is no longer a way to lose half of it.

   2. ONE QUESTION PER SUBMISSION, with its answer key typed as free text that
      had to match a choice character-for-character. The batch builder and the
      radio answer key live on the questions page now.

   Also fixed back then and still true: the subject select offered
   "Secondary"/"Preparatory" while every paper, student record and query uses
   "biology"/"geology", so saving the edit form unchanged wrote a value nothing
   matched and the paper dropped out of the lists it belonged to.
   ====================================================================== */

const EDIT_PATH = {
  homework: "/editHomework",
  quiz: "/editQuiz",
  exam: "/editExam",
};

/* The other half of the split. Kept beside EDIT_PATH so the pair is one thing
   to read: every redirect below picks one of these two, and which one it picks
   is the whole distinction the split is made of. */
const QUESTIONS_PATH = {
  homework: "/questionsOfHomework",
  quiz: "/questionsOfQuiz",
  exam: "/questionsOfExam",
};

const KIND_LABEL = { quiz: "الكويز", exam: "الامتحان", homework: "الواجب" };
const GRADES = ["1st", "2nd", "3rd"];

/* ----------------------------------------------------------------------
   THE SETTINGS PAGE. Renders admin/edit<type>.ejs, which is the paper's own
   fields plus a link across to the questions page — no question builder, no
   question list, no file input.
   ---------------------------------------------------------------------- */
const editPaperGet = (type) => async (req, res, next) => {
  try {
    const paper = await model.findOne({ _id: req.params.id, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

    /* Quiz and homework need the units list for the lesson-placement picker
       that lets an admin move the paper between lessons. Exam has no
       placement. Find which row currently points at this paper. */
    let units = [];
    let currentUnitValue = "";
    if (type !== "exam") {
      const allUnits = await unit.getModel().find();
      units = allUnits;

      const field = type === "quiz" ? "quizId" : "homeId";
      for (const doc of allUnits) {
        const rows = Array.isArray(doc.units) ? doc.units : [];
        for (const row of rows) {
          if (row && row[field] && String(row[field]) === String(paper._id)) {
            currentUnitValue = String(doc._id) + ":" + String(row._id);
            break;
          }
        }
        if (currentUnitValue) break;
      }
    }

    const okFlash = req.flash("editOk");
    const badFlash = req.flash("editBad");
    const formFlash = req.flash("editForm");

    res.render(`admin/edit${type}.ejs`, {
      kind: type,
      data: paper,
      /* The questions themselves are NOT rendered on this page — that is the
         point of the split. What is passed is the array, and the view reads
         nothing from it but `.length`, for the count on the "إدارة الأسئلة"
         link. A count is orientation ("this paper has 12 questions"); the
         questions are the other page's job.

         Passed as the array rather than a number so the local keeps the name
         and shape every other admin view uses for it, and so the view's own
         `typeof` guard stays the same shape as its siblings'. */
      question: Array.isArray(paper.quiz) ? paper.quiz : [],
      units: units,
      currentUnit: currentUnitValue,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      flashOk: okFlash.length ? okFlash[0] : "",
      flashBad: badFlash.length ? badFlash[0] : "",
      formData: formFlash.length ? formFlash[0] : "",
      /* qt.viewLocals() and gr.viewLocals() are deliberately NOT spread here.
         They are the question-type vocabulary and the Explain mark bounds —
         _question-block.ejs's locals — and this page no longer renders a
         question block. questionsGet below passes them instead.

         Left out rather than passed harmlessly: a local in scope is read as
         "this page deals in question types", and the next person to add
         something question-shaped to the settings form would find the
         constants already there and take that as permission. */
    });
  } catch (err) {
    next(err);
  }
};

/* ----------------------------------------------------------------------
   THE PAPER'S OWN SETTINGS. Name, description, placement, window, duration.

   Not one line of this handler reads a question, and that is the guarantee
   the brief asks for: renaming a paper cannot delete, recreate or re-submit
   its questions, because the code that renames it has no reference to them.
   The $set below names its fields explicitly — there is no $push branch and
   no path under `quiz`, so paper.quiz is untouched by construction rather
   than by care.

   Its route also no longer runs upload.any(): the settings form has no file
   input, so it posts as ordinary urlencoded, and there is nothing to discard
   when a validation error sends the admin back.
   ---------------------------------------------------------------------- */
const editPaperPost = (type) => async (req, res) => {
  const back = `${EDIT_PATH[type]}/${req.params.id}`;
  const LABEL = KIND_LABEL[type];

  try {
    const paper = await model.findOne({ _id: req.params.id, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

    /* No discardUploads: nothing on this form uploads. The echo carries only
       settings fields — `questions` is gone from it, because a rejection here
       cannot have any question state to preserve. */
    const reject = (message) => {
      req.flash("editForm", {
        educetionlevel: req.body.educetionlevel || "",
        grade: req.body.grade || "",
        nameQuiz: req.body.nameQuiz || "",
        description: req.body.description || "",
        unitPlacement: req.body.unitPlacement || "",
        startTime: req.body.startTime || "",
        endTime: req.body.endTime || "",
        dueDate: req.body.dueDate || "",
        quizTime: req.body.quizTime || "",
      });
      req.flash("editBad", message);
      return res.redirect(back);
    };

    const nameQuiz = (req.body.nameQuiz || "").trim();
    if (!nameQuiz) {
      return reject(`اكتب اسم ${LABEL}.`);
    }

    /* null when the form did not carry the field, which is what keeps a paper
       that predates the description from having one invented for it. Only a
       posted value — including a cleared one — is written. */
    const description = postedText(req.body.description);
    if (description !== null && description.length > MAX_DESCRIPTION) {
      return reject(`الوصف طويل جدًا — الحد ${MAX_DESCRIPTION} حرفًا.`);
    }

    /* Where subject and grade come from now.

       Exam has no lesson, so its form posts them and they are validated
       here as before. Quiz and homework no longer post them at all — their
       form is the name plus the lesson — so they are read off the unit
       document the chosen lesson lives in. That is the one source that
       cannot drift: the unit row IS the placement, and a paper filed under
       a geology/1st lesson but stamped biology/3rd shows up in no student
       list, because every list queries on both fields. Leaving the picker
       empty keeps whatever the paper already had.

       Guard, not cosmetics: `|| ""` on an unposted field writes an empty
       string. Reading req.body.educetionlevel for a form that no longer
       sends it would blank the subject on every quiz save. */
    let educetionlevel = paper.educetionlevel;
    let grade = paper.grade;

    /* "docId:rowId", "" for none, or null when the field was not posted at
       all — the exam case, meaning "do not touch placement". */
    const placementRaw =
      typeof req.body.unitPlacement === "string" ? req.body.unitPlacement : null;
    let placement = null;

    if (type === "exam") {
      educetionlevel = req.body.educetionlevel;
      grade = req.body.grade;
      if (!(educetionlevel in SUBJECTS) || !GRADES.includes(grade)) {
        return reject("اختر المادة والصف.");
      }
    } else if (placementRaw) {
      /* Shape-checked before it reaches Mongo: a malformed id is a CastError,
         which the outer catch would turn into the generic "try again" message
         for what is really a tampered or stale value. */
      if (!/^[0-9a-f]{24}:[0-9a-f]{24}$/i.test(placementRaw)) {
        return reject("هذا الدرس غير موجود. اختر درسًا آخر.");
      }
      const [docId, rowId] = placementRaw.split(":");
      const lessonDoc = await unit
        .getModel()
        .findOne({ _id: docId, "units._id": rowId });
      const rows =
        lessonDoc && Array.isArray(lessonDoc.units) ? lessonDoc.units : [];
      const row = rows.find((r) => r && String(r._id) === String(rowId));
      if (!row) {
        return reject("هذا الدرس غير موجود. اختر درسًا آخر.");
      }

      /* The select marks occupied rows `disabled`, but disabled is a browser
         courtesy — it is absent from a hand-built POST. Without this check a
         tampered submission could point a second paper at a row already
         taken, and the row holds one pointer, so the first paper would be
         silently unfiled. */
      const field = type === "quiz" ? "quizId" : "homeId";
      if (row[field] && String(row[field]) !== String(paper._id)) {
        return reject(
          `هذا الدرس مرتبط بـ${type === "quiz" ? "كويز" : "واجب"} آخر.`
        );
      }

      placement = {
        docId: docId,
        rowId: rowId,
        month: row.month || "",
        unit: row.unit || "",
      };
      educetionlevel = lessonDoc.educetionlevel || educetionlevel;
      grade = lessonDoc.grade || grade;
    }

    /* Same-name guard as the add form, excluding this paper itself — without
       the _id exclusion, saving a paper without renaming it would collide
       with its own record. */
    const dupe = await model.findOne({
      _id: { $ne: paper._id },
      educetionlevel: educetionlevel,
      grade: grade,
      nameQuiz: nameQuiz,
      type: type,
    });
    if (dupe) {
      return reject(`يوجد ${LABEL} بنفس الاسم لهذه المادة والصف.`);
    }

    const meta = {
      educetionlevel: educetionlevel,
      grade: grade,
      nameQuiz: nameQuiz,
    };

    if (description !== null) {
      meta.description = description;
    }

    if (type === "exam") {
      meta.startTime = req.body.startTime || "";
      meta.endTime = req.body.endTime || "";
    }

    /* Duration, and the reason it is guarded rather than just assigned.

       cleanQuizTime(undefined) returns "" — it cannot tell "the admin cleared
       the box" from "this form does not have the box" — so `meta.quizTime =
       cleanQuizTime(req.body.quizTime)` on a form that omits the field untimes
       every paper it saves. That is exactly what used to happen here, and the
       fix at the time was to stop writing duration at all, which made it
       uneditable: the field could be set when a quiz was created and never
       afterwards.

       Both forms carry it now (a quiz's duration and an exam's per-attempt
       allowance are the same field), so it is editable again — and the
       `typeof === "string"` test is what makes that safe. Posted-and-empty
       writes ""; absent writes nothing. Homework has no duration and its form
       omits the field, so this branch simply never fires for homework. */
    if (typeof req.body.quizTime === "string") {
      meta.quizTime = cleanQuizTime(req.body.quizTime);
    }

    /* Homework's due date, same guard for the same reason. Restricted to
       homework as well as to a posted value: dueDate is meaningless on the
       other two kinds, and an accepted POST that set it on a quiz would put a
       value on the document that no screen will ever show. */
    if (type === "homework" && typeof req.body.dueDate === "string") {
      meta.dueDate = cleanStamp(req.body.dueDate);
    }

    /* month and unit on the paper are copies of the lesson row's labels, not
       independently typed values. quizBackHref in routes/quiz.router.js
       builds its redirect out of paper.month, and the homework list falls
       back to it, so they follow the placement. */
    if (placement) {
      meta.month = placement.month;
      meta.unit = placement.unit;
    }

    /* $set only, and every key in `meta` is a settings field. No $push, no
       path under `quiz`. */
    await model.updateOne({ _id: paper._id }, { $set: meta });

    /* Lesson reassignment. The unit ROW holds the pointer
       (units.$.quizId / units.$.homeId) — the paper knows nothing about where
       it is filed — so moving one means clearing the old row and setting the
       new one, in that order. Clearing first also makes moving a paper to the
       row it already occupies a no-op rather than a duplicate.

       placementRaw === "" is an explicit detach: clear the pointer, set no
       new one. The old version tested `if (req.body.unitPlacement)`, so the
       empty option silently did nothing and a paper could never be unfiled
       through the form. placementRaw === null means the field was not posted
       (exam), and placement is left completely alone. */
    if (placementRaw !== null) {
      const field = type === "quiz" ? "quizId" : "homeId";

      const oldDoc = await unit
        .getModel()
        .findOne({ [`units.${field}`]: paper._id });
      if (oldDoc) {
        const rows = Array.isArray(oldDoc.units) ? oldDoc.units : [];
        for (const row of rows) {
          if (row && row[field] && String(row[field]) === String(paper._id)) {
            row[field] = undefined;
          }
        }
        await oldDoc.save();
      }

      if (placement) {
        await unit.getModel().updateOne(
          { _id: placement.docId, "units._id": placement.rowId },
          { $set: { [`units.$.${field}`]: paper._id } }
        );
      }
    }

    /* One message, because this handler now does one thing. The old wording
       had to say how many questions it had added as well. */
    req.flash("editOk", `تم حفظ بيانات ${LABEL}.`);
    return res.redirect(back);
  } catch (err) {
    console.log(err);
    req.flash("editBad", "تعذّر الحفظ. حاول مرة أخرى.");
    return res.redirect(back);
  }
};

/* ======================================================================
   MANAGE QUESTIONS — /questionsOf<Kind>/:id

   The other half of the split. Everything here touches paper.quiz and nothing
   here touches a settings field, which is the mirror image of the guarantee
   above: managing questions cannot rename a paper, move it between lessons or
   change its window, because these handlers never write those fields.

   Four operations: add a batch, edit one, move one, delete one.

   THE THING TO UNDERSTAND BEFORE CHANGING ANY OF THEM.

   A student's answers and a teacher's marks are stored on the ATTEMPT, keyed by
   the question's POSITION in paper.quiz — degreeQuiz.writtenAnswers[].index and
   degreeQuiz.answers[].index, both documented as "the question's position in
   the paper's quiz array". Nothing anywhere stores a question's _id. So any
   edit that changes WHERE a question sits silently re-points every stored
   answer and every awarded mark at a different question.

   That was already true of deleting one. The old handler was a bare
   `$pull: { quiz: { _id } }`: deleting question 2 of 5 shifted 3→2, 4→3, 5→4,
   left every attempt untouched, and from then on the essay a teacher marked as
   question 4 was displayed and totalled as question 3. Nothing on any screen
   showed it, because every reader joins the paper to the marks by position and
   both sides looked internally consistent.

   Reorder would do the same, and more often. So both go through
   reindexAttempts below, and delete is no longer a $pull.
   ====================================================================== */

/* Remap every attempt's stored answers and marks after questions have moved.

   `map` is oldPosition -> newPosition, one entry per question in the paper as
   it was BEFORE the change, with null meaning "this question is gone". A pure
   reorder passes a permutation; a delete passes null at one slot.

   Called after the paper is written, not before: if it throws, the paper has
   moved and the attempts have not, which is the same state the old $pull left
   behind and is recoverable by re-running. Doing it first would risk the
   opposite — attempts remapped for a change to the paper that never landed. */
const reindexAttempts = async (paperId, type, map) => {
  const attempts = await degreeModel.find({ quiz: paperId, type: type });

  for (const att of attempts) {
    let touched = false;
    let dropped = false;

    /* Rebuilt as plain objects rather than mutated in place, because rows also
       have to be DROPPED and reassigning the array is the one operation that
       does both. `_id` is carried across with everything else — the rows are
       spread wholesale, so a field added to the schema later comes along
       without this helper needing to hear about it. */
    const remap = (rows) => {
      const out = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const plain = typeof row.toObject === "function" ? row.toObject() : row;
        const from = Number(plain.index);

        /* A row whose index is not a position in the paper as it stood. Kept
           exactly as it is: util/grading.collectMarks already preserves rows
           "the paper no longer asks about" verbatim, and inventing a new index
           for one would be a guess about which question it belonged to. */
        if (!Number.isInteger(from) || from < 0 || from >= map.length) {
          out.push(plain);
          continue;
        }

        const to = map[from];
        if (to === null || to === undefined) {
          /* The question this answer belongs to no longer exists. The row goes
             with it — leaving it behind would make it collide with whichever
             question shifted into that position. */
          touched = true;
          dropped = true;
          continue;
        }

        if (to !== from) {
          plain.index = to;
          touched = true;
        }
        out.push(plain);
      }
      /* Ascending, so the stored order matches the paper's. Readers look up by
         `index` and must not depend on this, but a document whose rows read in
         paper order is very much easier to debug. */
      out.sort((a, b) => Number(a.index) - Number(b.index));
      return out;
    };

    const written = remap(att.writtenAnswers);
    const picked = remap(att.answers);
    if (!touched) continue;

    /* Counted BEFORE the arrays are replaced. `picked` no longer contains the
       dropped rows — that is the point of it — so the auto marks being lost can
       only be counted off the array as it still stands. */
    let lostAuto = 0;
    if (dropped) {
      for (const row of Array.isArray(att.answers) ? att.answers : []) {
        if (!row || !row.correct) continue;
        const from = Number(row.index);
        if (!Number.isInteger(from) || from < 0 || from >= map.length) continue;
        if (map[from] === null || map[from] === undefined) lostAuto++;
      }
    }

    att.writtenAnswers = written;
    att.answers = picked;

    if (dropped) {
      /* manualDegree is a cache — it is written at submit/marking time and
         util/grading.totalsOf() recomputes the real figure from the paper and
         the rows, so nothing on any screen reads it. Recomputed anyway, from
         the rows that survived: a stale cache that disagrees with every screen
         is a trap for whoever reads the document next. The scores were already
         clamped to each question's maxScore when they were awarded, so this is
         a plain sum.

         Left ABSENT if it was absent — "no marks have been given" is a real
         state on this document, and writing 0 for it would read as a teacher
         having awarded zero. */
      if (att.manualDegree != null) {
        att.manualDegree = written.reduce(
          (sum, r) => sum + (r.score == null ? 0 : Number(r.score) || 0),
          0
        );
      }

      /* totalDegree is the AUTO score, and unlike manualDegree it is read
         everywhere — with a denominator recomputed live as
         questionTypes.autoGradableCount(). Deleting an auto-graded question the
         student got right therefore shrinks the denominator and leaves the
         numerator too big: 5/4.

         Adjusted only where the evidence is on the document. `answers` records
         one row per auto-graded question with the verdict as it stood at submit
         time, so a dropped row that says correct:true is exactly one mark to
         take off. Attempts submitted before that field existed have an EMPTY
         answers array — there is nothing to adjust from, and recomputing the
         score from it would zero them — so they are left alone and keep the
         numerator they always had.

         A null totalDegree is never touched: it is the platform's "started but
         not submitted" sentinel, tested by quiz.router.js, homework.router.js,
         the alreadyTaken checks and the answer-key gate. Writing a number over
         it would mark an abandoned attempt as handed in. */
      if (lostAuto && att.totalDegree != null) {
        const beforeScore = Number(att.totalDegree);
        if (isFinite(beforeScore)) {
          att.totalDegree = String(Math.max(0, beforeScore - lostAuto));
        }
      }
    }

    await att.save();
  }
};

/* Find a question by _id and report WHERE it is, because the position is what
   the attempts are keyed by and every caller needs it. -1 when absent — a
   stale link from a page left open while the question was deleted elsewhere,
   which is a "that question is gone" message and not a 500. */
const questionPos = (paper, id) => {
  const list = Array.isArray(paper.quiz) ? paper.quiz : [];
  return list.findIndex((q) => q && String(q._id) === String(id));
};

/* paper.quiz as plain objects, renumbered so `no` is the position again.

   `no` is display-only — every reader, from views/quiz-paper.ejs to the
   grader, works in positions and ignores it — but parseQuestions writes it as
   the position, and a paper whose stored numbers say 1,2,4,5 after a delete
   invites the next reader to trust them. Kept honest here rather than trusted
   anywhere. */
const renumbered = (paper) => {
  const list = Array.isArray(paper.quiz) ? paper.quiz : [];
  return list.map((q, i) => {
    const plain = typeof q.toObject === "function" ? q.toObject() : q;
    plain.no = String(i + 1);
    return plain;
  });
};

const questionsGet = (type) => async (req, res, next) => {
  try {
    const paper = await model.findOne({ _id: req.params.id, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

    const okFlash = req.flash("qOk");
    const badFlash = req.flash("qBad");
    const formFlash = req.flash("qForm");

    /* WHICH question is open for editing, as ?edit=<questionId>.

       A query parameter rather than a route of its own, because editing one
       question is a state of this page and not a different page: the list stays
       on screen around the open block, so the admin can see where the question
       they are changing sits. Shape-checked here so a junk value cannot reach
       the view, and resolved to a POSITION as well as an id — the view needs
       the position to label the block "السؤال 3".

       An id that no longer matches anything resolves to -1 and the view simply
       renders no open block. That is the stale-link case: the question was
       deleted in another tab, and the honest answer is the list without it. */
    let editId = typeof req.query.edit === "string" ? req.query.edit.trim() : "";
    if (!/^[0-9a-f]{24}$/i.test(editId)) editId = "";
    const editIndex = editId ? questionPos(paper, editId) : -1;

    res.render(`admin/questions${type}.ejs`, {
      kind: type,
      data: paper,
      question: Array.isArray(paper.quiz) ? paper.quiz : [],
      editId: editIndex === -1 ? "" : editId,
      editIndex: editIndex,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      flashOk: okFlash.length ? okFlash[0] : "",
      flashBad: badFlash.length ? badFlash[0] : "",
      formData: formFlash.length ? formFlash[0] : "",
      maxQuestions: MAX_QUESTIONS,
      /* The question-type vocabulary and the Explain mark bounds, for
         _question-block.ejs. Spread rather than required in the template: EJS
         cannot require(). This is the page they belong to. */
      ...qt.viewLocals(),
      ...gr.viewLocals(),
    });
  } catch (err) {
    next(err);
  }
};

/* Add a batch. Same builder and same parseQuestions the add-paper form uses,
   so a question typed here and a question typed there cannot be validated
   differently — that divergence is what the combined edit form was originally
   written to fix, and splitting the pages must not reintroduce it.

   allowEmpty is false: on a form whose only job is to add questions, an empty
   submission is a mistake worth reporting, not a no-op to absorb. */
const addQuestionsPost = (type) => async (req, res) => {
  const back = `${QUESTIONS_PATH[type]}/${req.params.id}`;
  const LABEL = KIND_LABEL[type];

  try {
    const paper = await model.findOne({ _id: req.params.id, type: type });
    if (!paper) {
      discardUploads(req);
      return res.redirect(`/admin/${type}`);
    }

    const existing = Array.isArray(paper.quiz) ? paper.quiz.length : 0;
    const parsed = parseQuestions(req, { startNo: existing + 1 });

    if (parsed.error) {
      discardUploads(req);
      req.flash("qForm", {
        questions: Array.isArray(parsed.echo) ? parsed.echo : [],
      });
      req.flash("qBad", parsed.error);
      return res.redirect(back);
    }

    /* $push only. The questions are APPENDED, so no existing question changes
       position and no attempt needs remapping — which is why this is the one
       operation of the four that does not call reindexAttempts. */
    await model.updateOne(
      { _id: paper._id },
      { $push: { quiz: { $each: parsed.questions } } }
    );

    const added = parsed.questions.length;
    req.flash("qOk", `تم إضافة ${added} سؤالًا إلى ${LABEL}.`);
    return res.redirect(back);
  } catch (err) {
    discardUploads(req);
    console.log(err);
    req.flash("qBad", "تعذّر الحفظ. حاول مرة أخرى.");
    return res.redirect(back);
  }
};

/* Edit ONE question, in place. :i is the paper, :id is the question — the
   order the existing remove route already uses. */
const editQuestionPost = (type) => async (req, res) => {
  const back = `${QUESTIONS_PATH[type]}/${req.params.i}`;

  try {
    const paper = await model.findOne({ _id: req.params.i, type: type });
    if (!paper) {
      discardUploads(req);
      return res.redirect(`/admin/${type}`);
    }

    const pos = questionPos(paper, req.params.id);
    if (pos === -1) {
      discardUploads(req);
      req.flash("qBad", "هذا السؤال غير موجود. ربما تم حذفه.");
      return res.redirect(back);
    }

    const current = paper.quiz[pos];

    /* The view renders the open block with i:0, so parseQuestions finds exactly
       one. startNo is the question's own position, so `no` comes back as the
       number it already had. */
    const parsed = parseQuestions(req, { startNo: pos + 1 });

    const reject = (message) => {
      discardUploads(req);
      req.flash("qForm", {
        questions: Array.isArray(parsed.echo) ? parsed.echo : [],
      });
      req.flash("qBad", message);
      /* Back to this question still open, so the admin lands on what they were
         typing rather than on the list with their edit lost. */
      return res.redirect(`${back}?edit=${req.params.id}`);
    };

    if (parsed.error) {
      return reject(parsed.error);
    }
    /* Zero means every field was blank, which parseQuestions treats as a block
       the admin never filled in and skips. On the add form that is right — a
       trailing empty block is how the builder works. Editing an existing
       question and clearing it is not the same thing, and must not silently
       leave the stored question as it was while reporting success. */
    if (parsed.questions.length !== 1) {
      return reject("اكتب نص السؤال.");
    }

    const next = parsed.questions[0];

    /* _id CARRIED OVER, and this is not optional. $set of a whole array
       element replaces it with exactly the object given, and a subdocument
       written through a raw update does not get an _id generated for it — so
       omitting this would leave the question with no _id, and every edit,
       move and delete link on the page is built from that _id. The question
       would become uneditable and undeletable through the UI. */
    next._id = current._id;

    /* An image is REPLACED only if a new file came with this submission.
       parseQuestions reports no upload as "", and writing that would silently
       drop the picture of a question whose text was being fixed — a browser
       cannot prefill <input type=file>, so every save would clear it.

       The replaced file is deliberately NOT unlinked. It is a file this request
       did not create, and deleting one on the assumption that nothing else
       references it is the kind of guess that loses data; an orphan in images/
       costs disk and nothing else. (discardUploads is the opposite case — files
       this very request just wrote, which are safe to remove.) */
    if (!next.image) {
      next.image = current.image || "";
    }

    /* One element, by position, and nothing else on the document is named — so
       this cannot reach a settings field, and it cannot move a question either.
       Positions are unchanged, so no attempt needs remapping: the answers and
       marks stored against position `pos` still belong to the question at
       position `pos`.

       What DOES change under them is the question's content. That is
       deliberate and unavoidable — editing a question after it has been sat is
       the admin asking for exactly that — and the platform already records
       enough not to rewrite history: degreeQuiz.answers stores the option TEXT
       the student picked and the verdict AS RECORDED AT SUBMIT TIME, so fixing
       a typo in an option cannot retroactively mark a past attempt wrong. */
    await model.updateOne(
      { _id: paper._id },
      { $set: { [`quiz.${pos}`]: next } }
    );

    req.flash("qOk", `تم تعديل السؤال ${pos + 1}.`);
    return res.redirect(back);
  } catch (err) {
    discardUploads(req);
    console.log(err);
    req.flash("qBad", "تعذّر الحفظ. حاول مرة أخرى.");
    return res.redirect(back);
  }
};

/* Move one question up or down. A swap with its neighbour rather than a
   drag-to-position, because the order is what the attempts are keyed by: one
   swap is one two-entry permutation, which is trivially auditable, and it needs
   no JavaScript to work. */
const moveQuestionPost = (type) => async (req, res) => {
  const back = `${QUESTIONS_PATH[type]}/${req.params.i}`;

  try {
    const paper = await model.findOne({ _id: req.params.i, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

    const pos = questionPos(paper, req.params.id);
    if (pos === -1) {
      req.flash("qBad", "هذا السؤال غير موجود. ربما تم حذفه.");
      return res.redirect(back);
    }

    /* Whitelisted, not trusted: the two buttons post "up" or "down" and
       anything else is a hand-built request. `typeof === "string"` also
       rejects the array a repeated key would produce. */
    const dir = typeof req.body.dir === "string" ? req.body.dir : "";
    if (dir !== "up" && dir !== "down") {
      return res.redirect(back);
    }

    const target = dir === "up" ? pos - 1 : pos + 1;
    const list = renumbered(paper);
    if (target < 0 || target >= list.length) {
      /* Already at the end it is being moved towards. The buttons are disabled
         there, but disabled is a browser courtesy and absent from a hand-built
         POST. Silent, because nothing is wrong — the order is already what was
         asked for. */
      return res.redirect(back);
    }

    const swap = list[pos];
    list[pos] = list[target];
    list[target] = swap;
    /* Renumbered AGAIN after the swap: renumbered() stamped `no` from the
       positions the questions had before it. */
    for (let i = 0; i < list.length; i++) list[i].no = String(i + 1);

    await model.updateOne({ _id: paper._id }, { $set: { quiz: list } });

    /* The permutation, as oldPosition -> newPosition. Identity everywhere
         except the two that traded places. */
    const map = list.map((_, i) => i);
    map[pos] = target;
    map[target] = pos;
    await reindexAttempts(paper._id, type, map);

    req.flash("qOk", `تم نقل السؤال إلى الموضع ${target + 1}.`);
    return res.redirect(back);
  } catch (err) {
    console.log(err);
    req.flash("qBad", "تعذّر النقل. حاول مرة أخرى.");
    return res.redirect(back);
  }
};

/* Removing one question from a paper. Was a GET link on all three routers, so
   a crawler, a link prefetch or a mis-click deleted a question with no
   confirmation and no CSRF token.

   No longer a `$pull`. $pull shifts every later question down one and leaves
   the attempts alone, so every stored answer and every awarded mark after the
   deleted question ends up displayed and totalled against the wrong question —
   see the block comment at the top of this section. The paper is rewritten
   without the question and the attempts are remapped to match. */
const removeQuestion = (type) => async (req, res, next) => {
  const back = `${QUESTIONS_PATH[type]}/${req.params.i}`;

  try {
    const paper = await model.findOne({ _id: req.params.i, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

    const pos = questionPos(paper, req.params.id);
    if (pos === -1) {
      /* Already gone — a double submit, or the same question deleted in
         another tab. The end state is the one that was asked for, so this is
         not an error. */
      return res.redirect(back);
    }

    const before = renumbered(paper);
    const list = before.filter((_, i) => i !== pos);
    for (let i = 0; i < list.length; i++) list[i].no = String(i + 1);

    await model.updateOne({ _id: paper._id }, { $set: { quiz: list } });

    /* null at the deleted slot, and everything after it shifted down one. */
    const map = before.map((_, i) => (i === pos ? null : i < pos ? i : i - 1));
    await reindexAttempts(paper._id, type, map);

    req.flash("qOk", `تم حذف السؤال ${pos + 1}.`);
    return res.redirect(back);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  addQuiz,
  getQuiz,
  postQuizApp,
  g,
  getOpenQuiz,
  startQuiz,
  /* The paper's own settings — /editQuiz/:id and friends. */
  editPaperGet,
  editPaperPost,
  /* Its questions — /questionsOfQuiz/:id and friends. */
  questionsGet,
  addQuestionsPost,
  editQuestionPost,
  moveQuestionPost,
  removeQuestion,
};

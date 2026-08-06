const model = require("../models/quiz");
const user = require("../models/user");
const unit = require("../models/unit");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const degreeModel = require("../models/degreeQuiz");

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
    const answers = [];
    for (let c = 0; c < 4; c++) {
      answers.push(String(body[`q_${i}_a${c}`] || "").trim());
    }
    const correctRaw = body[`q_${i}_correct`];
    const correct =
      correctRaw === undefined || correctRaw === null || correctRaw === ""
        ? -1
        : Number(correctRaw);

    echo.push({
      question: text,
      answers: answers,
      correct: correct >= 0 && correct <= 3 ? correct : "",
    });

    const pos = echo.length; // what the admin sees, 1-based

    const blank = !text && answers.every((a) => a === "") && correct < 0;
    if (blank) {
      echo.pop();
      continue;
    }

    if (!text) {
      return { error: `السؤال ${pos}: اكتب نص السؤال.`, echo: echo };
    }
    if (answers.some((a) => a === "")) {
      return { error: `السؤال ${pos}: اكتب الاختيارات الأربعة كاملة.`, echo: echo };
    }

    /* Two identical choices make the question unanswerable-as-intended: the
       answer key is stored as text and postQuizApp compares text, so a student
       picking either copy is marked correct. */
    const unique = new Set(answers);
    if (unique.size !== answers.length) {
      return {
        error: `السؤال ${pos}: لا يمكن تكرار نفس الاختيار مرتين.`,
        echo: echo,
      };
    }

    if (!(correct >= 0 && correct <= 3)) {
      return { error: `السؤال ${pos}: علّم الإجابة الصحيحة.`, echo: echo };
    }

    questions.push({
      image: filesBy[`q_${i}_image`] || "",
      /* Position, not a number the admin picks. The old form had a select
         going up to 30 that let any question claim any number, including one
         already used, while the student paper reads questions by array
         position and ignores `no` entirely. */
      no: String(startNo + questions.length),
      question: text,
      /* Array of arrays — models/quiz.js declares `answer: [Array]` and
         views/quiz-paper.ejs reads q.answer[0]. Do not flatten. */
      answer: [answers],
      correctAnswer: answers[correct],
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
    startTime: req.body.startTime || "",
    endTime: req.body.endTime || "",
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
      quiz: questions,
      unit: place.unit,
      month: place.month,
      type: type,
      quizTime: quizTime,
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

/* quizTime is stored as "HH:MM" — one budget for the whole paper, not per
   question. Returns seconds, or null when unusable. The old arithmetic went via
   setHours(getHours() + hh, getMinutes() + mm) and a Date subtraction, which
   silently produced NaN for an empty or malformed quizTime. */
const allowanceSeconds = (quizTime) => {
  if (!quizTime) return null;
  const parts = String(quizTime).split(":");
  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const secs = (isNaN(hh) ? 0 : hh) * 3600 + (isNaN(mm) ? 0 : mm) * 60;
  return secs > 0 ? secs : null;
};

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

    const total = allowanceSeconds(data.quizTime);
    let secondsLeft = null;
    if (attempt.deadline) {
      /* Clamped at 0: a reopened expired attempt gets a stopped clock and an
         automatic submit, not a negative countdown. Attempts created before
         the deadline field existed have none and fall back to untimed. */
      secondsLeft = Math.max(
        0,
        Math.floor((attempt.deadline.getTime() - Date.now()) / 1000)
      );
    }

    res.render("quiz-paper.ejs", {
      kind: "exam",
      paper: data,
      secondsLeft: secondsLeft,
      totalSeconds: total,
      alreadyTaken: attempt.totalDegree != null,
      backHref: "/openExam",
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
    let count = 0;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const data = await model.findOne({
      _id: name,
    });
    /* `i` was assigned with no declaration, making it an implicit global shared
       by every concurrent submission — and the loop body awaits nothing, but
       the handler does, so two overlapping submissions could interleave. The
       per-question console.log of the correct answer went too: it printed the
       answer key to the server log on every submit. */
    for (let i = 0; i < data["quiz"].length; i++) {
      if (req.body[`answer${i}`] == data["quiz"][i].correctAnswer) {
        count++;
      }
    }
    const checkCount = await degreeModel.findOne({
      /* `data.id` before — the mongoose virtual, inconsistent with the
         `data._id` used in the update below. */
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "exam",
    });
    if (checkCount && checkCount.totalDegree == null) {
      let up = await degreeModel.findOneAndUpdate(
        {
          quiz: data._id,
          student: student.studentCard,
          isCheck: "1",
          type: "exam",
        },
        { totalDegree: count }
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
   EDIT AN EXISTING PAPER

   Replaces three near-identical handlers (one per router) that each had
   the same two bugs.

   1. THEY WERE EITHER/OR. The body was one if/else: if any meta field
      differed from what was stored, update the meta and ignore the
      question entirely; otherwise append the question. An admin who
      fixed a typo in the name AND filled in a question in the same
      submission — which the single form invited — silently lost the
      question. Both halves run now.

   2. ONE QUESTION PER SUBMISSION, and its answer key was a free-text box
      that had to match one of the four choices character-for-character.
      Same builder as the add form now: many questions at once, answer
      key picked with a radio.

   Also fixed here: the subject select offered "Secondary"/"Preparatory"
   while every paper, every student record and every query uses
   "biology"/"geology" — saving the edit form unchanged wrote a value
   that matched nothing, and the paper stopped appearing in the lists it
   belonged to.
   ====================================================================== */

const EDIT_PATH = {
  homework: "/editHomework",
  quiz: "/editQuiz",
  exam: "/editExam",
};

const KIND_LABEL = { quiz: "الكويز", exam: "الامتحان", homework: "الواجب" };
const GRADES = ["1st", "2nd", "3rd"];

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
      question: Array.isArray(paper.quiz) ? paper.quiz : [],
      units: units,
      currentUnit: currentUnitValue,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      flashOk: okFlash.length ? okFlash[0] : "",
      flashBad: badFlash.length ? badFlash[0] : "",
      formData: formFlash.length ? formFlash[0] : "",
    });
  } catch (err) {
    next(err);
  }
};

const editPaperPost = (type) => async (req, res) => {
  const back = `${EDIT_PATH[type]}/${req.params.id}`;
  const LABEL = KIND_LABEL[type];

  try {
    const paper = await model.findOne({ _id: req.params.id, type: type });
    if (!paper) {
      discardUploads(req);
      return res.redirect(`/admin/${type}`);
    }

    const existing = Array.isArray(paper.quiz) ? paper.quiz.length : 0;

    /* Questions are optional here — this form doubles as the paper's own
       settings form, and saving a renamed paper with no new question is a
       normal thing to do. */
    const parsed = parseQuestions(req, {
      startNo: existing + 1,
      allowEmpty: true,
    });

    const reject = (message) => {
      discardUploads(req);
      req.flash("editForm", {
        educetionlevel: req.body.educetionlevel || "",
        grade: req.body.grade || "",
        nameQuiz: req.body.nameQuiz || "",
        unitPlacement: req.body.unitPlacement || "",
        startTime: req.body.startTime || "",
        endTime: req.body.endTime || "",
        quizTime: req.body.quizTime || "",
        questions: Array.isArray(parsed.echo) ? parsed.echo : [],
      });
      req.flash("editBad", message);
      return res.redirect(back);
    };

    const nameQuiz = (req.body.nameQuiz || "").trim();
    if (!nameQuiz) {
      return reject(`اكتب اسم ${LABEL}.`);
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

    if (parsed.error) {
      return reject(parsed.error);
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

    if (type === "exam") {
      meta.startTime = req.body.startTime || "";
      meta.endTime = req.body.endTime || "";
      meta.quizTime = cleanQuizTime(req.body.quizTime);
    }
    /* Quiz duration is deliberately NOT written here. The quiz edit form no
       longer carries the field, and cleanQuizTime(undefined) returns "" — so
       an unguarded assignment would untime every quiz on every save, the same
       silent loss the old value="hh:mm" default used to cause. Duration is
       set on the add form; restoring the field to _edit-paper.ejs and this
       assignment with it makes it editable again. */

    /* month and unit on the paper are copies of the lesson row's labels, not
       independently typed values. quizBackHref in routes/quiz.router.js
       builds its redirect out of paper.month, and the homework list falls
       back to it, so they follow the placement. */
    if (placement) {
      meta.month = placement.month;
      meta.unit = placement.unit;
    }

    const update = { $set: meta };
    const added = parsed.questions.length;
    if (added) {
      update.$push = { quiz: { $each: parsed.questions } };
    }

    await model.updateOne({ _id: paper._id }, update);

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

    req.flash(
      "editOk",
      added
        ? `تم حفظ ${LABEL} وإضافة ${added} سؤالًا.`
        : `تم حفظ بيانات ${LABEL}.`
    );
    return res.redirect(back);
  } catch (err) {
    discardUploads(req);
    console.log(err);
    req.flash("editBad", "تعذّر الحفظ. حاول مرة أخرى.");
    return res.redirect(back);
  }
};

/* Removing one question from a paper. Was a GET link on all three routers,
   so a crawler, a link prefetch or a mis-click deleted a question with no
   confirmation and no CSRF token. */
const removeQuestion = (type) => async (req, res, next) => {
  try {
    await model.updateOne(
      { _id: req.params.i, type: type },
      { $pull: { quiz: { _id: req.params.id } } }
    );
    res.redirect(`${EDIT_PATH[type]}/${req.params.i}`);
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
  editPaperGet,
  editPaperPost,
  removeQuestion,
};

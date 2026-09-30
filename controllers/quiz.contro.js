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

const cleanStamp = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : "";
};

const MAX_DESCRIPTION = 500;

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

  const filesBy = {};
  for (const f of Array.isArray(req.files) ? req.files : []) {
    if (f && f.fieldname) filesBy[f.fieldname] = f.path;
  }

  const questions = [];
  const echo = [];

  for (const i of indices) {
    const text = String(body[`q_${i}_question`] || "").trim();

    const qType = qt.typeOf({ qType: body[`q_${i}_type`] });

    const rawOptions = [];
    const optionIdx = [];
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
    const correctPos = correct < 0 ? -1 : optionIdx.indexOf(correct);

    const tfRaw = body[`q_${i}_tf`];
    const tf =
      tfRaw === undefined || tfRaw === null || tfRaw === "" ? -1 : Number(tfRaw);

    const modelAnswer = String(body[`q_${i}_model`] || "").trim();

    const maxRaw = String(body[`q_${i}_max`] == null ? "" : body[`q_${i}_max`]).trim();

    echo.push({
      type: qType,
      question: text,
      answers: rawOptions,
      correct: correctPos >= 0 && correctPos < rawOptions.length ? correctPos : "",
      tf: tf === 0 || tf === 1 ? tf : "",
      modelAnswer: modelAnswer,
      maxScore: maxRaw,
    });

    const pos = echo.length;

    let blank;
    if (qType === "explain") {
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

    let answers;
    let correctAnswer;
    let maxScore = gr.DEFAULT_EXPLAIN_POINTS;

    if (qType === "explain") {
      answers = [];
      correctAnswer = "";

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
      if (rawOptions.some((a) => a === "")) {
        return { error: `السؤال ${pos}: لا تترك اختيارًا فارغًا.`, echo: echo };
      }

      const unique = new Set(rawOptions);
      if (unique.size !== rawOptions.length) {
        return {
          error: `السؤال ${pos}: لا يمكن تكرار نفس الاختيار مرتين.`,
          echo: echo,
        };
      }

      if (!(correctPos >= 0 && correctPos < rawOptions.length)) {
        return { error: `السؤال ${pos}: علّم الإجابة الصحيحة.`, echo: echo };
      }

      answers = rawOptions;
      correctAnswer = rawOptions[correctPos];
    }

    questions.push({
      image: filesBy[`q_${i}_image`] || "",
      no: String(startNo + questions.length),
      question: text,
      qType: qType,
      answer: [answers],
      correctAnswer: correctAnswer,
      modelAnswer: qType === "explain" ? modelAnswer : "",
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

const discardUploads = (req) => {
  for (const f of Array.isArray(req.files) ? req.files : []) {
    if (f && f.path) fs.unlink(f.path, () => {});
  }
};

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

    const reject = (message) => {
      discardUploads(req);
      keepSubmission(req, parsed.echo);
      req.flash("addBad", message);
      return res.redirect(back);
    };

    if (!nameQuiz) {
      return reject(`اكتب اسم ${LABEL}.`);
    }

    const description = postedText(req.body.description) || "";
    if (description.length > MAX_DESCRIPTION) {
      return reject(`الوصف طويل جدًا — الحد ${MAX_DESCRIPTION} حرفًا.`);
    }

    if (parsed.error) {
      return reject(parsed.error);
    }

    const questions = parsed.questions;
    const quizTime = cleanQuizTime(req.body.quizTime);

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

    const place = await resolveUnitRef(req.body.unitRef);
    if (!place) {
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
      dueDate: type === "homework" ? cleanStamp(req.body.dueDate) : "",
    });
    await paper.save();

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
        csrfToken: req.csrfToken ? req.csrfToken() : "",
        flashOk: okFlash.length ? okFlash[0] : "",
        flashBad: badFlash.length ? badFlash[0] : "",
        formData: formFlash.length ? formFlash[0] : "",
        ...qt.viewLocals(),
        ...gr.viewLocals(),
      });
    } else {
      res.sendStatus(400);
    }
  } catch (err) {
    next(err);
  }
};

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
      return res.status(404).render("quiz-paper.ejs", {
        kind: "exam",
        paper: null,
        secondsLeft: null,
        totalSeconds: null,
        alreadyTaken: false,
        backHref: "/openExam",
      });
    }

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
    const secondsLeft = at.secondsLeft(attempt);

    res.render("quiz-paper.ejs", {
      kind: "exam",
      paper: data,
      secondsLeft: secondsLeft,
      totalSeconds: total,
      alreadyTaken: attempt.totalDegree != null,
      backHref: "/openExam",
      ...qt.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
};

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
    const graded = qt.gradeSubmission(data, req.body);
    const count = graded.count;
    const checkCount = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "exam",
    });
    if (checkCount && checkCount.totalDegree == null) {
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
    if (req.body.btn != "continue") {
      return res.redirect("/startQuiz/" + req.params.nameQuiz);
    }

    let name = req.params.nameQuiz;
    const qutime = await model.findOne({ _id: name, type: "exam" });
    if (!qutime) {
      return res.redirect("/openExam");
    }

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
        deadline: secs ? new Date(Date.now() + secs * 1000) : undefined,
      });
      await deg.save();

      res.redirect("/examApp/" + qutime._id);
    } else if (checkDegree.totalDegree == null) {
      res.redirect("/examApp/" + qutime._id);
    } else {
      res.redirect("/openExam");
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
};

const EDIT_PATH = {
  homework: "/editHomework",
  quiz: "/editQuiz",
  exam: "/editExam",
};

const QUESTIONS_PATH = {
  homework: "/questionsOfHomework",
  quiz: "/questionsOfQuiz",
  exam: "/questionsOfExam",
};

const KIND_LABEL = { quiz: "الكويز", exam: "الامتحان", homework: "الواجب" };
const GRADES = ["1st", "2nd", "3rd"];

const editPaperGet = (type) => async (req, res, next) => {
  try {
    const paper = await model.findOne({ _id: req.params.id, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

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
      return res.redirect(`/admin/${type}`);
    }

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

    const description = postedText(req.body.description);
    if (description !== null && description.length > MAX_DESCRIPTION) {
      return reject(`الوصف طويل جدًا — الحد ${MAX_DESCRIPTION} حرفًا.`);
    }

    let educetionlevel = paper.educetionlevel;
    let grade = paper.grade;

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

    if (typeof req.body.quizTime === "string") {
      meta.quizTime = cleanQuizTime(req.body.quizTime);
    }

    if (type === "homework" && typeof req.body.dueDate === "string") {
      meta.dueDate = cleanStamp(req.body.dueDate);
    }

    if (placement) {
      meta.month = placement.month;
      meta.unit = placement.unit;
    }

    await model.updateOne({ _id: paper._id }, { $set: meta });

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

    req.flash("editOk", `تم حفظ بيانات ${LABEL}.`);
    return res.redirect(back);
  } catch (err) {
    console.log(err);
    req.flash("editBad", "تعذّر الحفظ. حاول مرة أخرى.");
    return res.redirect(back);
  }
};


const reindexAttempts = async (paperId, type, map) => {
  const attempts = await degreeModel.find({ quiz: paperId, type: type });

  for (const att of attempts) {
    let touched = false;
    let dropped = false;

    const remap = (rows) => {
      const out = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const plain = typeof row.toObject === "function" ? row.toObject() : row;
        const from = Number(plain.index);

        if (!Number.isInteger(from) || from < 0 || from >= map.length) {
          out.push(plain);
          continue;
        }

        const to = map[from];
        if (to === null || to === undefined) {
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
      out.sort((a, b) => Number(a.index) - Number(b.index));
      return out;
    };

    const written = remap(att.writtenAnswers);
    const picked = remap(att.answers);
    if (!touched) continue;

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
      if (att.manualDegree != null) {
        att.manualDegree = written.reduce(
          (sum, r) => sum + (r.score == null ? 0 : Number(r.score) || 0),
          0
        );
      }

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

const questionPos = (paper, id) => {
  const list = Array.isArray(paper.quiz) ? paper.quiz : [];
  return list.findIndex((q) => q && String(q._id) === String(id));
};

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
      ...qt.viewLocals(),
      ...gr.viewLocals(),
    });
  } catch (err) {
    next(err);
  }
};

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

    const parsed = parseQuestions(req, { startNo: pos + 1 });

    const reject = (message) => {
      discardUploads(req);
      req.flash("qForm", {
        questions: Array.isArray(parsed.echo) ? parsed.echo : [],
      });
      req.flash("qBad", message);
      return res.redirect(`${back}?edit=${req.params.id}`);
    };

    if (parsed.error) {
      return reject(parsed.error);
    }
    if (parsed.questions.length !== 1) {
      return reject("اكتب نص السؤال.");
    }

    const next = parsed.questions[0];

    next._id = current._id;

    if (!next.image) {
      next.image = current.image || "";
    }

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

    const dir = typeof req.body.dir === "string" ? req.body.dir : "";
    if (dir !== "up" && dir !== "down") {
      return res.redirect(back);
    }

    const target = dir === "up" ? pos - 1 : pos + 1;
    const list = renumbered(paper);
    if (target < 0 || target >= list.length) {
      return res.redirect(back);
    }

    const swap = list[pos];
    list[pos] = list[target];
    list[target] = swap;
    for (let i = 0; i < list.length; i++) list[i].no = String(i + 1);

    await model.updateOne({ _id: paper._id }, { $set: { quiz: list } });

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

const removeQuestion = (type) => async (req, res, next) => {
  const back = `${QUESTIONS_PATH[type]}/${req.params.i}`;

  try {
    const paper = await model.findOne({ _id: req.params.i, type: type });
    if (!paper) {
      return res.redirect(`/admin/${type}`);
    }

    const pos = questionPos(paper, req.params.id);
    if (pos === -1) {
      return res.redirect(back);
    }

    const before = renumbered(paper);
    const list = before.filter((_, i) => i !== pos);
    for (let i = 0; i < list.length; i++) list[i].no = String(i + 1);

    await model.updateOne({ _id: paper._id }, { $set: { quiz: list } });

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
  editPaperGet,
  editPaperPost,
  questionsGet,
  addQuestionsPost,
  editQuestionPost,
  moveQuestionPost,
  removeQuestion,
};

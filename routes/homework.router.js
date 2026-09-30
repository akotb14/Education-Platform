const route = require("express").Router();
const model = require("../models/quiz");
const contro = require("../controllers/quiz.contro");
const user = require("../models/user");
const unit = require("../models/unit");
const isAdmin = require("../util/aurth");
const jwt = require("jsonwebtoken");
const degreeModel = require("../models/degreeQuiz");
const qt = require("../util/questionTypes");
const at = require("../util/attemptTime");
const { updateOne } = require("../models/user");
const { uploadImage: upload } = require("../middlewares/upload");
const csrfProtect = require("../util/csrf");
route.get("/openHomeWork", async (req, res) => {
  try {
    if (!req.cookies.student) {
      return res.redirect("/");
    }

    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const me = await user.findOne({ _id: student.studentCard });

    const papers = me
      ? await model.find({
          type: "homework",
          educetionlevel: me.educetionlevel,
          grade: me.grade,
        })
      : [];

    const degrees = await degreeModel.find({
      student: student.studentCard,
      type: "homework",
    });
    const byPaper = new Map();
    for (const d of degrees) {
      if (d.quiz) byPaper.set(String(d.quiz), d);
    }

    const unitDocs = await unit.getModel().find({ "units.homeId": { $ne: null } });
    const placement = new Map();
    for (const doc of unitDocs) {
      for (const row of doc.units || []) {
        if (row && row.homeId) {
          placement.set(String(row.homeId), { month: doc.month, unit: row.unit });
        }
      }
    }

    const SUBJECTS = { biology: "الأحياء", geology: "الجيولوجيا" };

    const items = papers.map((p) => {
      const id = String(p._id);
      const deg = byPaper.get(id);
      const where = placement.get(id) || {};
      const submitted = !!(deg && deg.totalDegree != null);

      return {
        id: id,
        name: p.nameQuiz,
        unit: where.unit || "",
        month: where.month || p.month || "",
        subject: SUBJECTS[p.educetionlevel] || "",
        total: Array.isArray(p.quiz) ? p.quiz.length : 0,
        state: "untimed",
        started: !!deg,
        submitted: submitted,
        score: submitted ? Number(deg.totalDegree) : null,
        opensAt: null,
        closesAt: null,
      };
    });

    res.render("assessment-list.ejs", { kind: "homework", items: items });
  } catch (err) {
    console.log(err);
    res.sendStatus(400);
  }
});

route.get("/homework/:name", async (req, res) => {
  try {
    const paper = await model.findOne({ _id: req.params.name, type: "homework" });

    let alreadyTaken = false;
    if (paper && req.cookies.student) {
      const student = jwt.verify(req.cookies.student, process.env.SecretPassword);
      const deg = await degreeModel.findOne({
        quiz: paper._id,
        student: student.studentCard,
        isCheck: "1",
        type: "homework",
        totalDegree: { $ne: null },
      });
      alreadyTaken = !!deg;
    }

    res.render("quiz-intro.ejs", {
      kind: "homework",
      paper: paper,
      alreadyTaken: alreadyTaken,
      backHref: "/openHomeWork",
    });
  } catch (err) {
    console.log(err);
    res.status(404).render("quiz-intro.ejs", {
      kind: "homework",
      paper: null,
      alreadyTaken: false,
      backHref: "/openHomeWork",
    });
  }
});
route.post("/homework/:name", async (req, res) => {
  try {
    if (req.body.btn != "continue") {
      return res.redirect("/homework/" + req.params.name);
    }

    let name = req.params.name;
    const qutime = await model.findOne({ _id: name, type: "homework" });
    if (!qutime) {
      return res.redirect("/openHomeWork");
    }

    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const checkDegree = await degreeModel.findOne({
      isCheck: "1",
      quiz: qutime._id,
      student: student.studentCard,
      type: "homework",
    });

    if (!checkDegree) {
      const deg = new degreeModel({
        isCheck: "1",
        quiz: qutime._id,
        student: student.studentCard,
        totalDegree: null,
        type: "homework",
      });
      await deg.save();

      res.redirect("/homeworkApp/" + qutime._id);
    } else if (checkDegree.totalDegree == null) {
      res.redirect("/homeworkApp/" + qutime._id);
    } else {
      res.redirect("/openHomeWork");
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});
route.post("/homeworkApp/:nameQuiz", async (req, res) => {
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
      type: "homework",
    });
    if (checkCount && checkCount.totalDegree == null) {
      const late = at.lateFields(checkCount);

      let up = await degreeModel.findOneAndUpdate(
        {
          quiz: data._id,
          student: student.studentCard,
          isCheck: "1",
          type: "homework",
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
    return res.redirect("/openHomeWork");
  } catch (err) {
    res.redirect("/openHomeWork");
      console.log(err);
  }
})

route.get("/homeworkApp/:nameQuiz", async (req, res) => {
  try {
    let id = req.params.nameQuiz;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const data = await model.findOne({ _id: id, type: "homework" });
    if (!data) {
      return res.status(404).render("quiz-paper.ejs", {
        kind: "homework",
        paper: null,
        secondsLeft: null,
        totalSeconds: null,
        alreadyTaken: false,
        backHref: "/openHomeWork",
      });
    }

    const attempt = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "homework",
    });
    if (!attempt) {
      return res.redirect("/homework/" + data._id);
    }

    res.render("quiz-paper.ejs", {
      kind: "homework",
      paper: data,
      secondsLeft: null,
      totalSeconds: null,
      alreadyTaken: attempt.totalDegree != null,
      backHref: "/openHomeWork",
      ...qt.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});
route.get("/editHomework/:id", csrfProtect, isAdmin, contro.editPaperGet("homework"));

route.post(
  "/editHomework/:id",
  csrfProtect,
  isAdmin,
  contro.editPaperPost("homework")
);
route.post("/removeHomework/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findOneAndDelete({ _id: req.params.id });

    const unid = await unit.getModel().findOne({ "units.homeId": req.params.id });
    if (unid && Array.isArray(unid.units)) {
      for (const row of unid.units) {
        if (row && String(row.homeId) === String(req.params.id)) {
          row.homeId = undefined;
        }
      }
      await unid.save();
    }

    await degreeModel.deleteMany({ quiz: req.params.id, type: "homework" });

    res.redirect("/admin/homework");
  } catch (err) {
    next(err);
  }
});
route.get(
  "/questionsOfHomework/:id",
  csrfProtect,
  isAdmin,
  contro.questionsGet("homework")
);

route.post(
  "/addQuestionsOfHomework/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.addQuestionsPost("homework")
);

route.post(
  "/editQuestionOfHomework/:i/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.editQuestionPost("homework")
);

route.post(
  "/moveQuestionOfHomework/:i/:id",
  csrfProtect,
  isAdmin,
  contro.moveQuestionPost("homework")
);

route.post(
  "/removeQuestionOfHomework/:i/:id",
  csrfProtect,
  isAdmin,
  contro.removeQuestion("homework")
);

module.exports = route;

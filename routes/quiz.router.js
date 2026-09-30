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
const router = require("./login.router");
const { uploadImage: upload } = require("../middlewares/upload");
const csrfProtect = require("../util/csrf");
const quizBackHref = (paper) =>
  paper && paper.educetionlevel && paper.grade && paper.month
    ? "/lessons/" +
      encodeURIComponent(paper.educetionlevel) +
      "/" +
      encodeURIComponent(paper.grade) +
      "/" +
      encodeURIComponent(paper.month)
    : "/";

route.get("/quiz/:name", async (req, res) => {
  try {
    const paper = await model.findOne({ _id: req.params.name, type: "quiz" });

    let alreadyTaken = false;
    if (paper && req.cookies.student) {
      const student = jwt.verify(req.cookies.student, process.env.SecretPassword);
      const deg = await degreeModel.findOne({
        quiz: paper._id,
        student: student.studentCard,
        isCheck: "1",
        type: "quiz",
        totalDegree: { $ne: null },
      });
      alreadyTaken = !!deg;
    }

    res.render("quiz-intro.ejs", {
      kind: "quiz",
      paper: paper,
      alreadyTaken: alreadyTaken,
      backHref: quizBackHref(paper),
    });
  } catch (err) {
    console.log(err);
    res.status(404).render("quiz-intro.ejs", {
      kind: "quiz",
      paper: null,
      alreadyTaken: false,
      backHref: "/",
    });
  }
});

route.get('/quiz',(req,res)=>{
  res.status(404).send("no quiz is added now")
})

const allowanceSeconds = at.allowanceSeconds;

route.post("/quiz/:name", async (req, res) => {
  try {
    if (req.body.btn != "continue") {
      return res.redirect("/quiz/" + req.params.name);
    }

    let name = req.params.name;
    const qutime = await model.findOne({ _id: name, type: "quiz" });
    if (!qutime) {
      return res.redirect("/");
    }

    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const checkDegree = await degreeModel.findOne({
      isCheck: "1",
      quiz: qutime._id,
      student: student.studentCard,
      type: "quiz",
    });

    if (!checkDegree) {
      const secs = allowanceSeconds(qutime.quizTime);
      const deg = new degreeModel({
        isCheck: "1",
        quiz: qutime._id,
        student: student.studentCard,
        totalDegree: null,
        type: "quiz",
        deadline: secs ? new Date(Date.now() + secs * 1000) : undefined,
      });
      await deg.save();

      res.redirect("/quizApp/" + qutime._id);
    } else if (checkDegree.totalDegree == null) {
      res.redirect("/quizApp/" + qutime._id);
    } else {
      res.redirect(quizBackHref(qutime));
    }
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});
route.post("/quizApp/:nameQuiz", async (req, res) => {
  let data = null;
  try {
    let name = req.params.nameQuiz;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    data = await model.findOne({
      _id: name,
    });
    const graded = qt.gradeSubmission(data, req.body);
    const count = graded.count;
    const checkCount = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "quiz",
    });
    if (checkCount && checkCount.totalDegree == null) {
      const late = at.lateFields(checkCount);

      await degreeModel.findOneAndUpdate(
        {
          quiz: data._id,
          student: student.studentCard,
          isCheck: "1",
          type: "quiz",
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
    return res.redirect(quizBackHref(data));
  } catch (err) {
    console.log(err);
    res.redirect(quizBackHref(data));
  }
});


route.get("/quizApp/:nameQuiz", async (req, res) => {
  try {
    let id = req.params.nameQuiz;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const data = await model.findOne({ _id: id, type: "quiz" });
    if (!data) {
      return res.status(404).render("quiz-paper.ejs", {
        kind: "quiz",
        paper: null,
        secondsLeft: null,
        totalSeconds: null,
        alreadyTaken: false,
        backHref: "/",
      });
    }

    const attempt = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "quiz",
    });
    if (!attempt) {
      return res.redirect("/quiz/" + data._id);
    }

    const total = allowanceSeconds(data.quizTime);
    const secondsLeft = at.secondsLeft(attempt);

    res.render("quiz-paper.ejs", {
      kind: "quiz",
      paper: data,
      secondsLeft: secondsLeft,
      totalSeconds: total,
      alreadyTaken: attempt.totalDegree != null,
      backHref: quizBackHref(data),
      ...qt.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});

route.get("/editQuiz/:id", csrfProtect, isAdmin, contro.editPaperGet("quiz"));

route.post("/editQuiz/:id", csrfProtect, isAdmin, contro.editPaperPost("quiz"));
route.post("/removeQuiz/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findOneAndDelete({ _id: req.params.id });

    const unid = await unit.getModel().findOne({ "units.quizId": req.params.id });
    if (unid && Array.isArray(unid.units)) {
      for (const row of unid.units) {
        if (row && String(row.quizId) === String(req.params.id)) {
          row.quizId = undefined;
        }
      }
      await unid.save();
    }

    await degreeModel.deleteMany({ quiz: req.params.id, type: "quiz" });

    res.redirect("/admin/quiz");
  } catch (err) {
    next(err);
  }
});
route.get(
  "/questionsOfQuiz/:id",
  csrfProtect,
  isAdmin,
  contro.questionsGet("quiz")
);

route.post(
  "/addQuestionsOfQuiz/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.addQuestionsPost("quiz")
);

route.post(
  "/editQuestionOfQuiz/:i/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.editQuestionPost("quiz")
);

route.post(
  "/moveQuestionOfQuiz/:i/:id",
  csrfProtect,
  isAdmin,
  contro.moveQuestionPost("quiz")
);

route.post(
  "/removeQuestionOfQuiz/:i/:id",
  csrfProtect,
  isAdmin,
  contro.removeQuestion("quiz")
);




route.get('/showQuiz',async(req,res)=>{
  try {
    if (!req.cookies.student) {
      return res.redirect("/");
    }

    const student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const papers = await model.find({
      educetionlevel: student.educetionlevel,
      grade: student.grade,
      type: "quiz",
    });

    const degrees = await degreeModel.find({
      student: student.studentCard,
      type: "quiz",
    });

    const byPaper = new Map();
    for (const d of degrees) {
      if (d.quiz) byPaper.set(String(d.quiz), d);
    }

    const SUBJECTS = { biology: "الأحياء", geology: "الجيولوجيا" };

    const items = papers.map((p) => {
      const id = String(p._id);
      const deg = byPaper.get(id);
      const submitted = !!(deg && deg.totalDegree != null);

      return {
        id: id,
        name: p.nameQuiz,
        unit: p.unit || "",
        month: p.month || "",
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

    res.render("assessment-list.ejs", { kind: "quiz", items: items });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
})
module.exports = route;

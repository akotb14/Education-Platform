const route = require("express").Router();
const quiz = require("../models/quiz");
const checkIsExamed = require("../models/degreeQuiz.js");
const jwt = require("jsonwebtoken");
const qt = require("../util/questionTypes");
const gr = require("../util/grading");

const BACK = {
  quiz: "/showQuiz",
  exam: "/openExam",
  homework: "/openHomeWork",
};

route.get("/showAnswer/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    const modalQuiz = await quiz.findOne({ _id: id });
    if (!modalQuiz) {
      return res.status(404).render("showAnswer.ejs", {
        data: null,
        score: null,
        outOf: null,
        needsReview: false,
        kind: "quiz",
        backHref: "/",
        isLocked: false,
      });
    }

    const degree = await checkIsExamed.findOne({
      quiz: modalQuiz._id,
      student: student.studentCard,
      isCheck: "1",
      totalDegree: { $ne: null },
    });

    if (!degree) {
      return res.status(403).render("showAnswer.ejs", {
        data: null,
        score: null,
        outOf: null,
        needsReview: false,
        kind: modalQuiz.type || "quiz",
        backHref: BACK[modalQuiz.type] || "/",
        isLocked: true,
      });
    }

    const gstatus = gr.statusOf(modalQuiz, degree);

    res.render("showAnswer.ejs", {
      data: modalQuiz,
      score: degree.totalDegree,
      outOf: qt.autoGradableCount(modalQuiz),
      needsReview: gstatus === gr.STATUS.PENDING || gstatus === gr.STATUS.PARTIAL,
      attempt: degree,
      kind: modalQuiz.type || "quiz",
      backHref: BACK[modalQuiz.type] || "/",
      isLocked: false,
      ...qt.viewLocals(),
      ...gr.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});

module.exports = route;

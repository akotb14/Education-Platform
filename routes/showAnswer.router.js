const route = require("express").Router();
const quiz = require("../models/quiz");
const checkIsExamed = require("../models/degreeQuiz.js");
const jwt = require("jsonwebtoken");
const qt = require("../util/questionTypes");
const gr = require("../util/grading");

/* Where a student goes back to after reading the key, by paper type. */
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
      /* Was res.send('no answer found') — a bare English string, HTTP 200. */
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

    /* THE GATE. This page prints every correct answer, and until now the route
       checked nothing beyond "is this cookie a valid JWT" — no degree record,
       no grade, no type. Verified live against a running server: a 1st-grade
       geology student received HTTP 200 and the full correct-answer list for a
       3rd-grade biology exam they had never sat, while that exam was still
       inside its start/end window and other students were taking it.

       The key is now reachable only from the student's own submitted attempt:
       a degreeQuiz for this student and this paper whose totalDegree is set.
       isCheck "1" means the attempt was started; totalDegree being non-null is
       what marks it as graded, which is the same test the app already uses
       everywhere else to decide whether an attempt is finished. */
    const degree = await checkIsExamed.findOne({
      quiz: modalQuiz._id,
      student: student.studentCard,
      isCheck: "1",
      totalDegree: { $ne: null },
    });

    if (!degree) {
      /* 403, not 404: the paper exists, this student may not read its key yet.
         Rendering the template's empty state rather than a bare status page so
         they get an explanation and a way back. */
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

    /* WHAT THE STUDENT IS TOLD ABOUT MARKING, derived rather than read off the
       flag. `needsReview` is written once at submit time and is never cleared,
       so a paper marked last week would still be telling the student their
       essays are "بانتظار التصحيح". statusOf recomputes from the paper's
       Explain questions against the marks actually stored on this attempt. */
    const gstatus = gr.statusOf(modalQuiz, degree);

    res.render("showAnswer.ejs", {
      data: modalQuiz,
      score: degree.totalDegree,
      /* Out of the questions the machine actually marked, not every question
         on the paper. A student who got all four auto-marked questions right
         on a five-question paper with one essay would otherwise read 4/5 —
         which looks like one wrong rather than one awaiting marking.

         This stays the AUTO score and the AUTO denominator. The combined
         total is derived in the view from `attempt` via totalsOf(), so the
         two numbers are never conflated in storage or in transit. */
      outOf: qt.autoGradableCount(modalQuiz),
      needsReview: gstatus === gr.STATUS.PENDING || gstatus === gr.STATUS.PARTIAL,
      /* The attempt itself, so the key can show each essay's awarded mark and
         the teacher's feedback beside the question it belongs to. Nothing on
         it is secret from its own owner: this handler has already proved the
         record belongs to this student. */
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

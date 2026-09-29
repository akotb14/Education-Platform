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
/* Configured in util/csrf.js rather than inline: the csrf({cookie:true}) default
   left the secret cookie script-readable and non-Secure. */
const csrfProtect = require("../util/csrf");
/* Where a quiz's exit / back link goes: the month's lesson list it belongs to.
   Falls back to the homepage when the paper has no placement. */
const quizBackHref = (paper) =>
  paper && paper.educetionlevel && paper.grade && paper.month
    ? "/lessons/" +
      encodeURIComponent(paper.educetionlevel) +
      "/" +
      encodeURIComponent(paper.grade) +
      "/" +
      encodeURIComponent(paper.month)
    : "/";

/* Quiz intro. Now fetches the paper so the page can name it and show the
   question count and duration, and checks for a finished attempt so a student
   who has already submitted sees a proper page rather than pressing the button
   and getting a bare 400 carrying "you cant entered quiz agian". */
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
    /* A bad :name is a CastError out of findOne. Render the view's
       not-available state rather than a bare status page. */
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

/* The "HH:MM" → seconds parse, and the remaining-time and late-submission
   arithmetic, all now live in util/attemptTime.js. This file and
   controllers/quiz.contro.js each carried their own byte-identical copy of the
   parse, which is how the three graders in this app drifted apart in the first
   place. */
const allowanceSeconds = at.allowanceSeconds;

route.post("/quiz/:name", async (req, res) => {
  try {
    /* The old handler had no else for this: pressing anything that did not post
       btn=continue fell off the end of the function with no response written,
       and the request hung until the browser timed out. */
    if (req.body.btn != "continue") {
      return res.redirect("/quiz/" + req.params.name);
    }

    let name = req.params.name;
    const qutime = await model.findOne({ _id: name, type: "quiz" });
    /* `qutime._id` was dereferenced before this existence check, so a stale or
       hand-typed id threw a TypeError and the catch answered a bare 404. */
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
        /* THE DEADLINE, on this student's own attempt. What used to happen
           instead: a module-level `let d` was set to the allowance and a
           setInterval decremented it once a second, forever, for the whole
           process. Every student's paper read that one number, so two
           concurrent attempts shared a clock, a third student opening a paper
           inherited the remainder of somebody else's, and a restart wiped it.
           The interval also outlived the response. */
        deadline: secs ? new Date(Date.now() + secs * 1000) : undefined,
      });
      await deg.save();

      res.redirect("/quizApp/" + qutime._id);
    } else if (checkDegree.totalDegree == null) {
      /* Started but never submitted — let them back in on their remaining time
         rather than answering 400 and the English string
         "you cant entered quiz agian", which the old code did for this case and
         a finished attempt alike. */
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
  /* Declared out here so the catch can use it. The old catch built its redirect
     from `data.educetionlevel`, but `data` was const-scoped inside the try — so
     any failure produced a ReferenceError inside the error handler itself, and
     the student got a 500 instead of the intended redirect. */
  let data = null;
  try {
    let name = req.params.nameQuiz;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    data = await model.findOne({
      _id: name,
    });
    /* One shared grader, in util/questionTypes.js. This loop existed in three
       near-identical copies — here, homework.router.js and postQuizApp — which
       agreed only because nobody had touched one of them. `i` was also assigned
       with no declaration, making it an implicit global shared by every
       concurrent submission.

       Explain answers arrive under `explain<i>` and come back in `written`;
       they are neither credited nor counted against. */
    const graded = qt.gradeSubmission(data, req.body);
    const count = graded.count;
    const checkCount = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "quiz",
    });
    if (checkCount && checkCount.totalDegree == null) {
      /* THE SERVER'S OWN VIEW OF THE CLOCK. The countdown on the paper was
         always anchored to this attempt's stored `deadline`, so refreshing or
         re-opening the page could never buy time — but nothing here compared
         the deadline to the moment the answers actually arrived, so a student
         who cleared the interval in the console submitted whenever they liked
         and it was graded as on time. See util/attemptTime.js for why a late
         submission is recorded and flagged rather than refused. */
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
          /* What the student picked, per auto-graded question. Only the total
             used to survive grading, so no screen could show them which
             question they got wrong. */
          answers: graded.answers,
          /* The hand-in time. _id.getTimestamp() is the time the attempt was
             STARTED, which on a timed paper is up to quizTime earlier. */
          submittedAt: new Date(),
          /* "This paper has essays on it", not "this student wrote
             something": a blank essay still needs a teacher to award it zero,
             and `written` now carries a row for every explain question.
             A late hand-in is a second reason for the same queue. */
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

    /* An attempt must exist before the paper is served. Without this check
       /quizApp/:id was reachable directly, skipping the POST that creates the
       degree record — so a student could open and re-open the paper with no
       attempt ever recorded, and with no deadline attached to anything. */
    const attempt = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "quiz",
    });
    if (!attempt) {
      return res.redirect("/quiz/" + data._id);
    }

    /* Remaining time for THIS student, from their own deadline. Clamped at 0 so
       a reopened expired attempt renders a stopped clock and auto-submits
       rather than a negative countdown. Attempts created before the deadline
       field existed have none, and fall back to untimed. Both this and the
       submission-time check above read the same module, so the clock the
       student sees and the clock the grader enforces cannot disagree. */
    const total = allowanceSeconds(data.quizTime);
    const secondsLeft = at.secondsLeft(attempt);

    res.render("quiz-paper.ejs", {
      kind: "quiz",
      paper: data,
      secondsLeft: secondsLeft,
      totalSeconds: total,
      alreadyTaken: attempt.totalDegree != null,
      backHref: quizBackHref(data),
      /* The question-type whitelist, so the paper renders the right input per
         question. EJS cannot require(). */
      ...qt.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});

/* THE SETTINGS PAGE — the quiz's own fields, and nothing about its questions.
   Its questions live at /questionsOfQuiz/:id below.

   No upload.any() on the POST any more. The settings form has no file input, so
   it posts as ordinary urlencoded and app.js's body parser is enough — which
   also means csrfProtect can run in its usual place, first, instead of having to
   wait for multer to find the token in a multipart body. */
route.get("/editQuiz/:id", csrfProtect, isAdmin, contro.editPaperGet("quiz"));

route.post("/editQuiz/:id", csrfProtect, isAdmin, contro.editPaperPost("quiz"));
/* POST + CSRF, and the cascade the old handler got wrong.

   Three bugs it had: it was a GET link, so a prefetch or crawler could delete a
   quiz; `unid.units` was read with no null check, so deleting a quiz whose unit
   row had already gone threw a TypeError that the catch turned into a redirect
   to the very page being deleted; and it redirected to /editQuiz/:id after
   deleting :id, landing the admin on a dead page. */
route.post("/removeQuiz/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findOneAndDelete({ _id: req.params.id });

    /* Clear the back-pointer so the unit row's quiz slot frees up. Guarded:
       findOne returns null whenever nothing points at this paper. */
    const unid = await unit.getModel().findOne({ "units.quizId": req.params.id });
    if (unid && Array.isArray(unid.units)) {
      for (const row of unid.units) {
        if (row && String(row.quizId) === String(req.params.id)) {
          row.quizId = undefined;
        }
      }
      await unid.save();
    }

    /* Attempts against a deleted paper otherwise linger as degree rows whose
       populate('quiz') yields null. */
    await degreeModel.deleteMany({ quiz: req.params.id, type: "quiz" });

    res.redirect("/admin/quiz");
  } catch (err) {
    next(err);
  }
});
/* ----------------------------------------------------------------------
   MANAGE QUESTIONS. The other half of the edit split: everything here works on
   the quiz's question list and nothing here can touch its settings.

   :i is the paper and :id is the question on the three per-question routes —
   the order /removeQuestionOfQuiz has always used, kept so the existing route
   keeps its shape and the four read alike.

   upload.any() BEFORE csrfProtect on the two routes that carry a question:
   their forms are multipart (a question can have an image), the token arrives
   inside the multipart body, and csurf cannot see it until multer has parsed
   the request. Move it after and every save fails with an invalid token.
   The move and remove routes carry no file, so they take csrfProtect first.
   ---------------------------------------------------------------------- */
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




// show quizzies answer
route.get('/showQuiz',async(req,res)=>{
  try {
    if (!req.cookies.student) {
      return res.redirect("/");
    }

    const student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    /* The old page looped over `degree` (the student's quiz ATTEMPTS, with
       populate({path:'quiz'})), so a quiz was invisible until attempted. Every
       quiz row whose paper had been deleted since became a null entry, guarded
       with three levels of `i != null && i.quiz != null` before reading
       `i.quiz.quiz.length` unguarded anyway. `quizzes` was fetched and never
       used — the data needed to fix it was already there. */
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
        /* Quizzes and homework are untimed and always available; no window. */
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

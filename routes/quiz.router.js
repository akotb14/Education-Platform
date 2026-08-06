const route = require("express").Router();
const model = require("../models/quiz");
const contro = require("../controllers/quiz.contro");
const user = require("../models/user");
const unit = require("../models/unit");
const isAdmin = require("../util/aurth");

const jwt = require("jsonwebtoken");
const degreeModel = require("../models/degreeQuiz");
const router = require("./login.router");
const { uploadImage: upload } = require("../middlewares/upload");
const csrf = require("csurf");

const csrfProtect = csrf({ cookie: true });
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

/* quizTime is stored as "HH:MM" — a single budget for the whole paper, not per
   question. Returns the allowance in seconds, or null when it is unusable.

   The old code built this with dateQ.setHours(getHours() + hh, getMinutes() +
   mm) and subtracted two Date objects, which is a very long way round and
   silently produced NaN whenever quizTime was empty or malformed. */
const allowanceSeconds = (quizTime) => {
  if (!quizTime) return null;
  const parts = String(quizTime).split(":");
  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const secs = (isNaN(hh) ? 0 : hh) * 3600 + (isNaN(mm) ? 0 : mm) * 60;
  return secs > 0 ? secs : null;
};

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
    let count = 0;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    data = await model.findOne({
      _id: name,
    });
    /* `i` was assigned with no declaration, making it an implicit global shared
       by every concurrent submission. */
    for (let i = 0; i < data["quiz"].length; i++) {
      if (req.body[`answer${i}`] == data["quiz"][i].correctAnswer) {
        count++;
      }
    }
    const checkCount = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "quiz",
    });
    if (checkCount && checkCount.totalDegree == null) {
      await degreeModel.findOneAndUpdate(
        {
          quiz: data._id,
          student: student.studentCard,
          isCheck: "1",
          type: "quiz",
        },
        { totalDegree: count }
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
       field existed have none, and fall back to untimed. */
    const total = allowanceSeconds(data.quizTime);
    let secondsLeft = null;
    if (attempt.deadline) {
      secondsLeft = Math.max(
        0,
        Math.floor((attempt.deadline.getTime() - Date.now()) / 1000)
      );
    }

    res.render("quiz-paper.ejs", {
      kind: "quiz",
      paper: data,
      secondsLeft: secondsLeft,
      totalSeconds: total,
      alreadyTaken: attempt.totalDegree != null,
      backHref: quizBackHref(data),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});

route.get("/editQuiz/:id", csrfProtect, isAdmin, contro.editPaperGet("quiz"));

route.post(
  "/editQuiz/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.editPaperPost("quiz")
);
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

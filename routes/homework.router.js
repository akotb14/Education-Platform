const route = require("express").Router();
const model = require("../models/quiz");
const contro = require("../controllers/quiz.contro");
const user = require("../models/user");
const unit = require("../models/unit");
const isAdmin = require("../util/aurth");
const jwt = require("jsonwebtoken");
const degreeModel = require("../models/degreeQuiz");
const { updateOne } = require("../models/user");
const { uploadImage: upload } = require("../middlewares/upload");
const csrf = require("csurf");

const csrfProtect = csrf({ cookie: true });
route.get("/openHomeWork", async (req, res) => {
  try {
    if (!req.cookies.student) {
      return res.redirect("/");
    }

    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);

    /* studentCard is the user's _id — see controllers/signup.contr.js, which
       signs { studentCard: student._id }. The old code here looked the account
       up by { cardNumber: student.studentCard }, i.e. matched an ObjectId
       against the String cardNumber field, so `stulevel` was always null. It
       was then never read, which is why nothing broke visibly — but it is also
       why this list was never filtered by grade. */
    const me = await user.findOne({ _id: student.studentCard });

    /* Every homework paper for this student's own level and grade.
       The old route did unit.find({}) — every unit document on the platform,
       for every grade — and left the filtering to the template. */
    const papers = me
      ? await model.find({
          type: "homework",
          educetionlevel: me.educetionlevel,
          grade: me.grade,
        })
      : [];

    /* This student's homework attempts, keyed by paper id, so matching below is
       a lookup rather than a nested .find() per card. */
    const degrees = await degreeModel.find({
      student: student.studentCard,
      type: "homework",
    });
    const byPaper = new Map();
    for (const d of degrees) {
      if (d.quiz) byPaper.set(String(d.quiz), d);
    }

    /* Which unit each paper belongs to, for the month/unit chips. A paper is
       attached to at most one unit row (units.$.homeId), so this is a plain
       lookup too. */
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

    /* One entry per homework paper. Driven by the PAPERS, not by the student's
       degree records — the old template emitted cards from inside a loop over
       `checkah` (all of the student's degrees, of any type) and matched on
       `value.quiz == val.quizId`, the QUIZ id. So a homework only appeared once
       the student had attempted the unrelated quiz sitting in the same unit,
       and a homework in a unit with no quiz was unreachable from this page
       entirely. Driving from the papers also means each one appears exactly
       once: the old outer .find() callback returned nothing, so it never
       stopped iterating and emitted a duplicate card per matching degree. */
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
        /* Homework is untimed and always available; no start/end window. */
        state: "untimed",
        started: !!deg,
        submitted: submitted,
        score: submitted ? Number(deg.totalDegree) : null,
        opensAt: null,
        closesAt: null,
      };
    });

    /* Shared with the exam and quiz lists — the three were the same page,
       forked and separately broken. */
    res.render("assessment-list.ejs", { kind: "homework", items: items });
  } catch (err) {
    console.log(err);
    res.sendStatus(400);
  }
});

/* Homework intro. Now fetches the paper so the page can name it and show the
   question count, and checks for an existing attempt so a student who has
   already submitted sees a proper page instead of a bare 400 carrying the
   English string "you cant entered homework agian" — which is what the POST
   answered when they pressed the button. */
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
    /* A bad :name is a CastError out of findOne. Render the view's
       not-available state rather than a bare status page. */
    res.status(404).render("quiz-intro.ejs", {
      kind: "homework",
      paper: null,
      alreadyTaken: false,
      backHref: "/openHomeWork",
    });
  }
});
/* The module-level `d` / `index` / `isStart` / `countCorrect` / `deName` /
   `random` / `arrAns` that used to live here are gone. They were ONE set of
   variables shared by every student on the server: the `d` countdown was
   decremented by a setInterval and read back when rendering any student's
   paper, so two simultaneous attempts fought over the same clock and a
   restart reset it. Nothing reads them now — the paper is rendered from the
   request's own data, and each attempt's deadline lives on its own
   degreeQuiz record. */
route.post("/homework/:name", async (req, res) => {
  try {
    /* The old handler had no else for this: pressing anything that did not
       post btn=continue fell straight off the end of the function with no
       response written, and the request hung until the browser timed out. */
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
        /* Homework is untimed, so no deadline. */
      });
      await deg.save();

      res.redirect("/homeworkApp/" + qutime._id);
    } else if (checkDegree.totalDegree == null) {
      /* Started but never submitted — let them carry on rather than answering
         400 and the English string "you cant entered homework agian", which is
         what the old code did for both this case and a finished attempt. */
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
    let count = 0;
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const data = await model.findOne({
      _id: name,
    });
    /* `i` was assigned without a declaration here, making it an implicit
       global — and this file's loops are async, so two concurrent submissions
       shared the counter. */
    for (let i = 0; i < data["quiz"].length; i++) {
      if (req.body[`answer${i}`] == data["quiz"][i].correctAnswer) {
        count++;
      }
    }
    const checkCount = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "homework",
    });
    if (checkCount && checkCount.totalDegree == null) {
      let up = await degreeModel.findOneAndUpdate(
        {
          quiz: data._id,
          student: student.studentCard,
          isCheck: "1",
          type: "homework",
        },
        { totalDegree: count }
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

    /* An attempt must exist before the paper is served. Without this check
       /homeworkApp/:id was reachable directly, skipping the POST that creates
       the degree record — so a student could open and re-open the paper with
       no attempt ever recorded against them. */
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
      /* Homework is untimed. The old page rendered the countdown markup
         regardless, reading the shared module-level `d`, so it showed a clock
         that was either stuck at 00:00:00 or ticking down somebody else's quiz. */
      secondsLeft: null,
      totalSeconds: null,
      alreadyTaken: attempt.totalDegree != null,
      backHref: "/openHomeWork",
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});
/* Edit a homework: its details and a batch of new questions, in one form.

   Was two handlers' worth of logic in one if/else that did either the
   details OR a single question, never both — see controllers/quiz.contro.js.
   upload.any() because the image field names are generated per question
   (q_0_image, q_1_image …) and .single() rejects the second file; it must
   run before csrfProtect, since the token arrives in the multipart body and
   csurf cannot see it until multer has parsed the request. */
route.get("/editHomework/:id", csrfProtect, isAdmin, contro.editPaperGet("homework"));

route.post(
  "/editHomework/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.editPaperPost("homework")
);
/* POST + CSRF, and the same cascade fix as /removeQuiz.

   The old handler was a GET link that read `unid.units` with no null check, so
   deleting a homework nothing pointed at threw a TypeError — and its catch
   redirected to /editHomework/:id, i.e. the edit page for the document it had
   just deleted. Both paths, success and failure, landed on a dead page. */
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
/* POST + CSRF. As a GET link this deleted a question on any prefetch,
   crawler visit or mis-click, with no confirmation and no token. */
route.post(
  "/removeQuestionOfHomework/:i/:id",
  csrfProtect,
  isAdmin,
  contro.removeQuestion("homework")
);

module.exports = route;

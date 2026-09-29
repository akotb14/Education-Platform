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
/* Configured in util/csrf.js rather than inline: the csrf({cookie:true}) default
   left the secret cookie script-readable and non-Secure. */
const csrfProtect = require("../util/csrf");
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
    let student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    const data = await model.findOne({
      _id: name,
    });
    /* One shared grader — see the comment in util/questionTypes.js and the
       quiz.router.js copy. `i` was an undeclared implicit global here too. */
    const graded = qt.gradeSubmission(data, req.body);
    const count = graded.count;
    const checkCount = await degreeModel.findOne({
      quiz: data._id,
      student: student.studentCard,
      isCheck: "1",
      type: "homework",
    });
    if (checkCount && checkCount.totalDegree == null) {
      /* Homework is untimed, so this attempt has no `deadline` and lateFields
         returns {} — the behaviour here is exactly what it has always been.
         The call is made anyway so all three graders enforce the deadline the
         same way: if homework ever gains a due time, it is already honoured
         here rather than being the one grader that forgot. See
         util/attemptTime.js. */
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
          /* See the quiz.router.js copy: the student's own choices, the
             hand-in time, and a needsReview that means "this paper has essays
             on it" so blank ones still reach the marking queue. */
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
      /* The question-type whitelist, so the paper renders the right input per
         question. EJS cannot require(). */
      ...qt.viewLocals(),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});
/* THE SETTINGS PAGE — the homework's own fields: name, description, due date,
   which lesson it belongs to. Nothing about its questions; those live at
   /questionsOfHomework/:id below.

   These used to be one form that did the details AND a batch of new questions,
   which meant a rename opened a page led by a question builder. See the block
   comment in controllers/quiz.contro.js for the split.

   No upload.any() on the POST any more: with the question builder gone the form
   has no file input, so it posts as ordinary urlencoded and app.js's body parser
   is enough — which also lets csrfProtect run first, in its usual place, rather
   than having to wait for multer to find the token in a multipart body. */
route.get("/editHomework/:id", csrfProtect, isAdmin, contro.editPaperGet("homework"));

route.post(
  "/editHomework/:id",
  csrfProtect,
  isAdmin,
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
/* ----------------------------------------------------------------------
   MANAGE QUESTIONS. The other half of the edit split: everything here works on
   the homework's question list and nothing here can touch its settings.

   :i is the paper and :id is the question — the order
   /removeQuestionOfHomework has always used, kept so all four read alike.

   upload.any() BEFORE csrfProtect on the two routes that carry a question: the
   image field names are generated per question (q_0_image, q_1_image …) so
   .single() would reject the second file, and the CSRF token arrives inside the
   multipart body, where csurf cannot see it until multer has parsed the request.
   The move and remove routes carry no file and take csrfProtect first.
   ---------------------------------------------------------------------- */
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

/* POST + CSRF. As a GET link this deleted a question on any prefetch,
   crawler visit or mis-click, with no confirmation and no token. */
route.post(
  "/removeQuestionOfHomework/:i/:id",
  csrfProtect,
  isAdmin,
  contro.removeQuestion("homework")
);

module.exports = route;

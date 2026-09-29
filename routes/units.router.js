const router = require("express").Router();
const contro = require("../controllers/units.contro");
const Unit = require("../models/unit");
const jwt = require("jsonwebtoken");
const degree = require("../models/degreeQuiz.js");
const month = require("../models/month");
const isMonth = require("../util/authMonth");
const { uploadPdf: upload } = require("../middlewares/upload");
const isAdmin = require("../util/aurth");
const quizModel = require("../models/quiz");
const degreeModel = require("../models/degreeQuiz");
/* Was `csrf({ cookie: true })` here, one of eight identical copies. That default
   stores the CSRF secret in a cookie with no httpOnly, no sameSite and no
   secure — see util/csrf.js, which now owns the configuration. */
const csrfProtect = require("../util/csrf");

router.get("/:edu/:grd", contro.getData);

router.post("/lesson", isAdmin, upload.single("pdf"), csrfProtect, contro.addlesson);
router.get("/lesson", csrfProtect, isAdmin, contro.getlesson);


router.post("/removelesson/:i/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const doc = await Unit.getModel().findOne({ _id: req.params.i });
    if (!doc || !Array.isArray(doc.units)) {
      return res.redirect("/lesson");
    }

    const row = doc.units.find((r) => r && String(r._id) === String(req.params.id));
    if (!row) {
      return res.redirect("/lesson");
    }

    const removedMonth = row.month;

    /* Papers hanging off this row, before the reference disappears. */
    const paperIds = [];
    if (row.quizId) paperIds.push(row.quizId);
    if (row.homeId) paperIds.push(row.homeId);

    await Unit.getModel().updateOne(
      { _id: req.params.i },
      { $pull: { units: { _id: req.params.id } } }
    );

    if (paperIds.length) {
      await quizModel.deleteMany({ _id: { $in: paperIds } });
      await degreeModel.deleteMany({ quiz: { $in: paperIds } });
    }

    /* Any rows left in this month AFTER the pull. */
    const remaining = doc.units.filter(
      (r) =>
        r &&
        String(r._id) !== String(req.params.id) &&
        r.month === removedMonth
    ).length;

    if (remaining === 0 && removedMonth) {
      await month.findOneAndDelete({
        month: removedMonth,
        educetionlevel: doc.educetionlevel,
        grade: doc.grade,
      });
    }

    res.redirect("/lesson");
  } catch (err) {
    next(err);
  }
});
router.get('/lessons/:educetionlevel/:grade/:month', isMonth, async (req,res)=>{
  try{

    let edu = req.params.educetionlevel;
    let student = "";
    let grd = req.params.grade;
      const lesson = await Unit.getModel().find({educetionlevel: req.params.educetionlevel,grade: req.params.grade})
      let d = await Unit.getModel().findOne({ educetionlevel: edu, grade: grd , });
      if (req.cookies.student) {
        student = jwt.verify(req.cookies.student, process.env.SecretPassword);
      }
      let degreeHome = "";
      degreeHome = await degree
        .find({
          type: "homework",
          student: student.studentCard,
        })
  
        .populate("quiz");
      /* Previously: if (lesson.length != 0) render, else res.send('lesson is
         not added') — a bare unstyled string with no nav and no way back,
         shown whenever a grade had no unit document yet. units.ejs now has a
         real empty state and handles data:[] on its own, so both cases go
         through the view. */
      res.render('units.ejs',{data:lesson,edu:req.params.educetionlevel,grade:req.params.grade,month:req.params.month , d , degreeHome})
      }catch (err) {
    res.sendStatus(403)
    console.log("error",err);
  } 
})
// lessons in marvat edit when adding homework


// lesson one
router.get('/content/:educetionlevel/:grade/:month/:id', isMonth , async (req,res)=>{
  try{
      const lesson = await Unit.getModel().findOne({educetionlevel: req.params.educetionlevel,grade: req.params.grade, month: req.params.month})
      /* `data` stays undefined when the unit doc is missing OR when no row in
         it carries this :id — lesson.ejs renders its own not-found state for
         both, so neither case needs res.send('lesson is not added') (an
         unstyled string with no nav and no way back).

         edu/grade/month are passed through purely so the view can draw a
         breadcrumb back to the unit list; the page previously received only
         `data` and so had no link out of itself at all. */
      let data = lesson ? lesson['units'].find((val)=>{return req.params.id == val._id}) : undefined;
      res.render('lesson.ejs',{
        data: data,
        edu: req.params.educetionlevel,
        grade: req.params.grade,
        month: req.params.month
      })
      }catch (err) {
    res.sendStatus(403)
    console.log(err);
  }
})


/* isMonth was missing here, and this is the route that serves a unit's actual
   content — the same material /content/:educetionlevel/:grade/:month/:id two
   routes above is gated on. Only the app-level isLogin applied, so ANY signed-in
   student could read any grade's, any month's units by typing the URL:
   /biology/1st/أكتوبر/unit-one returned 200 to a 2nd-grade student who owns no
   months at all. Confirmed against the running server before this change.

   The guard is the existing one, unchanged: it re-reads the role and the month
   list from the database, lets admins through, and answers 404 — not 403 — for a
   month the student does not own, so the response does not reveal whether that
   month exists. `:month` is already this route's third parameter, which is the
   name isMonth reads. */
router.get("/:edu/:grade/:month/:unit", isMonth, contro.getContent);
module.exports = {router,upload};

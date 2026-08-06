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
const csrf = require("csurf");

const csrfProtect = csrf({ cookie: true });

router.get("/:edu/:grd", contro.getData);

/* upload.single() runs before csrfProtect so multer has parsed the multipart
   body and the _csrf field is visible to csurf. */
router.post("/lesson", isAdmin, upload.single("pdf"), csrfProtect, contro.addlesson);
router.get("/lesson", csrfProtect, isAdmin, contro.getlesson);

/* Deleting a unit row.

   WAS A GET LINK with no CSRF and no confirmation, so a prefetch, a crawler or
   a mis-click deleted a lesson. It also had three logic bugs:

     · `for (i of f.units)` and `for (j of f.units)` — no declaration, so both
       are implicit globals shared across concurrent requests.
     · `f` was read with no null check, so an already-deleted id threw a
       TypeError that surfaced as a bare 404.
     · IT LEFT THE ATTACHED PAPERS ORPHANED. A unit row carries quizId and
       homeId; pulling the row dropped the only reference to them, so the quiz
       and homework documents stayed in the collection forever, invisible to
       every admin page but still counted on the dashboard and still returned to
       students by /openHomeWork, which queries by subject+grade and never looks
       at the unit tree. Both are deleted here now, along with any attempts
       recorded against them.

   The month-cleanup at the end is kept: a month row exists only to unlock a
   month for students, so the last unit leaving a month takes the month with it.
   The old count started at -1 and compared `== 0`, which is correct only by
   accident — it counted the row being deleted as well, since `f` was read
   before the $pull. Rewritten to count what remains. */
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


router.get("/:edu/:grade/:month/:unit", contro.getContent);
module.exports = {router,upload};

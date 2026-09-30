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
      res.render('units.ejs',{data:lesson,edu:req.params.educetionlevel,grade:req.params.grade,month:req.params.month , d , degreeHome})
      }catch (err) {
    res.sendStatus(403)
    console.log("error",err);
  } 
})


router.get('/content/:educetionlevel/:grade/:month/:id', isMonth , async (req,res)=>{
  try{
      const lesson = await Unit.getModel().findOne({educetionlevel: req.params.educetionlevel,grade: req.params.grade, month: req.params.month})
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


router.get("/:edu/:grade/:month/:unit", isMonth, contro.getContent);
module.exports = {router,upload};

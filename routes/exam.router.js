const router = require("express").Router();
const contro = require("../controllers/quiz.contro");
const model = require("../models/quiz");
const isAdmin = require("../util/aurth");
const degreeQ = require("../models/degreeQuiz");
const student = require("../models/user");
const jwt = require("jsonwebtoken");
const { uploadImage: upload } = require("../middlewares/upload");
const csrf = require("csurf");

const csrfProtect = csrf({ cookie: true });

/* Renders admin/quiz.ejs, admin/homework.ejs or admin/exam.ejs — all three are
   thin wrappers around views/admin/_assessment-form.ejs now. csrfProtect is
   here because those pages carry POST delete forms and a POST add form. */
router.get("/admin/:type", csrfProtect, isAdmin, contro.getQuiz);

/* upload must run before csrfProtect: the token arrives in the multipart body,
   and csurf cannot see it until multer has parsed the request.

   .any() rather than .single("image"): the add form now posts one optional
   image per question under a per-question field name (q_0_image, q_1_image …),
   and .single() would reject the second file with LIMIT_UNEXPECTED_FILE. The
   field names are generated, so there is no fixed list to hand .fields().
   makeUploader caps the file count, so .any() is not unbounded. */
router.post(
  "/admin/:type",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.addQuiz
);

//router.all('/quizApp' ,contro.getQuizApp);
router.get("/openExam", contro.getOpenQuiz);
router.get("/startQuiz/:nameQuiz", async (req, res) => {
  try {
    const data = await model.findOne({ _id: req.params.nameQuiz, type: "exam" });

    /* Outside its window, an exam is treated exactly like a missing one: the
       view's "غير متاح" state. The old route answered a bare 404 status page
       here, with no explanation and no way back to /openExam. */
    let open = false;
    if (data) {
      const sda = new Date(data.startTime).getTime();
      const eda = new Date(data.endTime).getTime();
      open = sda <= Date.now() && eda > Date.now();
    }

    let alreadyTaken = false;
    if (open && req.cookies.student) {
      const student = jwt.verify(req.cookies.student, process.env.SecretPassword);
      const deg = await degreeQ.findOne({
        quiz: data._id,
        student: student.studentCard,
        isCheck: "1",
        type: "exam",
        totalDegree: { $ne: null },
      });
      alreadyTaken = !!deg;
    }

    res.status(open ? 200 : 404).render("quiz-intro.ejs", {
      kind: "exam",
      paper: open ? data : null,
      alreadyTaken: alreadyTaken,
      backHref: "/openExam",
    });
  } catch (err) {
    console.log(err);
    res.status(404).render("quiz-intro.ejs", {
      kind: "exam",
      paper: null,
      alreadyTaken: false,
      backHref: "/openExam",
    });
  }
});
router.post("/startQuiz/:nameQuiz", contro.startQuiz);
router.get("/examApp/:nameQuiz", contro.g);

router.post("/examApp/:nameQuiz", contro.postQuizApp);
//router.get('/qw' ,contro.getqw)
router.get("/showStudentsDegree/:type", isAdmin, async (req, res) => {
  try {
    let filter = req.query.group;
    console.log(req.params.type);
    let q =
      filter == "All" || !filter
        ? { path: "student", options: { sort: { group: 1 } } }
        : { path: "student", match: { group: filter } };
    const quizDegree = await degreeQ
      .find({ type: req.params.type })
      .populate({ path: "quiz" })
      .populate(q);
    console.log(quizDegree);
    
    res.render("admin/showStudDegree.ejs", {
      data: quizDegree,
      type: req.params.type,
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(404);
  }
});

router.get("/removestudentDegree/:type/:id",async(req,res)=>{
	 try{
    await degreeQ.findByIdAndDelete({_id:req.params.id})
     res.redirect('/showStudentsDegree/'+req.params.type)
  }catch(err){
	 res.sendStatus(403)
  }
})

		  

router.get("/editExam/:id", csrfProtect, isAdmin, contro.editPaperGet("exam"));

router.post(
  "/editExam/:id",
  isAdmin,
  upload.any(),
  csrfProtect,
  contro.editPaperPost("exam")
);
/* POST, not GET. A GET delete fires on link prefetch, on a crawler visit and on
   any mis-click, with no confirmation and no CSRF — see the same change on the
   student routes. The old handler also redirected to /editExam/:id AFTER
   deleting that very exam, so a successful delete landed on a page for a
   document that no longer existed; it goes back to the list now. */
router.post("/removeExam/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findOneAndDelete({ _id: req.params.id });
    /* Exam attempts referenced this paper. Left behind, they show up on the
       degrees pages as rows whose populate('quiz') yields null. */
    await degreeQ.deleteMany({ quiz: req.params.id, type: "exam" });
    res.redirect("/admin/exam");
  } catch (err) {
    next(err);
  }
});
router.post(
  "/removeQuestionOfExam/:i/:id",
  csrfProtect,
  isAdmin,
  contro.removeQuestion("exam")
);
module.exports = router;

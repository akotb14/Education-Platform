const bcrypt = require("bcrypt");
const modelsign = require("../models/user");
const model = require("../models/stundentOnline");

const jwt = require("jsonwebtoken");

/* Creates a student account. Reached by POST /addStudent (was POST /sign).

   The route now runs the `valid` middleware first, so fullName/cardNumber/
   password/confirmPassword are guaranteed present and well-formed by the time
   this runs. The duplicate-cardNumber check below stays because uniqueness is
   a database property, not a schema one — Ajv cannot know it. */
const postInfo = async (req, res, next) => {
  try {
    const check = await modelsign.findOne({ cardNumber: req.body.cardNumber });
    if (!check) {
      let salt = await bcrypt.genSalt(10);
      const hashpassword = await bcrypt.hash(req.body.password, salt);
      let createperson = new modelsign({
        fullName: req.body.fullName,
        cardNumber: req.body.cardNumber,
        phoneNumber: req.body.phoneNumber,
        educetionlevel: req.body.educetionlevel,
        grade: req.body.grade,
        password: hashpassword,
        group: req.body.group,
        admin: req.body.admin,
      });

      await createperson.save();
      /* A successful save used to redirect to a blank form with no message, so
         it was indistinguishable from a submission that silently failed. */
      req.flash("addOk", "تم إنشاء حساب «" + req.body.fullName + "» بنجاح.");
      res.redirect("/addStudent");
    } else {
      req.flash("errorCard", { cardNumber: req.body.cardNumber });
      res.redirect("/addStudent");
    }
  } catch (err) {
    /* Was `console.log(err); res.redirect("/sign")` — every failure, including
       a lost database connection, looked to the admin like a form that just
       cleared itself. */
    return next(err);
  }
};
const login = async (req, res) => {
  try {
    console.log(req.body)
    if(req.body.loginOnline != "ارسال البيانات"){

      const student = await modelsign.findOne({
        phoneNumber: req.body.phoneNumber,
    });
    if (student) {
      const hash = await bcrypt.compare(req.body.password, student.password);
      if (hash) {
        const token = jwt.sign(
          {
            studentCard: student._id,
            nameStudent: student.fullName,
            educetionlevel: student.educetionlevel,
            grade: student.grade,
            admin:student.admin
          },
          process.env.SecretPassword
        ); 
        res.cookie("student", token ,{ httpOnly: true });
        res.redirect("/");
      } else {
        /* Login looks up by phoneNumber only, so the old "cardNumber or
           phoneNumber" wording named a field that is not even checked here.
           Both branches share one message on purpose: saying which of the two
           was wrong tells an attacker which phone numbers are registered. */
        req.flash("loginError", "رقم الهاتف أو كلمة السر غير صحيحة");
        res.redirect("/login");
        console.log("err1");

      }
    } else {
      req.flash("loginError", "رقم الهاتف أو كلمة السر غير صحيحة");
      res.redirect("/login");
      console.log("err2");

    }
  }else{
    const isChec = await model.findOne({
      fullName: req.body.fullName,
      cardNumber: req.body.cardNumber,
      phoneNumber: req.body.phoneNumber,
      educetionlevel: req.body.educetionlevel,
      grade: req.body.grade,
  });

  if (!isChec) {
    const stu = new model({
      fullName: req.body.fullName,
      cardNumber: req.body.cardNumber,
      phoneNumber: req.body.phoneNumber,
      educetionlevel: req.body.educetionlevel,
      grade: req.body.grade,
      group:req.body.group,
    });

    await stu.save();
    /* Both branches previously redirected with no message at all, so a
       successful request was indistinguishable from a dropped one. */
    req.flash("joinOk", "تم إرسال طلبك بنجاح. سيتم التواصل معك على رقم الهاتف الذي أدخلته.");
    res.redirect("/login");
  } else {
    req.flash("joinOk", "طلبك مُسجَّل بالفعل. سيتم التواصل معك قريبًا.");
    res.redirect("/login");
  }
}
  } catch (err) {
    console.log("err"+err);
    res.send(err);
  }
};
const getstudent = async (req, res) => {
  try {
    let isNotAdmin = [undefined,"false"] ;
    return await modelsign.find({admin:{$in:isNotAdmin} });
  } catch (err) {
    return res.sendStatus(400);
  }
};
/* Deletes one student. Reached by POST now, not GET — see the route.

   The parameter is still named `:cardNumber` for URL compatibility, but the
   value has always been an _id: the query below is findOneAndRemove({_id}).
   An id that is not a valid ObjectId makes mongoose throw a CastError, which
   used to surface as a bare 400 with no body; it goes to the error handler
   now. */
const removeStudnet = async (req, res, next) => {
  try {
    await modelsign.findOneAndRemove({ _id: req.params.cardNumber });
    res.redirect("/student");
  } catch (err) {
    return next(err);
  }
};
module.exports = { postInfo, login, getstudent, removeStudnet };

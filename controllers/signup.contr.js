const bcrypt = require("bcrypt");
const modelsign = require("../models/user");
const model = require("../models/stundentOnline");

const authToken = require("../util/authToken");


const postInfo = async (req, res, next) => {
  try {
    const check = await modelsign.findOne({ cardNumber: req.body.cardNumber });

    /* Login looks an account up by phoneNumber and by nothing else, so two
       accounts sharing a number means the second one can never sign in:
       findOne returns the first match every time, and its password is the only
       one that will ever be accepted. The account looks fine in the dashboard,
       which is what makes it hard to diagnose from the outside.

       The schema does not prevent this — phoneNumber has no unique index, and
       adding one to a live collection that may already hold duplicates would
       fail to build and take the boot down with it — so it is enforced here,
       on the only two paths that write the field. See also the same check on
       POST /editStudent/:id. */
    const phone = req.body.phoneNumber && String(req.body.phoneNumber).trim();
    if (!check && phone) {
      const dupPhone = await modelsign.findOne({ phoneNumber: phone });
      if (dupPhone) {
        req.flash("errorPhone", { phoneNumber: phone });
        return res.redirect("/addStudent");
      }
    }

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
const login = async (req, res, next) => {
  try {
    /* `console.log(req.body)` stood here. Every single login attempt, successful
       or not, wrote the submitted PLAINTEXT PASSWORD to the server log — and to
       whatever collects that log. Verified against the running server: the test
       account's password appeared in stdout verbatim. Nothing about a login body
       is safe to log. */
    if(req.body.loginOnline != "ارسال البيانات"){

      const student = await modelsign.findOne({
        phoneNumber: req.body.phoneNumber,
    });
    if (student) {
      const hash = await bcrypt.compare(req.body.password, student.password);
      if (hash) {
        /* The `admin` claim is carried for the homepage, which uses it to decide
           whether to show the dashboard link. It is NOT what grants admin
           access: util/aurth.js re-reads the role from the database on every
           admin request, so this claim going stale — or being minted before a
           demotion — cannot authorize anything. */
        authToken.issue(res, {
          studentCard: student._id,
          nameStudent: student.fullName,
          educetionlevel: student.educetionlevel,
          grade: student.grade,
          admin: student.admin,
        });
        res.redirect("/");
      } else {
        /* Login looks up by phoneNumber only, so the old "cardNumber or
           phoneNumber" wording named a field that is not even checked here.
           Both branches share one message on purpose: saying which of the two
           was wrong tells an attacker which phone numbers are registered. */
        req.flash("loginError", "رقم الهاتف أو كلمة السر غير صحيحة");
        res.redirect("/login");
      }
    } else {
      req.flash("loginError", "رقم الهاتف أو كلمة السر غير صحيحة");
      res.redirect("/login");
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
    /* Was `console.log("err"+err); res.send(err)`. res.send(err) serialised the
       thrown object straight to the browser: a mongoose validation error names
       the collection, the field and the schema rule; a connection error names
       the database host and, in a URI, whatever credentials are in it. The
       error handler in app.js logs it server-side and answers with a page. */
    return next(err);
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

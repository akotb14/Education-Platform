const bcrypt = require("bcrypt");
const modelsign = require("../models/user");
const model = require("../models/stundentOnline");

const authToken = require("../util/authToken");


const postInfo = async (req, res, next) => {
  try {
    const check = await modelsign.findOne({ cardNumber: req.body.cardNumber });

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
      req.flash("addOk", "تم إنشاء حساب «" + req.body.fullName + "» بنجاح.");
      res.redirect("/addStudent");
    } else {
      req.flash("errorCard", { cardNumber: req.body.cardNumber });
      res.redirect("/addStudent");
    }
  } catch (err) {
    return next(err);
  }
};
const login = async (req, res, next) => {
  try {
    if(req.body.loginOnline != "ارسال البيانات"){

      const student = await modelsign.findOne({
        phoneNumber: req.body.phoneNumber,
    });
    if (student) {
      const hash = await bcrypt.compare(req.body.password, student.password);
      if (hash) {
        authToken.issue(res, {
          studentCard: student._id,
          nameStudent: student.fullName,
          educetionlevel: student.educetionlevel,
          grade: student.grade,
          admin: student.admin,
        });
        res.redirect("/");
      } else {
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
    req.flash("joinOk", "تم إرسال طلبك بنجاح. سيتم التواصل معك على رقم الهاتف الذي أدخلته.");
    res.redirect("/login");
  } else {
    req.flash("joinOk", "طلبك مُسجَّل بالفعل. سيتم التواصل معك قريبًا.");
    res.redirect("/login");
  }
}
  } catch (err) {
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
const removeStudnet = async (req, res, next) => {
  try {
    await modelsign.findOneAndRemove({ _id: req.params.cardNumber });
    res.redirect("/student");
  } catch (err) {
    return next(err);
  }
};
module.exports = { postInfo, login, getstudent, removeStudnet };

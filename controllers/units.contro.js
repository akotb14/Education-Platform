const Unit = require("../models/unit");
const month = require("../models/month");
const quiz = require("../models/quiz");
const user = require('../models/user');
const degree = require("../models/degreeQuiz.js");

const jwt = require("jsonwebtoken");

const getData = async (req, res) => {
  try {
    let edu = req.params.edu;
    let student = "";
    let grd = req.params.grd;

    if (req.cookies.student) {
      student = jwt.verify(req.cookies.student, process.env.SecretPassword);
    }
    const findMonth = await month.find({ educetionlevel: edu, grade: grd });
    const getmonthofuser = await user.findOne({ _id: student.studentCard });

    const unlocked =
      getmonthofuser && Array.isArray(getmonthofuser.month)
        ? getmonthofuser.month
        : [];

    const unlockAll = !!(getmonthofuser && getmonthofuser.admin == "true");

    res.render("month.ejs", {
      data: findMonth,
      edu: edu,
      grd: grd,
      month: unlocked,
      unlockAll: unlockAll,
      student: student,
      name: req.cookies.student,
    });
  } catch (e) {
    console.log(e);

    res.sendStatus(404);
  }
};

const addlesson = async (req, res, next) => {
  try {
    const educetionlevel = req.body.educetionlevel;
    const grade = req.body.grade;
    const monthName = req.body.month;
    const unitName = (req.body.unit || "").trim();

    if (!educetionlevel || !grade || !monthName || !unitName) {
      req.flash("lessonBad", "اختر المادة والصف والشهر واكتب اسم الدرس.");
      return res.redirect("/lesson");
    }

    const existing = await Unit.getModel().findOne({
      educetionlevel: educetionlevel,
      grade: grade,
      units: { $elemMatch: { unit: unitName, month: monthName } },
    });
    if (existing) {
      req.flash("lessonBad", `يوجد درس باسم «${unitName}» في هذا الشهر بالفعل.`);
      return res.redirect("/lesson");
    }

    let pdf = req.file ? req.file.path : "";
    await Unit.addlesson(
      educetionlevel,
      grade,
      monthName,
      unitName,
      req.body.lesson,
      pdf
    );

    const checkMonth = await month.findOne({
      educetionlevel: educetionlevel,
      grade: grade,
      month: monthName,
    });
    if (!checkMonth) {
      await new month({
        educetionlevel: educetionlevel,
        grade: grade,
        month: monthName,
      }).save();
    }

    req.flash("lessonOk", `تمت إضافة درس «${unitName}».`);
    res.redirect("/lesson");
  } catch (err) {
    next(err);
  }
};

const getlesson = async (req, res, next) => {
  try {
    const lesson = await Unit.getModel().find({});

    const okFlash = req.flash("lessonOk");
    const badFlash = req.flash("lessonBad");

    res.render("admin/lesson.ejs", {
      lesson: lesson,
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      flashOk: okFlash.length ? okFlash[0] : "",
      flashBad: badFlash.length ? badFlash[0] : "",
    });
  } catch (err) {
    next(err);
  }
};

const getContent = async (req, res) => {
  try {
    let edu = req.params.edu;

    let grade = req.params.grade;

    let month = req.params.month;

    let unit = req.params.unit;

    let content = await Unit.getModel().findOne({
      educetionlevel: edu,

      grade: grade,

      month: month,
    });

    let c = "";

    if (content) {
      c = content.units.find((val) => {
        return val["unit"] == unit;
      });
    } else {
      c = "";
    }

    let q = " ";

    q = await quiz.findOne({
      educetionlevel: edu,

      grade: grade,

      month: month,

      unit: unit,

      type: "quiz",
    });

    let id = " ";

    if (q) {
      id = q._id;
    }

    res.render("units.ejs", { data: c, url: id });
  } catch (err) {
    res.sendStatus(400);
  }
};

module.exports = { getData, addlesson, getlesson, getContent };

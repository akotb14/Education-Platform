const express = require("express");
const router = express.Router();
const valid = require("../middlewares/signupMiddileware");
const contro = require("../controllers/signup.contr");
const csrfProtect = require("../util/csrf");
const signModel = require("../models/user");
const isAdmin = require("../util/aurth");
const month = require("../models/month");

const PREFILL_KEYS = [
  "fullName",
  "cardNumber",
  "phoneNumber",
  "educetionlevel",
  "grade",
  "group",
];

function readPrefill(query) {
  const out = {};
  for (const key of PREFILL_KEYS) {
    const v = query[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v.trim();
  }
  return out;
}

router.get("/addStudent", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    const cardFlash = req.flash("errorCard");
    const phoneFlash = req.flash("errorPhone");
    const okFlash = req.flash("addOk");

    res.render("admin/addStudent.ejs", {
      validator: req.flash("errorMsg"),
      csrfToken: req.csrfToken(),
      check: cardFlash.length ? cardFlash[0] : null,
      checkPhone: phoneFlash.length ? phoneFlash[0] : null,
      flashOk: okFlash.length ? okFlash[0] : "",
      prefill: readPrefill(req.query),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/sign", (req, res) => {
  const qs = req.originalUrl.indexOf("?");
  res.redirect(301, "/addStudent" + (qs === -1 ? "" : req.originalUrl.slice(qs)));
});
router.post("/sign", (req, res) => res.redirect(308, "/addStudent"));

router.post(
  "/removestudent/:cardNumber",
  csrfProtect,
  isAdmin,
  contro.removeStudnet
);
router.post("/addStudent", csrfProtect, isAdmin, valid, contro.postInfo);
router.get("/editStudent/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    let id = req.params.id;
    const getStudent = await signModel.findOne({ _id: id });
    let selectMonth = await month.find({educetionlevel:getStudent['educetionlevel'],grade:getStudent['grade']});
    if (getStudent && selectMonth.length >= 0) {
      const phoneFlash = req.flash("errorPhone");
      res.render("admin/editStudent.ejs", {
        csrfToken: req.csrfToken(),
        student: getStudent,
        month: selectMonth,
        checkPhone: phoneFlash.length ? phoneFlash[0] : null
      });
    } else {
      res.redirect("/student");
    }
  } catch (err) {
    return next(err);
  }
});
router.post("/editStudent/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    let id = req.params.id;

    const phone = req.body.phoneNumber && String(req.body.phoneNumber).trim();
    if (phone) {
      const dupPhone = await signModel.findOne({
        phoneNumber: phone,
        _id: { $ne: id },
      });
      if (dupPhone) {
        req.flash("errorPhone", { phoneNumber: phone });
        return res.redirect("/editStudent/" + id);
      }
    }

    let months = req.body.month;
    if (months == null) months = [];
    else if (!Array.isArray(months)) months = [months];
    months = months.filter(function (m) {
      return typeof m === "string" && m.trim() !== "";
    });

    await signModel.findByIdAndUpdate(
      { _id: id },
      {
        fullName: req.body.fullName,
        cardNumber: req.body.cardNumber,
        phoneNumber: req.body.phoneNumber,
        educetionlevel: req.body.educetionlevel,
        grade: req.body.grade,
        group: req.body.group,
        admin: req.body.admin,
        month: months,
      }
    );
    res.redirect("/student");
  } catch (err) {
    next(err);
  }
});
module.exports = router;
 

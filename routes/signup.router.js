const express = require("express");
const router = express.Router();
const valid = require("../middlewares/signupMiddileware");
const contro = require("../controllers/signup.contr");
var csrf = require("csurf");
const csrfProtect = csrf({ cookie: true });
const signModel = require("../models/user");
const isAdmin = require("../util/aurth");
const month = require("../models/month");

/* ---------------------------------------------------------------------------
   ADD STUDENT

   Renamed from `/sign` + views/admin/sign.ejs to `/addStudent` +
   views/admin/addStudent.ejs. `/sign` read like a public signup endpoint, but
   the route is isAdmin-gated and creates a student account on the admin's
   behalf. The new name pairs with the existing `/editStudent/:id`.

   The old URL 301s below so bookmarks and the 8 admin views still on the old
   copy-pasted sidebar keep working.

   PREFILL: views/admin/onlinestudent.ejs links here with the join request's
   fields as query parameters so an admin can turn a request into an account
   without retyping. Only known keys are read, and every value is coerced to a
   string — a repeated parameter (?grade=1st&grade=2nd) arrives as an array,
   which would otherwise reach the template as an array and render
   "1st,2nd" into the value attribute.
   --------------------------------------------------------------------------- */
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
    /* `check` and `errorMsg` are flash arrays. req.flash() returns [] when
       nothing was set, so `check[0]` is undefined on a normal load — the old
       view tested the array itself, which is truthy even when empty. */
    const cardFlash = req.flash("errorCard");
    const okFlash = req.flash("addOk");

    res.render("admin/addStudent.ejs", {
      validator: req.flash("errorMsg"),
      csrfToken: req.csrfToken(),
      check: cardFlash.length ? cardFlash[0] : null,
      flashOk: okFlash.length ? okFlash[0] : "",
      prefill: readPrefill(req.query),
    });
  } catch (err) {
    next(err);
  }
});

/* Old URL. 301 rather than 302: the move is permanent, and app.js:68 still
   applies the login rate limiter to "/sign", so this redirect stays covered by
   it. app.js is out of scope for this refactor, so that limiter entry is left
   alone — it now guards a redirect, which is harmless. */
router.get("/sign", (req, res) => {
  const qs = req.originalUrl.indexOf("?");
  res.redirect(301, "/addStudent" + (qs === -1 ? "" : req.originalUrl.slice(qs)));
});
router.post("/sign", (req, res) => res.redirect(308, "/addStudent"));

/* Delete is a POST, not a GET.

   It was `router.get("/removestudent/:cardNumber", ...)`, i.e. a permanent
   delete behind an ordinary link. Anything that follows links — a crawler, a
   browser prefetch, a link scanner in a messaging app, an accidental click —
   deleted a student, and there was no CSRF check, so any page on the internet
   could delete students by embedding <img src="…/removestudent/ID"> and
   waiting for a logged-in admin to load it.

   csrfProtect must come after the body parser (mounted in app.js) so it can
   read the _csrf field. */
router.post(
  "/removestudent/:cardNumber",
  csrfProtect,
  isAdmin,
  contro.removeStudnet
);
/* `valid` was imported at the top of this file and never mounted, so the form
   had no server-side validation at all: a blank fullName, a cardNumber
   containing letters, or a password of "" all saved successfully.

   It is mounted here, AFTER csrfProtect and isAdmin — validating the body of a
   request that is about to be rejected for a bad token wastes the work and,
   worse, flashes validation errors into the session of whoever forged it.

   The schema at util/validSignup.js also requires `confirmPassword`, which the
   old form did not have — mounting `valid` without adding that field would
   have rejected every single submission. addStudent.ejs now renders it. */
router.post("/addStudent", csrfProtect, isAdmin, valid, contro.postInfo);
router.get("/editStudent/:id", csrfProtect, isAdmin, async (req, res) => {
  try {
    let id = req.params.id;
    const getStudent = await signModel.findOne({ _id: id });
    let selectMonth = await month.find({educetionlevel:getStudent['educetionlevel'],grade:getStudent['grade']});
    if (getStudent && selectMonth.length >= 0) {
      res.render("admin/editStudent.ejs", {
        csrfToken: req.csrfToken(),
        student: getStudent,
        month: selectMonth
      });
    } else {
      res.redirect("/student");
    }
  } catch (err) {
    
    console.log(err);
    res.sendStatus(400);
  }
});
router.post("/editStudent/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    let id = req.params.id;

    /* A checkbox group submits nothing when no box is ticked, one string when
       exactly one is, and an array when several are. `req.body.month` was
       written straight through before, so those three cases stored three
       different shapes. Normalised to an array here.

       The empty-string filter is what the removed phantom hidden input made
       necessary: `<input type="hidden" name="month" value="">` sat after the
       checkboxes and always submitted, so every save appended "" to the
       student's months. Existing records still carry those; this drops them
       on the next save. */
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
 

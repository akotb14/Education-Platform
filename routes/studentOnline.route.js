const route = require("express").Router();

const model = require("../models/stundentOnline");

const isAdmin = require("../util/aurth");

var csrf = require("csurf");

const csrfProtect = csrf({ cookie: true });

// route.get("/login", csrfProtect, (req, res) => {
//   res.render("login.ejs", {
//     csrfToken: req.csrfToken(),

//     err: req.flash("err"),
//   });
// });

// route.post("/login", csrfProtect, async (req, res) => {
//   try {
//     const isChec = await model.findOne({
//         fullName: req.body.fullName,
//         cardNumber: req.body.cardNumber,
//         phoneNumber: req.body.phoneNumber,
//         educetionlevel: req.body.educetionlevel,
//         grade: req.body.grade,
//     });

//     if (!isChec) {
//       const stu = new model({
//         fullName: req.body.fullName,
//         cardNumber: req.body.cardNumber,
//         phoneNumber: req.body.phoneNumber,
//         educetionlevel: req.body.educetionlevel,
//         grade: req.body.grade,
//         group:req.body.group,
//       });

//       await stu.save();
//       res.redirect("/login");
//     } else {
//       res.redirect("/login");
//     }
//   } catch (err) {
//     req.flash("err", "you entered wrong fields");

//     console.log(err);

//     res.redirect("/login");
//   }
// });

route.get("/admin/studentOnline", isAdmin, csrfProtect, async (req, res, next) => {
  try {
    let mo = await model.find({}).lean();

    res.render("admin/onlinestudent.ejs", {
      student: mo,
      /* The per-row delete is a POST form now, so the page needs a token. */
      csrfToken: req.csrfToken(),
    });
  } catch (err) {
    /* Was `console.log(err); res.sendStatus(400)` — a server-side DB failure
       reported as a client error, with no body to say so. */
    next(err);
  }
});

/* THIS ROUTE HAD NO AUTH AT ALL.

   It was `route.get("/removeStudentOnline/:id", ...)` with no isAdmin — any
   unauthenticated visitor who knew or guessed a document id could delete a
   join request, by GET, from a plain link. Every other admin route in the
   file is guarded; this one was simply missed.

   Three changes: POST instead of GET (a GET delete fires on prefetch and on
   any crawler visit), csrfProtect so a third-party page cannot submit it with
   the admin's cookie, and the isAdmin guard the route always needed. */
route.post("/removeStudentOnline/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findByIdAndDelete({ _id: req.params.id });

    res.redirect("/admin/studentOnline");
  } catch (err) {
    /* The old catch redirected on failure too, so a delete that threw looked
       exactly like one that succeeded. */
    next(err);
  }
});

module.exports = route;

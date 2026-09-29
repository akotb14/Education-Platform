const route = require("express").Router();

const model = require("../models/stundentOnline");

const isAdmin = require("../util/aurth");

const tf = require("../util/tableFilters");
const excel = require("../util/excel");

/* Configured in util/csrf.js rather than inline: the csrf({cookie:true}) default
   left the secret cookie script-readable and non-Secure. */
const csrfProtect = require("../util/csrf");

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

/* Columns of the join-requests table, in the order onlinestudent.ejs renders
   them. The two must agree — that is the "export contains exactly the table
   data" requirement. */
const ONLINE_COLUMNS = [
  { header: "الاسم", key: "name", width: 30 },
  { header: "المادة", key: "subject", width: 16 },
  { header: "الصف", key: "grade", width: 16 },
  { header: "رقم الهاتف", key: "phone", width: 18 },
  { header: "المجموعة", key: "group", width: 16 },
  { header: "رقم الكارت", key: "card", width: 20 },
];

route.get("/admin/studentOnline", isAdmin, csrfProtect, async (req, res, next) => {
  try {
    /* This page had no filtering at all — `find({})`, every join request, in
       whatever order Mongo returned them. It gets the same four filters, the
       same name sort and the same export as the other two tables, through the
       same shared utility. */
    const f = tf.parse(req.query);
    const filter = tf.studentFilter(f, {});
    /* _id descending = newest request first, which is the order this page has
       always shown and the one an admin working through a queue wants. */
    const order = tf.mongoSort(f, { _id: -1 });

    let query = model.find(filter).sort(order.sort).lean();
    if (order.collation) query = query.collation(order.collation);
    const mo = await query;

    if (req.query.export === "xlsx") {
      const rows = mo.map(function (s) {
        return {
          name: s.fullName || "",
          subject: tf.SUBJECT_LABEL[s.educetionlevel] || s.educetionlevel || "",
          grade: tf.GRADE_LABEL[s.grade] || s.grade || "",
          phone: s.phoneNumber || "",
          group: tf.GROUP_LABEL[s.group] || s.group || "",
          card: s.cardNumber || "",
        };
      });

      /* Awaited inside the try so a workbook failure reaches next(err) with
         the response still intact, rather than truncating a download. */
      return await excel.sendSheet(res, {
        filename: f.touched ? "join-requests-filtered" : "join-requests",
        sheetName: "طلبات الانضمام",
        columns: ONLINE_COLUMNS,
        rows: rows,
      });
    }

    res.render(
      "admin/onlinestudent.ejs",
      Object.assign({}, tf.viewLocals(f), {
        student: mo,
        /* The per-row delete is a POST form now, so the page needs a token. */
        csrfToken: req.csrfToken(),
      })
    );
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

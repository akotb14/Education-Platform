/* =========================================================================
   GET /dashboard  — admin landing page.

   WHAT THIS REPLACES

     router.get("/dashboard", isAdmin, async (req, res) => {
       try {
         const data = await contro.getstudent();
         res.render("admin/dashboard.ejs", { student: data });
       } catch (err) {
         console.log(err);          // <-- no response ever written
       }
     });

   Three problems with that:

     1. `getstudent()` pulled EVERY non-admin student document — full
        documents, including the bcrypt hash and the `month` array — and the
        view then rendered one <tr> per student. On a real roster the
        dashboard's first paint was the entire user table.
     2. It was called with no arguments, but its signature is
        `(req, res)` and its own catch does `res.sendStatus(400)`. On a DB
        error that throws `Cannot read properties of undefined (reading
        'sendStatus')` from inside the catch block. This route now queries the
        model directly instead of routing its error path through that helper.
        (`getstudent` is left alone — routes/signup.router.js still calls it.)
     3. The catch only logged. No response, no `next(err)` — the client hung
        until it timed out, with nothing in the browser to show why.

   LOCALS PASSED  (contract documented in views/admin/dashboard.ejs)
     stats     { students, lessons, quizzes, exams, homework }  all Numbers
     students  Array — the RECENT_LIMIT most recently added students
     total     Number — full roster size, for the "عرض الكل (N)" link
   ====================================================================== */

const router = require("express").Router();
const isAdmin = require("../util/aurth");
const usermodel = require("../models/user");
const quizmodel = require("../models/quiz");
const Units = require("../models/unit");
const tf = require("../util/tableFilters");
const excel = require("../util/excel");
/* Configured in util/csrf.js rather than inline: the csrf({cookie:true}) default
   left the secret cookie script-readable and non-Secure. */
const csrfProtect = require("../util/csrf");

/* How many rows the "أحدث الطلاب" panel shows. The full roster lives at
   /student, which already has the group filter and the sort. */
const RECENT_LIMIT = 8;

/* The seed/system account app.js also filters out of /student. Kept in sync
   with app.js:175 so the two pages report the same roster size. */
const SEED_CARD = "123456789101122";

/* Non-admin students. `admin` is a String in the schema, not a Boolean, and
   is simply absent on records created before the field existed — hence both
   `undefined` and the literal "false". */
const STUDENT_FILTER = {
  admin: { $in: [undefined, "false"] },
  cardNumber: { $ne: SEED_CARD },
};

router.get("/dashboard", isAdmin, async (req, res, next) => {
  try {
    /* countDocuments, not find().length — the old page transferred and
       deserialised every document just to show one number. */
    const [total, quizzes, exams, homework, lessonAgg, students] =
      await Promise.all([
        usermodel.countDocuments(STUDENT_FILTER),
        quizmodel.countDocuments({ type: "quiz" }),
        quizmodel.countDocuments({ type: "exam" }),
        quizmodel.countDocuments({ type: "homework" }),

        /* Lessons are subdocuments of a per-(level, grade) unit document, so
           there is no document to count — the number wanted is the total
           length of every `units` array. */
        Units.getModel().aggregate([
          { $project: { count: { $size: { $ifNull: ["$units", []] } } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),

        /* Only the columns the table renders. Without the projection this
           ships the password hash to the template on every dashboard load.
           No explicit createdAt in the schema, so _id descending is the
           insertion order proxy. */
        usermodel
          .find(STUDENT_FILTER)
          .select("fullName grade educetionlevel phoneNumber cardNumber")
          .sort({ _id: -1 })
          .limit(RECENT_LIMIT)
          .lean(),
      ]);

    res.render("admin/dashboard.ejs", {
      stats: {
        students: total,
        lessons: lessonAgg.length ? lessonAgg[0].total : 0,
        quizzes: quizzes,
        exams: exams,
        homework: homework,
      },
      students: students,
      total: total,
    });
  } catch (err) {
    /* Hand it to Express rather than swallowing it: the client gets a 500
       instead of an open socket. Note a render error inside res.render does
       NOT land here — Express routes those to the error handler itself. */
    next(err);
  }
});

/* =========================================================================
   GET /student — the roster.

   This SUPERSEDES the handler still sitting inline in app.js:167. app.js
   mounts this router at line 165 — before that app.get — and Express matches
   in registration order, so this one wins and the app.js copy is now dead
   code. It is left in place only because app.js is out of scope for this
   refactor; deleting those 15 lines is a safe follow-up.

   WHAT THE OLD HANDLER DID

     let filter = req.query.group;
     let q = filter == "All" || !filter ? null : { group: filter };
     res.render("admin/users.ejs", {
       student: await usermodel.find(q)
         .sort({ admin: -1, educetionlevel: 1, grade: 1, group: -1 })
         .where({ cardNumber: { $ne: 123456789101122 } }),
     });

     · No pagination — every matching student, full documents, password hash
       included, rendered as one <tr> each.
     · `cardNumber` is a String in the schema but the exclusion compares
       against the NUMBER 123456789101122. In MongoDB "123..." never equals
       123..., so that $ne matched everything and the seed admin account was
       never actually filtered out. String here.
     · `catch { res.sendStatus(400) }` reported a server-side DB failure as a
       client error, with no body.
   ====================================================================== */

const PAGE_SIZE = 25;

/* The four filter controls, the name sort and the search box are parsed and
   whitelisted by util/tableFilters — shared with /showStudentsDegree/:type and
   /admin/studentOnline so the three tables cannot drift apart. safeRegex used
   to live here; it moved there with the rest.

   `?export=xlsx` is handled by THIS handler rather than a separate route, on
   purpose: the export then provably runs the same filter and the same sort as
   the render, because it is the same lines of code. A second /student/export
   route would be a second query builder to keep in step. */
const DEFAULT_SORT = { admin: -1, educetionlevel: 1, grade: 1, group: -1, _id: -1 };

/* Mirrors the columns views/admin/users.ejs renders, in the same order. The
   two must agree — that is the "export contains exactly the table data"
   requirement — so if a column is added to the view it is added here too. */
const STUDENT_COLUMNS = [
  { header: "الاسم", key: "name", width: 30 },
  { header: "المجموعة", key: "group", width: 16 },
  { header: "الصف", key: "grade", width: 16 },
  { header: "المادة", key: "subject", width: 16 },
  { header: "رقم الهاتف", key: "phone", width: 18 },
  { header: "رقم الكارت", key: "card", width: 20 },
  { header: "الصلاحية", key: "role", width: 12 },
];

router.get("/student", isAdmin, csrfProtect, async (req, res, next) => {
  try {
    const f = tf.parse(req.query);
    const wantsExport = req.query.export === "xlsx";

    let page = parseInt(req.query.page, 10);
    if (!isFinite(page) || page < 1) page = 1;

    /* SEED_CARD as a String, not a Number — see the note above. */
    const filter = tf.studentFilter(f, { cardNumber: { $ne: SEED_CARD } });
    const order = tf.mongoSort(f, DEFAULT_SORT);

    /* Without this projection the bcrypt hash of every listed student is sent
       to the template — or into the spreadsheet — on every request. */
    const FIELDS = "fullName group grade educetionlevel phoneNumber cardNumber admin";

    if (wantsExport) {
      /* Every matching student, not just the visible page: an admin exporting
         a filtered roster wants the whole filtered roster. .lean() matters
         more here than on the paged query — these are plain objects, so no
         mongoose document wrapper is built for a set that can be the entire
         table. */
      let query = usermodel.find(filter).select(FIELDS).sort(order.sort).lean();
      if (order.collation) query = query.collation(order.collation);
      const all = await query;

      const rows = all.map(function (s) {
        return {
          name: s.fullName || "",
          group: tf.GROUP_LABEL[s.group] || s.group || "",
          grade: tf.GRADE_LABEL[s.grade] || s.grade || "",
          subject: tf.SUBJECT_LABEL[s.educetionlevel] || s.educetionlevel || "",
          phone: s.phoneNumber || "",
          card: s.cardNumber || "",
          role: s.admin === "true" ? "مشرف" : "طالب",
        };
      });

      /* await inside the try, so a workbook failure reaches next(err) with the
         response still intact rather than truncating a download. */
      return await excel.sendSheet(res, {
        filename: f.touched ? "students-filtered" : "students",
        sheetName: "الطلاب",
        columns: STUDENT_COLUMNS,
        rows: rows,
      });
    }

    const total = await usermodel.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages) page = pages;

    let listQuery = usermodel
      .find(filter)
      .select(FIELDS)
      .sort(order.sort)
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();
    /* Collation must be on the query that does the sorting, not just the
       count — and it has to be applied for skip/limit to page consistently. */
    if (order.collation) listQuery = listQuery.collation(order.collation);

    const students = await listQuery;

    res.render(
      "admin/users.ejs",
      Object.assign({}, tf.viewLocals(f), {
        students: students,
        total: total,
        page: page,
        pages: pages,
        limit: PAGE_SIZE,
        /* `group` and `q` stay as their own locals as well as living inside
           `f`. The view read them before this change and other pages link to
           /student?group=…; keeping both means nothing downstream breaks. */
        group: f.group,
        q: f.q,
        /* The per-row delete is a POST form now, so each one needs a token. */
        csrfToken: req.csrfToken(),
      })
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;

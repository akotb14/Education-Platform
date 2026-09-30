const route = require("express").Router();

const model = require("../models/stundentOnline");

const isAdmin = require("../util/aurth");

const tf = require("../util/tableFilters");
const excel = require("../util/excel");

const csrfProtect = require("../util/csrf");








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
    const f = tf.parse(req.query);
    const filter = tf.studentFilter(f, {});
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
        csrfToken: req.csrfToken(),
      })
    );
  } catch (err) {
    next(err);
  }
});

route.post("/removeStudentOnline/:id", csrfProtect, isAdmin, async (req, res, next) => {
  try {
    await model.findByIdAndDelete({ _id: req.params.id });

    res.redirect("/admin/studentOnline");
  } catch (err) {
    next(err);
  }
});

module.exports = route;

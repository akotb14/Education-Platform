
const router = require("express").Router();
const isAdmin = require("../util/aurth");
const usermodel = require("../models/user");
const quizmodel = require("../models/quiz");
const Units = require("../models/unit");
const tf = require("../util/tableFilters");
const excel = require("../util/excel");
const csrfProtect = require("../util/csrf");

const RECENT_LIMIT = 8;

const SEED_CARD = "123456789101122";

const STUDENT_FILTER = {
  admin: { $in: [undefined, "false"] },
  cardNumber: { $ne: SEED_CARD },
};

router.get("/dashboard", isAdmin, async (req, res, next) => {
  try {
    const [total, quizzes, exams, homework, lessonAgg, students] =
      await Promise.all([
        usermodel.countDocuments(STUDENT_FILTER),
        quizmodel.countDocuments({ type: "quiz" }),
        quizmodel.countDocuments({ type: "exam" }),
        quizmodel.countDocuments({ type: "homework" }),

        Units.getModel().aggregate([
          { $project: { count: { $size: { $ifNull: ["$units", []] } } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),

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
    next(err);
  }
});


const PAGE_SIZE = 25;

const DEFAULT_SORT = { admin: -1, educetionlevel: 1, grade: 1, group: -1, _id: -1 };

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

    const filter = tf.studentFilter(f, { cardNumber: { $ne: SEED_CARD } });
    const order = tf.mongoSort(f, DEFAULT_SORT);

    const FIELDS = "fullName group grade educetionlevel phoneNumber cardNumber admin";

    if (wantsExport) {
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
        group: f.group,
        q: f.q,
        csrfToken: req.csrfToken(),
      })
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;

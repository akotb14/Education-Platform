const jwt = require("jsonwebtoken");
const config = require("../config");
const auth = require("../models/user");

const isMonth = async (req, res, nxt) => {
  let student;
  try {
    student = jwt.verify(req.cookies.student, config.jwtSecret);
  } catch (err) {
    return res.sendStatus(404);
  }

  if (!student) {
    return res.sendStatus(404);
  }

  let s = student.studentCard;
  let month = req.params.month;

  let user;
  try {
    user = await auth.findOne({ _id: s });
  } catch (err) {
    return nxt(err);
  }

  if (user && user.admin == "true") {
    return nxt();
  }

  if (user && Array.isArray(user.month) && user.month.includes(month)) {
    nxt();
  } else {
    return res.sendStatus(404);
  }
};

module.exports = isMonth;

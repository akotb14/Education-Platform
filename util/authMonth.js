const jwt = require("jsonwebtoken");
const config = require("../config");
const auth = require("../models/user");

const isMonth = async (req, res, nxt) => {
  let student;
  try {
    student = jwt.verify(req.cookies.student, config.jwtSecret);
  } catch (err) {
    // malformed or missing cookie — treat as not authenticated
    return res.sendStatus(404);
  }

  if (!student) {
    return res.sendStatus(404);
  }

  let s = student.studentCard;
  let month = req.params.month;
  const user = await auth.findOne({ _id: s });

  if (user && Array.isArray(user.month) && user.month.includes(month)) {
    nxt();
  } else {
    return res.sendStatus(404);
  }
};

module.exports = isMonth;

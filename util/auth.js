const jwt = require("jsonwebtoken");
const config = require("../config");

const isLogin = (req, res, nxt) => {
  let student;
  try {
    student = jwt.verify(req.cookies.student, config.jwtSecret);
  } catch (err) {
    return res.redirect("/login");
  }

  if (!student || !student.studentCard) {
    return res.redirect("/login");
  }

  return nxt();
};

module.exports = isLogin;

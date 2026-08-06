const jwt = require("jsonwebtoken");
const config = require("../config");

const isLogin = (req, res, nxt) => {
  try {
    let student = jwt.verify(req.cookies.student, config.jwtSecret);
    if (student) {
      nxt();
    } else {
      return res.redirect("/");
    }
  } catch (err) {
    res.redirect("/");
  }
};

module.exports = isLogin;

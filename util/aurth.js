const jwt = require("jsonwebtoken");
const config = require("../config");

const isAdmin = (req, res, nxt) => {
  try {
    let student = jwt.verify(req.cookies.student, config.jwtSecret);
    if (student && student.admin == "true") {
      nxt();
    } else {
      return res.sendStatus(404);
    }
  } catch (err) {
    // malformed or missing cookie — treat as not authenticated
    return res.sendStatus(404);
  }
};

module.exports = isAdmin;

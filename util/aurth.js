const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const config = require("../config");
const auth = require("../models/user");

const isAdmin = async (req, res, nxt) => {
  let claims;
  try {
    claims = jwt.verify(req.cookies.student, config.jwtSecret);
  } catch (err) {
    return res.redirect("/login");
  }

  if (!claims || !mongoose.isValidObjectId(claims.studentCard)) {
    return res.redirect("/login");
  }

  let user;
  try {
    user = await auth.findById(claims.studentCard).select("admin").lean();
  } catch (err) {
    return nxt(err);
  }

  if (!user) return res.redirect("/login");

  if (user.admin == "true") return nxt();
  return res.sendStatus(403);
};

module.exports = isAdmin;

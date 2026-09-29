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

  /* The lookup was unguarded. This is an async middleware, and Express 4 does
     not catch a rejected promise from one, so a dropped database connection here
     became an unhandled rejection: the request never answered and the client
     hung until it gave up. Handed to the error handler in app.js instead. */
  let user;
  try {
    user = await auth.findOne({ _id: s });
  } catch (err) {
    return nxt(err);
  }

  /* Admins are not subscribers, so they own no months — addAdmin (app.js)
     creates the admin document without a `month` array at all. Checked BEFORE
     the ownership test, because Array.isArray(undefined) is false and every
     /lessons/… and /content/… URL therefore answered 404 to the one account
     that is supposed to be able to see all of them.

     The database document decides, not the JWT claim: `user` is already
     loaded for the ownership check below, and a cookie minted while an
     account was still an admin keeps asserting admin:"true" until it
     expires. Revoking the flag in the database takes effect immediately. */
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

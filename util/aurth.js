const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const config = require("../config");
const auth = require("../models/user");

/* Admin gate. Two things changed here, both proven against the running server.

   1. THE ROLE COMES FROM THE DATABASE, NOT FROM THE TOKEN.
      It used to be `student.admin == "true"` read straight off the verified JWT
      claim. The signature check makes the claim authentic, but not current: the
      token is minted at login and never consulted again, so demoting an account
      in the database had no effect until the holder's cookie expired — and
      before util/authToken.js the cookie never expired at all. Anything that
      leaked a valid token also handed over admin permanently. Verified: a token
      carrying admin:"true" for an account whose stored admin is "false" opened
      /dashboard with a 200.
      util/authMonth.js already re-read the document for exactly this reason;
      this is the same rule applied to the role.

   2. THE ANSWER TO AN ANONYMOUS VISITOR IS THE LOGIN PAGE, NOT 404.
      Every isLogin-guarded URL redirects a visitor with no cookie to the login
      page, but the admin routers are mounted BEFORE isLogin in app.js, so those
      URLs answered a bare 404 instead. The same person got two different
      answers depending on which admin URL they typed — /dashboard redirected,
      /addStudent 404'd. Anonymous now always goes to /login.
      An authenticated non-admin gets 403, which is what "you are signed in and
      still may not do this" means. */
const isAdmin = async (req, res, nxt) => {
  let claims;
  try {
    claims = jwt.verify(req.cookies.student, config.jwtSecret);
  } catch (err) {
    /* Missing, malformed, expired, tampered with, or signed with a previous
       secret — all of them mean "not signed in". */
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

  /* No document means the account was deleted while its cookie was still in a
     browser. Not an authorization failure to hide behind a 403 — there is
     nobody to authorize — so it is treated as signed out. */
  if (!user) return res.redirect("/login");

  if (user.admin == "true") return nxt();
  return res.sendStatus(403);
};

module.exports = isAdmin;

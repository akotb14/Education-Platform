const jwt = require("jsonwebtoken");
const config = require("../config");

/* Authentication gate: is there a valid, unexpired session cookie at all?

   Mounted in app.js as `app.use("/", isLogin, router)`, so it runs for every
   request that reaches that line — not only for the paths the router itself
   declares.

   The destination on failure changed from "/" to "/login". The homepage is
   reachable without a cookie and only carries a link to the login form, so
   sending an unauthenticated visitor there cost them a second click and, worse,
   disagreed with util/aurth.js, which answered the same visitor differently.
   One answer for one situation. */
const isLogin = (req, res, nxt) => {
  let student;
  try {
    student = jwt.verify(req.cookies.student, config.jwtSecret);
  } catch (err) {
    /* Missing, malformed, expired, tampered with, or signed with a previous
       secret. Nothing here distinguishes them, and nothing should: the answer
       is the same and naming the reason would tell a guesser which of their
       guesses was closer. */
    return res.redirect("/login");
  }

  if (!student || !student.studentCard) {
    return res.redirect("/login");
  }

  return nxt();
};

module.exports = isLogin;

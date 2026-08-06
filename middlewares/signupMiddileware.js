const validator = require("../util/validSignup");

/* Validates the add-student form body against util/validSignup.js (Ajv).
   Mounted on POST /addStudent — routes/signup.router.js imported this module
   but never actually used it, so until now nothing on that form was validated.

   Two fixes over the original:

   1. It redirected to '/sign', which no longer exists. Now '/addStudent'.
   2. Its catch block did `console.log(err)` and nothing else — no next(), no
      response. A throw in here left the request hanging until the client timed
      out, with the admin looking at a spinner. It calls next(err) now so the
      Express error handler answers.

   `req.valid = 1` is kept because it is part of the original contract, even
   though no downstream handler reads it today. */
module.exports = (req, res, next) => {
  try {
    const isValid = validator(req.body);

    if (isValid) {
      req.valid = 1;
      return next();
    }

    /* connect-flash spreads an array value into separate entries, so
       req.flash("errorMsg") on the next request returns the flat list of Ajv
       error objects — which is what addStudent.ejs iterates over looking for
       matching instancePath values. */
    req.flash("errorMsg", validator.errors);
    return res.redirect("/addStudent");
  } catch (err) {
    return next(err);
  }
};

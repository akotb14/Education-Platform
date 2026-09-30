const validator = require("../util/validSignup");

module.exports = (req, res, next) => {
  try {
    const isValid = validator(req.body);

    if (isValid) {
      req.valid = 1;
      return next();
    }

    req.flash("errorMsg", validator.errors);
    return res.redirect("/addStudent");
  } catch (err) {
    return next(err);
  }
};

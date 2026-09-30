const csrf = require("csurf");
const config = require("../config");

module.exports = csrf({
  cookie: {
    key: "_csrf",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
  },
});

const csrf = require("csurf");
const config = require("../config");

/* ---------------------------------------------------------------------------
   ONE CSRF MIDDLEWARE, CONFIGURED ONCE

   `const csrfProtect = csrf({ cookie: true })` was written out eight times —
   routes/dashboard.js, exam.router.js, homework.router.js, login.router.js,
   quiz.router.js, signup.router.js, studentOnline.route.js, units.router.js —
   and every copy took csurf's defaults for the cookie it stores the secret in:

       { key: "_csrf", path: "/" }

   No httpOnly, no sameSite, no secure. Three consequences:

   · The secret was readable by any script on the page, including anything
     pulled from a CDN. CSRF protection is meant to survive an attacker who can
     make a browser send a request; a secret sitting in document.cookie means a
     single injected script can read it, mint a matching token and post as the
     admin. httpOnly costs nothing here — csurf reads this cookie server-side,
     and the token the form submits is a separate value rendered into the HTML.
   · Without `secure`, the cookie was sent over plain HTTP in production, so a
     network observer could collect the secret and forge tokens.
   · Without `sameSite`, it was attached to cross-site requests, which is the
     one situation the whole mechanism exists to defend against.

   Eight copies also meant eight places to change and seven places to forget.
   Every router now requires this module instead.

   `secure` follows NODE_ENV rather than being hardcoded on: a Secure cookie is
   not stored by a browser talking to http://localhost, and csurf would then
   reject every submission in development with no visible cause. Same rule as
   util/authToken.js, for the same reason.
   ------------------------------------------------------------------------- */
module.exports = csrf({
  cookie: {
    key: "_csrf",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
  },
});

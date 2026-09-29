const jwt = require("jsonwebtoken");
const config = require("../config");

/* The one place that mints the authentication cookie, and the one place that
   clears it. Two separate defects made this a module rather than two inline
   object literals in two different files.

   1. The token was signed with no `expiresIn`, so it never expired. A JWT is
      not stored server-side, so there is nothing to invalidate: a token copied
      off a shared computer, out of a database backup, or out of a log kept
      working for as long as the signing secret did. /logout deletes the
      browser's copy, which is all it can do — it cannot revoke the token
      itself. An expiry is the only thing that ends a leaked one.

   2. res.clearCookie only deletes a cookie when the options it is handed match
      the ones the cookie was created with — path, domain, secure and sameSite
      are all part of a cookie's identity for this purpose. The set site
      (controllers/signup.contr.js) and the clear site (app.js) were in
      different files and did not match, so hardening one without the other
      would have produced a logout that silently left the cookie in place.
      Both now go through cookieOptions().  */

const COOKIE = "student";

/* Seven days by default. Long enough that a student sitting a timed paper is
   never logged out by expiry — papers run up to an hour and a student may sit
   several in an afternoon — and short enough that a leaked token stops
   working. Overridable so a deployment can shorten it without a code change. */
const ttl = process.env.AUTH_TOKEN_TTL || "7d";

/* A cookie's Max-Age is in seconds; jsonwebtoken accepts "7d". The same value
   is parsed once so the two cannot disagree: a cookie that outlives its token
   logs the user out with no explanation, and a token that outlives its cookie
   is a credential that is still valid after the browser has forgotten it. */
const ttlSeconds = (function (value) {
  const m = String(value).match(/^(\d+)\s*([smhd])?$/);
  if (!m) return 7 * 24 * 60 * 60;
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] || "s"];
})(ttl);

function cookieOptions() {
  return {
    httpOnly: true,
    /* "lax", not "strict": the cookie has to survive a top-level navigation
       from outside the site — a link sent over WhatsApp, which is how students
       are given the address — or they arrive logged out every time. "lax" still
       withholds the cookie from a cross-site POST, which is what puts the
       student assessment POSTs (the ones with no csurf token yet) out of reach
       of a third-party page. */
    sameSite: "lax",
    /* A Secure cookie is never sent over plain HTTP, so setting it in
       development would break login on http://localhost outright. */
    secure: config.isProduction,
    path: "/",
  };
}

function issue(res, claims) {
  const token = jwt.sign(claims, config.jwtSecret, { expiresIn: ttl });
  res.cookie(
    COOKIE,
    token,
    Object.assign(cookieOptions(), { maxAge: ttlSeconds * 1000 })
  );
  return token;
}

function clear(res) {
  res.clearCookie(COOKIE, cookieOptions());
}

module.exports = { COOKIE, issue, clear, cookieOptions, ttl, ttlSeconds };

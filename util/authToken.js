const jwt = require("jsonwebtoken");
const config = require("../config");


const COOKIE = "student";

const ttl = process.env.AUTH_TOKEN_TTL || "7d";

const ttlSeconds = (function (value) {
  const m = String(value).match(/^(\d+)\s*([smhd])?$/);
  if (!m) return 7 * 24 * 60 * 60;
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] || "s"];
})(ttl);

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
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

/**
 * Centralised runtime configuration.
 *
 * Every secret is read from the environment here and nowhere else, so there is
 * a single place to audit. Missing values fail fast at boot rather than
 * surfacing as a confusing error on the first request that needs them.
 */
require("dotenv").config();

const required = ["DATABASE_PATH", "SecretPassword"];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    "\nMissing required environment variable(s): " +
      missing.join(", ") +
      "\nCopy .env.example to .env and fill in the values.\n"
  );
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === "production";

// The session secret is not in `required` so existing local setups keep
// working, but a hardcoded fallback must never reach production.
if (isProduction && !process.env.SESSION_SECRET) {
  console.error("\nSESSION_SECRET must be set when NODE_ENV=production.\n");
  process.exit(1);
}

module.exports = {
  isProduction,
  port: process.env.PORT || 5000,
  databaseUrl: process.env.DATABASE_PATH,
  jwtSecret: process.env.SecretPassword,
  sessionSecret: process.env.SESSION_SECRET || "dev-only-insecure-session-secret",
};

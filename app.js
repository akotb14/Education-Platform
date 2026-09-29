const express = require("express");
const app = express();
const fs = require("fs");
const path = require("path");

const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const session = require("express-session");
const flash = require("connect-flash");
const bodyParser = require("body-parser");
const config = require("./config");
/* `cors` was required and mounted as cors({}); see the note at the mount site
   for why it is gone. The dependency is left in package.json — removing it is a
   packaging decision, not an auth one. */
//import db
const connectDatabase = require("./models/connect_db");
connectDatabase.db();
const bcrypt = require("bcrypt");
const usermodel = require("./models/user");
const rateLimit = require("express-rate-limit");
const jwt =require("jsonwebtoken");
const authToken = require("./util/authToken");
// import routes
const loginRoute = require("./routes/login.router");
const signupRoute = require("./routes/signup.router");
const unitRoute = require("./routes/units.router");
const studentRoute = require("./routes/dashboard");

/* Boot-time administrator seed.

   This was:

       const hashpassword = await bcrypt.hash(`admin${card}`, salt);
       …
       addAdmin("admin1", 123456789101122, 123456789101122);

   — a full administrator account whose credentials were phone
   123456789101122 / password admin123456789101122, both written in this file
   and committed to the repository, recreated on every boot even if the account
   had been deleted. Anyone who has ever read this file, or cloned the
   repository, has been an administrator of every deployment of it. Verified
   against the running server: those credentials signed in and opened
   /dashboard.

   Now nothing is created unless ADMIN_PHONE, ADMIN_CARD and ADMIN_PASSWORD are
   all present in the environment, and the password is never derived from
   anything guessable.

   The published account cannot simply be deleted here: on a live installation
   it is the account the owner is signing in with, and deleting it would lock
   them out. So if it still exists AND still has the published password, boot
   either rotates it to ADMIN_PASSWORD or prints a warning naming the problem.
   Either way the account keeps working, and the published password stops being
   valid as soon as the operator sets one environment variable. */
const LEGACY_ADMIN_CARD = "123456789101122";

async function seedAdmin() {
  const phone = process.env.ADMIN_PHONE;
  const card = process.env.ADMIN_CARD;
  const password = process.env.ADMIN_PASSWORD;

  if (phone && card && password) {
    const existing = await usermodel.findOne({ phoneNumber: phone });
    if (!existing) {
      const salt = await bcrypt.genSalt(10);
      await new usermodel({
        fullName: process.env.ADMIN_NAME || "admin",
        phoneNumber: phone,
        admin: "true",
        cardNumber: card,
        password: await bcrypt.hash(password, salt),
      }).save();
      console.log("Created administrator account for phone " + phone);
    }
  }

  const legacy = await usermodel.findOne({ cardNumber: LEGACY_ADMIN_CARD });
  if (!legacy || !legacy.password) return;

  const stillPublished = await bcrypt.compare(
    "admin" + LEGACY_ADMIN_CARD,
    legacy.password
  );
  if (!stillPublished) return;

  if (password) {
    const salt = await bcrypt.genSalt(10);
    legacy.password = await bcrypt.hash(password, salt);
    await legacy.save();
    console.log(
      "SECURITY: the built-in administrator still had the password published in" +
        " this repository. It has been replaced with ADMIN_PASSWORD."
    );
  } else {
    console.error(
      "\n*** SECURITY WARNING ***" +
        "\nThe administrator account with card " + LEGACY_ADMIN_CARD + " still has the" +
        "\npassword that was hardcoded in this repository, so anyone who has seen the" +
        "\nsource can sign in as an administrator." +
        "\nSet ADMIN_PASSWORD in the environment and restart to replace it.\n"
    );
  }
}

/* Was called without await and without a catch, so a failure here surfaced as
   an unhandled rejection with no context. */
seedAdmin().catch((err) => {
  console.error("Administrator seed failed: " + err.message);
});

const port = config.port;

const date = new Date();

// helmet was installed and imported but never mounted.
// contentSecurityPolicy is disabled for now: the existing EJS views use inline
// scripts/styles and CDN assets that a default CSP would block. Re-enable it
// with an explicit policy once the React frontend replaces those views.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

/* Behind a reverse proxy every request arrives from the proxy's address, so the
   rate limiter below would see the whole internet as one client. `trust proxy`
   makes Express read the real address out of X-Forwarded-For — but that header
   is client-supplied, so enabling it WITHOUT a proxy in front lets anyone forge
   an address and defeat the limiter entirely. It is therefore opt-in, set only
   by a deployment that actually has one. */
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

// express-rate-limit was also imported but never mounted. Login is the
// endpoint worth protecting: it is the credential-guessing target.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Please try again later.",
});

/* POST only. Mounted as app.use(["/login","/sign"], loginLimiter) this counted
   page views as attempts: opening the login page twenty times in fifteen
   minutes — which is exactly what someone who keeps mistyping a password does —
   returned 429 for the page itself, leaving them no way back in and no way to
   tell why. Measured against the running server before the change: 22 of 24
   plain GETs of /login were rejected.

   `app.post(paths, mw)` registers the limiter for those two paths and no other
   method; it calls next() and the real route below still handles the request. */
app.post(["/login", "/sign"], loginLimiter);

/* app.use(cors({})) stood here. With no origin configured it answers every
   request with `Access-Control-Allow-Origin: *`, which is not a session-theft
   route on its own — it never set credentials:true, so a browser will not
   attach the auth cookie to a cross-origin XHR — but it is a permission this
   application has no use for. Every page is server-rendered EJS on one origin
   and there is no API client. If one is added later, re-enable it with an
   explicit origin allowlist rather than the empty default. */

/* public/ is genuinely public: the stylesheets, scripts and marketing images
   that the login page itself has to load before anyone is signed in. */
app.use(express.static("public"));

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.set("template engine", "ejs");

const isLogin = require("./util/auth");

/* ---------------------------------------------------------------------------
   THE TWO UPLOAD DIRECTORIES ARE NOT PUBLIC

   documantion/ and images/ are the destinations middlewares/upload.js writes
   to — every lesson PDF an admin uploads, and every question image. They were
   mounted exactly like public/:

       app.use(express.static("documantion"));
       app.use(express.static("images"));

   so every uploaded file was downloadable by anyone who knew or could guess the
   filename, with no cookie at all. Three consequences, all confirmed against
   the running server:

   · The isMonth subscription gate was decorative. It protects the page that
     links to a lesson PDF, not the PDF, and the PDF's URL is in that page's
     HTML — so any signed-in student could read every month's material, and any
     visitor at all could read it with the URL alone.
   · Files that have nothing to do with any lesson had become public documents.
     documantion/ currently holds two CVs and a password-manager recovery
     phrase. GET returned 200 to a client with no cookie.
   · Nothing in the filename says which month, grade or student a file belongs
     to, so nothing downstream could have re-imposed the gate either.

   Gated behind isLogin, which is why cookieParser has to run before this point:
   isLogin reads req.cookies.

   The gate is a filesystem test rather than a mounted path prefix because the
   URLs are already in circulation: views/lesson.ejs links a PDF as
   "/<filename>.pdf" and question images are stored in the database as their own
   root-relative paths. Moving the mount to "/documantion" would have broken
   every stored value. So instead: if a request looks like a file and a file of
   that name exists in one of the two upload directories, it needs a session.
   Everything else falls through untouched, including the anonymous homepage.

   Per-month authorization for lesson PDFs is a stronger rule than this one and
   needs the filename mapped back to its lesson — that is Phase 2 work, noted in
   the report. This closes the anonymous hole. */
const UPLOAD_DIRS = [
  path.join(__dirname, "documantion"),
  path.join(__dirname, "images"),
];

function isUploadedFile(urlPath) {
  let name;
  try {
    name = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  } catch (e) {
    return false; // undecodable %-escape: not a name upload.js can have written
  }
  /* One path segment. upload.js names files `${Date.now()}_${safeName}`, so a
     value containing a separator or a ".." segment is not one of ours, and
     letting it through to fs.existsSync would be a path-traversal probe. */
  if (!name || name.indexOf("/") !== -1 || name.indexOf("\\") !== -1) return false;
  return UPLOAD_DIRS.some((dir) => fs.existsSync(path.join(dir, name)));
}

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  /* Only asset-shaped URLs are tested, so an ordinary route costs no stat call.
     public/ is served above this line, so its assets never reach here. */
  if (!/\.[A-Za-z0-9]{1,5}$/.test(req.path)) return next();
  if (!isUploadedFile(req.path)) return next();
  return isLogin(req, res, next);
});
app.use(express.static("documantion"));
app.use(express.static("images"));

/* Rendered pages must not be cached. Without this, the browser's history cache
   can redraw a page from before a logout when the user presses Back — the
   session is gone but the content is still on screen, which is what "back
   navigation must not bypass authorization" is about. Mounted after every
   express.static call so it applies to pages, not to assets. */
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(
  session({
    secret: config.sessionSecret,
    /* The session exists only to carry connect-flash messages across a
       redirect. saveUninitialized:true created and stored one — and sent a
       session cookie — for every visitor who had no message to carry,
       crawlers included, and resave:true wrote each of them back on every
       single request. Both off: connect-flash marks the session modified when
       it writes a message, and a modified session is still saved. */
    saveUninitialized: false,
    resave: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: 60 * 60 * 1000,
    },
  })
);
app.use(flash());

const quiza = require("./routes/quiz.router");
const quizRoute = require("./routes/exam.router");
const showAnswer = require("./routes/showAnswer.router");
const homework = require("./routes/homework.router");
const loginOnline = require("./routes/studentOnline.route");
const user = require("./models/user");

/* A `writeUsers()` helper stood here that rewrote degree.json in place, and a
   commented-out /getcsv route below it. Neither was referenced anywhere.
   writeUsers is removed rather than left: it is an unguarded whole-file rewrite
   of production data sitting one call away in the same module. */

app.get("/", (req, res) => {
  let claims = null;
  if (req.cookies.student) {
    try {
      claims = jwt.verify(req.cookies.student, config.jwtSecret);
    } catch (e) {
      /* Expired, tampered with, or signed with an earlier secret.

         The catch used to wrap the whole handler and only console.log, so a
         cookie that failed verification produced NO RESPONSE AT ALL — the
         request hung until the browser gave up. Confirmed against the running
         server: GET / with a cookie of "not-a-jwt-at-all" never answered.

         Clearing the cookie matters as much as answering. Without that, every
         subsequent request carries the same unusable value and the visitor
         cannot reach a working homepage again without clearing it themselves.

         `console.log(deName)` also stood in the success path, printing the whole
         token payload — name, subject, grade, role — for every homepage hit. */
      authToken.clear(res);
      claims = null;
    }
  }
  res.render("index.ejs", {
    name: claims ? claims.nameStudent : undefined,
    isAdmin: claims && claims.admin == "true" ? "true" : "",
  });
});

app.get("/logout", (req, res) => {
  /* clearCookie deletes a cookie only when handed the same options it was set
     with, so this goes through authToken rather than a bare clearCookie — see
     util/authToken.js.

     A JWT is not stored server-side, so this removes the browser's copy and
     nothing more: a token already copied elsewhere stays valid until it
     expires. The expiry added in util/authToken.js is what bounds that.

     The flash session is destroyed too, so a message queued before logout is
     not shown to whoever signs in next on the same browser. destroy() drops the
     record in the store but does not touch the browser, which was leaving
     connect.sid behind pointing at a session that no longer exists — verified
     against the running server — so the cookie is cleared with the same options
     the session middleware set it with. */
  authToken.clear(res);
  const done = () => {
    res.clearCookie("connect.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      path: "/",
    });
    res.redirect("/");
  };
  if (req.session) return req.session.destroy(done);
  done();
});

//use route

app.use("/", loginRoute);
app.use("/", loginOnline);
app.use("/", signupRoute);
app.use("/", isLogin, quiza);
app.use("/", isLogin, quizRoute);
app.use("/", isLogin, showAnswer);
app.use("/", isLogin, homework);
app.use("/", isLogin, unitRoute.router);
app.use("/", studentRoute);

/* A second `app.get("/student", isAdmin, …)` stood here. routes/dashboard.js
   already declares GET /student and is mounted on the line above, so this one
   never ran — but it was one mount-order change away from running, and its query
   had no .select() projection at all. It fetched every field of every user,
   password hashes included, and handed the whole array to admin/users.ejs.
   dashboard.js's version projects explicitly and paginates. */

/* ---------------------------------------------------------------------------
   404, then errors. Neither existed.

   Routes throughout the app call next(err) — signup.contr.js, every admin
   router, the validation middleware — and with no error handler mounted those
   all fell through to Express's built-in one, which outside production writes
   the exception's STACK TRACE into the response body. File paths, line numbers
   and library versions, to whoever triggered the error.

   Both must be last: Express tries handlers in mount order, so a 404 declared
   earlier would swallow every route below it.
   --------------------------------------------------------------------------- */

/* Deliberately plain, and self-contained rather than an EJS view that pulls in
   the site chrome: the chrome's partials read locals that an error path cannot
   promise, and a template failure inside an error handler is how a 404 becomes
   an unhandled exception. Phase 6 can dress it. */
function errorPage(res, status, heading, detail) {
  res.status(status).type("html").send(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      "<title>" + heading + "</title><style>" +
      "body{margin:0;min-height:100vh;display:grid;place-items:center;" +
      "background:#f6f7f9;color:#1f2430;font-family:system-ui,'Segoe UI',sans-serif}" +
      "div{text-align:center;padding:2rem}h1{font-size:3rem;margin:0 0 .5rem}" +
      "p{margin:0 0 1.5rem;color:#5b6472}" +
      "a{display:inline-block;padding:.7rem 1.4rem;border-radius:.5rem;" +
      "background:#a3231f;color:#fff;text-decoration:none;font-weight:700}" +
      "</style></head><body><div><h1>" + status + "</h1><p>" + detail +
      '</p><a href="/">الرجوع إلى الصفحة الرئيسية</a></div></body></html>'
  );
}

app.use((req, res) => {
  errorPage(res, 404, "غير موجود", "الصفحة غير موجودة.");
});

app.use((err, req, res, next) => {
  /* Something already started writing the response; there is nothing left to
     say and Express's own handler will close the connection. */
  if (res.headersSent) return next(err);

  const status = err.status || err.statusCode || 500;

  /* csurf's own code. A stale token is what a user who left a form open past
     the session's hour sees, so it says so rather than reading as a fault. */
  if (err.code === "EBADCSRFTOKEN") {
    console.error("Rejected CSRF token: " + req.method + " " + req.originalUrl);
    return errorPage(
      res, 403, "طلب مرفوض",
      "انتهت صلاحية الصفحة. من فضلك أعد تحميلها وحاول مرة أخرى."
    );
  }

  /* A malformed :id in a URL. mongoose throws this before any query runs, so it
     is a bad request, not a server fault, and it must not be logged as one. */
  if (err.name === "CastError") {
    return errorPage(res, 400, "طلب غير صحيح", "الرابط غير صحيح.");
  }

  if (err.name === "ValidationError") {
    return errorPage(res, 400, "طلب غير صحيح", "البيانات المُرسلة غير صحيحة.");
  }

  /* The stack goes to the server log and only there. */
  console.error(
    "Unhandled error on " + req.method + " " + req.originalUrl + "\n",
    err.stack || err
  );
  errorPage(res, status, "خطأ في الخادم", "حدث خطأ غير متوقع. حاول مرة أخرى.");
});

//listen server
app.listen(port, () => {
  console.log("server is connected" + port);
});


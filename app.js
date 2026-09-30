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
const connectDatabase = require("./models/connect_db");
connectDatabase.db();
const bcrypt = require("bcrypt");
const usermodel = require("./models/user");
const rateLimit = require("express-rate-limit");
const jwt =require("jsonwebtoken");
const authToken = require("./util/authToken");
const loginRoute = require("./routes/login.router");
const signupRoute = require("./routes/signup.router");
const unitRoute = require("./routes/units.router");
const studentRoute = require("./routes/dashboard");

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

seedAdmin().catch((err) => {
  console.error("Administrator seed failed: " + err.message);
});

const port = config.port;

const date = new Date();

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Please try again later.",
});

app.post(["/login", "/sign"], loginLimiter);


app.use(express.static("public"));

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.set("view engine", "ejs");

const isLogin = require("./util/auth");

const UPLOAD_DIRS = [
  path.join(__dirname, "documentation"),
  path.join(__dirname, "images"),
];

function isUploadedFile(urlPath) {
  let name;
  try {
    name = decodeURIComponent(urlPath.replace(/^\/+/, ""));
  } catch (e) {
    return false;
  }
  if (!name || name.indexOf("/") !== -1 || name.indexOf("\\") !== -1) return false;
  return UPLOAD_DIRS.some((dir) => fs.existsSync(path.join(dir, name)));
}

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (!/\.[A-Za-z0-9]{1,5}$/.test(req.path)) return next();
  if (!isUploadedFile(req.path)) return next();
  return isLogin(req, res, next);
});
app.use(express.static("documentation"));
app.use(express.static("images"));

app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(
  session({
    secret: config.sessionSecret,
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


app.get("/", (req, res) => {
  let claims = null;
  if (req.cookies.student) {
    try {
      claims = jwt.verify(req.cookies.student, config.jwtSecret);
    } catch (e) {
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


app.use("/", loginRoute);
app.use("/", loginOnline);
app.use("/", signupRoute);
app.use("/", isLogin, quiza);
app.use("/", isLogin, quizRoute);
app.use("/", isLogin, showAnswer);
app.use("/", isLogin, homework);
app.use("/", isLogin, unitRoute.router);
app.use("/", studentRoute);



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
  if (res.headersSent) return next(err);

  const status = err.status || err.statusCode || 500;

  if (err.code === "EBADCSRFTOKEN") {
    console.error("Rejected CSRF token: " + req.method + " " + req.originalUrl);
    return errorPage(
      res, 403, "طلب مرفوض",
      "انتهت صلاحية الصفحة. من فضلك أعد تحميلها وحاول مرة أخرى."
    );
  }

  if (err.name === "CastError") {
    return errorPage(res, 400, "طلب غير صحيح", "الرابط غير صحيح.");
  }

  if (err.name === "ValidationError") {
    return errorPage(res, 400, "طلب غير صحيح", "البيانات المُرسلة غير صحيحة.");
  }

  console.error(
    "Unhandled error on " + req.method + " " + req.originalUrl + "\n",
    err.stack || err
  );
  errorPage(res, status, "خطأ في الخادم", "حدث خطأ غير متوقع. حاول مرة أخرى.");
});

app.listen(port, () => {
  console.log("server is connected" + port);
});


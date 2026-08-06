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
const cors = require("cors");
//import db
const connectDatabase = require("./models/connect_db");
connectDatabase.db();
const bcrypt = require("bcrypt");
const usermodel = require("./models/user");
const rateLimit = require("express-rate-limit");
const jwt =require("jsonwebtoken");
// import routes
const loginRoute = require("./routes/login.router");
const signupRoute = require("./routes/signup.router");
const unitRoute = require("./routes/units.router");
const studentRoute = require("./routes/dashboard");

async function addAdmin(name, card, phone) {
  let salt = await bcrypt.genSalt(10);
  const hashpassword = await bcrypt.hash(`admin${card}`, salt);

  const findAdmin = await usermodel.findOne({ phoneNumber: phone });
  if (!findAdmin) {
    const admin = new usermodel({
      fullName: name,
      phoneNumber: phone,
      admin: "true",
      cardNumber: card,
      password: hashpassword,
    });
    await admin.save();
  }
}

addAdmin("admin1", 123456789101122, 123456789101122);
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

// express-rate-limit was also imported but never mounted. Login is the
// endpoint worth protecting: it is the credential-guessing target.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Please try again later.",
});
app.use(["/login", "/sign"], loginLimiter);

app.use(cors({}));
app.use(express.static("public"));
app.use(express.static("documantion"));
app.use(express.static("images"));

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.set("template engine", "ejs");
app.use(
  session({
    secret: config.sessionSecret,
    saveUninitialized: true,
    resave: true,
  })
);
app.use(flash());

const isAdmin = require("./util/aurth");
const isLogin = require("./util/auth");
const quiza = require("./routes/quiz.router");
const quizRoute = require("./routes/exam.router");
const showAnswer = require("./routes/showAnswer.router");
const homework = require("./routes/homework.router");
const loginOnline = require("./routes/studentOnline.route");
const user = require("./models/user");

async function writeUsers(){
  fs.readFile("degree.json" ,'utf8', (err , data)=>{
    let data1 = JSON.parse(data);
    console.log(data1[0]['_id']);
    for(let i=0; i<data1.length; i++){
      data1[i]['_id'] = {$oid:data1[i]['_id']}; 
      
    }
   
    fs.writeFileSync('degree.json', JSON.stringify(data1))
  } )
}

// app.get('/getcsv' ,isAdmin,async(req, res) => {
//   usermodel.find({} , {_id:0 , __v:0  ,month:0} , (err,user) => {
    
//     const fields = ['fullName', 'cardNumber' , 'phoneNumber' ,'grade'  , 'group','educetionlevel'   ,'admin']
//     const opts = { fields };
//     try{

//       const csv  = parse(user , opts);
//       fs.writeFile("user.csv", csv,(err)=>{
//         if(err) throw err;
//         console.log('success');
//       })
        

//       res.send(csv)
//     }catch(err){
//       console.error(err);
//     }
//   })
// })
app.get('/',(req, res) => {
 try{
	let deName;
    if (req.cookies.student) {
      deName = jwt.verify(req.cookies.student, process.env.SecretPassword);
      console.log(deName);
    } else {
      deName = "";
    }
    let isAdmin = "";
    if (deName.admin == "true") {
      isAdmin = deName.admin;
    }
  res.render('index.ejs',{name:deName.nameStudent, isAdmin: isAdmin});
 }catch(e){
	 console.log(e);
 }
 })
app.get("/logout", (req, res) => {
  console.log("ahmed");
  res.clearCookie("student");
  res.redirect("/");
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

app.get("/student", isAdmin, async (req, res) => {
  try {
    let filter = req.query.group;
    let q = filter == "All" || !filter ? null : { group: filter };
    res.render("admin/users.ejs", {
      student: await usermodel
        .find(q)
        .sort({ admin: -1, educetionlevel: 1, grade: 1, group: -1 })
        .where({ cardNumber: { $ne: 123456789101122 } }),
    });
  } catch (err) {
    console.log(err);
    res.sendStatus(400);
  }
});

//listen server
app.listen(port, () => {
  console.log("server is connected" + port);
});
  

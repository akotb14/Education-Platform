const express = require('express');
const router = express.Router();
const contro = require("../controllers/signup.contr");
const csrfProtect = require("../util/csrf");
router.get('/login',csrfProtect,(req,res)=>{
    res.render('login.ejs',{
        errorLogin:req.flash('loginError'),
        joinOk:req.flash('joinOk'),
        csrfToken :req.csrfToken()
    });
})

router.post('/login',csrfProtect,contro.login)
module.exports =router;  
const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "quiz" },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "auth" },
  isCheck: { type: String, default: "0" },
  totalDegree: String,
  type: {
    type: String,
    enum: ["quiz", "exam", "homework"],
  },

  /* When this student's own attempt runs out. Set once, when the attempt is
     created, from the quiz's quizTime.

     The countdown used to live in a module-level `let d` in quiz.router.js and
     quiz.contro.js, decremented by a setInterval — ONE variable shared by every
     student on the server. Two students sitting a quiz at the same time
     decremented the same counter, and a student opening a paper saw whatever
     was left of somebody else's attempt. Restarting the server reset it, and
     the interval kept ticking after the response was sent.

     Untimed attempts (homework) leave this unset.

     Mongoose 6 runs strictQuery/strict true by default, so this had to be a
     real schema path — writing an off-schema field would have been silently
     dropped on save and silently stripped from any query filter. */
  deadline: Date,
});
module.exports = mongoose.model("degreeQuiz", schema);

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

  deadline: Date,

  late: { type: Boolean, default: false },
  lateBy: Number,

  writtenAnswers: [
    {
      index: Number,
      text: String,
      score: Number,
      feedback: String,
      gradedAt: Date,
    },
  ],

  answers: [{ index: Number, value: String, correct: Boolean }],

  manualDegree: Number,

  gradedAt: Date,
  gradedBy: String,

  submittedAt: Date,

  needsReview: { type: Boolean, default: false },
});
module.exports = mongoose.model("degreeQuiz", schema);

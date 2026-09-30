const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  educetionlevel: String,
  grade: String,
  nameQuiz:String,

  description: String,

  month:String,
  unit:String,
  quiz: [
    {
      no: String,
      image: String,
      question: String,
      answer: [Array],
      correctAnswer: String,

      qType: {
        type: String,
        enum: ["mcq", "truefalse", "explain"],
        default: "mcq",
      },

      modelAnswer: String,

      maxScore: { type: Number, default: 5, min: 1, max: 100 },
    },
  ],
  type:{
    type:String,
    enum:['quiz','exam','homework']
  },
  startTime: String,
  endTime: String,
  quizTime: String,

  dueDate: String,
});
const model = mongoose.model("quiz", schema);
module.exports =  model

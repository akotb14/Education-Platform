const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  educetionlevel: String,
  grade: String,
  nameQuiz:String,

  /* Free text the admin writes about the paper as a whole — what it covers,
     how to approach it, what to revise first. Optional, and empty on every
     paper created before this field existed, so every reader has to treat an
     absent value as "no description" rather than rendering a blank block.

     It is PAPER-level information, which is the whole reason it lives here and
     not on a question: the settings form owns it and the questions form never
     touches it. Capped at 500 characters in the controller; the schema does not
     enforce the length, because a paper already on disk with a longer value
     must still load. */
  description: String,

  month:String,
  unit:String,
  quiz: [
    {
      no: String,
      image: String,
      question: String,
      /* [Array] — an array whose single element holds the options, so the
         options live at answer[0]. Every reader (quiz-paper.ejs,
         showAnswer.ejs, _edit-paper.ejs, util/questionTypes.optionsOf) does
         answer[0]; flattening this breaks every paper already saved. */
      answer: [Array],
      /* The option's TEXT, not its index — grading is a literal string
         compare by array position. */
      correctAnswer: String,

      /* PER-QUESTION type. Named qType and not `type` on purpose: the
         PAPER-level `type` below is quiz/exam/homework, and a subdocument
         field with the same name reading a different enum is a permanent
         hazard in any code handling both.

         The default only applies on write. Questions already on disk have no
         qType at all, so readers must not trust it — they go through
         util/questionTypes.typeOf(), which reads anything unrecognised as
         "mcq". See the comment there. */
      qType: {
        type: String,
        enum: ["mcq", "truefalse", "explain"],
        default: "mcq",
      },

      /* Explain only. The teacher-facing model answer, shown on the answer
         key. Optional — an Explain question is valid without one. */
      modelAnswer: String,

      /* Explain only: what this question is worth when a teacher marks it.

         Auto-graded questions ignore this field entirely — util/grading
         .pointsOf() returns 1 for them whatever is stored, and the admin form
         renders this input only inside the Explain fieldset. A hand-crafted
         POST therefore cannot make a multiple-choice question display as
         worth 3 while the grader keeps counting it as 1.

         Like qType above, the default applies only on WRITE: the Explain
         questions saved before this field existed carry no maxScore at all,
         and pointsOf() reads a missing value as the same default. A paper's
         denominator does not depend on the day its questions were saved. */
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

  /* HOMEWORK ONLY — when the homework is due, as the "YYYY-MM-DDTHH:MM" string
     a datetime-local input posts. Same storage as startTime/endTime above,
     which are Strings for the same reason: every screen prints them verbatim
     and nothing does date arithmetic on them.

     A separate field rather than reusing endTime, because endTime means
     "the window closes and the paper locks" — routes/exam.router.js gates an
     exam on it — and this deliberately does NOT lock anything.
     routes/homework.router.js reports homework as state "untimed" with
     opensAt/closesAt null, and a due date that silently started closing
     homework would change what students can open. So it is recorded and
     displayed; enforcement would be a separate decision. Overloading endTime
     would have made that decision by accident. */
  dueDate: String,
});
const model = mongoose.model("quiz", schema);
module.exports =  model

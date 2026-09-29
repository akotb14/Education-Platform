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

  /* THE SUBMISSION ARRIVED AFTER THE DEADLINE.

     `deadline` above made the countdown honest — it is a server-side
     timestamp, so refreshing the page or editing the client script cannot
     extend it. What it did NOT do was stop a late POST: all three graders
     gated on `totalDegree == null` alone and never compared the clock to this
     attempt's deadline, so a student who cleared the countdown's interval in
     the console kept the paper open and their late answers were accepted as
     though they were on time.

     util/attemptTime.js now checks every submission and stamps these two when
     it lands beyond the deadline plus a short grace window (which absorbs the
     network round-trip of an honest auto-submit at zero).

     The answers are still recorded and still graded — refusing the POST would
     award zero to a student whose connection dropped and destroy the only copy
     of their work, with nothing on screen to explain it. Instead the lateness
     is evidence: `lateBy` is the exact number of seconds, the attempt is
     forced into the teacher's marking queue, and a stalled submission can no
     longer pass silently as an on-time one.

     Absent on every attempt submitted before this existed, which reads as
     "not known to be late" — not as "on time" — and is why the screens label
     it only when the flag is actually set. */
  late: { type: Boolean, default: false },
  lateBy: Number,

  /* Written answers to "explain" questions, which no machine can mark,
     together with the mark a teacher later awarded them. `index` is the
     question's position in the paper's quiz array, so an answer — and its
     mark — stays attached to its question even if the paper is edited.

     Like `deadline` above, these have to be real schema paths: Mongoose 6
     runs strict:true by default, so an off-schema field is silently dropped
     on save and silently stripped from any query filter.

     `score` ABSENT MEANS UNMARKED, AND 0 IS A MARK. A teacher awarding zero
     is a decision; leaving the box empty is not. Everything that reads this
     tests `score == null` rather than falsiness, otherwise a question marked
     zero would sit in the queue for ever and its paper could never reach
     "graded".

     ROWS ARE KEYED BY index AND USED TO BE SPARSE — before manual marking
     existed, gradeSubmission stored a row only when the student typed
     something. Readers must look up by `index`, never by array position, and
     must iterate the PAPER's explain questions rather than this array, or
     every blank essay drops out of the marking queue.

     NOTE ON totalDegree, which is NOT reused for any of this.
     `totalDegree == null` is the platform's "started but not submitted"
     sentinel — quiz.router.js, homework.router.js, the alreadyTaken checks
     and the answer-key gate in showAnswer.router.js all test it — and its
     denominator is recomputed live as autoGradableCount(), one point per
     auto-graded question. Folding a 5-point essay mark into it would print a
     score above the maximum on every one of those screens. */
  writtenAnswers: [
    {
      index: Number,
      text: String,
      score: Number,
      feedback: String,
      gradedAt: Date,
    },
  ],

  /* WHAT THE STUDENT ACTUALLY PICKED, one row per auto-graded question.
     `value` is the option TEXT they chose (empty when they skipped it) and
     `correct` is the verdict recorded AT SUBMIT TIME, against the key as it
     stood then — so editing an option later cannot rewrite a past attempt.

     Until now only the aggregate count survived grading; the choices
     themselves were compared and discarded. Every attempt submitted before
     this field existed therefore has an empty array, which is why the review
     page shows "غير متاح" for those rather than a blank that would read as
     "answered nothing". */
  answers: [{ index: Number, value: String, correct: Boolean }],

  /* The sum of the marks a teacher awarded, recomputed from writtenAnswers on
     every save rather than incremented — a mark edited twice must not
     accumulate. Absent until the first mark is given.

     The FINAL score is totalDegree + manualDegree and is derived wherever it
     is shown (util/grading.totalsOf), never stored, so there is one source of
     truth for it. */
  manualDegree: Number,

  /* Audit line for the review page: when the last round of marks was saved,
     and the admin name off the JWT that saved it. */
  gradedAt: Date,
  gradedBy: String,

  /* When the attempt was handed in. _id.getTimestamp() gives the time the
     attempt was STARTED, which on a timed paper can be an hour earlier, so
     the two are not interchangeable. Absent on attempts submitted before this
     field existed — the queue falls back to the start time and labels it as
     such rather than presenting it as a hand-in time. */
  submittedAt: Date,

  /* True when this attempt contains a written answer that needs a human.
     Written once at submit time as a cheap filter for the grading queue —
     it is a HINT, not the status: util/grading.statusOf() recomputes from the
     paper and the stored marks, so a marked attempt cannot keep showing as
     pending and a paper that gained an essay after submission is not missed. */
  needsReview: { type: Boolean, default: false },
});
module.exports = mongoose.model("degreeQuiz", schema);

/* =========================================================================
   QUESTION TYPES — the one place that knows what kinds of question exist.

   Every question on the platform used to be a 4-option multiple choice, and
   the shape was hardcoded in four separate places: the admin form emitted
   exactly four choice boxes, parseQuestions looped `c < 4`, and all three
   graders did the same positional string compare. Adding a type meant
   editing all of them and keeping them in agreement by hand.

   Everything type-specific now lives here. A fourth type is one entry in
   TYPES, one label, one branch in parseQuestions and one <fieldset> in
   views/admin/_question-block.ejs — nothing else needs to know.

   THE ONE IDEA WORTH KNOWING: True/False is Multiple Choice with two
   options. It stores as answer: [["صح","خطأ"]] with correctAnswer holding
   the winning string, which is byte-for-byte the shape an MC question has
   always had. That is why the graders, the answer key and the edit-page
   question list needed no type awareness at all to support it.

   Only `explain` is genuinely new: free text, no machine-checkable key.

   WHY EVERY READ GOES THROUGH typeOf()
   `qType` has `default: "mcq"` in the schema, but a mongoose default only
   applies when a document is WRITTEN. Every question already on disk has no
   qType field whatsoever, and reading `q.qType` on one yields undefined.
   Trusting the default would misread the entire existing database — so
   nothing reads the field directly.
   ====================================================================== */

/* The stored values. English, like every other enum in the app (`type`,
   `grade`, `educetionlevel`) — these are database values and form `value`
   attributes; only the labels below are Arabic. */
const TYPES = ["mcq", "truefalse", "explain"];

const TYPE_LABELS = {
  mcq: "اختيار من متعدد",
  truefalse: "صح أو خطأ",
  explain: "سؤال مقالي",
};

/* Shown under the select in the admin form, so the admin knows what each
   type will do before picking it. */
const TYPE_HINTS = {
  mcq: "اكتب الاختيارات ثم علّم الإجابة الصحيحة.",
  truefalse: "عبارة يختار الطالب إن كانت صحيحة أم خاطئة.",
  explain: "إجابة مكتوبة. تُصحَّح يدويًا ولا تدخل في الدرجة التلقائية.",
};

/* THE True/False OPTION TEXT, defined once.

   correctAnswer is stored as the option's TEXT and graded with a literal
   `==` compare against what the student posted. If the form rendered "صح"
   while the grader expected "صحيح", every True/False answer on the platform
   would be marked wrong, with nothing on any screen to explain why. Both
   sides read this constant so they cannot disagree. */
const TF_OPTIONS = ["صح", "خطأ"];

/* Multiple choice bounds. Was a hardcoded exactly-4 everywhere.

   DEFAULT_OPTIONS is that historical 4, kept as the number of rows a fresh
   question block starts with. Starting at MIN_OPTIONS would be technically
   valid and quietly worse: four options is what nearly every question on this
   platform has, so an admin would have to press "add option" twice before
   typing anything, on every single question. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const DEFAULT_OPTIONS = 4;

/* The legacy-safe reader. An unrecognised value — a question saved before
   this feature, or a hand-crafted POST carrying `qType=nonsense` — reads as
   "mcq" rather than propagating something no branch handles. */
const typeOf = (q) => {
  if (!q) return "mcq";
  const t = typeof q === "string" ? q : q.qType;
  return TYPES.indexOf(t) !== -1 ? t : "mcq";
};

/* Can the server mark this question by itself? Everything except a written
   answer, which needs a human. */
const isAutoGradable = (q) => typeOf(q) !== "explain";

/* THE DENOMINATOR. A score is out of the questions the machine actually
   marked, not every question on the paper — otherwise a student who answered
   every auto-gradable question correctly on a 5-question paper with one
   Explain sees 4/5, which reads as one wrong rather than one unmarked.

   Takes the paper document (or its question array). */
const autoGradableCount = (paper) => {
  const list = Array.isArray(paper) ? paper : paper && Array.isArray(paper.quiz) ? paper.quiz : [];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (isAutoGradable(list[i])) n++;
  }
  return n;
};

/* Read the four choices off a stored question. answer is [Array] in the
   schema — an array whose single element holds the options — and a question
   saved in some older shape may hold [undefined]. Every caller was doing
   this defensively and slightly differently; one version here. */
const optionsOf = (q) => {
  const raw = q && Array.isArray(q.answer) ? q.answer[0] : null;
  if (!raw || typeof raw.length !== "number") return [];
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] == null ? "" : String(raw[i]).trim();
    if (v) out.push(v);
  }
  return out;
};

/* =========================================================================
   GRADING — one implementation, three callers.

   routes/quiz.router.js, routes/homework.router.js and postQuizApp in
   controllers/quiz.contro.js each carried their own copy of this loop. They
   agreed today only because nobody had touched one of them; adding Explain
   handling to three near-identical copies is exactly how they stop agreeing.

   THE POST CONTRACT IS UNCHANGED for auto-graded questions: the student page
   still posts radios named answer0..answerN carrying the option TEXT, and
   this still compares that text to correctAnswer by array position. Explain
   answers arrive under a separate `explain<i>` name so they can never
   collide with the positional compare.

   Returns { count, gradable, written, answers }:
     count     correct auto-graded answers — what totalDegree is set to
     gradable  how many questions that was out of
     written   [{index, text}] for the teacher to mark later — ONE ROW PER
               EXPLAIN QUESTION, including the ones left blank
     answers   [{index, value, correct}] per auto-graded question — what the
               student actually picked
   ====================================================================== */
const gradeSubmission = (paper, body) => {
  const list = Array.isArray(paper) ? paper : paper && Array.isArray(paper.quiz) ? paper.quiz : [];
  const src = body || {};

  let count = 0;
  let gradable = 0;
  const written = [];
  const answers = [];

  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q) continue;

    if (typeOf(q) === "explain") {
      const text = String(src[`explain${i}`] == null ? "" : src[`explain${i}`]).trim();
      /* A row for EVERY explain question, answered or not. This used to store
         one only when the student had typed something, which left the array
         sparse and — now that a teacher marks these — quietly dropped every
         blank essay out of the marking queue. A blank answer still needs a
         human to look at it and award zero; that is a decision, not a
         default. */
      written.push({ index: i, text: text });
      /* Never counted, and never counted against — the student is neither
         credited nor penalised for a question no machine can mark. */
      continue;
    }

    gradable++;
    /* `==` and not `===`, deliberately: both sides are strings in practice,
       but this is the comparison every existing attempt on the platform was
       graded with and tightening it here would be a silent behaviour change
       to historical grading. */
    const given = src[`answer${i}`];
    const right = given == q.correctAnswer;
    if (right) count++;

    /* WHAT THEY PICKED, kept. Only the total used to survive this loop, so
       no screen could ever show a student which question they got wrong.
       `correct` is recorded here, against the key as it stands at submit
       time, so editing an option later cannot rewrite a past attempt. */
    answers.push({
      index: i,
      value: given == null ? "" : String(given),
      correct: right,
    });
  }

  return { count: count, gradable: gradable, written: written, answers: answers };
};

/* Everything views/admin/_question-block.ejs needs, in one object to spread
   into res.render.

   EJS TEMPLATES CANNOT require(). They compile to a function whose scope has
   no module machinery in it, so `require` inside a template is not merely
   discouraged — it is undefined and throws at render time. util/tableFilters.js
   passes `qs` through locals for the same reason. Functions and objects travel
   through res.render locals perfectly well.

   Views must still read every one of these behind a `typeof` guard: EJS
   compiles with `with(locals)`, so referencing a key the caller did not pass
   throws ReferenceError rather than yielding undefined. */
function viewLocals() {
  return {
    QTYPES: TYPES,
    QTYPE_LABELS: TYPE_LABELS,
    QTYPE_HINTS: TYPE_HINTS,
    TF_OPTIONS: TF_OPTIONS,
    MIN_OPTIONS: MIN_OPTIONS,
    MAX_OPTIONS: MAX_OPTIONS,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    typeOf: typeOf,
    optionsOf: optionsOf,
    /* The degrees tables compute their own "out of" from the populated paper,
       so they need the denominator helper too. */
    autoGradableCount: autoGradableCount,
  };
}

module.exports = {
  TYPES,
  TYPE_LABELS,
  TYPE_HINTS,
  TF_OPTIONS,
  MIN_OPTIONS,
  MAX_OPTIONS,
  DEFAULT_OPTIONS,
  typeOf,
  isAutoGradable,
  autoGradableCount,
  optionsOf,
  gradeSubmission,
  viewLocals,
};

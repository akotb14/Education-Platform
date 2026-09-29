/* =========================================================================
   GRADING — what a question is worth, who marks it, and the join between a
   paper and one student's attempt.

   util/questionTypes.js knows what kinds of question exist. This module knows
   what they are WORTH and who marks them: the machine marks mcq/truefalse at
   one point each, a teacher marks explain at whatever the question is worth.

   WHY THIS IS A SEPARATE MODULE AND NOT MORE OF questionTypes.js
   Three screens need these numbers — the admin queue, the admin review page
   and the student's answer key — and all three are EJS templates that cannot
   require() anything (see viewLocals at the bottom). Keeping the arithmetic
   in one required module and spreading it into locals is the only way the
   three agree; the alternative is a fourth copy of the same sums written
   inline in a template, which is precisely how the three graders this app
   started with drifted apart.

   THE THREE NUMBERS, KEPT SEPARATE ON PURPOSE

     auto    correct auto-graded answers  ->  degreeQuiz.totalDegree
     manual  marks a teacher awarded      ->  degreeQuiz.manualDegree
     final   auto + manual                ->  DERIVED, never stored

   totalDegree is NOT widened to hold the total. `totalDegree == null` is the
   platform's "started but not submitted" sentinel, tested in
   routes/quiz.router.js, routes/homework.router.js, controllers/quiz.contro.js
   and as a `$ne: null` filter in routes/showAnswer.router.js. Its denominator
   is recomputed live from the paper at every display site as
   autoGradableCount() — one point per auto question. Folding a 5-point essay
   mark into it would print "درجتك 9 من 4" on every one of those screens.

   `final` is derived rather than stored for the reason a running total is
   never trusted: re-marking a question recomputes manualDegree from the
   per-question marks, so a mark edited twice cannot accumulate.

   LEGACY DATA. Every field this module reads is absent from documents already
   on disk — maxScore, answers, manualDegree, the marking fields. Each reader
   defaults it, so nothing needs migrating, and a paper with no Explain
   questions behaves exactly as it did before this file existed.
   ====================================================================== */

const qt = require("./questionTypes");

/* An auto-graded question has always been worth exactly one mark: the grader
   counts correct answers and the denominator counts questions. Named rather
   than left as a bare 1 so the sums below read as points, not as counts. */
const AUTO_POINTS = 1;

/* What an Explain question is worth when the admin does not say — and what
   the Explain questions created before maxScore existed read as. A mongoose
   default applies only on write, so those documents carry no maxScore at all;
   reading them as anything else here would make a paper's denominator depend
   on the day its questions happened to be saved. */
const DEFAULT_EXPLAIN_POINTS = 5;

const MIN_POINTS = 1;
const MAX_POINTS = 100;

/* Admin feedback is stored on the attempt and shown to the student. Capped so
   one paste cannot bloat the document; same cap as the modelAnswer textarea
   in views/admin/_question-block.ejs. */
const FEEDBACK_MAX = 2000;

/* The four states of an attempt's manual marking. English values, Arabic
   labels — the split every other enum in this app uses. */
const STATUS = {
  NONE: "none",
  PENDING: "pending",
  PARTIAL: "partial",
  GRADED: "graded",
};

const STATUS_LABELS = {
  none: "لا يحتاج تصحيحًا",
  pending: "بانتظار التصحيح",
  partial: "تصحيح جزئي",
  graded: "تم التصحيح",
};

/* The paper's question array, from either the document or a bare array — the
   same shape-tolerance questionTypes uses, because the same callers hand both
   modules the same two kinds of argument. */
const questionsOf = (paper) =>
  Array.isArray(paper) ? paper : paper && Array.isArray(paper.quiz) ? paper.quiz : [];

/* WHAT ONE QUESTION IS WORTH.

   Auto types return AUTO_POINTS unconditionally and ignore any stored
   maxScore. The admin form renders that input only inside the Explain
   fieldset, but a hand-crafted POST could set it on a multiple-choice
   question, and a question displayed as worth 3 that the grader counts as 1
   is a wrong total with nothing on screen to explain it. Ignoring the field
   for auto types is what makes that impossible rather than merely unlikely.

   For Explain: a missing or unparseable value reads as the default, and a
   stored value is floored and clamped into the bounds. Clamped on READ as
   well as on write, because a document can arrive from somewhere other than
   the admin form — a mark input rendered max="0" would be impossible to
   satisfy, and one rendered max="1e9" would let a single essay outweigh the
   entire rest of the paper. */
const pointsOf = (q) => {
  if (qt.typeOf(q) !== "explain") return AUTO_POINTS;
  const has = q && q.maxScore != null && String(q.maxScore).trim() !== "";
  const raw = has ? Number(q.maxScore) : NaN;
  if (!isFinite(raw)) return DEFAULT_EXPLAIN_POINTS;
  const n = Math.floor(raw);
  if (n < MIN_POINTS) return MIN_POINTS;
  if (n > MAX_POINTS) return MAX_POINTS;
  return n;
};

/* The auto denominator. Delegated, not reimplemented: this exact number is
   what totalDegree has always been out of, and it is recomputed from the same
   function at three separate display sites. A second implementation here that
   drifted by one would silently disagree with every score already on screen. */
const autoOutOf = (paper) => qt.autoGradableCount(paper);

/* The manual denominator — the most a teacher can award on this paper. */
const manualOutOf = (paper) => {
  const list = questionsOf(paper);
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (q && qt.typeOf(q) === "explain") n += pointsOf(q);
  }
  return n;
};
/* =========================================================================
   THE JOIN — a paper's questions against one student's attempt.

   THE TRAP THIS EXISTS TO AVOID: writtenAnswers is SPARSE. Until this change
   gradeSubmission stored a row only when the student typed something, so its
   `index` values have gaps and its array positions mean nothing. Anything
   that walks writtenAnswers positionally attaches an answer to the wrong
   question; anything that walks it at all drops every blank essay out of the
   marking queue, and a blank essay still needs a human to award it 0.

   So everything below iterates THE PAPER and looks the attempt's rows up by
   `index`. The paper is the only thing that knows how many questions there
   are and what each is worth.
   ====================================================================== */

/* index -> row, for either of the attempt's two index-keyed arrays. Later
   rows win, which only matters for documents that somehow hold a duplicate
   index; taking the last is the same thing a plain overwrite loop does. */
const byIndex = (list) => {
  const map = {};
  if (!Array.isArray(list)) return map;
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    if (!row || row.index == null) continue;
    const k = Number(row.index);
    if (!isFinite(k)) continue;
    map[k] = row;
  }
  return map;
};

/* Has this essay been marked? ZERO IS A MARK. `score` is a Number path, so an
   unmarked row holds undefined/null and a row marked zero holds 0 — testing
   truthiness here would leave every zero-marked question in the queue for
   ever, and the paper could never reach "graded". */
const isMarked = (row) => {
  if (!row || row.score == null || String(row.score).trim() === "") return false;
  return isFinite(Number(row.score));
};

/* One awarded mark, read back safely. Clamped to what the question is worth
   in case the paper's maxScore was lowered after marking. */
const markOf = (q, row) => {
  if (!isMarked(row)) return null;
  const n = Math.floor(Number(row.score));
  if (n < 0) return 0;
  const cap = pointsOf(q);
  return n > cap ? cap : n;
};

/* WHERE THE MARKING STANDS — derived, never read off a flag.

   needsReview is a denormalised hint that keeps the queue's query cheap; it
   is written once at submit time and says nothing about what has happened
   since. This recomputes from the paper and the stored marks, so an attempt
   that has been marked cannot keep showing "بانتظار التصحيح", and a paper
   that gained an Explain question after submission correctly reappears as
   needing work. */
const statusOf = (paper, attempt) => {
  const list = questionsOf(paper);
  const marks = byIndex(attempt && attempt.writtenAnswers);
  let essays = 0;
  let marked = 0;
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || qt.typeOf(q) !== "explain") continue;
    essays++;
    if (isMarked(marks[i])) marked++;
  }
  if (!essays) return STATUS.NONE;
  if (!marked) return STATUS.PENDING;
  return marked === essays ? STATUS.GRADED : STATUS.PARTIAL;
};

/* EVERY NUMBER A SCREEN SHOWS, computed in one place from the paper and the
   attempt. Nothing here is read back from a stored total.

     auto        the machine's count, or null when not submitted yet
     manual      the sum of awarded marks, recomputed from the marks
     final       auto + manual, the number the request calls the final score
     pending     essays still waiting for a human
     status      as above

   `auto` stays null for an unsubmitted attempt so callers can keep using the
   platform's existing "totalDegree == null means started but not handed in"
   test without a second sentinel; `final` is null for the same reason,
   because auto + manual on an unsubmitted attempt is not a score. */
const totalsOf = (paper, attempt) => {
  const list = questionsOf(paper);
  const a = attempt || {};
  const marks = byIndex(a.writtenAnswers);

  let manual = 0;
  let pending = 0;
  let essays = 0;

  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || qt.typeOf(q) !== "explain") continue;
    essays++;
    const m = markOf(q, marks[i]);
    if (m === null) pending++;
    else manual += m;
  }

  const autoMax = autoOutOf(list);
  const manualMax = manualOutOf(list);

  let auto = a.totalDegree == null || String(a.totalDegree).trim() === "" ? null : Number(a.totalDegree);
  if (auto !== null && !isFinite(auto)) auto = null;

  const submitted = auto !== null;
  const final = submitted ? auto + manual : null;
  const finalMax = autoMax + manualMax;

  return {
    auto: auto,
    autoOutOf: autoMax,
    manual: manual,
    manualOutOf: manualMax,
    final: final,
    finalOutOf: finalMax,
    pct: final !== null && finalMax > 0 ? Math.round((final / finalMax) * 100) : null,
    essays: essays,
    pending: pending,
    submitted: submitted,
    status: !essays
      ? STATUS.NONE
      : pending === essays
      ? STATUS.PENDING
      : pending
      ? STATUS.PARTIAL
      : STATUS.GRADED,
  };
};

/* ONE ROW PER QUESTION, in paper order — the shape both the admin review page
   and the student's answer key render from.

   Common: index, no, question, image, type, typeLabel, maxScore, auto.
   Auto questions add: options, correct, studentAnswer, answered, isCorrect,
   unknown.
   Explain questions add: text, model, score, feedback, graded.

   `unknown` is the honest answer for an attempt submitted before this feature
   existed: the student's individual choices were compared to the key and
   thrown away, and only the total survived. Rendering those as a blank would
   read as "answered nothing", which is a different and false claim. */
const reviewRows = (paper, attempt) => {
  const list = questionsOf(paper);
  const a = attempt || {};
  const picks = byIndex(a.answers);
  const marks = byIndex(a.writtenAnswers);
  const rows = [];

  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q) continue;

    const type = qt.typeOf(q);
    const row = {
      index: i,
      no: i + 1,
      question: q.question == null ? "" : String(q.question),
      /* Uploaded images land in ./images/ and are served from the root by
         app.js, so the file is at /<basename>. Stored values have been seen
         with both separators; take the LAST segment, not the second — the old
         answer key took [1] and rendered src="/" for anything deeper. */
      image: q.image ? "/" + encodeURIComponent(String(q.image).trim().split(/[\\/]/).pop()) : "",
      type: type,
      typeLabel: qt.TYPE_LABELS[type] || qt.TYPE_LABELS.mcq,
      maxScore: pointsOf(q),
      auto: type !== "explain",
    };

    if (row.auto) {
      const pick = picks[i];
      const has = !!pick;
      const given = has && pick.value != null ? String(pick.value).trim() : "";
      row.options = qt.optionsOf(q);
      row.correct = q.correctAnswer == null ? "" : String(q.correctAnswer).trim();
      row.unknown = !has;
      row.answered = has && given !== "";
      row.studentAnswer = given;
      /* Trust the flag written at submit time rather than re-comparing here:
         that compare happened against the key AS IT WAS when the student sat
         the paper, and an option edited since would silently rewrite history.
         Falls back to the compare only when the flag is absent. */
      row.isCorrect = has
        ? pick.correct != null
          ? !!pick.correct
          : given === row.correct
        : false;
      row.earned = row.isCorrect ? AUTO_POINTS : 0;
    } else {
      const mark = marks[i];
      row.text = mark && mark.text != null ? String(mark.text) : "";
      row.answered = row.text.trim() !== "";
      row.model = q.modelAnswer == null ? "" : String(q.modelAnswer).trim();
      row.score = markOf(q, mark);
      row.graded = row.score !== null;
      row.feedback = mark && mark.feedback != null ? String(mark.feedback) : "";
      row.earned = row.score === null ? 0 : row.score;
    }

    rows.push(row);
  }

  return rows;
};

/* =========================================================================
   APPLYING A ROUND OF MARKS.

   Takes the posted body, returns either an error or the complete
   writtenAnswers array to save plus the recomputed total. Fields are flat and
   index-based — score_3, feedback_3 — for the same reason the question
   builder uses q_0_a1: app.js parses with express.urlencoded({extended:
   false}), which has no bracket nesting, and the admin paper forms go through
   multer, which has none either.

   VALIDATION IS REFUSAL, NOT CLAMPING. An out-of-range mark comes back as an
   error the admin reads; silently clamping 50 to 5 stores a mark nobody
   chose and shows it as though they did.

   A BLANK SCORE MEANS "NOT MARKED YET", not zero — that is what lets an admin
   mark half a long paper, leave, and come back to the rest. Awarding zero is
   done by typing 0, which is a real mark and moves the paper towards
   "graded".

   The returned array is rebuilt from the paper rather than patched in place,
   so a blank essay that was never stored at submit time (every pre-change
   attempt) still gets a row when it is marked. Rows whose question is no
   longer an Explain question are carried through untouched: they hold text a
   student wrote, and a paper edited after the fact is not a reason to delete
   it. */
const applyMarks = (paper, attempt, body) => {
  const list = questionsOf(paper);
  const src = body || {};
  const existing = byIndex(attempt && attempt.writtenAnswers);
  const seen = {};
  const out = [];

  let manual = 0;
  let marked = 0;
  let essays = 0;

  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (!q || qt.typeOf(q) !== "explain") continue;

    essays++;
    seen[i] = true;

    const prev = existing[i] || {};
    const cap = pointsOf(q);
    const pos = i + 1;

    const rawScore = src[`score_${i}`];
    const scoreText = rawScore == null ? "" : String(rawScore).trim();

    let score = null;
    if (scoreText !== "") {
      /* Number("") is 0 and Number(" 3 ") is 3, so the blank case is filtered
         out above and the pattern rejects "3.5", "3abc" and "+3" before the
         range check ever runs. */
      if (!/^\d+$/.test(scoreText)) {
        return { error: `السؤال ${pos}: أدخل الدرجة كرقم صحيح.` };
      }
      score = Number(scoreText);
      if (score > cap) {
        return { error: `السؤال ${pos}: الدرجة القصوى ${cap}.` };
      }
    }

    let feedback = src[`feedback_${i}`] == null ? "" : String(src[`feedback_${i}`]).trim();
    if (feedback.length > FEEDBACK_MAX) {
      return { error: `السؤال ${pos}: الملاحظات أطول من ${FEEDBACK_MAX} حرف.` };
    }

    const row = {
      index: i,
      /* The student's own words. Never taken from the request — this form is
         the teacher's, and nothing on it may rewrite what was submitted. */
      text: prev.text == null ? "" : String(prev.text),
      feedback: feedback,
    };

    if (score === null) {
      /* Left blank: clears any previous mark, which is how an admin undoes a
         mark typed by mistake. */
      row.score = null;
      row.gradedAt = null;
    } else {
      row.score = score;
      marked++;
      manual += score;
      /* Keep the original timestamp when the mark is unchanged, so re-saving
         a paper to add feedback to one question does not restamp the rest. */
      row.gradedAt = isMarked(prev) && Number(prev.score) === score && prev.gradedAt ? prev.gradedAt : new Date();
    }

    out.push(row);
  }

  /* Anything the paper no longer asks about, preserved verbatim. */
  const old = Array.isArray(attempt && attempt.writtenAnswers) ? attempt.writtenAnswers : [];
  for (let k = 0; k < old.length; k++) {
    const row = old[k];
    if (!row || row.index == null || seen[Number(row.index)]) continue;
    out.push({
      index: Number(row.index),
      text: row.text == null ? "" : String(row.text),
      score: row.score == null ? null : Number(row.score),
      feedback: row.feedback == null ? "" : String(row.feedback),
      gradedAt: row.gradedAt || null,
    });
  }

  out.sort((x, y) => x.index - y.index);

  return {
    error: null,
    written: out,
    manualDegree: manual,
    marked: marked,
    essays: essays,
    status: !essays
      ? STATUS.NONE
      : !marked
      ? STATUS.PENDING
      : marked === essays
      ? STATUS.GRADED
      : STATUS.PARTIAL,
  };
};

/* Everything the grading views need, in one object to spread into res.render.

   EJS TEMPLATES CANNOT require() — they compile to a function whose scope has
   no module machinery, so `require` inside a template is undefined and throws
   at render time. util/questionTypes.viewLocals() and util/tableFilters.js
   pass their helpers through locals for the same reason.

   Views must still read every one of these behind a `typeof` guard: EJS
   compiles with `with(locals)`, so referencing a key the caller did not pass
   is a ReferenceError — and a render error bypasses the route's own try/catch,
   because Express hands it to its error handler instead. */
function viewLocals() {
  return {
    GSTATUS: STATUS,
    GSTATUS_LABELS: STATUS_LABELS,
    DEFAULT_EXPLAIN_POINTS: DEFAULT_EXPLAIN_POINTS,
    MIN_POINTS: MIN_POINTS,
    MAX_POINTS: MAX_POINTS,
    FEEDBACK_MAX: FEEDBACK_MAX,
    pointsOf: pointsOf,
    autoOutOf: autoOutOf,
    manualOutOf: manualOutOf,
    statusOf: statusOf,
    totalsOf: totalsOf,
    reviewRows: reviewRows,
  };
}

module.exports = {
  AUTO_POINTS,
  DEFAULT_EXPLAIN_POINTS,
  MIN_POINTS,
  MAX_POINTS,
  FEEDBACK_MAX,
  STATUS,
  STATUS_LABELS,
  pointsOf,
  autoOutOf,
  manualOutOf,
  statusOf,
  totalsOf,
  reviewRows,
  applyMarks,
  viewLocals,
};

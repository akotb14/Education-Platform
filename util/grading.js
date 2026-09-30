
const qt = require("./questionTypes");

const AUTO_POINTS = 1;

const DEFAULT_EXPLAIN_POINTS = 5;

const MIN_POINTS = 1;
const MAX_POINTS = 100;

const FEEDBACK_MAX = 2000;

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

const questionsOf = (paper) =>
  Array.isArray(paper) ? paper : paper && Array.isArray(paper.quiz) ? paper.quiz : [];

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

const autoOutOf = (paper) => qt.autoGradableCount(paper);

const manualOutOf = (paper) => {
  const list = questionsOf(paper);
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    if (q && qt.typeOf(q) === "explain") n += pointsOf(q);
  }
  return n;
};

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

const isMarked = (row) => {
  if (!row || row.score == null || String(row.score).trim() === "") return false;
  return isFinite(Number(row.score));
};

const markOf = (q, row) => {
  if (!isMarked(row)) return null;
  const n = Math.floor(Number(row.score));
  if (n < 0) return 0;
  const cap = pointsOf(q);
  return n > cap ? cap : n;
};

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
      text: prev.text == null ? "" : String(prev.text),
      feedback: feedback,
    };

    if (score === null) {
      row.score = null;
      row.gradedAt = null;
    } else {
      row.score = score;
      marked++;
      manual += score;
      row.gradedAt = isMarked(prev) && Number(prev.score) === score && prev.gradedAt ? prev.gradedAt : new Date();
    }

    out.push(row);
  }

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


const TYPES = ["mcq", "truefalse", "explain"];

const TYPE_LABELS = {
  mcq: "اختيار من متعدد",
  truefalse: "صح أو خطأ",
  explain: "سؤال مقالي",
};

const TYPE_HINTS = {
  mcq: "اكتب الاختيارات ثم علّم الإجابة الصحيحة.",
  truefalse: "عبارة يختار الطالب إن كانت صحيحة أم خاطئة.",
  explain: "إجابة مكتوبة. تُصحَّح يدويًا ولا تدخل في الدرجة التلقائية.",
};

const TF_OPTIONS = ["صح", "خطأ"];

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const DEFAULT_OPTIONS = 4;

const typeOf = (q) => {
  if (!q) return "mcq";
  const t = typeof q === "string" ? q : q.qType;
  return TYPES.indexOf(t) !== -1 ? t : "mcq";
};

const isAutoGradable = (q) => typeOf(q) !== "explain";

const autoGradableCount = (paper) => {
  const list = Array.isArray(paper) ? paper : paper && Array.isArray(paper.quiz) ? paper.quiz : [];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (isAutoGradable(list[i])) n++;
  }
  return n;
};

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
      written.push({ index: i, text: text });
      continue;
    }

    gradable++;
    const given = src[`answer${i}`];
    const right = given == q.correctAnswer;
    if (right) count++;

    answers.push({
      index: i,
      value: given == null ? "" : String(given),
      correct: right,
    });
  }

  return { count: count, gradable: gradable, written: written, answers: answers };
};

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

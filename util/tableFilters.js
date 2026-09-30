
const GROUPS = [
  { value: "OnlineStudent", label: "أونلاين" },
  { value: "Saturday", label: "السبت" },
  { value: "Sunday", label: "الأحد" },
  { value: "Monday", label: "الاثنين" },
  { value: "Tuesday", label: "الثلاثاء" },
  { value: "Wednesday", label: "الأربعاء" },
  { value: "Thursday", label: "الخميس" },
  { value: "Friday", label: "الجمعة" },
];

const GRADES = [
  { value: "1st", label: "الصف الأول" },
  { value: "2nd", label: "الصف الثاني" },
  { value: "3rd", label: "الصف الثالث" },
];

const SUBJECTS = [
  { value: "biology", label: "الأحياء" },
  { value: "geology", label: "الجيولوجيا" },
];

const SORTS = [
  { value: "", label: "الترتيب الافتراضي" },
  { value: "name_asc", label: "الاسم: أ ← ي" },
  { value: "name_desc", label: "الاسم: ي ← أ" },
];

function labelMap(list) {
  const out = {};
  for (const item of list) out[item.value] = item.label;
  return out;
}

const GROUP_LABEL = labelMap(GROUPS);
const GRADE_LABEL = labelMap(GRADES);
const SUBJECT_LABEL = labelMap(SUBJECTS);

const AR_COLLATION = { locale: "ar", strength: 1 };

const arCollator = new Intl.Collator("ar", { sensitivity: "base" });

function pick(raw, list) {
  if (typeof raw !== "string") return "";
  if (raw === "All" || raw === "") return "";
  return list.some((item) => item.value === raw) ? raw : "";
}

function parse(query) {
  const src = query && typeof query === "object" ? query : {};

  const group = pick(src.group, GROUPS);
  const grade = pick(src.grade, GRADES);
  const level = pick(src.educetionlevel, SUBJECTS);
  const sort = pick(src.sort, SORTS.filter((s) => s.value));

  let q = typeof src.q === "string" ? src.q.trim() : "";
  if (q.length > 80) q = q.slice(0, 80);

  return {
    group: group,
    grade: grade,
    level: level,
    sort: sort,
    q: q,
    active: !!(group || grade || level || q),
    touched: !!(group || grade || level || q || sort),
  };
}

function safeRegex(term) {
  return new RegExp(String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function studentFilter(f, base) {
  const filter = Object.assign({}, base || {});

  if (f.group) filter.group = f.group;
  if (f.grade) filter.grade = f.grade;
  if (f.level) filter.educetionlevel = f.level;

  if (f.q) {
    const rx = safeRegex(f.q);
    const clause = {
      $or: [{ fullName: rx }, { phoneNumber: rx }, { cardNumber: rx }],
    };
    filter.$and = (filter.$and || []).concat([clause]);
  }

  return filter;
}

function mongoSort(f, fallback) {
  if (f.sort === "name_asc") {
    return { sort: { fullName: 1, _id: 1 }, collation: AR_COLLATION };
  }
  if (f.sort === "name_desc") {
    return { sort: { fullName: -1, _id: 1 }, collation: AR_COLLATION };
  }
  return { sort: fallback || { _id: -1 }, collation: null };
}

function nameComparator(f) {
  if (f.sort !== "name_asc" && f.sort !== "name_desc") return null;
  const dir = f.sort === "name_asc" ? 1 : -1;
  return function (a, b) {
    return arCollator.compare(a || "", b || "") * dir;
  };
}

function toQuery(f, extra) {
  const parts = [];
  const add = function (k, v) {
    if (v) parts.push(k + "=" + encodeURIComponent(v));
  };

  if (extra) {
    for (const k of Object.keys(extra)) add(k, extra[k]);
  }
  add("group", f.group);
  add("grade", f.grade);
  add("educetionlevel", f.level);
  add("sort", f.sort);
  add("q", f.q);

  return parts.length ? "?" + parts.join("&") : "";
}

function viewLocals(f) {
  return {
    f: f,
    GROUPS: GROUPS,
    GRADES: GRADES,
    SUBJECTS: SUBJECTS,
    SORTS: SORTS,
    GROUP_LABEL: GROUP_LABEL,
    GRADE_LABEL: GRADE_LABEL,
    SUBJECT_LABEL: SUBJECT_LABEL,
    qs: toQuery,
  };
}

module.exports = {
  GROUPS,
  GRADES,
  SUBJECTS,
  SORTS,
  GROUP_LABEL,
  GRADE_LABEL,
  SUBJECT_LABEL,
  AR_COLLATION,
  arCollator,
  parse,
  safeRegex,
  studentFilter,
  mongoSort,
  nameComparator,
  toQuery,
  viewLocals,
};

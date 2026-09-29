/* =========================================================================
   SHARED TABLE FILTERS — group / subject / grade / name-sort.

   Three admin tables filter the same five student fields:

     /student                     views/admin/users.ejs
     /showStudentsDegree/:type    views/admin/showStudDegree.ejs
     /admin/studentOnline         views/admin/onlinestudent.ejs

   Before this module each of them (plus addStudent, editStudent and
   _assessment-form) carried its own copy of the GROUPS / GRADES / SUBJECTS
   maps. Six copies of the same eight weekday labels is six places to edit
   when a group is renamed, and they had already drifted: onlinestudent.ejs
   wrote GROUP_LABEL as a flat object while users.ejs derived it from an
   array. One definition here, exported to the routes and passed to the views.

   WHY THE VALUES STAY ENGLISH
   `group`, `grade` and `educetionlevel` hold English strings in MongoDB
   ("Monday", "2nd", "biology"). Those are the filter values and the option
   `value` attributes; only the labels are Arabic. Translating a value would
   stop it matching anything.

   WHY EVERY INCOMING VALUE IS WHITELISTED
   Express parses `?group[$ne]=x` into an OBJECT, not a string. Assigning that
   straight into a Mongo filter — `filter.group = req.query.group` — is an
   operator-injection hole: `{group: {$ne: "x"}}` returns every other group,
   and `$regex` / `$where` variants are worse. A `typeof === "string"` check
   blocks the object form, but only a whitelist blocks a string that is valid
   yet unintended. Anything not in these lists is dropped to "" = no filter.
   ====================================================================== */

/* Order is the display order in every dropdown. OnlineStudent first because
   it is the largest cohort, then the week in calendar order. */
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

/* Matches the `grade` enum in models/user.js and models/stundentOnline.js. */
const GRADES = [
  { value: "1st", label: "الصف الأول" },
  { value: "2nd", label: "الصف الثاني" },
  { value: "3rd", label: "الصف الثالث" },
];

/* `educetionlevel` (sic — the schema spelling) is the subject, not a level.
   No enum on the field, but these are the only two values the platform
   writes; see the selects in views/admin/_assessment-form.ejs. */
const SUBJECTS = [
  { value: "biology", label: "الأحياء" },
  { value: "geology", label: "الجيولوجيا" },
];

/* "" keeps whatever order the page already used, so an admin who touches no
   control sees exactly the list they saw before this feature existed. */
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

/* Arabic sorting is NOT code-point order. أ (0623) إ (0625) آ (0622) all sit
   BEFORE ا (0627), so a plain byte sort files "أحمد" ahead of "ابراهيم" —
   wrong, and the two spellings of one name land apart. strength 1 compares
   base letters only, folding the hamza forms together, which is what an admin
   scanning a roster expects. Same setting on both sides: `collation` below for
   sorts MongoDB performs, `Intl.Collator` for the one table that has to sort
   in JS (see nameComparator). */
const AR_COLLATION = { locale: "ar", strength: 1 };

const arCollator = new Intl.Collator("ar", { sensitivity: "base" });

/* Only accept a value the platform actually stores. */
function pick(raw, list) {
  if (typeof raw !== "string") return "";
  if (raw === "All" || raw === "") return "";
  return list.some((item) => item.value === raw) ? raw : "";
}

/* Reads the four filter controls plus the free-text box off req.query.

   `q` is the only field that cannot be whitelisted — it is arbitrary text.
   It is length-capped here and regex-escaped at the call site; see safeRegex
   in routes/dashboard.js. The cap stops a megabyte-long parameter reaching
   the regex engine. */
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
    /* Drives the "إلغاء التصفية" button and the filter-aware empty state.
       Deliberately excludes `sort` — reordering a list is not filtering it,
       and offering to "clear the filter" when only the sort is set reads as
       a bug. */
    active: !!(group || grade || level || q),
    /* Any control at all, for the export filename suffix. */
    touched: !!(group || grade || level || q || sort),
  };
}

/* Escapes a user term so it is matched literally. Without this, a search for
   "a.*" is a wildcard and "(((((((((((a" is catastrophic backtracking. Lifted
   from routes/dashboard.js so all three tables share one copy. */
function safeRegex(term) {
  return new RegExp(String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

/* Merges the parsed filters into `base` and returns a new object — `base` is
   never mutated, because the callers hold theirs as a module-level constant
   (STUDENT_FILTER in routes/dashboard.js) and mutating it would leak one
   request's filter into every later request on the same process.

   The free-text clause goes under `$and`, not `filter.$or = …`. Two of these
   tables already carry a top-level `$or` (the admin exclusion), and assigning
   `$or` would silently discard it — turning "students only" into "everyone".
   `$and` composes instead of overwriting. */
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

/* Returns { sort, collation } for a Mongo query. `fallback` is the page's
   existing default order, so a page with no sort selected keeps behaving
   exactly as it did.

   `_id` is appended as a tiebreaker on the name sorts, and it matters more
   than it looks: strength-1 collation makes "أحمد" and "احمد" EQUAL keys, and
   a Mongo sort on equal keys has no defined order between queries. On a
   paginated table (skip/limit issues one query per page) that lets the same
   student appear on page 1 and page 2 while another is never shown at all.
   A unique trailing key makes the order total, so pagination is consistent. */
function mongoSort(f, fallback) {
  if (f.sort === "name_asc") {
    return { sort: { fullName: 1, _id: 1 }, collation: AR_COLLATION };
  }
  if (f.sort === "name_desc") {
    return { sort: { fullName: -1, _id: 1 }, collation: AR_COLLATION };
  }
  return { sort: fallback || { _id: -1 }, collation: null };
}

/* For the one table that cannot sort in Mongo. The degrees page sorts by
   `student.fullName`, which lives in a DIFFERENT collection reached through
   populate — and populate is a second query, so `.sort({"student.fullName":1})`
   on the degrees query sorts on a path that does not exist in those documents
   and silently does nothing. That page sorts in JS instead.

   Returns null when no name sort is selected, so the caller can skip the sort
   entirely rather than reordering rows for nothing.

   No tiebreaker needed here: Array.prototype.sort has been stable since V8 7.0
   (Node 11), so rows with equal keys keep their incoming order. */
function nameComparator(f) {
  if (f.sort !== "name_asc" && f.sort !== "name_desc") return null;
  const dir = f.sort === "name_asc" ? 1 : -1;
  return function (a, b) {
    return arCollator.compare(a || "", b || "") * dir;
  };
}

/* Rebuilds the querystring so pagination links, the export button and the
   post-delete redirect all carry the filters the admin is looking at.

   `extra` is emitted first (page= reads better at the front) and empty values
   are skipped, so an untouched table still links to a bare "/student". */
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

/* Everything views/admin/_table-toolbar.ejs and the three tables need, in one
   object to spread into res.render. Without this each route would enumerate
   eight locals by hand, which is how the label maps drifted apart the first
   time. `qs` is handed over as a local because EJS templates cannot require —
   functions pass through res.render locals perfectly well.

   Views must still read every one of these behind a `typeof` guard: EJS
   compiles with `with(locals)`, so referencing a key the caller did not pass
   throws ReferenceError rather than yielding undefined. */
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

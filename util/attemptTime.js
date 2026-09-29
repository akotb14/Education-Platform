/* =========================================================================
   ATTEMPT TIMING — the allowance, the remaining time, and whether a
   submission arrived after the deadline.

   WHY THIS MODULE EXISTS

   1. allowanceSeconds() was written TWICE, byte-identically, in
      routes/quiz.router.js and controllers/quiz.contro.js. Two copies of one
      parse is how the three graders this app started with drifted apart.

   2. Nothing anywhere validated the SUBMISSION TIME. `degreeQuiz.deadline` is
      a real server-side timestamp, written once when the attempt is created,
      and the paper's countdown is rendered from it — so refreshing the page,
      moving the machine's clock or editing public/assets/js/quiz.js cannot
      extend it, because none of those touch the stored deadline.

      What they COULD do was submit after it. All three graders gated on
      `totalDegree == null` alone — "has this attempt been handed in yet" —
      and never compared the clock to `attempt.deadline`, which was loaded and
      ignored. A student who cleared the countdown's interval in the console
      kept the paper open indefinitely and their late answers were accepted as
      though they were on time. That is the one thing client-side code can
      still buy, and it is closed here.

   THE GRACE WINDOW, AND WHY IT IS NOT ZERO

   The client's auto-submit at zero is a network round-trip: the tick that
   reaches 0 fires form.submit(), the request is serialised and sent, and on a
   phone on mobile data the POST can land several seconds later. A cutoff at
   exactly `deadline` would mark a perfectly honest auto-submit late. GRACE
   absorbs that; it is short enough to be worthless as extra working time.

   WHAT HAPPENS BEYOND THE GRACE — a deliberate choice, stated plainly

   The submission is still RECORDED and still graded, and the attempt is
   closed. It is stamped `late: true` and `lateBy: <seconds>`, and forced into
   the teacher's marking queue (`needsReview`).

   The alternative — refusing the POST — reads as strict but in practice
   awards zero to a student whose laptop slept or whose connection dropped for
   a minute, destroys the only copy of their answers (there is no server-side
   autosave to fall back on), and does it with nothing on any screen to
   explain the zero. Recording the answers and the exact lateness leaves the
   decision with a human and leaves evidence; a stalled submission can no
   longer pass silently as an on-time one, which is what "the server must
   validate the submission time" is actually asking for.
   ====================================================================== */

/* Seconds past the deadline that still count as on time. */
const GRACE_SECONDS = 30;

/* quizTime is stored as "HH:MM" — ONE budget for the whole paper, not per
   question. Returns the allowance in seconds, or null when it is missing or
   unusable so callers can treat the paper as untimed rather than propagating
   a NaN into a Date.

   The code this replaces built it with
   dateQ.setHours(getHours() + hh, getMinutes() + mm) and subtracted two Date
   objects — a very long way round that silently produced NaN whenever
   quizTime was empty or malformed. */
const allowanceSeconds = (quizTime) => {
  if (!quizTime) return null;
  const parts = String(quizTime).split(":");
  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const secs = (isNaN(hh) ? 0 : hh) * 3600 + (isNaN(mm) ? 0 : mm) * 60;
  return secs > 0 ? secs : null;
};

/* The deadline as milliseconds, or null when this attempt has none.

   Untimed homework never gets one, and every attempt created before the
   `deadline` path existed has none either — both must read as untimed rather
   than as expired, or one deploy would retroactively close every attempt
   still open on the platform. */
const deadlineMs = (attempt) => {
  if (!attempt || !attempt.deadline) return null;
  const t = new Date(attempt.deadline).getTime();
  return isFinite(t) ? t : null;
};

/* Remaining time for THIS attempt, in whole seconds, clamped at 0 — a
   reopened expired attempt renders a stopped clock and auto-submits rather
   than counting down through negative numbers. null means untimed. */
const secondsLeft = (attempt, now) => {
  const end = deadlineMs(attempt);
  if (end === null) return null;
  const t = now == null ? Date.now() : now;
  return Math.max(0, Math.floor((end - t) / 1000));
};

/* How late a submission landing NOW would be, in whole seconds past the
   deadline, ignoring the grace window. 0 for an untimed attempt and for one
   still inside its allowance. */
const lateBy = (attempt, now) => {
  const end = deadlineMs(attempt);
  if (end === null) return 0;
  const t = now == null ? Date.now() : now;
  return t <= end ? 0 : Math.floor((t - end) / 1000);
};

/* Is a submission arriving now beyond the deadline AND beyond the grace?
   False for untimed attempts, so the homework grader can call this
   unconditionally and get the behaviour it has always had. */
const isLate = (attempt, now) => lateBy(attempt, now) > GRACE_SECONDS;

/* The three fields every grader stamps on a late attempt, in one place so the
   quiz, homework and exam copies cannot disagree about what "late" is
   recorded as. Returns an empty object for an on-time submission, so it
   spreads into the update with no effect.

   `needsReview` is deliberately OR-ed by the caller rather than set here: it
   already means "a human has to look at this paper" for essays, and a late
   hand-in is a second reason for the same queue. */
const lateFields = (attempt, now) => {
  const by = lateBy(attempt, now);
  if (by <= GRACE_SECONDS) return {};
  return { late: true, lateBy: by };
};

module.exports = {
  GRACE_SECONDS,
  allowanceSeconds,
  deadlineMs,
  secondsLeft,
  lateBy,
  isLate,
  lateFields,
};

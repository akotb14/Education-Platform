
const GRACE_SECONDS = 30;

const allowanceSeconds = (quizTime) => {
  if (!quizTime) return null;
  const parts = String(quizTime).split(":");
  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const secs = (isNaN(hh) ? 0 : hh) * 3600 + (isNaN(mm) ? 0 : mm) * 60;
  return secs > 0 ? secs : null;
};

const deadlineMs = (attempt) => {
  if (!attempt || !attempt.deadline) return null;
  const t = new Date(attempt.deadline).getTime();
  return isFinite(t) ? t : null;
};

const secondsLeft = (attempt, now) => {
  const end = deadlineMs(attempt);
  if (end === null) return null;
  const t = now == null ? Date.now() : now;
  return Math.max(0, Math.floor((end - t) / 1000));
};

const lateBy = (attempt, now) => {
  const end = deadlineMs(attempt);
  if (end === null) return 0;
  const t = now == null ? Date.now() : now;
  return t <= end ? 0 : Math.floor((t - end) / 1000);
};

const isLate = (attempt, now) => lateBy(attempt, now) > GRACE_SECONDS;

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

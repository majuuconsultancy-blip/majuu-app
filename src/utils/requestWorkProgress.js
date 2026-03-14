function safeStr(value) {
  return String(value || "").trim();
}

export const STAFF_PROGRESS_OPTIONS = Object.freeze([10, 20, 30, 40, 50, 60, 70, 80, 90]);

export function toRequestProgressMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeStaffProgressPercent(value) {
  const next = Math.round(Number(value));
  return STAFF_PROGRESS_OPTIONS.includes(next) ? next : null;
}

export function getRequestStartedAtMs(request) {
  const data = request && typeof request === "object" ? request : {};
  const staffStartedAtMs =
    toRequestProgressMillis(data.staffStartedAtMs) || toRequestProgressMillis(data.staffStartedAt);
  const markedInProgressAtMs =
    toRequestProgressMillis(data.markedInProgressAtMs) ||
    toRequestProgressMillis(data.markedInProgressAt);

  return Math.max(0, staffStartedAtMs, markedInProgressAtMs);
}

export function getRequestWorkProgress(request) {
  const data = request && typeof request === "object" ? request : {};
  const status = safeStr(data.status).toLowerCase();
  const staffStatus = safeStr(data.staffStatus).toLowerCase();
  const progressPercent = normalizeStaffProgressPercent(data.staffProgressPercent);
  const progressUpdatedAtMs =
    toRequestProgressMillis(data.staffProgressUpdatedAtMs) ||
    toRequestProgressMillis(data.staffProgressUpdatedAt);
  const startedAtMs = getRequestStartedAtMs(data);

  const isFinalized = status === "closed" || status === "rejected";
  const hasLegacyInProgressStatus =
    status === "contacted" || status === "active" || status === "in_progress" || status === "in-progress";
  const hasStartedEvidence =
    startedAtMs > 0 ||
    staffStatus === "in_progress" ||
    staffStatus === "done" ||
    hasLegacyInProgressStatus;

  const isInProgress =
    !isFinalized &&
    (staffStatus === "in_progress" ||
      (staffStatus !== "done" && (hasLegacyInProgressStatus || startedAtMs > 0)));

  return {
    status,
    staffStatus,
    startedAtMs,
    progressPercent,
    progressUpdatedAtMs,
    isFinalized,
    isStarted: hasStartedEvidence,
    isInProgress,
  };
}

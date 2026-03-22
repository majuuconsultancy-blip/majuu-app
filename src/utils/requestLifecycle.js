function safeStr(value) {
  return String(value || "").trim();
}

function lower(value) {
  return safeStr(value).toLowerCase();
}

function toMillis(value) {
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

export const REQUEST_BACKEND_STATUSES = Object.freeze({
  NEW: "new",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
});

export const REQUEST_USER_STATUSES = Object.freeze({
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
});

export function isLegacyRequestCompleted(request) {
  const status = lower(request?.status);
  return status === "closed" || status === "accepted" || status === "rejected";
}

export function hasRequestEverBeenAssigned(request) {
  if (request?.everAssigned === true) return true;

  const assignedTo = safeStr(request?.assignedTo);
  const assignedAtMs = toMillis(request?.assignedAt);
  const staffStatus = lower(request?.staffStatus);
  const backendStatus = lower(request?.backendStatus);

  return Boolean(
    assignedTo ||
      assignedAtMs > 0 ||
      backendStatus === REQUEST_BACKEND_STATUSES.ASSIGNED ||
      backendStatus === REQUEST_BACKEND_STATUSES.IN_PROGRESS ||
      backendStatus === REQUEST_BACKEND_STATUSES.COMPLETED ||
      staffStatus === "assigned" ||
      staffStatus === "in_progress" ||
      staffStatus === "done" ||
      staffStatus === "reassignment_needed"
  );
}

export function normalizeRequestBackendStatus(value, request = null) {
  const explicit = lower(value);
  if (
    explicit === REQUEST_BACKEND_STATUSES.NEW ||
    explicit === REQUEST_BACKEND_STATUSES.ASSIGNED ||
    explicit === REQUEST_BACKEND_STATUSES.IN_PROGRESS ||
    explicit === REQUEST_BACKEND_STATUSES.COMPLETED
  ) {
    return explicit;
  }

  const req = request && typeof request === "object" ? request : {};
  const status = lower(req?.status);
  const staffStatus = lower(req?.staffStatus);
  const assignedTo = safeStr(req?.assignedTo);
  const startedAtMs = Math.max(toMillis(req?.staffStartedAtMs), toMillis(req?.staffStartedAt));

  if (isLegacyRequestCompleted(req)) return REQUEST_BACKEND_STATUSES.COMPLETED;
  if (
    staffStatus === "in_progress" ||
    status === "contacted" ||
    status === "active" ||
    status === "in_progress" ||
    status === "in-progress" ||
    startedAtMs > 0
  ) {
    return REQUEST_BACKEND_STATUSES.IN_PROGRESS;
  }
  if (assignedTo || staffStatus === "assigned") {
    return REQUEST_BACKEND_STATUSES.ASSIGNED;
  }
  return REQUEST_BACKEND_STATUSES.NEW;
}

export function normalizeRequestUserStatus(value, request = null) {
  const explicit = lower(value);
  if (
    explicit === REQUEST_USER_STATUSES.IN_PROGRESS ||
    explicit === REQUEST_USER_STATUSES.COMPLETED
  ) {
    return explicit;
  }

  const req = request && typeof request === "object" ? request : {};
  if (isLegacyRequestCompleted(req)) return REQUEST_USER_STATUSES.COMPLETED;

  const backendStatus = normalizeRequestBackendStatus(req?.backendStatus, req);
  if (
    backendStatus === REQUEST_BACKEND_STATUSES.COMPLETED ||
    hasRequestEverBeenAssigned(req) ||
    backendStatus === REQUEST_BACKEND_STATUSES.ASSIGNED ||
    backendStatus === REQUEST_BACKEND_STATUSES.IN_PROGRESS
  ) {
    return REQUEST_USER_STATUSES.IN_PROGRESS;
  }

  return "";
}

export function getUserRequestState(request) {
  const req = request && typeof request === "object" ? request : {};
  const status = lower(req?.status);

  if (status === "rejected") return "rejected";
  if (status === "closed" || status === "accepted") return "completed";

  const userStatus = normalizeRequestUserStatus(req?.userStatus, req);
  if (userStatus === REQUEST_USER_STATUSES.COMPLETED) return "completed";
  if (userStatus === REQUEST_USER_STATUSES.IN_PROGRESS) return "in_progress";

  return "submitted";
}

export function buildRequestContinuityPatch(currentRequest = {}, nextFields = {}) {
  const merged = {
    ...(currentRequest && typeof currentRequest === "object" ? currentRequest : {}),
    ...(nextFields && typeof nextFields === "object" ? nextFields : {}),
  };

  const backendStatus = normalizeRequestBackendStatus(nextFields?.backendStatus, merged);
  const everAssigned =
    nextFields?.everAssigned === true ||
    hasRequestEverBeenAssigned(merged) ||
    backendStatus !== REQUEST_BACKEND_STATUSES.NEW;
  const userStatus = normalizeRequestUserStatus(nextFields?.userStatus, {
    ...merged,
    backendStatus,
    everAssigned,
  });

  const patch = {
    backendStatus,
    everAssigned,
  };

  if (userStatus) patch.userStatus = userStatus;
  return patch;
}


const CHAT_CACHE_TTL_MS = 10 * 60 * 1000;

function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 120) {
  return safeStr(value, max).toLowerCase();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return 0;
}

function requestStartedAtMs(request = {}) {
  return Math.max(
    toMillis(request?.staffStartedAtMs),
    toMillis(request?.staffStartedAt),
    toMillis(request?.markedInProgressAtMs),
    toMillis(request?.markedInProgressAt),
    toMillis(request?.lifecycle?.startedAtMs),
    toMillis(request?.lifecycle?.startedAt)
  );
}

export function isRequestChatActive(request = {}) {
  const status = lower(request?.status, 60);
  const backendStatus = lower(request?.backendStatus, 60);
  const staffStatus = lower(request?.staffStatus, 60);
  const lifecycleStage = lower(request?.lifecycle?.stage, 60);

  if (requestStartedAtMs(request) > 0) return true;
  if (staffStatus === "in_progress" || staffStatus === "done") return true;
  if (backendStatus === "in_progress" || backendStatus === "completed") return true;
  if (status === "in_progress" || status === "closed" || status === "rejected" || status === "accepted") {
    return true;
  }
  if (lifecycleStage === "inprogress" || lifecycleStage === "completed") return true;
  return false;
}

export function getRequestChatAvailability(request = {}, { role = "user" } = {}) {
  const enabled = isRequestChatActive(request);
  if (enabled) {
    return {
      enabled: true,
      message: "",
    };
  }

  const normalizedRole = lower(role, 40);
  if (normalizedRole === "user") {
    return {
      enabled: false,
      message: "Chat will unlock once your request is moved into progress.",
    };
  }

  return {
    enabled: false,
    message: "Chat stays read-only until this request is moved into progress.",
  };
}

function buildChatCacheKey({ requestId = "", scope = "", kind = "" } = {}) {
  const rid = safeStr(requestId, 180);
  const cacheScope = safeStr(scope, 180);
  const cacheKind = safeStr(kind, 80);
  if (!rid || !cacheScope || !cacheKind) return "";
  return `maj_chat_cache_v1:${cacheScope}:${cacheKind}:${rid}`;
}

export function loadChatCollectionCache({ requestId = "", scope = "", kind = "" } = {}) {
  const key = buildChatCacheKey({ requestId, scope, kind });
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const savedAt = Number(parsed?.savedAt || 0) || 0;
    if (!savedAt || Date.now() - savedAt > CHAT_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key);
      return [];
    }
    return rows;
  } catch {
    return [];
  }
}

export function saveChatCollectionCache({ requestId = "", scope = "", kind = "", rows = [] } = {}) {
  const key = buildChatCacheKey({ requestId, scope, kind });
  if (!key || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        rows: Array.isArray(rows) ? rows : [],
      })
    );
  } catch {
    // ignore session storage issues
  }
}

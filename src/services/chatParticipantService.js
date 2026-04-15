function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value?.seconds === "number") {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanoseconds || 0);
    if (!Number.isFinite(seconds)) return 0;
    return seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
  }
  return 0;
}

function pickBestName(row = {}, fallback = "") {
  const source = row && typeof row === "object" ? row : {};
  const candidates = [
    source.displayName,
    source.fullName,
    source.legalName,
    source.name,
    source.username,
    source.email,
    fallback,
  ];
  for (const candidate of candidates) {
    const clean = safeStr(candidate, 180);
    if (clean) return clean;
  }
  return "Unknown";
}

export function derivePresenceState(row = {}, { nowMs = Date.now(), onlineThresholdMs = 5 * 60 * 1000 } = {}) {
  const source = row && typeof row === "object" ? row : {};
  const explicitOnline = source.online === true || source.isOnline === true || source.status === "online";
  const explicitOffline =
    source.online === false ||
    source.isOnline === false ||
    String(source.status || "").toLowerCase() === "offline";
  const lastSeenAtMs = Math.max(
    toTimestampMs(source.lastSeenAt),
    Number(source.lastSeenAtMs || 0),
    Number(source.lastActiveAtMs || 0),
    Number(source.lastLoginAtMs || 0),
    Number(source.updatedAtMs || 0),
    toTimestampMs(source.updatedAt)
  );
  const activeByHeartbeat = lastSeenAtMs > 0 && nowMs - lastSeenAtMs <= onlineThresholdMs;
  const online = explicitOnline || (!explicitOffline && activeByHeartbeat);
  return {
    online,
    lastSeenAtMs,
    label: online ? "Online" : "Offline",
  };
}

export function buildParticipantSummary({
  uid = "",
  row = {},
  fallbackLabel = "",
} = {}) {
  const safeUid = safeStr(uid, 180);
  const name = pickBestName(row, fallbackLabel || safeUid);
  const presence = derivePresenceState(row || {});
  return {
    uid: safeUid,
    name,
    online: presence.online,
    statusLabel: presence.label,
    lastSeenAtMs: presence.lastSeenAtMs,
  };
}

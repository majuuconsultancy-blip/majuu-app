function isObject(value) {
  return value !== null && typeof value === "object";
}

function safeStr(value) {
  return String(value || "").trim();
}

export function isStaffAccessEnabled(data) {
  if (!isObject(data)) return false;
  return data.active !== false;
}

export function hasStaffAccessSignal(data) {
  if (!isObject(data)) return false;

  const ownerAdminUid = safeStr(data.ownerAdminUid);
  const hasAccessMeta = isObject(data.access);
  const hasSpecialities = Array.isArray(data.specialities) && data.specialities.length > 0;
  const hasTracks = Array.isArray(data.tracks) && data.tracks.length > 0;

  return (
    data.active === true ||
    data.onboarded === true ||
    ownerAdminUid.length > 0 ||
    hasAccessMeta ||
    hasSpecialities ||
    hasTracks
  );
}

export function isEligibleStaffProfile(data) {
  return isStaffAccessEnabled(data) && hasStaffAccessSignal(data);
}

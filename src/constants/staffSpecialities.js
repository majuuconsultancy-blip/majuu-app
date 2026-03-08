export const STAFF_SPECIALITY_OPTIONS = Object.freeze([
  { key: "passport", label: "Passport application" },
  { key: "visa", label: "Visa application" },
  { key: "sop", label: "SOP writing" },
  { key: "cv", label: "CV / Resume" },
  { key: "funds", label: "Proof of funds" },
  { key: "admission", label: "Admissions / Offer letter" },
  { key: "travel", label: "Travel planning" },
  { key: "full", label: "Full package handling" },
]);

const LABEL_BY_KEY = new Map(
  STAFF_SPECIALITY_OPTIONS.map((opt) => [String(opt.key), String(opt.label)])
);

function clean(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function getSpecialityLabel(key) {
  const safe = clean(key);
  if (!safe) return "Unknown";
  return LABEL_BY_KEY.get(safe) || safe.replace(/[_-]+/g, " ");
}

export function normalizeSpecialityKey(value) {
  const raw = clean(value);
  if (!raw) return "unknown";

  if (LABEL_BY_KEY.has(raw)) return raw;
  if (raw === "full package" || raw === "fullpackage") return "full";
  if (raw.includes("passport")) return "passport";
  if (raw.includes("visa")) return "visa";
  if (raw.includes("sop") || raw.includes("motivation")) return "sop";
  if (raw.includes("cv") || raw.includes("resume")) return "cv";
  if (raw.includes("fund")) return "funds";
  if (raw.includes("admission") || raw.includes("offer")) return "admission";
  if (raw.includes("travel") || raw.includes("flight") || raw.includes("itinerary")) return "travel";
  if (raw.includes("full")) return "full";
  return "unknown";
}

export function normalizeSpecialities(values) {
  const list = Array.isArray(values)
    ? values
    : String(values || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

  const unique = new Set();
  list.forEach((value) => {
    const key = normalizeSpecialityKey(value);
    if (key !== "unknown") unique.add(key);
  });

  return Array.from(unique);
}

export function inferRequestSpeciality(request = {}) {
  const requestType = clean(request?.requestType);
  const serviceName = clean(request?.serviceName || request?.service);
  const fullPackageItem = clean(request?.fullPackageItem || request?.fullPackageItemKey);
  const note = clean(request?.note);

  const candidate = [fullPackageItem, serviceName, note, requestType].filter(Boolean).join(" ");
  const key = normalizeSpecialityKey(candidate);
  if (key !== "unknown") return key;
  if (requestType === "full") return "full";
  return "unknown";
}

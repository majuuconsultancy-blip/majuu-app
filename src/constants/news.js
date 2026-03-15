export const NEWS_TAG_OPTIONS = [
  "Visa",
  "Scholarships",
  "Universities",
  "Jobs",
  "Housing",
  "Policy",
  "Travel",
];

export const NEWS_SOURCE_TYPE_OPTIONS = ["official", "media", "other"];

export const NEWS_SOURCE_TYPE_LABELS = {
  official: "Official",
  media: "Media",
  other: "Other",
};

export function normalizeNewsSourceType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return NEWS_SOURCE_TYPE_OPTIONS.includes(raw) ? raw : "other";
}

export function normalizeNewsTag(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

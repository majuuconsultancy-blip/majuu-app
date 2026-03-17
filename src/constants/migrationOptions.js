export const APP_TRACK_OPTIONS = ["study", "work", "travel"];

export const APP_TRACK_META = {
  study: {
    label: "Study",
    title: "Study Abroad",
  },
  work: {
    label: "Work",
    title: "Work Abroad",
  },
  travel: {
    label: "Travel",
    title: "Travel Abroad",
  },
};

export const APP_DESTINATION_COUNTRIES = ["Canada", "Australia", "UK", "Germany", "USA"];

function safeString(value) {
  return String(value || "").trim();
}

export function normalizeTrackType(value) {
  const raw = safeString(value).toLowerCase();
  return APP_TRACK_OPTIONS.includes(raw) ? raw : "study";
}

export function normalizeDestinationCountry(value) {
  const raw = safeString(value);
  if (!raw) return "";

  const lowered = raw.toLowerCase();
  if (lowered === "not selected") return "";
  if (lowered === "united kingdom" || lowered === "uk") return "UK";
  if (
    lowered === "united states" ||
    lowered === "united states of america" ||
    lowered === "usa" ||
    lowered === "u.s.a." ||
    lowered === "us"
  ) {
    return "USA";
  }

  const direct = APP_DESTINATION_COUNTRIES.find((country) => country.toLowerCase() === lowered);
  if (direct) return direct;

  return raw;
}

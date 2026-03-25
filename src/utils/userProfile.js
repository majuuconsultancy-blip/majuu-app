function safeString(value, max = 120) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

export const PROFILE_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "sw", label: "Kiswahili" },
];

export const PROFILE_LANGUAGE_BY_COUNTRY = Object.freeze({
  Kenya: "sw",
  Tanzania: "sw",
  Uganda: "en",
  Rwanda: "en",
  Namibia: "en",
  Ethiopia: "en",
});

export function normalizeProfileName(value, max = 80) {
  return safeString(value, max);
}

export function normalizeProfileHomeCountry(value, fallback = "") {
  return safeString(value || fallback, 120);
}

export function normalizeProfileLanguage(value, fallback = "en") {
  const raw = safeString(value, 24).toLowerCase();
  if (raw === "en" || raw.startsWith("en-")) return "en";
  if (raw === "sw" || raw.startsWith("sw-")) return "sw";

  const safeFallback = safeString(fallback, 24).toLowerCase();
  if (!safeFallback || safeFallback === raw) return "";
  return normalizeProfileLanguage(safeFallback, "");
}

export function getDefaultLanguageForCountry(country) {
  return normalizeProfileLanguage(PROFILE_LANGUAGE_BY_COUNTRY[safeString(country, 120)], "");
}

export function getProfileLanguageLabel(language) {
  const safeLanguage = normalizeProfileLanguage(language, "en") || "en";
  return (
    PROFILE_LANGUAGE_OPTIONS.find((option) => option.value === safeLanguage)?.label || "English"
  );
}

export function createDefaultUserProfile({ homeCountry = "", language = "" } = {}) {
  const safeHomeCountry = normalizeProfileHomeCountry(homeCountry);
  const mappedLanguage = getDefaultLanguageForCountry(safeHomeCountry);
  return {
    homeCountry: safeHomeCountry,
    language: normalizeProfileLanguage(language, mappedLanguage) || "",
  };
}

export function normalizeUserProfile(userState) {
  const safeState = userState && typeof userState === "object" ? userState : {};
  const sourceProfile =
    safeState?.profile && typeof safeState.profile === "object" ? safeState.profile : {};
  const homeCountry = normalizeProfileHomeCountry(
    sourceProfile?.homeCountry,
    safeState?.countryOfResidence || ""
  );
  const mappedLanguage = getDefaultLanguageForCountry(homeCountry);
  const language = normalizeProfileLanguage(sourceProfile?.language, mappedLanguage) || "";

  return {
    ...sourceProfile,
    homeCountry,
    language,
  };
}

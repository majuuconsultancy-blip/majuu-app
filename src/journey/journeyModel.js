import { APP_TRACK_OPTIONS, normalizeDestinationCountry } from "../constants/migrationOptions";

export const JOURNEY_COUNTRY_TYPES = {
  managed: "managed",
  custom: "custom",
};

export const JOURNEY_SOURCES = {
  setup: "setup",
  profile: "profile",
  system: "system",
};

function safeString(value, max = 120) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

export function normalizeJourneyTrack(value) {
  const raw = safeString(value, 20).toLowerCase();
  return APP_TRACK_OPTIONS.includes(raw) ? raw : "";
}

export function normalizeJourneyCountry(value) {
  const raw = safeString(value, 80);
  if (!raw) return "";
  return normalizeDestinationCountry(raw) || raw;
}

export function normalizeJourneyCountryType(value) {
  const raw = safeString(value, 20).toLowerCase();
  if (raw === JOURNEY_COUNTRY_TYPES.managed) return JOURNEY_COUNTRY_TYPES.managed;
  if (raw === JOURNEY_COUNTRY_TYPES.custom) return JOURNEY_COUNTRY_TYPES.custom;
  return "";
}

export function normalizeJourneyStage(value) {
  return safeString(value, 140);
}

export function createEmptyJourney() {
  return {
    active: false,
    track: "",
    country: "",
    countryType: "",
    countryCustom: "",
    stage: "",
    lastUpdatedAtMs: 0,
    source: "",
  };
}

export function normalizeJourney(rawJourney) {
  const source = rawJourney && typeof rawJourney === "object" ? rawJourney : {};
  const track = normalizeJourneyTrack(source?.track);
  const countryType = normalizeJourneyCountryType(source?.countryType);
  const countryCustom = safeString(source?.countryCustom, 80);
  const country = normalizeJourneyCountry(source?.country || countryCustom);
  const stage = normalizeJourneyStage(source?.stage);
  const lastUpdatedAtMs = Number(source?.lastUpdatedAtMs || 0) || 0;
  const journeySource = safeString(source?.source, 40);
  const active = Boolean(source?.active && track);

  return {
    active,
    track,
    country,
    countryType,
    countryCustom,
    stage,
    lastUpdatedAtMs,
    source: journeySource,
  };
}

export function journeyDisplayCountry(journey) {
  const safe = journey && typeof journey === "object" ? journey : {};
  if (safe.countryType === JOURNEY_COUNTRY_TYPES.custom) {
    return safeString(safe.countryCustom || safe.country, 80);
  }
  return safeString(safe.country, 80);
}

export function normalizeCountryKey(value) {
  const lowered = safeString(value, 80).toLowerCase();
  if (!lowered) return "";
  const slug = lowered
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug || lowered.slice(0, 80);
}

export function createDefaultUserOnboarding({ profileJourneySetupCompleted } = {}) {
  return {
    profileJourneySetupCompleted: Boolean(profileJourneySetupCompleted),
    profileJourneySetupCompletedAtMs: 0,
  };
}

export function normalizeUserOnboarding(rawOnboarding) {
  const source = rawOnboarding && typeof rawOnboarding === "object" ? rawOnboarding : {};
  const completedRaw = source?.profileJourneySetupCompleted;
  const completed = completedRaw === false ? false : true; // default true for backward compatibility
  const completedAtMs = Number(source?.profileJourneySetupCompletedAtMs || 0) || 0;

  return {
    profileJourneySetupCompleted: completed,
    profileJourneySetupCompletedAtMs: completedAtMs,
  };
}


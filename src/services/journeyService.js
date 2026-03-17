import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import {
  JOURNEY_COUNTRY_TYPES,
  JOURNEY_SOURCES,
  createEmptyJourney,
  journeyDisplayCountry,
  normalizeCountryKey,
  normalizeJourney,
  normalizeJourneyCountry,
  normalizeJourneyCountryType,
  normalizeJourneyStage,
  normalizeJourneyTrack,
} from "../journey/journeyModel";
import { logAnalyticsEvent } from "./analyticsService";

function safeUid(uid) {
  return String(uid || "").trim();
}

function safeString(value, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function buildJourneyPatch(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const track = normalizeJourneyTrack(raw.track);
  const countryType = normalizeJourneyCountryType(raw.countryType);
  const stage = normalizeJourneyStage(raw.stage);

  const countryCustom = safeString(raw.countryCustom, 80);
  const normalizedCountry = normalizeJourneyCountry(raw.country || countryCustom);

  const nextCountryType =
    countryType ||
    (countryCustom ? JOURNEY_COUNTRY_TYPES.custom : normalizedCountry ? JOURNEY_COUNTRY_TYPES.managed : "");

  const shouldBeActive = Boolean(track && normalizedCountry);

  return {
    active: shouldBeActive,
    track,
    country: normalizedCountry,
    countryType: nextCountryType,
    countryCustom: nextCountryType === JOURNEY_COUNTRY_TYPES.custom ? countryCustom : "",
    stage,
  };
}

export async function updateUserJourney(uid, input = {}, { source = JOURNEY_SOURCES.profile } = {}) {
  const safeId = safeUid(uid);
  if (!safeId) throw new Error("Missing user id.");

  const patch = buildJourneyPatch(input);
  const journey = normalizeJourney(patch);

  const ref = doc(db, "users", safeId);
  await updateDoc(ref, {
    journey: {
      ...createEmptyJourney(),
      ...journey,
      lastUpdatedAt: serverTimestamp(),
      lastUpdatedAtMs: Date.now(),
      source: safeString(source, 40) || JOURNEY_SOURCES.profile,
    },
    updatedAt: serverTimestamp(),
  });

  if (journey.track && journey.country) {
    void logAnalyticsEvent({
      uid: safeId,
      eventType: ANALYTICS_EVENT_TYPES.JOURNEY_COUNTRY_SELECTED,
      trackType: journey.track,
      country: journey.country,
      countryType: journey.countryType,
      countryCustom: journey.countryCustom,
      sourceScreen: "journeyService.updateUserJourney",
    });

    if (journey.countryType === JOURNEY_COUNTRY_TYPES.custom && journey.countryCustom) {
      void logAnalyticsEvent({
        uid: safeId,
        eventType: ANALYTICS_EVENT_TYPES.JOURNEY_CUSTOM_COUNTRY_ENTERED,
        trackType: journey.track,
        country: journey.country,
        countryType: journey.countryType,
        countryCustom: journey.countryCustom,
        sourceScreen: "journeyService.updateUserJourney",
      });
    }
  }

  if (journey.stage) {
    void logAnalyticsEvent({
      uid: safeId,
      eventType: ANALYTICS_EVENT_TYPES.JOURNEY_STAGE_SELECTED,
      trackType: journey.track,
      country: journey.country,
      countryType: journey.countryType,
      countryCustom: journey.countryCustom,
      sourceScreen: "journeyService.updateUserJourney",
      metadata: {
        stage: journey.stage,
      },
    });
  }

  if (safeString(source, 40) === JOURNEY_SOURCES.setup && journey.active) {
    void logAnalyticsEvent({
      uid: safeId,
      eventType: ANALYTICS_EVENT_TYPES.JOURNEY_SETUP_COMPLETED,
      trackType: journey.track,
      country: journey.country,
      countryType: journey.countryType,
      countryCustom: journey.countryCustom,
      sourceScreen: "journeyService.updateUserJourney",
    });
  }

  if (journey.countryType === JOURNEY_COUNTRY_TYPES.custom && journey.countryCustom) {
    void recordCustomCountryDemand({
      uid: safeId,
      track: journey.track,
      country: journey.countryCustom,
      source,
    });
  }

  return journey;
}

export async function clearUserJourney(uid, { source = JOURNEY_SOURCES.profile } = {}) {
  const safeId = safeUid(uid);
  if (!safeId) throw new Error("Missing user id.");

  const ref = doc(db, "users", safeId);
  await updateDoc(ref, {
    journey: {
      ...createEmptyJourney(),
      lastUpdatedAt: serverTimestamp(),
      lastUpdatedAtMs: Date.now(),
      source: safeString(source, 40) || JOURNEY_SOURCES.profile,
    },
    updatedAt: serverTimestamp(),
  });
}

export async function markProfileJourneySetupCompleted(uid) {
  const safeId = safeUid(uid);
  if (!safeId) throw new Error("Missing user id.");

  const ref = doc(db, "users", safeId);
  await updateDoc(ref, {
    onboarding: {
      profileJourneySetupCompleted: true,
      profileJourneySetupCompletedAtMs: Date.now(),
    },
    updatedAt: serverTimestamp(),
  });

  void logAnalyticsEvent({
    uid: safeId,
    eventType: ANALYTICS_EVENT_TYPES.PROFILE_COMPLETED,
    sourceScreen: "journeyService.markProfileJourneySetupCompleted",
  });
}

export async function recordCustomCountryDemand({
  uid,
  track,
  country,
  source = JOURNEY_SOURCES.profile,
} = {}) {
  const safeId = safeUid(uid || auth.currentUser?.uid);
  const safeTrack = normalizeJourneyTrack(track);
  const countryDisplay = safeString(country, 80);
  const countryNormalized = normalizeJourneyCountry(countryDisplay) || countryDisplay;
  const countryKey = normalizeCountryKey(countryNormalized);
  if (!safeId || !countryKey) return;

  const payload = {
    uid: safeId,
    track: safeTrack || "",
    country: countryDisplay,
    countryDisplay: journeyDisplayCountry({
      countryType: JOURNEY_COUNTRY_TYPES.custom,
      countryCustom: countryDisplay,
      country: countryNormalized,
    }),
    countryKey,
    countryLower: safeString(countryNormalized, 80).toLowerCase(),
    source: safeString(source, 40) || JOURNEY_SOURCES.profile,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };

  try {
    await addDoc(collection(db, "analytics_customCountryDemand"), payload);
  } catch (error) {
    // Do not block the user journey save on analytics capture.
    console.warn("custom country demand capture failed:", error?.code || error?.message || error);
  }
}

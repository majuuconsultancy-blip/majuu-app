import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { normalizeCountyLower, normalizeCountyName } from "../constants/kenyaCounties";
import { createDefaultUserOnboarding, createEmptyJourney } from "../journey/journeyModel";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { buildTrackEventKey, logAnalyticsEvent } from "./analyticsService";
import {
  createDefaultUserProfile,
  getDefaultLanguageForCountry,
  normalizeProfileHomeCountry,
  normalizeProfileLanguage,
  normalizeProfileName,
  normalizeUserProfile,
} from "../utils/userProfile";

/* ----------------- helpers ----------------- */
function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeName(name) {
  return normalizeProfileName(name, 80);
}

function normalizeTown(input) {
  return String(input || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function defaultAdminScope() {
  return {
    stationedCountry: "",
    stationedCountryLower: "",
    country: "",
    countryLower: "",
    counties: [],
    countiesLower: [],
    town: "",
    availability: "active",
    active: true,
    maxActiveRequests: 12,
    responseTimeoutMinutes: 20,
  };
}

function normalizePhoneByResidence(countryOfResidence, phoneRaw) {
  const residence = String(countryOfResidence || "").trim();

  // Kenya strict: +254 + 9 digits (starting with 7 or 1)
  if (residence === "Kenya") {
    const digits = onlyDigits(phoneRaw);

    // allow pastes like 0712345678, 712345678, +254712345678, 254712345678
    let local = digits;

    if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
    if (local.startsWith("0") && local.length >= 10) local = local.slice(1);

    local = local.slice(-9);

    if (!/^(7|1)\d{8}$/.test(local)) {
      throw new Error(
        "Invalid Kenya phone. Use 9 digits starting with 7 or 1 (e.g. +254712345678)."
      );
    }

    return `+254${local}`;
  }

  // Other countries: keep as typed but basic sanity (at least 8 digits)
  const phone = String(phoneRaw || "").trim().replace(/\s+/g, "");
  if (!phone) return "";

  if (onlyDigits(phone).length < 8) {
    throw new Error("Phone number looks too short.");
  }

  return phone;
}

function validateProfilePayload({ name, phone, countryOfResidence, language }) {
  const residence = normalizeProfileHomeCountry(countryOfResidence);

  if (typeof name !== "undefined") {
    const n = normalizeName(name);
    if (!n) throw new Error("Name is required.");
  }

  if (typeof countryOfResidence !== "undefined") {
    if (!residence) throw new Error("Country of residence is required.");
  }

  if (typeof language !== "undefined") {
    const rawLanguage = String(language || "").trim();
    if (!rawLanguage) throw new Error("Language is required.");
    const normalizedLanguage = normalizeProfileLanguage(rawLanguage, "");
    if (!normalizedLanguage) throw new Error("Language is required.");
  }

  if (typeof phone !== "undefined") {
    const raw = String(phone || "").trim();
    if (!raw) return;

    if (residence) {
      normalizePhoneByResidence(residence, raw);
    } else {
      if (onlyDigits(raw).length < 8) throw new Error("Phone number looks too short.");
    }
  }
}

function normalizeUserStateRecord(state) {
  const safeState = state && typeof state === "object" ? state : {};
  const profile = normalizeUserProfile(safeState);

  return {
    ...safeState,
    countryOfResidence:
      String(safeState?.countryOfResidence || "").trim() || profile.homeCountry || "",
    profile,
  };
}

/**
 * ✅ Hard-safe “ensure”:
 * - If doc missing: create it
 * - If doc exists: ONLY fill missing fields, NEVER overwrite existing values
 */
export async function ensureUserDoc({
  uid,
  email,
  displayName = "",
  provider = "",
} = {}) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  const didCreate = !snap.exists();

  const base = {
    email: email || "",
    name: "",
    phone: "",
    countryOfResidence: "",
    county: "",
    countyLower: "",
    town: "",
    profile: createDefaultUserProfile({}),
    role: "user",
    adminScope: defaultAdminScope(),
    selectedTrack: null,
    hasActiveProcess: false,
    activeTrack: null,
    activeCountry: null,
    activeHelpType: null,
    activeRequestId: null,
    journey: createEmptyJourney(),
    onboarding: createDefaultUserOnboarding({ profileJourneySetupCompleted: false }),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    // Create fresh
    await setDoc(ref, base, { merge: true });

    void logAnalyticsEvent({
      uid,
      eventType: ANALYTICS_EVENT_TYPES.SIGNUP_COMPLETED,
      sourceScreen: "userservice.ensureUserDoc",
      metadata: {
        provider: String(provider || "").trim(),
        hasDisplayName: Boolean(String(displayName || "").trim()),
      },
    });
  } else {
    // Repair only missing fields (do NOT wipe anything)
    const d = snap.data() || {};
    const patch = { updatedAt: serverTimestamp() };

    // only set if missing/undefined/null (not if empty string the user intentionally saved)
    const setIfMissing = (key, value) => {
      if (typeof d[key] === "undefined" || d[key] === null) patch[key] = value;
    };

    setIfMissing("email", email || d.email || "");
    setIfMissing("name", "");
    setIfMissing("phone", "");
    setIfMissing("countryOfResidence", "");
    setIfMissing("county", "");
    setIfMissing("countyLower", "");
    setIfMissing("town", "");
    setIfMissing(
      "profile",
      createDefaultUserProfile({
        homeCountry: d?.countryOfResidence || d?.profile?.homeCountry || "",
        language:
          d?.profile?.language ||
          getDefaultLanguageForCountry(d?.countryOfResidence || d?.profile?.homeCountry || "") ||
          "en",
      })
    );
    setIfMissing("role", "user");
    setIfMissing("adminScope", defaultAdminScope());
    setIfMissing("selectedTrack", null);
    setIfMissing("hasActiveProcess", false);
    setIfMissing("activeTrack", null);
    setIfMissing("activeCountry", null);
    setIfMissing("activeHelpType", null);
    setIfMissing("activeRequestId", null);
    setIfMissing("journey", createEmptyJourney());
    // Backward compatibility: do NOT force existing users into setup.
    setIfMissing("onboarding", createDefaultUserOnboarding({ profileJourneySetupCompleted: true }));

    // NOTE: do NOT overwrite createdAt unless missing
    setIfMissing("createdAt", serverTimestamp());

    // Only write if there is something to repair
    if (Object.keys(patch).length > 1) {
      await setDoc(ref, patch, { merge: true });
    }
  }

  const latest = await getDoc(ref);
  const state = latest.exists() ? latest.data() : null;
  if (!state) return null;
  const normalizedState = normalizeUserStateRecord(state);
  return didCreate
    ? { ...normalizedState, __ensureMeta: { created: true } }
    : { ...normalizedState, __ensureMeta: { created: false } };
}

// Read user state (✅ auto-heal if missing)
export async function getUserState(uid, emailIfKnown = "") {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // ✅ prevents Profile from loading null and looking “wiped”
    await ensureUserDoc({ uid, email: emailIfKnown || "" });
    const again = await getDoc(ref);
    return again.exists() ? normalizeUserStateRecord(again.data()) : null;
  }

  return normalizeUserStateRecord(snap.data());
}

// Backward compatibility for ProfileScreen
export async function getUserProfile(uid, emailIfKnown = "") {
  return getUserState(uid, emailIfKnown);
}

export async function setSelectedTrack(uid, track) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    selectedTrack: track,
    updatedAt: serverTimestamp(),
  });

  void logAnalyticsEvent({
    uid,
    eventType: ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED,
    eventKey: buildTrackEventKey(ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED, track),
    trackType: track,
    sourceScreen: "userservice.setSelectedTrack",
  });
}

export async function setActiveProcess(uid, { hasActiveProcess, activeTrack }) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: Boolean(hasActiveProcess),
    activeTrack: hasActiveProcess ? activeTrack : null,
    updatedAt: serverTimestamp(),
  });
}

export async function setActiveProcessDetails(uid, details) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    ...details,
    updatedAt: serverTimestamp(),
  });
}

export async function setActiveContext(
  uid,
  { hasActiveProcess, activeTrack, activeCountry, activeHelpType }
) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: Boolean(hasActiveProcess),
    activeTrack: hasActiveProcess ? activeTrack : null,
    activeCountry: hasActiveProcess ? (activeCountry || null) : null,
    activeHelpType: hasActiveProcess ? (activeHelpType || null) : null,
    updatedAt: serverTimestamp(),
  });
}

export async function clearActiveProcess(uid) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: false,
    activeTrack: null,
    activeCountry: null,
    activeHelpType: null,
    activeRequestId: null,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserName(uid, name) {
  const ref = doc(db, "users", uid);
  const clean = normalizeName(name);
  if (!clean) throw new Error("Name is required.");

  await updateDoc(ref, {
    name: clean,
    updatedAt: serverTimestamp(),
  });
}

// clear active process (kept)
export async function clearActiveProcessIfSaidDone(uid) {
  return clearActiveProcess(uid);
}

export async function upsertUserContact(uid, { name, phone }) {
  const ref = doc(db, "users", uid);

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // if doc missing, create it first to prevent updateDoc crash
    await ensureUserDoc({ uid, email: "" });
  }

  const snap2 = await getDoc(ref);
  const existing = snap2.exists() ? snap2.data() : {};
  const residence = String(existing?.countryOfResidence || "").trim();

  const cleanName = normalizeName(name);
  if (!cleanName) throw new Error("Name is required.");

  const cleanPhone = residence
    ? normalizePhoneByResidence(residence, phone)
    : String(phone || "").trim();

  if (!cleanPhone) throw new Error("Phone is required.");

  await updateDoc(ref, {
    name: cleanName,
    phone: cleanPhone,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserProfile(
  uid,
  { name, phone, countryOfResidence, homeCountry, county, town, language }
) {
  const ref = doc(db, "users", uid);

  // ensure doc exists so updateDoc never fails
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await ensureUserDoc({ uid, email: "" });
  }

  // ✅ validate input (prevents blank writes)
  const resolvedHomeCountry =
    typeof homeCountry !== "undefined"
      ? normalizeProfileHomeCountry(homeCountry)
      : typeof countryOfResidence !== "undefined"
      ? normalizeProfileHomeCountry(countryOfResidence)
      : undefined;

  validateProfilePayload({
    name,
    phone,
    countryOfResidence: resolvedHomeCountry,
    language,
  });

  // determine residence for phone normalization
  let residence =
    typeof resolvedHomeCountry !== "undefined"
      ? resolvedHomeCountry
      : null;

  if (!residence && typeof phone !== "undefined") {
    const s2 = await getDoc(ref);
    const existing = s2.exists() ? s2.data() : {};
    residence = String(existing?.countryOfResidence || "").trim();
  }

  const payload = { updatedAt: serverTimestamp() };

  if (typeof name !== "undefined") payload.name = normalizeName(name);
  if (typeof resolvedHomeCountry !== "undefined") {
    payload.countryOfResidence = resolvedHomeCountry;
    payload["profile.homeCountry"] = resolvedHomeCountry;
  }

  if (typeof language !== "undefined") {
    const rawLanguage = String(language || "").trim();
    if (!rawLanguage) throw new Error("Language is required.");
    const normalizedLanguage = normalizeProfileLanguage(rawLanguage, "");
    if (!normalizedLanguage) throw new Error("Language is required.");
    payload["profile.language"] = normalizedLanguage;
  }

  if (typeof phone !== "undefined") {
    payload.phone = residence
      ? phone
        ? normalizePhoneByResidence(residence, phone)
        : ""
      : String(phone || "").trim();
  }

  if (typeof county !== "undefined") {
    const countyName = normalizeCountyName(county);
    payload.county = countyName;
    payload.countyLower = normalizeCountyLower(countyName);
  }

  if (typeof town !== "undefined") {
    payload.town = normalizeTown(town);
  }

  await updateDoc(ref, payload);
}

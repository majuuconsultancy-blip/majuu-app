import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { APP_TRACK_OPTIONS, normalizeTrackType } from "../constants/migrationOptions";
import { auth, db } from "../firebase";
import { getCurrentUserRoleContext } from "./adminroleservice";
import { DEFAULT_COUNTRY_ACCENT, normalizeHexColor } from "../utils/countryAccent";

export const COUNTRY_COLLECTION = "countries";
export const COUNTRY_TRACK_OPTIONS = APP_TRACK_OPTIONS;
export const COUNTRY_CURRENCY_SUGGESTIONS = ["KES", "UGX", "TZS", "RWF"];

const COUNTRY_ACCENT_PRESETS = {
  AU: "#244B95",
  BI: "#B5424C",
  CA: "#C93B47",
  DE: "#B58A1F",
  DRC: "#356FD0",
  ET: "#2E7D4A",
  FR: "#3159A8",
  GB: "#274B91",
  IE: "#24946A",
  IT: "#1D8A55",
  JP: "#C54854",
  KE: "#157347",
  NZ: "#274B91",
  RW: "#3974C7",
  SO: "#4A90E2",
  SS: "#187258",
  TZ: "#1C8C73",
  UG: "#C9981A",
  UK: "#274B91",
  US: "#B33A46",
};

const COUNTRY_NAME_ACCENT_PRESETS = {
  Australia: COUNTRY_ACCENT_PRESETS.AU,
  Burundi: COUNTRY_ACCENT_PRESETS.BI,
  Canada: COUNTRY_ACCENT_PRESETS.CA,
  DRC: COUNTRY_ACCENT_PRESETS.DRC,
  Ethiopia: COUNTRY_ACCENT_PRESETS.ET,
  France: COUNTRY_ACCENT_PRESETS.FR,
  Germany: COUNTRY_ACCENT_PRESETS.DE,
  Ireland: COUNTRY_ACCENT_PRESETS.IE,
  Italy: COUNTRY_ACCENT_PRESETS.IT,
  Japan: COUNTRY_ACCENT_PRESETS.JP,
  Kenya: COUNTRY_ACCENT_PRESETS.KE,
  "New Zealand": COUNTRY_ACCENT_PRESETS.NZ,
  Rwanda: COUNTRY_ACCENT_PRESETS.RW,
  Somalia: COUNTRY_ACCENT_PRESETS.SO,
  "South Sudan": COUNTRY_ACCENT_PRESETS.SS,
  Tanzania: COUNTRY_ACCENT_PRESETS.TZ,
  Uganda: COUNTRY_ACCENT_PRESETS.UG,
  UK: COUNTRY_ACCENT_PRESETS.UK,
  USA: COUNTRY_ACCENT_PRESETS.US,
  "United Kingdom": COUNTRY_ACCENT_PRESETS.UK,
  "United States": COUNTRY_ACCENT_PRESETS.US,
};

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function normalizeBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanoseconds = Number(value?.nanoseconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000 + Math.floor((Number.isFinite(nanoseconds) ? nanoseconds : 0) / 1e6);
}

function normalizeCountryCode(value) {
  return safeString(value, 12).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function normalizeCurrencyCode(value) {
  return safeString(value, 12).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8);
}

function normalizeAccentColor(value, fallback = "") {
  return normalizeHexColor(value, fallback || DEFAULT_COUNTRY_ACCENT) || DEFAULT_COUNTRY_ACCENT;
}

export function suggestCountryAccentColor(input = {}) {
  const safeCode = normalizeCountryCode(input?.code || input?.countryCode || "");
  const safeName = safeString(input?.name || input?.country || "", 120);
  return (
    COUNTRY_ACCENT_PRESETS[safeCode] ||
    COUNTRY_NAME_ACCENT_PRESETS[safeName] ||
    normalizeAccentColor(input?.accentColor, DEFAULT_COUNTRY_ACCENT)
  );
}

export function getCountryAccentSuggestions(input = {}) {
  const suggested = suggestCountryAccentColor(input);
  const pool = [
    suggested,
    "#C93B47",
    "#244B95",
    "#157347",
    "#C9981A",
    DEFAULT_COUNTRY_ACCENT,
  ];

  return Array.from(new Set(pool.map((color) => normalizeAccentColor(color)).filter(Boolean))).slice(
    0,
    6
  );
}

function normalizeSupportedTracks(value) {
  if (!Array.isArray(value)) return [];
  const set = new Set();
  value.forEach((track) => {
    const normalized = safeString(track, 20).toLowerCase();
    if (COUNTRY_TRACK_OPTIONS.includes(normalized)) set.add(normalized);
  });
  return COUNTRY_TRACK_OPTIONS.filter((track) => set.has(track));
}

export function countrySupportsTrack(country, trackType) {
  const safeTrack = safeString(trackType, 20).toLowerCase();
  if (!COUNTRY_TRACK_OPTIONS.includes(safeTrack)) return false;
  return Array.isArray(country?.supportedTracks) && country.supportedTracks.includes(safeTrack);
}

function normalizeCountryRecord(docId, raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id = safeString(source?.id, 140) || safeString(docId, 140);
  const name = safeString(source?.name, 120);
  const code = normalizeCountryCode(source?.code);
  const flag = safeString(source?.flag, 32);
  const currency = normalizeCurrencyCode(source?.currency);
  const accentColor = normalizeAccentColor(
    source?.accentColor,
    suggestCountryAccentColor({ name, code, flag })
  );
  const isActive = normalizeBoolean(source?.isActive, true);
  const supportedTracks = normalizeSupportedTracks(source?.supportedTracks);

  return {
    id,
    name,
    code,
    flag,
    currency,
    accentColor,
    isActive,
    supportedTracks,
    createdAtMs: toTimestampMs(source?.createdAt) || Number(source?.createdAtMs || 0) || 0,
    updatedAtMs: toTimestampMs(source?.updatedAt) || Number(source?.updatedAtMs || 0) || 0,
    updatedByUid: safeString(source?.updatedByUid, 140),
    updatedByEmail: safeString(source?.updatedByEmail, 180),
  };
}

function compareCountries(left, right) {
  const activeGap = Number(Boolean(right?.isActive)) - Number(Boolean(left?.isActive));
  if (activeGap !== 0) return activeGap;
  const nameGap = safeString(left?.name, 120).localeCompare(safeString(right?.name, 120));
  if (nameGap !== 0) return nameGap;
  return safeString(left?.code, 40).localeCompare(safeString(right?.code, 40));
}

export function createEmptyCountryDraft({
  name = "",
  code = "",
  flag = "",
  currency = "KES",
  accentColor = "",
  isActive = true,
  supportedTracks = COUNTRY_TRACK_OPTIONS,
} = {}) {
  const safeName = safeString(name, 120);
  const safeCode = normalizeCountryCode(code);
  const safeFlag = safeString(flag, 32);
  return {
    name: safeName,
    code: safeCode,
    flag: safeFlag,
    currency: normalizeCurrencyCode(currency) || "KES",
    accentColor: normalizeAccentColor(
      accentColor,
      suggestCountryAccentColor({ name: safeName, code: safeCode, flag: safeFlag })
    ),
    isActive: normalizeBoolean(isActive, true),
    supportedTracks: normalizeSupportedTracks(supportedTracks),
  };
}

export function draftFromCountry(country) {
  const safe = country && typeof country === "object" ? country : {};
  return createEmptyCountryDraft({
    name: safe?.name,
    code: safe?.code,
    flag: safe?.flag,
    currency: safe?.currency,
    accentColor: safe?.accentColor,
    isActive: safe?.isActive,
    supportedTracks: safe?.supportedTracks,
  });
}

function toCountryPayload(input = {}) {
  const name = safeString(input?.name, 120);
  const code = normalizeCountryCode(input?.code);
  const currency = normalizeCurrencyCode(input?.currency);
  const flag = safeString(input?.flag, 32);
  const accentColor = normalizeAccentColor(
    input?.accentColor,
    suggestCountryAccentColor({ name, code, flag })
  );
  const isActive = normalizeBoolean(input?.isActive, true);
  const supportedTracks = normalizeSupportedTracks(input?.supportedTracks);

  if (!name) throw new Error("Enter a country name.");
  if (!code) throw new Error("Enter a country code.");
  if (code.length < 2) throw new Error("Country code should be at least 2 characters.");
  if (!currency) throw new Error("Enter a currency code (e.g. KES).");

  return {
    name,
    code,
    flag,
    currency,
    accentColor,
    isActive,
    supportedTracks,
  };
}

async function requireSuperAdminActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can manage countries.");
  }
  return roleCtx;
}

async function ensureUniqueCountryCode({ countryId = "", code = "" } = {}) {
  const safeId = safeString(countryId, 140);
  const safeCode = normalizeCountryCode(code);
  if (!safeCode) throw new Error("Missing country code.");

  const snap = await getDocs(
    query(collection(db, COUNTRY_COLLECTION), where("code", "==", safeCode), limit(1))
  );

  if (snap.empty) return;
  const row = snap.docs[0];
  if (row.id !== safeId) {
    throw new Error("A country with this code already exists.");
  }
}

export function subscribeAllCountries({ onData, onError } = {}) {
  return onSnapshot(
    collection(db, COUNTRY_COLLECTION),
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeCountryRecord(row.id, row.data() || {}))
        .filter((row) => row.id)
        .sort(compareCountries);

      onData?.(rows);
    },
    (error) => {
      console.error("countries subscription failed:", error);
      onError?.(error);
    }
  );
}

export function subscribeActiveCountries({ trackType = "", onData, onError } = {}) {
  const safeTrack = trackType ? normalizeTrackType(trackType) : "";
  const countriesQuery = query(
    collection(db, COUNTRY_COLLECTION),
    where("isActive", "==", true)
  );

  return onSnapshot(
    countriesQuery,
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeCountryRecord(row.id, row.data() || {}))
        .filter((row) => row.isActive)
        .filter((row) => (safeTrack ? countrySupportsTrack(row, safeTrack) : true))
        .sort(compareCountries);

      onData?.(rows);
    },
    (error) => {
      console.error("active countries subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function createCountry(input = {}) {
  await requireSuperAdminActor();

  const payload = toCountryPayload(input);
  await ensureUniqueCountryCode({ code: payload.code });

  const ref = doc(collection(db, COUNTRY_COLLECTION));
  const nowMs = Date.now();

  await setDoc(ref, {
    ...payload,
    id: ref.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });

  return ref.id;
}

export async function updateCountry(countryId, input = {}) {
  await requireSuperAdminActor();

  const safeId = safeString(countryId, 140);
  if (!safeId) throw new Error("Missing country id.");

  const payload = toCountryPayload({
    ...input,
    id: safeId,
  });

  await ensureUniqueCountryCode({ countryId: safeId, code: payload.code });

  await setDoc(
    doc(db, COUNTRY_COLLECTION, safeId),
    {
      ...payload,
      id: safeId,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      updatedByUid: safeString(auth.currentUser?.uid, 120),
      updatedByEmail: safeString(auth.currentUser?.email, 160),
    },
    { merge: true }
  );
}

export async function setCountryActiveState(countryId, isActive) {
  await requireSuperAdminActor();

  const safeId = safeString(countryId, 140);
  if (!safeId) throw new Error("Missing country id.");

  await updateDoc(doc(db, COUNTRY_COLLECTION, safeId), {
    isActive: normalizeBoolean(isActive, true),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });
}


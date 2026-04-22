import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { APP_TRACK_META, normalizeTrackType } from "../constants/migrationOptions";
import { auth, db } from "../firebase";
import { getCurrentUserRoleContext } from "./adminroleservice";

export const HOME_DESIGN_COLLECTION = "homeDesignModules";
export const HOME_DESIGN_DEFAULT_CONTEXT = "default";

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeParagraphText(value, max = 1000) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function toWholeNumber(value, fallback = 0, { min = 0, max = 1000 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function slugify(value, max = 80) {
  return safeString(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
}

function createLocalId(prefix) {
  const head = safeString(prefix, 24).toLowerCase() || "item";
  const stamp = Date.now().toString(36);
  const tail = Math.random().toString(36).slice(2, 8);
  return `${head}_${stamp}_${tail}`;
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

function normalizeContextKey(value) {
  return slugify(value || HOME_DESIGN_DEFAULT_CONTEXT, 60) || HOME_DESIGN_DEFAULT_CONTEXT;
}

function normalizeTrack(value) {
  return normalizeTrackType(value || "study");
}

function compareFeaturedCountries(left, right) {
  const orderGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (orderGap !== 0) return orderGap;
  return safeString(left?.country, 120).localeCompare(safeString(right?.country, 120));
}

function compareHomeDesignModules(left, right) {
  const activeGap = Number(Boolean(right?.isActive)) - Number(Boolean(left?.isActive));
  if (activeGap !== 0) return activeGap;

  const trackGap = safeString(left?.trackType, 40).localeCompare(safeString(right?.trackType, 40));
  if (trackGap !== 0) return trackGap;

  const contextGap = safeString(left?.contextKey, 80).localeCompare(safeString(right?.contextKey, 80));
  if (contextGap !== 0) return contextGap;

  return safeString(left?.title, 160).localeCompare(safeString(right?.title, 160));
}

function normalizeFeaturedCountryRecord(raw = {}, index = 0) {
  const country = safeString(raw?.country, 120);
  const label = safeString(raw?.label, 120) || country;
  return {
    id: safeString(raw?.id, 80) || createLocalId("country"),
    country,
    label,
    eyebrow: safeString(raw?.eyebrow, 120),
    metaLabel: safeString(raw?.metaLabel, 80),
    metaValue: safeString(raw?.metaValue, 80),
    description: safeParagraphText(raw?.description, 240),
    flagOverride: safeString(raw?.flagOverride, 32),
    isActive: normalizeBoolean(raw?.isActive, true),
    sortOrder: toWholeNumber(raw?.sortOrder, index + 1, { min: 1, max: 200 }),
  };
}

export function buildHomeDesignModuleKey({ trackType = "", contextKey = "" } = {}) {
  const safeTrackType = normalizeTrack(trackType);
  const safeContextKey = normalizeContextKey(contextKey);
  if (!safeTrackType || !safeContextKey) return "";
  return [safeTrackType, safeContextKey].join("__");
}

function buildHomeDesignModulePayload(input = {}) {
  const trackType = normalizeTrack(input?.trackType);
  const contextKey = normalizeContextKey(input?.contextKey);
  const title =
    safeString(input?.title, 160) || `${APP_TRACK_META[trackType]?.label || "Track"} Home Design`;
  const featuredCountries = (Array.isArray(input?.featuredCountries) ? input.featuredCountries : [])
    .map((entry, index) => normalizeFeaturedCountryRecord(entry, index))
    .filter((entry) => entry.country)
    .sort(compareFeaturedCountries)
    .map((entry, index) => ({
      ...entry,
      sortOrder: index + 1,
    }));

  return {
    title,
    subtitle: safeParagraphText(input?.subtitle, 240),
    trackType,
    contextKey,
    moduleKey: buildHomeDesignModuleKey({ trackType, contextKey }),
    isActive: normalizeBoolean(input?.isActive, true),
    featuredCountries,
  };
}

function validateHomeDesignPayload(payload) {
  if (!payload.moduleKey) {
    throw new Error("Track and context are required.");
  }

  if (payload.featuredCountries.length > 12) {
    throw new Error("Home design supports at most 12 featured countries.");
  }

  const seenCountries = new Set();
  payload.featuredCountries.forEach((entry) => {
    if (!entry.country) {
      throw new Error("Each featured country needs a country name.");
    }
    const key = safeString(entry.country, 120).toLowerCase();
    if (seenCountries.has(key)) {
      throw new Error(`Duplicate featured country "${entry.country}" found.`);
    }
    seenCountries.add(key);
  });
}

export function normalizeHomeDesignModuleRecord(id, raw = {}) {
  const payload = buildHomeDesignModulePayload(raw);
  const activeCountries = payload.featuredCountries.filter((entry) => entry.isActive);
  return {
    id: safeString(id || raw?.id, 140),
    ...payload,
    featuredCountryCount: payload.featuredCountries.length,
    activeFeaturedCountryCount: activeCountries.length,
    createdAt: raw?.createdAt || null,
    updatedAt: raw?.updatedAt || null,
    createdAtMs:
      Number(raw?.createdAtMs || 0) || toTimestampMs(raw?.createdAt) || Number(raw?.updatedAtMs || 0),
    updatedAtMs: Number(raw?.updatedAtMs || 0) || toTimestampMs(raw?.updatedAt) || 0,
    updatedByUid: safeString(raw?.updatedByUid, 120),
    updatedByEmail: safeString(raw?.updatedByEmail, 160),
  };
}

export function createEmptyHomeDesignFeaturedCountryDraft() {
  return {
    id: "",
    country: "",
    label: "",
    eyebrow: "",
    metaLabel: "",
    metaValue: "",
    description: "",
    flagOverride: "",
    isActive: true,
    sortOrder: "",
  };
}

export function createEmptyHomeDesignModuleDraft({
  trackType = "study",
  contextKey = HOME_DESIGN_DEFAULT_CONTEXT,
} = {}) {
  return {
    title: "",
    subtitle: "",
    trackType: normalizeTrack(trackType),
    contextKey: normalizeContextKey(contextKey),
    isActive: true,
    featuredCountries: [],
  };
}

export function draftFromHomeDesignModule(module) {
  const safe = normalizeHomeDesignModuleRecord(module?.id, module || {});
  return {
    title: safe.title,
    subtitle: safe.subtitle,
    trackType: safe.trackType,
    contextKey: safe.contextKey,
    isActive: safe.isActive,
    featuredCountries: safe.featuredCountries.map((entry) => ({
      ...entry,
      sortOrder: String(entry.sortOrder || ""),
    })),
  };
}

async function requireSuperAdminActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can manage home design modules.");
  }
  return roleCtx;
}

async function ensureUniqueHomeDesignKey({ moduleId = "", moduleKey = "" } = {}) {
  const safeId = safeString(moduleId, 140);
  const safeKey = safeString(moduleKey, 120);
  if (!safeKey) {
    throw new Error("Missing home design module key.");
  }

  const snap = await getDocs(
    query(collection(db, HOME_DESIGN_COLLECTION), where("moduleKey", "==", safeKey))
  );

  const duplicate = snap.docs.find((docSnap) => safeString(docSnap.id, 140) !== safeId);
  if (duplicate) {
    throw new Error("A home design module already exists for this track and context.");
  }
}

export function subscribeAllHomeDesignModules({ onData, onError } = {}) {
  return onSnapshot(
    collection(db, HOME_DESIGN_COLLECTION),
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeHomeDesignModuleRecord(row.id, row.data() || {}))
        .filter((row) => row.id)
        .sort(compareHomeDesignModules);

      onData?.(rows);
    },
    (error) => {
      console.error("home design subscription failed:", error);
      onError?.(error);
    }
  );
}

export function subscribeActiveHomeDesignModule(
  { trackType = "", contextKey = HOME_DESIGN_DEFAULT_CONTEXT, onData, onError } = {}
) {
  const safeTrackType = normalizeTrack(trackType);
  const safeContextKey = normalizeContextKey(contextKey);
  const modulesQuery = query(collection(db, HOME_DESIGN_COLLECTION), where("isActive", "==", true));

  return onSnapshot(
    modulesQuery,
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeHomeDesignModuleRecord(row.id, row.data() || {}))
        .filter((row) => row.isActive)
        .filter((row) => row.trackType === safeTrackType)
        .filter((row) => row.contextKey === safeContextKey)
        .sort(compareHomeDesignModules);

      onData?.(rows[0] || null);
    },
    (error) => {
      console.error("active home design subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function createHomeDesignModule(input = {}) {
  await requireSuperAdminActor();

  const payload = buildHomeDesignModulePayload(input);
  validateHomeDesignPayload(payload);
  await ensureUniqueHomeDesignKey({ moduleKey: payload.moduleKey });

  const ref = doc(collection(db, HOME_DESIGN_COLLECTION));
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

export async function updateHomeDesignModule(moduleId, input = {}) {
  await requireSuperAdminActor();

  const safeId = safeString(moduleId, 140);
  if (!safeId) throw new Error("Missing home design module id.");

  const payload = buildHomeDesignModulePayload(input);
  validateHomeDesignPayload(payload);
  await ensureUniqueHomeDesignKey({ moduleId: safeId, moduleKey: payload.moduleKey });

  await updateDoc(doc(db, HOME_DESIGN_COLLECTION, safeId), {
    ...payload,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });
}

export async function setHomeDesignModuleActiveState(moduleId, isActive) {
  await requireSuperAdminActor();

  const safeId = safeString(moduleId, 140);
  if (!safeId) throw new Error("Missing home design module id.");

  await updateDoc(doc(db, HOME_DESIGN_COLLECTION, safeId), {
    isActive: normalizeBoolean(isActive, true),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });
}

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";

export const ANALYTICS_COLLECTIONS = Object.freeze({
  EVENTS: "analytics_events",
  COUNTRY_DEMAND: "analytics_countryDemand",
  NEWS_ROUTE_VIEWS: "analytics_newsRouteViews",
  SELFHELP_LINK_CLICKS: "analytics_selfHelpLinkClicks",
});

function safeString(value, max = 200) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function safeLower(value, max = 200) {
  return safeString(value, max).toLowerCase();
}

function safeTrack(value) {
  const raw = safeLower(value, 20);
  return raw === "study" || raw === "work" || raw === "travel" ? raw : "";
}

function safeCountryType(value) {
  const raw = safeLower(value, 20);
  return raw === "managed" || raw === "custom" ? raw : "";
}

function normalizeKey(value, max = 80) {
  const lowered = safeLower(value, max);
  if (!lowered) return "";
  return lowered
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeMetadata(value, { maxDepth = 2, maxKeys = 30 } = {}) {
  if (!isPlainObject(value)) return null;
  const out = {};
  const entries = Object.entries(value).slice(0, maxKeys);

  for (const [k, v] of entries) {
    const key = safeString(k, 80);
    if (!key) continue;

    if (v == null) continue;
    if (typeof v === "string") out[key] = safeString(v, 800);
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else if (Array.isArray(v)) {
      out[key] = v
        .slice(0, 20)
        .map((item) => {
          if (item == null) return null;
          if (typeof item === "string") return safeString(item, 200);
          if (typeof item === "number" && Number.isFinite(item)) return item;
          if (typeof item === "boolean") return item;
          return null;
        })
        .filter((item) => item !== null);
    } else if (maxDepth > 0 && isPlainObject(v)) {
      const nested = sanitizeMetadata(v, { maxDepth: maxDepth - 1, maxKeys: 20 });
      if (nested && Object.keys(nested).length) out[key] = nested;
    }
  }

  return Object.keys(out).length ? out : null;
}

async function writeDoc(collectionName, payload) {
  try {
    await addDoc(collection(db, collectionName), payload);
    return true;
  } catch (error) {
    console.warn(`[analytics] write failed (${collectionName}):`, error?.code || error?.message || error);
    return false;
  }
}

export async function logAnalyticsEvent(input = {}) {
  const uid = safeString(input?.uid || auth.currentUser?.uid, 120);
  if (!uid) return false;

  const eventType = safeString(input?.eventType, 80);
  if (!eventType) return false;

  const payload = {
    eventType,
    eventKey: safeString(input?.eventKey || eventType, 140),
    uid,
    trackType: safeTrack(input?.trackType),
    country: safeString(input?.country, 80),
    countryType: safeCountryType(input?.countryType),
    countryCustom: safeString(input?.countryCustom, 80),
    requestId: safeString(input?.requestId, 120),
    requestTitle: safeString(input?.requestTitle, 180),
    sourceScreen: safeString(input?.sourceScreen, 80),
    metadata: sanitizeMetadata(input?.metadata),
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };

  return writeDoc(ANALYTICS_COLLECTIONS.EVENTS, payload);
}

export function buildTrackEventKey(eventType, trackType) {
  const safeType = safeString(eventType, 80);
  const safeT = safeTrack(trackType);
  return safeT ? `${safeType}:${safeT}` : safeType;
}

export async function trackManagedCountryTap({
  trackType,
  country,
  sourceScreen = "TrackScreen",
} = {}) {
  const uid = safeString(auth.currentUser?.uid, 120);
  const safeCountry = safeString(country, 80);
  const safeT = safeTrack(trackType);
  const countryKey = normalizeKey(safeCountry, 80);
  if (!uid || !safeCountry || !countryKey) return false;

  void logAnalyticsEvent({
    eventType: ANALYTICS_EVENT_TYPES.COUNTRY_SELECTED,
    uid,
    trackType: safeT,
    country: safeCountry,
    countryType: "managed",
    sourceScreen,
  });

  return writeDoc(ANALYTICS_COLLECTIONS.COUNTRY_DEMAND, {
    uid,
    track: safeT,
    country: safeCountry,
    countryDisplay: safeCountry,
    countryLower: safeCountry.toLowerCase(),
    countryKey,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

export async function trackNewsRouteView({
  trackType,
  country,
  sourceScreen = "NewsScreen",
} = {}) {
  const uid = safeString(auth.currentUser?.uid, 120);
  const safeT = safeTrack(trackType);
  const safeCountry = safeString(country, 80);
  const countryKey = normalizeKey(safeCountry, 80);
  const routeKey = safeT && countryKey ? `${safeT}_${countryKey}` : "";
  if (!uid || !safeT || !safeCountry || !countryKey || !routeKey) return false;

  void logAnalyticsEvent({
    eventType: ANALYTICS_EVENT_TYPES.NEWS_OPENED,
    uid,
    trackType: safeT,
    country: safeCountry,
    countryType: "managed",
    sourceScreen,
  });

  return writeDoc(ANALYTICS_COLLECTIONS.NEWS_ROUTE_VIEWS, {
    uid,
    track: safeT,
    country: safeCountry,
    countryLower: safeCountry.toLowerCase(),
    countryKey,
    routeKey,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}

export async function trackSelfHelpLinkClick({
  trackType,
  country,
  isAffiliate,
  resourceId = "",
  category = "",
  providerKey = "",
  sourceScreen = "SelfHelpGateway",
} = {}) {
  const uid = safeString(auth.currentUser?.uid, 120);
  const safeT = safeTrack(trackType);
  const safeCountry = safeString(country, 80);
  if (!uid || !safeT || !safeCountry) return false;

  const affiliate = Boolean(isAffiliate);

  void logAnalyticsEvent({
    eventType: ANALYTICS_EVENT_TYPES.SELFHELP_LINK_CLICKED,
    uid,
    trackType: safeT,
    country: safeCountry,
    sourceScreen,
    metadata: {
      isAffiliate: affiliate,
      resourceId: safeString(resourceId, 140),
      category: safeString(category, 60),
      providerKey: safeString(providerKey, 80),
    },
  });

  return writeDoc(ANALYTICS_COLLECTIONS.SELFHELP_LINK_CLICKS, {
    uid,
    track: safeT,
    country: safeCountry,
    isAffiliate: affiliate,
    resourceId: safeString(resourceId, 140),
    category: safeString(category, 60),
    providerKey: safeString(providerKey, 80),
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  });
}


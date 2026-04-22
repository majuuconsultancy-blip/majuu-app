import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import { normalizeDestinationCountry, normalizeTrackType } from "../constants/migrationOptions";
import { getCurrentUserRoleContext } from "./adminroleservice";
import { logManagerModuleActivity } from "./managerservice";
import { managerHasModuleAccess } from "./managerModules";

export const DISCOVERY_PUBLICATION_COLLECTION = "discoveryPublications";

const EMPTY_OVERVIEW = Object.freeze({
  summary: "",
  interestingFacts: "",
  whyChoose: "",
  trackNotes: "",
  highlightCta: "",
});

const EMPTY_COMPARE_DATA = Object.freeze({
  visaAcceptanceRatePercent: null,
  visaResultTime: "",
  processCompletionTime: "",
  averageCostEstimate: "",
  affordabilityTier: "",
  speedScore: null,
  trackSuitabilityTags: [],
  bestForTags: [],
  featuredStrength: "",
  interestingFacts: "",
  practicalNotes: "",
  topStudyFields: [],
  studentFriendlyScore: null,
  educationValueScore: null,
  topWorkFields: [],
  workOpportunityScore: null,
  employabilityScore: null,
  travelEaseScore: null,
  tourismAppealScore: null,
  tripStyleTags: [],
  // Legacy aliases kept for compatibility with already-published content.
  visaAcceptanceRate: null,
  fullProcessDuration: "",
  typicalApplicationCost: "",
  estimatedStarterBudget: "",
  easeScore: null,
  documentIntensity: "",
  bestFor: "",
});

const EMPTY_EXTRAS = Object.freeze({
  additionalNotes: "",
  internalNotes: "",
  conversionCta: "",
  trackGuidanceSnippet: "",
});

function safeString(value, max = 5000) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safeParagraph(value, max = 12000) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function normalizeBool(value, fallback = false) {
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

function normalizeNullableNumber(value, { min = 0, max = 100 } = {}) {
  if (value == null || value === "") return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function normalizeTagList(value, { maxItems = 12, maxLength = 80 } = {}) {
  const rows = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/,|\n|;|\u2022/g)
        .map((item) => safeString(item, maxLength));
  const seen = new Set();
  const out = [];
  rows.forEach((item) => {
    const tag = safeString(item, maxLength);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  });
  return out.slice(0, maxItems);
}

function countryToKey(country) {
  const safeCountry = safeString(country, 120).toLowerCase();
  if (!safeCountry) return "";
  return safeCountry
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function buildDiscoveryPublicationId({ trackType = "", country = "" } = {}) {
  const safeTrack = normalizeTrackType(trackType || "study");
  const safeCountry = normalizeDestinationCountry(country) || safeString(country, 120);
  const countryKey = countryToKey(safeCountry);
  if (!countryKey) return "";
  return `${safeTrack}__${countryKey}`;
}

function normalizeOverview(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    summary: safeParagraph(source.summary, 1600),
    interestingFacts: safeParagraph(source.interestingFacts, 2200),
    whyChoose: safeParagraph(source.whyChoose, 2200),
    trackNotes: safeParagraph(source.trackNotes, 2200),
    highlightCta: safeParagraph(source.highlightCta, 420),
  };
}

function normalizeCompareData(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const visaAcceptanceRatePercent = normalizeNullableNumber(
    source.visaAcceptanceRatePercent ?? source.visaAcceptanceRate,
    { min: 0, max: 100 }
  );
  const processCompletionTime = safeString(
    source.processCompletionTime || source.fullProcessDuration,
    140
  );
  const averageCostEstimate = safeString(
    source.averageCostEstimate || source.typicalApplicationCost,
    140
  );
  const speedScore = normalizeNullableNumber(source.speedScore ?? source.easeScore, {
    min: 0,
    max: 10,
  });
  const bestForTags = normalizeTagList(source.bestForTags || source.bestFor, {
    maxItems: 10,
    maxLength: 84,
  });

  return {
    visaAcceptanceRatePercent,
    visaResultTime: safeString(source.visaResultTime, 140),
    processCompletionTime,
    averageCostEstimate,
    affordabilityTier: safeString(source.affordabilityTier, 60),
    speedScore,
    trackSuitabilityTags: normalizeTagList(source.trackSuitabilityTags, {
      maxItems: 12,
      maxLength: 84,
    }),
    bestForTags,
    featuredStrength: safeString(source.featuredStrength, 220),
    interestingFacts: safeParagraph(source.interestingFacts, 2200),
    practicalNotes: safeParagraph(source.practicalNotes, 2200),
    topStudyFields: normalizeTagList(source.topStudyFields, { maxItems: 10, maxLength: 84 }),
    studentFriendlyScore: normalizeNullableNumber(source.studentFriendlyScore, {
      min: 0,
      max: 10,
    }),
    educationValueScore: normalizeNullableNumber(source.educationValueScore, {
      min: 0,
      max: 10,
    }),
    topWorkFields: normalizeTagList(source.topWorkFields, { maxItems: 10, maxLength: 84 }),
    workOpportunityScore: normalizeNullableNumber(source.workOpportunityScore, {
      min: 0,
      max: 10,
    }),
    employabilityScore: normalizeNullableNumber(source.employabilityScore, {
      min: 0,
      max: 10,
    }),
    travelEaseScore: normalizeNullableNumber(source.travelEaseScore, { min: 0, max: 10 }),
    tourismAppealScore: normalizeNullableNumber(source.tourismAppealScore, {
      min: 0,
      max: 10,
    }),
    tripStyleTags: normalizeTagList(source.tripStyleTags, { maxItems: 10, maxLength: 84 }),
    // Legacy aliases
    visaAcceptanceRate: visaAcceptanceRatePercent,
    fullProcessDuration: processCompletionTime,
    typicalApplicationCost: averageCostEstimate,
    estimatedStarterBudget: safeString(source.estimatedStarterBudget, 140),
    easeScore: speedScore,
    documentIntensity: safeString(source.documentIntensity, 140),
    bestFor: safeParagraph(source.bestFor || bestForTags.join(", "), 700),
  };
}

function normalizeExtras(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    additionalNotes: safeParagraph(source.additionalNotes, 2200),
    internalNotes: safeParagraph(source.internalNotes, 2200),
    conversionCta: safeParagraph(source.conversionCta, 420),
    trackGuidanceSnippet: safeParagraph(source.trackGuidanceSnippet, 700),
  };
}

function normalizeDiscoveryPublicationPayload(input = {}) {
  const safeTrackType = normalizeTrackType(input.trackType || "study");
  const safeCountry = normalizeDestinationCountry(input.country) || safeString(input.country, 120);
  const countryKey = countryToKey(safeCountry);

  if (!safeCountry) throw new Error("Country is required.");
  if (!countryKey) throw new Error("Country key could not be generated.");

  return {
    id: buildDiscoveryPublicationId({ trackType: safeTrackType, country: safeCountry }),
    trackType: safeTrackType,
    country: safeCountry,
    countryKey,
    overview: normalizeOverview(input.overview),
    compareData: normalizeCompareData(input.compareData),
    extras: normalizeExtras(input.extras),
    isPublished: normalizeBool(input.isPublished, true),
  };
}

export function normalizeDiscoveryPublicationRecord(id, raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const safeTrackType = normalizeTrackType(source.trackType || "study");
  const safeCountry = normalizeDestinationCountry(source.country) || safeString(source.country, 120);
  const safeCountryKey = safeString(source.countryKey, 90) || countryToKey(safeCountry);
  const createdAtMs =
    Number(source.createdAtMs || 0) ||
    toTimestampMs(source.createdAt) ||
    Number(source.updatedAtMs || 0);
  const updatedAtMs = Number(source.updatedAtMs || 0) || toTimestampMs(source.updatedAt) || createdAtMs;

  return {
    id: safeString(id || source.id, 180),
    trackType: safeTrackType,
    country: safeCountry,
    countryKey: safeCountryKey,
    overview: normalizeOverview(source.overview || EMPTY_OVERVIEW),
    compareData: normalizeCompareData(source.compareData || EMPTY_COMPARE_DATA),
    extras: normalizeExtras(source.extras || EMPTY_EXTRAS),
    isPublished: normalizeBool(source.isPublished, true),
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
    createdAtMs,
    updatedAtMs,
    updatedByUid: safeString(source.updatedByUid, 120),
    updatedByEmail: safeString(source.updatedByEmail, 200),
  };
}

function compareDiscoveryPublications(left, right) {
  const countryGap = safeString(left?.country, 120).localeCompare(safeString(right?.country, 120));
  if (countryGap !== 0) return countryGap;
  return Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0);
}

async function requireNewsModuleActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  const canAccess =
    Boolean(roleCtx?.isSuperAdmin) ||
    (Boolean(roleCtx?.isManager) &&
      managerHasModuleAccess(roleCtx?.managerScope, "news"));
  if (!canAccess) {
    throw new Error("You do not have access to Discovery publication.");
  }
  return roleCtx;
}

async function logDiscoveryManagerActivity(action, details = "", metadata = {}) {
  try {
    await logManagerModuleActivity({
      moduleKey: "news",
      action,
      details,
      metadata,
    });
  } catch {
    // non-blocking
  }
}

export function createEmptyDiscoveryPublicationDraft({ trackType = "study", country = "" } = {}) {
  return {
    trackType: normalizeTrackType(trackType || "study"),
    country: normalizeDestinationCountry(country) || safeString(country, 120),
    overview: { ...EMPTY_OVERVIEW },
    compareData: {
      ...EMPTY_COMPARE_DATA,
      visaAcceptanceRatePercent: "",
      speedScore: "",
      studentFriendlyScore: "",
      educationValueScore: "",
      workOpportunityScore: "",
      employabilityScore: "",
      travelEaseScore: "",
      tourismAppealScore: "",
      visaAcceptanceRate: "",
      easeScore: "",
    },
    extras: { ...EMPTY_EXTRAS },
    isPublished: true,
  };
}

export function draftFromDiscoveryPublication(publication) {
  const safe = normalizeDiscoveryPublicationRecord(publication?.id, publication || {});
  return {
    trackType: safe.trackType,
    country: safe.country,
    overview: { ...safe.overview },
    compareData: {
      ...safe.compareData,
      visaAcceptanceRatePercent:
        safe.compareData.visaAcceptanceRatePercent == null
          ? ""
          : String(safe.compareData.visaAcceptanceRatePercent),
      speedScore: safe.compareData.speedScore == null ? "" : String(safe.compareData.speedScore),
      studentFriendlyScore:
        safe.compareData.studentFriendlyScore == null
          ? ""
          : String(safe.compareData.studentFriendlyScore),
      educationValueScore:
        safe.compareData.educationValueScore == null
          ? ""
          : String(safe.compareData.educationValueScore),
      workOpportunityScore:
        safe.compareData.workOpportunityScore == null
          ? ""
          : String(safe.compareData.workOpportunityScore),
      employabilityScore:
        safe.compareData.employabilityScore == null ? "" : String(safe.compareData.employabilityScore),
      travelEaseScore:
        safe.compareData.travelEaseScore == null ? "" : String(safe.compareData.travelEaseScore),
      tourismAppealScore:
        safe.compareData.tourismAppealScore == null
          ? ""
          : String(safe.compareData.tourismAppealScore),
      visaAcceptanceRate:
        safe.compareData.visaAcceptanceRate == null ? "" : String(safe.compareData.visaAcceptanceRate),
      easeScore: safe.compareData.easeScore == null ? "" : String(safe.compareData.easeScore),
      trackSuitabilityTags: Array.isArray(safe.compareData.trackSuitabilityTags)
        ? [...safe.compareData.trackSuitabilityTags]
        : [],
      bestForTags: Array.isArray(safe.compareData.bestForTags) ? [...safe.compareData.bestForTags] : [],
      topStudyFields: Array.isArray(safe.compareData.topStudyFields)
        ? [...safe.compareData.topStudyFields]
        : [],
      topWorkFields: Array.isArray(safe.compareData.topWorkFields)
        ? [...safe.compareData.topWorkFields]
        : [],
      tripStyleTags: Array.isArray(safe.compareData.tripStyleTags)
        ? [...safe.compareData.tripStyleTags]
        : [],
    },
    extras: { ...safe.extras },
    isPublished: Boolean(safe.isPublished),
  };
}

export function subscribeDiscoveryPublicationsByTrack({
  trackType = "",
  includeUnpublished = true,
  onData,
  onError,
} = {}) {
  const safeTrackType = normalizeTrackType(trackType || "study");
  const queryConstraints = [where("trackType", "==", safeTrackType)];
  if (!includeUnpublished) {
    queryConstraints.push(where("isPublished", "==", true));
  }
  const rowsQuery = query(collection(db, DISCOVERY_PUBLICATION_COLLECTION), ...queryConstraints);

  return onSnapshot(
    rowsQuery,
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeDiscoveryPublicationRecord(row.id, row.data() || {}))
        .filter((row) => (includeUnpublished ? true : row.isPublished))
        .sort(compareDiscoveryPublications);

      onData?.(rows);
    },
    (error) => {
      console.error("discovery publication subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function upsertDiscoveryPublication(input = {}) {
  const actor = await requireNewsModuleActor();

  const payload = normalizeDiscoveryPublicationPayload(input);
  const nowMs = Date.now();
  const safeId = safeString(payload.id, 180);
  if (!safeId) throw new Error("Discovery publication id is missing.");

  await setDoc(
    doc(db, DISCOVERY_PUBLICATION_COLLECTION, safeId),
    {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedByUid: safeString(auth.currentUser?.uid, 120),
      updatedByEmail: safeString(auth.currentUser?.email, 200),
    },
    { merge: true }
  );

  if (actor?.isManager) {
    await logDiscoveryManagerActivity("discovery_publication_upserted", payload.country, {
      publicationId: safeId,
      trackType: payload.trackType,
      country: payload.country,
    });
  }

  return safeId;
}

export async function deleteDiscoveryPublication({ trackType = "", country = "" } = {}) {
  const actor = await requireNewsModuleActor();

  const safeId = buildDiscoveryPublicationId({ trackType, country });
  if (!safeId) throw new Error("Missing discovery publication id.");
  await deleteDoc(doc(db, DISCOVERY_PUBLICATION_COLLECTION, safeId));
  if (actor?.isManager) {
    await logDiscoveryManagerActivity("discovery_publication_deleted", "", {
      publicationId: safeId,
    });
  }
}

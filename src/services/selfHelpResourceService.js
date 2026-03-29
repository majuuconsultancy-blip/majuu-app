import {
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import {
  APP_DESTINATION_COUNTRIES,
  APP_TRACK_META,
  APP_TRACK_OPTIONS,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import { auth, db } from "../firebase";
import { BUNDLED_SELF_HELP_RESOURCES } from "../selfHelp/selfHelpCatalog";
import { getCurrentUserRoleContext } from "./adminroleservice";
import { logManagerModuleActivity } from "./managerservice";
import { managerHasModuleAccess } from "./managerModules";

export const SELF_HELP_RESOURCE_COLLECTION = "selfHelpLinks";
export const SELF_HELP_RESOURCE_GLOBAL_COUNTRY = "Global";
export const SELF_HELP_RESOURCE_ALL_TRACKS = "all";

export const SELF_HELP_RESOURCE_TRACK_OPTIONS = [
  ...APP_TRACK_OPTIONS,
  SELF_HELP_RESOURCE_ALL_TRACKS,
];

export const SELF_HELP_RESOURCE_COUNTRY_OPTIONS = [
  SELF_HELP_RESOURCE_GLOBAL_COUNTRY,
  ...APP_DESTINATION_COUNTRIES,
];

export const SELF_HELP_RESOURCE_CATEGORY_OPTIONS = [
  { value: "flights", label: "Flights" },
  { value: "accommodation", label: "Accommodation" },
  { value: "insurance", label: "Insurance" },
  { value: "schools", label: "Universities / Schools" },
  { value: "scholarships", label: "Scholarships" },
  { value: "visa", label: "Visa / Immigration" },
  { value: "jobs", label: "Jobs / Employers" },
  { value: "banking", label: "Banking / Forex" },
  { value: "finance", label: "Banking / Forex" },
  { value: "currency", label: "Banking / Forex" },
  { value: "documents", label: "Courier / Documents" },
  { value: "settlement", label: "Travel Prep" },
  { value: "transport", label: "Travel Prep" },
  { value: "resume", label: "CV / Resume" },
  { value: "other", label: "Other" },
];

const EXTRA_RUNTIME_LABELS = new Set(["partner", "recommended"]);
const DEFAULT_PROVIDER_LABELS = {
  airalo: "Airalo",
  booking: "Booking.com",
  "direct-web": "External web",
  "google-flights": "Google Flights",
  "linkedin-jobs": "LinkedIn Jobs",
  numbeo: "Numbeo",
  rome2rio: "Rome2Rio",
  skyscanner: "Skyscanner",
  studyportals: "Studyportals",
  wise: "Wise",
  xe: "XE Currency",
};

let cachedResourceRecords = [];
let cachedResourceRecordMap = new Map();

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeParagraphText(value, max = 1000) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
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

function toWholeNumber(value, fallback = 0, { min = 0, max = 99999999 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeBoolean(value) {
  return value === true;
}

function slugify(value) {
  return safeString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeLabelList(labels) {
  if (!Array.isArray(labels)) return [];
  return Array.from(
    new Set(
      labels
        .map((label) => safeString(label, 24).toLowerCase())
        .filter((label) => EXTRA_RUNTIME_LABELS.has(label))
    )
  ).slice(0, 6);
}

function sanitizeRequiredFields(fields) {
  if (!Array.isArray(fields)) return [];
  return Array.from(
    new Set(
      fields
        .map((field) => safeString(field, 40))
        .filter(Boolean)
    )
  ).slice(0, 6);
}

function deriveProviderName(baseUrl, providerKey, fallbackTitle = "") {
  const safeProviderKey = safeString(providerKey, 80).toLowerCase();
  if (DEFAULT_PROVIDER_LABELS[safeProviderKey]) {
    return DEFAULT_PROVIDER_LABELS[safeProviderKey];
  }

  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    const root = host.split(".")[0] || "";
    if (root) {
      return root
        .split(/[-_]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
    }
  } catch {
    // ignore invalid URL parsing here
  }

  return safeString(fallbackTitle, 120);
}

function normalizeUrl(value, { fieldLabel = "URL", required = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (required) throw new Error(`${fieldLabel} is required.`);
    return "";
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${fieldLabel} must start with http or https.`);
    }
    return url.toString();
  } catch {
    throw new Error(`Enter a valid ${fieldLabel.toLowerCase()}.`);
  }
}

function readUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeCategory(value) {
  const raw = safeString(value, 40).toLowerCase();
  if (!raw) return "other";
  return SELF_HELP_RESOURCE_CATEGORY_OPTIONS.some((option) => option.value === raw) ? raw : "other";
}

export function getSelfHelpResourceCategoryLabel(category) {
  const safeCategory = normalizeCategory(category);
  return (
    SELF_HELP_RESOURCE_CATEGORY_OPTIONS.find((option) => option.value === safeCategory)?.label ||
    "Other"
  );
}

export function normalizeSelfHelpResourceTrackType(value) {
  const raw = safeString(value, 20).toLowerCase();
  if (!raw || raw === "*" || raw === "global") return SELF_HELP_RESOURCE_ALL_TRACKS;
  if (raw === SELF_HELP_RESOURCE_ALL_TRACKS) return SELF_HELP_RESOURCE_ALL_TRACKS;
  return APP_TRACK_OPTIONS.includes(raw) ? raw : normalizeTrackType(raw);
}

export function getSelfHelpResourceTrackLabel(trackType) {
  const safeTrack = normalizeSelfHelpResourceTrackType(trackType);
  if (safeTrack === SELF_HELP_RESOURCE_ALL_TRACKS) return "All tracks";
  return APP_TRACK_META[safeTrack]?.label || "Study";
}

export function normalizeSelfHelpResourceCountry(value) {
  const raw = safeString(value, 80);
  if (!raw) return SELF_HELP_RESOURCE_GLOBAL_COUNTRY;

  const lowered = raw.toLowerCase();
  if (["*", "global", "all", "worldwide"].includes(lowered)) {
    return SELF_HELP_RESOURCE_GLOBAL_COUNTRY;
  }

  return normalizeDestinationCountry(raw) || raw;
}

function normalizeProviderKey(value, providerName = "", baseUrl = "") {
  const explicit = slugify(value);
  if (explicit) return explicit;

  const named = slugify(providerName);
  if (named) return named;

  try {
    const parsed = new URL(baseUrl);
    return slugify(parsed.hostname.replace(/^www\./i, ""));
  } catch {
    return "direct-web";
  }
}

function normalizeLinkMode(value, smartBuilder, supportsSmartParams) {
  const raw = safeString(value, 20).toLowerCase();
  if (raw === "smart" && safeString(smartBuilder, 80)) return "smart";
  return supportsSmartParams && safeString(smartBuilder, 80) ? "smart" : "direct";
}

function buildDerivedLabels(resource) {
  const labels = [...sanitizeLabelList(resource?.labels)];
  if (resource?.isFeatured) labels.unshift("featured");
  if (resource?.isAffiliate) labels.unshift("affiliate");
  if (resource?.isOfficial) labels.unshift("official");
  if (resource?.linkMode === "smart" && safeString(resource?.smartBuilder, 80)) {
    labels.push("smart");
  }
  return Array.from(new Set(labels));
}

function compareResourceRecords(left, right) {
  const activeGap = Number(Boolean(right?.isActive)) - Number(Boolean(left?.isActive));
  if (activeGap !== 0) return activeGap;

  const featuredGap = Number(Boolean(right?.isFeatured)) - Number(Boolean(left?.isFeatured));
  if (featuredGap !== 0) return featuredGap;

  const orderGap = Number(right?.sortOrder || 0) - Number(left?.sortOrder || 0);
  if (orderGap !== 0) return orderGap;

  const clickGap = Number(right?.clickCount || 0) - Number(left?.clickCount || 0);
  if (clickGap !== 0) return clickGap;

  return safeString(left?.title, 160).localeCompare(safeString(right?.title, 160));
}

export function normalizeSelfHelpResourceRecord(id, raw = {}) {
  const baseUrl = readUrl(raw?.baseUrl);
  const affiliateUrl = readUrl(raw?.affiliateUrl);
  const providerName =
    safeString(raw?.providerName, 120) ||
    deriveProviderName(baseUrl || affiliateUrl, raw?.providerKey, raw?.title);
  const providerKey = normalizeProviderKey(raw?.providerKey, providerName, baseUrl || affiliateUrl);
  const supportsSmartParams =
    normalizeBoolean(raw?.supportsSmartParams) ||
    safeString(raw?.linkMode, 20).toLowerCase() === "smart" ||
    sanitizeRequiredFields(raw?.requiredFields).length > 0;
  const smartBuilder = safeString(raw?.smartBuilder, 80);
  const linkMode = normalizeLinkMode(raw?.linkMode, smartBuilder, supportsSmartParams);
  const createdAtMs =
    Number(raw?.createdAtMs || 0) || toTimestampMs(raw?.createdAt) || Number(raw?.updatedAtMs || 0);
  const updatedAtMs = Number(raw?.updatedAtMs || 0) || toTimestampMs(raw?.updatedAt) || createdAtMs;

  return {
    id: safeString(id || raw?.id, 140),
    title: safeString(raw?.title, 140),
    description: safeParagraphText(raw?.description, 400),
    category: normalizeCategory(raw?.category),
    trackType: normalizeSelfHelpResourceTrackType(raw?.trackType),
    country: normalizeSelfHelpResourceCountry(raw?.country),
    providerName,
    providerKey,
    baseUrl,
    affiliateUrl,
    isAffiliate: normalizeBoolean(raw?.isAffiliate),
    isOfficial: normalizeBoolean(raw?.isOfficial),
    isFeatured: normalizeBoolean(raw?.isFeatured),
    isActive: raw?.isActive !== false,
    supportsSmartParams,
    sortOrder: toWholeNumber(raw?.sortOrder, 60, { min: 0, max: 100000 }),
    clickCount: toWholeNumber(raw?.clickCount, 0, { min: 0, max: 999999999 }),
    labels: sanitizeLabelList(raw?.labels),
    resourceType: safeString(raw?.resourceType, 80) || normalizeCategory(raw?.category),
    linkMode,
    smartBuilder,
    requiredFields: sanitizeRequiredFields(raw?.requiredFields),
    redirectEnabled: raw?.redirectEnabled !== false,
    createdAt: raw?.createdAt || null,
    updatedAt: raw?.updatedAt || null,
    createdAtMs,
    updatedAtMs,
    updatedByUid: safeString(raw?.updatedByUid, 120),
    updatedByEmail: safeString(raw?.updatedByEmail, 160),
    importedFromBundled: normalizeBoolean(raw?.importedFromBundled),
  };
}

function validateResourcePayload(payload) {
  if (!payload.title) throw new Error("Title is required.");
  if (!payload.providerName) throw new Error("Provider name is required.");
  if (!payload.baseUrl) throw new Error("Base URL is required.");
}

export function createEmptySelfHelpResourceDraft({
  trackType = SELF_HELP_RESOURCE_ALL_TRACKS,
  country = SELF_HELP_RESOURCE_GLOBAL_COUNTRY,
  category = "flights",
} = {}) {
  return {
    id: "",
    title: "",
    description: "",
    category: normalizeCategory(category),
    trackType: normalizeSelfHelpResourceTrackType(trackType),
    country: normalizeSelfHelpResourceCountry(country),
    providerName: "",
    providerKey: "",
    baseUrl: "",
    affiliateUrl: "",
    isAffiliate: false,
    isOfficial: false,
    isFeatured: false,
    isActive: true,
    supportsSmartParams: false,
    sortOrder: 60,
    clickCount: 0,
    labels: [],
    resourceType: "",
    linkMode: "direct",
    smartBuilder: "",
    requiredFields: [],
    redirectEnabled: true,
  };
}

export function draftFromSelfHelpResource(resource) {
  const clean = normalizeSelfHelpResourceRecord(resource?.id, resource || {});
  return {
    ...clean,
  };
}

export function toSelfHelpResourcePayload(input = {}) {
  const baseUrl = normalizeUrl(input?.baseUrl, { fieldLabel: "Base URL", required: true });
  const affiliateUrl = normalizeUrl(input?.affiliateUrl, {
    fieldLabel: "Affiliate URL",
    required: false,
  });
  const providerName =
    safeString(input?.providerName, 120) ||
    deriveProviderName(baseUrl || affiliateUrl, input?.providerKey, input?.title);
  const providerKey = normalizeProviderKey(input?.providerKey, providerName, baseUrl || affiliateUrl);
  const supportsSmartParams =
    normalizeBoolean(input?.supportsSmartParams) ||
    safeString(input?.linkMode, 20).toLowerCase() === "smart" ||
    sanitizeRequiredFields(input?.requiredFields).length > 0;
  const smartBuilder = safeString(input?.smartBuilder, 80);
  const linkMode = normalizeLinkMode(input?.linkMode, smartBuilder, supportsSmartParams);

  const payload = {
    id: safeString(input?.id, 140),
    title: safeString(input?.title, 140),
    description: safeParagraphText(input?.description, 400),
    category: normalizeCategory(input?.category),
    trackType: normalizeSelfHelpResourceTrackType(input?.trackType),
    country: normalizeSelfHelpResourceCountry(input?.country),
    providerName,
    providerKey,
    baseUrl,
    affiliateUrl,
    isAffiliate: normalizeBoolean(input?.isAffiliate),
    isOfficial: normalizeBoolean(input?.isOfficial),
    isFeatured: normalizeBoolean(input?.isFeatured),
    isActive: input?.isActive !== false,
    supportsSmartParams,
    sortOrder: toWholeNumber(input?.sortOrder, 60, { min: 0, max: 100000 }),
    clickCount: toWholeNumber(input?.clickCount, 0, { min: 0, max: 999999999 }),
    labels: sanitizeLabelList(input?.labels),
    resourceType: safeString(input?.resourceType, 80) || normalizeCategory(input?.category),
    linkMode,
    smartBuilder,
    requiredFields: sanitizeRequiredFields(input?.requiredFields),
    redirectEnabled: input?.redirectEnabled !== false,
  };

  validateResourcePayload(payload);
  return payload;
}

function buildBundledResourceSeed(resource) {
  const trackType =
    Array.isArray(resource?.tracks) && resource.tracks.length === 1
      ? normalizeTrackType(resource.tracks[0])
      : SELF_HELP_RESOURCE_ALL_TRACKS;
  const country =
    Array.isArray(resource?.countries) &&
    resource.countries.length === 1 &&
    resource.countries[0] !== "*"
      ? normalizeSelfHelpResourceCountry(resource.countries[0])
      : SELF_HELP_RESOURCE_GLOBAL_COUNTRY;
  const labels = Array.isArray(resource?.labels) ? resource.labels : [];
  const providerName =
    DEFAULT_PROVIDER_LABELS[safeString(resource?.providerKey, 80).toLowerCase()] ||
    deriveProviderName(resource?.baseUrl, resource?.providerKey, resource?.title);

  return {
    id: safeString(resource?.id, 140),
    title: safeString(resource?.title, 140),
    description: safeParagraphText(resource?.description, 400),
    category: normalizeCategory(resource?.category),
    trackType,
    country,
    providerName,
    providerKey: safeString(resource?.providerKey, 80),
    baseUrl: safeString(resource?.baseUrl, 1200),
    affiliateUrl: "",
    isAffiliate: labels.includes("affiliate"),
    isOfficial: labels.includes("official"),
    isFeatured: labels.includes("featured"),
    isActive: true,
    supportsSmartParams:
      safeString(resource?.linkMode, 20) === "smart" ||
      sanitizeRequiredFields(resource?.requiredFields).length > 0,
    sortOrder: toWholeNumber(resource?.priority, 60, { min: 0, max: 100000 }),
    clickCount: 0,
    labels: labels.filter((label) => EXTRA_RUNTIME_LABELS.has(label)),
    resourceType: safeString(resource?.resourceType, 80),
    linkMode: safeString(resource?.linkMode, 20) === "smart" ? "smart" : "direct",
    smartBuilder: safeString(resource?.smartBuilder, 80),
    requiredFields: sanitizeRequiredFields(resource?.requiredFields),
    redirectEnabled: resource?.redirectEnabled !== false,
    importedFromBundled: true,
  };
}

function buildRuntimeResource(record) {
  const clean = normalizeSelfHelpResourceRecord(record?.id, record || {});
  const effectiveBaseUrl =
    clean.isAffiliate && clean.affiliateUrl ? clean.affiliateUrl : clean.baseUrl;

  return {
    id: clean.id,
    title: clean.title,
    description: clean.description,
    category: clean.category,
    tracks:
      clean.trackType === SELF_HELP_RESOURCE_ALL_TRACKS
        ? [...APP_TRACK_OPTIONS]
        : [clean.trackType],
    countries:
      clean.country === SELF_HELP_RESOURCE_GLOBAL_COUNTRY ? ["*"] : [clean.country],
    resourceType: clean.resourceType || clean.category || "resource",
    baseUrl: effectiveBaseUrl,
    labels: buildDerivedLabels(clean),
    priority: clean.sortOrder,
    providerKey: clean.providerKey || "direct-web",
    redirectEnabled: clean.redirectEnabled !== false,
    linkMode: clean.linkMode === "smart" && clean.smartBuilder ? "smart" : "direct",
    smartBuilder: clean.smartBuilder || "",
    requiredFields: clean.linkMode === "smart" ? clean.requiredFields : [],
    providerName: clean.providerName,
    trackType: clean.trackType,
    country: clean.country,
    sortOrder: clean.sortOrder,
    clickCount: clean.clickCount,
    isActive: clean.isActive,
    isAffiliate: clean.isAffiliate,
    isOfficial: clean.isOfficial,
    isFeatured: clean.isFeatured,
    affiliateUrl: clean.affiliateUrl,
    canonicalBaseUrl: clean.baseUrl,
  };
}

export function cacheSelfHelpResourceRecords(records = []) {
  cachedResourceRecords = [...(Array.isArray(records) ? records : [])]
    .map((record) => normalizeSelfHelpResourceRecord(record?.id, record || {}))
    .filter((record) => record.id)
    .sort(compareResourceRecords);
  cachedResourceRecordMap = new Map(cachedResourceRecords.map((record) => [record.id, record]));
  return cachedResourceRecords;
}

export function getCachedSelfHelpResourceRecords() {
  return cachedResourceRecords;
}

export function mergeSelfHelpRuntimeResources(records = cachedResourceRecords) {
  const normalizedRecords = cacheSelfHelpResourceRecords(records);
  const overriddenIds = new Set(normalizedRecords.map((record) => record.id));
  const runtimeResources = normalizedRecords
    .filter((record) => record.isActive)
    .map((record) => buildRuntimeResource(record));

  return [
    ...runtimeResources,
    ...BUNDLED_SELF_HELP_RESOURCES.filter((resource) => !overriddenIds.has(resource.id)),
  ];
}

export function getSelfHelpRuntimeResourceById(resourceId) {
  const safeId = safeString(resourceId, 140);
  if (!safeId) return null;

  const cached = cachedResourceRecordMap.get(safeId);
  if (cached) {
    return cached.isActive ? buildRuntimeResource(cached) : null;
  }

  const bundled = BUNDLED_SELF_HELP_RESOURCES.find((resource) => resource.id === safeId);
  return bundled || null;
}

async function requireAffiliateModuleActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  const canAccess =
    Boolean(roleCtx?.isSuperAdmin) ||
    (Boolean(roleCtx?.isManager) &&
      managerHasModuleAccess(roleCtx?.managerScope, "selfhelp-links"));
  if (!canAccess) {
    throw new Error("You do not have access to Affiliate Management.");
  }
  return roleCtx;
}

async function logAffiliateManagerActivity(action, details = "", metadata = {}) {
  try {
    await logManagerModuleActivity({
      moduleKey: "selfhelp-links",
      action,
      details,
      metadata,
    });
  } catch {
    // non-blocking
  }
}

export function subscribeAllSelfHelpResources({ onData, onError } = {}) {
  return onSnapshot(
    collection(db, SELF_HELP_RESOURCE_COLLECTION),
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeSelfHelpResourceRecord(row.id, row.data() || {}))
        .filter((row) => row.id)
        .sort(compareResourceRecords);

      cacheSelfHelpResourceRecords(rows);
      onData?.(rows);
    },
    (error) => {
      console.error("selfHelp links subscription failed:", error);
      onError?.(error);
    }
  );
}

export const subscribeRuntimeSelfHelpResources = subscribeAllSelfHelpResources;

export async function createSelfHelpResource(input = {}) {
  const actor = await requireAffiliateModuleActor();

  const payload = toSelfHelpResourcePayload(input);
  const ref = doc(collection(db, SELF_HELP_RESOURCE_COLLECTION));
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

  if (actor?.isManager) {
    await logAffiliateManagerActivity("affiliate_resource_created", payload.title, {
      resourceId: ref.id,
      category: payload.category,
      trackType: payload.trackType,
      country: payload.country,
    });
  }

  return ref.id;
}

export async function updateSelfHelpResource(resourceId, input = {}) {
  const actor = await requireAffiliateModuleActor();

  const safeId = safeString(resourceId, 140);
  if (!safeId) throw new Error("Missing SelfHelp resource id.");

  const payload = toSelfHelpResourcePayload({
    ...input,
    id: safeId,
  });

  await setDoc(
    doc(db, SELF_HELP_RESOURCE_COLLECTION, safeId),
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

  if (actor?.isManager) {
    await logAffiliateManagerActivity("affiliate_resource_updated", payload.title, {
      resourceId: safeId,
      category: payload.category,
      trackType: payload.trackType,
      country: payload.country,
    });
  }
}

export async function setSelfHelpResourceActiveState(resourceId, isActive) {
  const actor = await requireAffiliateModuleActor();

  const safeId = safeString(resourceId, 140);
  if (!safeId) throw new Error("Missing SelfHelp resource id.");

  await updateDoc(doc(db, SELF_HELP_RESOURCE_COLLECTION, safeId), {
    isActive: normalizeBoolean(isActive),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });

  if (actor?.isManager) {
    await logAffiliateManagerActivity(
      normalizeBoolean(isActive) ? "affiliate_resource_activated" : "affiliate_resource_deactivated",
      "",
      { resourceId: safeId }
    );
  }
}

export async function incrementSelfHelpResourceClick(resourceId) {
  const safeId = safeString(resourceId, 140);
  if (!safeId || !cachedResourceRecordMap.has(safeId)) return;

  try {
    await updateDoc(doc(db, SELF_HELP_RESOURCE_COLLECTION, safeId), {
      clickCount: increment(1),
      lastClickedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    });
  } catch (error) {
    console.warn("selfHelp click count update failed:", error?.message || error);
  }
}

export async function importBundledSelfHelpResources({ onlyMissing = true } = {}) {
  const actor = await requireAffiliateModuleActor();

  const snapshot = await getDocs(collection(db, SELF_HELP_RESOURCE_COLLECTION));
  const existingIds = new Set(snapshot.docs.map((docSnap) => safeString(docSnap.id, 140)));
  const batch = writeBatch(db);
  let importedCount = 0;

  BUNDLED_SELF_HELP_RESOURCES.forEach((resource) => {
    const safeId = safeString(resource?.id, 140);
    if (!safeId) return;
    if (onlyMissing && existingIds.has(safeId)) return;

    const seed = toSelfHelpResourcePayload({
      ...buildBundledResourceSeed(resource),
      id: safeId,
    });
    const nowMs = Date.now();

    batch.set(
      doc(db, SELF_HELP_RESOURCE_COLLECTION, safeId),
      {
        ...seed,
        id: safeId,
        importedFromBundled: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        updatedByUid: safeString(auth.currentUser?.uid, 120),
        updatedByEmail: safeString(auth.currentUser?.email, 160),
      },
      { merge: true }
    );
    importedCount += 1;
  });

  if (!importedCount) {
    return {
      importedCount: 0,
      skippedCount: BUNDLED_SELF_HELP_RESOURCES.length,
    };
  }

  await batch.commit();

  if (actor?.isManager) {
    await logAffiliateManagerActivity("affiliate_bundled_import", "", {
      importedCount,
      onlyMissing: onlyMissing !== false,
    });
  }

  return {
    importedCount,
    skippedCount: Math.max(0, BUNDLED_SELF_HELP_RESOURCES.length - importedCount),
  };
}

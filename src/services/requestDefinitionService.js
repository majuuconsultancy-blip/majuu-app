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

import {
  APP_DESTINATION_COUNTRIES,
  APP_TRACK_META,
  APP_TRACK_OPTIONS,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import { auth, db } from "../firebase";
import { getCurrentUserRoleContext } from "./adminroleservice";
import { logManagerModuleActivity } from "./managerservice";
import { managerHasModuleAccess } from "./managerModules";

export const REQUEST_DEFINITION_COLLECTION = "requestDefinitions";
export const REQUEST_EXTRA_FIELD_TYPE_OPTIONS = ["text", "textarea", "number", "document"];
export const REQUEST_DEFINITION_ENTRY_PLACEMENTS = ["wehelp_country", "track_simple"];
export const REQUEST_DEFINITION_COUNTRY_SOURCES = [
  "selected_country",
  "profile_country_of_residence",
];
export const REQUEST_DEFINITION_PROFILE_COUNTRY_SCOPE = "Profile Country";

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeParagraphText(value, max = 1000) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function toWholeNumber(value, fallback = 0, { min = 0, max = 100000 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizeBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function slugify(value) {
  return safeString(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function createLocalId(prefix) {
  const head = safeString(prefix, 20).toLowerCase() || "item";
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

function normalizeExtraFieldType(value) {
  const raw = safeString(value, 20).toLowerCase();
  return REQUEST_EXTRA_FIELD_TYPE_OPTIONS.includes(raw) ? raw : "text";
}

function normalizeDefinitionEntryPlacement(value) {
  const raw = safeString(value, 40).toLowerCase();
  return REQUEST_DEFINITION_ENTRY_PLACEMENTS.includes(raw) ? raw : "wehelp_country";
}

function normalizeDefinitionCountrySource(value, placement = "wehelp_country") {
  if (normalizeDefinitionEntryPlacement(placement) === "track_simple") {
    return "profile_country_of_residence";
  }
  const raw = safeString(value, 60).toLowerCase();
  if (REQUEST_DEFINITION_COUNTRY_SOURCES.includes(raw)) return raw;
  return "selected_country";
}

function normalizeRequestDefinitionTrackType(value) {
  return normalizeTrackType(value || "study");
}

function normalizeRequestDefinitionTrackTypes(value, fallbackTrackType = "study") {
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const rows = [];
  list.forEach((entry) => {
    const raw = safeString(entry, 20).toLowerCase();
    const track = APP_TRACK_OPTIONS.includes(raw) ? raw : "";
    if (!track || seen.has(track)) return;
    seen.add(track);
    rows.push(track);
  });
  if (!rows.length) {
    return [normalizeRequestDefinitionTrackType(fallbackTrackType)];
  }
  return APP_TRACK_OPTIONS.filter((track) => seen.has(track));
}

function normalizeRequestDefinitionCountry(
  value,
  {
    entryPlacement = "wehelp_country",
    countrySource = "selected_country",
    fallback = APP_DESTINATION_COUNTRIES[0],
  } = {}
) {
  if (
    normalizeDefinitionEntryPlacement(entryPlacement) === "track_simple" ||
    normalizeDefinitionCountrySource(countrySource, entryPlacement) ===
      "profile_country_of_residence"
  ) {
    return "";
  }

  return normalizeDestinationCountry(value) || safeString(value, 120) || fallback;
}

function normalizeLengthValue(value, fallback = 0) {
  return toWholeNumber(value, fallback, { min: 0, max: 5000 });
}

function normalizeExtraFieldRecord(raw = {}, index = 0) {
  const type = normalizeExtraFieldType(raw?.type);
  const label = safeString(raw?.label, 120);
  const helperText = safeParagraphText(raw?.helperText, 240);
  const placeholder =
    type === "document" ? "" : safeString(raw?.placeholder, 120);
  const minLength = type === "document" ? 0 : normalizeLengthValue(raw?.minLength, 0);
  const maxLength = type === "document" ? 0 : normalizeLengthValue(raw?.maxLength, 0);
  const digitsOnly =
    type === "document"
      ? false
      : normalizeBoolean(raw?.digitsOnly, type === "number");

  return {
    id: safeString(raw?.id, 80) || createLocalId("field"),
    label,
    type,
    required: normalizeBoolean(raw?.required, false),
    placeholder,
    helperText,
    minLength,
    maxLength,
    digitsOnly,
    sortOrder: toWholeNumber(raw?.sortOrder, index + 1, { min: 1, max: 1000 }),
    isActive: normalizeBoolean(raw?.isActive, true),
  };
}

function compareExtraFields(left, right) {
  const orderGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (orderGap !== 0) return orderGap;
  return safeString(left?.label, 120).localeCompare(safeString(right?.label, 120));
}

function compareRequestDefinitions(left, right) {
  const activeGap = Number(Boolean(right?.isActive)) - Number(Boolean(left?.isActive));
  if (activeGap !== 0) return activeGap;

  const leftTracks = getRequestDefinitionTrackTypes(left);
  const rightTracks = getRequestDefinitionTrackTypes(right);
  const trackGap =
    APP_TRACK_OPTIONS.indexOf(leftTracks[0]) - APP_TRACK_OPTIONS.indexOf(rightTracks[0]);
  if (trackGap !== 0) return trackGap;

  const placementGap = safeString(left?.entryPlacement, 40).localeCompare(
    safeString(right?.entryPlacement, 40)
  );
  if (placementGap !== 0) return placementGap;

  const countryGap = safeString(left?.country, 80).localeCompare(safeString(right?.country, 80));
  if (countryGap !== 0) return countryGap;

  const sortGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (sortGap !== 0) return sortGap;

  return safeString(left?.title, 140).localeCompare(safeString(right?.title, 140));
}

export function buildRequestDefinitionKey({
  title = "",
  trackType = "",
  country = "",
} = {}) {
  const safeTitle = slugify(title);
  const safeTrackType = normalizeRequestDefinitionTrackType(trackType);
  const safeCountry = slugify(
    normalizeRequestDefinitionCountry(country, { fallback: "" })
  );
  if (!safeTitle || !safeTrackType || !safeCountry) return "";
  return [safeTrackType, safeCountry, safeTitle].join("__");
}

function buildRequestDefinitionPayload(input = {}) {
  const title = safeString(input?.title, 140);
  const entryPlacement = normalizeDefinitionEntryPlacement(input?.entryPlacement);
  const countrySource = normalizeDefinitionCountrySource(
    input?.countrySource,
    entryPlacement
  );
  const trackTypes = normalizeRequestDefinitionTrackTypes(
    input?.trackTypes,
    input?.trackType
  );
  const trackType = trackTypes[0];
  const country = normalizeRequestDefinitionCountry(input?.country, {
    entryPlacement,
    countrySource,
  });
  const definitionKey = buildRequestDefinitionKey({
    title,
    trackType,
    country:
      entryPlacement === "track_simple"
        ? REQUEST_DEFINITION_PROFILE_COUNTRY_SCOPE
        : country,
  });

  const extraFields = (Array.isArray(input?.extraFields) ? input.extraFields : [])
    .map((field, index) => normalizeExtraFieldRecord(field, index))
    .sort(compareExtraFields)
    .map((field, index) => ({
      ...field,
      sortOrder: index + 1,
    }));

  return {
    title,
    titleLower: title.toLowerCase(),
    trackType,
    trackTypes,
    country,
    countryLower: safeString(country, 80).toLowerCase(),
    definitionKey,
    summary: safeParagraphText(input?.summary, 220),
    tag: safeString(input?.tag, 40),
    entryPlacement,
    countrySource,
    sortOrder: toWholeNumber(input?.sortOrder, 0, { min: 0, max: 5000 }),
    isActive: normalizeBoolean(input?.isActive, true),
    extraFields,
  };
}

function validateRequestDefinitionPayload(payload) {
  if (!payload.title) {
    throw new Error("Request title is required.");
  }

  if (!payload.definitionKey) {
    throw new Error("Track, country, and title are required.");
  }

  if (payload.extraFields.length > 30) {
    throw new Error("A request definition can have at most 30 extra fields.");
  }

  const seenIds = new Set();
  const seenLabels = new Set();

  payload.extraFields.forEach((field) => {
    if (!field.label) {
      throw new Error("Each extra field needs a label.");
    }
    if (field.maxLength > 0 && field.minLength > field.maxLength) {
      throw new Error(`"${field.label}" has a minimum length above its maximum length.`);
    }

    const idKey = safeString(field.id, 80).toLowerCase();
    const labelKey = safeString(field.label, 120).toLowerCase();
    if (seenIds.has(idKey)) {
      throw new Error(`Duplicate extra field id found for "${field.label}".`);
    }
    if (seenLabels.has(labelKey)) {
      throw new Error(`Duplicate extra field label "${field.label}" found.`);
    }

    seenIds.add(idKey);
    seenLabels.add(labelKey);
  });
}

export function normalizeRequestDefinitionRecord(id, raw = {}) {
  const payload = buildRequestDefinitionPayload({
    title: raw?.title,
    trackType: raw?.trackType,
    trackTypes: raw?.trackTypes,
    country: raw?.country,
    summary: raw?.summary,
    tag: raw?.tag,
    entryPlacement: raw?.entryPlacement,
    countrySource: raw?.countrySource,
    sortOrder: raw?.sortOrder,
    isActive: raw?.isActive,
    extraFields: raw?.extraFields,
  });
  const createdAtMs =
    Number(raw?.createdAtMs || 0) || toTimestampMs(raw?.createdAt) || Number(raw?.updatedAtMs || 0);
  const updatedAtMs = Number(raw?.updatedAtMs || 0) || toTimestampMs(raw?.updatedAt) || createdAtMs;
  const activeExtraFieldCount = payload.extraFields.filter((field) => field.isActive).length;

  return {
    id: safeString(id || raw?.id, 140),
    ...payload,
    extraFieldCount: payload.extraFields.length,
    activeExtraFieldCount,
    inactiveExtraFieldCount: Math.max(0, payload.extraFields.length - activeExtraFieldCount),
    createdAt: raw?.createdAt || null,
    updatedAt: raw?.updatedAt || null,
    createdAtMs,
    updatedAtMs,
    updatedByUid: safeString(raw?.updatedByUid, 120),
    updatedByEmail: safeString(raw?.updatedByEmail, 160),
  };
}

export function createEmptyRequestExtraFieldDraft({ type = "text" } = {}) {
  return {
    id: "",
    label: "",
    type: normalizeExtraFieldType(type),
    required: false,
    placeholder: "",
    helperText: "",
    minLength: "",
    maxLength: "",
    digitsOnly: normalizeExtraFieldType(type) === "number",
    sortOrder: "",
    isActive: true,
  };
}

export function createEmptyRequestDefinitionDraft({
  trackType = "study",
  country = APP_DESTINATION_COUNTRIES[0],
} = {}) {
  const trackTypes = normalizeRequestDefinitionTrackTypes(trackType);
  return {
    title: "",
    trackType: trackTypes[0],
    trackTypes,
    country: normalizeRequestDefinitionCountry(country, {
      entryPlacement: "wehelp_country",
      countrySource: "selected_country",
    }),
    summary: "",
    tag: "",
    entryPlacement: "wehelp_country",
    countrySource: "selected_country",
    sortOrder: "",
    isActive: true,
    extraFields: [],
  };
}

export function draftFromRequestDefinition(definition) {
  const clean = normalizeRequestDefinitionRecord(definition?.id, definition || {});
  return {
    title: clean.title,
    trackType: clean.trackType,
    trackTypes: getRequestDefinitionTrackTypes(clean),
    country: clean.country,
    summary: clean.summary,
    tag: clean.tag,
    entryPlacement: clean.entryPlacement,
    countrySource: clean.countrySource,
    sortOrder: clean.sortOrder > 0 ? String(clean.sortOrder) : "",
    isActive: clean.isActive,
    extraFields: clean.extraFields.map((field) => ({
      ...field,
      minLength: field.minLength > 0 ? String(field.minLength) : "",
      maxLength: field.maxLength > 0 ? String(field.maxLength) : "",
      sortOrder: String(field.sortOrder || ""),
    })),
  };
}

function normalizeDraftExtraFieldForSave(field, index = 0) {
  return normalizeExtraFieldRecord(
    {
      ...field,
      minLength: field?.minLength === "" ? 0 : field?.minLength,
      maxLength: field?.maxLength === "" ? 0 : field?.maxLength,
      sortOrder: index + 1,
    },
    index
  );
}

export function toRequestDefinitionPayload(input = {}) {
  const payload = buildRequestDefinitionPayload({
    ...input,
    trackTypes: normalizeRequestDefinitionTrackTypes(input?.trackTypes, input?.trackType),
    sortOrder: input?.sortOrder === "" ? 0 : input?.sortOrder,
    extraFields: (Array.isArray(input?.extraFields) ? input.extraFields : []).map((field, index) =>
      normalizeDraftExtraFieldForSave(field, index)
    ),
  });
  validateRequestDefinitionPayload(payload);
  return payload;
}

async function requireRequestManagementActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  const canAccess =
    Boolean(roleCtx?.isSuperAdmin) ||
    (Boolean(roleCtx?.isManager) &&
      managerHasModuleAccess(roleCtx?.managerScope, "request-management"));
  if (!canAccess) {
    throw new Error("You do not have access to Request Management.");
  }
  return roleCtx;
}

async function logRequestDefinitionManagerActivity(action, details = "", metadata = {}) {
  try {
    await logManagerModuleActivity({
      moduleKey: "request-management",
      action,
      details,
      metadata,
    });
  } catch {
    // non-blocking
  }
}

async function ensureUniqueDefinitionKey({ definitionId = "", definitionKey = "" } = {}) {
  const safeId = safeString(definitionId, 140);
  const safeKey = safeString(definitionKey, 200);
  if (!safeKey) {
    throw new Error("Missing request definition key.");
  }

  const snapshot = await getDocs(collection(db, REQUEST_DEFINITION_COLLECTION));
  const duplicate = snapshot.docs.find((docSnap) => {
    const row = docSnap.data() || {};
    const existingId = safeString(docSnap.id, 140);
    const existingKey = safeString(row?.definitionKey, 200);
    return existingId !== safeId && existingKey === safeKey;
  });

  if (duplicate) {
    throw new Error("A request definition for this title, track, and country already exists.");
  }
}

export function getRequestDefinitionTrackLabel(trackType) {
  const safeTrack = normalizeRequestDefinitionTrackType(trackType);
  return APP_TRACK_META[safeTrack]?.label || "Study";
}

export function getRequestDefinitionTrackTypes(definition) {
  return normalizeRequestDefinitionTrackTypes(
    definition?.trackTypes,
    definition?.trackType
  );
}

export function getRequestDefinitionTrackLabels(definition) {
  return getRequestDefinitionTrackTypes(definition).map((track) =>
    getRequestDefinitionTrackLabel(track)
  );
}

export function requestDefinitionSupportsTrackType(definition, trackType) {
  const safeTrack = normalizeRequestDefinitionTrackType(trackType);
  return getRequestDefinitionTrackTypes(definition).includes(safeTrack);
}

export function isRequestDefinitionProfileCountry(country) {
  const safeCountry = safeString(country, 120).toLowerCase();
  return !safeCountry || safeCountry === REQUEST_DEFINITION_PROFILE_COUNTRY_SCOPE.toLowerCase();
}

export function subscribeAllRequestDefinitions({ onData, onError } = {}) {
  return onSnapshot(
    collection(db, REQUEST_DEFINITION_COLLECTION),
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeRequestDefinitionRecord(row.id, row.data() || {}))
        .filter((row) => row.id)
        .sort(compareRequestDefinitions);

      onData?.(rows);
    },
    (error) => {
      console.error("request definitions subscription failed:", error);
      onError?.(error);
    }
  );
}

export function subscribeActiveRequestDefinitions(
  { trackType = "", country = "", entryPlacement = "", countrySource = "", onData, onError } = {}
) {
  const safeTrackType = trackType ? normalizeRequestDefinitionTrackType(trackType) : "";
  const safeCountry = country ? normalizeRequestDefinitionCountry(country) : "";
  const safeEntryPlacement = entryPlacement
    ? normalizeDefinitionEntryPlacement(entryPlacement)
    : "";
  const safeCountrySource = countrySource
    ? normalizeDefinitionCountrySource(countrySource, safeEntryPlacement || "wehelp_country")
    : "";
  const definitionsQuery = query(
    collection(db, REQUEST_DEFINITION_COLLECTION),
    where("isActive", "==", true)
  );

  return onSnapshot(
    definitionsQuery,
    (snapshot) => {
      const rows = snapshot.docs
        .map((row) => normalizeRequestDefinitionRecord(row.id, row.data() || {}))
        .filter((row) => row.isActive)
        .filter((row) =>
          safeTrackType ? requestDefinitionSupportsTrackType(row, safeTrackType) : true
        )
        .filter((row) => {
          if (!safeCountry) return true;
          if (
            safeEntryPlacement === "track_simple" &&
            safeCountrySource === "profile_country_of_residence"
          ) {
            return true;
          }
          return row.country === safeCountry;
        })
        .filter((row) => (safeEntryPlacement ? row.entryPlacement === safeEntryPlacement : true))
        .filter((row) => (safeCountrySource ? row.countrySource === safeCountrySource : true))
        .sort(compareRequestDefinitions);

      onData?.(rows);
    },
    (error) => {
      console.error("active request definitions subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function fetchRequestDefinitionByKey(definitionKey = "") {
  const safeKey = safeString(definitionKey, 200);
  if (!safeKey) return null;

  const snap = await getDocs(
    query(
      collection(db, REQUEST_DEFINITION_COLLECTION),
      where("definitionKey", "==", safeKey),
      limit(1)
    )
  );

  if (snap.empty) return null;
  const row = snap.docs[0];
  return normalizeRequestDefinitionRecord(row.id, row.data() || {});
}

export async function createRequestDefinition(input = {}) {
  const actor = await requireRequestManagementActor();

  const payload = toRequestDefinitionPayload(input);
  await ensureUniqueDefinitionKey({ definitionKey: payload.definitionKey });

  const ref = doc(collection(db, REQUEST_DEFINITION_COLLECTION));
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
    await logRequestDefinitionManagerActivity("request_definition_created", payload.title, {
      definitionId: ref.id,
      trackTypes: payload.trackTypes,
      country: payload.country,
    });
  }

  return ref.id;
}

export async function updateRequestDefinition(definitionId, input = {}) {
  const actor = await requireRequestManagementActor();

  const safeId = safeString(definitionId, 140);
  if (!safeId) throw new Error("Missing request definition id.");

  const payload = toRequestDefinitionPayload(input);
  await ensureUniqueDefinitionKey({
    definitionId: safeId,
    definitionKey: payload.definitionKey,
  });

  await updateDoc(doc(db, REQUEST_DEFINITION_COLLECTION, safeId), {
    ...payload,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });

  if (actor?.isManager) {
    await logRequestDefinitionManagerActivity("request_definition_updated", payload.title, {
      definitionId: safeId,
      trackTypes: payload.trackTypes,
      country: payload.country,
    });
  }
}

export async function setRequestDefinitionActiveState(definitionId, isActive) {
  const actor = await requireRequestManagementActor();

  const safeId = safeString(definitionId, 140);
  if (!safeId) throw new Error("Missing request definition id.");

  await updateDoc(doc(db, REQUEST_DEFINITION_COLLECTION, safeId), {
    isActive: normalizeBoolean(isActive, true),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
    updatedByUid: safeString(auth.currentUser?.uid, 120),
    updatedByEmail: safeString(auth.currentUser?.email, 160),
  });

  if (actor?.isManager) {
    await logRequestDefinitionManagerActivity(
      normalizeBoolean(isActive, true)
        ? "request_definition_activated"
        : "request_definition_deactivated",
      "",
      { definitionId: safeId }
    );
  }
}

import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import {
  getStoredValue,
  setStoredValue,
  setStoredValueDurable,
} from "../resume/resumeStorage";
import {
  deleteSelfHelpDocumentMirror,
  mirrorSelfHelpDocumentRecord,
} from "../services/documentEngineService";

const SCHEMA_VERSION = 3;
const HISTORY_LIMIT = 14;
const BOOKMARK_LIMIT = 20;
const ROUTE_STATE_LIMIT = 10;
const DOCUMENT_LIMIT = 80;
const CLOUD_MEMORY_COLLECTION = "selfHelp";
const CLOUD_MEMORY_DOC_ID = "memory";
const CLOUD_ROUTE_COLLECTION = "selfHelpRoutes";
const CLOUD_DOCUMENT_COLLECTION = "selfHelpDocuments";
const CLOUD_READ_TIMEOUT_MS = 5000;
const CLOUD_TIMEOUT_TOKEN = "__majuu_selfhelp_cloud_timeout__";
const inMemoryState = new Map();

function keyFor(uid) {
  return `majuu_selfhelp_progress_v1_${String(uid || "").trim()}`;
}

function readCachedRawValue(uid) {
  if (!uid || typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(keyFor(uid));
  } catch {
    return null;
  }
}

function withTimeout(promise, timeoutMs = CLOUD_READ_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(CLOUD_TIMEOUT_TOKEN), timeoutMs);
    }),
  ]);
}

function rememberState(uid, state) {
  if (!uid) return sanitizeState(state);
  const safe = sanitizeState(state);
  inMemoryState.set(uid, safe);
  return safe;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNumber(value) {
  return Number(value || 0) || 0;
}

function sanitizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return Array.from(
    new Set(labels.map((label) => safeString(label, 24).toLowerCase()).filter(Boolean))
  ).slice(0, 8);
}

function sanitizeIdList(values, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => safeString(value, maxLength)).filter(Boolean))
  ).slice(0, maxItems);
}

function sanitizeSmartParams(value) {
  if (!isObject(value)) return null;
  return {
    city: safeString(value.city, 80),
    stayType: safeString(value.stayType, 60),
    checkIn: safeString(value.checkIn, 20),
  };
}

function sanitizeAmount(value) {
  return String(value || "").replace(/[^\d.]/g, "").slice(0, 24);
}

function sanitizeMonth(value) {
  const text = safeString(value, 10);
  return /^\d{4}-\d{2}$/.test(text) ? text : "";
}

function sanitizeCurrencyCode(value) {
  return safeString(value, 6).toUpperCase();
}

function sanitizePlannerRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!isObject(row)) return null;
      const id = safeString(row.id, 80);
      if (!id) return null;
      return {
        id,
        label: safeString(row.label, 120),
        amount: sanitizeAmount(row.amount),
        currency: sanitizeCurrencyCode(row.currency),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeTimelineItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!isObject(item)) return null;
      const id = safeString(item.id, 80);
      if (!id) return null;
      return {
        id,
        title: safeString(item.title, 120),
        month: sanitizeMonth(item.month),
        completed: Boolean(item.completed),
      };
    })
    .filter(Boolean)
    .slice(0, 16);
}

function defaultMoneyToolsState() {
  return {
    currency: {
      amount: "1000",
      fromCurrency: "",
      toCurrency: "",
    },
    planner: {
      rows: [],
    },
    timeline: {
      targetMonth: "",
      items: [],
    },
  };
}

function sanitizeMoneyToolsState(value) {
  const base = defaultMoneyToolsState();
  if (!isObject(value)) return base;

  return {
    currency: {
      amount: sanitizeAmount(value.currency?.amount || base.currency.amount) || "1000",
      fromCurrency: sanitizeCurrencyCode(value.currency?.fromCurrency),
      toCurrency: sanitizeCurrencyCode(value.currency?.toCurrency),
    },
    planner: {
      rows: sanitizePlannerRows(value.planner?.rows),
    },
    timeline: {
      targetMonth: sanitizeMonth(value.timeline?.targetMonth),
      items: sanitizeTimelineItems(value.timeline?.items),
    },
  };
}

function sanitizeDocumentRecord(value) {
  if (!isObject(value)) return null;

  const track = safeString(value.track, 20).toLowerCase();
  const country = safeString(value.country, 80);
  const category = safeString(value.category, 40).toLowerCase();
  const addedAt = safeNumber(value.addedAt || value.updatedAt || Date.now());
  const stepId = safeString(value.stepId, 80);
  const fileName = safeString(value.fileName, 180);

  if (!track || !country || !category) return null;

  return {
    id:
      safeString(value.id, 240) ||
      `${track}::${country}::${stepId || category}::${fileName || addedAt}`,
    track,
    country,
    category,
    documentType: safeString(value.documentType, 80) || category,
    stepId,
    stepTitle: safeString(value.stepTitle, 140),
    fileName,
    fileType: safeString(value.fileType, 80),
    fileSize: safeNumber(value.fileSize),
    localRef: safeString(value.localRef, 320),
    notes: safeString(value.notes, 1200),
    addedAt,
    updatedAt: safeNumber(value.updatedAt || addedAt),
  };
}

function defaultRouteState() {
  return {
    id: "",
    track: "",
    country: "",
    routePath: "",
    routeSearch: "",
    lastExpandedSection: "",
    lastCategory: "",
    lastResourceId: "",
    lastResourceTitle: "",
    lastVisitedAt: 0,
    currentStepId: "",
    currentStepTitle: "",
    completedStepIds: [],
    moneyTools: defaultMoneyToolsState(),
    updatedAt: 0,
  };
}

function defaultLastContext() {
  return {
    track: "",
    country: "",
    routePath: "",
    routeSearch: "",
    lastExpandedSection: "",
    lastCategory: "",
    lastResourceId: "",
    lastResourceTitle: "",
    lastVisitedAt: 0,
    currentStepId: "",
    currentStepTitle: "",
    completedStepIds: [],
  };
}

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: 0,
    lastContext: defaultLastContext(),
    routeStates: [],
    history: [],
    bookmarks: [],
    documents: [],
  };
}

function routeStateId(track, country) {
  const safeTrack = safeString(track, 20).toLowerCase();
  const safeCountry = safeString(country, 80);
  return safeTrack && safeCountry ? `${safeTrack}::${safeCountry}` : "";
}

function memoryDocRef(uid) {
  return doc(db, "users", safeString(uid, 120), CLOUD_MEMORY_COLLECTION, CLOUD_MEMORY_DOC_ID);
}

function userDocRef(uid) {
  return doc(db, "users", safeString(uid, 120));
}

function routeCollectionRef(uid) {
  return collection(db, "users", safeString(uid, 120), CLOUD_ROUTE_COLLECTION);
}

function routeDocRef(uid, routeId) {
  return doc(db, "users", safeString(uid, 120), CLOUD_ROUTE_COLLECTION, safeString(routeId, 160));
}

function documentCollectionRef(uid) {
  return collection(db, "users", safeString(uid, 120), CLOUD_DOCUMENT_COLLECTION);
}

function documentDocRef(uid, docId) {
  return doc(db, "users", safeString(uid, 120), CLOUD_DOCUMENT_COLLECTION, safeString(docId, 240));
}

function sanitizeRouteState(value) {
  if (!isObject(value)) return null;

  const track = safeString(value.track, 20).toLowerCase();
  const country = safeString(value.country, 80);
  if (!track || !country) return null;

  return {
    id: safeString(value.id, 160) || routeStateId(track, country),
    track,
    country,
    routePath: safeString(value.routePath, 120),
    routeSearch: safeString(value.routeSearch, 200),
    lastExpandedSection: safeString(value.lastExpandedSection, 40),
    lastCategory: safeString(value.lastCategory, 40),
    lastResourceId: safeString(value.lastResourceId, 120),
    lastResourceTitle: safeString(value.lastResourceTitle, 160),
    lastVisitedAt: safeNumber(value.lastVisitedAt),
    currentStepId: safeString(value.currentStepId, 80),
    currentStepTitle: safeString(value.currentStepTitle, 160),
    completedStepIds: sanitizeIdList(value.completedStepIds, 30, 80),
    moneyTools: sanitizeMoneyToolsState(value.moneyTools),
    updatedAt: safeNumber(value.updatedAt),
  };
}

function sanitizeContext(value) {
  if (!isObject(value)) return defaultLastContext();
  return {
    track: safeString(value.track, 20).toLowerCase(),
    country: safeString(value.country, 80),
    routePath: safeString(value.routePath, 120),
    routeSearch: safeString(value.routeSearch, 200),
    lastExpandedSection: safeString(value.lastExpandedSection, 40),
    lastCategory: safeString(value.lastCategory, 40),
    lastResourceId: safeString(value.lastResourceId, 120),
    lastResourceTitle: safeString(value.lastResourceTitle, 160),
    lastVisitedAt: safeNumber(value.lastVisitedAt),
    currentStepId: safeString(value.currentStepId, 80),
    currentStepTitle: safeString(value.currentStepTitle, 160),
    completedStepIds: sanitizeIdList(value.completedStepIds, 30, 80),
  };
}

function sanitizeHistoryItem(value) {
  if (!isObject(value)) return null;

  const finalUrl = safeString(value.finalUrl, 1000);
  const resourceId = safeString(value.resourceId, 120);
  const track = safeString(value.track, 20).toLowerCase();
  const country = safeString(value.country, 80);

  if (!resourceId || !track || !country) return null;

  return {
    id:
      safeString(value.id, 240) ||
      `${track}::${country}::${resourceId}::${safeString(finalUrl, 300)}`,
    resourceId,
    title: safeString(value.title, 180),
    description: safeString(value.description, 320),
    category: safeString(value.category, 40),
    track,
    country,
    routePath: safeString(value.routePath, 120),
    routeSearch: safeString(value.routeSearch, 200),
    sectionId: safeString(value.sectionId, 40),
    outboundUrl: safeString(value.outboundUrl, 1000),
    finalUrl,
    labels: sanitizeLabels(value.labels),
    resourceType: safeString(value.resourceType, 60),
    linkMode: safeString(value.linkMode, 20),
    smartGenerated: Boolean(value.smartGenerated),
    smartParams: sanitizeSmartParams(value.smartParams),
    openedAt: safeNumber(value.openedAt),
    domain: safeString(value.domain, 120),
    providerKey: safeString(value.providerKey, 80),
    redirectEnabled: value.redirectEnabled !== false,
    affiliateTag: safeString(value.affiliateTag, 80),
    gatewaySource: safeString(value.gatewaySource, 60),
    verifiedStepId: safeString(value.verifiedStepId, 80),
    verifiedStepTitle: safeString(value.verifiedStepTitle, 120),
  };
}

function sanitizeBookmark(value) {
  if (!isObject(value)) return null;

  const resourceId = safeString(value.resourceId, 120);
  const track = safeString(value.track, 20).toLowerCase();
  const country = safeString(value.country, 80);
  if (!resourceId || !track || !country) return null;

  return {
    id: safeString(value.id, 200) || `${track}::${country}::${resourceId}`,
    resourceId,
    title: safeString(value.title, 180),
    description: safeString(value.description, 320),
    category: safeString(value.category, 40),
    track,
    country,
    routePath: safeString(value.routePath, 120),
    routeSearch: safeString(value.routeSearch, 200),
    sectionId: safeString(value.sectionId, 40),
    outboundUrl: safeString(value.outboundUrl, 1000),
    finalUrl: safeString(value.finalUrl, 1000),
    labels: sanitizeLabels(value.labels),
    resourceType: safeString(value.resourceType, 60),
    linkMode: safeString(value.linkMode, 20),
    smartGenerated: Boolean(value.smartGenerated),
    smartParams: sanitizeSmartParams(value.smartParams),
    lastOpenedAt: safeNumber(value.lastOpenedAt),
    savedAt: safeNumber(value.savedAt),
    canOpenDirectly: Boolean(value.canOpenDirectly),
    providerKey: safeString(value.providerKey, 80),
    redirectEnabled: value.redirectEnabled !== false,
    affiliateTag: safeString(value.affiliateTag, 80),
    gatewaySource: safeString(value.gatewaySource, 60),
    verifiedStepId: safeString(value.verifiedStepId, 80),
    verifiedStepTitle: safeString(value.verifiedStepTitle, 120),
  };
}

function sanitizeState(value) {
  const base = defaultState();
  if (!isObject(value)) return base;

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: safeNumber(value.updatedAt),
    lastContext: sanitizeContext(value.lastContext),
    routeStates: (Array.isArray(value.routeStates) ? value.routeStates : [])
      .map(sanitizeRouteState)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, ROUTE_STATE_LIMIT),
    history: (Array.isArray(value.history) ? value.history : [])
      .map(sanitizeHistoryItem)
      .filter(Boolean)
      .sort((left, right) => right.openedAt - left.openedAt)
      .slice(0, HISTORY_LIMIT),
    bookmarks: (Array.isArray(value.bookmarks) ? value.bookmarks : [])
      .map(sanitizeBookmark)
      .filter(Boolean)
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, BOOKMARK_LIMIT),
    documents: (Array.isArray(value.documents) ? value.documents : [])
      .map(sanitizeDocumentRecord)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, DOCUMENT_LIMIT),
  };
}

function mergeItemsById(localItems, cloudItems, updatedField, limit) {
  const merged = new Map();

  for (const item of [...(Array.isArray(localItems) ? localItems : []), ...(Array.isArray(cloudItems) ? cloudItems : [])]) {
    if (!item?.id) continue;
    const current = merged.get(item.id);
    if (!current || safeNumber(item?.[updatedField]) >= safeNumber(current?.[updatedField])) {
      merged.set(item.id, item);
    }
  }

  return Array.from(merged.values())
    .sort((left, right) => safeNumber(right?.[updatedField]) - safeNumber(left?.[updatedField]))
    .slice(0, limit);
}

async function readLegacyCloudCollections(uid) {
  if (!uid) return null;

  try {
    const [routeSnap, documentSnap] = await Promise.all([
      withTimeout(getDocs(routeCollectionRef(uid))),
      withTimeout(getDocs(documentCollectionRef(uid))),
    ]);

    if (routeSnap === CLOUD_TIMEOUT_TOKEN || documentSnap === CLOUD_TIMEOUT_TOKEN) {
      return null;
    }

    return {
      routeStates: routeSnap.docs
        .map((docSnap) => sanitizeRouteState({ id: docSnap.id, ...docSnap.data() }))
        .filter(Boolean),
      documents: documentSnap.docs
        .map((docSnap) => sanitizeDocumentRecord({ id: docSnap.id, ...docSnap.data() }))
        .filter(Boolean),
    };
  } catch (error) {
    console.error("SelfHelp legacy cloud read failed:", error);
    return null;
  }
}

async function readCloudMemory(uid) {
  if (!uid) return null;

  try {
    const snapshot = await withTimeout(getDoc(memoryDocRef(uid)));
    if (snapshot === CLOUD_TIMEOUT_TOKEN || !snapshot?.exists?.()) {
      return null;
    }
    return sanitizeState(snapshot.data());
  } catch (error) {
    console.error("SelfHelp cloud memory read failed:", error);
    return null;
  }
}

function mergeCloudState(baseState, incomingState) {
  const base = sanitizeState(baseState);
  const incoming = sanitizeState(incomingState);

  const routeStates = mergeItemsById(
    base.routeStates,
    incoming.routeStates,
    "updatedAt",
    ROUTE_STATE_LIMIT
  )
    .map(sanitizeRouteState)
    .filter(Boolean);

  const history = mergeItemsById(base.history, incoming.history, "openedAt", HISTORY_LIMIT)
    .map(sanitizeHistoryItem)
    .filter(Boolean);

  const bookmarks = mergeItemsById(base.bookmarks, incoming.bookmarks, "savedAt", BOOKMARK_LIMIT)
    .map(sanitizeBookmark)
    .filter(Boolean);

  const documents = mergeItemsById(base.documents, incoming.documents, "updatedAt", DOCUMENT_LIMIT)
    .map(sanitizeDocumentRecord)
    .filter(Boolean);

  const baseContext = sanitizeContext(base.lastContext);
  const incomingContext = sanitizeContext(incoming.lastContext);
  const preferredContext =
    safeNumber(incomingContext.lastVisitedAt) >= safeNumber(baseContext.lastVisitedAt)
      ? incomingContext
      : baseContext;
  const contextRoute =
    findRouteState(routeStates, preferredContext.track, preferredContext.country) ||
    routeStates[0] ||
    null;

  return sanitizeState({
    ...base,
    ...incoming,
    updatedAt: Math.max(safeNumber(base.updatedAt), safeNumber(incoming.updatedAt)),
    routeStates,
    history,
    bookmarks,
    documents,
    lastContext: contextRoute ? toContext(contextRoute, preferredContext) : preferredContext,
  });
}

function syncCloudWrite(promise, label) {
  void promise.catch((error) => {
    console.error(`SelfHelp cloud sync failed (${label}):`, error);
  });
}

function syncStateToCloud(uid, state) {
  if (!uid) return Promise.resolve();
  const normalized = sanitizeState(state);
  const updatedAt = safeNumber(normalized.updatedAt) || Date.now();
  return Promise.all([
    setDoc(memoryDocRef(uid), normalized, { merge: true }),
    setDoc(
      userDocRef(uid),
      {
        selfHelpUpdatedAt: updatedAt,
        selfHelpSchemaVersion: SCHEMA_VERSION,
      },
      { merge: true }
    ),
  ]);
}

function syncRouteStateToCloud(uid, routeState) {
  const normalized = sanitizeRouteState(routeState);
  if (!uid || !normalized?.id) return Promise.resolve();
  return setDoc(routeDocRef(uid, normalized.id), normalized, { merge: true });
}

function syncDocumentRecordToCloud(uid, record) {
  const normalized = sanitizeDocumentRecord(record);
  if (!uid || !normalized?.id) return Promise.resolve();
  return setDoc(documentDocRef(uid, normalized.id), normalized, { merge: true });
}

function deleteDocumentRecordFromCloud(uid, id) {
  if (!uid || !safeString(id, 240)) return Promise.resolve();
  return deleteDoc(documentDocRef(uid, id));
}

async function readState(uid) {
  if (!uid) return defaultState();

  if (inMemoryState.has(uid)) {
    return sanitizeState(inMemoryState.get(uid));
  }

  try {
    const raw = await getStoredValue(keyFor(uid));
    const parsed = !raw ? defaultState() : sanitizeState(JSON.parse(raw));
    return rememberState(uid, parsed);
  } catch {
    return defaultState();
  }
}

function readCachedState(uid) {
  if (!uid) return defaultState();

  if (inMemoryState.has(uid)) {
    return sanitizeState(inMemoryState.get(uid));
  }

  try {
    const raw = readCachedRawValue(uid);
    if (!raw) return defaultState();
    return rememberState(uid, JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

async function writeState(uid, state) {
  if (!uid) return defaultState();

  const safe = sanitizeState({
    ...state,
    updatedAt: Date.now(),
  });

  rememberState(uid, safe);
  await setStoredValue(keyFor(uid), JSON.stringify(safe));
  syncCloudWrite(syncStateToCloud(uid, safe), "summary");
  return safe;
}

async function writeStateDurable(uid, state) {
  if (!uid) return defaultState();

  const safe = sanitizeState({
    ...state,
    updatedAt: Date.now(),
  });

  rememberState(uid, safe);
  await setStoredValueDurable(keyFor(uid), JSON.stringify(safe));
  syncCloudWrite(syncStateToCloud(uid, safe), "summary");
  return safe;
}

function writeStateSync(uid, state) {
  if (!uid) return defaultState();

  const safe = sanitizeState({
    ...state,
    updatedAt: Date.now(),
  });

  rememberState(uid, safe);
  void setStoredValue(keyFor(uid), JSON.stringify(safe));
  syncCloudWrite(syncStateToCloud(uid, safe), "summary");
  return safe;
}

function mergeRouteState(routeStates, patch) {
  const normalizedPatch = sanitizeRouteState({
    ...patch,
    updatedAt: Date.now(),
  });
  if (!normalizedPatch) return Array.isArray(routeStates) ? routeStates : [];

  const current = Array.isArray(routeStates) ? routeStates : [];
  return [normalizedPatch, ...current.filter((item) => item.id !== normalizedPatch.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, ROUTE_STATE_LIMIT);
}

function refreshRouteStateAfterHistoryChange(routeStates, historyItems, track, country) {
  const currentRoute = findRouteState(routeStates, track, country);
  if (!currentRoute) {
    return Array.isArray(routeStates) ? routeStates : [];
  }

  const latestEntry =
    (Array.isArray(historyItems) ? historyItems : []).find(
      (item) =>
        safeString(item?.track, 20).toLowerCase() === safeString(track, 20).toLowerCase() &&
        safeString(item?.country, 80) === safeString(country, 80)
    ) || null;

  return mergeRouteState(routeStates, {
    ...currentRoute,
    lastResourceId: latestEntry?.resourceId || "",
    lastResourceTitle: latestEntry?.title || "",
    lastVisitedAt: safeNumber(latestEntry?.openedAt),
    routePath: latestEntry?.routePath || currentRoute.routePath,
    routeSearch: latestEntry?.routeSearch || currentRoute.routeSearch,
    lastExpandedSection: latestEntry?.sectionId || currentRoute.lastExpandedSection,
    lastCategory: latestEntry?.category || currentRoute.lastCategory,
  });
}

function toContext(routeState, fallback = {}) {
  return sanitizeContext({
    ...fallback,
    ...(routeState || {}),
  });
}

function findRouteState(routeStates, track, country) {
  const key = routeStateId(track, country);
  return (
    (Array.isArray(routeStates) ? routeStates : []).find((item) => item.id === key) || null
  );
}

export function getSelfHelpRouteState(progress, track, country) {
  const safeProgress = sanitizeState(progress);
  return findRouteState(safeProgress.routeStates, track, country);
}

export function getSelfHelpMoneyToolsState(progress, track, country) {
  return getSelfHelpRouteState(progress, track, country)?.moneyTools || defaultMoneyToolsState();
}

export function cacheSelfHelpProgress(uid, progress) {
  return writeStateSync(uid, progress);
}

export function peekSelfHelpProgress(uid) {
  return readCachedState(uid);
}

export function getSelfHelpDocuments(progress, track, country) {
  const safeTrack = safeString(track, 20).toLowerCase();
  const safeCountry = safeString(country, 80);
  return (Array.isArray(progress?.documents) ? progress.documents : [])
    .map(sanitizeDocumentRecord)
    .filter(
      (item) =>
        item &&
        (!safeTrack || item.track === safeTrack) &&
        (!safeCountry || item.country === safeCountry)
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getSelfHelpProgress(uid) {
  const localPromise = readState(uid);
  const cloudMemoryPromise = readCloudMemory(uid);
  const legacyCloudPromise = readLegacyCloudCollections(uid);

  const local = await localPromise;
  const [cloudMemory, legacyCloud] = await Promise.all([
    cloudMemoryPromise,
    legacyCloudPromise,
  ]);

  let merged = mergeCloudState(local, cloudMemory || defaultState());

  if (legacyCloud) {
    merged = mergeCloudState(
      merged,
      sanitizeState({
        ...defaultState(),
        routeStates: legacyCloud.routeStates,
        documents: legacyCloud.documents,
        lastContext: toContext(legacyCloud.routeStates?.[0] || null, merged.lastContext),
      })
    );
  }

  if (JSON.stringify(merged) !== JSON.stringify(local)) {
    await writeState(uid, merged);
  } else if (uid) {
    inMemoryState.set(uid, merged);
  }

  if (!cloudMemory) {
    syncCloudWrite(syncStateToCloud(uid, merged), "ensure-memory-root");
  } else if (uid && JSON.stringify(merged) !== JSON.stringify(cloudMemory || defaultState())) {
    syncCloudWrite(syncStateToCloud(uid, merged), "hydrate");
  }

  return merged;
}

export async function setSelfHelpContext(uid, patch) {
  const current = await readState(uid);
  const safePatch = isObject(patch) ? patch : {};
  const track = safeString(safePatch.track, 20).toLowerCase();
  const country = safeString(safePatch.country, 80);

  if (!track || !country) {
    return writeState(uid, {
      ...current,
      lastContext: sanitizeContext({
        ...current.lastContext,
        ...safePatch,
      }),
    });
  }

  const currentRoute = findRouteState(current.routeStates, track, country) || defaultRouteState();
  const routeStates = mergeRouteState(current.routeStates, {
    ...currentRoute,
    ...safePatch,
    track,
    country,
  });
  const nextRoute = findRouteState(routeStates, track, country);

  const nextState = {
    ...current,
    routeStates,
    lastContext: toContext(nextRoute, current.lastContext),
  };
  const saved = await writeState(uid, nextState);
  syncCloudWrite(Promise.all([syncStateToCloud(uid, saved), syncRouteStateToCloud(uid, nextRoute)]), "route-context");
  return saved;
}

export async function recordSelfHelpActivity(uid, payload, options = {}) {
  const fastLocal = options?.fastLocal === true;
  const current = fastLocal ? readCachedState(uid) : await readState(uid);
  const entry = sanitizeHistoryItem({
    ...payload,
    openedAt: Date.now(),
  });

  if (!entry) return current;

  const history = [entry, ...current.history.filter((item) => item.id !== entry.id)].slice(
    0,
    HISTORY_LIMIT
  );

  const currentRoute =
    findRouteState(current.routeStates, entry.track, entry.country) || defaultRouteState();
  const routeStates = mergeRouteState(current.routeStates, {
    ...currentRoute,
    track: entry.track,
    country: entry.country,
    routePath: entry.routePath || currentRoute.routePath,
    routeSearch: entry.routeSearch || currentRoute.routeSearch,
    lastExpandedSection: entry.sectionId || currentRoute.lastExpandedSection,
    lastCategory: entry.category || currentRoute.lastCategory,
    lastResourceId: entry.resourceId,
    lastResourceTitle: entry.title,
    lastVisitedAt: entry.openedAt,
    currentStepId: entry.verifiedStepId || currentRoute.currentStepId,
    currentStepTitle: entry.verifiedStepTitle || currentRoute.currentStepTitle,
    completedStepIds: currentRoute.completedStepIds,
  });

  const nextRoute = findRouteState(routeStates, entry.track, entry.country);

  const bookmarks = current.bookmarks.map((bookmark) => {
    if (
      bookmark.resourceId !== entry.resourceId ||
      bookmark.track !== entry.track ||
      bookmark.country !== entry.country
    ) {
      return bookmark;
    }

    return sanitizeBookmark({
      ...bookmark,
      outboundUrl: entry.outboundUrl || bookmark.outboundUrl,
      finalUrl: entry.finalUrl || bookmark.finalUrl,
      smartGenerated: entry.smartGenerated,
      smartParams: entry.smartParams || bookmark.smartParams,
      lastOpenedAt: entry.openedAt,
      canOpenDirectly: Boolean(entry.finalUrl || bookmark.finalUrl),
      providerKey: entry.providerKey || bookmark.providerKey,
      redirectEnabled: entry.redirectEnabled,
      affiliateTag: entry.affiliateTag || bookmark.affiliateTag,
      gatewaySource: entry.gatewaySource || bookmark.gatewaySource,
      verifiedStepId: entry.verifiedStepId || bookmark.verifiedStepId,
      verifiedStepTitle: entry.verifiedStepTitle || bookmark.verifiedStepTitle,
    });
  });

  const nextState = {
    ...current,
    history,
    bookmarks,
    routeStates,
    lastContext: toContext(nextRoute, current.lastContext),
  };
  const saved = fastLocal ? writeStateSync(uid, nextState) : await writeState(uid, nextState);
  const syncTask = Promise.all([syncStateToCloud(uid, saved), syncRouteStateToCloud(uid, nextRoute)]);

  if (fastLocal) {
    syncCloudWrite(syncTask, "history");
    return saved;
  }

  await syncTask;
  return saved;
}

export async function toggleSelfHelpBookmark(uid, payload) {
  const current = await readState(uid);
  const normalized = sanitizeBookmark({
    ...payload,
    savedAt: payload?.savedAt || Date.now(),
  });

  if (!normalized) return current;

  const exists = current.bookmarks.some((bookmark) => bookmark.id === normalized.id);
  const bookmarks = exists
    ? current.bookmarks.filter((bookmark) => bookmark.id !== normalized.id)
    : [normalized, ...current.bookmarks.filter((bookmark) => bookmark.id !== normalized.id)].slice(
        0,
        BOOKMARK_LIMIT
      );

  const saved = await writeState(uid, {
    ...current,
    bookmarks,
  });
  await syncStateToCloud(uid, saved);
  return saved;
}

export async function deleteSelfHelpMemoryItem(uid, payload) {
  const current = await readState(uid);
  const id = safeString(payload?.id, 240);
  const resourceId = safeString(payload?.resourceId, 120);
  const track = safeString(payload?.track, 20).toLowerCase();
  const country = safeString(payload?.country, 80);

  if (!id && !(resourceId && track && country)) return current;

  const matchesItem = (item) => {
    if (!item) return false;
    if (id && safeString(item.id, 240) === id) return true;
    return (
      safeString(item.resourceId, 120) === resourceId &&
      safeString(item.track, 20).toLowerCase() === track &&
      safeString(item.country, 80) === country
    );
  };

  const nextHistory = current.history.filter((item) => !matchesItem(item));
  const nextRouteStates =
    track && country
      ? refreshRouteStateAfterHistoryChange(current.routeStates, nextHistory, track, country)
      : current.routeStates;
  const activeContextRoute =
    findRouteState(
      nextRouteStates,
      safeString(current.lastContext?.track, 20).toLowerCase(),
      safeString(current.lastContext?.country, 80)
    ) ||
    findRouteState(nextRouteStates, track, country) ||
    null;

  const nextState = sanitizeState({
    ...current,
    history: nextHistory,
    bookmarks: current.bookmarks.filter((item) => !matchesItem(item)),
    routeStates: nextRouteStates,
    lastContext: activeContextRoute
      ? toContext(activeContextRoute, current.lastContext)
      : current.lastContext,
  });

  const saved = await writeState(uid, nextState);
  await syncStateToCloud(uid, saved);
  return saved;
}

export async function toggleSelfHelpStepCompletion(uid, payload) {
  const current = await readState(uid);
  const track = safeString(payload?.track, 20).toLowerCase();
  const country = safeString(payload?.country, 80);
  const stepId = safeString(payload?.stepId, 80);

  if (!track || !country || !stepId) return current;

  const currentRoute = findRouteState(current.routeStates, track, country) || defaultRouteState();
  const completedSet = new Set(currentRoute.completedStepIds || []);
  const shouldComplete =
    typeof payload?.completed === "boolean" ? payload.completed : !completedSet.has(stepId);

  if (shouldComplete) completedSet.add(stepId);
  else completedSet.delete(stepId);

  const routeStates = mergeRouteState(current.routeStates, {
    ...currentRoute,
    track,
    country,
    routePath: safeString(payload?.routePath, 120) || currentRoute.routePath,
    routeSearch: safeString(payload?.routeSearch, 200) || currentRoute.routeSearch,
    lastExpandedSection:
      safeString(payload?.sectionId, 40) || currentRoute.lastExpandedSection,
    currentStepId: stepId,
    currentStepTitle:
      safeString(payload?.stepTitle, 160) || currentRoute.currentStepTitle,
    completedStepIds: Array.from(completedSet),
  });
  const nextRoute = findRouteState(routeStates, track, country);

  const nextState = {
    ...current,
    routeStates,
    lastContext: toContext(nextRoute, current.lastContext),
  };
  const saved = await writeStateDurable(uid, nextState);
  await Promise.all([syncStateToCloud(uid, saved), syncRouteStateToCloud(uid, nextRoute)]);
  return saved;
}

function buildChecklistState(currentState, payload) {
  const current = sanitizeState(currentState);
  const track = safeString(payload?.track, 20).toLowerCase();
  const country = safeString(payload?.country, 80);
  const completedStepIds = sanitizeIdList(payload?.completedStepIds, 40, 80);
  const currentStepId = safeString(payload?.currentStepId, 80);
  const currentStepTitle = safeString(payload?.currentStepTitle, 160);

  if (!track || !country) return current;

  const currentRoute = findRouteState(current.routeStates, track, country) || defaultRouteState();
  const routeStates = mergeRouteState(current.routeStates, {
    ...currentRoute,
    track,
    country,
    routePath: safeString(payload?.routePath, 120) || currentRoute.routePath,
    routeSearch: safeString(payload?.routeSearch, 200) || currentRoute.routeSearch,
    lastExpandedSection:
      safeString(payload?.sectionId, 40) || currentRoute.lastExpandedSection,
    currentStepId: currentStepId || currentRoute.currentStepId,
    currentStepTitle: currentStepTitle || currentRoute.currentStepTitle,
    completedStepIds,
  });
  const nextRoute = findRouteState(routeStates, track, country);

  return sanitizeState({
    ...current,
    routeStates,
    lastContext: toContext(nextRoute, current.lastContext),
  });
}

export function previewSelfHelpChecklistProgress(progress, payload) {
  return buildChecklistState(progress, payload);
}

export async function saveSelfHelpChecklist(uid, payload) {
  const current = await readState(uid);
  const nextState = buildChecklistState(current, payload);
  const saved = await writeStateDurable(uid, nextState);
  const nextRoute = findRouteState(
    saved.routeStates,
    safeString(payload?.track, 20).toLowerCase(),
    safeString(payload?.country, 80)
  );
  await Promise.all([syncStateToCloud(uid, saved), syncRouteStateToCloud(uid, nextRoute)]);
  return saved;
}

export async function saveSelfHelpMoneyToolsState(uid, payload) {
  const current = await readState(uid);
  const track = safeString(payload?.track, 20).toLowerCase();
  const country = safeString(payload?.country, 80);

  if (!track || !country) return current;

  const currentRoute = findRouteState(current.routeStates, track, country) || defaultRouteState();
  const routeStates = mergeRouteState(current.routeStates, {
    ...currentRoute,
    track,
    country,
    routePath: safeString(payload?.routePath, 120) || currentRoute.routePath,
    routeSearch: safeString(payload?.routeSearch, 200) || currentRoute.routeSearch,
    moneyTools: sanitizeMoneyToolsState({
      ...currentRoute.moneyTools,
      ...(isObject(payload?.moneyTools) ? payload.moneyTools : {}),
      currency: {
        ...(currentRoute.moneyTools?.currency || {}),
        ...(isObject(payload?.moneyTools?.currency) ? payload.moneyTools.currency : {}),
      },
      planner: {
        ...(currentRoute.moneyTools?.planner || {}),
        ...(isObject(payload?.moneyTools?.planner) ? payload.moneyTools.planner : {}),
      },
      timeline: {
        ...(currentRoute.moneyTools?.timeline || {}),
        ...(isObject(payload?.moneyTools?.timeline) ? payload.moneyTools.timeline : {}),
      },
    }),
  });
  const nextRoute = findRouteState(routeStates, track, country);

  const nextState = {
    ...current,
    routeStates,
    lastContext: toContext(nextRoute, current.lastContext),
  };
  const saved = await writeState(uid, nextState);
  await Promise.all([syncStateToCloud(uid, saved), syncRouteStateToCloud(uid, nextRoute)]);
  return saved;
}

function buildDocumentSaveState(currentState, payload) {
  const current = sanitizeState(currentState);
  const record = sanitizeDocumentRecord({
    ...payload,
    addedAt: payload?.addedAt || Date.now(),
    updatedAt: Date.now(),
  });

  if (!record) return current;

  const documents = [
    record,
    ...current.documents.filter((item) => item.id !== record.id),
  ]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, DOCUMENT_LIMIT);

  return sanitizeState({
    ...current,
    documents,
  });
}

export function previewSelfHelpDocumentProgress(progress, payload) {
  return buildDocumentSaveState(progress, payload);
}

export async function saveSelfHelpDocumentRecord(uid, payload) {
  const current = await readState(uid);
  const nextState = buildDocumentSaveState(current, payload);
  const saved = await writeStateDurable(uid, nextState);
  const mirroredRecord = {
    ...payload,
    addedAt: payload?.addedAt || Date.now(),
    updatedAt: Date.now(),
  };
  await Promise.all([
    syncStateToCloud(uid, saved),
    syncDocumentRecordToCloud(uid, mirroredRecord),
    mirrorSelfHelpDocumentRecord({
      uid,
      record: mirroredRecord,
      actorUid: uid,
    }),
  ]);
  return saved;
}

export async function deleteSelfHelpDocumentRecord(uid, payload) {
  const current = await readState(uid);
  const id = safeString(payload?.id, 240);
  if (!id) return current;

  const saved = await writeStateDurable(uid, {
    ...current,
    documents: current.documents.filter((item) => item.id !== id),
  });
  await Promise.all([
    syncStateToCloud(uid, saved),
    deleteDocumentRecordFromCloud(uid, id),
    deleteSelfHelpDocumentMirror({ uid, recordId: id }),
  ]);
  return saved;
}

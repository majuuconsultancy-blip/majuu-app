import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import {
  findRequestCatalogEntry,
  listRequestCatalogEntries,
  normalizeRequestCatalogRequestType,
  normalizeRequestCatalogTrack,
} from "../constants/requestCatalog";
import { getCurrentUserRoleContext } from "./adminroleservice";

export const PRICING_COLLECTION = "pricingRules";
export const PRICING_SCOPE_SINGLE_REQUEST = "single_request";

function safeString(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function cleanCurrency(value) {
  return safeString(value || "KES", 8).toUpperCase() || "KES";
}

export function normalizePricingAmountValue(value, fallback = 0) {
  const source =
    typeof value === "string" ? value.replace(/[^0-9.]+/g, "") : value;
  const amount = Number(source || 0);
  if (!Number.isFinite(amount) || amount <= 0) return Math.max(0, Math.round(Number(fallback || 0)));
  return Math.round(amount);
}

export function formatPricingMoney(amount, currency = "KES") {
  const cleanAmount = normalizePricingAmountValue(amount, 0);
  if (!cleanAmount) return "";
  return `${cleanCurrency(currency)} ${cleanAmount.toLocaleString()}`;
}

function normalizeScope(value) {
  const scope = safeString(value, 80).toLowerCase();
  return scope || PRICING_SCOPE_SINGLE_REQUEST;
}

function normalizeCatalogRow(entry) {
  if (!entry) return null;
  return {
    id: entry.pricingKey,
    pricingKey: entry.pricingKey,
    scope: normalizeScope(entry.scope),
    requestType: normalizeRequestCatalogRequestType(entry.requestType),
    track: normalizeRequestCatalogTrack(entry.track),
    serviceName: safeString(entry.serviceName, 120),
    label: safeString(entry.label || entry.serviceName, 140),
    note: safeString(entry.note, 240),
    tag: safeString(entry.tag, 40),
    amount: normalizePricingAmountValue(entry.defaultAmount, 0),
    defaultAmount: normalizePricingAmountValue(entry.defaultAmount, 0),
    currency: cleanCurrency(entry.currency),
    sortOrder: Number.isFinite(Number(entry.sortOrder)) ? Number(entry.sortOrder) : 0,
    isConfigured: false,
    isActive: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdByUid: "",
    createdByEmail: "",
    updatedByUid: "",
    updatedByEmail: "",
  };
}

function normalizePricingRecord(id, raw = {}, catalogEntry = null) {
  const source = raw && typeof raw === "object" ? raw : {};
  const base = normalizeCatalogRow(catalogEntry);
  const cleanAmount = normalizePricingAmountValue(
    source.amount,
    base?.amount || 0
  );
  const cleanDefaultAmount = normalizePricingAmountValue(
    source.defaultAmount,
    base?.defaultAmount || cleanAmount
  );

  return {
    id: safeString(id || source.pricingKey || base?.pricingKey, 180),
    pricingKey: safeString(id || source.pricingKey || base?.pricingKey, 180),
    scope: normalizeScope(source.scope || base?.scope),
    requestType: normalizeRequestCatalogRequestType(
      source.requestType || base?.requestType
    ),
    track: normalizeRequestCatalogTrack(source.track || base?.track),
    serviceName: safeString(source.serviceName || source.label || base?.serviceName, 120),
    label: safeString(
      source.label || source.serviceName || base?.label || base?.serviceName,
      140
    ),
    note: safeString(source.note || base?.note, 240),
    tag: safeString(source.tag || base?.tag, 40),
    amount: cleanAmount,
    defaultAmount: cleanDefaultAmount,
    currency: cleanCurrency(source.currency || base?.currency),
    sortOrder: Number.isFinite(Number(source.sortOrder))
      ? Number(source.sortOrder)
      : Number(base?.sortOrder || 0),
    isConfigured: Object.keys(source).length > 0,
    isActive: source.isActive !== false,
    createdAtMs: Number(source.createdAtMs || 0),
    updatedAtMs: Number(source.updatedAtMs || 0),
    createdByUid: safeString(source.createdByUid, 160),
    createdByEmail: safeString(source.createdByEmail, 200),
    updatedByUid: safeString(source.updatedByUid, 160),
    updatedByEmail: safeString(source.updatedByEmail, 200),
  };
}

function comparePricingRows(left, right) {
  const trackOrder = {
    study: 1,
    work: 2,
    travel: 3,
  };
  const trackGap =
    (trackOrder[left?.track] || 99) - (trackOrder[right?.track] || 99);
  if (trackGap !== 0) return trackGap;

  const orderGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (orderGap !== 0) return orderGap;

  return safeString(left?.serviceName, 160).localeCompare(
    safeString(right?.serviceName, 160)
  );
}

function filterPricingRows(rows = [], { track = "", requestType = "" } = {}) {
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeRequestType = requestType
    ? normalizeRequestCatalogRequestType(requestType)
    : "";

  return rows.filter((row) => {
    if (safeRequestType && row.requestType !== safeRequestType) return false;
    if (safeTrack && row.track !== safeTrack) return false;
    return row.isActive !== false;
  });
}

function mergePricingRows(rawRows = []) {
  const rawByKey = new Map();
  rawRows.forEach((row) => {
    const key = safeString(row?.pricingKey || row?.id, 180);
    if (!key) return;
    rawByKey.set(key, row);
  });

  const merged = listRequestCatalogEntries().map((entry) =>
    normalizePricingRecord(entry.pricingKey, rawByKey.get(entry.pricingKey), entry)
  );

  rawByKey.forEach((row, key) => {
    if (findRequestCatalogEntry({ pricingKey: key })) return;
    merged.push(normalizePricingRecord(key, row, null));
  });

  return merged.sort(comparePricingRows);
}

export function listRequestPricingCatalog(options = {}) {
  return filterPricingRows(
    mergePricingRows([]),
    options
  );
}

export function findRequestPricingRow(
  rows = [],
  { pricingKey = "", track = "", serviceName = "", requestType = "single" } = {}
) {
  const safePricingKey = safeString(pricingKey, 180);
  if (safePricingKey) {
    return rows.find((row) => row.pricingKey === safePricingKey) || null;
  }

  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeRequestType = normalizeRequestCatalogRequestType(requestType);
  const safeServiceName = safeString(serviceName, 140).toLowerCase();
  if (!safeServiceName) return null;

  return (
    rows.find((row) => {
      if (safeTrack && row.track !== safeTrack) return false;
      if (safeRequestType && row.requestType !== safeRequestType) return false;
      return safeString(row.serviceName, 140).toLowerCase() === safeServiceName;
    }) || null
  );
}

export function subscribeRequestPricingRows({
  track = "",
  requestType = "",
  onData,
  onError,
} = {}) {
  return onSnapshot(
    collection(db, PRICING_COLLECTION),
    (snapshot) => {
      const merged = mergePricingRows(
        snapshot.docs.map((row) => ({
          id: row.id,
          pricingKey: row.id,
          ...(row.data() || {}),
        }))
      );

      onData?.(filterPricingRows(merged, { track, requestType }));
    },
    (error) => {
      console.error("pricing subscription failed:", error);
      onError?.(error);
    }
  );
}

async function requireSuperAdminActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");

  const roleCtx = await getCurrentUserRoleContext(uid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can manage request pricing.");
  }

  return roleCtx;
}

export async function getRequestPricingQuote({
  pricingKey = "",
  track = "",
  serviceName = "",
  requestType = "single",
} = {}) {
  const catalogEntry = findRequestCatalogEntry({
    pricingKey,
    track,
    serviceName,
    requestType,
  });
  const resolvedKey = safeString(pricingKey || catalogEntry?.pricingKey, 180);

  if (!resolvedKey && !catalogEntry) return null;

  if (resolvedKey) {
    try {
      const snap = await getDoc(doc(db, PRICING_COLLECTION, resolvedKey));
      if (snap.exists()) {
        return normalizePricingRecord(snap.id, snap.data() || {}, catalogEntry);
      }
    } catch (error) {
      console.warn("Failed to load request pricing quote:", error?.message || error);
    }
  }

  return normalizeCatalogRow(catalogEntry);
}

export function toRequestPricingSnapshot(row, overrides = {}) {
  if (!row) return null;

  const amount = normalizePricingAmountValue(
    overrides.amount,
    row.amount
  );
  if (amount <= 0) return null;

  return {
    pricingKey: safeString(row.pricingKey, 180),
    scope: normalizeScope(row.scope),
    requestType: normalizeRequestCatalogRequestType(row.requestType),
    track: normalizeRequestCatalogTrack(row.track),
    serviceName: safeString(row.serviceName, 120),
    label: safeString(row.label || row.serviceName, 140),
    tag: safeString(row.tag, 40),
    amount,
    defaultAmount: normalizePricingAmountValue(row.defaultAmount, amount),
    currency: cleanCurrency(overrides.currency || row.currency),
    updatedAtMs: Number(row.updatedAtMs || 0) || Date.now(),
  };
}

export async function updateRequestPricing({
  pricingKey = "",
  track = "",
  serviceName = "",
  requestType = "single",
  amount,
  currency = "KES",
} = {}) {
  const actor = await requireSuperAdminActor();
  const catalogEntry = findRequestCatalogEntry({
    pricingKey,
    track,
    serviceName,
    requestType,
  });
  const resolvedKey = safeString(pricingKey || catalogEntry?.pricingKey, 180);
  if (!resolvedKey) throw new Error("Missing request pricing key.");

  const amountValue = normalizePricingAmountValue(amount, 0);
  if (amountValue <= 0) throw new Error("Price must be greater than zero.");

  const pricingRef = doc(db, PRICING_COLLECTION, resolvedKey);
  const existingSnap = await getDoc(pricingRef);
  const existingData = existingSnap.exists() ? existingSnap.data() || {} : {};
  const currentRow = normalizePricingRecord(resolvedKey, existingData, catalogEntry);
  const nowMs = Date.now();

  const payload = {
    pricingKey: resolvedKey,
    scope: currentRow.scope || PRICING_SCOPE_SINGLE_REQUEST,
    requestType: currentRow.requestType || normalizeRequestCatalogRequestType(requestType),
    track: currentRow.track || normalizeRequestCatalogTrack(track),
    serviceName: currentRow.serviceName || safeString(serviceName, 120),
    label: currentRow.label || currentRow.serviceName || safeString(serviceName, 120),
    note: currentRow.note,
    tag: currentRow.tag,
    amount: amountValue,
    defaultAmount: currentRow.defaultAmount || amountValue,
    currency: cleanCurrency(currency || currentRow.currency),
    sortOrder: Number.isFinite(Number(currentRow.sortOrder)) ? Number(currentRow.sortOrder) : 0,
    isActive: true,
    updatedAt: serverTimestamp(),
    updatedAtMs: nowMs,
    updatedByUid: safeString(actor.uid, 160),
    updatedByEmail: safeString(actor.email, 200),
  };

  if (!existingSnap.exists()) {
    payload.createdAt = serverTimestamp();
    payload.createdAtMs = nowMs;
    payload.createdByUid = safeString(actor.uid, 160);
    payload.createdByEmail = safeString(actor.email, 200);
  }

  await setDoc(pricingRef, payload, { merge: true });

  return normalizePricingRecord(
    resolvedKey,
    { ...existingData, ...payload },
    catalogEntry
  );
}

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import {
  DEFAULT_REQUEST_PRICE_KES,
  PRICING_SCOPE_FULL_PACKAGE_ITEM,
  PRICING_SCOPE_SINGLE_REQUEST,
  buildPricingKey,
  findPricingCatalogEntry,
  listPricingCatalogEntries,
  normalizeRequestCatalogCountry,
  normalizeRequestCatalogTrack,
} from "../constants/requestCatalog";
import { auth, db } from "../firebase";

export const PRICING_COLLECTION = "pricingRules";
export { PRICING_SCOPE_SINGLE_REQUEST, PRICING_SCOPE_FULL_PACKAGE_ITEM };

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function sameText(left, right) {
  return safeString(left, 180).toLowerCase() === safeString(right, 180).toLowerCase();
}

function normalizeScope(value) {
  const scope = safeString(value, 80).toLowerCase();
  return scope === PRICING_SCOPE_FULL_PACKAGE_ITEM
    ? PRICING_SCOPE_FULL_PACKAGE_ITEM
    : PRICING_SCOPE_SINGLE_REQUEST;
}

function normalizeCurrency(value) {
  return safeString(value || "KES", 8).toUpperCase() || "KES";
}

function normalizeTimestampMs(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  const num = Number(value || 0);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

export function normalizePricingAmountValue(value, fallback = DEFAULT_REQUEST_PRICE_KES) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const digitsOnly = safeString(value, 40).replace(/[^\d]/g, "");
  if (!digitsOnly) return Math.max(0, Math.round(Number(fallback || 0)));

  const parsed = Number(digitsOnly);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.round(Number(fallback || 0)));
  return Math.max(0, Math.round(parsed));
}

export function formatPricingMoney(amount, currency = "KES") {
  const normalizedAmount = Math.max(0, Math.round(Number(amount || 0)));
  const normalizedCurrency = normalizeCurrency(currency);
  return `${normalizedCurrency} ${normalizedAmount.toLocaleString()}`;
}

function normalizePricingFilters({
  scope = "",
  requestType = "",
  track = "",
  country = "",
} = {}) {
  const rawTrack = safeString(track, 20);
  const rawCountry = safeString(country, 120);

  return {
    scope: safeString(scope, 80).toLowerCase(),
    requestType: safeString(requestType, 20).toLowerCase(),
    track: rawTrack ? normalizeRequestCatalogTrack(rawTrack) || "__invalid_track__" : "",
    country: rawCountry
      ? normalizeRequestCatalogCountry(rawCountry) || "__invalid_country__"
      : "",
  };
}

function rowMatchesFilters(row, filters = {}) {
  const normalized = normalizePricingFilters(filters);
  if (normalized.scope && safeString(row?.scope, 80).toLowerCase() !== normalized.scope) {
    return false;
  }
  if (
    normalized.requestType &&
    safeString(row?.requestType, 20).toLowerCase() !== normalized.requestType
  ) {
    return false;
  }
  if (normalized.track && safeString(row?.track, 20).toLowerCase() !== normalized.track) {
    return false;
  }
  if (normalized.country && safeString(row?.country, 120) !== normalized.country) {
    return false;
  }
  return true;
}

function comparePricingRows(left, right) {
  const leftScope = safeString(left?.scope, 80);
  const rightScope = safeString(right?.scope, 80);
  const scopeGap = leftScope.localeCompare(rightScope);
  if (scopeGap !== 0) return scopeGap;

  const leftTrack = safeString(left?.track, 20);
  const rightTrack = safeString(right?.track, 20);
  const trackGap = leftTrack.localeCompare(rightTrack);
  if (trackGap !== 0) return trackGap;

  const leftCountry = safeString(left?.country, 120);
  const rightCountry = safeString(right?.country, 120);
  const countryGap = leftCountry.localeCompare(rightCountry);
  if (countryGap !== 0) return countryGap;

  const sortGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (sortGap !== 0) return sortGap;

  return safeString(left?.serviceName, 160).localeCompare(safeString(right?.serviceName, 160));
}

function toPricingRow(baseRow, overrideRow) {
  const source = baseRow && typeof baseRow === "object" ? baseRow : null;
  const override = overrideRow && typeof overrideRow === "object" ? overrideRow : null;

  const scope = normalizeScope(override?.scope || source?.scope);
  const requestType = safeString(override?.requestType || source?.requestType || "single", 20)
    .toLowerCase()
    .trim();
  const track = safeString(override?.track || source?.track, 20).toLowerCase();
  const country = safeString(override?.country || source?.country, 120);
  const serviceName = safeString(
    override?.serviceName || override?.label || source?.serviceName || source?.label,
    120
  );
  const pricingKey =
    safeString(override?.pricingKey, 180) ||
    safeString(source?.pricingKey, 180) ||
    buildPricingKey({
      scope,
      requestType,
      track,
      country,
      serviceName,
    });

  const defaultAmount = normalizePricingAmountValue(
    override?.defaultAmount,
    source?.defaultAmount || DEFAULT_REQUEST_PRICE_KES
  );
  const amount = normalizePricingAmountValue(
    override?.amount,
    source?.defaultAmount ?? defaultAmount
  );

  return {
    pricingKey,
    scope,
    requestType: requestType === "full" ? "full" : "single",
    track,
    country,
    serviceName,
    label: safeString(override?.label || source?.label || serviceName, 140) || serviceName,
    note: safeString(override?.note || source?.note, 220),
    tag: safeString(override?.tag || source?.tag, 40),
    currency: normalizeCurrency(override?.currency || source?.currency || "KES"),
    amount,
    defaultAmount,
    sortOrder: Number.isFinite(Number(override?.sortOrder))
      ? Number(override.sortOrder)
      : Number.isFinite(Number(source?.sortOrder))
        ? Number(source.sortOrder)
        : 0,
    updatedAtMs: normalizeTimestampMs(override?.updatedAtMs || override?.updatedAt),
    source: override ? "override" : "default",
  };
}

function docToOverrideRow(snapshotOrData, pricingKey = "") {
  const raw =
    typeof snapshotOrData?.data === "function"
      ? snapshotOrData.data()
      : snapshotOrData && typeof snapshotOrData === "object"
        ? snapshotOrData
        : null;
  if (!raw) return null;

  const resolvedKey = safeString(
    raw.pricingKey || pricingKey || snapshotOrData?.id || "",
    180
  );
  if (!resolvedKey) return null;

  return {
    pricingKey: resolvedKey,
    scope: safeString(raw.scope, 80).toLowerCase(),
    requestType: safeString(raw.requestType, 20).toLowerCase(),
    track: safeString(raw.track, 20).toLowerCase(),
    country: safeString(raw.country, 120),
    serviceName: safeString(raw.serviceName || raw.label, 120),
    label: safeString(raw.label || raw.serviceName, 140),
    note: safeString(raw.note, 220),
    tag: safeString(raw.tag, 40),
    currency: normalizeCurrency(raw.currency || "KES"),
    amount: normalizePricingAmountValue(raw.amount, 0),
    defaultAmount: normalizePricingAmountValue(raw.defaultAmount, DEFAULT_REQUEST_PRICE_KES),
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    updatedAtMs: normalizeTimestampMs(raw.updatedAtMs || raw.updatedAt),
  };
}

function buildOverrideMap(snapshotDocs = []) {
  const map = new Map();
  snapshotDocs.forEach((snap) => {
    const row = docToOverrideRow(snap);
    if (!row?.pricingKey) return;
    map.set(row.pricingKey, row);
  });
  return map;
}

function mergePricingRows(overrideMap, filters = {}) {
  const catalogRows = listPricingCatalogEntries(filters);
  const catalogKeys = new Set(catalogRows.map((row) => row.pricingKey));

  const mergedRows = catalogRows.map((row) => toPricingRow(row, overrideMap.get(row.pricingKey)));
  const extraRows = [];

  overrideMap.forEach((overrideRow, pricingKey) => {
    if (catalogKeys.has(pricingKey)) return;
    if (!rowMatchesFilters(overrideRow, filters)) return;
    extraRows.push(toPricingRow(null, overrideRow));
  });

  return [...mergedRows, ...extraRows].sort(comparePricingRows);
}

function getResolvedCatalogRow({
  scope = "",
  pricingKey = "",
  track = "",
  country = "",
  serviceName = "",
  requestType = "",
} = {}) {
  const safePricingKey = safeString(pricingKey, 180);
  if (safePricingKey) {
    return findPricingCatalogEntry({ pricingKey: safePricingKey }) || null;
  }

  const safeServiceName = safeString(serviceName, 140);
  if (!safeServiceName) return null;

  return (
    findPricingCatalogEntry({
      scope,
      requestType,
      track,
      country,
      serviceName: safeServiceName,
    }) || null
  );
}

export function listPricingCatalog(filters = {}) {
  return listPricingCatalogEntries(filters).map((row) => toPricingRow(row, null));
}

export function findPricingRow(rows, input = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const safePricingKey = safeString(input?.pricingKey, 180);
  if (safePricingKey) {
    return list.find((row) => row?.pricingKey === safePricingKey) || null;
  }

  const safeServiceName = safeString(input?.serviceName, 140);
  if (!safeServiceName) return null;

  const candidates = list.filter((row) => {
    if (!rowMatchesFilters(row, input)) return false;
    return sameText(row.serviceName || row.label, safeServiceName);
  });

  if (candidates.length === 1) return candidates[0];

  const safeCountry = safeString(input?.country, 120);
  if (safeCountry) {
    const exactCountry = candidates.filter((row) => safeString(row?.country, 120) === safeCountry);
    if (exactCountry.length === 1) return exactCountry[0];
  }

  return null;
}

export function subscribePricingRows({
  scope = "",
  requestType = "",
  track = "",
  country = "",
  onData,
  onError,
} = {}) {
  const ref = collection(db, PRICING_COLLECTION);
  return onSnapshot(
    ref,
    (snapshot) => {
      const overrideMap = buildOverrideMap(snapshot.docs);
      const rows = mergePricingRows(overrideMap, {
        scope,
        requestType,
        track,
        country,
      });
      if (typeof onData === "function") onData(rows);
    },
    (error) => {
      if (typeof onError === "function") onError(error);
    }
  );
}

export async function getPricingQuote({
  scope = "",
  pricingKey = "",
  track = "",
  country = "",
  serviceName = "",
  requestType = "",
} = {}) {
  const catalogRow = getResolvedCatalogRow({
    scope,
    pricingKey,
    track,
    country,
    serviceName,
    requestType,
  });
  const resolvedKey = safeString(pricingKey, 180) || safeString(catalogRow?.pricingKey, 180);

  if (resolvedKey) {
    const snapshot = await getDoc(doc(db, PRICING_COLLECTION, resolvedKey));
    if (snapshot.exists()) {
      const overrideRow = docToOverrideRow(snapshot, resolvedKey);
      return toPricingRow(catalogRow, overrideRow);
    }
  }

  if (catalogRow) return toPricingRow(catalogRow, null);
  return null;
}

export async function updatePricing({
  scope = "",
  pricingKey = "",
  track = "",
  country = "",
  serviceName = "",
  requestType = "",
  amount,
  currency = "KES",
} = {}) {
  const nextAmount = normalizePricingAmountValue(amount, 0);
  if (nextAmount <= 0) {
    throw new Error("Enter a valid price amount.");
  }

  const catalogRow = getResolvedCatalogRow({
    scope,
    pricingKey,
    track,
    country,
    serviceName,
    requestType,
  });
  const seedRow = toPricingRow(catalogRow, {
    pricingKey,
    scope,
    requestType,
    track,
    country,
    serviceName,
    amount: nextAmount,
    currency,
  });

  if (!seedRow?.pricingKey || !seedRow?.track || !seedRow?.country || !seedRow?.serviceName) {
    throw new Error("Pricing row is missing track, country, or service details.");
  }

  const user = auth.currentUser;
  const updatedAtMs = Date.now();
  const payload = {
    pricingKey: seedRow.pricingKey,
    scope: seedRow.scope,
    requestType: seedRow.requestType,
    track: seedRow.track,
    country: seedRow.country,
    serviceName: seedRow.serviceName,
    label: seedRow.label,
    note: seedRow.note,
    tag: seedRow.tag,
    currency: seedRow.currency,
    amount: nextAmount,
    defaultAmount: seedRow.defaultAmount,
    sortOrder: seedRow.sortOrder,
    updatedAt: serverTimestamp(),
    updatedAtMs,
    updatedByUid: safeString(user?.uid, 120),
    updatedByEmail: safeString(user?.email, 160),
  };

  await setDoc(doc(db, PRICING_COLLECTION, seedRow.pricingKey), payload, { merge: true });

  return {
    ...seedRow,
    amount: nextAmount,
    updatedAtMs,
    source: "override",
  };
}

export function toPricingSnapshot(row, overrides = {}) {
  const sourceRow = row && typeof row === "object" ? row : null;
  if (!sourceRow?.pricingKey) return null;

  const amount = normalizePricingAmountValue(
    overrides?.amount,
    sourceRow.amount || sourceRow.defaultAmount || 0
  );
  if (amount <= 0) return null;

  return {
    pricingKey: safeString(sourceRow.pricingKey, 180),
    scope: safeString(sourceRow.scope, 80).toLowerCase(),
    requestType: safeString(sourceRow.requestType, 20).toLowerCase() || "single",
    track: safeString(sourceRow.track, 20).toLowerCase(),
    country: safeString(sourceRow.country, 120),
    serviceName: safeString(sourceRow.serviceName || sourceRow.label, 120),
    label: safeString(sourceRow.label || sourceRow.serviceName, 140),
    tag: safeString(sourceRow.tag, 40),
    amount,
    defaultAmount: normalizePricingAmountValue(
      sourceRow.defaultAmount,
      DEFAULT_REQUEST_PRICE_KES
    ),
    currency: normalizeCurrency(overrides?.currency || sourceRow.currency || "KES"),
    updatedAtMs: normalizeTimestampMs(overrides?.updatedAtMs || sourceRow.updatedAtMs),
  };
}

export function listRequestPricingCatalog(options = {}) {
  return listPricingCatalog({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    requestType: "single",
    ...options,
  });
}

export function listFullPackagePricingCatalog(options = {}) {
  return listPricingCatalog({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
    ...options,
  });
}

export function findRequestPricingRow(rows, input = {}) {
  return findPricingRow(rows, {
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    requestType: "single",
    ...input,
  });
}

export function findFullPackagePricingRow(rows, input = {}) {
  return findPricingRow(rows, {
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
    ...input,
  });
}

export function subscribeRequestPricingRows(options = {}) {
  return subscribePricingRows({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    requestType: "single",
    ...options,
  });
}

export function subscribeFullPackagePricingRows(options = {}) {
  return subscribePricingRows({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
    ...options,
  });
}

export function getRequestPricingQuote(options = {}) {
  return getPricingQuote({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    requestType: "single",
    ...options,
  });
}

export function getFullPackagePricingQuote(options = {}) {
  return getPricingQuote({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
    ...options,
  });
}

export function updateRequestPricing(options = {}) {
  return updatePricing({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    requestType: "single",
    ...options,
  });
}

export function updateFullPackagePricing(options = {}) {
  return updatePricing({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
    ...options,
  });
}

export function toRequestPricingSnapshot(row, overrides = {}) {
  return toPricingSnapshot(row, overrides);
}

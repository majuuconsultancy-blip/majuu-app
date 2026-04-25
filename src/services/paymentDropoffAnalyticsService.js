import {
  fetchPaymentDropoffAnalytics,
  trackPaymentDropoff as trackPaymentDropoffApi,
} from "./apiService";

const PAYMENT_DROPOFF_STORAGE_PREFIX = "paymentDropoffEvent:";

export const PAYMENT_DROPOFF_STEPS = Object.freeze({
  INITIATED: "initiated",
  STK_SENT: "stk_sent",
  CANCELLED: "cancelled",
  INSUFFICIENT_BALANCE: "insufficient_balance",
  TIMEOUT: "timeout",
});

const STEP_PRIORITY = Object.freeze({
  [PAYMENT_DROPOFF_STEPS.STK_SENT]: 5,
  [PAYMENT_DROPOFF_STEPS.INSUFFICIENT_BALANCE]: 4,
  [PAYMENT_DROPOFF_STEPS.TIMEOUT]: 3,
  [PAYMENT_DROPOFF_STEPS.CANCELLED]: 2,
  [PAYMENT_DROPOFF_STEPS.INITIATED]: 1,
});

function cleanStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(dedupeKey = "") {
  const safeKey = cleanStr(dedupeKey, 240);
  return safeKey ? `${PAYMENT_DROPOFF_STORAGE_PREFIX}${safeKey}` : "";
}

function hasTracked(dedupeKey = "") {
  const key = storageKey(dedupeKey);
  if (!key) return false;
  const storage = getStorage();
  if (!storage) return false;
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function markTracked(dedupeKey = "") {
  const key = storageKey(dedupeKey);
  if (!key) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, "1");
  } catch {
    // Ignore local analytics storage issues.
  }
}

export function getPaymentDropoffStepPriority(step = "") {
  const safeStep = cleanStr(step, 80).toLowerCase();
  return STEP_PRIORITY[safeStep] || 0;
}

export function paymentDropoffStepLabel(step = "") {
  const safeStep = cleanStr(step, 80).toLowerCase();
  switch (safeStep) {
    case PAYMENT_DROPOFF_STEPS.STK_SENT:
      return "STK sent";
    case PAYMENT_DROPOFF_STEPS.INSUFFICIENT_BALANCE:
      return "Insufficient balance";
    case PAYMENT_DROPOFF_STEPS.CANCELLED:
      return "Cancelled";
    case PAYMENT_DROPOFF_STEPS.TIMEOUT:
      return "Timeout";
    case PAYMENT_DROPOFF_STEPS.INITIATED:
    default:
      return "Initiated";
  }
}

export function formatPaymentDropoffPhone(value = "") {
  const digits = cleanStr(value, 40).replace(/\D+/g, "");
  if (/^2547\d{8}$/.test(digits)) {
    return `+254 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return cleanStr(value, 40);
}

export function normalizePaymentDropoffRow(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  return {
    id: cleanStr(source?.id || source?.analyticsId, 180),
    phoneNumber: cleanStr(source?.phoneNumber, 40),
    amount: safeNumber(source?.amount),
    service: cleanStr(source?.service, 180),
    requestId: cleanStr(source?.requestId, 180),
    paymentId: cleanStr(source?.paymentId, 180),
    reference: cleanStr(source?.reference, 180),
    step: cleanStr(source?.step, 80).toLowerCase(),
    priority:
      safeNumber(source?.priority) || getPaymentDropoffStepPriority(source?.step),
    createdAtMs: safeNumber(source?.createdAtMs || source?.timestampMs),
  };
}

export function sortPaymentDropoffRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizePaymentDropoffRow(row))
    .sort((left, right) => {
      const createdDiff = safeNumber(right?.createdAtMs) - safeNumber(left?.createdAtMs);
      if (createdDiff !== 0) return createdDiff;
      return safeNumber(right?.priority) - safeNumber(left?.priority);
    });
}

export function buildPaymentDropoffDedupeKey({
  step = "",
  reference = "",
  paymentId = "",
  requestId = "",
} = {}) {
  const safeStep = cleanStr(step, 80).toLowerCase();
  const safeReference = cleanStr(reference, 180);
  const safePaymentId = cleanStr(paymentId, 180);
  const safeRequestId = cleanStr(requestId, 180);
  return [safeStep, safeReference || safePaymentId || safeRequestId].filter(Boolean).join(":");
}

export async function trackPaymentDropoff(payload = {}, { dedupeKey = "" } = {}) {
  const safeKey = cleanStr(dedupeKey, 240);
  if (safeKey && hasTracked(safeKey)) {
    return { ok: true, skipped: true };
  }

  try {
    const result = await trackPaymentDropoffApi(payload);
    if (safeKey) {
      markTracked(safeKey);
    }
    return result;
  } catch (error) {
    console.warn("[payment-dropoff] tracking failed:", error?.message || error);
    return { ok: false, error };
  }
}

export async function loadPaymentDropoffAnalytics({ limit = 50 } = {}) {
  const result = await fetchPaymentDropoffAnalytics({ limit });
  return sortPaymentDropoffRows(Array.isArray(result?.rows) ? result.rows : []);
}

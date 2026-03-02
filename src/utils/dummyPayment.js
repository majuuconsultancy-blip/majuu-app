const PAYMENT_KEY_PREFIX = "dummyPayment:";
const DRAFT_KEY_PREFIX = "dummyPaymentDraft:";

function normalizeDraftId(requestDraftId) {
  return String(requestDraftId || "").trim();
}

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key) {
  if (!key) return null;
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  if (!key || !value || typeof value !== "object") return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    void error;
  }
}

function removeKey(key) {
  if (!key) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch (error) {
    void error;
  }
}

export function createRequestDraftId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `draft_${Date.now().toString(36)}_${rand}`;
}

export function getDummyPaymentKey(requestDraftId) {
  const id = normalizeDraftId(requestDraftId);
  return id ? `${PAYMENT_KEY_PREFIX}${id}` : "";
}

export function getDummyPaymentDraftKey(requestDraftId) {
  const id = normalizeDraftId(requestDraftId);
  return id ? `${DRAFT_KEY_PREFIX}${id}` : "";
}

export function getDummyPaymentState(requestDraftId) {
  return readJson(getDummyPaymentKey(requestDraftId));
}

export function setDummyPaymentState(requestDraftId, value) {
  writeJson(getDummyPaymentKey(requestDraftId), value);
}

export function markDummyPaymentPaid(requestDraftId, extra = null) {
  const prev = getDummyPaymentState(requestDraftId);
  setDummyPaymentState(requestDraftId, {
    ...(prev && typeof prev === "object" ? prev : {}),
    ...(extra && typeof extra === "object" ? extra : {}),
    status: "paid",
    paidAt: Date.now(),
  });
}

export function clearDummyPaymentState(requestDraftId) {
  removeKey(getDummyPaymentKey(requestDraftId));
}

export function getDummyPaymentDraft(requestDraftId) {
  return readJson(getDummyPaymentDraftKey(requestDraftId));
}

export function setDummyPaymentDraft(requestDraftId, value) {
  writeJson(getDummyPaymentDraftKey(requestDraftId), value);
}

export function clearDummyPaymentDraft(requestDraftId) {
  removeKey(getDummyPaymentDraftKey(requestDraftId));
}

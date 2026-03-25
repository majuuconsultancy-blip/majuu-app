import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import { normalizeCountyName } from "../constants/kenyaCounties";
import { resolveFullPackageCoverageState } from "./fullpackageservice";
import { isUnsubmittedGhostRequest } from "../utils/requestGhosts";
import { getDummyPaymentState } from "../utils/dummyPayment";

export const WORKFLOW_DRAFTS_COLLECTION = "workflowDrafts";
const WORKFLOW_DRAFT_LOCAL_PREFIX = "workflowDraft";

export const WORKFLOW_DRAFT_FLOW_FAMILIES = {
  NORMAL_REQUEST: "normal_request",
  FULL_PACKAGE: "full_package",
};

export const WORKFLOW_DRAFT_FLOW_KINDS = {
  WEHELP_REQUEST: "wehelp_request",
  FULL_PACKAGE_SETUP: "full_package_setup",
  FULL_PACKAGE_ITEM_REQUEST: "full_package_item_request",
};

export const WORKFLOW_DRAFT_STATUSES = {
  DRAFT: "draft",
  DRAFT_PENDING_PAYMENT: "draft_pending_payment",
  PAYMENT_INITIATED: "payment_initiated",
  UNLOCK_PAID_PENDING_SUBMISSION: "unlock_paid_pending_submission",
  SUBMITTED: "submitted",
  EXPIRED_ABANDONED: "expired_abandoned",
  FULL_PACKAGE_DRAFT: "full_package_draft",
  FULL_PACKAGE_PENDING_PAYMENT: "full_package_pending_payment",
  FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS: "full_package_paid_pending_diagnostics",
  DIAGNOSTICS_IN_PROGRESS: "diagnostics_in_progress",
  READY_TO_GENERATE_REQUESTS: "ready_to_generate_requests",
  REQUESTS_GENERATED: "requests_generated",
};

const PAID_WORKFLOW_DRAFT_STATUSES = new Set([
  WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION,
  WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS,
]);

function getStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return safeString(value, max).toLowerCase();
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values, max = 80, itemMax = 180) {
  const list = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const clean = safeString(value, itemMax);
    const key = lower(clean, itemMax);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeTrack(value) {
  const track = lower(value, 24);
  return track === "work" || track === "travel" ? track : "study";
}

function normalizeFlowFamily(value) {
  return lower(value, 60) === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
    ? WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
    : WORKFLOW_DRAFT_FLOW_FAMILIES.NORMAL_REQUEST;
}

function normalizeFlowKind(value, fallback = WORKFLOW_DRAFT_FLOW_KINDS.WEHELP_REQUEST) {
  const raw = lower(value, 80);
  if (raw === WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_SETUP) {
    return WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_SETUP;
  }
  if (raw === WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_ITEM_REQUEST) {
    return WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_ITEM_REQUEST;
  }
  return fallback;
}

function normalizeStatus(value, fallback = WORKFLOW_DRAFT_STATUSES.DRAFT) {
  const raw = lower(value, 80);
  return Object.values(WORKFLOW_DRAFT_STATUSES).includes(raw) ? raw : fallback;
}

function normalizePaymentState(value) {
  const raw = lower(value, 40);
  if (raw === "paid") return "paid";
  if (raw === "pending") return "pending";
  return "unpaid";
}

function normalizeFileMetaList(input, max = 12) {
  const list = Array.isArray(input) ? input : [];
  const out = [];
  for (const row of list) {
    const name = safeString(row?.name, 120);
    if (!name) continue;
    out.push({
      name,
      size: Number(row?.size || 0),
      type: safeString(row?.type, 80),
      lastModified: Number(row?.lastModified || 0),
    });
    if (out.length >= max) break;
  }
  return out;
}

function normalizeExtraFieldValues(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const [fieldId, entry] of Object.entries(input)) {
    const id = safeString(fieldId, 80);
    if (!id) continue;
    const value = safeString(entry?.value, 2000);
    const fileMetas = normalizeFileMetaList(entry?.fileMetas, 6);
    if (!value && fileMetas.length === 0) continue;
    out[id] = { value, fileMetas };
  }
  return Object.keys(out).length ? out : null;
}

function normalizeFormState(input) {
  if (!input || typeof input !== "object") return null;
  return {
    name: safeString(input?.name, 140),
    phone: safeString(input?.phone, 60),
    email: safeString(input?.email, 140),
    county: normalizeCountyName(input?.county || ""),
    town: safeString(input?.town || input?.city, 80),
    city: safeString(input?.city || input?.town, 80),
    note: safeString(input?.note, 2000),
    preferredAgentId: safeString(input?.preferredAgentId, 160),
    fileMetas: normalizeFileMetaList(input?.fileMetas, 12),
    extraFieldValues: normalizeExtraFieldValues(input?.extraFieldValues),
    paid: Boolean(input?.paid),
    requestDraftId: safeString(input?.requestDraftId, 180),
  };
}

function normalizeRequestModalState(input) {
  if (!input || typeof input !== "object") {
    return {
      open: false,
      serviceName: "",
      requestType: "",
      step: "",
      formState: null,
      selectedItem: "",
      definitionKey: "",
      definitionCountry: "",
      pricingKey: "",
    };
  }
  return {
    open: Boolean(input?.open),
    serviceName: safeString(input?.serviceName, 140),
    requestType: safeString(input?.requestType, 40),
    step: safeString(input?.step, 80),
    formState: normalizeFormState(input?.formState),
    selectedItem: safeString(input?.selectedItem, 140),
    definitionKey: safeString(input?.definitionKey, 200),
    definitionCountry: safeString(input?.definitionCountry, 120),
    pricingKey: safeString(input?.pricingKey, 200),
  };
}

function normalizeFullPackageState(input) {
  if (!input || typeof input !== "object") {
    return {
      screen: "",
      detailsOpen: false,
      diagnosticOpen: false,
      fullPackageId: "",
      selectedItem: "",
      selectedItems: [],
      requestModal: normalizeRequestModalState(null),
    };
  }
  return {
    screen: safeString(input?.screen, 60),
    detailsOpen: Boolean(input?.detailsOpen),
    diagnosticOpen: Boolean(input?.diagnosticOpen),
    fullPackageId: safeString(input?.fullPackageId, 180),
    selectedItem: safeString(input?.selectedItem, 140),
    selectedItems: uniqueStrings(input?.selectedItems, 60, 140),
    requestModal: normalizeRequestModalState(input?.requestModal),
  };
}

function normalizeResumeState(input) {
  if (!input || typeof input !== "object") {
    return {
      requestModal: normalizeRequestModalState(null),
      fullPackage: normalizeFullPackageState(null),
    };
  }
  return {
    requestModal: normalizeRequestModalState(input?.requestModal),
    fullPackage: normalizeFullPackageState(input?.fullPackage),
  };
}

function normalizeLinkedPayment(input) {
  if (!input || typeof input !== "object") return null;
  const paymentId = safeString(input?.paymentId, 180);
  const requestId = safeString(input?.requestId, 180);
  const reference = safeString(
    input?.reference || input?.transactionReference || input?.providerReference,
    180
  );
  const payload = {
    paymentId,
    requestId,
    paymentType: safeString(input?.paymentType, 60),
    status: safeString(input?.status, 80),
    paymentState: normalizePaymentState(input?.paymentState || input?.status),
    amount: Number(input?.amount || 0) || 0,
    currency: safeString(input?.currency || "KES", 8).toUpperCase() || "KES",
    reference,
    paidAtMs: Number(input?.paidAtMs || 0) || toMillis(input?.paidAt),
    verifiedAtMs: Number(input?.verifiedAtMs || 0) || 0,
  };
  const hasAny =
    payload.paymentId ||
    payload.requestId ||
    payload.reference ||
    payload.amount > 0 ||
    payload.paidAtMs > 0;
  return hasAny ? payload : null;
}

function getDummyPaymentPaidAtMs(dummyPayment) {
  return (
    Number(dummyPayment?.paidAtMs || 0) ||
    Number(dummyPayment?.paidAt || 0) ||
    toMillis(dummyPayment?.paidAt)
  );
}

function isDummyPaymentMarkedPaid(dummyPayment) {
  return (
    lower(dummyPayment?.status, 80) === "paid" ||
    getDummyPaymentPaidAtMs(dummyPayment) > 0
  );
}

function buildDummyLinkedPayment(draft, dummyPayment) {
  if (!isDummyPaymentMarkedPaid(dummyPayment)) return null;

  return normalizeLinkedPayment({
    ...(draft?.linkedPayment || {}),
    requestId:
      safeString(dummyPayment?.requestId, 180) ||
      safeString(draft?.linkedRequestId, 180) ||
      safeString(draft?.linkedPayment?.requestId, 180),
    paymentId:
      safeString(dummyPayment?.paymentId, 180) ||
      safeString(draft?.linkedPayment?.paymentId, 180),
    paymentType:
      safeString(dummyPayment?.paymentType, 60) ||
      safeString(draft?.linkedPayment?.paymentType, 60) ||
      "unlock_request",
    status: "paid",
    paymentState: "paid",
    amount:
      Number(draft?.paymentAmount || draft?.linkedPayment?.amount || dummyPayment?.amount || 0) ||
      0,
    currency:
      safeString(
        draft?.paymentCurrency || draft?.linkedPayment?.currency || dummyPayment?.currency || "KES",
        8
      ).toUpperCase() || "KES",
    reference:
      safeString(
        dummyPayment?.transactionReference ||
          dummyPayment?.reference ||
          draft?.paymentReference ||
          draft?.linkedPayment?.reference,
        180
      ) || "",
    paidAtMs: getDummyPaymentPaidAtMs(dummyPayment),
    verifiedAtMs: Number(dummyPayment?.verifiedAtMs || 0) || 0,
  });
}

export function getWorkflowDraftPaymentFacts(rawDraft) {
  const draft = normalizeDraftRow(rawDraft);
  const dummyPayment = draft?.draftId ? getDummyPaymentState(draft.draftId) : null;
  const draftStatus = normalizeStatus(draft?.status, WORKFLOW_DRAFT_STATUSES.DRAFT);
  const draftPaymentState = normalizePaymentState(draft?.paymentState);
  const linkedPaymentState = normalizePaymentState(
    draft?.linkedPayment?.paymentState || draft?.linkedPayment?.status
  );
  const dummyPaymentPaid = isDummyPaymentMarkedPaid(dummyPayment);
  const actuallyPaid =
    draftPaymentState === "paid" ||
    linkedPaymentState === "paid" ||
    dummyPaymentPaid ||
    PAID_WORKFLOW_DRAFT_STATUSES.has(draftStatus);

  return {
    draftStatus,
    draftPaymentState,
    linkedPaymentState,
    dummyPayment,
    dummyPaymentPaid,
    actuallyPaid,
  };
}

export function isWorkflowDraftActuallyPaid(rawDraft) {
  return getWorkflowDraftPaymentFacts(rawDraft).actuallyPaid;
}

function normalizeDraftRow(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  const flowFamily = normalizeFlowFamily(source?.flowFamily);
  const flowKind = normalizeFlowKind(
    source?.flowKind,
    flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
      ? WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_SETUP
      : WORKFLOW_DRAFT_FLOW_KINDS.WEHELP_REQUEST
  );
  return {
    ...source,
    id: safeString(source?.id || source?.draftId, 180),
    draftId: safeString(source?.draftId || source?.id, 180),
    uid: safeString(source?.uid, 160),
    email: safeString(source?.email, 180),
    flowFamily,
    flowKind,
    status: normalizeStatus(
      source?.status,
      flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
        ? WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_DRAFT
        : WORKFLOW_DRAFT_STATUSES.DRAFT
    ),
    title: safeString(source?.title, 180),
    subtitle: safeString(source?.subtitle, 180),
    track: normalizeTrack(source?.track),
    country: safeString(source?.country, 120),
    county: normalizeCountyName(source?.county || ""),
    serviceName: safeString(source?.serviceName, 160),
    requestType: safeString(source?.requestType, 40),
    routePath: safeString(source?.routePath, 400),
    routeSearch: safeString(source?.routeSearch, 400),
    linkedRequestId: safeString(source?.linkedRequestId, 180),
    linkedPayment: normalizeLinkedPayment(source?.linkedPayment),
    fullPackageId: safeString(source?.fullPackageId, 180),
    selectedItem: safeString(source?.selectedItem, 160),
    selectedItems: uniqueStrings(source?.selectedItems, 60, 140),
    generatedRequestIds: uniqueStrings(source?.generatedRequestIds, 80, 180),
    generatedItemKeys: uniqueStrings(source?.generatedItemKeys, 80, 140),
    paymentState: normalizePaymentState(source?.paymentState),
    paymentAmount: Number(source?.paymentAmount || 0) || 0,
    paymentCurrency: safeString(source?.paymentCurrency || "KES", 8).toUpperCase() || "KES",
    paymentReference: safeString(source?.paymentReference, 180),
    fullPackageUnlockPaid: source?.fullPackageUnlockPaid === true,
    resumeState: normalizeResumeState(source?.resumeState),
    archived: source?.archived === true,
    archivedReason: safeString(source?.archivedReason, 200),
    createdAtMs: Number(source?.createdAtMs || 0) || toMillis(source?.createdAt),
    updatedAtMs: Number(source?.updatedAtMs || 0) || toMillis(source?.updatedAt),
    lastResumedAtMs: Number(source?.lastResumedAtMs || 0) || 0,
    submittedAtMs: Number(source?.submittedAtMs || 0) || 0,
    expiresAtMs: Number(source?.expiresAtMs || 0) || 0,
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, patch) {
  const left = isObject(base) ? base : {};
  const right = isObject(patch) ? patch : {};
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (isObject(value) && isObject(merged[key])) {
      merged[key] = mergeDeep(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function buildStatusLabel(draft) {
  const status = normalizeStatus(draft?.status);
  if (status === WORKFLOW_DRAFT_STATUSES.DRAFT) return "Draft saved";
  if (status === WORKFLOW_DRAFT_STATUSES.DRAFT_PENDING_PAYMENT) return "Payment pending";
  if (status === WORKFLOW_DRAFT_STATUSES.PAYMENT_INITIATED) return "Payment started";
  if (status === WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION) {
    return "Paid, continue request";
  }
  if (status === WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_DRAFT) return "Full package draft";
  if (status === WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PENDING_PAYMENT) {
    return "Full package payment pending";
  }
  if (status === WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS) {
    return "Paid, continue setup";
  }
  if (status === WORKFLOW_DRAFT_STATUSES.DIAGNOSTICS_IN_PROGRESS) {
    return "Resume diagnostics";
  }
  if (status === WORKFLOW_DRAFT_STATUSES.READY_TO_GENERATE_REQUESTS) {
    return "Continue setup";
  }
  if (status === WORKFLOW_DRAFT_STATUSES.REQUESTS_GENERATED) return "Requests generated";
  if (status === WORKFLOW_DRAFT_STATUSES.SUBMITTED) return "Submitted";
  if (status === WORKFLOW_DRAFT_STATUSES.EXPIRED_ABANDONED) return "Expired";
  return "Draft";
}

export function workflowDraftStatusUi(draft) {
  const normalized = normalizeDraftRow(draft);
  const status = normalized.status;
  let className =
    "border border-zinc-200 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200";
  if (
    status === WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION ||
    status === WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS
  ) {
    className =
      "border border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100";
  } else if (
    status === WORKFLOW_DRAFT_STATUSES.DRAFT_PENDING_PAYMENT ||
    status === WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PENDING_PAYMENT ||
    status === WORKFLOW_DRAFT_STATUSES.PAYMENT_INITIATED
  ) {
    className =
      "border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100";
  } else if (
    status === WORKFLOW_DRAFT_STATUSES.READY_TO_GENERATE_REQUESTS ||
    status === WORKFLOW_DRAFT_STATUSES.DIAGNOSTICS_IN_PROGRESS
  ) {
    className =
      "border border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-100";
  }
  return { label: buildStatusLabel(normalized), className };
}

function draftDocRef(draftId) {
  return doc(db, WORKFLOW_DRAFTS_COLLECTION, safeString(draftId, 180));
}

function localWorkflowDraftKey(uid, draftId) {
  const safeUid = safeString(uid, 160);
  const safeDraftId = safeString(draftId, 180);
  if (!safeUid || !safeDraftId) return "";
  return `${WORKFLOW_DRAFT_LOCAL_PREFIX}:${safeUid}:${safeDraftId}`;
}

function serializeWorkflowDraftForStorage(row) {
  const normalized = normalizeDraftRow(row);
  const payload = { ...normalized };
  delete payload.createdAt;
  delete payload.updatedAt;
  return payload;
}

function readLocalWorkflowDraft(uid, draftId) {
  const storage = getStorage();
  const key = localWorkflowDraftKey(uid, draftId);
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? normalizeDraftRow(parsed) : null;
  } catch {
    return null;
  }
}

function writeLocalWorkflowDraft(row) {
  const storage = getStorage();
  const normalized = serializeWorkflowDraftForStorage(row);
  const key = localWorkflowDraftKey(normalized.uid, normalized.draftId);
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify(normalized));
  } catch {
    // Ignore storage pressure or disabled storage.
  }
}

function deleteLocalWorkflowDraftRecord(uid, draftId) {
  const storage = getStorage();
  const key = localWorkflowDraftKey(uid, draftId);
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function deleteLocalWorkflowDraftById(draftId, uid = "") {
  const storage = getStorage();
  const safeDraftId = safeString(draftId, 180);
  if (!storage || !safeDraftId) return;

  const scopedKey = localWorkflowDraftKey(uid, safeDraftId);
  if (scopedKey) {
    deleteLocalWorkflowDraftRecord(uid, safeDraftId);
    return;
  }

  const prefix = `${WORKFLOW_DRAFT_LOCAL_PREFIX}:`;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(prefix) || !key.endsWith(`:${safeDraftId}`)) continue;
    try {
      storage.removeItem(key);
    } catch {
      // Ignore storage cleanup failures.
    }
  }
}

function listLocalWorkflowDrafts(uid) {
  const storage = getStorage();
  const safeUid = safeString(uid, 160);
  if (!storage || !safeUid) return [];

  const prefix = `${WORKFLOW_DRAFT_LOCAL_PREFIX}:${safeUid}:`;
  const rows = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(prefix)) continue;
    try {
      const parsed = JSON.parse(storage.getItem(key) || "null");
      if (parsed && typeof parsed === "object") {
        rows.push(normalizeDraftRow(parsed));
      }
    } catch {
      // Ignore malformed cached entries and continue.
    }
  }

  return rows;
}

function mergeWorkflowDraftRows(...groups) {
  const map = new Map();

  groups
    .flat()
    .filter(Boolean)
    .forEach((row) => {
      const normalized = normalizeDraftRow(row);
      if (!normalized.draftId) return;
      const current = map.get(normalized.draftId);
      if (!current) {
        map.set(normalized.draftId, normalized);
        return;
      }
      const currentUpdatedAtMs = Number(current.updatedAtMs || current.createdAtMs || 0) || 0;
      const nextUpdatedAtMs =
        Number(normalized.updatedAtMs || normalized.createdAtMs || 0) || 0;
      map.set(
        normalized.draftId,
        nextUpdatedAtMs >= currentUpdatedAtMs ? normalized : current
      );
    });

  return Array.from(map.values()).sort(
    (left, right) => Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0)
  );
}

function sanitizeDraftPatch(draftId, patch = {}) {
  const raw = patch && typeof patch === "object" ? patch : {};
  const currentUser = auth.currentUser;
  const flowFamily = normalizeFlowFamily(raw?.flowFamily);
  const routePath = safeString(raw?.routePath, 400);
  const routeSearch = safeString(raw?.routeSearch, 400);
  const resumeState = normalizeResumeState(raw?.resumeState);
  const fullPackageState = resumeState.fullPackage;
  const payment = normalizeLinkedPayment(raw?.linkedPayment);

  return {
    draftId: safeString(draftId, 180),
    uid: safeString(raw?.uid || currentUser?.uid, 160),
    email: safeString(raw?.email || currentUser?.email, 180),
    flowFamily,
    flowKind: normalizeFlowKind(
      raw?.flowKind,
      flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
        ? WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_SETUP
        : WORKFLOW_DRAFT_FLOW_KINDS.WEHELP_REQUEST
    ),
    status: normalizeStatus(
      raw?.status,
      flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
        ? WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_DRAFT
        : WORKFLOW_DRAFT_STATUSES.DRAFT
    ),
    title: safeString(raw?.title, 180),
    subtitle: safeString(raw?.subtitle, 180),
    track: normalizeTrack(raw?.track),
    country: safeString(raw?.country, 120),
    county: normalizeCountyName(raw?.county || ""),
    serviceName: safeString(raw?.serviceName, 160),
    requestType: safeString(raw?.requestType, 40),
    routePath,
    routeSearch,
    linkedRequestId: safeString(raw?.linkedRequestId, 180),
    linkedPayment: payment,
    fullPackageId: safeString(raw?.fullPackageId || fullPackageState.fullPackageId, 180),
    selectedItem: safeString(raw?.selectedItem || fullPackageState.selectedItem, 160),
    selectedItems: uniqueStrings(
      raw?.selectedItems || fullPackageState.selectedItems,
      60,
      140
    ),
    generatedRequestIds: uniqueStrings(raw?.generatedRequestIds, 80, 180),
    generatedItemKeys: uniqueStrings(raw?.generatedItemKeys, 80, 140),
    paymentState: normalizePaymentState(raw?.paymentState || payment?.paymentState),
    paymentAmount: Number(
      raw?.paymentAmount ?? payment?.amount ?? 0
    ) || 0,
    paymentCurrency:
      safeString(raw?.paymentCurrency || payment?.currency || "KES", 8).toUpperCase() || "KES",
    paymentReference:
      safeString(raw?.paymentReference || payment?.reference, 180) || "",
    fullPackageUnlockPaid: raw?.fullPackageUnlockPaid === true,
    resumeState,
    archived: raw?.archived === true,
    archivedReason: safeString(raw?.archivedReason, 200),
    submittedAtMs: Number(raw?.submittedAtMs || 0) || 0,
    lastResumedAtMs: Number(raw?.lastResumedAtMs || 0) || 0,
    expiresAtMs: Number(raw?.expiresAtMs || 0) || 0,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  };
}

export async function saveWorkflowDraft(draftId, patch = {}) {
  const safeDraftId = safeString(draftId, 180);
  const currentUser = auth.currentUser;
  const patchSource = patch && typeof patch === "object" ? patch : {};
  const fallbackUid = safeString(patchSource?.uid || currentUser?.uid, 160);
  const fallbackEmail = safeString(patchSource?.email || currentUser?.email, 180);
  if (!safeDraftId) throw new Error("Draft ID is required.");
  if (!fallbackUid) throw new Error("You must be signed in to save a draft.");

  const localExisting = readLocalWorkflowDraft(fallbackUid, safeDraftId);
  const localMergedSource = mergeDeep(
    localExisting || {},
    {
      ...patchSource,
      uid: fallbackUid,
      email: fallbackEmail || localExisting?.email || "",
    }
  );
  const localNext = sanitizeDraftPatch(safeDraftId, localMergedSource);
  const localPayload = {
    ...localNext,
    createdAtMs: Number(localExisting?.createdAtMs || 0) || Date.now(),
  };
  const localRow = normalizeDraftRow({
    id: safeDraftId,
    ...(localExisting || {}),
    ...localPayload,
  });
  writeLocalWorkflowDraft(localRow);

  if (!currentUser?.uid) return localRow;

  try {
    const ref = draftDocRef(safeDraftId);
    const existing = await getDoc(ref);
    const existingData = existing.exists() ? existing.data() || {} : {};
    const mergedSource = mergeDeep(existingData, localMergedSource);
    const next = sanitizeDraftPatch(safeDraftId, mergedSource);
    const payload = {
      ...next,
      createdAt: existing.exists()
        ? existingData?.createdAt || serverTimestamp()
        : serverTimestamp(),
      createdAtMs:
        Number(existingData?.createdAtMs || localExisting?.createdAtMs || 0) || Date.now(),
    };

    await setDoc(ref, payload, { merge: true });
    const storedRow = normalizeDraftRow({ id: safeDraftId, ...existingData, ...payload });
    writeLocalWorkflowDraft(storedRow);
    return storedRow;
  } catch (error) {
    console.warn("Workflow draft remote sync failed:", error?.message || error);
    return localRow;
  }
}

export async function getWorkflowDraft(draftId) {
  const safeDraftId = safeString(draftId, 180);
  if (!safeDraftId) return null;
  const currentUid = safeString(auth.currentUser?.uid, 160);
  const localDraft = currentUid ? readLocalWorkflowDraft(currentUid, safeDraftId) : null;

  try {
    const snap = await getDoc(draftDocRef(safeDraftId));
    if (!snap.exists()) return localDraft || null;
    const merged = mergeWorkflowDraftRows(
      normalizeDraftRow({ id: snap.id, ...(snap.data() || {}) }),
      localDraft
    )[0] || null;
    if (merged) writeLocalWorkflowDraft(merged);
    return merged;
  } catch (error) {
    if (localDraft) return localDraft;
    throw error;
  }
}

async function loadLinkedRequestDraftState(draft) {
  const linkedRequestId = safeString(draft?.linkedRequestId, 180);
  if (!linkedRequestId) {
    return { linkedRequest: null, linkedPayment: null, effectiveStatus: draft.status };
  }

  const requestSnap = await getDoc(doc(db, "serviceRequests", linkedRequestId));
  if (!requestSnap.exists()) {
    return { linkedRequest: null, linkedPayment: null, effectiveStatus: draft.status };
  }

  const linkedRequest = { id: requestSnap.id, ...(requestSnap.data() || {}) };
  const paymentId =
    safeString(draft?.linkedPayment?.paymentId, 180) ||
    safeString(linkedRequest?.unlockPaymentId, 180);
  let linkedPayment = null;

  if (paymentId) {
    const paymentSnap = await getDoc(doc(db, "serviceRequests", linkedRequestId, "payments", paymentId));
    if (paymentSnap.exists()) {
      linkedPayment = { id: paymentSnap.id, ...(paymentSnap.data() || {}) };
    }
  }

  let effectiveStatus = draft.status;
  if (!isUnsubmittedGhostRequest(linkedRequest) && lower(linkedRequest?.status, 80) !== "payment_pending") {
    effectiveStatus = WORKFLOW_DRAFT_STATUSES.SUBMITTED;
  } else if (lower(linkedPayment?.status, 80) === "paid") {
    effectiveStatus = WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION;
  } else if (
    lower(linkedPayment?.status, 80) === "awaiting_payment" ||
    lower(linkedPayment?.status, 80) === "payment_session_created"
  ) {
    effectiveStatus = WORKFLOW_DRAFT_STATUSES.PAYMENT_INITIATED;
  }

  return { linkedRequest, linkedPayment, effectiveStatus };
}

async function loadLinkedFullPackageDraftState(draft) {
  const fullPackageId = safeString(draft?.fullPackageId, 180);
  if (!fullPackageId) {
    return { fullPackage: null, effectiveStatus: draft.status };
  }

  const fullPackageSnap = await getDoc(doc(db, "fullPackages", fullPackageId));
  if (!fullPackageSnap.exists()) {
    return { fullPackage: null, effectiveStatus: draft.status };
  }

  const fullPackage = { id: fullPackageSnap.id, ...(fullPackageSnap.data() || {}) };
  const selectedItems = uniqueStrings(
    draft?.selectedItems?.length ? draft.selectedItems : fullPackage?.selectedItems,
    60,
    140
  );
  const coverage = resolveFullPackageCoverageState(fullPackage, selectedItems);
  const generatedCount = uniqueStrings(draft?.generatedItemKeys, 80, 140).length;

  let effectiveStatus = draft.status;
  if (coverage.isCovered && selectedItems.length > 0 && generatedCount >= selectedItems.length) {
    effectiveStatus = WORKFLOW_DRAFT_STATUSES.REQUESTS_GENERATED;
  } else if (coverage.isCovered && fullPackageId) {
    effectiveStatus = WORKFLOW_DRAFT_STATUSES.READY_TO_GENERATE_REQUESTS;
  }

  return { fullPackage, effectiveStatus };
}

export async function hydrateWorkflowDraft(rawDraft) {
  const draft = normalizeDraftRow(rawDraft);
  if (!draft?.draftId) return null;

  const [requestState, fullPackageState] = await Promise.all([
    draft.flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.NORMAL_REQUEST
      ? loadLinkedRequestDraftState(draft)
      : Promise.resolve({ linkedRequest: null, linkedPayment: null, effectiveStatus: draft.status }),
    draft.flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
      ? loadLinkedFullPackageDraftState(draft)
      : Promise.resolve({ fullPackage: null, effectiveStatus: draft.status }),
  ]);

  let effectiveStatus =
    draft.flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE
      ? fullPackageState.effectiveStatus
      : requestState.effectiveStatus;

  const requestLinkedPayment = normalizeLinkedPayment(requestState.linkedPayment);
  const paymentFacts = getWorkflowDraftPaymentFacts({
    ...draft,
    linkedPayment: requestLinkedPayment || draft.linkedPayment,
    status: effectiveStatus,
  });
  const dummyLinkedPayment = buildDummyLinkedPayment(draft, paymentFacts.dummyPayment);
  const linkedPayment = dummyLinkedPayment || requestLinkedPayment || draft.linkedPayment;
  const actuallyPaid = isWorkflowDraftActuallyPaid({
    ...draft,
    linkedPayment,
    status: effectiveStatus,
    paymentState: linkedPayment
      ? normalizePaymentState(linkedPayment?.paymentState || linkedPayment?.status)
      : draft.paymentState,
  });

  if (actuallyPaid && effectiveStatus !== WORKFLOW_DRAFT_STATUSES.SUBMITTED) {
    if (draft.flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE) {
      const shouldHoldPaidState =
        effectiveStatus !== WORKFLOW_DRAFT_STATUSES.READY_TO_GENERATE_REQUESTS &&
        effectiveStatus !== WORKFLOW_DRAFT_STATUSES.REQUESTS_GENERATED &&
        effectiveStatus !== WORKFLOW_DRAFT_STATUSES.DIAGNOSTICS_IN_PROGRESS;
      if (shouldHoldPaidState) {
        effectiveStatus = WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS;
      }
    } else {
      effectiveStatus = WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION;
    }
  }

  return normalizeDraftRow({
    ...draft,
    status: effectiveStatus,
    linkedPayment,
    paymentState: actuallyPaid
      ? "paid"
      : linkedPayment
      ? normalizePaymentState(linkedPayment?.paymentState || linkedPayment?.status)
      : draft.paymentState,
    paymentAmount: Number(linkedPayment?.amount || draft.paymentAmount || 0) || 0,
    paymentCurrency:
      safeString(linkedPayment?.currency || draft.paymentCurrency || "KES", 8).toUpperCase() ||
      "KES",
    paymentReference: safeString(
      linkedPayment?.reference || draft.paymentReference,
      180
    ),
    fullPackageUnlockPaid:
      draft.fullPackageUnlockPaid === true ||
      (draft.flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE && actuallyPaid),
  });
}

async function hydrateWorkflowDraftSafely(rawDraft) {
  try {
    return await hydrateWorkflowDraft(rawDraft);
  } catch (error) {
    console.warn("Failed to hydrate workflow draft:", error?.message || error);
    return normalizeDraftRow(rawDraft);
  }
}

async function resolveWorkflowDraftRows(rows, { hydrate = true } = {}) {
  const normalizedRows = Array.isArray(rows)
    ? rows.map((row) => normalizeDraftRow(row)).filter((row) => row?.draftId)
    : [];
  const next = hydrate
    ? await Promise.all(normalizedRows.map((row) => hydrateWorkflowDraftSafely(row)))
    : normalizedRows;
  const merged = mergeWorkflowDraftRows(next.filter(Boolean));
  merged.forEach((row) => writeLocalWorkflowDraft(row));
  return merged;
}

export async function listMyWorkflowDrafts(uid, { max = 40, hydrate = true } = {}) {
  const safeUid = safeString(uid, 160);
  if (!safeUid) return [];
  const localRows = listLocalWorkflowDrafts(safeUid);

  try {
    const snap = await getDocs(
      query(collection(db, WORKFLOW_DRAFTS_COLLECTION), where("uid", "==", safeUid), limit(max))
    );
    const remoteRows = snap.docs.map((docSnap) =>
      normalizeDraftRow({ id: docSnap.id, ...(docSnap.data() || {}) })
    );
    return resolveWorkflowDraftRows(mergeWorkflowDraftRows(remoteRows, localRows), { hydrate });
  } catch (error) {
    if (!localRows.length) throw error;
    return resolveWorkflowDraftRows(localRows, { hydrate });
  }
}

export function subscribeMyWorkflowDrafts(uid, { onData, onError, max = 40, hydrate = true } = {}) {
  const safeUid = safeString(uid, 160);
  if (!safeUid) {
    onData?.([]);
    return () => {};
  }

  const emitRows = async (rows = []) => {
    const localRows = listLocalWorkflowDrafts(safeUid);
    const next = await resolveWorkflowDraftRows(mergeWorkflowDraftRows(rows, localRows), {
      hydrate,
    });
    onData?.(next);
  };

  void emitRows([]);

  const ref = query(collection(db, WORKFLOW_DRAFTS_COLLECTION), where("uid", "==", safeUid), limit(max));
  return onSnapshot(
    ref,
    async (snap) => {
      try {
        const rows = snap.docs.map((docSnap) =>
          normalizeDraftRow({ id: docSnap.id, ...(docSnap.data() || {}) })
        );
        await emitRows(rows);
      } catch (error) {
        void emitRows([]);
        onError?.(error);
      }
    },
    (error) => {
      void emitRows([]);
      onError?.(error);
    }
  );
}

export function isWorkflowDraftVisible(draft) {
  const row = normalizeDraftRow(draft);
  if (!row.draftId || row.archived) return false;
  if (row.status === WORKFLOW_DRAFT_STATUSES.SUBMITTED) return false;
  if (row.status === WORKFLOW_DRAFT_STATUSES.REQUESTS_GENERATED) return false;
  if (row.status === WORKFLOW_DRAFT_STATUSES.EXPIRED_ABANDONED) return false;
  return true;
}

export async function archiveWorkflowDraft(draftId, patch = {}) {
  const existing = await getWorkflowDraft(draftId);
  if (!existing) return null;
  return saveWorkflowDraft(draftId, {
    ...existing,
    ...patch,
    archived: true,
    archivedReason: safeString(
      patch?.archivedReason || existing?.archivedReason || "completed",
      200
    ),
    status: normalizeStatus(
      patch?.status || existing?.status || WORKFLOW_DRAFT_STATUSES.SUBMITTED
    ),
    submittedAtMs: Number(patch?.submittedAtMs || Date.now()) || Date.now(),
  });
}

export async function markWorkflowDraftResumed(draftId) {
  const current = await getWorkflowDraft(draftId);
  if (!current) return null;
  return saveWorkflowDraft(draftId, {
    ...current,
    lastResumedAtMs: Date.now(),
  });
}

export async function deleteWorkflowDraft(draftId) {
  const safeDraftId = safeString(draftId, 180);
  if (!safeDraftId) return false;
  deleteLocalWorkflowDraftById(safeDraftId, auth.currentUser?.uid || "");
  try {
    await deleteDoc(draftDocRef(safeDraftId));
  } catch (error) {
    console.warn("Workflow draft remote delete failed:", error?.message || error);
  }
  return true;
}

export async function recordWorkflowDraftGeneratedRequest(
  draftId,
  {
    requestId = "",
    itemKey = "",
    selectedItems = [],
  } = {}
) {
  const current = await getWorkflowDraft(draftId);
  if (!current) return null;

  const nextGeneratedRequestIds = uniqueStrings(
    [...(current.generatedRequestIds || []), requestId],
    80,
    180
  );
  const nextGeneratedItemKeys = uniqueStrings(
    [...(current.generatedItemKeys || []), itemKey],
    80,
    140
  );
  const expectedItems = uniqueStrings(
    selectedItems?.length ? selectedItems : current.selectedItems,
    60,
    140
  );
  const allGenerated =
    expectedItems.length > 0 && nextGeneratedItemKeys.length >= expectedItems.length;

  return saveWorkflowDraft(draftId, {
    ...current,
    generatedRequestIds: nextGeneratedRequestIds,
    generatedItemKeys: nextGeneratedItemKeys,
    selectedItems: expectedItems,
    status: allGenerated
      ? WORKFLOW_DRAFT_STATUSES.REQUESTS_GENERATED
      : WORKFLOW_DRAFT_STATUSES.READY_TO_GENERATE_REQUESTS,
    archived: allGenerated,
    archivedReason: allGenerated ? "requests_generated" : "",
  });
}

export function buildWorkflowDraftContinueTarget(rawDraft) {
  const draft = normalizeDraftRow(rawDraft);
  if (!draft?.draftId) return null;

  const track = normalizeTrack(draft.track);
  const country = safeString(draft.country, 120);

  if (draft.flowFamily === WORKFLOW_DRAFT_FLOW_FAMILIES.NORMAL_REQUEST) {
    const requestModalState = draft.resumeState?.requestModal || null;
    const savedRoutePath = safeString(draft.routePath, 240);
    const usesTrackScreen = savedRoutePath === `/app/${track}`;
    const query = new URLSearchParams(
      usesTrackScreen ? safeString(draft.routeSearch, 600).replace(/^\?/, "") : ""
    );
    if (!usesTrackScreen && country) query.set("country", country);
    query.set("draft", draft.draftId);
    if (draft.serviceName) query.set("open", draft.serviceName);
    query.set("autoOpen", "1");
    if (requestModalState?.definitionKey) {
      query.set("definitionKey", requestModalState.definitionKey);
    }
    if (requestModalState?.definitionCountry) {
      query.set("definitionCountry", requestModalState.definitionCountry);
    }
    if (requestModalState?.pricingKey) {
      query.set("pricingKey", requestModalState.pricingKey);
    }
    return {
      path: usesTrackScreen ? savedRoutePath : `/app/${track}/we-help`,
      search: query.toString() ? `?${query.toString()}` : "",
      state: usesTrackScreen
        ? {
            resumeTrackSimple: {
              track,
              country,
              requestModal: {
                open: true,
                serviceName: draft.serviceName,
                requestType: draft.requestType || "single",
                step:
                  draft.resumeState?.requestModal?.step ||
                  (draft.status === WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION
                    ? "submit"
                    : "form"),
                formState: draft.resumeState?.requestModal?.formState || null,
                definitionKey: draft.resumeState?.requestModal?.definitionKey || "",
                definitionCountry: draft.resumeState?.requestModal?.definitionCountry || "",
                pricingKey: draft.resumeState?.requestModal?.pricingKey || "",
              },
            },
          }
        : {
            resumeWeHelp: {
              track,
              country,
              requestModal: {
                open: true,
                serviceName: draft.serviceName,
                requestType: draft.requestType || "single",
                step:
                  draft.resumeState?.requestModal?.step ||
                  (draft.status === WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION
                    ? "submit"
                    : "form"),
                formState: draft.resumeState?.requestModal?.formState || null,
                definitionKey: draft.resumeState?.requestModal?.definitionKey || "",
                definitionCountry: draft.resumeState?.requestModal?.definitionCountry || "",
                pricingKey: draft.resumeState?.requestModal?.pricingKey || "",
              },
            },
          },
    };
  }

  const query = new URLSearchParams();
  if (country) query.set("country", country);
  query.set("draft", draft.draftId);

  const fullPackageId = safeString(draft.fullPackageId, 180);
  const selectedItem =
    safeString(draft.selectedItem, 160) ||
    safeString(draft.resumeState?.fullPackage?.selectedItem, 160) ||
    safeString(draft.resumeState?.fullPackage?.requestModal?.selectedItem, 160);

  if (
    fullPackageId &&
    (draft.status === WORKFLOW_DRAFT_STATUSES.READY_TO_GENERATE_REQUESTS ||
      draft.status === WORKFLOW_DRAFT_STATUSES.DIAGNOSTICS_IN_PROGRESS ||
      draft.status === WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS)
  ) {
    const requestModalState = draft.resumeState?.fullPackage?.requestModal || null;
    query.set("fullPackageId", fullPackageId);
    query.set("track", track);
    query.set("fpDraft", draft.draftId);
    if (selectedItem) {
      query.set("autoOpen", "1");
      query.set("item", selectedItem);
      if (requestModalState?.definitionKey) {
        query.set("definitionKey", requestModalState.definitionKey);
      }
      if (requestModalState?.definitionCountry) {
        query.set("definitionCountry", requestModalState.definitionCountry);
      }
      if (requestModalState?.pricingKey) {
        query.set("pricingKey", requestModalState.pricingKey);
      }
    }
    return {
      path: `/app/full-package/${track}`,
      search: `?${query.toString()}`,
      state: {
        fullPackageId,
        missingItems: draft.selectedItems,
        resumeFullPackage: {
          fullPackageId,
          selectedItem,
          requestModal: {
            open: Boolean(draft.resumeState?.fullPackage?.requestModal?.open),
            step: draft.resumeState?.fullPackage?.requestModal?.step || "",
            formState: draft.resumeState?.fullPackage?.requestModal?.formState || null,
            selectedItem,
            definitionKey: draft.resumeState?.fullPackage?.requestModal?.definitionKey || "",
            definitionCountry:
              draft.resumeState?.fullPackage?.requestModal?.definitionCountry || "",
            pricingKey: draft.resumeState?.fullPackage?.requestModal?.pricingKey || "",
          },
        },
      },
    };
  }

  query.set("fpDraft", draft.draftId);
  return {
    path: `/app/${track}/we-help`,
    search: `?${query.toString()}`,
    state: {
      resumeWeHelp: {
        track,
        country,
        fullPackage: {
          detailsOpen: true,
          diagnosticOpen: true,
          fullPackageId,
          selectedItem,
          selectedItems: draft.selectedItems,
          requestModal: {
            open: Boolean(draft.resumeState?.fullPackage?.requestModal?.open),
            step: draft.resumeState?.fullPackage?.requestModal?.step || "",
            formState: draft.resumeState?.fullPackage?.requestModal?.formState || null,
            selectedItem,
            definitionKey: draft.resumeState?.fullPackage?.requestModal?.definitionKey || "",
            definitionCountry:
              draft.resumeState?.fullPackage?.requestModal?.definitionCountry || "",
            pricingKey: draft.resumeState?.fullPackage?.requestModal?.pricingKey || "",
          },
          unlock: {
            requestDraftId: draft.draftId,
            fullPackageId,
            selectedItems: draft.selectedItems,
            unlockAmount: draft.paymentAmount,
          },
        },
      },
    },
  };
}

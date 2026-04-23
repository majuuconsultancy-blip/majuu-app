import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";
import {
  initiatePayment,
  invokeFinanceAction,
  verifyPayment as verifyPaymentApi,
} from "./apiService";
import { getRequestStartedAtMs } from "../utils/requestWorkProgress";

export const PAYMENT_TYPES = {
  UNLOCK_REQUEST: "unlock_request",
  IN_PROGRESS: "in_progress",
};

export const PAYMENT_STATUSES = {
  DRAFT: "draft",
  PROMPTED: "prompted",
  ADMIN_REVIEW: "admin_review",
  APPROVED: "approved",
  PAYABLE: "payable",
  PAYMENT_SESSION_CREATED: "payment_session_created",
  AWAITING_PAYMENT: "awaiting_payment",
  PAID: "paid",
  HELD: "held",
  PAYOUT_READY: "payout_ready",
  SETTLED: "settled",
  REFUND_REQUESTED: "refund_requested",
  REFUND_UNDER_REVIEW: "refund_under_review",
  REFUNDED: "refunded",
  REVOKED: "revoked",
  EXPIRED: "expired",
  FAILED: "failed",
  AUTO_REFUNDED: "auto_refunded",
  REJECTED: "rejected",
};

export const REFUND_STATUSES = {
  REQUESTED: "requested",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  REFUNDED: "refunded",
  FAILED: "failed",
  AUTO_REFUNDED: "auto_refunded",
};

export const UNLOCK_AUTO_REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;

function cleanStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return cleanStr(value, max).toLowerCase();
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
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

function normalizeCurrency(value, fallback = "KES") {
  return cleanStr(value || fallback, 8).toUpperCase() || fallback;
}

function normalizePaymentMethod() {
  return "mpesa";
}

function callFinance(action, payload = {}) {
  return invokeFinanceAction(action, payload);
}

function normalizeHostedSession(result = {}) {
  const source = result && typeof result === "object" ? result : {};
  const authorizationUrl = cleanStr(
    source?.authorizationUrl || source?.redirectUrl,
    1200
  );
  return {
    ...source,
    authorizationUrl,
    redirectUrl: authorizationUrl,
  };
}

export function normalizePaymentDoc(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  const reference =
    cleanStr(
      source?.transactionReference ||
        source?.paymentReference ||
        source?.reference ||
        source?.currentReference,
      180
    ) || "";
  return {
    ...source,
    id: cleanStr(source?.id || source?.paymentId, 180),
    paymentId: cleanStr(source?.paymentId || source?.id, 180),
    requestId: cleanStr(source?.requestId, 180),
    fullPackageId: cleanStr(source?.fullPackageId, 180),
    paymentType: lower(source?.paymentType, 80),
    flowType: lower(source?.flowType, 80),
    payerMode: cleanStr(source?.payerMode, 80),
    paymentLabel: cleanStr(source?.paymentLabel, 180),
    note: cleanStr(source?.note, 2000),
    status: lower(source?.status, 80),
    amount: roundMoney(source?.amount),
    currency: normalizeCurrency(source?.currency || "KES"),
    provider: "mpesa",
    paymentMethod: normalizePaymentMethod(),
    transactionReference: reference,
    paymentReference: reference,
    reference,
    breakdown:
      source?.breakdown && typeof source.breakdown === "object"
        ? source.breakdown
        : null,
    financialSnapshot:
      source?.financialSnapshot && typeof source.financialSnapshot === "object"
        ? source.financialSnapshot
        : null,
    shareLinkToken: cleanStr(source?.shareLinkToken, 400),
    shareLinkUrl: cleanStr(source?.shareLinkUrl, 1200),
    refundRequestId: cleanStr(source?.refundRequestId, 180),
    createdAtMs: Number(source?.createdAtMs || 0) || toMillis(source?.createdAt),
    updatedAtMs: Number(source?.updatedAtMs || 0) || toMillis(source?.updatedAt),
    approvedAtMs: Number(source?.approvedAtMs || 0) || toMillis(source?.approvedAt),
    paidAtMs: Number(source?.paidAtMs || 0) || toMillis(source?.paidAt),
    settledAtMs: Number(source?.settledAtMs || 0) || toMillis(source?.settledAt),
    releasedAtMs: Number(source?.releasedAtMs || 0) || toMillis(source?.releasedAt),
  };
}

export function normalizeRefundDoc(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ...source,
    id: cleanStr(source?.id || source?.refundId, 180),
    refundId: cleanStr(source?.refundId || source?.id, 180),
    requestId: cleanStr(source?.requestId, 180),
    paymentId: cleanStr(source?.paymentId, 180),
    paymentType: lower(source?.paymentType, 80),
    status: lower(source?.status, 80),
    provider: "mpesa",
    service: cleanStr(source?.service || "b2c", 40),
    amount: roundMoney(source?.amount),
    currency: normalizeCurrency(source?.currency || "KES"),
    userReason: cleanStr(source?.userReason, 2000),
    adminExplanation: cleanStr(source?.adminExplanation, 2000),
    expectedRefundPeriodText: cleanStr(source?.expectedRefundPeriodText, 240),
    rejectionReason: cleanStr(source?.rejectionReason, 2000),
    refundExecution:
      source?.refundExecution && typeof source.refundExecution === "object"
        ? source.refundExecution
        : null,
    createdAtMs: Number(source?.createdAtMs || 0) || toMillis(source?.createdAt),
    updatedAtMs: Number(source?.updatedAtMs || 0) || toMillis(source?.updatedAt),
  };
}

export function paymentStatusUi(status) {
  const s = lower(status, 80);
  const map = {
    draft: ["Draft", "border border-zinc-200 bg-zinc-100 text-zinc-700"],
    prompted: ["STK sent", "border border-blue-200 bg-blue-50 text-blue-900"],
    admin_review: ["Under review", "border border-amber-200 bg-amber-50 text-amber-900"],
    approved: ["Approved", "border border-emerald-200 bg-emerald-50 text-emerald-900"],
    payable: ["Payable", "border border-emerald-200 bg-emerald-50 text-emerald-900"],
    payment_session_created: [
      "Checkout created",
      "border border-blue-200 bg-blue-50 text-blue-900",
    ],
    awaiting_payment: [
      "Awaiting payment",
      "border border-blue-200 bg-blue-50 text-blue-900",
    ],
    paid: ["Paid", "border border-emerald-200 bg-emerald-50 text-emerald-900"],
    held: ["Held by MAJUU", "border border-sky-200 bg-sky-50 text-sky-900"],
    payout_ready: ["Payout ready", "border border-indigo-200 bg-indigo-50 text-indigo-900"],
    settled: ["Settled", "border border-zinc-200 bg-zinc-100 text-zinc-800"],
    refund_requested: ["Refund requested", "border border-amber-200 bg-amber-50 text-amber-900"],
    refund_under_review: [
      "Refund under review",
      "border border-blue-200 bg-blue-50 text-blue-900",
    ],
    refunded: ["Refunded", "border border-zinc-200 bg-zinc-100 text-zinc-800"],
    auto_refunded: ["Auto refunded", "border border-purple-200 bg-purple-50 text-purple-900"],
    revoked: ["Revoked", "border border-rose-200 bg-rose-50 text-rose-800"],
    failed: ["Failed", "border border-rose-200 bg-rose-50 text-rose-800"],
    expired: ["Expired", "border border-zinc-200 bg-zinc-100 text-zinc-700"],
    rejected: ["Rejected", "border border-rose-200 bg-rose-50 text-rose-800"],
  };
  const [label, cls] = map[s] || [
    s || "Unknown",
    "border border-zinc-200 bg-zinc-100 text-zinc-700",
  ];
  return { label, cls };
}

export function refundStatusUi(status) {
  const s = lower(status, 80);
  const map = {
    requested: ["Requested", "border border-amber-200 bg-amber-50 text-amber-900"],
    under_review: ["Under review", "border border-blue-200 bg-blue-50 text-blue-900"],
    approved: ["Approved", "border border-blue-200 bg-blue-50 text-blue-900"],
    rejected: ["Rejected", "border border-rose-200 bg-rose-50 text-rose-800"],
    refunded: ["Refunded", "border border-zinc-200 bg-zinc-100 text-zinc-800"],
    auto_refunded: ["Auto refunded", "border border-purple-200 bg-purple-50 text-purple-900"],
    failed: ["Failed", "border border-rose-200 bg-rose-50 text-rose-800"],
  };
  const [label, cls] = map[s] || [
    s || "Unknown",
    "border border-zinc-200 bg-zinc-100 text-zinc-700",
  ];
  return { label, cls };
}

export function isUnlockPaymentAutoRefundEligible({
  payment,
  requestData,
  nowMs = Date.now(),
}) {
  const p = normalizePaymentDoc(payment);
  if (p.paymentType !== PAYMENT_TYPES.UNLOCK_REQUEST) return false;
  if (p.status !== PAYMENT_STATUSES.PAID) return false;
  const paidAtMs = Number(p.paidAtMs || 0);
  if (paidAtMs <= 0) return false;
  if (getRequestStartedAtMs(requestData) > 0) return false;
  const eligibleAtMs =
    Number(p.unlockAutoRefundEligibleAtMs || 0) || paidAtMs + UNLOCK_AUTO_REFUND_WINDOW_MS;
  return nowMs >= eligibleAtMs;
}

export async function createUnlockCheckoutSession(payload = {}) {
  return normalizeHostedSession(
    await initiatePayment({
      ...payload,
      flowType: "unlock_request",
      phoneNumber: cleanStr(payload?.phoneNumber || payload?.phone, 40),
    })
  );
}

export async function createFullPackageUnlockCheckoutSession(payload = {}) {
  return normalizeHostedSession(
    await initiatePayment({
      ...payload,
      flowType: "full_package_unlock",
      phoneNumber: cleanStr(payload?.phoneNumber || payload?.phone, 40),
    })
  );
}

export async function activatePreparedUnlockRequest(payload = {}) {
  return callFinance("activatePreparedUnlockRequest", payload);
}

export async function createInProgressPaymentProposal(payload = {}) {
  return callFinance("createInProgressPaymentProposal", payload);
}

export async function adminApproveInProgressPayment(payload = {}) {
  return callFinance("adminApprovePaymentRequest", payload);
}

export async function adminRejectInProgressPayment({
  requestId,
  paymentId,
  rejectionReason,
} = {}) {
  return callFinance("adminRevokePaymentRequest", {
    requestId,
    paymentId,
    reason: rejectionReason,
  });
}

export async function createPaymentCheckoutSession(payload = {}) {
  return normalizeHostedSession(
    await initiatePayment({
      ...payload,
      flowType: payload?.shareToken
        ? "shared_in_progress_payment"
        : "in_progress_payment",
      phoneNumber: cleanStr(payload?.phoneNumber || payload?.phone, 40),
    })
  );
}

export async function getOrCreateSharedPaymentLink(payload = {}) {
  return callFinance("getOrCreateSharedPaymentLink", payload);
}

export async function resolveSharedPaymentLink(payload = {}) {
  return callFinance("resolveSharedPaymentLink", payload);
}

export async function reconcilePaymentReference(payload = {}) {
  const reference = cleanStr(
    typeof payload === "string" ? payload : payload?.reference,
    180
  );
  if (!reference) {
    throw new Error("Payment reference is missing.");
  }
  return verifyPaymentApi({ reference });
}

export async function createRefundRequest({ requestId, paymentId, userReason } = {}) {
  return callFinance("requestPaymentRefund", { requestId, paymentId, userReason });
}

export async function adminApproveRefund({
  requestId,
  refundId,
  adminExplanation,
  expectedRefundPeriodText,
} = {}) {
  return callFinance("adminDecidePaymentRefund", {
    requestId,
    refundId,
    decision: "approve",
    note: adminExplanation,
    expectedRefundPeriodText,
  });
}

export async function adminRejectRefund({ requestId, refundId, rejectionReason } = {}) {
  return callFinance("adminDecidePaymentRefund", {
    requestId,
    refundId,
    decision: "reject",
    note: rejectionReason,
  });
}

export async function getFinanceEnvironmentStatus() {
  return callFinance("getFinanceEnvironmentStatus", {});
}

export async function applyUnlockAutoRefundSweep({ requestIds = [] } = {}) {
  const result = await callFinance("runUnlockAutoRefundSweep", { requestIds });
  return Number(result?.applied || 0);
}

export async function listUnlockAutoRefundEligibleRequests({ requestIds = [] } = {}) {
  const result = await callFinance("listUnlockAutoRefundCandidates", { requestIds });
  return Array.isArray(result?.rows) ? result.rows : [];
}

export async function releasePartnerPayout(payload = {}) {
  return callFinance("releasePartnerPayout", payload);
}

export async function userPayAwaitingPayment() {
  throw new Error("Direct dummy payments are retired. Use M-Pesa checkout.");
}

export async function ensureUnlockAutoRefundForRequest(requestId) {
  const ids = cleanStr(requestId, 180) ? [cleanStr(requestId, 180)] : [];
  if (!ids.length) return 0;
  return applyUnlockAutoRefundSweep({ requestIds: ids });
}

export async function createUnlockPaymentForRequest() {
  throw new Error("Legacy direct unlock payment writes are retired. Use backend checkout.");
}

export async function userCanOpenSharedLink(shareToken = "") {
  const result = await resolveSharedPaymentLink({ shareToken });
  return result?.valid === true;
}

export async function getUnlockPaymentForRequest(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return null;
  const snap = await getDocs(
    query(
      collection(db, "serviceRequests", safeRequestId, "payments"),
      where("paymentType", "==", PAYMENT_TYPES.UNLOCK_REQUEST),
      limit(10)
    )
  );
  const row = snap.docs
    .map((docSnap) =>
      normalizePaymentDoc({ id: docSnap.id, ...(docSnap.data() || {}) })
    )
    .find(Boolean);
  return row || null;
}

export async function listRequestRefunds(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return [];
  const snap = await getDocs(collection(db, "serviceRequests", safeRequestId, "refundRequests"));
  return snap.docs.map((docSnap) =>
    normalizeRefundDoc({ id: docSnap.id, ...(docSnap.data() || {}) })
  );
}

export async function listRequestPayments(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return [];
  const snap = await getDocs(collection(db, "serviceRequests", safeRequestId, "payments"));
  return snap.docs.map((docSnap) =>
    normalizePaymentDoc({ id: docSnap.id, ...(docSnap.data() || {}) })
  );
}

export async function getRequestOwnerUid(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return "";
  const snap = await getDoc(doc(db, "serviceRequests", safeRequestId));
  return snap.exists() ? cleanStr(snap.data()?.uid, 160) : "";
}

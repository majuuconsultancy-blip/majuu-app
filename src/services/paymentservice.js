import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import {
  createAdminNotification,
  createStaffNotification,
  createUserNotification,
} from "./notificationDocs";
import { getRequestStartedAtMs } from "../utils/requestWorkProgress";

export const PAYMENT_TYPES = {
  UNLOCK_REQUEST: "unlock_request",
  IN_PROGRESS: "in_progress",
};

export const PAYMENT_STATUSES = {
  PENDING_ADMIN_APPROVAL: "pending_admin_approval",
  AWAITING_USER_PAYMENT: "awaiting_user_payment",
  PAID: "paid",
  REJECTED: "rejected",
  AUTO_REFUNDED: "auto_refunded",
  REFUNDED: "refunded",
};

export const REFUND_STATUSES = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  AUTO_REFUNDED: "auto_refunded",
  REFUNDED: "refunded",
};

export const UNLOCK_AUTO_REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;

function cleanStr(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function normalizePaymentTypeValue(value) {
  const raw = cleanStr(value, 80).toLowerCase();
  if (!raw) return "";
  if (
    raw === PAYMENT_TYPES.UNLOCK_REQUEST ||
    raw === "unlock" ||
    raw === "unlockrequest" ||
    raw === "unlock_request_payment" ||
    raw === "unlock-payment"
  ) {
    return PAYMENT_TYPES.UNLOCK_REQUEST;
  }
  if (
    raw === PAYMENT_TYPES.IN_PROGRESS ||
    raw === "inprogress" ||
    raw === "in_progress_payment" ||
    raw === "in-progress" ||
    raw === "progress_payment"
  ) {
    return PAYMENT_TYPES.IN_PROGRESS;
  }
  return raw;
}

function normalizePaymentStatusValue(value) {
  const raw = cleanStr(value, 80).toLowerCase();
  if (!raw) return "";
  if (
    raw === PAYMENT_STATUSES.PENDING_ADMIN_APPROVAL ||
    raw === "pending_admin" ||
    raw === "staff_proposed" ||
    raw === "proposal_pending"
  ) {
    return PAYMENT_STATUSES.PENDING_ADMIN_APPROVAL;
  }
  if (
    raw === PAYMENT_STATUSES.AWAITING_USER_PAYMENT ||
    raw === "awaiting_payment" ||
    raw === "approved" ||
    raw === "published_to_user" ||
    raw === "awaiting-user-payment"
  ) {
    return PAYMENT_STATUSES.AWAITING_USER_PAYMENT;
  }
  if (raw === PAYMENT_STATUSES.PAID || raw === "successful" || raw === "completed") {
    return PAYMENT_STATUSES.PAID;
  }
  if (raw === PAYMENT_STATUSES.REJECTED || raw === "declined") {
    return PAYMENT_STATUSES.REJECTED;
  }
  if (raw === PAYMENT_STATUSES.AUTO_REFUNDED || raw === "auto_refund" || raw === "auto-refunded") {
    return PAYMENT_STATUSES.AUTO_REFUNDED;
  }
  if (raw === PAYMENT_STATUSES.REFUNDED || raw === "manual_refunded" || raw === "refund_paid") {
    return PAYMENT_STATUSES.REFUNDED;
  }
  return raw;
}

function cleanAmount(value) {
  const source =
    typeof value === "string" ? value.replace(/[^0-9.]+/g, "") : value;
  const n = Number(source || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function cleanCurrency(value) {
  const c = cleanStr(value || "KES", 8).toUpperCase();
  return c || "KES";
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
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

export function buildDummyTransactionReference(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MJ-PAY-${yyyy}${mm}${dd}-${rand}`;
}

function formatMoneyText(amount, currency = "KES") {
  const value = cleanAmount(amount);
  if (!value) return "";
  return `${cleanCurrency(currency)} ${value.toLocaleString()}`;
}

function requestRoutePath(requestId, role = "user") {
  const rid = cleanStr(requestId, 180);
  if (!rid) return "";
  const safeRole = cleanStr(role, 40).toLowerCase();
  if (safeRole === "staff") return `/staff/request/${encodeURIComponent(rid)}`;
  if (safeRole === "admin" || safeRole === "assignedadmin") {
    return `/app/admin/request/${encodeURIComponent(rid)}`;
  }
  return `/app/request/${encodeURIComponent(rid)}`;
}

function requestAdminUidFromData(requestData) {
  return cleanStr(
    requestData?.ownerLockedAdminUid || requestData?.currentAdminUid || "",
    160
  );
}

function requestAssignedStaffUidFromData(requestData) {
  return cleanStr(requestData?.assignedTo, 160);
}

async function safeCreateUserNotification(payload) {
  try {
    return await createUserNotification(payload);
  } catch (error) {
    console.warn("Failed to create user notification:", error?.message || error);
    return null;
  }
}

async function safeCreateStaffNotification(payload) {
  try {
    return await createStaffNotification(payload);
  } catch (error) {
    console.warn("Failed to create staff notification:", error?.message || error);
    return null;
  }
}

async function safeCreateAdminNotification(payload) {
  try {
    return await createAdminNotification(payload);
  } catch (error) {
    console.warn("Failed to create admin notification:", error?.message || error);
    return null;
  }
}

async function safeNotifyAdminForRequest(requestId, requestData, payload) {
  const adminUid = requestAdminUidFromData(requestData);
  if (!adminUid) return null;
  return safeCreateAdminNotification({
    uid: adminUid,
    requestId,
    ...payload,
  });
}

export function paymentStatusUi(status) {
  const s = normalizePaymentStatusValue(status);
  if (s === PAYMENT_STATUSES.PENDING_ADMIN_APPROVAL) {
    return {
      label: "Pending admin approval",
      cls: "border border-amber-200 bg-amber-50 text-amber-900",
    };
  }
  if (s === PAYMENT_STATUSES.AWAITING_USER_PAYMENT) {
    return {
      label: "Awaiting payment",
      cls: "border border-blue-200 bg-blue-50 text-blue-900",
    };
  }
  if (s === PAYMENT_STATUSES.PAID) {
    return {
      label: "Paid",
      cls: "border border-emerald-200 bg-emerald-50 text-emerald-900",
    };
  }
  if (s === PAYMENT_STATUSES.REJECTED) {
    return {
      label: "Rejected",
      cls: "border border-rose-200 bg-rose-50 text-rose-800",
    };
  }
  if (s === PAYMENT_STATUSES.AUTO_REFUNDED) {
    return {
      label: "Auto refunded",
      cls: "border border-purple-200 bg-purple-50 text-purple-900",
    };
  }
  if (s === PAYMENT_STATUSES.REFUNDED) {
    return {
      label: "Refunded",
      cls: "border border-zinc-200 bg-zinc-100 text-zinc-800",
    };
  }
  return {
    label: s || "Unknown",
    cls: "border border-zinc-200 bg-zinc-100 text-zinc-700",
  };
}

export function refundStatusUi(status) {
  const s = cleanStr(status, 40).toLowerCase();
  if (s === REFUND_STATUSES.PENDING) {
    return {
      label: "Pending",
      cls: "border border-amber-200 bg-amber-50 text-amber-900",
    };
  }
  if (s === REFUND_STATUSES.APPROVED) {
    return {
      label: "Approved",
      cls: "border border-blue-200 bg-blue-50 text-blue-900",
    };
  }
  if (s === REFUND_STATUSES.REJECTED) {
    return {
      label: "Rejected",
      cls: "border border-rose-200 bg-rose-50 text-rose-800",
    };
  }
  if (s === REFUND_STATUSES.AUTO_REFUNDED) {
    return {
      label: "Auto Refunded",
      cls: "border border-purple-200 bg-purple-50 text-purple-900",
    };
  }
  if (s === REFUND_STATUSES.REFUNDED) {
    return {
      label: "Refunded",
      cls: "border border-zinc-200 bg-zinc-100 text-zinc-800",
    };
  }
  return {
    label: s || "Unknown",
    cls: "border border-zinc-200 bg-zinc-100 text-zinc-700",
  };
}

function requireActorUid() {
  const uid = cleanStr(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("Not signed in.");
  return uid;
}

export function normalizePaymentDoc(row) {
  const data = row && typeof row === "object" ? row : {};
  const amount = cleanAmount(data.amount);
  const paymentType = normalizePaymentTypeValue(data.paymentType);
  const status = normalizePaymentStatusValue(data.status);
  return {
    ...data,
    id: cleanStr(data.id, 180),
    requestId: cleanStr(data.requestId, 180),
    paymentType,
    paymentLabel: cleanStr(data.paymentLabel, 120) || (paymentType === PAYMENT_TYPES.UNLOCK_REQUEST ? "Unlock request payment" : "In-progress payment"),
    amount,
    currency: cleanCurrency(data.currency),
    status,
    createdAtMs: Number(data.createdAtMs || 0) || toMillis(data.createdAt),
    approvedAtMs: Number(data.approvedAtMs || 0) || toMillis(data.approvedAt),
    paidAtMs: Number(data.paidAtMs || 0) || toMillis(data.paidAt),
    transactionReference: cleanStr(data.transactionReference || data.reference || data.ref, 120),
    note: cleanStr(data.note, 1200),
    rejectionReason: cleanStr(data.rejectionReason, 1200),
    createdByStaffUid: cleanStr(data.createdByStaffUid, 160),
    approvedByAdminUid: cleanStr(data.approvedByAdminUid, 160),
    requestUid: cleanStr(data.requestUid, 160),
    unlockAutoRefundEligibleAtMs: Number(data.unlockAutoRefundEligibleAtMs || 0),
  };
}

export function normalizeRefundDoc(row) {
  const data = row && typeof row === "object" ? row : {};
  const id = cleanStr(data.id, 180);
  return {
    ...data,
    id,
    refundId: cleanStr(data.refundId, 180) || id,
    requestId: cleanStr(data.requestId, 180),
    paymentId: cleanStr(data.paymentId, 180),
    paymentLabel: cleanStr(data.paymentLabel, 120),
    paymentType: cleanStr(data.paymentType, 80).toLowerCase(),
    amount: cleanAmount(data.amount),
    currency: cleanCurrency(data.currency),
    status: cleanStr(data.status, 60).toLowerCase(),
    uid: cleanStr(data.uid, 160),
    userReason: cleanStr(data.userReason, 2000),
    adminExplanation: cleanStr(data.adminExplanation, 2000),
    expectedRefundPeriodText: cleanStr(data.expectedRefundPeriodText, 300),
    rejectionReason: cleanStr(data.rejectionReason, 2000),
    createdAtMs: Number(data.createdAtMs || 0) || toMillis(data.createdAt),
    decisionAtMs: Number(data.decisionAtMs || 0) || toMillis(data.decisionAt),
  };
}

function requireRefundLinks(refund, expectedRequestId = "") {
  const source = refund && typeof refund === "object" ? refund : {};
  const refundId = cleanStr(source.refundId || source.id, 180);
  const requestId = cleanStr(source.requestId, 180);
  const paymentId = cleanStr(source.paymentId, 180);

  if (!refundId || !requestId || !paymentId) {
    throw new Error("Refund record is missing required references.");
  }
  if (expectedRequestId && requestId !== expectedRequestId) {
    throw new Error("Refund request linkage mismatch.");
  }

  return { refundId, requestId, paymentId };
}

function paymentsCol(requestId) {
  return collection(db, "serviceRequests", requestId, "payments");
}

function paymentDocRef(requestId, paymentId) {
  return doc(db, "serviceRequests", requestId, "payments", paymentId);
}

function refundsCol(requestId) {
  return collection(db, "serviceRequests", requestId, "refundRequests");
}

function refundDocRef(requestId, refundId) {
  return doc(db, "serviceRequests", requestId, "refundRequests", refundId);
}

function unlockStartedAtMs(requestData) {
  return getRequestStartedAtMs(requestData);
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
  if (unlockStartedAtMs(requestData) > 0) return false;
  return nowMs >= paidAtMs + UNLOCK_AUTO_REFUND_WINDOW_MS;
}

export async function createUnlockPaymentForRequest({
  requestId,
  requestUid,
  amount,
  currency = "KES",
  paymentLabel = "Unlock request payment",
  note = "",
  paidAtMs = Date.now(),
  transactionReference = "",
  context = null,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  if (!cleanRequestId) throw new Error("Missing request ID.");
  const uid = cleanStr(requestUid, 160);
  if (!uid) throw new Error("Missing request owner UID.");

  const actorUid = requireActorUid();
  const safePaidAtMs = Number(paidAtMs || Date.now()) || Date.now();
  const amountNum = cleanAmount(amount);
  const ref = cleanStr(transactionReference, 120) || buildDummyTransactionReference(safePaidAtMs);
  const nowMs = Date.now();
  const requestSnap = await getDoc(doc(db, "serviceRequests", cleanRequestId));
  const requestData = requestSnap.exists() ? requestSnap.data() || {} : {};

  const payload = {
    requestId: cleanRequestId,
    requestUid: uid,
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    paymentLabel: cleanStr(paymentLabel, 120) || "Unlock request payment",
    amount: amountNum,
    currency: cleanCurrency(currency),
    status: PAYMENT_STATUSES.PAID,
    createdAt: serverTimestamp(),
    createdAtMs: nowMs,
    approvedAt: serverTimestamp(),
    approvedAtMs: nowMs,
    paidAt: serverTimestamp(),
    paidAtMs: safePaidAtMs,
    transactionReference: ref,
    note: cleanStr(note, 1200),
    createdByUid: actorUid,
    createdByRole: "user",
    approvedByAdminUid: "",
    rejectionReason: "",
    unlockAutoRefundEligibleAtMs: safePaidAtMs + UNLOCK_AUTO_REFUND_WINDOW_MS,
    context: context && typeof context === "object" ? context : null,
    updatedAt: serverTimestamp(),
  };

  const refDoc = await addDoc(paymentsCol(cleanRequestId), payload);

  await updateDoc(doc(db, "serviceRequests", cleanRequestId), {
    unlockPaymentId: refDoc.id,
    unlockPaymentRequestId: cleanRequestId,
    markedInProgressAtMs: Number(0),
    updatedAt: serverTimestamp(),
  });

  await safeNotifyAdminForRequest(cleanRequestId, requestData, {
    type: "PAYMENT_RECEIVED",
    notificationId: `payment_received_unlock_${cleanRequestId}_${refDoc.id}`,
    extras: {
      paymentId: refDoc.id,
      paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
      paymentLabel: payload.paymentLabel,
      amount: payload.amount,
      currency: payload.currency,
      title: "Payment received",
      body: `${payload.paymentLabel} ${formatMoneyText(payload.amount, payload.currency)} paid.`,
      route: requestRoutePath(cleanRequestId, "admin"),
    },
  });

  return {
    id: refDoc.id,
    ...payload,
  };
}

export async function createInProgressPaymentProposal({
  requestId,
  amount,
  paymentLabel,
  note,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  if (!cleanRequestId) throw new Error("Missing request ID.");

  const actorUid = requireActorUid();
  const label = cleanStr(paymentLabel, 120);
  if (!label) throw new Error("Payment label is required.");
  const amountNum = cleanAmount(amount);
  if (amountNum <= 0) throw new Error("Amount must be greater than zero.");

  const snap = await getDoc(doc(db, "serviceRequests", cleanRequestId));
  if (!snap.exists()) throw new Error("Request not found.");
  const req = snap.data() || {};
  const requestUid = cleanStr(req.uid, 160);
  if (!requestUid) throw new Error("Request owner is missing.");

  const nowMs = Date.now();
  const payload = {
    requestId: cleanRequestId,
    requestUid,
    paymentType: PAYMENT_TYPES.IN_PROGRESS,
    paymentLabel: label,
    amount: amountNum,
    currency: "KES",
    status: PAYMENT_STATUSES.PENDING_ADMIN_APPROVAL,
    createdAt: serverTimestamp(),
    createdAtMs: nowMs,
    approvedAt: null,
    approvedAtMs: 0,
    paidAt: null,
    paidAtMs: 0,
    transactionReference: "",
    note: cleanStr(note, 1200),
    rejectionReason: "",
    createdByStaffUid: actorUid,
    approvedByAdminUid: "",
    updatedAt: serverTimestamp(),
  };

  const refDoc = await addDoc(paymentsCol(cleanRequestId), payload);
  await safeNotifyAdminForRequest(cleanRequestId, req, {
    type: "PAYMENT_UPDATE",
    notificationId: `payment_review_${cleanRequestId}_${refDoc.id}`,
    extras: {
      paymentId: refDoc.id,
      paymentType: PAYMENT_TYPES.IN_PROGRESS,
      paymentLabel: payload.paymentLabel,
      amount: payload.amount,
      currency: payload.currency,
      title: "Payment update",
      body: `${payload.paymentLabel} ${formatMoneyText(payload.amount, payload.currency)} awaiting admin review.`,
      route: requestRoutePath(cleanRequestId, "admin"),
    },
  });
  return { id: refDoc.id, ...payload };
}

export async function adminApproveInProgressPayment({
  requestId,
  paymentId,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  const cleanPaymentId = cleanStr(paymentId, 180);
  if (!cleanRequestId || !cleanPaymentId) throw new Error("Missing payment details.");
  const actorUid = requireActorUid();
  const nowMs = Date.now();
  const [requestSnap, paymentSnap] = await Promise.all([
    getDoc(doc(db, "serviceRequests", cleanRequestId)),
    getDoc(paymentDocRef(cleanRequestId, cleanPaymentId)),
  ]);
  const requestData = requestSnap.exists() ? requestSnap.data() || {} : {};
  const payment = paymentSnap.exists()
    ? normalizePaymentDoc({ id: paymentSnap.id, ...paymentSnap.data() })
    : null;

  await updateDoc(paymentDocRef(cleanRequestId, cleanPaymentId), {
    status: PAYMENT_STATUSES.AWAITING_USER_PAYMENT,
    approvedAt: serverTimestamp(),
    approvedAtMs: nowMs,
    approvedByAdminUid: actorUid,
    rejectionReason: "",
    updatedAt: serverTimestamp(),
  });

  if (payment) {
    await Promise.allSettled([
      safeCreateUserNotification({
        uid: payment.requestUid,
        requestId: cleanRequestId,
        type: "PAYMENT_REQUIRED",
        notificationId: `payment_required_${cleanRequestId}_${cleanPaymentId}`,
        extras: {
          paymentId: cleanPaymentId,
          paymentType: payment.paymentType,
          paymentLabel: payment.paymentLabel,
          amount: payment.amount,
          currency: payment.currency,
          title: "Payment required",
          body: `${payment.paymentLabel} ${formatMoneyText(payment.amount, payment.currency)} ready for payment.`,
          route: requestRoutePath(cleanRequestId, "user"),
        },
      }),
      safeCreateStaffNotification({
        uid: requestAssignedStaffUidFromData(requestData) || payment.createdByStaffUid,
        requestId: cleanRequestId,
        type: "PAYMENT_UPDATE",
        notificationId: `payment_update_approved_${cleanRequestId}_${cleanPaymentId}`,
        extras: {
          paymentId: cleanPaymentId,
          paymentType: payment.paymentType,
          paymentLabel: payment.paymentLabel,
          amount: payment.amount,
          currency: payment.currency,
          title: "Payment update",
          body: `${payment.paymentLabel} approved and published to user.`,
          route: requestRoutePath(cleanRequestId, "staff"),
        },
      }),
    ]);
  }

  return true;
}

export async function adminRejectInProgressPayment({
  requestId,
  paymentId,
  rejectionReason,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  const cleanPaymentId = cleanStr(paymentId, 180);
  if (!cleanRequestId || !cleanPaymentId) throw new Error("Missing payment details.");

  const actorUid = requireActorUid();
  const reason = cleanStr(rejectionReason, 1200);
  if (!reason) throw new Error("Rejection reason is required.");
  const [requestSnap, paymentSnap] = await Promise.all([
    getDoc(doc(db, "serviceRequests", cleanRequestId)),
    getDoc(paymentDocRef(cleanRequestId, cleanPaymentId)),
  ]);
  const requestData = requestSnap.exists() ? requestSnap.data() || {} : {};
  const payment = paymentSnap.exists()
    ? normalizePaymentDoc({ id: paymentSnap.id, ...paymentSnap.data() })
    : null;

  await updateDoc(paymentDocRef(cleanRequestId, cleanPaymentId), {
    status: PAYMENT_STATUSES.REJECTED,
    rejectionReason: reason,
    approvedByAdminUid: actorUid,
    approvedAt: serverTimestamp(),
    approvedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });

  if (payment) {
    await safeCreateStaffNotification({
      uid: requestAssignedStaffUidFromData(requestData) || payment.createdByStaffUid,
      requestId: cleanRequestId,
      type: "PAYMENT_UPDATE",
      notificationId: `payment_update_rejected_${cleanRequestId}_${cleanPaymentId}`,
      extras: {
        paymentId: cleanPaymentId,
        paymentType: payment.paymentType,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        title: "Payment update",
        body: `${payment.paymentLabel} was not approved.`,
        route: requestRoutePath(cleanRequestId, "staff"),
        rejectionReason: reason,
      },
    });
  }

  return true;
}

export async function userPayAwaitingPayment({
  requestId,
  paymentId,
  method = "dummy",
  paidAtMs = Date.now(),
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  const cleanPaymentId = cleanStr(paymentId, 180);
  if (!cleanRequestId || !cleanPaymentId) throw new Error("Missing payment details.");
  const actorUid = requireActorUid();
  const paymentRef = paymentDocRef(cleanRequestId, cleanPaymentId);
  const requestSnap = await getDoc(doc(db, "serviceRequests", cleanRequestId));
  const requestData = requestSnap.exists() ? requestSnap.data() || {} : {};
  let settledPayment = null;

  await runTransaction(db, async (tx) => {
    const paySnap = await tx.get(paymentRef);
    if (!paySnap.exists()) throw new Error("Payment request not found.");
    const payment = normalizePaymentDoc({ id: paySnap.id, ...paySnap.data() });

    if (payment.requestUid !== actorUid) {
      throw new Error("This payment is not linked to your account.");
    }
    if (payment.status !== PAYMENT_STATUSES.AWAITING_USER_PAYMENT) {
      throw new Error("This payment is not awaiting user payment.");
    }

    const finalPaidAtMs = Number(paidAtMs || Date.now()) || Date.now();
    tx.update(paymentRef, {
      status: PAYMENT_STATUSES.PAID,
      paidAt: serverTimestamp(),
      paidAtMs: finalPaidAtMs,
      transactionReference: buildDummyTransactionReference(finalPaidAtMs),
      paymentMethod: cleanStr(method, 40) || "dummy",
      updatedAt: serverTimestamp(),
    });
    settledPayment = {
      ...payment,
      status: PAYMENT_STATUSES.PAID,
      paidAtMs: finalPaidAtMs,
    };
  });

  if (settledPayment) {
    const title = "Payment received";
    const body = `${settledPayment.paymentLabel} ${formatMoneyText(
      settledPayment.amount,
      settledPayment.currency
    )} paid.`;
    await Promise.allSettled([
      safeNotifyAdminForRequest(cleanRequestId, requestData, {
        type: "PAYMENT_RECEIVED",
        notificationId: `payment_received_${cleanRequestId}_${cleanPaymentId}_admin`,
        extras: {
          paymentId: cleanPaymentId,
          paymentType: settledPayment.paymentType,
          paymentLabel: settledPayment.paymentLabel,
          amount: settledPayment.amount,
          currency: settledPayment.currency,
          title,
          body,
          route: requestRoutePath(cleanRequestId, "admin"),
        },
      }),
      safeCreateStaffNotification({
        uid:
          requestAssignedStaffUidFromData(requestData) || settledPayment.createdByStaffUid,
        requestId: cleanRequestId,
        type: "PAYMENT_RECEIVED",
        notificationId: `payment_received_${cleanRequestId}_${cleanPaymentId}_staff`,
        extras: {
          paymentId: cleanPaymentId,
          paymentType: settledPayment.paymentType,
          paymentLabel: settledPayment.paymentLabel,
          amount: settledPayment.amount,
          currency: settledPayment.currency,
          title,
          body,
          route: requestRoutePath(cleanRequestId, "staff"),
        },
      }),
      safeCreateUserNotification({
        uid: settledPayment.requestUid,
        requestId: cleanRequestId,
        type: "PAYMENT_RECEIVED",
        notificationId: `payment_received_${cleanRequestId}_${cleanPaymentId}_user`,
        extras: {
          paymentId: cleanPaymentId,
          paymentType: settledPayment.paymentType,
          paymentLabel: settledPayment.paymentLabel,
          amount: settledPayment.amount,
          currency: settledPayment.currency,
          title,
          body,
          route: requestRoutePath(cleanRequestId, "user"),
        },
      }),
    ]);
  }

  return true;
}

export async function createRefundRequest({
  requestId,
  paymentId,
  userReason,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  const cleanPaymentId = cleanStr(paymentId, 180);
  if (!cleanRequestId || !cleanPaymentId) throw new Error("Missing payment details.");
  const actorUid = requireActorUid();
  const reason = cleanStr(userReason, 2000);
  if (!reason) throw new Error("Refund reason is required.");

  const reqSnap = await getDoc(doc(db, "serviceRequests", cleanRequestId));
  if (!reqSnap.exists()) throw new Error("Request not found.");
  const reqData = reqSnap.data() || {};
  if (cleanStr(reqData.uid, 160) !== actorUid) {
    throw new Error("You can only refund your own request payments.");
  }

  const paySnap = await getDoc(paymentDocRef(cleanRequestId, cleanPaymentId));
  if (!paySnap.exists()) throw new Error("Payment not found.");
  const payment = normalizePaymentDoc({ id: paySnap.id, ...paySnap.data() });
  if (cleanStr(payment.requestId, 180) !== cleanRequestId) {
    throw new Error("Payment reference mismatch for this request.");
  }
  if (payment.paymentType === PAYMENT_TYPES.UNLOCK_REQUEST) {
    throw new Error(
      "Unlock request payment is not manually refundable. It only auto-refunds after 48 hours if work has not started."
    );
  }
  if (
    payment.status !== PAYMENT_STATUSES.PAID &&
    payment.status !== PAYMENT_STATUSES.AWAITING_USER_PAYMENT
  ) {
    throw new Error("This payment is not eligible for refund request.");
  }

  const priorQ = query(refundsCol(cleanRequestId), where("paymentId", "==", cleanPaymentId), limit(20));
  const priorSnap = await getDocs(priorQ);
  const hasPendingOrDone = priorSnap.docs.some((row) => {
    const status = cleanStr(row.data()?.status, 40).toLowerCase();
    return (
      status === REFUND_STATUSES.PENDING ||
      status === REFUND_STATUSES.APPROVED ||
      status === REFUND_STATUSES.REFUNDED ||
      status === REFUND_STATUSES.AUTO_REFUNDED
    );
  });
  if (hasPendingOrDone) {
    throw new Error("A refund request already exists for this payment.");
  }

  const nowMs = Date.now();
  const refundRef = doc(refundsCol(cleanRequestId));
  const payload = {
    refundId: refundRef.id,
    requestId: cleanRequestId,
    paymentId: cleanPaymentId,
    paymentType: payment.paymentType,
    paymentLabel: payment.paymentLabel,
    amount: payment.amount,
    currency: payment.currency,
    uid: actorUid,
    status: REFUND_STATUSES.PENDING,
    userReason: reason,
    adminExplanation: "",
    expectedRefundPeriodText: "",
    rejectionReason: "",
    autoGenerated: false,
    createdAt: serverTimestamp(),
    createdAtMs: nowMs,
    decisionAt: null,
    decisionAtMs: 0,
    decidedByAdminUid: "",
    updatedAt: serverTimestamp(),
  };

  await setDoc(refundRef, payload);
  await Promise.allSettled([
    safeNotifyAdminForRequest(cleanRequestId, reqData, {
      type: "REFUND_REQUESTED",
      notificationId: `refund_requested_${cleanRequestId}_${refundRef.id}_admin`,
      extras: {
        refundId: refundRef.id,
        paymentId: cleanPaymentId,
        paymentType: payment.paymentType,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        title: "Refund requested",
        body: `${payment.paymentLabel} ${formatMoneyText(payment.amount, payment.currency)} refund requested.`,
        route: requestRoutePath(cleanRequestId, "admin"),
      },
    }),
    safeCreateStaffNotification({
      uid: requestAssignedStaffUidFromData(reqData),
      requestId: cleanRequestId,
      type: "REFUND_REQUESTED",
      notificationId: `refund_requested_${cleanRequestId}_${refundRef.id}_staff`,
      extras: {
        refundId: refundRef.id,
        paymentId: cleanPaymentId,
        paymentType: payment.paymentType,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        title: "Refund requested",
        body: `${payment.paymentLabel} ${formatMoneyText(payment.amount, payment.currency)} refund requested.`,
        route: requestRoutePath(cleanRequestId, "staff"),
      },
    }),
  ]);
  return { id: refundRef.id, ...payload };
}

export async function adminApproveRefund({
  requestId,
  refundId,
  adminExplanation,
  expectedRefundPeriodText,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  const cleanRefundId = cleanStr(refundId, 180);
  if (!cleanRequestId || !cleanRefundId) throw new Error("Missing refund details.");
  const actorUid = requireActorUid();
  const explanation = cleanStr(adminExplanation, 2000);
  const expected = cleanStr(expectedRefundPeriodText, 300);
  if (!explanation) throw new Error("Approval explanation is required.");
  if (!expected) throw new Error("Expected refund period text is required.");
  const requestSnap = await getDoc(doc(db, "serviceRequests", cleanRequestId));
  const requestData = requestSnap.exists() ? requestSnap.data() || {} : {};
  let settledRefund = null;
  let settledPayment = null;

  const nowMs = Date.now();
  await runTransaction(db, async (tx) => {
    const refundRef = refundDocRef(cleanRequestId, cleanRefundId);
    const refundSnap = await tx.get(refundRef);
    if (!refundSnap.exists()) throw new Error("Refund request not found.");
    const refund = normalizeRefundDoc({ id: refundSnap.id, ...refundSnap.data() });
    const links = requireRefundLinks(refund, cleanRequestId);
    if (refund.status !== REFUND_STATUSES.PENDING) {
      throw new Error("Refund request already decided.");
    }

    const payRef = paymentDocRef(cleanRequestId, links.paymentId);
    const paySnap = await tx.get(payRef);
    if (!paySnap.exists()) throw new Error("Target payment not found.");
    const payment = normalizePaymentDoc({ id: paySnap.id, ...paySnap.data() });
    if (cleanStr(payment.requestId, 180) !== cleanRequestId) {
      throw new Error("Target payment is not linked to this request.");
    }
    settledRefund = refund;
    settledPayment = payment;

    tx.update(refundRef, {
      refundId: links.refundId,
      requestId: links.requestId,
      paymentId: links.paymentId,
      status: REFUND_STATUSES.REFUNDED,
      adminExplanation: explanation,
      expectedRefundPeriodText: expected,
      rejectionReason: "",
      decisionAt: serverTimestamp(),
      decisionAtMs: nowMs,
      decidedByAdminUid: actorUid,
      updatedAt: serverTimestamp(),
    });

    tx.update(payRef, {
      status: PAYMENT_STATUSES.REFUNDED,
      refundedAt: serverTimestamp(),
      refundedAtMs: nowMs,
      refundReason: explanation,
      refundExpectedPeriodText: expected,
      updatedAt: serverTimestamp(),
    });

    if (payment.paymentType === PAYMENT_TYPES.UNLOCK_REQUEST) {
      tx.set(
        doc(db, "serviceRequests", cleanRequestId),
        {
          unlockPaymentRefundedAtMs: nowMs,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  if (settledRefund && settledPayment) {
    await safeCreateUserNotification({
      uid: settledRefund.uid,
      requestId: cleanRequestId,
      type: "REFUND_COMPLETED",
      notificationId: `refund_completed_${cleanRequestId}_${cleanRefundId}`,
      extras: {
        refundId: cleanRefundId,
        paymentId: settledRefund.paymentId,
        paymentType: settledPayment.paymentType,
        paymentLabel: settledPayment.paymentLabel,
        amount: settledPayment.amount,
        currency: settledPayment.currency,
        title: "Refund completed",
        body: `${settledPayment.paymentLabel} ${formatMoneyText(
          settledPayment.amount,
          settledPayment.currency
        )} refunded.`,
        route: requestRoutePath(cleanRequestId, "user"),
        adminExplanation: explanation,
        expectedRefundPeriodText: expected,
      },
    });
    await Promise.allSettled([
      safeNotifyAdminForRequest(cleanRequestId, requestData, {
        type: "REFUND_COMPLETED",
        notificationId: `refund_completed_${cleanRequestId}_${cleanRefundId}_admin`,
        extras: {
          refundId: cleanRefundId,
          paymentId: settledRefund.paymentId,
          paymentType: settledPayment.paymentType,
          paymentLabel: settledPayment.paymentLabel,
          amount: settledPayment.amount,
          currency: settledPayment.currency,
          title: "Refund completed",
          body: `${settledPayment.paymentLabel} ${formatMoneyText(
            settledPayment.amount,
            settledPayment.currency
          )} refunded.`,
          route: requestRoutePath(cleanRequestId, "admin"),
        },
      }),
      safeCreateStaffNotification({
        uid: requestAssignedStaffUidFromData(requestData),
        requestId: cleanRequestId,
        type: "REFUND_COMPLETED",
        notificationId: `refund_completed_${cleanRequestId}_${cleanRefundId}_staff`,
        extras: {
          refundId: cleanRefundId,
          paymentId: settledRefund.paymentId,
          paymentType: settledPayment.paymentType,
          paymentLabel: settledPayment.paymentLabel,
          amount: settledPayment.amount,
          currency: settledPayment.currency,
          title: "Refund completed",
          body: `${settledPayment.paymentLabel} ${formatMoneyText(
            settledPayment.amount,
            settledPayment.currency
          )} refunded.`,
          route: requestRoutePath(cleanRequestId, "staff"),
        },
      }),
    ]);
  }

  return true;
}

export async function adminRejectRefund({
  requestId,
  refundId,
  rejectionReason,
} = {}) {
  const cleanRequestId = cleanStr(requestId, 180);
  const cleanRefundId = cleanStr(refundId, 180);
  if (!cleanRequestId || !cleanRefundId) throw new Error("Missing refund details.");
  const actorUid = requireActorUid();
  const reason = cleanStr(rejectionReason, 2000);
  if (!reason) throw new Error("Rejection explanation is required.");
  const nowMs = Date.now();
  let settledRefund = null;
  let settledPayment = null;

  await runTransaction(db, async (tx) => {
    const refundRef = refundDocRef(cleanRequestId, cleanRefundId);
    const refundSnap = await tx.get(refundRef);
    if (!refundSnap.exists()) throw new Error("Refund request not found.");
    const refund = normalizeRefundDoc({ id: refundSnap.id, ...refundSnap.data() });
    const links = requireRefundLinks(refund, cleanRequestId);
    if (refund.status !== REFUND_STATUSES.PENDING) {
      throw new Error("Refund request already decided.");
    }
    settledRefund = refund;

    const payRef = paymentDocRef(cleanRequestId, links.paymentId);
    const paySnap = await tx.get(payRef);
    if (!paySnap.exists()) throw new Error("Target payment not found.");
    settledPayment = normalizePaymentDoc({ id: paySnap.id, ...paySnap.data() });

    tx.update(refundRef, {
      refundId: links.refundId,
      requestId: links.requestId,
      paymentId: links.paymentId,
      status: REFUND_STATUSES.REJECTED,
      rejectionReason: reason,
      adminExplanation: "",
      decisionAt: serverTimestamp(),
      decisionAtMs: nowMs,
      decidedByAdminUid: actorUid,
      updatedAt: serverTimestamp(),
    });
  });
  if (settledRefund && settledPayment) {
    await safeCreateUserNotification({
      uid: settledRefund.uid,
      requestId: cleanRequestId,
      type: "REFUND_REJECTED",
      notificationId: `refund_rejected_${cleanRequestId}_${cleanRefundId}`,
      extras: {
        refundId: cleanRefundId,
        paymentId: settledRefund.paymentId,
        paymentType: settledPayment.paymentType,
        paymentLabel: settledPayment.paymentLabel,
        amount: settledPayment.amount,
        currency: settledPayment.currency,
        title: "Refund rejected",
        body: `${settledPayment.paymentLabel} refund rejected.`,
        route: requestRoutePath(cleanRequestId, "user"),
        rejectionReason: reason,
      },
    });
  }
  return true;
}

export async function ensureUnlockAutoRefundForRequest(requestId) {
  const cleanRequestId = cleanStr(requestId, 180);
  if (!cleanRequestId) return 0;

  const reqRef = doc(db, "serviceRequests", cleanRequestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) return 0;
  const reqData = reqSnap.data() || {};

  const payQ = query(
    paymentsCol(cleanRequestId),
    where("paymentType", "==", PAYMENT_TYPES.UNLOCK_REQUEST),
    limit(10)
  );
  const paySnap = await getDocs(payQ);
  if (paySnap.empty) return 0;

  let applied = 0;
  const nowMs = Date.now();
  const appliedRows = [];

  for (const row of paySnap.docs) {
    const payment = normalizePaymentDoc({ id: row.id, ...row.data() });
    if (!isUnlockPaymentAutoRefundEligible({ payment, requestData: reqData, nowMs })) {
      continue;
    }

    await runTransaction(db, async (tx) => {
      const latestReq = await tx.get(reqRef);
      if (!latestReq.exists()) return;
      const latestReqData = latestReq.data() || {};

      const payRef = paymentDocRef(cleanRequestId, row.id);
      const latestPay = await tx.get(payRef);
      if (!latestPay.exists()) return;
      const payData = normalizePaymentDoc({ id: latestPay.id, ...latestPay.data() });

      if (!isUnlockPaymentAutoRefundEligible({ payment: payData, requestData: latestReqData, nowMs })) {
        return;
      }

      const ownerUid = cleanStr(latestReqData.uid, 160);
      const refundRef = refundDocRef(cleanRequestId, `auto_${row.id}`);
      const refundSnap = await tx.get(refundRef);
      if (!refundSnap.exists()) {
        tx.set(refundRef, {
          refundId: `auto_${row.id}`,
          requestId: cleanRequestId,
          paymentId: row.id,
          paymentType: payData.paymentType,
          paymentLabel: payData.paymentLabel,
          amount: payData.amount,
          currency: payData.currency,
          uid: ownerUid,
          status: REFUND_STATUSES.AUTO_REFUNDED,
          userReason: "Auto-refund: staff had not started work within 48 hours.",
          adminExplanation: "Auto-refund applied by system rule.",
          expectedRefundPeriodText: "Auto-refunded in showcase mode.",
          rejectionReason: "",
          autoGenerated: true,
          createdAt: serverTimestamp(),
          createdAtMs: nowMs,
          decisionAt: serverTimestamp(),
          decisionAtMs: nowMs,
          decidedByAdminUid: "system",
          updatedAt: serverTimestamp(),
        });
      }

      tx.update(payRef, {
        status: PAYMENT_STATUSES.AUTO_REFUNDED,
        refundedAt: serverTimestamp(),
        refundedAtMs: nowMs,
        refundReason: "Auto-refund after 48 hours without staff starting work.",
        updatedAt: serverTimestamp(),
      });
    });

    appliedRows.push({
      requestId: cleanRequestId,
      requestUid: cleanStr(reqData.uid, 160),
      paymentId: row.id,
      paymentLabel: payment.paymentLabel,
      paymentType: payment.paymentType,
      amount: payment.amount,
      currency: payment.currency,
    });
    applied += 1;
  }

  await Promise.allSettled(
    appliedRows.flatMap((row) => [
      safeCreateUserNotification({
        uid: row.requestUid,
        requestId: row.requestId,
        type: "REFUND_COMPLETED",
        notificationId: `refund_completed_auto_${row.requestId}_${row.paymentId}`,
        extras: {
          refundId: `auto_${row.paymentId}`,
          paymentId: row.paymentId,
          paymentType: row.paymentType,
          paymentLabel: row.paymentLabel,
          amount: row.amount,
          currency: row.currency,
          title: "Refund completed",
          body: `${row.paymentLabel} ${formatMoneyText(row.amount, row.currency)} refunded.`,
          route: requestRoutePath(row.requestId, "user"),
        },
      }),
      safeNotifyAdminForRequest(cleanRequestId, reqData, {
        type: "REFUND_COMPLETED",
        notificationId: `refund_completed_auto_${row.requestId}_${row.paymentId}_admin`,
        extras: {
          refundId: `auto_${row.paymentId}`,
          paymentId: row.paymentId,
          paymentType: row.paymentType,
          paymentLabel: row.paymentLabel,
          amount: row.amount,
          currency: row.currency,
          title: "Refund completed",
          body: `${row.paymentLabel} ${formatMoneyText(row.amount, row.currency)} refunded.`,
          route: requestRoutePath(row.requestId, "admin"),
        },
      }),
    ])
  );

  return applied;
}

export async function listUnlockAutoRefundEligibleRequests({ requestIds = [] } = {}) {
  const ids = Array.from(new Set((requestIds || []).map((id) => cleanStr(id, 180)).filter(Boolean)));
  const rows = [];

  for (const requestId of ids) {
    const reqSnap = await getDoc(doc(db, "serviceRequests", requestId));
    if (!reqSnap.exists()) continue;
    const reqData = reqSnap.data() || {};
    const paySnap = await getDocs(
      query(
        paymentsCol(requestId),
        where("paymentType", "==", PAYMENT_TYPES.UNLOCK_REQUEST),
        limit(10)
      )
    );
    paySnap.docs.forEach((row) => {
      const payment = normalizePaymentDoc({ id: row.id, ...row.data() });
      if (!isUnlockPaymentAutoRefundEligible({ payment, requestData: reqData })) return;
      rows.push({
        requestId,
        paymentId: payment.id,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        paidAtMs: payment.paidAtMs,
      });
    });
  }

  rows.sort((a, b) => Number(a.paidAtMs || 0) - Number(b.paidAtMs || 0));
  return rows;
}

export async function applyUnlockAutoRefundSweep({ requestIds = [] } = {}) {
  const ids = Array.from(new Set((requestIds || []).map((id) => cleanStr(id, 180)).filter(Boolean)));
  let applied = 0;
  for (const requestId of ids) {
    applied += Number(await ensureUnlockAutoRefundForRequest(requestId)) || 0;
  }
  return applied;
}

import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { sendPushForNotificationDoc } from "./pushServerClient";

function safeStr(value) {
  return String(value || "").trim();
}

function formatAmount(amount, currency = "KES") {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${safeStr(currency || "KES").toUpperCase()} ${value.toLocaleString()}`;
}

function routeForScope(scope, requestId, { openChat = false } = {}) {
  const rid = safeStr(requestId);
  const suffix = openChat ? "?openChat=1" : "";
  const normalizedScope = safeStr(scope).toLowerCase();

  if (normalizedScope === "staff") {
    return rid ? `/staff/request/${encodeURIComponent(rid)}${suffix}` : "/staff/tasks";
  }
  if (normalizedScope === "admin" || normalizedScope === "assignedadmin") {
    return rid ? `/app/admin/request/${encodeURIComponent(rid)}${suffix}` : "/app/admin";
  }
  return rid ? `/app/request/${encodeURIComponent(rid)}${suffix}` : "/app/progress";
}

function buildNotificationCopy(type, requestId, scope, extras = {}) {
  const notifType = safeStr(type).toUpperCase();
  const amountText = formatAmount(extras.amount, extras.currency);
  const paymentLabel = safeStr(extras.paymentLabel || extras.label || "Payment");

  switch (notifType) {
    case "REQUEST_ASSIGNED":
      return {
        title: "Request update",
        body: "Your request is being worked on.",
        route: routeForScope(scope, requestId),
      };
    case "REQUEST_ACCEPTED":
      return {
        title: "Request accepted",
        body: "Your request has been accepted.",
        route: routeForScope(scope, requestId),
      };
    case "REQUEST_REJECTED":
      return {
        title: "Request rejected",
        body: "Your request has been rejected.",
        route: routeForScope(scope, requestId),
      };
    case "NEW_MESSAGE":
    case "STAFF_NEW_MESSAGE":
      return {
        title: "New message",
        body: "You have a new message.",
        route: routeForScope(scope, requestId, { openChat: true }),
      };
    case "MESSAGE_REJECTED_USER":
    case "STAFF_MESSAGE_REJECTED":
      return {
        title: "Message rejected",
        body: "A message was rejected by admin.",
        route: routeForScope(scope, requestId, { openChat: true }),
      };
    case "STAFF_ASSIGNED_REQUEST":
      return {
        title: "New assignment",
        body: "You have been assigned a request.",
        route: routeForScope("staff", requestId),
      };
    case "STAFF_UNASSIGNED_REQUEST":
      return {
        title: "Assignment removed",
        body: "A request was removed from your queue.",
        route: routeForScope("staff", requestId),
      };
    case "STAFF_REQUEST_EXPIRING_SOON":
      return {
        title: "Action needed soon",
        body: "A request is close to reassignment timeout.",
        route: requestId
          ? `/staff/request/${encodeURIComponent(safeStr(requestId))}/start`
          : "/staff/tasks",
      };
    case "STAFF_REQUEST_ACCEPTED_BY_ADMIN":
      return {
        title: "Request finalized",
        body: "Admin accepted this request.",
        route: routeForScope("staff", requestId),
      };
    case "STAFF_REQUEST_REJECTED_BY_ADMIN":
      return {
        title: "Request finalized",
        body: "Admin rejected this request.",
        route: routeForScope("staff", requestId),
      };
    case "PAYMENT_UPDATE":
      return {
        title: "Payment update",
        body: amountText ? `${paymentLabel} ${amountText}.` : "There is an update on a payment.",
        route: routeForScope(scope, requestId),
      };
    case "PAYMENT_REQUIRED":
      return {
        title: "Payment required",
        body: amountText ? `${paymentLabel} ${amountText} ready for payment.` : "A payment is ready for your action.",
        route: routeForScope(scope, requestId),
      };
    case "PAYMENT_RECEIVED":
      return {
        title: "Payment received",
        body: amountText ? `${paymentLabel} ${amountText} paid.` : "A payment has been received.",
        route: routeForScope(scope, requestId),
      };
    case "REFUND_REQUESTED":
      return {
        title: "Refund requested",
        body: amountText ? `${paymentLabel} ${amountText} refund requested.` : "A refund has been requested.",
        route: routeForScope(scope, requestId),
      };
    case "REFUND_APPROVED":
      return {
        title: "Refund approved",
        body: amountText ? `${paymentLabel} ${amountText} refund approved.` : "A refund has been approved.",
        route: routeForScope(scope, requestId),
      };
    case "REFUND_COMPLETED":
      return {
        title: "Refund completed",
        body: amountText ? `${paymentLabel} ${amountText} refunded.` : "A refund has been completed.",
        route: routeForScope(scope, requestId),
      };
    case "REFUND_REJECTED":
      return {
        title: "Refund rejected",
        body: paymentLabel ? `${paymentLabel} refund rejected.` : "A refund was rejected.",
        route: routeForScope(scope, requestId),
      };
    default:
      return {
        title: "Notification",
        body: "You have an update.",
        route: routeForScope(scope, requestId),
      };
  }
}

async function createNotificationDoc({
  scope,
  uid,
  type,
  requestId,
  extras = {},
  notificationId = "",
} = {}) {
  const targetUid = safeStr(uid);
  const notifType = safeStr(type).toUpperCase();
  const rid = safeStr(requestId);
  const normalizedScope = safeStr(scope).toLowerCase();
  if (!targetUid || !notifType) return null;

  const copy = buildNotificationCopy(notifType, rid, normalizedScope, extras);
  const actorUid = safeStr(auth.currentUser?.uid);
  const rootCollection = normalizedScope === "staff" ? "staff" : "users";
  const colRef = collection(db, rootCollection, targetUid, "notifications");
  const route = safeStr(extras.route || copy.route);

  const payload = {
    type: notifType,
    role: normalizedScope === "assignedadmin" ? "admin" : normalizedScope,
    uid: targetUid,
    requestId: rid || null,
    paymentId: safeStr(extras.paymentId) || null,
    refundId: safeStr(extras.refundId) || null,
    title: safeStr(extras.title || copy.title),
    body: safeStr(extras.body || copy.body),
    route,
    readAt: null,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    createdBy: actorUid || null,
    ...extras,
  };

  delete payload.notificationId;

  const fixedId = safeStr(notificationId || extras.notificationId);
  let id = "";
  if (fixedId) {
    await setDoc(doc(colRef, fixedId), payload, { merge: true });
    id = fixedId;
  } else {
    const ref = await addDoc(colRef, payload);
    id = ref.id;
  }

  const row = { id, ...payload };

  try {
    await sendPushForNotificationDoc({
      scope: normalizedScope,
      uid: targetUid,
      notification: row,
    });
  } catch (error) {
    console.warn("Failed to trigger push for notification doc:", error?.message || error);
  }

  return row;
}

export async function createUserNotification({ uid, type, requestId, extras, notificationId } = {}) {
  return createNotificationDoc({
    scope: "user",
    uid,
    type,
    requestId,
    extras,
    notificationId,
  });
}

export async function createStaffNotification({ uid, type, requestId, extras, notificationId } = {}) {
  return createNotificationDoc({
    scope: "staff",
    uid,
    type,
    requestId,
    extras,
    notificationId,
  });
}

export async function createAdminNotification({ uid, type, requestId, extras, notificationId } = {}) {
  return createNotificationDoc({
    scope: "admin",
    uid,
    type,
    requestId,
    extras,
    notificationId,
  });
}

export function notificationRouteForType(type, requestId, scope = "user", extras = {}) {
  return buildNotificationCopy(type, requestId, scope, extras)?.route || "";
}

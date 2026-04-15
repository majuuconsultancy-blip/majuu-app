import { getFunctions, httpsCallable } from "firebase/functions";

function safeStr(value) {
  return String(value || "").trim();
}

const functions = getFunctions(undefined, "us-central1");

function normalizeScope(scope) {
  const safeScope = safeStr(scope).toLowerCase();
  if (safeScope === "staff") return "staff";
  if (safeScope === "admin" || safeScope === "assignedadmin") return "admin";
  return "user";
}

function formatNotificationCallableError(error, callableName = "") {
  const code = safeStr(error?.code).toLowerCase();
  const message = safeStr(error?.message).toLowerCase();
  const isInfraError =
    code.includes("functions/internal") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/unimplemented") ||
    code.includes("functions/deadline-exceeded") ||
    (code.includes("internal") && !message.includes("permission")) ||
    message === "internal";

  const label = safeStr(callableName) || "Notification service";
  const wrapped = new Error(
    isInfraError
      ? `${label} is not available right now. Deploy Cloud Functions and retry (Firebase Blaze plan is required).`
      : safeStr(error?.message) || "Notification request failed. Please try again."
  );
  wrapped.code = code;
  wrapped.isInfrastructureUnavailable = isInfraError;
  return wrapped;
}

function callNotificationFunction(name, payload = {}) {
  const callable = httpsCallable(functions, name);
  return callable(payload)
    .then((result) => result?.data ?? null)
    .catch((error) => {
      throw formatNotificationCallableError(error, name);
    });
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
    case "REQUEST_IN_PROGRESS":
    case "REQUEST_STARTED":
      return {
        title: "Request in progress",
        body: "Work has started on your request.",
        route: routeForScope(scope, requestId),
      };
    case "REQUEST_PUT_IN_PROGRESS":
    case "SUPER_ADMIN_REQUEST_PUT_IN_PROGRESS":
      return {
        title: "Request in progress",
        body: "A request moved to in-progress status.",
        route: routeForScope("admin", requestId),
      };
    case "NEW_REQUEST":
    case "SUPER_ADMIN_NEW_REQUEST":
      return {
        title: "New request",
        body: "A new request was routed to the queue.",
        route: routeForScope("admin", requestId),
      };
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
    case "REQUEST_DENIED":
      return {
        title: "Request rejected",
        body: "Your request has been rejected.",
        route: routeForScope(scope, requestId),
      };
    case "NEW_MESSAGE":
    case "STAFF_NEW_MESSAGE":
    case "ADMIN_NEW_MESSAGE":
    case "ADMIN_NEW_MESSAGE_FROM_USER":
    case "ADMIN_NEW_MESSAGE_FROM_STAFF":
    case "SUPER_ADMIN_NEW_MESSAGE":
    case "SUPER_ADMIN_NEW_MESSAGE_FROM_USER":
    case "SUPER_ADMIN_NEW_MESSAGE_FROM_STAFF":
      return {
        title: "New message",
        body: "You have a new message.",
        route: routeForScope(scope === "admin" ? "admin" : scope, requestId, { openChat: true }),
      };
    case "NEW_DOCUMENT":
    case "STAFF_NEW_DOCUMENT":
    case "ADMIN_NEW_DOCUMENT":
    case "ADMIN_NEW_DOCUMENT_FROM_USER":
    case "ADMIN_NEW_DOCUMENT_FROM_STAFF":
    case "SUPER_ADMIN_NEW_DOCUMENT":
    case "SUPER_ADMIN_NEW_DOCUMENT_FROM_USER":
    case "SUPER_ADMIN_NEW_DOCUMENT_FROM_STAFF":
      return {
        title: "New document",
        body: "A new document was shared.",
        route: routeForScope(scope === "admin" ? "admin" : scope, requestId, { openChat: true }),
      };
    case "NEW_PHOTO":
    case "STAFF_NEW_PHOTO":
    case "ADMIN_NEW_PHOTO":
    case "ADMIN_NEW_PHOTO_FROM_USER":
    case "ADMIN_NEW_PHOTO_FROM_STAFF":
    case "SUPER_ADMIN_NEW_PHOTO":
    case "SUPER_ADMIN_NEW_PHOTO_FROM_USER":
    case "SUPER_ADMIN_NEW_PHOTO_FROM_STAFF":
      return {
        title: "New photo",
        body: "A new photo was shared.",
        route: routeForScope(scope === "admin" ? "admin" : scope, requestId, { openChat: true }),
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
        route: requestId
          ? `/staff/request/${encodeURIComponent(safeStr(requestId))}/start`
          : "/staff/tasks",
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
    case "PAYMENT_SUCCESSFUL":
      return {
        title: "Payment successful",
        body: amountText ? `${paymentLabel} ${amountText} was successful.` : "Payment successful.",
        route: routeForScope(scope, requestId),
      };
    case "PAYMENT_RECEIVED":
      return {
        title: "Payment received",
        body: amountText ? `${paymentLabel} ${amountText} paid.` : "A payment has been received.",
        route: routeForScope(scope, requestId),
      };
    case "IN_PROGRESS_PAYMENT_RECEIVED":
    case "SUPER_ADMIN_IN_PROGRESS_PAYMENT_RECEIVED":
      return {
        title: "In-progress payment received",
        body: amountText
          ? `${paymentLabel} ${amountText} was released and received.`
          : "An in-progress payment was released and received.",
        route: routeForScope("admin", requestId),
      };
    case "SUPER_ADMIN_USER_PAID_IN_PROGRESS_PAYMENT":
      return {
        title: "User paid in-progress payment",
        body: amountText
          ? `${paymentLabel} ${amountText} was paid and is awaiting release.`
          : "A user paid an in-progress payment and it is awaiting release.",
        route: routeForScope("admin", requestId),
      };
    case "SUPER_ADMIN_UNLOCK_REQUEST_PAYMENT_MADE":
      return {
        title: "Unlock request payment made",
        body: amountText
          ? `${paymentLabel} ${amountText} unlock payment was made.`
          : "An unlock request payment was made.",
        route: routeForScope("admin", requestId),
      };
    case "SUPER_ADMIN_UNLOCK_REQUEST_PAYMENT_REFUNDED":
      return {
        title: "Unlock request payment refunded",
        body: amountText
          ? `${paymentLabel} ${amountText} unlock payment was refunded.`
          : "An unlock request payment was refunded.",
        route: routeForScope("admin", requestId),
      };
    case "PROGRESS_UPDATED":
      return {
        title: "Progress updated",
        body: "There is a new progress update on your request.",
        route: routeForScope(scope, requestId),
      };
    case "REFUND_REQUESTED":
    case "SUPER_ADMIN_REFUND_REQUESTED":
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
    case "REQUEST_NEARING_AUTO_REFUND_DEADLINE":
    case "SUPER_ADMIN_REQUEST_NEARING_AUTO_REFUND_DEADLINE":
      return {
        title: "Request nearing auto refund deadline",
        body: "Unlock payment will auto-refund soon if not consumed.",
        route: routeForScope("admin", requestId),
      };
    case "PUSH_SUBSCRIPTION_EXPIRING_5_DAYS":
    case "SUPER_ADMIN_PUSH_SUBSCRIPTION_EXPIRING_5_DAYS":
      return {
        title: "Push subscription expiring in 5 days",
        body: "A partner push subscription is nearing expiry.",
        route: "/app/admin/sacc/push-campaigns",
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
  const normalizedScope = normalizeScope(scope);
  if (!targetUid || !notifType) return null;

  const safeExtras = extras && typeof extras === "object" ? extras : {};
  const copy = buildNotificationCopy(notifType, rid, normalizedScope, safeExtras);
  const route = safeStr(safeExtras.route || copy.route);
  const fixedId = safeStr(notificationId || safeExtras.notificationId);
  const payload = {
    ...safeExtras,
    title: safeStr(safeExtras.title || copy.title),
    body: safeStr(safeExtras.body || copy.body),
    route,
    paymentId: safeStr(safeExtras.paymentId) || null,
    refundId: safeStr(safeExtras.refundId) || null,
  };
  delete payload.notificationId;
  delete payload.uid;
  delete payload.scope;
  delete payload.role;
  delete payload.type;

  const result = await callNotificationFunction("createScopedNotification", {
    scope: normalizedScope,
    uid: targetUid,
    type: notifType,
    requestId: rid || null,
    notificationId: fixedId || undefined,
    extras: payload,
  });

  const id = safeStr(result?.notificationId || fixedId || `notif_${Date.now()}`);

  return {
    id,
    type: notifType,
    role: normalizedScope,
    uid: targetUid,
    requestId: rid || null,
    paymentId: safeStr(payload.paymentId) || null,
    refundId: safeStr(payload.refundId) || null,
    title: safeStr(payload.title || copy.title),
    body: safeStr(payload.body || copy.body),
    route,
    readAt: null,
    createdAtMs: Date.now(),
  };
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

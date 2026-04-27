import { FieldValue, db } from "./firebaseAdmin.js";

function safeString(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return safeString(value, max).toLowerCase();
}

function normalizeScope(scope = "") {
  const safeScope = lower(scope, 80);
  if (safeScope === "staff") return "staff";
  if (safeScope === "admin" || safeScope === "assignedadmin") return "admin";
  return "user";
}

function trimTrailingSlash(value = "") {
  return safeString(value, 2000).replace(/\/+$/, "");
}

function formatAmount(amount, currency = "KES") {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${safeString(currency || "KES", 12).toUpperCase()} ${value.toLocaleString()}`;
}

function routeForScope(scope, requestId, { openChat = false } = {}) {
  const rid = safeString(requestId, 180);
  const suffix = openChat ? "?openChat=1" : "";
  const normalizedScope = normalizeScope(scope);

  if (normalizedScope === "staff") {
    return rid ? `/staff/request/${encodeURIComponent(rid)}${suffix}` : "/staff/tasks";
  }
  if (normalizedScope === "admin") {
    return rid ? `/app/admin/request/${encodeURIComponent(rid)}${suffix}` : "/app/admin";
  }
  return rid ? `/app/request/${encodeURIComponent(rid)}${suffix}` : "/app/progress";
}

function buildNotificationCopy(type, requestId, scope, extras = {}) {
  const notifType = safeString(type, 120).toUpperCase();
  const amountText = formatAmount(extras.amount, extras.currency);
  const paymentLabel = safeString(extras.paymentLabel || extras.label || "Payment", 180);

  switch (notifType) {
    case "REQUEST_RECEIVED":
      return {
        title: "Request received",
        body: "Your request has been received by the admin team.",
        route: routeForScope(scope, requestId),
      };
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
        body: "A new service request was submitted.",
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
          ? `/staff/request/${encodeURIComponent(safeString(requestId, 180))}/start`
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
          ? `/staff/request/${encodeURIComponent(safeString(requestId, 180))}/start`
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
    case "PAYMENT_FAILED":
      return {
        title: "Payment failed",
        body: amountText ? `${paymentLabel} ${amountText} failed.` : "A payment attempt failed.",
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

function buildNotificationRef({ scope, uid, notificationId }) {
  const targetUid = safeString(uid, 180);
  const safeId = safeString(notificationId, 220);
  const normalizedScope = normalizeScope(scope);
  const root = normalizedScope === "staff" ? "staff" : "users";
  return db.collection(root).doc(targetUid).collection("notifications").doc(safeId);
}

async function writeNotificationDoc({
  scope,
  uid,
  type,
  requestId,
  extras = {},
  notificationId,
} = {}) {
  const targetUid = safeString(uid, 180);
  const notifType = safeString(type, 120).toUpperCase();
  const docId = safeString(notificationId, 220);
  const normalizedScope = normalizeScope(scope);
  if (!targetUid || !notifType || !docId) return null;

  const ref = buildNotificationRef({
    scope: normalizedScope,
    uid: targetUid,
    notificationId: docId,
  });
  const existingSnap = await ref.get();
  if (existingSnap.exists) {
    return {
      id: docId,
      existing: true,
      ...existingSnap.data(),
    };
  }

  const safeExtras = extras && typeof extras === "object" ? extras : {};
  const copy = buildNotificationCopy(notifType, requestId, normalizedScope, safeExtras);
  const route = safeString(safeExtras.route || copy.route, 1200);
  const payload = {
    ...safeExtras,
    title: safeString(safeExtras.title || copy.title, 240),
    body: safeString(safeExtras.body || copy.body, 2000),
    route,
    paymentId: safeString(safeExtras.paymentId, 180) || null,
    refundId: safeString(safeExtras.refundId, 180) || null,
  };
  delete payload.notificationId;
  delete payload.uid;
  delete payload.scope;
  delete payload.role;
  delete payload.type;

  await ref.set(
    {
      id: docId,
      type: notifType,
      role: normalizedScope,
      uid: targetUid,
      requestId: safeString(requestId, 180) || null,
      readAt: null,
      readAtMs: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
      ...payload,
    },
    { merge: true }
  );

  return {
    id: docId,
    existing: false,
    type: notifType,
    role: normalizedScope,
    uid: targetUid,
    requestId: safeString(requestId, 180) || null,
    paymentId: safeString(payload.paymentId, 180) || null,
    refundId: safeString(payload.refundId, 180) || null,
    title: safeString(payload.title, 240),
    body: safeString(payload.body, 2000),
    route,
  };
}

export async function sendPushForNotificationDoc({ scope, uid, notification } = {}) {
  const normalizedScope = normalizeScope(scope);
  const targetUid = safeString(uid || notification?.uid, 180);
  if (!targetUid) return { ok: false, skipped: true, reason: "missing_uid" };

  const baseUrl = trimTrailingSlash(
    process.env.PUSH_SERVER_URL || process.env.VITE_PUSH_SERVER_URL
  );
  if (!baseUrl) {
    return { ok: false, skipped: true, reason: "missing_push_server_url" };
  }

  const headers = { "content-type": "application/json" };
  const apiKey = safeString(
    process.env.PUSH_SERVER_API_KEY || process.env.VITE_PUSH_SERVER_API_KEY,
    400
  );
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const row = notification && typeof notification === "object" ? notification : {};
  const response = await fetch(`${baseUrl}/sendPush`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      toRole: normalizedScope,
      toUid: targetUid,
      title: safeString(row.title, 240) || "Notification",
      body: safeString(row.body, 2000) || "You have an update.",
      data: {
        type: safeString(row.type, 120),
        requestId: safeString(row.requestId, 180),
        paymentId: safeString(row.paymentId, 180),
        refundId: safeString(row.refundId, 180),
        route: safeString(row.route, 1200),
        notificationId: safeString(row.id, 220),
        role: normalizedScope,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Push server ${response.status}${text ? `: ${safeString(text, 240)}` : ""}`
    );
  }

  return { ok: true };
}

export function makeNotificationId(prefix, ...parts) {
  return [prefix, ...parts]
    .map((part) =>
      safeString(part, 120)
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 120)
    )
    .filter(Boolean)
    .join("_")
    .slice(0, 220);
}

export async function createNotificationAndPush({
  scope,
  uid,
  type,
  requestId,
  extras = {},
  notificationId,
} = {}) {
  const notification = await writeNotificationDoc({
    scope,
    uid,
    type,
    requestId,
    extras,
    notificationId,
  });

  if (!notification || notification.existing) {
    return notification;
  }

  try {
    await sendPushForNotificationDoc({
      scope: notification.role,
      uid: notification.uid,
      notification,
    });
  } catch (error) {
    console.warn("[notificationServer] push failed:", safeString(error?.message || error, 300));
  }

  return notification;
}

export async function createManyNotificationsAndPush(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const results = await Promise.allSettled(
    rows.map((row) => createNotificationAndPush(row))
  );
  return results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(Boolean);
}

export async function listSuperAdminUids({ excludeUids = [] } = {}) {
  const excluded = new Set(
    (Array.isArray(excludeUids) ? excludeUids : []).map((value) => safeString(value, 180)).filter(Boolean)
  );
  const roleVariants = ["superAdmin", "superadmin", "super_admin", "super-admin", "super admin"];
  const snap = await db
    .collection("users")
    .where("role", "in", roleVariants)
    .limit(60)
    .get()
    .catch(() => null);
  if (!snap?.docs?.length) return [];
  return snap.docs
    .map((docSnap) => safeString(docSnap.id, 180))
    .filter((uid) => uid && !excluded.has(uid));
}

export function resolveRequestAdminUids(requestData = {}, { excludeUids = [] } = {}) {
  const excluded = new Set(
    (Array.isArray(excludeUids) ? excludeUids : []).map((value) => safeString(value, 180)).filter(Boolean)
  );
  const seen = new Set();
  return [
    safeString(requestData?.ownerLockedAdminUid, 180),
    safeString(requestData?.currentAdminUid, 180),
    safeString(requestData?.assignedAdminId, 180),
  ].filter((uid) => {
    if (!uid || excluded.has(uid) || seen.has(uid)) return false;
    seen.add(uid);
    return true;
  });
}

export function chatMessageKind(message = {}) {
  const explicit = lower(message?.messageKind || message?.kind, 80);
  if (explicit === "message" || explicit === "document" || explicit === "photo") return explicit;

  const type = lower(message?.type || "text", 40);
  if (type === "text") return "message";
  if (type === "image" || type === "photo") return "photo";
  if (type === "document" || type === "pdf") return "document";

  const attachmentMeta =
    message?.attachmentMeta && typeof message.attachmentMeta === "object"
      ? message.attachmentMeta
      : message?.pdfMeta && typeof message.pdfMeta === "object"
      ? message.pdfMeta
      : null;
  const attachmentKind = lower(attachmentMeta?.attachmentKind || attachmentMeta?.kind, 40);
  if (attachmentKind === "photo" || attachmentKind === "image") return "photo";
  if (attachmentMeta) return "document";
  return "message";
}

export function chatNotificationTitleByKind(kind = "") {
  const safeKind = lower(kind, 40);
  if (safeKind === "photo") return "New photo";
  if (safeKind === "document") return "New document";
  return "New message";
}

export function chatNotificationTypeByKind(kind, role = "user", fromRole = "") {
  const safeKind = lower(kind, 40);
  const safeRole = lower(role, 40);
  const sender = lower(fromRole, 40);

  if (safeRole === "staff") {
    if (safeKind === "photo") return "STAFF_NEW_PHOTO";
    if (safeKind === "document") return "STAFF_NEW_DOCUMENT";
    return "STAFF_NEW_MESSAGE";
  }

  if (safeRole === "admin") {
    if (sender === "user") {
      if (safeKind === "photo") return "ADMIN_NEW_PHOTO_FROM_USER";
      if (safeKind === "document") return "ADMIN_NEW_DOCUMENT_FROM_USER";
      return "ADMIN_NEW_MESSAGE_FROM_USER";
    }
    if (sender === "staff") {
      if (safeKind === "photo") return "ADMIN_NEW_PHOTO_FROM_STAFF";
      if (safeKind === "document") return "ADMIN_NEW_DOCUMENT_FROM_STAFF";
      return "ADMIN_NEW_MESSAGE_FROM_STAFF";
    }
    if (safeKind === "photo") return "ADMIN_NEW_PHOTO";
    if (safeKind === "document") return "ADMIN_NEW_DOCUMENT";
    return "ADMIN_NEW_MESSAGE";
  }

  if (safeKind === "photo") return "NEW_PHOTO";
  if (safeKind === "document") return "NEW_DOCUMENT";
  return "NEW_MESSAGE";
}

export function chatNotificationBody(message = {}) {
  const kind = chatMessageKind(message);
  if (kind === "photo") return "A new photo was shared.";
  if (kind === "document") return "A new document was shared.";
  const text = safeString(message?.text, 120);
  return text || "You have a new message.";
}

export async function notifyPaymentParticipants({
  requestData = {},
  payment = {},
  type = "PAYMENT_UPDATE",
  title = "Payment update",
  body = "",
  refundId = "",
  notifyUser = true,
  userType = "",
  userTitle = "",
  userBody = "",
  notifyAdmins = true,
  adminType = "",
  adminTitle = "",
  adminBody = "",
  notifySuperAdmins = false,
  superAdminType = "",
  superAdminTitle = "",
  superAdminBody = "",
  notifyStaff = true,
  staffType = "",
  staffTitle = "",
  staffBody = "",
} = {}) {
  const requestId = safeString(requestData?.id || payment?.requestId, 180);
  const paymentId = safeString(payment?.id || payment?.paymentId, 180);
  const userUid = safeString(requestData?.uid || payment?.requestUid, 180);
  const adminUids = resolveRequestAdminUids(requestData);
  const staffUid = safeString(requestData?.assignedTo || payment?.createdByStaffUid, 180);
  const amount = Number(payment?.amount || 0) || 0;
  const currency = safeString(payment?.currency || "KES", 12).toUpperCase() || "KES";
  const paymentLabel = safeString(payment?.paymentLabel || payment?.label, 180);

  const items = [];
  if (notifyUser && userUid) {
    items.push({
      scope: "user",
      uid: userUid,
      type: safeString(userType || type, 120).toUpperCase() || "PAYMENT_UPDATE",
      requestId,
      notificationId: makeNotificationId(
        "finance_user",
        userType || type,
        requestId,
        paymentId,
        refundId || "x"
      ),
      extras: {
        paymentId,
        refundId,
        amount,
        currency,
        paymentLabel,
        title: userTitle || title,
        body: userBody || body,
      },
    });
  }
  if (notifyAdmins) {
    adminUids.forEach((uid) => {
      items.push({
        scope: "admin",
        uid,
        type: safeString(adminType || type, 120).toUpperCase() || "PAYMENT_UPDATE",
        requestId,
        notificationId: makeNotificationId(
          "finance_admin",
          adminType || type,
          requestId,
          paymentId,
          refundId || "x",
          uid
        ),
        extras: {
          paymentId,
          refundId,
          amount,
          currency,
          paymentLabel,
          title: adminTitle || title,
          body: adminBody || body,
        },
      });
    });
  }
  if (notifySuperAdmins) {
    const superAdminUids = await listSuperAdminUids({
      excludeUids: notifyAdmins ? adminUids : [],
    });
    superAdminUids.forEach((uid) => {
      items.push({
        scope: "admin",
        uid,
        type:
          safeString(superAdminType || type, 120).toUpperCase() || "PAYMENT_UPDATE",
        requestId,
        notificationId: makeNotificationId(
          "finance_super_admin",
          superAdminType || type,
          requestId,
          paymentId,
          refundId || "x",
          uid
        ),
        extras: {
          paymentId,
          refundId,
          amount,
          currency,
          paymentLabel,
          title: superAdminTitle || title,
          body: superAdminBody || body,
        },
      });
    });
  }
  if (notifyStaff && staffUid) {
    items.push({
      scope: "staff",
      uid: staffUid,
      type: safeString(staffType || type, 120).toUpperCase() || "PAYMENT_UPDATE",
      requestId,
      notificationId: makeNotificationId(
        "finance_staff",
        staffType || type,
        requestId,
        paymentId,
        refundId || "x"
      ),
      extras: {
        paymentId,
        refundId,
        amount,
        currency,
        paymentLabel,
        title: staffTitle || title,
        body: staffBody || body,
      },
    });
  }

  return createManyNotificationsAndPush(items);
}

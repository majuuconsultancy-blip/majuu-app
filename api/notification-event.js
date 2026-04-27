import { admin, db } from "./_lib/firebaseAdmin.js";
import { getBearerToken, handleCors, json, methodNotAllowed, readJsonBody } from "./_lib/http.js";
import {
  chatMessageKind,
  chatNotificationBody,
  chatNotificationTitleByKind,
  chatNotificationTypeByKind,
  createManyNotificationsAndPush,
  listSuperAdminUids,
  makeNotificationId,
  resolveRequestAdminUids,
} from "./_lib/notificationServer.js";

function safeString(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return safeString(value, max).toLowerCase();
}

function normalizeRole(role = "") {
  const safeRole = lower(role, 80);
  if (
    safeRole === "superadmin" ||
    safeRole === "super_admin" ||
    safeRole === "super-admin" ||
    safeRole === "super admin"
  ) {
    return "superAdmin";
  }
  if (
    safeRole === "assignedadmin" ||
    safeRole === "assigned_admin" ||
    safeRole === "assigned-admin" ||
    safeRole === "assigned admin" ||
    safeRole === "admin"
  ) {
    return "assignedAdmin";
  }
  if (safeRole === "staff") return "staff";
  return "user";
}

function sendRouteError(res, error, fallbackMessage) {
  json(res, Number(error?.statusCode || 500) || 500, {
    ok: false,
    message: safeString(error?.message, 500) || fallbackMessage,
    details: error?.details || null,
  });
}

async function verifyCaller(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error("You must be signed in to continue.");
    error.statusCode = 401;
    throw error;
  }

  let decoded = null;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    const error = new Error("Your session has expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  const uid = safeString(decoded?.uid, 180);
  const userSnap = uid ? await db.collection("users").doc(uid).get().catch(() => null) : null;
  const userDoc = userSnap?.exists ? userSnap.data() || {} : {};
  let role = normalizeRole(userDoc?.role);

  if (role === "user") {
    const staffSnap = uid ? await db.collection("staff").doc(uid).get().catch(() => null) : null;
    if (staffSnap?.exists) {
      role = "staff";
    }
  }

  return {
    uid,
    email: safeString(userDoc?.email || decoded?.email, 240),
    role,
    userDoc,
  };
}

async function loadRequestRow(requestId = "") {
  const safeRequestId = safeString(requestId, 180);
  if (!safeRequestId) {
    const error = new Error("requestId is required.");
    error.statusCode = 400;
    throw error;
  }

  const snap = await db.collection("serviceRequests").doc(safeRequestId).get();
  if (!snap.exists) {
    const error = new Error("Request not found.");
    error.statusCode = 404;
    throw error;
  }

  return {
    id: snap.id,
    ref: snap.ref,
    data: snap.data() || {},
  };
}

function ensureRequestActorAccess(requestData = {}, actor = {}) {
  const actorUid = safeString(actor?.uid, 180);
  const role = normalizeRole(actor?.role);
  if (!actorUid) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    throw error;
  }

  if (role === "superAdmin") return;
  if (role === "user") {
    if (safeString(requestData?.uid, 180) !== actorUid) {
      const error = new Error("This request is outside your account.");
      error.statusCode = 403;
      throw error;
    }
    return;
  }
  if (role === "staff") {
    if (safeString(requestData?.assignedTo, 180) !== actorUid) {
      const error = new Error("This request is assigned to another staff account.");
      error.statusCode = 403;
      throw error;
    }
    return;
  }

  const allowed = new Set(resolveRequestAdminUids(requestData));
  if (allowed.size && !allowed.has(actorUid)) {
    const error = new Error("This request is outside your admin scope.");
    error.statusCode = 403;
    throw error;
  }
}

async function handleRequestSubmitted({ actor, payload }) {
  const requestRow = await loadRequestRow(payload?.requestId);
  const requestData = requestRow.data || {};
  const ownerUid = safeString(requestData?.uid, 180);
  if (actor.role === "user" && ownerUid !== actor.uid) {
    const error = new Error("This request is outside your account.");
    error.statusCode = 403;
    throw error;
  }

  const superAdminUids = await listSuperAdminUids();
  const adminUids = [
    ...new Set([...resolveRequestAdminUids(requestData), ...superAdminUids].filter(Boolean)),
  ];

  const notifications = adminUids.map((uid) => ({
    scope: "admin",
    uid,
    type: "NEW_REQUEST",
    requestId: requestRow.id,
    notificationId: makeNotificationId("request_submitted", requestRow.id, uid),
    extras: {
      title: "New request",
      body: "A new service request was submitted.",
    },
  }));

  await createManyNotificationsAndPush(notifications);
  return { ok: true, notified: notifications.length };
}

async function loadMessageRow({ requestRow, status, messageId }) {
  const safeStatus = lower(status, 40);
  const safeMessageId = safeString(messageId, 180);
  if (!safeMessageId) {
    const error = new Error("messageId is required.");
    error.statusCode = 400;
    throw error;
  }

  const collectionName = safeStatus === "pending" ? "pendingMessages" : "messages";
  const snap = await requestRow.ref.collection(collectionName).doc(safeMessageId).get();
  if (!snap.exists) {
    const error = new Error("Message not found.");
    error.statusCode = 404;
    throw error;
  }

  return {
    id: snap.id,
    ref: snap.ref,
    status: safeStatus === "pending" ? "pending" : "published",
    data: snap.data() || {},
  };
}

function ensureMessageActorAccess({ requestData, messageData, actor, status }) {
  ensureRequestActorAccess(requestData, actor);

  const role = normalizeRole(actor?.role);
  const actorUid = safeString(actor?.uid, 180);
  const fromUid = safeString(messageData?.fromUid, 180);
  const fromRole = normalizeRole(messageData?.fromRole);
  const approvedBy = safeString(messageData?.approvedBy, 180);

  if (role === "superAdmin") return;
  if (role === "user" || role === "staff") {
    if (fromUid !== actorUid || fromRole !== role) {
      const error = new Error("This message does not belong to the current actor.");
      error.statusCode = 403;
      throw error;
    }
    return;
  }

  if (status === "published" && approvedBy && approvedBy === actorUid) return;
  if (fromUid === actorUid && fromRole === "assignedAdmin") return;
  if (fromUid === actorUid && fromRole === "superAdmin") return;
  if (fromUid === actorUid && lower(messageData?.fromRole, 40) === "admin") return;
}

async function handleMessageCreated({ actor, payload }) {
  const requestRow = await loadRequestRow(payload?.requestId);
  const messageRow = await loadMessageRow({
    requestRow,
    status: payload?.status,
    messageId: payload?.messageId,
  });

  ensureMessageActorAccess({
    requestData: requestRow.data,
    messageData: messageRow.data,
    actor,
    status: messageRow.status,
  });

  const messageData = messageRow.data || {};
  const requestData = requestRow.data || {};
  const kind = chatMessageKind(messageData);
  const title = chatNotificationTitleByKind(kind);
  const body = chatNotificationBody(messageData);
  const fromRoleRaw = lower(messageData?.fromRole, 40);
  const fromRole =
    fromRoleRaw === "superadmin" || fromRoleRaw === "assignedadmin" || fromRoleRaw === "admin"
      ? "admin"
      : fromRoleRaw;
  const fromUid = safeString(messageData?.fromUid, 180);
  const notifications = [];

  if (messageRow.status === "pending") {
    if (fromRole !== "user" && fromRole !== "staff") {
      return { ok: true, notified: 0 };
    }

    const adminUids = resolveRequestAdminUids(requestData, { excludeUids: [fromUid] });
    adminUids.forEach((uid) => {
      notifications.push({
        scope: "admin",
        uid,
        type: chatNotificationTypeByKind(kind, "admin", fromRole),
        requestId: requestRow.id,
        notificationId: makeNotificationId("pending_chat_admin", requestRow.id, messageRow.id, uid),
        extras: {
          title,
          body: `New ${kind} from ${fromRole}.`,
          route: `/app/admin/request/${encodeURIComponent(requestRow.id)}?openChat=1`,
          messageId: messageRow.id,
          pendingId: messageRow.id,
          actorRole: fromRole,
          actorUid: fromUid,
        },
      });
    });

    const superAdminUids = await listSuperAdminUids({
      excludeUids: [fromUid, ...adminUids],
    });
    superAdminUids.forEach((uid) => {
      notifications.push({
        scope: "admin",
        uid,
        type: `SUPER_${chatNotificationTypeByKind(kind, "admin", fromRole)}`,
        requestId: requestRow.id,
        notificationId: makeNotificationId("pending_chat_super", requestRow.id, messageRow.id, uid),
        extras: {
          title,
          body: `New ${kind} from ${fromRole}.`,
          route: `/app/admin/request/${encodeURIComponent(requestRow.id)}?openChat=1`,
          messageId: messageRow.id,
          pendingId: messageRow.id,
          actorRole: fromRole,
          actorUid: fromUid,
        },
      });
    });

    await createManyNotificationsAndPush(notifications);
    return { ok: true, notified: notifications.length };
  }

  let recipientUid = "";
  let recipientScope = "";
  if (fromRole === "admin" || fromRole === "staff") {
    recipientUid = safeString(requestData?.uid, 180);
    recipientScope = "user";
  } else if (fromRole === "user") {
    recipientUid = safeString(requestData?.assignedTo, 180);
    recipientScope = "staff";
  }

  if (recipientUid && recipientUid !== fromUid) {
    notifications.push({
      scope: recipientScope,
      uid: recipientUid,
      type: chatNotificationTypeByKind(kind, recipientScope, fromRole),
      requestId: requestRow.id,
      notificationId: makeNotificationId("chat", requestRow.id, messageRow.id, recipientScope, recipientUid),
      extras: {
        title,
        body,
        route:
          recipientScope === "staff"
            ? `/staff/request/${encodeURIComponent(requestRow.id)}?openChat=1`
            : `/app/request/${encodeURIComponent(requestRow.id)}?openChat=1`,
        messageId: messageRow.id,
        actorRole: fromRole,
        actorUid: fromUid,
      },
    });
  }

  if ((fromRole === "user" || fromRole === "staff") && !safeString(messageData?.sourcePendingId, 180)) {
    const adminUids = resolveRequestAdminUids(requestData, { excludeUids: [fromUid] });
    adminUids.forEach((uid) => {
      notifications.push({
        scope: "admin",
        uid,
        type: chatNotificationTypeByKind(kind, "admin", fromRole),
        requestId: requestRow.id,
        notificationId: makeNotificationId("chat_admin", requestRow.id, messageRow.id, uid),
        extras: {
          title,
          body: `New ${kind} from ${fromRole}.`,
          route: `/app/admin/request/${encodeURIComponent(requestRow.id)}?openChat=1`,
          messageId: messageRow.id,
          actorRole: fromRole,
          actorUid: fromUid,
        },
      });
    });

    const superAdminUids = await listSuperAdminUids({
      excludeUids: [fromUid, ...adminUids],
    });
    superAdminUids.forEach((uid) => {
      notifications.push({
        scope: "admin",
        uid,
        type: `SUPER_${chatNotificationTypeByKind(kind, "admin", fromRole)}`,
        requestId: requestRow.id,
        notificationId: makeNotificationId("chat_super", requestRow.id, messageRow.id, uid),
        extras: {
          title,
          body: `New ${kind} from ${fromRole}.`,
          route: `/app/admin/request/${encodeURIComponent(requestRow.id)}?openChat=1`,
          messageId: messageRow.id,
          actorRole: fromRole,
          actorUid: fromUid,
        },
      });
    });
  }

  await createManyNotificationsAndPush(notifications);
  return { ok: true, notified: notifications.length };
}

async function handleRequestStartedWork({ actor, payload }) {
  const requestRow = await loadRequestRow(payload?.requestId);
  const requestData = requestRow.data || {};
  ensureRequestActorAccess(requestData, actor);

  if (normalizeRole(actor?.role) !== "staff") {
    const error = new Error("Only staff can emit this event.");
    error.statusCode = 403;
    throw error;
  }

  const notifications = [];
  const ownerUid = safeString(requestData?.uid, 180);
  if (ownerUid) {
    notifications.push({
      scope: "user",
      uid: ownerUid,
      type: "REQUEST_IN_PROGRESS",
      requestId: requestRow.id,
      notificationId: makeNotificationId("request_started_user", requestRow.id),
      extras: {
        title: "Request in progress",
        body: "We've started working on your request.",
      },
    });
  }

  const adminUids = resolveRequestAdminUids(requestData);
  adminUids.forEach((uid) => {
    notifications.push({
      scope: "admin",
      uid,
      type: "REQUEST_PUT_IN_PROGRESS",
      requestId: requestRow.id,
      notificationId: makeNotificationId("request_started_admin", requestRow.id, uid),
      extras: {
        title: "Request in progress",
        body: "A request moved to in-progress status.",
      },
    });
  });

  const superAdminUids = await listSuperAdminUids({ excludeUids: adminUids });
  superAdminUids.forEach((uid) => {
    notifications.push({
      scope: "admin",
      uid,
      type: "SUPER_ADMIN_REQUEST_PUT_IN_PROGRESS",
      requestId: requestRow.id,
      notificationId: makeNotificationId("request_started_super", requestRow.id, uid),
      extras: {
        title: "Request in progress",
        body: "A request moved to in-progress status.",
      },
    });
  });

  await createManyNotificationsAndPush(notifications);
  return { ok: true, notified: notifications.length };
}

async function handleProgressUpdated({ actor, payload }) {
  const requestRow = await loadRequestRow(payload?.requestId);
  ensureRequestActorAccess(requestRow.data, actor);

  const updateId = safeString(payload?.updateId, 180);
  if (!updateId) {
    const error = new Error("updateId is required.");
    error.statusCode = 400;
    throw error;
  }

  const progressSnap = await requestRow.ref.collection("progressUpdates").doc(updateId).get();
  if (!progressSnap.exists) {
    const error = new Error("Progress update not found.");
    error.statusCode = 404;
    throw error;
  }

  const progress = progressSnap.data() || {};
  if (progress?.visibleToUser === false) {
    return { ok: true, notified: 0 };
  }

  const ownerUid = safeString(requestRow.data?.uid, 180);
  if (!ownerUid) return { ok: true, notified: 0 };

  await createManyNotificationsAndPush([
    {
      scope: "user",
      uid: ownerUid,
      type: "PROGRESS_UPDATED",
      requestId: requestRow.id,
      notificationId: makeNotificationId("progress_update", requestRow.id, updateId),
      extras: {
        title: "Progress updated",
        body:
          safeString(progress?.content, 2000) || "There is a new progress update on your request.",
        updateId,
      },
    },
  ]);

  return { ok: true, notified: 1 };
}

async function dispatchNotificationEvent({ actor, event, payload }) {
  const safeEvent = lower(event, 80);
  if (safeEvent === "request_submitted") {
    return handleRequestSubmitted({ actor, payload });
  }
  if (safeEvent === "message_created") {
    return handleMessageCreated({ actor, payload });
  }
  if (safeEvent === "request_started_work") {
    return handleRequestStartedWork({ actor, payload });
  }
  if (safeEvent === "progress_updated") {
    return handleProgressUpdated({ actor, payload });
  }

  const error = new Error("Unsupported notification event.");
  error.statusCode = 400;
  throw error;
}

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) {
    return;
  }

  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  try {
    const actor = await verifyCaller(req);
    const body = await readJsonBody(req);
    const event = safeString(body?.event, 80);
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    const result = await dispatchNotificationEvent({ actor, event, payload });
    json(res, 200, result);
  } catch (error) {
    console.error("[notification-event] failed", safeString(error?.message || error, 300));
    sendRouteError(res, error, "Notification event failed.");
  }
}

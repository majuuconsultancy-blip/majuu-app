import { admin, db } from "./_lib/firebaseAdmin.js";
import { getBearerToken, handleCors, json, methodNotAllowed, readJsonBody } from "./_lib/http.js";
import { sendPushForNotificationDoc } from "./_lib/notificationServer.js";

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

function normalizeScope(scope = "") {
  const safeScope = lower(scope, 40);
  if (safeScope === "staff") return "staff";
  if (safeScope === "admin" || safeScope === "assignedadmin") return "admin";
  return "user";
}

function resolveRequestAdminUids(requestData = {}) {
  const seen = new Set();
  return [
    safeString(requestData?.ownerLockedAdminUid, 180),
    safeString(requestData?.currentAdminUid, 180),
    safeString(requestData?.assignedAdminId, 180),
    safeString(requestData?.routingMeta?.currentAdminUid, 180),
    safeString(requestData?.routingMeta?.assignedAdminId, 180),
  ].filter((uid) => {
    if (!uid || seen.has(uid)) return false;
    seen.add(uid);
    return true;
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
  const role = normalizeRole(userDoc?.role);
  if (role !== "superAdmin" && role !== "assignedAdmin") {
    const error = new Error("Admin access is required.");
    error.statusCode = 403;
    throw error;
  }

  return {
    uid,
    role,
  };
}

async function ensureNotificationScope(actor, payload = {}) {
  if (actor?.role === "superAdmin") return;

  const requestId = safeString(payload?.requestId, 180);
  if (!requestId) {
    const error = new Error("requestId is required for assigned admin notification dispatch.");
    error.statusCode = 400;
    throw error;
  }

  const requestSnap = await db.collection("serviceRequests").doc(requestId).get();
  if (!requestSnap.exists) {
    const error = new Error("Request not found.");
    error.statusCode = 404;
    throw error;
  }

  const allowed = new Set(resolveRequestAdminUids(requestSnap.data() || {}));
  if (allowed.size && !allowed.has(actor.uid)) {
    const error = new Error("This request is outside your admin scope.");
    error.statusCode = 403;
    throw error;
  }
}

function buildNotificationPayload(body = {}) {
  const notification = body?.notification && typeof body.notification === "object" ? body.notification : {};
  return {
    scope: normalizeScope(body?.scope || notification?.role),
    uid: safeString(body?.uid || notification?.uid, 180),
    requestId: safeString(body?.requestId || notification?.requestId, 180),
    notification: {
      id: safeString(notification?.id, 220),
      type: safeString(notification?.type, 120).toUpperCase(),
      requestId: safeString(notification?.requestId, 180),
      paymentId: safeString(notification?.paymentId, 180),
      refundId: safeString(notification?.refundId, 180),
      route: safeString(notification?.route, 1200),
      title: safeString(notification?.title, 240),
      body: safeString(notification?.body, 2000),
      uid: safeString(notification?.uid, 180),
      role: normalizeScope(notification?.role),
    },
  };
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
    const payload = buildNotificationPayload(body);
    await ensureNotificationScope(actor, payload);

    if (!payload.uid || !payload.notification?.id) {
      json(res, 400, {
        ok: false,
        message: "uid and notification.id are required.",
      });
      return;
    }

    const result = await sendPushForNotificationDoc({
      scope: payload.scope,
      uid: payload.uid,
      notification: payload.notification,
    });

    json(res, 200, {
      ok: true,
      result,
    });
  } catch (error) {
    json(res, Number(error?.statusCode || 500) || 500, {
      ok: false,
      message: safeString(error?.message, 500) || "Failed to dispatch notification push.",
      details: error?.details || null,
    });
  }
}

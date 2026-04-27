import { admin, db, FieldValue } from "./_lib/firebaseAdmin.js";
import { getBearerToken, handleCors, json, methodNotAllowed, readJsonBody } from "./_lib/http.js";

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

function normalizeToRole(role = "") {
  const safeRole = lower(role, 40);
  if (safeRole === "staff") return "staff";
  return "user";
}

function normalizeMessageType(type = "", attachmentMeta = null) {
  const clean = lower(type, 40);
  if (clean === "text") return "text";
  if (clean === "bundle") return "bundle";
  if (clean === "document" || clean === "pdf") return "document";
  if (clean === "image") return "image";
  if (clean === "photo" || clean === "camera_photo") return "photo";

  const attachmentKind = lower(attachmentMeta?.attachmentKind || attachmentMeta?.kind, 40);
  if (attachmentKind === "photo") return "photo";
  if (attachmentKind === "image") return "image";
  if (attachmentMeta) return "document";
  return "text";
}

function normalizeAttachmentMeta(value = null) {
  if (!value || typeof value !== "object") return null;

  const name = safeString(value?.name || value?.fileName || value?.filename, 220);
  if (!name) return null;

  const mime = lower(value?.mime || value?.type || value?.contentType, 120);
  const attachmentKindRaw = lower(value?.attachmentKind || value?.kind, 40);
  let attachmentKind = "document";
  if (attachmentKindRaw === "photo") attachmentKind = "photo";
  else if (attachmentKindRaw === "image") attachmentKind = "image";
  else if (mime.startsWith("image/")) attachmentKind = "image";

  const externalUrl = safeString(
    value?.externalUrl || value?.url || value?.downloadUrl || value?.fileUrl,
    1200
  );
  const storageBucket = safeString(value?.storageBucket || value?.bucket || value?.storage?.bucket, 220);
  const storagePath = safeString(value?.storagePath || value?.path || value?.storage?.path, 520);
  const rawStorageKind = lower(value?.storageKind || value?.storage?.kind, 30);
  const storageKind =
    rawStorageKind === "bucket" || rawStorageKind === "external" || rawStorageKind === "meta"
      ? rawStorageKind
      : storagePath || storageBucket
      ? "bucket"
      : externalUrl
      ? "external"
      : "";

  return {
    name,
    mime: mime || (attachmentKind === "document" ? "application/octet-stream" : "image/jpeg"),
    size: Math.max(0, Number(value?.size || value?.sizeBytes || 0) || 0),
    note: safeString(value?.note, 1400),
    attachmentKind,
    source: lower(value?.source, 40),
    optimizedBytes: Math.max(0, Number(value?.optimizedBytes || 0) || 0),
    originalBytes: Math.max(0, Number(value?.originalBytes || 0) || 0),
    externalUrl,
    url: externalUrl,
    downloadUrl: externalUrl,
    fileUrl: externalUrl,
    storageKind,
    storageBucket,
    storagePath,
    storageGeneration: safeString(
      value?.storageGeneration || value?.generation || value?.storage?.generation,
      120
    ),
    storageChecksum: safeString(
      value?.storageChecksum || value?.checksum || value?.storage?.checksum,
      120
    ),
    storageProvider: lower(value?.storageProvider || value?.provider || value?.storage?.provider, 40),
  };
}

function toMessageKind(type = "", attachmentMeta = null) {
  const cleanType = lower(type, 40);
  if (cleanType === "text") return "message";
  const attachmentKind = lower(attachmentMeta?.attachmentKind, 40);
  if (
    cleanType === "photo" ||
    cleanType === "image" ||
    attachmentKind === "photo" ||
    attachmentKind === "image"
  ) {
    return "photo";
  }
  return "document";
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
    role,
    email: safeString(userDoc?.email || decoded?.email, 240),
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

function resolveRequestStaffUid(request = {}) {
  return safeString(
    request?.assignedTo ||
      request?.assignedStaffUid ||
      request?.assignedToUid ||
      request?.staffUid ||
      request?.staffAssignedUid,
    180
  );
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
    if (resolveRequestStaffUid(requestData) !== actorUid) {
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

async function handleSendMessage({ actor, payload }) {
  const requestRow = await loadRequestRow(payload?.requestId);
  const requestData = requestRow.data || {};
  ensureRequestActorAccess(requestData, actor);

  const normalizedActorRole = actor.role === "superAdmin" ? "admin" : actor.role;
  const toRole = normalizeToRole(payload?.toRole);
  const attachmentMeta = normalizeAttachmentMeta(payload?.attachmentMeta || payload?.pdfMeta);
  const type = normalizeMessageType(payload?.type, attachmentMeta);
  const text = safeString(payload?.text, 4000);

  if (!["user", "staff", "admin"].includes(normalizedActorRole)) {
    const error = new Error("Unsupported actor role.");
    error.statusCode = 403;
    throw error;
  }
  if (!["text", "document", "image", "photo", "bundle"].includes(type)) {
    const error = new Error("Unsupported message type.");
    error.statusCode = 400;
    throw error;
  }
  if (type === "text" && !text) {
    const error = new Error("Text cannot be empty.");
    error.statusCode = 400;
    throw error;
  }
  if ((type === "document" || type === "image" || type === "photo") && !attachmentMeta) {
    const error = new Error("attachmentMeta is required for file messages.");
    error.statusCode = 400;
    throw error;
  }
  if (type === "bundle" && !text && !attachmentMeta) {
    const error = new Error("Bundle cannot be empty.");
    error.statusCode = 400;
    throw error;
  }

  const ownerUid = safeString(requestData?.uid, 180);
  const staffUid = resolveRequestStaffUid(requestData);

  if (normalizedActorRole === "user" && toRole !== "staff") {
    const error = new Error("User can only send to staff.");
    error.statusCode = 400;
    throw error;
  }
  if (normalizedActorRole === "staff" && toRole !== "user") {
    const error = new Error("Staff can only send to user.");
    error.statusCode = 400;
    throw error;
  }
  if (normalizedActorRole === "admin" && toRole !== "user" && toRole !== "staff") {
    const error = new Error("Admin can only send to user or staff.");
    error.statusCode = 400;
    throw error;
  }

  const nowMs = Date.now();
  const publishDirectly = normalizedActorRole === "admin" || requestData?.chatAutoAccept === true;

  if (publishDirectly) {
    const messageRef = requestRow.ref.collection("messages").doc();
    const toUid = toRole === "user" ? ownerUid : staffUid;
    const documentPayload = {
      requestId: requestRow.id,
      fromRole: normalizedActorRole,
      fromUid: actor.uid,
      toRole,
      toUid: toUid || null,
      type,
      messageKind: toMessageKind(type, attachmentMeta),
      text: type === "text" || type === "bundle" ? text : "",
      attachmentMeta: type === "text" ? null : attachmentMeta,
      pdfMeta:
        type === "document" ||
        (type === "bundle" && lower(attachmentMeta?.attachmentKind || "document", 40) === "document")
          ? attachmentMeta
          : null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      needsAssignment: toRole === "staff" && !toUid,
    };

    if (normalizedActorRole === "admin") {
      documentPayload.approvedBy = actor.uid;
      documentPayload.approvedAt = FieldValue.serverTimestamp();
    } else {
      documentPayload.moderationBypassed = true;
      documentPayload.moderationMode = "request_auto_accept";
    }

    await messageRef.set(documentPayload, { merge: true });
    return {
      ok: true,
      requestId: requestRow.id,
      messageId: messageRef.id,
      status: "published",
      via: "server",
    };
  }

  const pendingRef = requestRow.ref.collection("pendingMessages").doc();
  await pendingRef.set(
    {
      requestId: requestRow.id,
      fromRole: normalizedActorRole,
      fromUid: actor.uid,
      toRole,
      type,
      messageKind: toMessageKind(type, attachmentMeta),
      text: type === "text" || type === "bundle" ? text : "",
      attachmentMeta: type === "text" ? null : attachmentMeta,
      pdfMeta:
        type === "document" ||
        (type === "bundle" && lower(attachmentMeta?.attachmentKind || "document", 40) === "document")
          ? attachmentMeta
          : null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
    },
    { merge: true }
  );

  return {
    ok: true,
    requestId: requestRow.id,
    messageId: pendingRef.id,
    status: "pending",
    via: "server",
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
    const payload = await readJsonBody(req);
    const result = await handleSendMessage({ actor, payload });
    json(res, 200, result);
  } catch (error) {
    json(res, Number(error?.statusCode || 500) || 500, {
      ok: false,
      message: safeString(error?.message, 500) || "Failed to send message.",
      details: error?.details || null,
    });
  }
}

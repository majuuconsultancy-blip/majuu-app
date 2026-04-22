// ✅ src/services/chatservice.js (FULL COPY-PASTE)
// Moderated chat per request:
// - user/staff send -> pendingMessages
// - admin reviews: approve/edit/reject/hide
// - approved -> messages (published)
// - admin can also send DIRECT (publish without pending)
// - unread: readState docs + published /messages only
//
// ✅ FIX in this version (your issue):
// ✅ Admin can now APPROVE a message to STAFF even when the request is NOT assigned yet.
// - Before: approve would FAIL ("Receiver not found") and message stayed pending forever.
// - Now: we still publish it to /messages (toRole:"staff", toUid:null) and mark pending as approved.
// - When staff later opens the request chat, they WILL see it because chat panels read /messages.
// - Staff notification is skipped until an assignee exists (because we can't know who to notify yet).
//
// ✅ Added previously (kept):
// - ✅ "bundle" type
// - ✅ sendPendingBundle
// - ✅ adminSendBundleDirect
// - ✅ admin approve supports bundle and keeps original createdAt
//
// NOTE:
// - Staff notification is only created when assignedTo exists.
// - If you want “notify staff immediately after assignment”, that should be handled
//   where you assign staff (small extra code in that assign flow), but at least now
//   NOTHING stays stuck in pending and staff WILL see it in chat once assigned.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { createStaffNotification, createUserNotification } from "./notificationDocs";
import { mirrorPublishedChatAttachment, mirrorPublishedChatPdf } from "./documentEngineService";
import { sendMessageCommand } from "./requestcommandservice";
import { uploadBinaryFile } from "./fileUploadService";
import { buildChatAttachmentStoragePath } from "./storageContract";

/* -------------------- Paths -------------------- */
const reqRef = (requestId) => doc(db, "serviceRequests", String(requestId));

const pendingCol = (requestId) =>
  collection(db, "serviceRequests", String(requestId), "pendingMessages");

const publishedCol = (requestId) =>
  collection(db, "serviceRequests", String(requestId), "messages");

const readStateDoc = (requestId, rid) =>
  doc(db, "serviceRequests", String(requestId), "readState", String(rid));

/* -------------------- Helpers -------------------- */
function mustUser() {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  return u;
}

function safeStr(x) {
  return String(x || "").trim();
}

function normalizeRole(role) {
  const r = safeStr(role).toLowerCase();
  if (!["user", "staff", "admin"].includes(r)) throw new Error("Invalid role");
  return r;
}

function normalizeType(type) {
  const t = safeStr(type).toLowerCase();
  if (t === "pdf") return "document";
  if (!["text", "document", "image", "photo", "bundle"].includes(t)) throw new Error("Invalid type");
  return t;
}

function normalizeAttachmentKind(kind, mime = "") {
  const raw = safeStr(kind).toLowerCase();
  if (raw === "photo" || raw === "image" || raw === "document") return raw;
  const cleanMime = safeStr(mime).toLowerCase();
  if (cleanMime.startsWith("image/")) return "image";
  return "document";
}

function isHttpUrl(url = "") {
  const value = safeStr(url, 1200);
  return value.startsWith("http://") || value.startsWith("https://");
}

function resolveAttachmentUrl(meta = {}) {
  const candidates = [
    meta?.externalUrl,
    meta?.url,
    meta?.downloadUrl,
    meta?.fileUrl,
  ];
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return safeStr(candidate, 1200);
  }
  return "";
}

function normalizeAttachmentMeta(meta) {
  if (!meta) return null;
  const name = safeStr(meta.name || meta.fileName || meta.filename);
  const mime = safeStr(meta.mime || meta.type || meta.contentType || "");
  const size = Number(meta.size || meta.sizeBytes || 0) || 0;
  const note = safeStr(meta.note || "");
  const attachmentKind = normalizeAttachmentKind(meta.attachmentKind || meta.kind, mime);

  if (!name) throw new Error("attachmentMeta.name required");

  const externalUrl = resolveAttachmentUrl(meta);
  const uploadBlob =
    meta?.uploadBlob instanceof Blob
      ? meta.uploadBlob
      : meta?.blob instanceof Blob
      ? meta.blob
      : meta?.file instanceof Blob
      ? meta.file
      : null;

  return {
    name,
    mime: mime || (attachmentKind === "document" ? "application/octet-stream" : "image/jpeg"),
    size,
    note,
    attachmentKind,
    source: safeStr(meta.source || "").toLowerCase(),
    optimizedBytes: Number(meta.optimizedBytes || 0) || 0,
    originalBytes: Number(meta.originalBytes || 0) || 0,
    externalUrl,
    url: externalUrl,
    downloadUrl: externalUrl,
    fileUrl: externalUrl,
    storageKind: safeStr(meta.storageKind || "", 40).toLowerCase(),
    storageBucket: safeStr(meta.storageBucket || meta.bucket || "", 220),
    storagePath: safeStr(meta.storagePath || meta.path || "", 520),
    storageGeneration: safeStr(meta.storageGeneration || meta.generation || "", 120),
    storageChecksum: safeStr(meta.storageChecksum || meta.checksum || "", 120),
    storageProvider: safeStr(meta.storageProvider || meta.provider || "", 40).toLowerCase(),
    uploadBlob,
  };
}

function normalizeLegacyPdfMeta(pdfMeta) {
  const normalized = normalizeAttachmentMeta(pdfMeta);
  if (!normalized) return null;
  return {
    ...normalized,
    attachmentKind: normalized.attachmentKind || "document",
    mime: normalized.mime || "application/pdf",
  };
}

function toCommandAttachmentMeta(meta = null) {
  if (!meta || typeof meta !== "object") return null;
  const normalized = normalizeAttachmentMeta(meta);
  if (!normalized) return null;
  const cleanUrl = resolveAttachmentUrl(normalized);
  return {
    name: normalized.name,
    mime: normalized.mime,
    size: normalized.size,
    note: normalized.note,
    attachmentKind: normalized.attachmentKind,
    source: normalized.source,
    optimizedBytes: normalized.optimizedBytes,
    originalBytes: normalized.originalBytes,
    externalUrl: cleanUrl,
    storageKind: normalized.storageKind,
    storageBucket: normalized.storageBucket,
    storagePath: normalized.storagePath,
    storageGeneration: normalized.storageGeneration,
    storageChecksum: normalized.storageChecksum,
    storageProvider: normalized.storageProvider,
  };
}

async function ensureAttachmentStored({
  requestId,
  fromRole,
  attachmentMeta,
} = {}) {
  const meta = normalizeAttachmentMeta(attachmentMeta);
  if (!meta) return null;
  const existingUrl = resolveAttachmentUrl(meta);
  if (existingUrl) return meta;
  if (!(meta.uploadBlob instanceof Blob)) return meta;

  const storagePath = buildChatAttachmentStoragePath({
    requestId,
    fromRole,
    attachmentKind: meta.attachmentKind,
    fileName: meta.name,
    contentType: meta.mime,
  });
  const upload = await uploadBinaryFile({
    file: meta.uploadBlob,
    storagePath,
    contentType: meta.mime,
    customMetadata: {
      requestId: safeStr(requestId, 140),
      source: "chat",
      fromRole: safeStr(fromRole, 40),
      attachmentKind: safeStr(meta.attachmentKind, 40),
    },
  });
  return {
    ...meta,
    size: Number(upload?.sizeBytes || meta.size || 0) || 0,
    mime: safeStr(upload?.contentType, 120) || meta.mime,
    externalUrl: "",
    url: "",
    downloadUrl: "",
    fileUrl: "",
    storageKind: safeStr(upload?.storageKind || "bucket", 40).toLowerCase(),
    storageBucket: safeStr(upload?.bucket, 220),
    storagePath: safeStr(upload?.path, 520),
    storageGeneration: safeStr(upload?.generation, 120),
    storageChecksum: safeStr(upload?.checksum, 120),
    storageProvider: safeStr(upload?.provider, 40).toLowerCase(),
    uploadBlob: null,
  };
}

function inferMessageKindFromType(type = "", attachmentMeta = null) {
  const normalizedType = normalizeType(type);
  if (normalizedType === "text") return "message";
  if (normalizedType === "photo" || normalizedType === "image") return "photo";
  const attachmentKind = normalizeAttachmentKind(attachmentMeta?.attachmentKind, attachmentMeta?.mime);
  if (attachmentKind === "photo" || attachmentKind === "image") return "photo";
  return "document";
}

function mapAttachmentType(attachmentMeta = null, typeHint = "") {
  const hint = safeStr(typeHint).toLowerCase();
  if (hint === "photo" || hint === "image" || hint === "document") return hint;
  const kind = normalizeAttachmentKind(attachmentMeta?.attachmentKind, attachmentMeta?.mime);
  if (kind === "photo" || kind === "image") return kind;
  return "document";
}

/**
 * ✅ Compute receiver UID.
 * - user => request.uid
 * - staff => request.assignedTo (may be empty if not assigned yet)
 * Returns "" if unknown.
 */
function resolveReceiverUid({ req, toRole }) {
  const tr = normalizeRole(toRole);
  const userUid = safeStr(req?.uid);
  const staffUid = safeStr(req?.assignedTo);

  if (tr === "user") return userUid || "";
  if (tr === "staff") return staffUid || ""; // ✅ can be missing (not assigned yet)
  return "";
}

async function mirrorPublishedChatDocument({
  requestId,
  requestData,
  messageId,
  fromRole,
  fromUid,
  toRole,
  toUid,
  attachmentMeta,
  actorUid,
  sourceChannel,
} = {}) {
  const rid = safeStr(requestId);
  const requestUid = safeStr(requestData?.uid);
  const mid = safeStr(messageId);
  const normalizedMeta = normalizeAttachmentMeta(attachmentMeta);
  if (!rid || !requestUid || !mid || !normalizedMeta) return;

  try {
    await mirrorPublishedChatAttachment({
      requestId: rid,
      requestUid,
      messageId: mid,
      attachmentMeta: normalizedMeta,
      fromRole,
      fromUid,
      toRole,
      toUid,
      actorUid,
      sourceChannel,
    });
  } catch (error) {
    try {
      // Backward fallback to old mirror path if attachment mirror fails.
      await mirrorPublishedChatPdf({
        requestId: rid,
        requestUid,
        messageId: mid,
        pdfMeta: normalizedMeta,
        fromRole,
        fromUid,
        toRole,
        toUid,
        actorUid,
        sourceChannel,
      });
    } catch (fallbackError) {
      console.warn("document engine mirror failed for chat attachment:", fallbackError?.message || error);
    }
  }
}

/* -------------------- Sender: User/Staff -> Pending -------------------- */

export async function sendPendingText({ requestId, fromRole, toRole, text } = {}) {
  mustUser();
  const rid = safeStr(requestId);
  const fr = normalizeRole(fromRole);
  const tr = normalizeRole(toRole);
  const msg = safeStr(text);

  if (!rid) throw new Error("requestId required");
  if (!msg) throw new Error("Message is empty");
  if (fr === "admin") throw new Error("Admin should publish directly, not pending");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const result = await sendMessageCommand({
    requestId: rid,
    toRole: tr,
    type: "text",
    text: msg,
    actorRole: fr === "staff" ? "staff" : "user",
  });
  if (!result?.ok) {
    throw new Error("Failed to send message.");
  }
  return { ok: true, id: safeStr(result?.messageId) };
}

export async function sendPendingAttachment({
  requestId,
  fromRole,
  toRole,
  attachmentMeta = null,
  typeHint = "",
} = {}) {
  mustUser();
  const rid = safeStr(requestId);
  const fr = normalizeRole(fromRole);
  const tr = normalizeRole(toRole);
  if (!rid) throw new Error("requestId required");
  const baseMeta = normalizeAttachmentMeta(attachmentMeta);
  const meta = await ensureAttachmentStored({
    requestId: rid,
    fromRole: fr,
    attachmentMeta: baseMeta,
  });
  const msgType = mapAttachmentType(meta, typeHint);

  if (!meta) throw new Error("attachmentMeta required");
  if (fr === "admin") throw new Error("Admin should publish directly, not pending");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const result = await sendMessageCommand({
    requestId: rid,
    toRole: tr,
    type: msgType,
    attachmentMeta: toCommandAttachmentMeta(meta),
    pdfMeta: toCommandAttachmentMeta(meta),
    actorRole: fr === "staff" ? "staff" : "user",
  });
  if (!result?.ok) {
    throw new Error("Failed to send message.");
  }
  return { ok: true, id: safeStr(result?.messageId) };
}

export async function sendPendingPdf({ requestId, fromRole, toRole, pdfMeta } = {}) {
  return sendPendingAttachment({
    requestId,
    fromRole,
    toRole,
    attachmentMeta: normalizeLegacyPdfMeta(pdfMeta),
    typeHint: "document",
  });
}

export async function sendPendingImage({ requestId, fromRole, toRole, attachmentMeta } = {}) {
  return sendPendingAttachment({
    requestId,
    fromRole,
    toRole,
    attachmentMeta,
    typeHint: "image",
  });
}

export async function sendPendingPhoto({ requestId, fromRole, toRole, attachmentMeta } = {}) {
  return sendPendingAttachment({
    requestId,
    fromRole,
    toRole,
    attachmentMeta,
    typeHint: "photo",
  });
}

/**
 * ✅ One pending message that can include BOTH text + attachment metadata.
 */
export async function sendPendingBundle({
  requestId,
  fromRole,
  toRole,
  text = "",
  attachmentMeta = null,
  pdfMeta = null,
} = {}) {
  mustUser();
  const rid = safeStr(requestId);
  const fr = normalizeRole(fromRole);
  const tr = normalizeRole(toRole);

  const msg = safeStr(text);
  if (!rid) throw new Error("requestId required");
  const normalizedSourceMeta = normalizeAttachmentMeta(attachmentMeta || pdfMeta);
  const meta = await ensureAttachmentStored({
    requestId: rid,
    fromRole: fr,
    attachmentMeta: normalizedSourceMeta,
  });

  if (fr === "admin") throw new Error("Admin should publish directly, not pending");
  if (tr === "admin") throw new Error("toRole cannot be admin");
  if (!msg && !meta) throw new Error("Bundle is empty (needs text and/or attachment)");

  const result = await sendMessageCommand({
    requestId: rid,
    toRole: tr,
    type: "bundle",
    text: msg,
    attachmentMeta: toCommandAttachmentMeta(meta),
    pdfMeta: toCommandAttachmentMeta(meta),
    actorRole: fr === "staff" ? "staff" : "user",
  });
  if (!result?.ok) {
    throw new Error("Failed to send message.");
  }
  return { ok: true, id: safeStr(result?.messageId) };
}

/* -------------------- Reading lists -------------------- */

export async function listPublishedMessages({ requestId, max = 80 } = {}) {
  const rid = safeStr(requestId);
  if (!rid) throw new Error("requestId required");

  const qy = query(
    publishedCol(rid),
    orderBy("createdAt", "asc"),
    limit(Math.max(1, max))
  );

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listPendingMessages({ requestId, max = 80 } = {}) {
  const rid = safeStr(requestId);
  if (!rid) throw new Error("requestId required");

  const qy = query(
    pendingCol(rid),
    orderBy("createdAt", "asc"),
    limit(Math.max(1, max))
  );

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* -------------------- Read state (unread tracking) -------------------- */

export async function markRequestChatRead({ requestId, role } = {}) {
  const user = mustUser();
  const rid = safeStr(requestId);
  const r = normalizeRole(role);

  if (!rid) throw new Error("requestId required");
  if (!["user", "staff"].includes(r)) throw new Error("Only user/staff set read state");

  const docId = `${r}_${user.uid}`;

  await setDoc(
    readStateDoc(rid, docId),
    {
      role: r,
      uid: user.uid,
      lastReadAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
}

/* -------------------- Admin moderation: approve/edit/reject/hide -------------------- */

export async function adminApprovePending({
  requestId,
  pendingId,
  editedText = null,
  editedPdfMeta = null,
} = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);

  if (!rid) throw new Error("requestId required");
  if (!pid) throw new Error("pendingId required");

  const rSnap = await getDoc(reqRef(rid));
  if (!rSnap.exists()) throw new Error("Request not found");
  const req = { id: rSnap.id, ...rSnap.data() };

  const pRef = doc(db, "serviceRequests", rid, "pendingMessages", pid);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()) throw new Error("Pending message not found");

  const p = { id: pSnap.id, ...pSnap.data() };

  const type = normalizeType(p.type);
  const toRole = normalizeRole(p.toRole);
  const fromRole = normalizeRole(p.fromRole);
  const fromUid = safeStr(p.fromUid);

  const finalText = editedText != null ? safeStr(editedText) : safeStr(p.text);
  const finalAttachmentMeta =
    editedPdfMeta != null
      ? normalizeAttachmentMeta(editedPdfMeta)
      : normalizeAttachmentMeta(p.attachmentMeta || p.pdfMeta);

  // ✅ Validate based on type
  if (type === "text" && !finalText) throw new Error("Final text is empty");
  if ((type === "document" || type === "image" || type === "photo") && !finalAttachmentMeta) {
    throw new Error("Final attachment meta missing");
  }
  if (type === "bundle" && !finalText && !finalAttachmentMeta)
    throw new Error("Final bundle is empty");

  // ✅ FIX: allow staff receiver to be missing (not assigned yet)
  const receiverUid = resolveReceiverUid({ req, toRole }); // may be ""

  const batch = writeBatch(db);

  // publish anyway (even if receiverUid missing for staff)
  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole,
    fromUid,
    toRole,
    toUid: receiverUid || null, // ✅ null if not assigned yet

    type,
    messageKind: inferMessageKindFromType(type, finalAttachmentMeta),
    text: type === "text" ? finalText : type === "bundle" ? finalText : "",
    attachmentMeta: type === "text" ? null : finalAttachmentMeta,
    pdfMeta:
      type === "document" ||
      (type === "bundle" &&
        normalizeAttachmentKind(finalAttachmentMeta?.attachmentKind, finalAttachmentMeta?.mime) === "document")
        ? finalAttachmentMeta
        : null,

    sourcePendingId: pid,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),

    // ✅ keep original send time
    createdAt: p?.createdAt || serverTimestamp(),

    // ✅ optional hint: published before assignee existed
    needsAssignment: toRole === "staff" && !receiverUid ? true : false,
  });

  // mark pending as approved ALWAYS
  batch.update(pRef, {
    status: "approved",
    editedText: editedText != null ? finalText : null,
    editedAttachmentMeta: editedPdfMeta != null ? finalAttachmentMeta : null,
    editedPdfMeta: editedPdfMeta != null ? finalAttachmentMeta : null,
    editedBy: admin.uid,
    editedAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
    approvedBy: admin.uid,
  });

  // Chat unread is derived from published /messages + readState; no chat notification docs here.

  await batch.commit();
  if (finalAttachmentMeta) {
    await mirrorPublishedChatDocument({
      requestId: rid,
      requestData: req,
      messageId: pubRef.id,
      fromRole,
      fromUid,
      toRole,
      toUid: receiverUid || "",
      attachmentMeta: finalAttachmentMeta,
      actorUid: admin.uid,
      sourceChannel: "chat_approved_message",
    });
  }
  // Notification fan-out is written through the notification docs service.
  return { ok: true, publishedId: pubRef.id, receiverUid: receiverUid || null };
}

export async function adminEditPending({
  requestId,
  pendingId,
  editedText,
  editedPdfMeta,
} = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);

  if (!rid) throw new Error("requestId required");
  if (!pid) throw new Error("pendingId required");

  const patch = {};
  if (editedText != null) patch.editedText = safeStr(editedText);
  if (editedPdfMeta != null) {
    const normalized = normalizeAttachmentMeta(editedPdfMeta);
    patch.editedAttachmentMeta = normalized;
    patch.editedPdfMeta = normalized;
  }

  patch.editedAt = serverTimestamp();
  patch.editedBy = admin.uid;

  await updateDoc(doc(db, "serviceRequests", rid, "pendingMessages", pid), patch);
  return { ok: true };
}

/**
 * Admin: reject pending message (status: rejected)
 */
export async function adminRejectPending({ requestId, pendingId, reason = "" } = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);

  if (!rid) throw new Error("requestId required");
  if (!pid) throw new Error("pendingId required");

  const pendingRef = doc(db, "serviceRequests", rid, "pendingMessages", pid);
  const pendingSnap = await getDoc(pendingRef);
  const pending = pendingSnap.exists() ? pendingSnap.data() || {} : {};
  await updateDoc(pendingRef, {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: admin.uid,
    rejectReason: safeStr(reason),
  });

  try {
    await notifyRejectedPendingSender({
      requestId: rid,
      pendingId: pid,
      pending,
    });
  } catch (error) {
    console.warn("Failed to write rejected pending notification:", error?.message || error);
  }

  return { ok: true };
}

async function notifyRejectedPendingSender({ requestId, pendingId, pending } = {}) {
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);
  const fromRole = safeStr(pending?.fromRole).toLowerCase();
  const fromUid = safeStr(pending?.fromUid);
  if (!rid || !pid || !fromUid) return;

  if (fromRole === "user") {
    await createUserNotification({
      uid: fromUid,
      type: "MESSAGE_REJECTED_USER",
      requestId: rid,
      extras: { pendingId: pid },
    });
    return;
  }

  if (fromRole === "staff") {
    await createStaffNotification({
      uid: fromUid,
      type: "STAFF_MESSAGE_REJECTED",
      requestId: rid,
      extras: { pendingId: pid },
    });
  }
}

/**
 * ✅ Admin: HIDE pending message (safer)
 * Implemented as a "rejected" message with a hide flag in reason.
 */
export async function adminHidePending({ requestId, pendingId, reason = "" } = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);

  if (!rid) throw new Error("requestId required");
  if (!pid) throw new Error("pendingId required");

  const r = safeStr(reason);
  const finalReason = r ? `HIDDEN: ${r}` : "HIDDEN";

  const pendingRef = doc(db, "serviceRequests", rid, "pendingMessages", pid);
  const pendingSnap = await getDoc(pendingRef);
  const pending = pendingSnap.exists() ? pendingSnap.data() || {} : {};

  await updateDoc(pendingRef, {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: admin.uid,
    rejectReason: finalReason,
  });

  try {
    await notifyRejectedPendingSender({
      requestId: rid,
      pendingId: pid,
      pending,
    });
  } catch (error) {
    console.warn("Failed to write hidden pending notification:", error?.message || error);
  }

  return { ok: true };
}

/* -------------------- Admin: Direct send (publish without pending) -------------------- */

export async function adminSendTextDirect({ requestId, toRole, text } = {}) {
  mustUser();
  const rid = safeStr(requestId);
  const tr = normalizeRole(toRole);
  const msg = safeStr(text);

  if (!rid) throw new Error("requestId required");
  if (!msg) throw new Error("Message is empty");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const commandResult = await sendMessageCommand({
    requestId: rid,
    toRole: tr,
    type: "text",
    text: msg,
    actorRole: "admin",
  });
  if (!commandResult?.ok) throw new Error("Failed to send message.");
  return {
    ok: true,
    publishedId: safeStr(commandResult?.messageId),
    receiverUid: null,
  };
}

export async function adminSendAttachmentDirect({
  requestId,
  toRole,
  attachmentMeta = null,
  typeHint = "",
} = {}) {
  mustUser();
  const rid = safeStr(requestId);
  const tr = normalizeRole(toRole);
  if (!rid) throw new Error("requestId required");
  const inputMeta = normalizeAttachmentMeta(attachmentMeta);
  const meta = await ensureAttachmentStored({
    requestId: rid,
    fromRole: "admin",
    attachmentMeta: inputMeta,
  });
  const msgType = mapAttachmentType(meta, typeHint);

  if (!meta) throw new Error("attachmentMeta required");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const commandResult = await sendMessageCommand({
    requestId: rid,
    toRole: tr,
    type: msgType,
    attachmentMeta: toCommandAttachmentMeta(meta),
    pdfMeta: toCommandAttachmentMeta(meta),
    actorRole: "admin",
  });
  if (!commandResult?.ok) throw new Error("Failed to send message.");
  return {
    ok: true,
    publishedId: safeStr(commandResult?.messageId),
    receiverUid: null,
  };
}

export async function adminSendPdfMetaDirect({ requestId, toRole, pdfMeta } = {}) {
  return adminSendAttachmentDirect({
    requestId,
    toRole,
    attachmentMeta: normalizeLegacyPdfMeta(pdfMeta),
    typeHint: "document",
  });
}

/**
 * ✅ Admin direct send bundle (text + pdfMeta in one message)
 */
export async function adminSendBundleDirect({
  requestId,
  toRole,
  text = "",
  pdfMeta = null,
} = {}) {
  mustUser();
  const rid = safeStr(requestId);
  const tr = normalizeRole(toRole);

  const msg = safeStr(text);
  if (!rid) throw new Error("requestId required");
  const sourceMeta = normalizeAttachmentMeta(pdfMeta);
  const meta = await ensureAttachmentStored({
    requestId: rid,
    fromRole: "admin",
    attachmentMeta: sourceMeta,
  });

  if (tr === "admin") throw new Error("toRole cannot be admin");
  if (!msg && !meta) throw new Error("Bundle is empty (needs text and/or pdf)");

  const commandResult = await sendMessageCommand({
    requestId: rid,
    toRole: tr,
    type: "bundle",
    text: msg,
    attachmentMeta: toCommandAttachmentMeta(meta),
    pdfMeta: toCommandAttachmentMeta(meta),
    actorRole: "admin",
  });
  if (!commandResult?.ok) throw new Error("Failed to send message.");
  return {
    ok: true,
    publishedId: safeStr(commandResult?.messageId),
    receiverUid: null,
  };
}

/* -------------------- ✅ Compatibility exports -------------------- */
export const adminApprovePendingMessage = adminApprovePending;
export const adminRejectPendingMessage = adminRejectPending;
export const adminHidePendingMessage = adminHidePending;

// extra alias names (in case a panel used slightly different names)
export const adminSendPdfDirect = adminSendPdfMetaDirect;
export const adminSendTextDirectMessage = adminSendTextDirect;

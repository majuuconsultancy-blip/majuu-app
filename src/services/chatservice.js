// ✅ src/services/chatservice.js (FULL COPY-PASTE)
// Moderated chat per request:
// - user/staff send -> pendingMessages
// - admin reviews: approve/edit/reject/hide
// - approved -> messages (published)
// - admin can also send DIRECT (publish without pending)
// - unread: readState docs + notifications for user/staff
//
// ✅ Improvements in this version:
// - When admin approves a pending message, the published message keeps the ORIGINAL sent time
//   (createdAt = pending.createdAt) so message times look correct in chat.
// - "Hide" is now implemented as a SAFE REJECT (status: "rejected") instead of "hidden".
//   This is audit-safe and still removes it from moderation queue instantly.
// - Keeps compatibility exports your UI imports already.

import {
  addDoc,
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
  if (!["text", "pdf"].includes(t)) throw new Error("Invalid type");
  return t;
}

/**
 * Dumb PDF meta (no Storage yet).
 * Example:
 * { name: "passport.pdf", size: 123456, mime: "application/pdf", note: "..." }
 */
function normalizePdfMeta(pdfMeta) {
  if (!pdfMeta) return null;
  const name = safeStr(pdfMeta.name);
  const mime = safeStr(pdfMeta.mime || pdfMeta.type || "application/pdf");
  const size = Number(pdfMeta.size || 0) || 0;
  const note = safeStr(pdfMeta.note || "");

  if (!name) throw new Error("pdfMeta.name required");
  return { name, mime, size, note };
}

function makeNotificationDoc({ requestId, kind = "chat_message" } = {}) {
  const rid = safeStr(requestId);
  if (kind === "chat_pdf") {
    return {
      type: "chat_message",
      requestId: rid,
      title: "New document",
      body: "A document was sent to your request chat.",
      createdAt: serverTimestamp(),
      readAt: null,
    };
  }
  return {
    type: "chat_message",
    requestId: rid,
    title: "New message",
    body: "You have a new message on your request.",
    createdAt: serverTimestamp(),
    readAt: null,
  };
}

/* -------------------- Sender: User/Staff -> Pending -------------------- */

export async function sendPendingText({ requestId, fromRole, toRole, text } = {}) {
  const user = mustUser();
  const rid = safeStr(requestId);
  const fr = normalizeRole(fromRole);
  const tr = normalizeRole(toRole);
  const msg = safeStr(text);

  if (!rid) throw new Error("requestId required");
  if (!msg) throw new Error("Message is empty");
  if (fr === "admin") throw new Error("Admin should publish directly, not pending");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const payload = {
    fromRole: fr,
    fromUid: user.uid,
    toRole: tr,
    type: "text",
    text: msg,
    pdfMeta: null,
    status: "pending",
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(pendingCol(rid), payload);
  return { ok: true, id: ref.id };
}

export async function sendPendingPdf({ requestId, fromRole, toRole, pdfMeta } = {}) {
  const user = mustUser();
  const rid = safeStr(requestId);
  const fr = normalizeRole(fromRole);
  const tr = normalizeRole(toRole);
  const meta = normalizePdfMeta(pdfMeta);

  if (!rid) throw new Error("requestId required");
  if (!meta) throw new Error("pdfMeta required");
  if (fr === "admin") throw new Error("Admin should publish directly, not pending");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const payload = {
    fromRole: fr,
    fromUid: user.uid,
    toRole: tr,
    type: "pdf",
    text: "",
    pdfMeta: meta,
    status: "pending",
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(pendingCol(rid), payload);
  return { ok: true, id: ref.id };
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

  const userUid = safeStr(req.uid);
  const staffUid = safeStr(req.assignedTo);

  const pRef = doc(db, "serviceRequests", rid, "pendingMessages", pid);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()) throw new Error("Pending message not found");

  const p = { id: pSnap.id, ...pSnap.data() };

  const type = normalizeType(p.type);
  const toRole = normalizeRole(p.toRole);
  const fromRole = normalizeRole(p.fromRole);
  const fromUid = safeStr(p.fromUid);

  const finalText = editedText != null ? safeStr(editedText) : safeStr(p.text);
  const finalPdfMeta =
    editedPdfMeta != null ? normalizePdfMeta(editedPdfMeta) : p.pdfMeta || null;

  if (type === "text" && !finalText) throw new Error("Final text is empty");
  if (type === "pdf" && !finalPdfMeta) throw new Error("Final pdfMeta missing");

  const receiverUid =
    toRole === "user" ? userUid : toRole === "staff" ? staffUid : "";

  if (!receiverUid) {
    throw new Error("Receiver not found (missing assignedTo or uid).");
  }

  const batch = writeBatch(db);

  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole,
    fromUid,
    toRole,
    toUid: receiverUid,

    type,
    text: type === "text" ? finalText : "",
    pdfMeta: type === "pdf" ? finalPdfMeta : null,

    sourcePendingId: pid,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),

    // ✅ keep original send time
    createdAt: p?.createdAt || serverTimestamp(),
  });

  batch.update(pRef, {
    status: "approved",
    editedText: editedText != null ? finalText : null,
    editedPdfMeta: editedPdfMeta != null ? finalPdfMeta : null,
    editedBy: admin.uid,
    editedAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
    approvedBy: admin.uid,
  });

  const notifId = doc(collection(db, "users", receiverUid, "notifications")).id;
  const nRef = doc(db, "users", receiverUid, "notifications", notifId);

  batch.set(
    nRef,
    makeNotificationDoc({
      requestId: rid,
      kind: type === "pdf" ? "chat_pdf" : "chat_message",
    })
  );

  await batch.commit();
  return { ok: true, publishedId: pubRef.id };
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
  if (editedPdfMeta != null) patch.editedPdfMeta = normalizePdfMeta(editedPdfMeta);

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

  await updateDoc(doc(db, "serviceRequests", rid, "pendingMessages", pid), {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: admin.uid,
    rejectReason: safeStr(reason),
  });

  return { ok: true };
}

/**
 * ✅ Admin: HIDE pending message (safer)
 * Implemented as a "rejected" message with a hide flag in reason.
 * This removes it from the moderation queue instantly (because UI filters status == pending).
 */
export async function adminHidePending({ requestId, pendingId, reason = "" } = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);

  if (!rid) throw new Error("requestId required");
  if (!pid) throw new Error("pendingId required");

  const r = safeStr(reason);
  const finalReason = r ? `HIDDEN: ${r}` : "HIDDEN";

  await updateDoc(doc(db, "serviceRequests", rid, "pendingMessages", pid), {
    status: "rejected",
    rejectedAt: serverTimestamp(),
    rejectedBy: admin.uid,
    rejectReason: finalReason,
  });

  return { ok: true };
}

/* -------------------- Admin: Direct send (publish without pending) -------------------- */

export async function adminSendTextDirect({ requestId, toRole, text } = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const tr = normalizeRole(toRole);
  const msg = safeStr(text);

  if (!rid) throw new Error("requestId required");
  if (!msg) throw new Error("Message is empty");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const rSnap = await getDoc(reqRef(rid));
  if (!rSnap.exists()) throw new Error("Request not found");
  const req = { id: rSnap.id, ...rSnap.data() };

  const userUid = safeStr(req.uid);
  const staffUid = safeStr(req.assignedTo);

  const receiverUid = tr === "user" ? userUid : tr === "staff" ? staffUid : "";
  if (!receiverUid) throw new Error("Receiver not found (missing assignedTo or uid).");

  const batch = writeBatch(db);

  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole: "admin",
    fromUid: admin.uid,
    toRole: tr,
    toUid: receiverUid,

    type: "text",
    text: msg,
    pdfMeta: null,

    sourcePendingId: null,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  const notifId = doc(collection(db, "users", receiverUid, "notifications")).id;
  const nRef = doc(db, "users", receiverUid, "notifications", notifId);
  batch.set(nRef, makeNotificationDoc({ requestId: rid, kind: "chat_message" }));

  await batch.commit();
  return { ok: true, publishedId: pubRef.id };
}

export async function adminSendPdfMetaDirect({ requestId, toRole, pdfMeta } = {}) {
  const admin = mustUser();
  const rid = safeStr(requestId);
  const tr = normalizeRole(toRole);
  const meta = normalizePdfMeta(pdfMeta);

  if (!rid) throw new Error("requestId required");
  if (!meta) throw new Error("pdfMeta required");
  if (tr === "admin") throw new Error("toRole cannot be admin");

  const rSnap = await getDoc(reqRef(rid));
  if (!rSnap.exists()) throw new Error("Request not found");
  const req = { id: rSnap.id, ...rSnap.data() };

  const userUid = safeStr(req.uid);
  const staffUid = safeStr(req.assignedTo);

  const receiverUid = tr === "user" ? userUid : tr === "staff" ? staffUid : "";
  if (!receiverUid) throw new Error("Receiver not found (missing assignedTo or uid).");

  const batch = writeBatch(db);

  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole: "admin",
    fromUid: admin.uid,
    toRole: tr,
    toUid: receiverUid,

    type: "pdf",
    text: "",
    pdfMeta: meta,

    sourcePendingId: null,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  const notifId = doc(collection(db, "users", receiverUid, "notifications")).id;
  const nRef = doc(db, "users", receiverUid, "notifications", notifId);
  batch.set(nRef, makeNotificationDoc({ requestId: rid, kind: "chat_pdf" }));

  await batch.commit();
  return { ok: true, publishedId: pubRef.id };
}

/* -------------------- ✅ Compatibility exports -------------------- */
export const adminApprovePendingMessage = adminApprovePending;
export const adminRejectPendingMessage = adminRejectPending;
export const adminHidePendingMessage = adminHidePending;

// extra alias names (in case a panel used slightly different names)
export const adminSendPdfDirect = adminSendPdfMetaDirect;
export const adminSendTextDirectMessage = adminSendTextDirect;
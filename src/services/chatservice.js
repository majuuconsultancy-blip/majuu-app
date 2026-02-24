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
import { createStaffNotification, createUserNotification } from "./notificationDocs";
import { sendPushToAdmin } from "./pushServerClient";

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
  if (!["text", "pdf", "bundle"].includes(t)) throw new Error("Invalid type");
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

async function notifyAdminPendingModeration({ requestId, pendingId } = {}) {
  const rid = safeStr(requestId);
  const pid = safeStr(pendingId);
  if (!rid || !pid) return;

  await sendPushToAdmin({
    title: "New message for moderation",
    body: "A user or staff message is waiting for admin review.",
    data: {
      type: "ADMIN_NEW_MESSAGE",
      requestId: rid,
      pendingId: pid,
      route: `/app/admin/request/${encodeURIComponent(rid)}?openChat=1`,
    },
  });
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
  try {
    await notifyAdminPendingModeration({ requestId: rid, pendingId: ref.id });
  } catch (error) {
    console.warn("Failed to trigger admin pending-text push:", error?.message || error);
  }
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
  try {
    await notifyAdminPendingModeration({ requestId: rid, pendingId: ref.id });
  } catch (error) {
    console.warn("Failed to trigger admin pending-pdf push:", error?.message || error);
  }
  return { ok: true, id: ref.id };
}

/**
 * ✅ One pending message that can include BOTH text + pdfMeta
 * Use this when user attaches doc AND types a message.
 */
export async function sendPendingBundle({
  requestId,
  fromRole,
  toRole,
  text = "",
  pdfMeta = null,
} = {}) {
  const user = mustUser();
  const rid = safeStr(requestId);
  const fr = normalizeRole(fromRole);
  const tr = normalizeRole(toRole);

  const msg = safeStr(text);
  const meta = normalizePdfMeta(pdfMeta);

  if (!rid) throw new Error("requestId required");
  if (fr === "admin") throw new Error("Admin should publish directly, not pending");
  if (tr === "admin") throw new Error("toRole cannot be admin");
  if (!msg && !meta) throw new Error("Bundle is empty (needs text and/or pdf)");

  const payload = {
    fromRole: fr,
    fromUid: user.uid,
    toRole: tr,
    type: "bundle",
    text: msg, // can be ""
    pdfMeta: meta, // can be null
    status: "pending",
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(pendingCol(rid), payload);
  try {
    await notifyAdminPendingModeration({ requestId: rid, pendingId: ref.id });
  } catch (error) {
    console.warn("Failed to trigger admin pending-bundle push:", error?.message || error);
  }
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

  // ✅ Validate based on type
  if (type === "text" && !finalText) throw new Error("Final text is empty");
  if (type === "pdf" && !finalPdfMeta) throw new Error("Final pdfMeta missing");
  if (type === "bundle" && !finalText && !finalPdfMeta)
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
    text: type === "pdf" ? "" : finalText, // bundle/text can have text
    pdfMeta: type === "text" ? null : finalPdfMeta, // bundle/pdf can have pdfMeta

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
    editedPdfMeta: editedPdfMeta != null ? finalPdfMeta : null,
    editedBy: admin.uid,
    editedAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
    approvedBy: admin.uid,
  });

  // Chat unread is derived from published /messages + readState; no chat notification docs here.

  await batch.commit();
  try {
    await notifyPublishedRecipient({
      rid,
      req,
      toRole,
      receiverUid,
      publishedId: pubRef.id,
    });
  } catch (error) {
    console.warn("Failed to write message notification after approval:", error?.message || error);
  }
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

async function notifyPublishedRecipient({ rid, req, toRole, receiverUid, publishedId } = {}) {
  const requestId = safeStr(rid);
  const role = normalizeRole(toRole);
  const requestData = req && typeof req === "object" ? req : {};

  let uid =
    role === "user"
      ? safeStr(requestData?.uid)
      : role === "staff"
      ? safeStr(requestData?.assignedTo)
      : "";

  // Fallback to explicit resolver if the caller already computed one.
  if (!uid) uid = safeStr(receiverUid);

  if (!requestId || !uid) return;

  if (role === "user") {
    await createUserNotification({
      uid,
      type: "NEW_MESSAGE",
      requestId,
      extras: {
        messageId: safeStr(publishedId) || null,
      },
    });
    return;
  }

  if (role === "staff") {
    await createStaffNotification({
      uid,
      type: "STAFF_NEW_MESSAGE",
      requestId,
      extras: {
        messageId: safeStr(publishedId) || null,
      },
    });
  }
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

  const receiverUid = resolveReceiverUid({ req, toRole: tr }); // may be ""

  // ✅ FIX: allow staff direct send even if not assigned yet (publish anyway, skip notif)
  const batch = writeBatch(db);

  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole: "admin",
    fromUid: admin.uid,
    toRole: tr,
    toUid: receiverUid || null,

    type: "text",
    text: msg,
    pdfMeta: null,

    sourcePendingId: null,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),
    createdAt: serverTimestamp(),

    needsAssignment: tr === "staff" && !receiverUid ? true : false,
  });

  // Chat unread is derived from published /messages + readState; no chat notification docs here.

  await batch.commit();
  try {
    await notifyPublishedRecipient({
      rid,
      req,
      toRole: tr,
      receiverUid,
      publishedId: pubRef.id,
    });
  } catch (error) {
    console.warn("Failed to write direct text message notification:", error?.message || error);
  }
  return { ok: true, publishedId: pubRef.id, receiverUid: receiverUid || null };
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

  const receiverUid = resolveReceiverUid({ req, toRole: tr }); // may be ""

  const batch = writeBatch(db);

  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole: "admin",
    fromUid: admin.uid,
    toRole: tr,
    toUid: receiverUid || null,

    type: "pdf",
    text: "",
    pdfMeta: meta,

    sourcePendingId: null,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),
    createdAt: serverTimestamp(),

    needsAssignment: tr === "staff" && !receiverUid ? true : false,
  });

  // Chat unread is derived from published /messages + readState; no chat notification docs here.

  await batch.commit();
  try {
    await notifyPublishedRecipient({
      rid,
      req,
      toRole: tr,
      receiverUid,
      publishedId: pubRef.id,
    });
  } catch (error) {
    console.warn("Failed to write direct pdf message notification:", error?.message || error);
  }
  return { ok: true, publishedId: pubRef.id, receiverUid: receiverUid || null };
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
  const admin = mustUser();
  const rid = safeStr(requestId);
  const tr = normalizeRole(toRole);

  const msg = safeStr(text);
  const meta = normalizePdfMeta(pdfMeta);

  if (!rid) throw new Error("requestId required");
  if (tr === "admin") throw new Error("toRole cannot be admin");
  if (!msg && !meta) throw new Error("Bundle is empty (needs text and/or pdf)");

  const rSnap = await getDoc(reqRef(rid));
  if (!rSnap.exists()) throw new Error("Request not found");
  const req = { id: rSnap.id, ...rSnap.data() };

  const receiverUid = resolveReceiverUid({ req, toRole: tr }); // may be ""

  const batch = writeBatch(db);

  const pubRef = doc(publishedCol(rid));
  batch.set(pubRef, {
    requestId: rid,
    fromRole: "admin",
    fromUid: admin.uid,
    toRole: tr,
    toUid: receiverUid || null,

    type: "bundle",
    text: msg,
    pdfMeta: meta,

    sourcePendingId: null,
    approvedBy: admin.uid,
    approvedAt: serverTimestamp(),
    createdAt: serverTimestamp(),

    needsAssignment: tr === "staff" && !receiverUid ? true : false,
  });

  // Chat unread is derived from published /messages + readState; no chat notification docs here.

  await batch.commit();
  try {
    await notifyPublishedRecipient({
      rid,
      req,
      toRole: tr,
      receiverUid,
      publishedId: pubRef.id,
    });
  } catch (error) {
    console.warn("Failed to write direct bundle message notification:", error?.message || error);
  }
  return { ok: true, publishedId: pubRef.id, receiverUid: receiverUid || null };
}

/* -------------------- ✅ Compatibility exports -------------------- */
export const adminApprovePendingMessage = adminApprovePending;
export const adminRejectPendingMessage = adminRejectPending;
export const adminHidePendingMessage = adminHidePending;

// extra alias names (in case a panel used slightly different names)
export const adminSendPdfDirect = adminSendPdfMetaDirect;
export const adminSendTextDirectMessage = adminSendTextDirect;

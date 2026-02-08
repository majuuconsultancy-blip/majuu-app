// ✅ src/services/adminrequestservice.js
import {
  collection,
  query,
  where,
  orderBy,
  limit as qLimit,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase";

/**
 * ✅ Admin: fetch requests list
 * - optional filters: status, track, uid
 */
export async function getRequests({
  status = "",     // "new" | "contacted" | "closed" | "rejected"
  track = "",      // "study" | "work" | "travel"
  uid = "",        // user uid filter
  limit = 50,
} = {}) {
  const ref = collection(db, "serviceRequests");

  const clauses = [];

  if (status) clauses.push(where("status", "==", String(status).toLowerCase()));
  if (track) clauses.push(where("track", "==", String(track).toLowerCase()));
  if (uid) clauses.push(where("uid", "==", String(uid)));

  // ✅ orderBy createdAt desc (recommended)
  const qy = query(ref, ...clauses, orderBy("createdAt", "desc"), qLimit(limit));

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * ✅ Internal helper: create in-app notification
 * Writes to: users/{uid}/notifications
 */
async function createUserNotification(uid, payload) {
  if (!uid) return;

  const nRef = collection(db, "users", uid, "notifications");
  await addDoc(nRef, {
    ...payload,
    uid,
    createdAt: serverTimestamp(),
    readAt: null,
  });
}

/**
 * ✅ Admin: Accept a request
 * - sets status to "closed"
 * - stores note
 * - creates notification
 */
export async function adminAcceptRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);

  if (!snap.exists()) throw new Error("Request not found");

  const req = snap.data();
  const uid = req?.uid;

  // ✅ update request status
  await updateDoc(reqRef, {
    status: "closed",
    adminDecisionNote: String(note || "").trim(),
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // ✅ notify user
  await createUserNotification(uid, {
    type: "request",
    event: "accepted",
    title: `${String(req?.track || "Request").toUpperCase()} accepted`,
    body:
      String(note || "").trim() ||
      "Your request was accepted. Open Progress to view details.",
    link: `/app/request/${requestId}`,
    requestId,
  });

  return true;
}

/**
 * ✅ Admin: Reject a request
 * - sets status to "rejected"
 * - stores note
 * - creates notification
 */
export async function adminRejectRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!String(note || "").trim()) throw new Error("Note is required for rejection");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);

  if (!snap.exists()) throw new Error("Request not found");

  const req = snap.data();
  const uid = req?.uid;

  // ✅ update request status
  await updateDoc(reqRef, {
    status: "rejected",
    adminDecisionNote: String(note || "").trim(),
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // ✅ notify user
  await createUserNotification(uid, {
    type: "request",
    event: "rejected",
    title: `${String(req?.track || "Request").toUpperCase()} needs changes`,
    body: String(note || "").trim(),
    link: `/app/request/${requestId}`,
    requestId,
  });

  return true;
}
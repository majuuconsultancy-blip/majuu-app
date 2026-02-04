import {
  collection,
  getDocs,
  query,
  orderBy,
  where,
  limit,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

export async function getRequests({ status = "new", max = 50 }) {
  const cleanStatus = String(status || "new").toLowerCase();
  const cleanMax = Math.max(1, Math.min(Number(max || 50), 250)); // safety cap

  const ref = collection(db, "serviceRequests");
  const q = query(
    ref,
    where("status", "==", cleanStatus),
    orderBy("createdAt", "desc"),
    limit(cleanMax)
  );

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function adminAcceptRequest({ requestId, note = "" }) {
  const id = String(requestId || "").trim();
  if (!id) throw new Error("Missing requestId");

  await updateDoc(doc(db, "serviceRequests", id), {
    status: "closed", // ✅ keep Firestore value; UI shows "Accepted"
    adminDecision: "accepted",
    adminDecisionNote: String(note || "").trim(),
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function adminRejectRequest({ requestId, note }) {
  const id = String(requestId || "").trim();
  if (!id) throw new Error("Missing requestId");

  const clean = String(note || "").trim();
  if (!clean) throw new Error("Rejection note is required.");

  await updateDoc(doc(db, "serviceRequests", id), {
    status: "rejected",
    adminDecision: "rejected",
    adminDecisionNote: clean,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
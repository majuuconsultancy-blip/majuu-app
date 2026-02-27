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
  serverTimestamp,
  increment,
} from "firebase/firestore";

import { db, auth } from "../firebase";
import { createUserNotification } from "./notificationDocs";

/* ======================================================
   REQUEST LIST (unchanged)
====================================================== */
export async function getRequests({
  status = "",
  track = "",
  uid = "",
  max,
  limit = 50,
} = {}) {
  const ref = collection(db, "serviceRequests");
  const clauses = [];

  const s = String(status || "").trim().toLowerCase();
  const t = String(track || "").trim().toLowerCase();
  const u = String(uid || "").trim();

  if (s) clauses.push(where("status", "==", s));
  if (t) clauses.push(where("track", "==", t));
  if (u) clauses.push(where("uid", "==", u));

  const take = Number.isFinite(Number(max)) ? Number(max) : Number(limit) || 50;

  const qy = query(ref, ...clauses, orderBy("createdAt", "desc"), qLimit(take));
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ======================================================
   🔥 STAFF PERFORMANCE UPDATE (enhanced)
   - Uses staffWorkMinutes saved by staff screen
   - Auto-block only AFTER 5 completed
   - Prevent double-counting via request flag
====================================================== */
async function updateStaffStatsAfterDecision({ requestId, finalDecision }) {
  const reqRef = doc(db, "serviceRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) return;

  const req = reqSnap.data();

  // ✅ prevent double counting (if admin re-clicks / reloads)
  if (req?.adminFinalDecisionRecorded) return;

  const staffUid = String(req?.assignedTo || "").trim();
  if (!staffUid) {
    // still mark recorded so it doesn't keep trying forever
    await updateDoc(reqRef, {
      adminFinalDecisionRecorded: true,
      adminFinalDecisionRecordedAt: serverTimestamp(),
    });
    return;
  }

  const staffRef = doc(db, "staff", staffUid);

  const success = finalDecision === "accepted";

  // Prefer the minutes your staff screen stores:
  // staffWorkMinutes is number | null
  const mins = Number.isFinite(Number(req?.staffWorkMinutes))
    ? Number(req.staffWorkMinutes)
    : null;

  // 1) increment raw counters
  const updates = {
    "stats.totalDone": increment(1),
    "stats.successCount": success ? increment(1) : increment(0),
    "stats.failCount": success ? increment(0) : increment(1),
    "stats.lastUpdatedAt": serverTimestamp(),
  };

  if (mins !== null && mins > 0) {
    updates["stats.totalMinutes"] = increment(mins);
  }

  await updateDoc(staffRef, updates);

  // 2) compute derived fields (avgMinutes, successRate) AFTER increment
  //    -> read staff again
  const staffSnap = await getDoc(staffRef);
  const staff = staffSnap.exists() ? staffSnap.data() : {};

  const totalDone = Number(staff?.stats?.totalDone || 0);
  const successCount = Number(staff?.stats?.successCount || 0);
  const failCount = Number(staff?.stats?.failCount || 0);
  const totalMinutes = Number(staff?.stats?.totalMinutes || 0);

  const successRate =
    totalDone > 0 ? Number((successCount / totalDone).toFixed(3)) : 0;

  const avgMinutes =
    totalDone > 0 && totalMinutes > 0
      ? Math.round(totalMinutes / totalDone)
      : null;

  // ✅ auto-block rule (ONLY after 5 done)
  // change threshold anytime:
  const MIN_DONE_BEFORE_BLOCK = 5;
  const MIN_SUCCESS_RATE = 0.5; // 50% (example)

  const shouldBlock = totalDone >= MIN_DONE_BEFORE_BLOCK && successRate < MIN_SUCCESS_RATE;

  await updateDoc(staffRef, {
    "stats.successRate": successRate,
    "stats.avgMinutes": avgMinutes,
    ...(shouldBlock
      ? {
          active: false,
          blockedAt: serverTimestamp(),
          blockedReason: `Auto-block: successRate ${successRate} after ${totalDone} tasks`,
        }
      : {}),
  });

  // 3) mark staff task with final admin decision
  // (guard: task might not exist if unassigned later)
  try {
    await updateDoc(doc(db, "staff", staffUid, "tasks", requestId), {
      adminFinal: finalDecision,
      adminFinalAt: serverTimestamp(),
    });
  } catch (e) {
    // ignore
  }

  // 4) mark request as recorded so it can't double-count
  await updateDoc(reqRef, {
    adminFinalDecisionRecorded: true,
    adminFinalDecisionRecordedAt: serverTimestamp(),
    adminFinal: finalDecision,
    adminFinalAt: serverTimestamp(),
  });
}

/* ======================================================
   ✅ ADMIN: ACCEPT REQUEST (ENHANCED)
====================================================== */
export async function adminAcceptRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);

  if (!snap.exists()) throw new Error("Request not found");

  const req = snap.data();
  const uid = String(req?.uid || "").trim();

  await updateDoc(reqRef, {
    status: "closed",
    adminDecisionNote: String(note || "").trim(),
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateStaffStatsAfterDecision({
    requestId,
    finalDecision: "accepted",
  });

  if (uid) {
    try {
      await createUserNotification({
        uid,
        type: "REQUEST_ACCEPTED",
        requestId,
      });
    } catch (error) {
      console.warn("Failed to write REQUEST_ACCEPTED notification:", error?.message || error);
    }
  }

  return true;
}

/* ======================================================
   ✅ ADMIN: REJECT REQUEST (ENHANCED)
====================================================== */
export async function adminRejectRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!String(note || "").trim()) throw new Error("Note is required for rejection");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);

  if (!snap.exists()) throw new Error("Request not found");

  const req = snap.data();
  const uid = String(req?.uid || "").trim();

  await updateDoc(reqRef, {
    status: "rejected",
    adminDecisionNote: String(note || "").trim(),
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateStaffStatsAfterDecision({
    requestId,
    finalDecision: "rejected",
  });

  if (uid) {
    try {
      await createUserNotification({
        uid,
        type: "REQUEST_REJECTED",
        requestId,
      });
    } catch (error) {
      console.warn("Failed to write REQUEST_REJECTED notification:", error?.message || error);
    }
  }

  return true;
}

/* ======================================================
   ✅ ADMIN: SOFT DELETE REQUEST (safe for nested subcollections)
====================================================== */
export async function adminSoftDeleteRequest({ requestId } = {}) {
  if (!requestId) throw new Error("Missing requestId");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) throw new Error("Request not found");

  const adminUid = String(auth.currentUser?.uid || "").trim();

  await updateDoc(reqRef, {
    deletedByAdmin: true,
    adminDeletedAt: serverTimestamp(),
    adminDeletedBy: adminUid || null,
    updatedAt: serverTimestamp(),
  });

  return true;
}

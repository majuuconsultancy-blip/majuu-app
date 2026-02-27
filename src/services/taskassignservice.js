// ✅ src/services/taskassignservice.js
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { createStaffNotification, createUserNotification } from "./notificationDocs";

/**
 * Performance thresholds (ONLY enforced after doneCount >= 5)
 * Tune these anytime:
 */
const AUTO_BLOCK_MIN_DONE = 5; // only evaluate after 5 completed requests
const AUTO_BLOCK_MIN_SUCCESS = 0.4; // success rate below this => block
const AUTO_BLOCK_MAX_AVG_MIN = 72 * 60; // avg time above this (72h) => block

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/**
 * ✅ Backwards compatible performance reader:
 * supports either:
 *   staff.performance.{doneCount, successCount, avgMinutes, blocked, blockedReason...}
 * OR
 *   staff.stats.{totalDone, successCount, failCount, totalHours, avgMinutes}
 *
 * NOTE:
 * Your adminrequestservice.js updates:
 *   stats.totalDone, stats.successCount, stats.failCount, stats.totalHours
 * so here we derive avgMinutes if not present.
 */
function computePerfSummary(staffDoc) {
  const perf = staffDoc?.performance || {};
  const stats = staffDoc?.stats || staffDoc?.stats?.stats || {}; // extra safety

  // Prefer performance.* if present, else fallback to stats.*
  const doneCount = Number(perf?.doneCount ?? stats?.totalDone ?? stats?.doneCount ?? 0) || 0;
  const successCount = Number(perf?.successCount ?? stats?.successCount ?? 0) || 0;

  // avgMinutes could exist in performance or stats,
  // but if stats.totalHours exists we can derive avgMinutes:
  const totalHours = Number(stats?.totalHours ?? 0) || 0;

  const avgMinutesRaw = perf?.avgMinutes ?? stats?.avgMinutes ?? null;

  let avgMinutes = Number.isFinite(Number(avgMinutesRaw)) ? Number(avgMinutesRaw) : 0;

  // Derive avgMinutes from totalHours/totalDone if avgMinutes missing
  if ((!avgMinutes || avgMinutes <= 0) && doneCount > 0 && totalHours > 0) {
    avgMinutes = (totalHours / doneCount) * 60;
  }

  // blocked flag:
  // - true if perf.blocked
  // - OR staff.active === false (treat inactive as blocked for assignment safety)
  const blocked = Boolean(perf?.blocked) || staffDoc?.active === false;

  const successRate = doneCount > 0 ? clamp(successCount / doneCount, 0, 1) : 0;

  return { doneCount, successCount, avgMinutes, successRate, blocked };
}

function shouldAutoBlock({ doneCount, successRate, avgMinutes }) {
  // Only evaluate after enough history
  if (doneCount < AUTO_BLOCK_MIN_DONE) return { block: false, reason: "" };

  // Low success rate
  if (Number.isFinite(successRate) && successRate < AUTO_BLOCK_MIN_SUCCESS) {
    return {
      block: true,
      reason: `Auto-blocked: low success rate (${Math.round(successRate * 100)}%) after ${doneCount} tasks`,
    };
  }

  // Too slow on average
  if (Number.isFinite(avgMinutes) && avgMinutes > AUTO_BLOCK_MAX_AVG_MIN) {
    return {
      block: true,
      reason: `Auto-blocked: slow avg completion time (${Math.round(avgMinutes)} mins) after ${doneCount} tasks`,
    };
  }

  return { block: false, reason: "" };
}

/** Admin: list staff docs (for dropdown) */
export async function listStaff({ max = 50 } = {}) {
  const q = query(collection(db, "staff"), orderBy("email"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

/** Admin: assign a request to a staff member */
export async function assignRequestToStaff({
  requestId,
  staffUid,
  speciality = "",
  track = "",

  // optional fields to display in staff portal
  country = "",
  requestType = "",
  serviceName = "",
  applicantName = "",
} = {}) {
  if (!requestId) throw new Error("requestId required");
  if (!staffUid) throw new Error("staffUid required");

  const admin = auth.currentUser;
  if (!admin) throw new Error("Not signed in");

  const staffRef = doc(db, "staff", staffUid);
  const reqRef = doc(db, "serviceRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  const reqData = reqSnap.exists() ? reqSnap.data() || {} : {};
  const ownerUid = String(reqData?.uid || "").trim();

  // ✅ Hard guard: check staff state + auto-block rule
  const staffSnap = await getDoc(staffRef);
  if (!staffSnap.exists()) throw new Error("Staff record not found");

  const staffDoc = { uid: staffSnap.id, ...staffSnap.data() };
  const active = staffDoc?.active !== false;

  const { doneCount, successRate, avgMinutes, blocked } = computePerfSummary(staffDoc);

  // If already blocked or inactive, reject immediately
  if (!active) throw new Error("This staff member is inactive.");
  if (blocked) throw new Error("This staff member is blocked due to low performance.");

  // Auto-block evaluation (ONLY after 5 completed tasks)
  const auto = shouldAutoBlock({ doneCount, successRate, avgMinutes });
  if (auto.block) {
    // Mark them blocked and stop assignment
    const batchBlock = writeBatch(db);

    batchBlock.set(
      staffRef,
      {
        performance: {
          ...(staffDoc.performance || {}),
          blocked: true,
          blockedAt: serverTimestamp(),
          blockedReason: auto.reason || "Auto-blocked by system",
        },
        // optional: also set active false for safety
        active: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await batchBlock.commit();
    throw new Error("Staff auto-blocked (bad performance). Pick another staff.");
  }

  // ✅ Proceed with normal assignment
  const batch = writeBatch(db);

  const taskRef = doc(db, "staff", staffUid, "tasks", requestId);

  batch.set(
    taskRef,
    {
      requestId,
      // Keep task in "assigned" until staff explicitly taps Start work.
      status: "assigned",
      assignedAt: serverTimestamp(),

      track: String(track || "").trim().toLowerCase(),
      speciality: String(speciality || "").trim().toLowerCase(),

      // optional display fields (safe)
      country: String(country || "").trim(),
      requestType: String(requestType || "").trim().toLowerCase(),
      serviceName: String(serviceName || "").trim(),
      applicantName: String(applicantName || "").trim(),

      // audit
      assignedBy: admin.uid,
    },
    { merge: true }
  );

  batch.set(
    reqRef,
    {
      assignedTo: staffUid,
      assignedAt: serverTimestamp(),
      assignedBy: admin.uid,

      // Reset staff workflow state on every assignment/reassignment so Start Work
      // modal is shown and timing/scoring starts from the current assignee.
      staffStatus: "assigned",
      staffDecision: "none",
      staffUpdatedAt: serverTimestamp(),

      staffStartedAt: null,
      staffStartedAtMs: null,
      staffStartedBy: null,

      staffCompletedAt: null,
      staffCompletedAtMs: null,
      staffCompletedBy: null,
      staffWorkMinutes: null,
    },
    { merge: true }
  );

  await batch.commit();

  try {
    if (ownerUid) {
      await createUserNotification({
        uid: ownerUid,
        type: "REQUEST_ASSIGNED",
        requestId,
      });
    }
    await createStaffNotification({
      uid: staffUid,
      type: "STAFF_ASSIGNED_REQUEST",
      requestId,
    });
  } catch (error) {
    console.warn("Failed to write assignment notifications:", error?.message || error);
  }

  return { ok: true, requestId, staffUid };
}

/** Admin: unassign a request */
export async function unassignRequest({ requestId, staffUid } = {}) {
  if (!requestId) throw new Error("requestId required");
  if (!staffUid) throw new Error("staffUid required");

  const batch = writeBatch(db);

  const reqRef = doc(db, "serviceRequests", requestId);
  const taskRef = doc(db, "staff", staffUid, "tasks", requestId);

  // remove task doc
  batch.delete(taskRef);

  // remove assignment fields from request
  batch.set(
    reqRef,
    {
      assignedTo: deleteField(),
      assignedAt: deleteField(),
      assignedBy: deleteField(),
    },
    { merge: true }
  );

  await batch.commit();

  return { ok: true };
}

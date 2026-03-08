import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import {
  getSpecialityLabel,
  inferRequestSpeciality,
  normalizeSpecialities,
  normalizeSpecialityKey,
} from "../constants/staffSpecialities";
import { createStaffNotification, createUserNotification } from "./notificationDocs";

const ACTIVE_REQUEST_STATUSES = new Set(["new", "contacted"]);

const AUTO_BLOCK_MIN_DONE = 5;
const AUTO_BLOCK_MIN_SUCCESS = 0.4;
const AUTO_BLOCK_MAX_AVG_MIN = 72 * 60;

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computePerfSummary(staffDoc) {
  const perf = staffDoc?.performance || {};
  const stats = staffDoc?.stats || staffDoc?.stats?.stats || {};

  const doneCount = toNum(perf?.doneCount ?? stats?.totalDone ?? stats?.doneCount, 0);
  const reviewedCount = toNum(perf?.reviewedCount ?? stats?.totalReviewed, 0);
  const matchCount = toNum(perf?.matchCount ?? stats?.matchedDecisionCount ?? stats?.successCount, 0);
  const successCountLegacy = toNum(perf?.successCount ?? stats?.successCount, 0);
  const totalMinutes = toNum(stats?.totalMinutes, 0);

  const avgMinutesRaw = perf?.avgMinutes ?? stats?.avgMinutes ?? null;
  let avgMinutes = toNum(avgMinutesRaw, 0);
  if ((!avgMinutes || avgMinutes <= 0) && doneCount > 0 && totalMinutes > 0) {
    avgMinutes = totalMinutes / doneCount;
  }

  let successRateRaw = Number(perf?.successRate ?? stats?.successRate ?? stats?.matchRate);
  if (!Number.isFinite(successRateRaw)) {
    if (reviewedCount > 0) successRateRaw = matchCount / reviewedCount;
    else if (doneCount > 0) successRateRaw = successCountLegacy / doneCount;
    else successRateRaw = 0;
  }
  const successRate = clamp(successRateRaw, 0, 1);

  const blocked = Boolean(perf?.blocked) || staffDoc?.active === false;
  return { doneCount, reviewedCount, matchCount, avgMinutes, successRate, blocked };
}

function shouldAutoBlock({ doneCount, reviewedCount, successRate, avgMinutes }) {
  const reviewed = Math.max(toNum(doneCount, 0), toNum(reviewedCount, 0));
  if (reviewed < AUTO_BLOCK_MIN_DONE) return { block: false, reason: "" };

  if (Number.isFinite(successRate) && successRate < AUTO_BLOCK_MIN_SUCCESS) {
    return {
      block: true,
      reason: `Auto-blocked: low match rate (${Math.round(successRate * 100)}%) after ${reviewed} reviews`,
    };
  }

  if (Number.isFinite(avgMinutes) && avgMinutes > AUTO_BLOCK_MAX_AVG_MIN) {
    return {
      block: true,
      reason: `Auto-blocked: slow avg completion time (${Math.round(avgMinutes)} mins) after ${reviewed} reviews`,
    };
  }

  return { block: false, reason: "" };
}

function isCountedAsActiveLoad(requestDoc) {
  const status = String(requestDoc?.status || "").trim().toLowerCase();
  const staffStatus = String(requestDoc?.staffStatus || "assigned")
    .trim()
    .toLowerCase();

  if (!ACTIVE_REQUEST_STATUSES.has(status)) return false;
  if (staffStatus === "done") return false;
  return true;
}

function computeRankScore(staffDoc) {
  const perf = computePerfSummary(staffDoc);
  const active = staffDoc?.active !== false;

  let speedScore = 0.5;
  if (perf.avgMinutes > 0) {
    const bounded = clamp(perf.avgMinutes, 30, 10080);
    speedScore = clamp(1 - bounded / 10500, 0.05, 1);
  }

  let score = 0;
  if (perf.blocked) score -= 9999;
  if (!active) score -= 2000;
  score += perf.successRate * 100;
  score += speedScore * 35;
  score += clamp(perf.doneCount, 0, 40) * 1.2;
  return Math.round(score);
}

function activeLoadQueryForStaff(staffUid) {
  return query(
    collection(db, "serviceRequests"),
    where("assignedTo", "==", String(staffUid || "").trim()),
    where("status", "in", Array.from(ACTIVE_REQUEST_STATUSES)),
    limit(500)
  );
}

function countActiveFromSnapshot(snap, { ignoreRequestId = "" } = {}) {
  let count = 0;
  snap.docs.forEach((d) => {
    const data = d.data() || {};
    if (!isCountedAsActiveLoad(data)) return;
    if (ignoreRequestId && String(d.id) === String(ignoreRequestId)) return;
    count += 1;
  });
  return count;
}

async function getActiveLoadMap() {
  const qy = query(
    collection(db, "serviceRequests"),
    where("status", "in", Array.from(ACTIVE_REQUEST_STATUSES))
  );
  const snap = await getDocs(qy);
  const counts = {};

  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const assignedTo = String(data?.assignedTo || "").trim();
    if (!assignedTo) return;
    if (!isCountedAsActiveLoad(data)) return;
    counts[assignedTo] = (counts[assignedTo] || 0) + 1;
  });

  return counts;
}

export async function listStaff({ max = 50, includeLoad = false } = {}) {
  const qy = query(collection(db, "staff"), orderBy("email"), limit(max));
  const snap = await getDocs(qy);
  const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));

  let activeLoadByUid = {};
  if (includeLoad && rows.length) {
    activeLoadByUid = await getActiveLoadMap();
  }

  return rows.map((staffDoc) => {
    const perf = computePerfSummary(staffDoc);
    const maxActive = Math.max(1, toNum(staffDoc?.maxActive, 2));
    const activeLoad = includeLoad
      ? Math.max(0, toNum(activeLoadByUid?.[String(staffDoc?.uid || "").trim()], 0))
      : 0;

    return {
      ...staffDoc,
      maxActive,
      activeLoad,
      availableSlots: Math.max(0, maxActive - activeLoad),
      rankScore: computeRankScore(staffDoc),
      perfDoneCount: perf.doneCount,
      perfSuccessRate: perf.successRate,
      perfAvgMinutes: perf.avgMinutes,
      perfBlocked: perf.blocked,
    };
  });
}

export async function assignRequestToStaff({
  requestId,
  staffUid,
  speciality = "",
  track = "",
  country = "",
  requestType = "",
  serviceName = "",
  applicantName = "",
} = {}) {
  if (!requestId) throw new Error("requestId required");
  if (!staffUid) throw new Error("staffUid required");

  const admin = auth.currentUser;
  if (!admin) throw new Error("Not signed in");

  const safeRequestId = String(requestId || "").trim();
  const safeStaffUid = String(staffUid || "").trim();

  const reqRef = doc(db, "serviceRequests", safeRequestId);
  const staffRef = doc(db, "staff", safeStaffUid);
  const taskRef = doc(db, "staff", safeStaffUid, "tasks", safeRequestId);
  const loadQuery = activeLoadQueryForStaff(safeStaffUid);

  const txResult = await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);
    if (!reqSnap.exists()) throw new Error("Request not found");
    const reqData = reqSnap.data() || {};

    const staffSnap = await transaction.get(staffRef);
    if (!staffSnap.exists()) throw new Error("Staff record not found");
    const staffDoc = { uid: staffSnap.id, ...staffSnap.data() };

    const perf = computePerfSummary(staffDoc);
    const active = staffDoc?.active !== false;
    if (!active) throw new Error("This staff member is inactive.");
    if (perf.blocked) throw new Error("This staff member is blocked due to low performance.");

    const auto = shouldAutoBlock(perf);
    if (auto.block) {
      transaction.set(
        staffRef,
        {
          performance: {
            ...(staffDoc.performance || {}),
            blocked: true,
            blockedAt: serverTimestamp(),
            blockedReason: auto.reason || "Auto-blocked by system",
          },
          active: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      return { autoBlocked: true };
    }

    const inferredSpeciality = inferRequestSpeciality({
      ...reqData,
      requestType: requestType || reqData?.requestType,
      serviceName: serviceName || reqData?.serviceName,
      fullPackageItem: reqData?.fullPackageItem,
    });
    const explicitSpeciality = normalizeSpecialityKey(speciality);
    const safeSpeciality = explicitSpeciality !== "unknown" ? explicitSpeciality : inferredSpeciality;

    const staffSpecialities = normalizeSpecialities(staffDoc?.specialities);
    if (
      safeSpeciality &&
      safeSpeciality !== "unknown" &&
      !staffSpecialities.includes(String(safeSpeciality))
    ) {
      throw new Error(`Speciality mismatch: this request needs ${getSpecialityLabel(safeSpeciality)}.`);
    }

    const loadSnap = await transaction.get(loadQuery);
    const previousAssignee = String(reqData?.assignedTo || "").trim();
    const ignoreRequestId = previousAssignee === safeStaffUid ? safeRequestId : "";
    const activeAssignedCount = countActiveFromSnapshot(loadSnap, { ignoreRequestId });
    const maxActive = Math.max(1, toNum(staffDoc?.maxActive, 2));
    if (activeAssignedCount >= maxActive) {
      throw new Error(
        `This staff member is at capacity (${activeAssignedCount}/${maxActive} active requests).`
      );
    }

    if (previousAssignee && previousAssignee !== safeStaffUid) {
      const oldTaskRef = doc(db, "staff", previousAssignee, "tasks", safeRequestId);
      transaction.delete(oldTaskRef);
    }

    transaction.set(
      taskRef,
      {
        requestId: safeRequestId,
        status: "assigned",
        assignedAt: serverTimestamp(),
        track: String(track || "").trim().toLowerCase(),
        speciality: String(safeSpeciality || "").trim().toLowerCase(),
        country: String(country || "").trim(),
        requestType: String(requestType || "").trim().toLowerCase(),
        serviceName: String(serviceName || "").trim(),
        applicantName: String(applicantName || "").trim(),
        assignedBy: admin.uid,
      },
      { merge: true }
    );

    transaction.set(
      reqRef,
      {
        assignedTo: safeStaffUid,
        assignedAt: serverTimestamp(),
        assignedBy: admin.uid,
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
        needsReassignment: false,
        reassignUrgent: false,
        reassignReason: deleteField(),
        reassignNeededAt: deleteField(),
        reassignFromStaffUid: deleteField(),
        staffStartReminder3hSentAt: deleteField(),
        staffStartReminder3hSentAtMs: deleteField(),
      },
      { merge: true }
    );

    const auditRef = doc(collection(db, "serviceRequests", safeRequestId, "assignmentAudit"));
    transaction.set(auditRef, {
      action: "assign",
      requestId: safeRequestId,
      fromStaffUid: previousAssignee || null,
      toStaffUid: safeStaffUid,
      byUid: admin.uid,
      at: serverTimestamp(),
      atMs: Date.now(),
      speciality: String(safeSpeciality || "").trim().toLowerCase() || null,
      track: String(track || "").trim().toLowerCase() || null,
    });

    return {
      autoBlocked: false,
      ownerUid: String(reqData?.uid || "").trim(),
      previousAssignee,
    };
  });

  if (txResult?.autoBlocked) {
    throw new Error("Staff auto-blocked (bad performance). Pick another staff.");
  }

  try {
    if (txResult?.ownerUid) {
      await createUserNotification({
        uid: txResult.ownerUid,
        type: "REQUEST_ASSIGNED",
        requestId: safeRequestId,
      });
    }
    await createStaffNotification({
      uid: safeStaffUid,
      type: "STAFF_ASSIGNED_REQUEST",
      requestId: safeRequestId,
    });
    if (txResult?.previousAssignee && txResult.previousAssignee !== safeStaffUid) {
      await createStaffNotification({
        uid: txResult.previousAssignee,
        type: "STAFF_UNASSIGNED_REQUEST",
        requestId: safeRequestId,
      });
    }
  } catch (error) {
    console.warn("Failed to write assignment notifications:", error?.message || error);
  }

  return { ok: true, requestId: safeRequestId, staffUid: safeStaffUid };
}

export async function unassignRequest({ requestId, staffUid, reason = "Manual unassign by admin" } = {}) {
  if (!requestId) throw new Error("requestId required");

  const admin = auth.currentUser;
  if (!admin) throw new Error("Not signed in");

  const safeRequestId = String(requestId || "").trim();
  const requestedUid = String(staffUid || "").trim();
  const reqRef = doc(db, "serviceRequests", safeRequestId);

  const txResult = await runTransaction(db, async (transaction) => {
    const reqSnap = await transaction.get(reqRef);
    if (!reqSnap.exists()) throw new Error("Request not found");
    const reqData = reqSnap.data() || {};

    const currentAssignedUid = String(reqData?.assignedTo || "").trim();
    const targetUid = requestedUid || currentAssignedUid;
    if (!targetUid) throw new Error("No assignee found.");

    if (requestedUid && currentAssignedUid && requestedUid !== currentAssignedUid) {
      throw new Error("Assignee mismatch. Refresh and try again.");
    }

    const taskRef = doc(db, "staff", targetUid, "tasks", safeRequestId);
    transaction.delete(taskRef);

    transaction.set(
      reqRef,
      {
        assignedTo: deleteField(),
        assignedAt: deleteField(),
        assignedBy: deleteField(),
        staffStatus: deleteField(),
        staffDecision: deleteField(),
        staffUpdatedAt: serverTimestamp(),
        staffStartedAt: deleteField(),
        staffStartedAtMs: deleteField(),
        staffStartedBy: deleteField(),
        staffCompletedAt: deleteField(),
        staffCompletedAtMs: deleteField(),
        staffCompletedBy: deleteField(),
        staffWorkMinutes: deleteField(),
        needsReassignment: false,
        reassignUrgent: false,
        reassignReason: deleteField(),
        reassignNeededAt: deleteField(),
        reassignFromStaffUid: deleteField(),
        staffStartReminder3hSentAt: deleteField(),
        staffStartReminder3hSentAtMs: deleteField(),
      },
      { merge: true }
    );

    const auditRef = doc(collection(db, "serviceRequests", safeRequestId, "assignmentAudit"));
    transaction.set(auditRef, {
      action: "unassign",
      requestId: safeRequestId,
      fromStaffUid: targetUid,
      toStaffUid: null,
      byUid: admin.uid,
      at: serverTimestamp(),
      atMs: Date.now(),
      reason: String(reason || "").trim() || "Manual unassign",
    });

    return { unassignedUid: targetUid };
  });

  try {
    if (txResult?.unassignedUid) {
      await createStaffNotification({
        uid: txResult.unassignedUid,
        type: "STAFF_UNASSIGNED_REQUEST",
        requestId: safeRequestId,
      });
    }
  } catch (error) {
    console.warn("Failed to write unassign notification:", error?.message || error);
  }

  return { ok: true };
}

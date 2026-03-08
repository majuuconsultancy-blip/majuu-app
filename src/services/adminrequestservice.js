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
  deleteField,
  writeBatch,
} from "firebase/firestore";

import { db, auth } from "../firebase";
import { createStaffNotification, createUserNotification } from "./notificationDocs";

const ACTIVE_REQUEST_STATUSES = ["new", "contacted"];
const STALE_ASSIGNMENT_HOURS = 24;
const REMINDER_LEAD_HOURS = 3;

function tsMs(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  return 0;
}

function safeDecision(value) {
  return String(value || "").trim().toLowerCase();
}

function expectedRecommendationForDecision(finalDecision) {
  return finalDecision === "accepted" ? "recommend_accept" : "recommend_reject";
}

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

export async function sweepStaleAssignments({
  staleHours = STALE_ASSIGNMENT_HOURS,
  max = 350,
} = {}) {
  const staleMs = Math.max(1, Number(staleHours) || STALE_ASSIGNMENT_HOURS) * 60 * 60 * 1000;
  const reminderLeadMs = Math.max(1, REMINDER_LEAD_HOURS) * 60 * 60 * 1000;
  const nowMs = Date.now();
  const staleCutoff = nowMs - staleMs;
  const reminderCutoff = nowMs - Math.max(0, staleMs - reminderLeadMs);

  const qy = query(
    collection(db, "serviceRequests"),
    where("status", "in", ACTIVE_REQUEST_STATUSES),
    qLimit(Math.max(1, Number(max) || 350))
  );
  const snap = await getDocs(qy);

  const staleRows = [];
  const reminderRows = [];

  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const requestId = String(d.id || "").trim();
    const assignedTo = String(data?.assignedTo || "").trim();
    if (!requestId || !assignedTo) return;

    const staffStatus = String(data?.staffStatus || "assigned").trim().toLowerCase();
    if (staffStatus === "in_progress" || staffStatus === "done") return;

    const startedMs = tsMs(data?.staffStartedAtMs) || tsMs(data?.staffStartedAt);
    if (startedMs > 0) return;

    const assignedMs = tsMs(data?.assignedAt);
    if (!assignedMs) return;

    if (assignedMs <= staleCutoff) {
      staleRows.push({ requestId, assignedTo });
      return;
    }

    const reminderSentMs = tsMs(data?.staffStartReminder3hSentAtMs) || tsMs(data?.staffStartReminder3hSentAt);
    if (reminderSentMs > 0) return;
    if (assignedMs <= reminderCutoff) {
      reminderRows.push({ requestId, assignedTo });
    }
  });

  if (!staleRows.length && !reminderRows.length) {
    return { scanned: snap.size, expired: 0, reminded: 0 };
  }

  let batch = writeBatch(db);
  let writes = 0;
  let expired = 0;

  const commitIfNeeded = async () => {
    if (writes < 380) return;
    await batch.commit();
    batch = writeBatch(db);
    writes = 0;
  };

  for (const row of reminderRows) {
    const reqRef = doc(db, "serviceRequests", row.requestId);
    const taskRef = doc(db, "staff", row.assignedTo, "tasks", row.requestId);

    batch.set(
      reqRef,
      {
        staffStartReminder3hSentAt: serverTimestamp(),
        staffStartReminder3hSentAtMs: nowMs,
      },
      { merge: true }
    );
    writes += 1;

    batch.set(
      taskRef,
      {
        startDeadlineReminderAt: serverTimestamp(),
        startDeadlineReminderAtMs: nowMs,
      },
      { merge: true }
    );
    writes += 1;

    await commitIfNeeded();
  }

  for (const row of staleRows) {
    const reqRef = doc(db, "serviceRequests", row.requestId);
    const taskRef = doc(db, "staff", row.assignedTo, "tasks", row.requestId);

    batch.delete(taskRef);
    writes += 1;

    batch.set(
      reqRef,
      {
        assignedTo: deleteField(),
        assignedAt: deleteField(),
        assignedBy: deleteField(),
        staffStatus: "reassignment_needed",
        staffDecision: "none",
        staffUpdatedAt: serverTimestamp(),
        needsReassignment: true,
        reassignUrgent: true,
        reassignReason: "Staff did not start work within 24 hours",
        reassignNeededAt: serverTimestamp(),
        reassignFromStaffUid: row.assignedTo,
        staffStartReminder3hSentAt: deleteField(),
        staffStartReminder3hSentAtMs: deleteField(),
      },
      { merge: true }
    );
    writes += 1;
    expired += 1;

    await commitIfNeeded();
  }

  if (writes > 0) {
    await batch.commit();
  }

  if (reminderRows.length > 0) {
    await Promise.allSettled(
      reminderRows.map((row) =>
        createStaffNotification({
          uid: row.assignedTo,
          type: "STAFF_REQUEST_EXPIRING_SOON",
          requestId: row.requestId,
          extras: {
            expiresInHours: REMINDER_LEAD_HOURS,
          },
        })
      )
    );
  }

  return { scanned: snap.size, expired, reminded: reminderRows.length };
}

async function updateStaffStatsAfterDecision({ requestId, finalDecision }) {
  const reqRef = doc(db, "serviceRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    return { staffUid: "", rewarded: false, matched: false, reason: "Request not found" };
  }

  const req = reqSnap.data() || {};
  const nowMs = Date.now();
  const rawStaffStatus = String(req?.staffStatus || "").trim().toLowerCase();
  const wasDoneByStaff = rawStaffStatus === "done";
  const staffUid = String(req?.assignedTo || "").trim();

  if (req?.adminFinalDecisionRecorded) {
    return {
      staffUid,
      rewarded: Boolean(req?.adminFinalRewarded),
      matched: Boolean(req?.adminFinalRecommendationMatched),
      reason: String(req?.adminFinalNoRewardReason || "Already recorded"),
    };
  }

  if (!staffUid) {
    await updateDoc(reqRef, {
      adminFinalDecisionRecorded: true,
      adminFinalDecisionRecordedAt: serverTimestamp(),
      adminFinal: finalDecision,
      adminFinalAt: serverTimestamp(),
      adminFinalRewarded: false,
      adminFinalRecommendationMatched: false,
      adminFinalNoRewardReason: "No staff assigned",
    });
    return {
      staffUid: "",
      rewarded: false,
      matched: false,
      reason: "No staff assigned",
    };
  }

  if (!wasDoneByStaff) {
    try {
      await updateDoc(doc(db, "staff", staffUid, "tasks", requestId), {
        status: "done",
        doneByAdmin: true,
        doneAt: serverTimestamp(),
        doneAtMs: nowMs,
        completedAt: serverTimestamp(),
        adminFinal: finalDecision,
        adminFinalAt: serverTimestamp(),
        recommendationMatched: false,
      });
    } catch {
      // ignore missing task rows
    }

    await updateDoc(reqRef, {
      staffStatus: "done",
      staffUpdatedAt: serverTimestamp(),
      ...(req?.staffCompletedAt
        ? {}
        : {
            staffCompletedAt: serverTimestamp(),
            staffCompletedAtMs: nowMs,
            staffCompletedBy: "admin",
          }),
      adminFinalDecisionRecorded: true,
      adminFinalDecisionRecordedAt: serverTimestamp(),
      adminFinal: finalDecision,
      adminFinalAt: serverTimestamp(),
      adminFinalRewarded: false,
      adminFinalRecommendationMatched: false,
      adminFinalNoRewardReason: "Admin finalized before staff marked done",
    });

    return {
      staffUid,
      rewarded: false,
      matched: false,
      reason: "Admin finalized before staff marked done",
    };
  }

  const staffDecision = safeDecision(req?.staffDecision);
  const expectedRecommendation = expectedRecommendationForDecision(finalDecision);
  const recommendationMatched = staffDecision === expectedRecommendation;
  const noRewardReason = recommendationMatched
    ? ""
    : `No score awarded: staff recommendation (${staffDecision || "none"}) did not match admin ${finalDecision}.`;

  const mins = Number.isFinite(Number(req?.staffWorkMinutes)) ? Number(req.staffWorkMinutes) : null;
  const staffRef = doc(db, "staff", staffUid);

  const counterUpdate = {
    "stats.totalReviewed": increment(1),
    "stats.matchedDecisionCount": recommendationMatched ? increment(1) : increment(0),
    "stats.unmatchedDecisionCount": recommendationMatched ? increment(0) : increment(1),
    "stats.successCount": recommendationMatched ? increment(1) : increment(0),
    "stats.failCount": recommendationMatched ? increment(0) : increment(1),
    "stats.lastUpdatedAt": serverTimestamp(),
  };

  if (recommendationMatched) {
    counterUpdate["stats.totalDone"] = increment(1);
    if (mins !== null && mins > 0) {
      counterUpdate["stats.totalMinutes"] = increment(mins);
    }
  }

  await updateDoc(staffRef, counterUpdate);

  const staffSnap = await getDoc(staffRef);
  const staff = staffSnap.exists() ? staffSnap.data() || {} : {};
  const stats = staff?.stats || {};

  const totalDone = Number(stats?.totalDone || 0);
  const totalReviewed = Number(stats?.totalReviewed || 0);
  const matchedDecisionCount = Number(
    (stats?.matchedDecisionCount ?? stats?.successCount) || 0
  );
  const totalMinutes = Number(stats?.totalMinutes || 0);

  const successRate =
    totalReviewed > 0
      ? Number((matchedDecisionCount / totalReviewed).toFixed(3))
      : 0;
  const avgMinutes =
    totalDone > 0 && totalMinutes > 0 ? Math.round(totalMinutes / totalDone) : null;

  const MIN_REVIEWED_BEFORE_BLOCK = 5;
  const MIN_MATCH_RATE = 0.5;
  const shouldBlock = totalReviewed >= MIN_REVIEWED_BEFORE_BLOCK && successRate < MIN_MATCH_RATE;

  await updateDoc(staffRef, {
    "stats.successRate": successRate,
    "stats.matchRate": successRate,
    "stats.avgMinutes": avgMinutes,
    "performance.doneCount": totalDone,
    "performance.successCount": matchedDecisionCount,
    "performance.reviewedCount": totalReviewed,
    "performance.matchCount": matchedDecisionCount,
    "performance.successRate": successRate,
    "performance.avgMinutes": avgMinutes,
    "performance.updatedAt": serverTimestamp(),
    ...(shouldBlock
      ? {
          active: false,
          blockedAt: serverTimestamp(),
          blockedReason: `Auto-block: matchRate ${successRate} after ${totalReviewed} reviewed tasks`,
          "performance.blocked": true,
          "performance.blockedAt": serverTimestamp(),
          "performance.blockedReason": `Auto-block: matchRate ${successRate} after ${totalReviewed} reviewed tasks`,
        }
      : {}),
  });

  try {
    await updateDoc(doc(db, "staff", staffUid, "tasks", requestId), {
      adminFinal: finalDecision,
      adminFinalAt: serverTimestamp(),
      recommendationMatched,
      recommendationMatchedAt: serverTimestamp(),
    });
  } catch {
    // ignore missing task rows
  }

  await updateDoc(reqRef, {
    adminFinalDecisionRecorded: true,
    adminFinalDecisionRecordedAt: serverTimestamp(),
    adminFinal: finalDecision,
    adminFinalAt: serverTimestamp(),
    adminFinalRewarded: recommendationMatched,
    adminFinalRecommendationMatched: recommendationMatched,
    adminFinalStaffRecommendation: staffDecision || "none",
    ...(recommendationMatched
      ? { adminFinalNoRewardReason: deleteField() }
      : { adminFinalNoRewardReason: noRewardReason }),
  });

  return {
    staffUid,
    rewarded: recommendationMatched,
    matched: recommendationMatched,
    reason: recommendationMatched ? "" : noRewardReason,
  };
}

export async function adminAcceptRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) throw new Error("Request not found");

  const req = snap.data() || {};
  const uid = String(req?.uid || "").trim();

  await updateDoc(reqRef, {
    status: "closed",
    adminDecisionNote: String(note || "").trim(),
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const result = await updateStaffStatsAfterDecision({
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

  if (result?.staffUid) {
    try {
      await createStaffNotification({
        uid: result.staffUid,
        type: "STAFF_REQUEST_ACCEPTED_BY_ADMIN",
        requestId,
        extras: {
          rewarded: Boolean(result?.rewarded),
          recommendationMatched: Boolean(result?.matched),
          noRewardReason: String(result?.reason || ""),
        },
      });
    } catch (error) {
      console.warn("Failed to write STAFF_REQUEST_ACCEPTED_BY_ADMIN notification:", error?.message || error);
    }
  }

  return true;
}

export async function adminRejectRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!String(note || "").trim()) throw new Error("Note is required for rejection");

  const reqRef = doc(db, "serviceRequests", requestId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) throw new Error("Request not found");

  const req = snap.data() || {};
  const uid = String(req?.uid || "").trim();

  await updateDoc(reqRef, {
    status: "rejected",
    adminDecisionNote: String(note || "").trim(),
    decidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const result = await updateStaffStatsAfterDecision({
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

  if (result?.staffUid) {
    try {
      await createStaffNotification({
        uid: result.staffUid,
        type: "STAFF_REQUEST_REJECTED_BY_ADMIN",
        requestId,
        extras: {
          rewarded: Boolean(result?.rewarded),
          recommendationMatched: Boolean(result?.matched),
          noRewardReason: String(result?.reason || ""),
        },
      });
    } catch (error) {
      console.warn("Failed to write STAFF_REQUEST_REJECTED_BY_ADMIN notification:", error?.message || error);
    }
  }

  return true;
}

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

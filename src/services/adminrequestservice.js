import {
  collection,
  query,
  where,
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
import {
  createAdminNotification,
  createStaffNotification,
  createUserNotification,
} from "./notificationDocs";
import { getCurrentUserRoleContext } from "./adminroleservice";
import {
  adminArchiveRequestCommand,
  finalizeDecisionCommand,
  markCompletedCommand,
} from "./requestcommandservice";
import { normalizeTextDeep } from "../utils/textNormalizer";
import {
  buildRequestHistoryPayload,
  buildSystemChatMessagePayload,
} from "./requestcontinuityservice";
import {
  buildRequestContinuityPatch,
  REQUEST_BACKEND_STATUSES,
} from "../utils/requestLifecycle";

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

function sortByCreatedAtDesc(rows) {
  return rows.sort((a, b) => {
    const aSec = Number(a?.createdAt?.seconds || 0);
    const bSec = Number(b?.createdAt?.seconds || 0);
    return bSec - aSec;
  });
}

async function listSuperAdminUids({ excludeUids = [] } = {}) {
  const blocked = new Set(
    (Array.isArray(excludeUids) ? excludeUids : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  const seen = new Set();
  const rows = [];
  const roleVariants = ["superAdmin", "superadmin", "super_admin", "super-admin", "super admin"];

  await Promise.all(
    roleVariants.map(async (roleValue) => {
      try {
        const snap = await getDocs(
          query(collection(db, "users"), where("role", "==", roleValue), qLimit(50))
        );
        snap.forEach((docSnap) => {
          const uid = String(docSnap.id || "").trim();
          if (!uid || blocked.has(uid) || seen.has(uid)) return;
          seen.add(uid);
          rows.push(uid);
        });
      } catch (error) {
        console.warn("Failed to load superadmin notification targets:", error?.message || error);
      }
    })
  );

  return rows;
}

function rowMatchesRequestFilters(row, { status = "", track = "", uid = "" } = {}) {
  const st = String(status || "").trim().toLowerCase();
  const tr = String(track || "").trim().toLowerCase();
  const ownerUid = String(uid || "").trim();
  if (st && String(row?.status || "").trim().toLowerCase() !== st) return false;
  if (tr && String(row?.track || "").trim().toLowerCase() !== tr) return false;
  if (ownerUid && String(row?.uid || "").trim() !== ownerUid) return false;
  return true;
}

async function requireAdminActorContext() {
  const actorUid = String(auth.currentUser?.uid || "").trim();
  if (!actorUid) throw new Error("Not signed in");
  const roleCtx = await getCurrentUserRoleContext(actorUid);
  if (!roleCtx?.isAdmin) {
    throw new Error("Admin access required.");
  }
  return { actorUid, roleCtx };
}

function assertRequestInActorScope(reqData, { actorUid, roleCtx }) {
  if (!roleCtx?.isAssignedAdmin) return;

  const scopedAdminUid = String(
    reqData?.ownerLockedAdminUid || reqData?.currentAdminUid || ""
  ).trim();

  if (scopedAdminUid && scopedAdminUid !== actorUid) {
    throw new Error("This request is outside your assigned admin scope.");
  }
}

export async function getRequests({
  status = "",
  track = "",
  uid = "",
  max,
  limit = 50,
} = {}) {
  const actorUid = String(auth.currentUser?.uid || "").trim();
  const roleCtx = actorUid ? await getCurrentUserRoleContext(actorUid).catch(() => null) : null;

  const ref = collection(db, "serviceRequests");
  const clauses = [];

  const s = String(status || "").trim().toLowerCase();
  const t = String(track || "").trim().toLowerCase();
  const u = String(uid || "").trim();

  if (s) clauses.push(where("status", "==", s));
  if (t) clauses.push(where("track", "==", t));
  if (u) clauses.push(where("uid", "==", u));

  const take = Number.isFinite(Number(max)) ? Number(max) : Number(limit) || 50;
  const mapRows = (snap) =>
    snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));

  if (roleCtx?.isAssignedAdmin) {
    // Use index-safe scoped queries and apply status/track/uid filters client-side.
    // This avoids relying on composite indexes like (status + currentAdminUid).
    const scopedTake = Math.max(20, take);
    const fetchTake = Math.min(800, Math.max(scopedTake * 6, 180));
    const scopedQueries = [
      query(ref, where("currentAdminUid", "==", actorUid), qLimit(fetchTake)),
      query(ref, where("ownerLockedAdminUid", "==", actorUid), qLimit(fetchTake)),
    ];

    const snaps = await Promise.all(scopedQueries.map((qy) => getDocs(qy).catch(() => null)));
    const deduped = new Map();
    snaps.forEach((snap) => {
      if (!snap) return;
      mapRows(snap).forEach((row) => {
        if (!row?.id) return;
        deduped.set(String(row.id), row);
      });
    });

    const filtered = Array.from(deduped.values()).filter((row) =>
      rowMatchesRequestFilters(row, { status: s, track: t, uid: u })
    );
    return sortByCreatedAtDesc(filtered).slice(0, scopedTake);
  }

  const qy = query(ref, ...clauses, qLimit(take));
  const snap = await getDocs(qy);
  return sortByCreatedAtDesc(mapRows(snap));
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
      staleRows.push({ requestId, assignedTo, requestData: data });
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
        updatedAt: serverTimestamp(),
        ...buildRequestContinuityPatch(row.requestData, {
          backendStatus: REQUEST_BACKEND_STATUSES.NEW,
          everAssigned: true,
        }),
      },
      { merge: true }
    );
    writes += 1;

    const historyRef = doc(collection(db, "serviceRequests", row.requestId, "requestHistory"));
    batch.set(
      historyRef,
      buildRequestHistoryPayload({
        requestId: row.requestId,
        action: "unassigned",
        staffId: row.assignedTo,
        previousStaffUid: row.assignedTo,
        actorUid: "system",
        details: {
          reason: "stale_start_timeout",
        },
      })
    );
    writes += 1;

    const messageRef = doc(collection(db, "serviceRequests", row.requestId, "messages"));
    batch.set(
      messageRef,
      buildSystemChatMessagePayload({
        requestId: row.requestId,
        kind: "request_unassigned",
        previousStaffUid: row.assignedTo,
        actorUid: "system",
      })
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
  await requireAdminActorContext();
  const trimmedNote = String(note || "").trim();
  const finalizeResult = await finalizeDecisionCommand({
    requestId,
    decision: "accept",
    note: trimmedNote,
  });
  if (!finalizeResult?.ok) {
    throw new Error("Failed to finalize decision.");
  }
  const completeResult = await markCompletedCommand({
    requestId,
    decision: "accept",
  });
  if (!completeResult?.ok) {
    throw new Error("Failed to complete request.");
  }
  const decisionResult = await updateStaffStatsAfterDecision({
    requestId,
    finalDecision: "accepted",
  });
  const latestRequestSnap = await getDoc(doc(db, "serviceRequests", requestId));
  const latestRequestData = latestRequestSnap.exists() ? latestRequestSnap.data() || {} : {};
  const requestOwnerUid = String(latestRequestData?.uid || "").trim();

  if (requestOwnerUid) {
    try {
      await createUserNotification({
        uid: requestOwnerUid,
        type: "REQUEST_ACCEPTED",
        requestId,
      });
    } catch (error) {
      console.warn("Failed to write REQUEST_ACCEPTED notification:", error?.message || error);
    }
  }

  if (decisionResult?.staffUid) {
    try {
      await createStaffNotification({
        uid: decisionResult.staffUid,
        type: "STAFF_REQUEST_ACCEPTED_BY_ADMIN",
        requestId,
        extras: {
          rewarded: Boolean(decisionResult?.rewarded),
          recommendationMatched: Boolean(decisionResult?.matched),
          noRewardReason: String(decisionResult?.reason || ""),
        },
      });
    } catch (error) {
      console.warn("Failed to write STAFF_REQUEST_ACCEPTED_BY_ADMIN notification:", error?.message || error);
    }
  }

  try {
    const superAdminUids = await listSuperAdminUids({
      excludeUids: [auth.currentUser?.uid, latestRequestData?.currentAdminUid].filter(Boolean),
    });
    await Promise.all(
      superAdminUids.map((uid) =>
        createAdminNotification({
          uid,
          type: "REQUEST_ACCEPTED",
          requestId,
          extras: {
            title: "Request accepted",
            body: "A request was accepted and completed.",
          },
        })
      )
    );
  } catch (error) {
    console.warn(
      "Failed to write superadmin request accepted notifications:",
      error?.message || error
    );
  }
  return true;
}

export async function adminRejectRequest({ requestId, note = "" }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!String(note || "").trim()) throw new Error("Note is required for rejection");
  await requireAdminActorContext();
  const trimmedNote = String(note || "").trim();
  const finalizeResult = await finalizeDecisionCommand({
    requestId,
    decision: "reject",
    note: trimmedNote,
  });
  if (!finalizeResult?.ok) {
    throw new Error("Failed to finalize decision.");
  }
  const completeResult = await markCompletedCommand({
    requestId,
    decision: "reject",
  });
  if (!completeResult?.ok) {
    throw new Error("Failed to complete request.");
  }
  const decisionResult = await updateStaffStatsAfterDecision({
    requestId,
    finalDecision: "rejected",
  });
  const latestRequestSnap = await getDoc(doc(db, "serviceRequests", requestId));
  const latestRequestData = latestRequestSnap.exists() ? latestRequestSnap.data() || {} : {};
  const requestOwnerUid = String(latestRequestData?.uid || "").trim();

  if (requestOwnerUid) {
    try {
      await createUserNotification({
        uid: requestOwnerUid,
        type: "REQUEST_REJECTED",
        requestId,
      });
    } catch (error) {
      console.warn("Failed to write REQUEST_REJECTED notification:", error?.message || error);
    }
  }

  if (decisionResult?.staffUid) {
    try {
      await createStaffNotification({
        uid: decisionResult.staffUid,
        type: "STAFF_REQUEST_REJECTED_BY_ADMIN",
        requestId,
        extras: {
          rewarded: Boolean(decisionResult?.rewarded),
          recommendationMatched: Boolean(decisionResult?.matched),
          noRewardReason: String(decisionResult?.reason || ""),
        },
      });
    } catch (error) {
      console.warn("Failed to write STAFF_REQUEST_REJECTED_BY_ADMIN notification:", error?.message || error);
    }
  }

  try {
    const superAdminUids = await listSuperAdminUids({
      excludeUids: [auth.currentUser?.uid, latestRequestData?.currentAdminUid].filter(Boolean),
    });
    await Promise.all(
      superAdminUids.map((uid) =>
        createAdminNotification({
          uid,
          type: "REQUEST_REJECTED",
          requestId,
          extras: {
            title: "Request rejected",
            body: "A request was rejected and completed.",
          },
        })
      )
    );
  } catch (error) {
    console.warn(
      "Failed to write superadmin request rejected notifications:",
      error?.message || error
    );
  }
  return true;
}

export async function adminSoftDeleteRequest({ requestId } = {}) {
  if (!requestId) throw new Error("Missing requestId");
  await requireAdminActorContext();
  const commandResult = await adminArchiveRequestCommand({ requestId });
  if (!commandResult?.ok) {
    throw new Error("Failed to archive request.");
  }
  return true;
}

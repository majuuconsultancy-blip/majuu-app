import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { normalizeTextDeep } from "../utils/textNormalizer";
import { updateProgressCommand } from "./requestcommandservice";
import {
  REQUEST_BACKEND_STATUSES,
  buildRequestContinuityPatch,
} from "../utils/requestLifecycle";

function safeStr(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function toMillis(value) {
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

function progressUpdatesCol(requestId) {
  return collection(db, "serviceRequests", String(requestId || "").trim(), "progressUpdates");
}

export function buildRequestHistoryPayload({
  requestId,
  action,
  staffId = "",
  previousStaffUid = "",
  nextStaffUid = "",
  actorUid = "",
  details = {},
} = {}) {
  const safeAction = safeStr(action, 80);
  if (!safeAction) throw new Error("request history action required");

  const cleanDetails = details && typeof details === "object" ? details : {};
  return {
    requestId: safeStr(requestId, 180),
    action: safeAction,
    staffId: safeStr(staffId, 180) || null,
    previousStaffUid: safeStr(previousStaffUid, 180) || null,
    nextStaffUid: safeStr(nextStaffUid, 180) || null,
    actorUid: safeStr(actorUid, 180) || null,
    details: cleanDetails,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    timestamp: serverTimestamp(),
    timestampMs: Date.now(),
  };
}

export function buildSystemChatMessagePayload({
  requestId,
  kind = "request_reassigned",
  previousStaffUid = "",
  nextStaffUid = "",
  actorUid = "",
} = {}) {
  const systemKind = safeStr(kind, 80) || "request_reassigned";
  const isUnassign = systemKind === "request_unassigned";

  return {
    requestId: safeStr(requestId, 180),
    fromRole: "system",
    fromUid: safeStr(actorUid, 180) || null,
    toRole: "all",
    toUid: null,
    type: "system",
    text: "Reassigned",
    systemKind,
    previousStaffUid: safeStr(previousStaffUid, 180) || null,
    nextStaffUid: isUnassign ? null : safeStr(nextStaffUid, 180) || null,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };
}

export function normalizeRequestProgressUpdate(input = {}) {
  const row = normalizeTextDeep(input && typeof input === "object" ? input : {});
  const progressPercent = Math.round(Number(row?.progressPercent));
  return {
    id: safeStr(row?.id, 180),
    requestId: safeStr(row?.requestId, 180),
    staffId: safeStr(row?.staffId || row?.createdBy, 180),
    content: safeStr(row?.content, 2000),
    visibleToUser: row?.visibleToUser !== false,
    progressPercent:
      Number.isFinite(progressPercent) && progressPercent >= 0 && progressPercent <= 100
        ? progressPercent
        : null,
    createdAt: row?.createdAt || null,
    createdAtMs: Math.max(
      0,
      Number(row?.createdAtMs || 0) || 0,
      toMillis(row?.createdAt)
    ),
  };
}

export function subscribeRequestProgressUpdates({
  requestId,
  viewerRole = "admin",
  onData,
  onError,
} = {}) {
  const rid = safeStr(requestId, 180);
  if (!rid) throw new Error("requestId required");

  const safeViewerRole = safeStr(viewerRole, 20).toLowerCase();
  const baseCol = progressUpdatesCol(rid);
  const qy =
    safeViewerRole === "user"
      ? query(baseCol, where("visibleToUser", "==", true))
      : query(baseCol);

  return onSnapshot(
    qy,
    (snap) => {
      const rows = snap.docs
        .map((docSnap) =>
          normalizeRequestProgressUpdate({ id: docSnap.id, ...(docSnap.data() || {}) })
        )
        .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
      onData?.(rows);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function createRequestProgressUpdate({
  requestId,
  content = "",
  progressPercent = null,
  visibleToUser = true,
  staffId = "",
} = {}) {
  const rid = safeStr(requestId, 180);
  if (!rid) throw new Error("requestId required");
  const commandResult = await updateProgressCommand({
    requestId: rid,
    progressPercent: Number(progressPercent ?? 0),
    content: safeStr(content, 2000),
    visibleToUser: visibleToUser !== false,
  });
  if (!commandResult?.ok) throw new Error("Failed to create progress update.");
  return {
    id: safeStr(commandResult?.updateId, 180),
    requestId: rid,
    progressPercent: Number(commandResult?.progressPercent || 0),
    content: safeStr(content, 2000),
    visibleToUser: visibleToUser !== false,
    createdBy: safeStr(staffId || auth.currentUser?.uid, 180),
  };

  const actorUid = safeStr(staffId || auth.currentUser?.uid, 180);
  if (!actorUid) throw new Error("Not signed in");

  const safeContent = safeStr(content, 2000);
  if (!safeContent) throw new Error("Progress update content is required.");

  const normalizedProgress = Math.round(Number(progressPercent));
  const payload = {
    requestId: rid,
    staffId: actorUid,
    createdBy: actorUid,
    content: safeContent,
    visibleToUser: visibleToUser !== false,
    progressPercent:
      Number.isFinite(normalizedProgress) && normalizedProgress >= 0 && normalizedProgress <= 100
        ? normalizedProgress
        : null,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };

  const ref = await addDoc(progressUpdatesCol(rid), payload);
  return { id: ref.id, ...payload };
}

export async function postRequestProgressUpdate({
  requestId,
  requestData = {},
  progressPercent = null,
  content = "",
  visibleToUser = true,
} = {}) {
  const rid = safeStr(requestId, 180);
  if (!rid) throw new Error("requestId required");
  const commandProgress = Math.round(Number(progressPercent));
  if (!Number.isFinite(commandProgress) || commandProgress < 0 || commandProgress > 100) {
    throw new Error("A valid progress percentage is required.");
  }
  const commandResult = await updateProgressCommand({
    requestId: rid,
    progressPercent: commandProgress,
    content: safeStr(content, 2000),
    visibleToUser: visibleToUser !== false,
  });
  if (!commandResult?.ok) throw new Error("Progress update failed.");
  return {
    ok: true,
    updateId: safeStr(commandResult?.updateId, 180),
    progressPercent: Number(commandResult?.progressPercent || commandProgress),
  };

  const actorUid = safeStr(auth.currentUser?.uid, 180);
  if (!actorUid) throw new Error("Not signed in");

  const normalizedProgress = Math.round(Number(progressPercent));
  if (!Number.isFinite(normalizedProgress) || normalizedProgress < 0 || normalizedProgress > 100) {
    throw new Error("A valid progress percentage is required.");
  }

  const safeContent =
    safeStr(content, 2000) || `Progress updated to ${normalizedProgress}%`;
  const nowMs = Date.now();
  const reqRef = doc(db, "serviceRequests", rid);
  const updateRef = doc(progressUpdatesCol(rid));
  const batch = writeBatch(db);

  batch.set(
    reqRef,
    {
      staffProgressPercent: normalizedProgress,
      staffProgressUpdatedAt: serverTimestamp(),
      staffProgressUpdatedAtMs: nowMs,
      staffUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...buildRequestContinuityPatch(requestData, {
        backendStatus: REQUEST_BACKEND_STATUSES.IN_PROGRESS,
        userStatus: "in_progress",
        everAssigned: true,
      }),
    },
    { merge: true }
  );

  batch.set(updateRef, {
    requestId: rid,
    staffId: actorUid,
    createdBy: actorUid,
    content: safeContent,
    visibleToUser: visibleToUser !== false,
    progressPercent: normalizedProgress,
    createdAt: serverTimestamp(),
    createdAtMs: nowMs,
  });

  await batch.commit();

  return {
    ok: true,
    updateId: updateRef.id,
    progressPercent: normalizedProgress,
  };
}


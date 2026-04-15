import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const functions = getFunctions(undefined, "us-central1");

function safeStr(value, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function safeRoleHint(role = "") {
  const normalized = safeStr(role, 40).toLowerCase();
  if (["user", "staff", "admin", "super_admin"].includes(normalized)) return normalized;
  return "";
}

function formatCommandCallableError(error, callableName = "") {
  const code = safeStr(error?.code, 160).toLowerCase();
  const message = safeStr(error?.message).toLowerCase();
  const isInfraError =
    code.includes("functions/internal") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/unimplemented") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/not-found") ||
    (code.includes("internal") && !message.includes("permission")) ||
    message === "internal";

  const label = safeStr(callableName, 80) || "Request command";
  const wrapped = new Error(
    isInfraError
      ? `${label} is not available right now. Deploy Cloud Functions and retry (Firebase Blaze plan is required).`
      : safeStr(error?.message, 600) || "Request command failed. Please try again."
  );
  wrapped.code = code;
  wrapped.isInfrastructureUnavailable = isInfraError;
  return wrapped;
}

function isInfrastructureUnavailable(error) {
  const code = safeStr(error?.code, 160).toLowerCase();
  const message = safeStr(error?.message).toLowerCase();
  return (
    Boolean(error?.isInfrastructureUnavailable) ||
    code === "internal" ||
    code.includes("functions/internal") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/unimplemented") ||
    code.includes("functions/deadline-exceeded") ||
    code.includes("functions/not-found") ||
    message.includes("deploy cloud functions")
  );
}

function buildCommandEnvelope({
  command = "",
  requestId = "",
  payload = {},
  actorRole = "",
} = {}) {
  return {
    command: safeStr(command, 80),
    actorUid: safeStr(auth.currentUser?.uid, 180),
    actorRole: safeRoleHint(actorRole),
    requestId: safeStr(requestId, 180),
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

async function createRequestCommandFallback(envelope = {}) {
  const actorUid = safeStr(envelope?.actorUid, 180);
  const payload = envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {};
  const request = payload?.request && typeof payload.request === "object" ? payload.request : {};
  if (!actorUid) {
    throw new Error("Local createRequest fallback requires an authenticated user.");
  }

  const now = Date.now();
  const requestRef = doc(collection(db, "serviceRequests"));
  await setDoc(
    requestRef,
    {
      ...request,
      uid: actorUid,
      lifecycle: {
        stage: "Submitted",
        decisionFinalized: false,
        finalDecision: "",
        version: 1,
        createdAt: serverTimestamp(),
        createdAtMs: now,
        updatedAt: serverTimestamp(),
        updatedAtMs: now,
      },
      ownership: {
        ownerUid: actorUid,
        adminUid: "",
        staffUid: "",
      },
      actionType: "createRequest",
      updatedBy: { uid: actorUid, role: "user" },
      createdAt: serverTimestamp(),
      createdAtMs: now,
      updatedAt: serverTimestamp(),
      updatedAtMs: now,
    },
    { merge: true }
  );

  return {
    ok: true,
    command: "createRequest",
    requestId: requestRef.id,
    stage: "Submitted",
    localFallback: true,
  };
}

export async function executeRequestCommand({
  command,
  requestId = "",
  payload = {},
  actorRole = "",
} = {}) {
  const callable = httpsCallable(functions, "executeRequestCommand");
  const envelope = buildCommandEnvelope({ command, requestId, payload, actorRole });
  try {
    const result = await callable(envelope);
    return result?.data ?? null;
  } catch (error) {
    if (safeStr(envelope?.command, 80) === "createRequest" && isInfrastructureUnavailable(error)) {
      return createRequestCommandFallback(envelope);
    }
    throw formatCommandCallableError(error, "executeRequestCommand");
  }
}

function callNamedCommand(name, payload = {}) {
  const callable = httpsCallable(functions, name);
  return callable(payload)
    .then((result) => result?.data ?? null)
    .catch((error) => {
      throw formatCommandCallableError(error, name);
    });
}

export function createRequestCommand({ request = {}, idempotencyKey = "" } = {}) {
  return executeRequestCommand({
    command: "createRequest",
    actorRole: "user",
    payload: {
      request: request && typeof request === "object" ? request : {},
      idempotencyKey: safeStr(idempotencyKey, 120),
    },
  });
}

export function routeRequestCommand({ requestId, payload = {}, actorRole = "admin" } = {}) {
  return executeRequestCommand({
    command: "routeRequest",
    requestId,
    payload,
    actorRole,
  });
}

export function assignAdminCommand({ requestId, targetAdminUid = "", reason = "", lockOwner = false } = {}) {
  return executeRequestCommand({
    command: "assignAdmin",
    requestId,
    actorRole: "super_admin",
    payload: {
      targetAdminUid: safeStr(targetAdminUid, 180),
      reason: safeStr(reason, 200),
      lockOwner: Boolean(lockOwner),
    },
  });
}

export function rerouteRequestCommand({
  requestId,
  targetAdminUid = "",
  reason = "",
  selectedPartnerId = "",
  excludeAdminUids = [],
} = {}) {
  return executeRequestCommand({
    command: "rerouteRequest",
    requestId,
    actorRole: targetAdminUid ? "super_admin" : "admin",
    payload: {
      targetAdminUid: safeStr(targetAdminUid, 180),
      reason: safeStr(reason, 200),
      selectedPartnerId: safeStr(selectedPartnerId, 160),
      excludeAdminUids: Array.isArray(excludeAdminUids)
        ? excludeAdminUids.map((v) => safeStr(v, 180)).filter(Boolean)
        : [],
    },
  });
}

export function assignStaffCommand({
  requestId,
  staffUid = "",
  track = "",
  country = "",
  requestType = "",
  serviceName = "",
  applicantName = "",
  speciality = "",
} = {}) {
  return executeRequestCommand({
    command: "assignStaff",
    requestId,
    actorRole: "admin",
    payload: {
      staffUid: safeStr(staffUid, 180),
      track: safeStr(track, 40),
      country: safeStr(country, 120),
      requestType: safeStr(requestType, 40),
      serviceName: safeStr(serviceName, 140),
      applicantName: safeStr(applicantName, 140),
      speciality: safeStr(speciality, 120),
    },
  });
}

export function unassignStaffCommand({ requestId, staffUid = "", forceOverride = false } = {}) {
  return executeRequestCommand({
    command: "unassignStaff",
    requestId,
    actorRole: "admin",
    payload: {
      staffUid: safeStr(staffUid, 180),
      forceOverride: Boolean(forceOverride),
    },
  });
}

export function startWorkCommand({ requestId } = {}) {
  return executeRequestCommand({
    command: "startWork",
    requestId,
    actorRole: "staff",
    payload: {},
  });
}

export function updateProgressCommand({
  requestId,
  progressPercent = 0,
  content = "",
  visibleToUser = true,
} = {}) {
  return executeRequestCommand({
    command: "updateProgress",
    requestId,
    actorRole: "staff",
    payload: {
      progressPercent: Number(progressPercent || 0),
      content: safeStr(content, 2000),
      visibleToUser: visibleToUser !== false,
    },
  });
}

export function recommendDecisionCommand({ requestId, decision = "", staffNote = "", markDone = false } = {}) {
  return executeRequestCommand({
    command: "recommendDecision",
    requestId,
    actorRole: "staff",
    payload: {
      decision: safeStr(decision, 80),
      staffNote: safeStr(staffNote, 2000),
      markDone: Boolean(markDone),
    },
  });
}

export function finalizeDecisionCommand({ requestId, decision = "", note = "" } = {}) {
  return executeRequestCommand({
    command: "finalizeDecision",
    requestId,
    actorRole: "admin",
    payload: {
      decision: safeStr(decision, 80),
      note: safeStr(note, 2000),
    },
  });
}

export function markCompletedCommand({ requestId, decision = "", forceComplete = false } = {}) {
  return executeRequestCommand({
    command: "markCompleted",
    requestId,
    actorRole: "admin",
    payload: {
      decision: safeStr(decision, 80),
      forceComplete: Boolean(forceComplete),
    },
  });
}

export function addInternalNoteCommand({ requestId, note = "", actorRole = "staff" } = {}) {
  return executeRequestCommand({
    command: "addInternalNote",
    requestId,
    actorRole,
    payload: {
      note: safeStr(note, 3000),
    },
  });
}

export function sendMessageCommand({
  requestId,
  toRole = "",
  type = "text",
  text = "",
  pdfMeta = null,
  attachmentMeta = null,
  actorRole = "user",
} = {}) {
  const normalizedAttachment =
    attachmentMeta && typeof attachmentMeta === "object"
      ? attachmentMeta
      : pdfMeta && typeof pdfMeta === "object"
      ? pdfMeta
      : null;
  return executeRequestCommand({
    command: "sendMessage",
    requestId,
    actorRole,
    payload: {
      toRole: safeStr(toRole, 40),
      type: safeStr(type, 20),
      text: safeStr(text, 4000),
      ...(normalizedAttachment ? { attachmentMeta: normalizedAttachment, pdfMeta: normalizedAttachment } : {}),
    },
  });
}

export function userHideRequestCommand({ requestId } = {}) {
  return executeRequestCommand({
    command: "userHideRequest",
    requestId,
    actorRole: "user",
    payload: {},
  });
}

export function staffHideTaskCommand({ requestId } = {}) {
  return executeRequestCommand({
    command: "staffHideTask",
    requestId,
    actorRole: "staff",
    payload: {},
  });
}

export function adminArchiveRequestCommand({ requestId } = {}) {
  return executeRequestCommand({
    command: "adminArchiveRequest",
    requestId,
    actorRole: "admin",
    payload: {},
  });
}

export function deleteOwnRequestDeep({ requestId } = {}) {
  return callNamedCommand("deleteOwnRequestDeep", {
    requestId: safeStr(requestId, 180),
  });
}

export function staffStartWork({ requestId } = {}) {
  return callNamedCommand("staffStartWork", {
    requestId: safeStr(requestId, 180),
  });
}

export function staffClaimAssignedOrphanMessages({ requestId, max = 200 } = {}) {
  return callNamedCommand("staffClaimAssignedOrphanMessages", {
    requestId: safeStr(requestId, 180),
    max: Number(max || 200),
  });
}

export function staffMarkRequestDone({ requestId, staffDecision = "", staffNote = "" } = {}) {
  return callNamedCommand("staffMarkRequestDone", {
    requestId: safeStr(requestId, 180),
    staffDecision: safeStr(staffDecision, 80).toLowerCase(),
    staffNote: safeStr(staffNote, 2000),
  });
}

export function staffUpdateRequestNote({ requestId, staffNote = "" } = {}) {
  return callNamedCommand("staffUpdateRequestNote", {
    requestId: safeStr(requestId, 180),
    staffNote: safeStr(staffNote, 2000),
  });
}

export function staffDeleteDoneTask({ requestId } = {}) {
  return callNamedCommand("staffDeleteDoneTask", {
    requestId: safeStr(requestId, 180),
  });
}

export function staffAcceptOnboarding({ onboardingVersion = 3 } = {}) {
  return callNamedCommand("staffAcceptOnboarding", {
    onboardingVersion: Number(onboardingVersion || 3),
  });
}

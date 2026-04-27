import { collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { invokeRequestAction, invokeRequestCommand, invokeRequestMessage } from "./apiService";

function safeStr(value, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function safeRoleHint(role = "") {
  const normalized = safeStr(role, 40).toLowerCase();
  if (["user", "staff", "admin", "super_admin"].includes(normalized)) return normalized;
  return "";
}

function lower(value, max = 120) {
  return safeStr(value, max).toLowerCase();
}

function resolveRequestStaffUid(request = {}) {
  return safeStr(
    request?.assignedTo ||
      request?.assignedStaffUid ||
      request?.assignedToUid ||
      request?.staffUid ||
      request?.staffAssignedUid,
    180
  );
}

function normalizeMessageAttachmentMeta(value = null) {
  if (!value || typeof value !== "object") return null;

  const name = safeStr(value?.name || value?.fileName || value?.filename, 220);
  if (!name) return null;

  const mime = lower(value?.mime || value?.type || value?.contentType, 120);
  const attachmentKindRaw = lower(value?.attachmentKind || value?.kind, 40);
  let attachmentKind = "document";
  if (attachmentKindRaw === "photo") attachmentKind = "photo";
  else if (attachmentKindRaw === "image") attachmentKind = "image";
  else if (mime.startsWith("image/")) attachmentKind = "image";

  const externalUrl = safeStr(
    value?.externalUrl || value?.url || value?.downloadUrl || value?.fileUrl,
    1200
  );
  const storageBucket = safeStr(value?.storageBucket || value?.bucket || value?.storage?.bucket, 220);
  const storagePath = safeStr(value?.storagePath || value?.path || value?.storage?.path, 520);
  const rawStorageKind = lower(value?.storageKind || value?.storage?.kind, 30);
  const storageKind =
    rawStorageKind === "bucket" || rawStorageKind === "external" || rawStorageKind === "meta"
      ? rawStorageKind
      : storagePath || storageBucket
      ? "bucket"
      : externalUrl
      ? "external"
      : "";

  return {
    name,
    mime: mime || (attachmentKind === "document" ? "application/octet-stream" : "image/jpeg"),
    size: Math.max(0, Number(value?.size || value?.sizeBytes || 0) || 0),
    note: safeStr(value?.note, 1400),
    attachmentKind,
    source: lower(value?.source, 40),
    optimizedBytes: Math.max(0, Number(value?.optimizedBytes || 0) || 0),
    originalBytes: Math.max(0, Number(value?.originalBytes || 0) || 0),
    externalUrl,
    url: externalUrl,
    downloadUrl: externalUrl,
    fileUrl: externalUrl,
    storageKind,
    storageBucket,
    storagePath,
    storageGeneration: safeStr(value?.storageGeneration || value?.generation || value?.storage?.generation, 120),
    storageChecksum: safeStr(value?.storageChecksum || value?.checksum || value?.storage?.checksum, 120),
    storageProvider: lower(value?.storageProvider || value?.provider || value?.storage?.provider, 40),
  };
}

function normalizeOutgoingMessageType(type = "", attachmentMeta = null) {
  const clean = lower(type, 40);
  if (clean === "text") return "text";
  if (clean === "bundle") return "bundle";
  if (clean === "pdf" || clean === "document") return "document";
  if (clean === "image") return "image";
  if (clean === "photo" || clean === "camera_photo") return "photo";
  const attachmentKind = lower(attachmentMeta?.attachmentKind, 40);
  if (attachmentKind === "photo") return "photo";
  if (attachmentKind === "image") return "image";
  if (attachmentMeta) return "document";
  return "text";
}

function toMessageKind(type = "", attachmentMeta = null) {
  const cleanType = lower(type, 40);
  if (cleanType === "text") return "message";
  const attachmentKind = lower(attachmentMeta?.attachmentKind, 40);
  if (cleanType === "photo" || cleanType === "image" || attachmentKind === "photo" || attachmentKind === "image") {
    return "photo";
  }
  return "document";
}

async function sendMessageCommandFallback(envelope = {}) {
  const actorUid = safeStr(envelope?.actorUid, 180);
  const actorRole = safeRoleHint(envelope?.actorRole) || "user";
  const requestId = safeStr(envelope?.requestId, 180);
  const payload = envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {};
  const toRole = lower(payload?.toRole, 40);
  const text = safeStr(payload?.text, 4000);
  const rawAttachment =
    payload?.attachmentMeta && typeof payload.attachmentMeta === "object"
      ? payload.attachmentMeta
      : payload?.pdfMeta && typeof payload.pdfMeta === "object"
      ? payload.pdfMeta
      : null;
  const attachmentMeta = normalizeMessageAttachmentMeta(rawAttachment);
  const type = normalizeOutgoingMessageType(payload?.type, attachmentMeta);

  if (!actorUid) {
    throw new Error("Local sendMessage fallback requires an authenticated user.");
  }
  if (!requestId) {
    throw new Error("Local sendMessage fallback requires a requestId.");
  }
  if (toRole !== "user" && toRole !== "staff") {
    throw new Error("toRole must be user or staff.");
  }
  if (!["text", "document", "image", "photo", "bundle"].includes(type)) {
    throw new Error("Unsupported message type.");
  }
  if (type === "text" && !text) {
    throw new Error("Text cannot be empty.");
  }
  if ((type === "document" || type === "image" || type === "photo") && !attachmentMeta) {
    throw new Error("attachmentMeta is required for file messages.");
  }
  if (type === "bundle" && !text && !attachmentMeta) {
    throw new Error("Bundle cannot be empty.");
  }

  const requestRef = doc(db, "serviceRequests", requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) {
    throw new Error("Request not found.");
  }

  const request = requestSnap.data() || {};
  const ownerUid = safeStr(request?.uid, 180);
  const staffUid = resolveRequestStaffUid(request);
  const normalizedActorRole = actorRole === "super_admin" ? "admin" : actorRole;

  if (normalizedActorRole === "user" && ownerUid && ownerUid !== actorUid) {
    throw new Error("This request does not belong to the current user.");
  }
  if (normalizedActorRole === "staff" && staffUid && staffUid !== actorUid) {
    throw new Error("This request is assigned to a different staff account.");
  }
  if (normalizedActorRole === "user" && toRole !== "staff") {
    throw new Error("User can only send to staff.");
  }
  if (normalizedActorRole === "staff" && toRole !== "user") {
    throw new Error("Staff can only send to user.");
  }

  const now = Date.now();
  if (normalizedActorRole === "admin" || request.chatAutoAccept === true) {
    const messageRef = doc(collection(db, "serviceRequests", requestId, "messages"));
    const toUid = toRole === "user" ? ownerUid : staffUid;
    const documentPayload = {
      requestId,
      fromRole: normalizedActorRole,
      fromUid: actorUid,
      toRole,
      toUid: toUid || null,
      type,
      messageKind: toMessageKind(type, attachmentMeta),
      text: type === "text" || type === "bundle" ? text : "",
      attachmentMeta: type === "text" ? null : attachmentMeta,
      pdfMeta:
        type === "document" ||
        (type === "bundle" && lower(attachmentMeta?.attachmentKind || "document", 40) === "document")
          ? attachmentMeta
          : null,
      createdAt: serverTimestamp(),
      createdAtMs: now,
      needsAssignment: toRole === "staff" && !toUid,
    };

    if (normalizedActorRole === "admin") {
      documentPayload.approvedBy = actorUid;
      documentPayload.approvedAt = serverTimestamp();
    } else {
      documentPayload.moderationBypassed = true;
      documentPayload.moderationMode = "request_auto_accept";
    }

    await setDoc(messageRef, documentPayload);
    return {
      ok: true,
      command: "sendMessage",
      requestId,
      messageId: messageRef.id,
      status: "published",
      localFallback: true,
    };
  }

  const pendingRef = doc(collection(db, "serviceRequests", requestId, "pendingMessages"));
  await setDoc(pendingRef, {
    requestId,
    fromRole: normalizedActorRole,
    fromUid: actorUid,
    toRole,
    type,
    messageKind: toMessageKind(type, attachmentMeta),
    text: type === "text" || type === "bundle" ? text : "",
    attachmentMeta: type === "text" ? null : attachmentMeta,
    pdfMeta:
      type === "document" ||
      (type === "bundle" && lower(attachmentMeta?.attachmentKind || "document", 40) === "document")
        ? attachmentMeta
        : null,
    status: "pending",
    createdAt: serverTimestamp(),
    createdAtMs: now,
  });
  return {
    ok: true,
    command: "sendMessage",
    requestId,
    messageId: pendingRef.id,
    status: "pending",
    localFallback: true,
  };
}

function formatCommandBackendError(error, callableName = "") {
  const code = safeStr(error?.code, 160).toLowerCase();
  const message = safeStr(error?.message).toLowerCase();
  const status = Number(error?.status || 0) || 0;
  const isInfraError =
    Boolean(error?.isInfrastructureUnavailable) ||
    code.startsWith("api/") ||
    status === 0 ||
    status === 404 ||
    status === 429 ||
    status === 500 ||
    status === 501 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (message.includes("backend") && message.includes("not available")) ||
    message === "internal";

  const label = safeStr(callableName, 80) || "Request command";
  const wrapped = new Error(
    isInfraError
      ? `${label} backend is not available right now.`
      : safeStr(error?.message, 600) || "Request command failed. Please try again."
  );
  wrapped.code = code || (status ? `api/${status}` : "api/request-failed");
  wrapped.status = status || null;
  wrapped.isInfrastructureUnavailable = isInfraError;
  return wrapped;
}

function isFirestorePermissionDenied(error) {
  const code = safeStr(error?.code, 160).toLowerCase();
  const message = safeStr(error?.message, 600).toLowerCase();
  return (
    code === "permission-denied" ||
    code === "firebase/permission-denied" ||
    message.includes("missing or insufficient permissions")
  );
}

function formatSendMessageFallbackError(error) {
  if (!isFirestorePermissionDenied(error)) return error;

  const wrapped = new Error(
    "Chat fallback is blocked by Firestore rules right now. Deploy the latest Firestore rules so fallback chat writes to /pendingMessages and auto-accepted /messages are allowed."
  );
  wrapped.code = "firestore/permission-denied";
  wrapped.cause = error;
  return wrapped;
}

function isInfrastructureUnavailable(error) {
  const code = safeStr(error?.code, 160).toLowerCase();
  const message = safeStr(error?.message).toLowerCase();
  const status = Number(error?.status || 0) || 0;
  return (
    Boolean(error?.isInfrastructureUnavailable) ||
    code.startsWith("api/") ||
    status === 0 ||
    status === 404 ||
    status === 429 ||
    status === 500 ||
    status === 501 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "internal" ||
    message.includes("backend is not available")
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
  const envelope = buildCommandEnvelope({ command, requestId, payload, actorRole });
  try {
    const result = await invokeRequestCommand(envelope);
    if (
      safeStr(envelope?.command, 80) === "createRequest" &&
      !safeStr(result?.requestId, 180)
    ) {
      console.warn(
        "createRequest command returned without requestId; using local fallback."
      );
      return createRequestCommandFallback(envelope);
    }
    return result;
  } catch (error) {
    if (safeStr(envelope?.command, 80) === "createRequest" && isInfrastructureUnavailable(error)) {
      return createRequestCommandFallback(envelope);
    }
    if (safeStr(envelope?.command, 80) === "sendMessage" && isInfrastructureUnavailable(error)) {
      try {
        return await sendMessageCommandFallback(envelope);
      } catch (fallbackError) {
        throw formatSendMessageFallbackError(fallbackError);
      }
    }
    throw formatCommandBackendError(error, "executeRequestCommand");
  }
}

function callNamedCommand(name, payload = {}) {
  return invokeRequestAction(name, payload)
    .catch((error) => {
      throw formatCommandBackendError(error, name);
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
  const payload = {
    requestId: safeStr(requestId, 180),
    toRole: safeStr(toRole, 40),
    type: safeStr(type, 20),
    text: safeStr(text, 4000),
    actorRole: safeRoleHint(actorRole),
    ...(normalizedAttachment
      ? { attachmentMeta: normalizedAttachment, pdfMeta: normalizedAttachment }
      : {}),
  };

  return invokeRequestMessage(payload).catch(async (error) => {
    if (!isInfrastructureUnavailable(error)) {
      throw formatCommandBackendError(error, "sendMessage");
    }
    try {
      return await sendMessageCommandFallback(
        buildCommandEnvelope({
          command: "sendMessage",
          requestId,
          actorRole,
          payload,
        })
      );
    } catch (fallbackError) {
      throw formatSendMessageFallbackError(fallbackError);
    }
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

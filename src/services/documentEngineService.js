import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

const DOCUMENTS_COLLECTION = "documents";
const DOCUMENT_LINKS_COLLECTION = "documentLinks";

const USER_BUCKET_UPLOADED = "uploaded";
const USER_BUCKET_RECEIVED = "received";

const REQUEST_BUCKET_RECEIVED_FROM_USER = "received_from_user";
const REQUEST_BUCKET_SENT_TO_USER = "sent_to_user";
const REQUEST_BUCKET_FINAL = "final";
const REQUEST_BUCKET_SELF_HELP = "self_help";
const REQUEST_BUCKET_INTERNAL = "internal";
const MAX_AUDIT_DETAILS = 80;
const MAX_LINKS_TO_UPDATE_PER_LIFECYCLE_WRITE = 450;

function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRole(role) {
  const clean = safeStr(role, 20).toLowerCase();
  if (clean === "admin" || clean === "staff" || clean === "user") return clean;
  return "user";
}

function normalizeDocState(status) {
  const clean = safeStr(status, 40).toLowerCase();
  if (clean === "uploaded" || clean === "approved") return "available";
  if (clean === "failed" || clean === "rejected") return "failed";
  if (clean === "archived") return "archived";
  return "meta_only";
}

function normalizeStorageKind({ url = "", explicitKind = "" } = {}) {
  const kind = safeStr(explicitKind, 30).toLowerCase();
  if (kind === "bucket" || kind === "external" || kind === "meta") return kind;
  const cleanUrl = safeStr(url, 1200);
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) return "external";
  return "meta";
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return safeNum(value);
  if (typeof value === "object" && typeof value.toMillis === "function") {
    return safeNum(value.toMillis());
  }
  return 0;
}

function compareRowsByCreatedAtDesc(left, right) {
  const leftMs = safeNum(left?.createdAtMs || toMs(left?.createdAt));
  const rightMs = safeNum(right?.createdAtMs || toMs(right?.createdAt));
  return rightMs - leftMs;
}

function idPart(value, max = 80) {
  const clean = safeStr(value, max).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return clean || "x";
}

function buildMirrorId(parts) {
  const clean = (Array.isArray(parts) ? parts : [])
    .map((item) => idPart(item))
    .filter(Boolean);
  return clean.join("__").slice(0, 220);
}

function mergeDisplayFromInput(input) {
  const name = safeStr(input?.name || input?.fileName || input?.filename, 180) || "Document";
  const contentType =
    safeStr(input?.contentType || input?.type || input?.mime, 80) || "application/pdf";
  const sizeBytes = safeNum(input?.sizeBytes || input?.size || input?.fileSize);
  const note = safeStr(input?.note || input?.metaNote || input?.description, 1200);
  return { name, contentType, sizeBytes, note };
}

function buildLinkPreview(documentPayload) {
  return {
    name: safeStr(documentPayload?.display?.name, 180) || "Document",
    contentType: safeStr(documentPayload?.display?.contentType, 80),
    sizeBytes: safeNum(documentPayload?.display?.sizeBytes),
    state: safeStr(documentPayload?.state, 40) || "meta_only",
    stage: safeStr(documentPayload?.stage, 30) || "working",
    storageKind: safeStr(documentPayload?.storage?.kind, 30) || "meta",
    externalUrl: safeStr(documentPayload?.storage?.externalUrl, 1200),
    sourceChannel: safeStr(documentPayload?.sourceChannel, 60),
  };
}

function sanitizeDocumentPayload(input = {}) {
  const userUid = safeStr(input?.userUid, 120);
  const requestId = safeStr(input?.requestId, 120);
  const stage = safeStr(input?.stage, 30).toLowerCase() || "working";
  const scope = safeStr(input?.scope, 30).toLowerCase() || (requestId ? "request" : "user_vault");
  const sourceChannel = safeStr(input?.sourceChannel, 60).toLowerCase() || "migration";
  const state = safeStr(input?.state, 40).toLowerCase() || "meta_only";
  const createdByUid = safeStr(input?.createdByUid, 120);
  const createdByRole = normalizeRole(input?.createdByRole);
  const visibility = {
    user: input?.visibility?.user !== false,
    staff: Boolean(input?.visibility?.staff),
    admin: input?.visibility?.admin !== false,
  };
  const display = mergeDisplayFromInput(input?.display || input);
  const storage = {
    kind: normalizeStorageKind({
      url: input?.storage?.externalUrl || input?.externalUrl || input?.url,
      explicitKind: input?.storage?.kind || input?.storageKind,
    }),
    externalUrl: safeStr(
      input?.storage?.externalUrl || input?.externalUrl || input?.url || "",
      1200
    ),
    bucket: safeStr(input?.storage?.bucket, 160),
    path: safeStr(input?.storage?.path, 400),
    checksum: safeStr(input?.storage?.checksum, 120),
    generation: safeStr(input?.storage?.generation, 80),
  };
  const classification = {
    docType: safeStr(input?.classification?.docType || input?.docType, 80),
    tags: Array.isArray(input?.classification?.tags)
      ? input.classification.tags.map((tag) => safeStr(tag, 40)).filter(Boolean).slice(0, 20)
      : [],
    fieldId: safeStr(input?.classification?.fieldId || input?.fieldId, 120),
    fieldLabel: safeStr(input?.classification?.fieldLabel || input?.fieldLabel, 180),
    kind: safeStr(input?.classification?.kind || input?.kind, 80),
  };
  const context = {
    track: safeStr(input?.context?.track || input?.track, 30),
    country: safeStr(input?.context?.country || input?.country, 80),
    category: safeStr(input?.context?.category || input?.category, 80),
    stepId: safeStr(input?.context?.stepId || input?.stepId, 120),
    stepTitle: safeStr(input?.context?.stepTitle || input?.stepTitle, 180),
  };
  const legacy = {
    collection: safeStr(input?.legacy?.collection || input?.legacyCollection, 80),
    id: safeStr(input?.legacy?.id || input?.legacyId, 180),
    requestPath: safeStr(input?.legacy?.requestPath || input?.legacyRequestPath, 320),
  };

  return {
    userUid,
    requestId,
    scope,
    stage,
    state,
    sourceChannel,
    createdByUid,
    createdByRole,
    visibility,
    display,
    storage,
    classification,
    context,
    legacy,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  };
}

function sanitizeLinkPayload(input = {}, documentPayload = null) {
  const userUid = safeStr(input?.userUid || documentPayload?.userUid, 120);
  const requestId = safeStr(input?.requestId || documentPayload?.requestId, 120);
  const contextType = safeStr(input?.contextType, 60).toLowerCase() || "request_upload";
  const contextId = safeStr(input?.contextId, 180);
  const userBucket = safeStr(input?.userBucket, 30).toLowerCase() || USER_BUCKET_UPLOADED;
  const requestBucket = safeStr(input?.requestBucket, 40).toLowerCase() || REQUEST_BUCKET_INTERNAL;
  const visibleToUser = input?.visibleToUser !== false;
  const visibleToStaff = Boolean(input?.visibleToStaff);
  const visibleToAdmin = input?.visibleToAdmin !== false;
  const preview = buildLinkPreview(documentPayload || {});

  return {
    userUid,
    requestId,
    contextType,
    contextId,
    userBucket,
    requestBucket,
    visibleToUser,
    visibleToStaff,
    visibleToAdmin,
    preview,
    fieldId: safeStr(
      input?.fieldId || documentPayload?.classification?.fieldId,
      120
    ),
    fieldLabel: safeStr(
      input?.fieldLabel || documentPayload?.classification?.fieldLabel,
      180
    ),
    kind: safeStr(input?.kind || documentPayload?.classification?.kind, 80),
    note: safeStr(input?.note || documentPayload?.display?.note, 1200),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  };
}

export async function upsertDocumentAndLink({
  documentId,
  documentPayload,
  linkId,
  linkPayload,
} = {}) {
  const safeDocumentId = safeStr(documentId, 220);
  const safeLinkId = safeStr(linkId, 220);
  if (!safeDocumentId) throw new Error("Missing documentId");
  if (!safeLinkId) throw new Error("Missing linkId");

  const docData = sanitizeDocumentPayload(documentPayload);
  const linkData = sanitizeLinkPayload(linkPayload, docData);
  const batch = writeBatch(db);

  const documentRef = doc(db, DOCUMENTS_COLLECTION, safeDocumentId);
  const linkRef = doc(db, DOCUMENT_LINKS_COLLECTION, safeLinkId);

  batch.set(
    documentRef,
    {
      ...docData,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    },
    { merge: true }
  );

  batch.set(
    linkRef,
    {
      ...linkData,
      documentId: safeDocumentId,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
    },
    { merge: true }
  );

  await batch.commit();
  return { documentId: safeDocumentId, linkId: safeLinkId };
}

export async function mirrorLegacyRequestAttachment({
  requestId,
  requestUid,
  attachmentId,
  attachment = {},
  actorUid = "",
  actorRole = "user",
  sourceChannel = "request_modal",
} = {}) {
  const rid = safeStr(requestId, 120);
  const uid = safeStr(requestUid, 120);
  const aid = safeStr(attachmentId, 180);
  if (!rid || !uid || !aid) return null;

  const docId = buildMirrorId(["request", rid, "attachment", aid]);
  const linkId = buildMirrorId(["request", rid, "attachment", aid, "link"]);
  const state = normalizeDocState(attachment?.status);
  const display = mergeDisplayFromInput(attachment);

  return upsertDocumentAndLink({
    documentId: docId,
    linkId,
    documentPayload: {
      userUid: uid,
      requestId: rid,
      scope: "request",
      stage: "working",
      state,
      sourceChannel,
      createdByUid: safeStr(actorUid, 120) || uid,
      createdByRole: normalizeRole(actorRole),
      visibility: { user: true, staff: true, admin: true },
      display,
      storage: {
        kind: normalizeStorageKind({ url: attachment?.url }),
        externalUrl: safeStr(attachment?.url || attachment?.downloadUrl || attachment?.fileUrl, 1200),
      },
      classification: {
        fieldId: safeStr(attachment?.fieldId, 120),
        fieldLabel: safeStr(attachment?.fieldLabel || attachment?.label, 180),
        kind: safeStr(attachment?.kind, 80),
      },
      legacyCollection: "serviceRequests.attachments",
      legacyId: aid,
      legacyRequestPath: `serviceRequests/${rid}/attachments/${aid}`,
    },
    linkPayload: {
      userUid: uid,
      requestId: rid,
      contextType: "request_upload",
      contextId: aid,
      userBucket: USER_BUCKET_UPLOADED,
      requestBucket: REQUEST_BUCKET_RECEIVED_FROM_USER,
      visibleToUser: true,
      visibleToStaff: true,
      visibleToAdmin: true,
    },
  });
}

export async function mirrorLegacyPublishedRequestDocument({
  requestId,
  requestUid,
  adminFileId,
  file = {},
  actorUid = "",
} = {}) {
  const rid = safeStr(requestId, 120);
  const uid = safeStr(requestUid, 120);
  const fid = safeStr(adminFileId, 180);
  if (!rid || !uid || !fid) return null;

  const docId = buildMirrorId(["request", rid, "admin_file", fid]);
  const linkId = buildMirrorId(["request", rid, "admin_file", fid, "link"]);
  const stage = "final";

  return upsertDocumentAndLink({
    documentId: docId,
    linkId,
    documentPayload: {
      userUid: uid,
      requestId: rid,
      scope: "request",
      stage,
      state: "available",
      sourceChannel: "admin_publish",
      createdByUid: safeStr(actorUid, 120),
      createdByRole: "admin",
      visibility: { user: true, staff: true, admin: true },
      display: {
        name: safeStr(file?.name || "Document", 180),
        contentType: safeStr(file?.contentType || "link", 80) || "link",
        sizeBytes: safeNum(file?.sizeBytes || file?.size),
        note: safeStr(file?.meta?.note || file?.note, 1200),
      },
      storage: {
        kind: normalizeStorageKind({ url: file?.url, explicitKind: file?.storageKind || "external" }),
        externalUrl: safeStr(file?.url, 1200),
      },
      classification: {
        kind: "admin_final_delivery",
      },
      legacyCollection: "serviceRequests.adminFiles",
      legacyId: fid,
      legacyRequestPath: `serviceRequests/${rid}/adminFiles/${fid}`,
    },
    linkPayload: {
      userUid: uid,
      requestId: rid,
      contextType: "request_delivery",
      contextId: fid,
      userBucket: USER_BUCKET_RECEIVED,
      requestBucket: REQUEST_BUCKET_FINAL,
      visibleToUser: true,
      visibleToStaff: true,
      visibleToAdmin: true,
    },
  });
}

function resolveChatUserBucket({ requestUid, fromUid, toRole, toUid }) {
  const owner = safeStr(requestUid, 120);
  const sender = safeStr(fromUid, 120);
  const receiver = safeStr(toUid, 120);

  const userIsSender = owner && sender && owner === sender;
  const userIsReceiver =
    (owner && receiver && owner === receiver) || safeStr(toRole, 20).toLowerCase() === "user";

  if (userIsSender) return USER_BUCKET_UPLOADED;
  if (userIsReceiver) return USER_BUCKET_RECEIVED;
  return USER_BUCKET_RECEIVED;
}

function resolveChatRequestBucket({ fromRole, toRole }) {
  const from = safeStr(fromRole, 20).toLowerCase();
  const to = safeStr(toRole, 20).toLowerCase();
  if (from === "user") return REQUEST_BUCKET_RECEIVED_FROM_USER;
  if (to === "user") return REQUEST_BUCKET_SENT_TO_USER;
  return REQUEST_BUCKET_INTERNAL;
}

function isUserVisibleChatDocument({ requestUid, fromUid, toUid, toRole }) {
  const owner = safeStr(requestUid, 120);
  if (!owner) return false;
  if (safeStr(fromUid, 120) === owner) return true;
  if (safeStr(toUid, 120) === owner) return true;
  return safeStr(toRole, 20).toLowerCase() === "user";
}

function normalizeChatAttachmentKind(kind = "", contentType = "") {
  const raw = safeStr(kind, 20).toLowerCase();
  if (raw === "photo" || raw === "image") return "photo";
  const mime = safeStr(contentType, 80).toLowerCase();
  if (mime.startsWith("image/")) return "photo";
  return "document";
}

export async function mirrorPublishedChatAttachment({
  requestId,
  requestUid,
  messageId,
  attachmentMeta = {},
  fromRole = "user",
  fromUid = "",
  toRole = "staff",
  toUid = "",
  actorUid = "",
  sourceChannel = "chat_message",
} = {}) {
  const rid = safeStr(requestId, 120);
  const uid = safeStr(requestUid, 120);
  const mid = safeStr(messageId, 180);
  const name = safeStr(attachmentMeta?.name, 180);
  if (!rid || !uid || !mid || !name) return null;
  const contentType = safeStr(
    attachmentMeta?.mime || attachmentMeta?.type || attachmentMeta?.contentType || "application/octet-stream",
    80
  );
  const attachmentKind = normalizeChatAttachmentKind(
    attachmentMeta?.attachmentKind || attachmentMeta?.kind,
    contentType
  );
  const canonicalKind = attachmentKind === "photo" ? "chat_photo" : "chat_document";

  const userBucket = resolveChatUserBucket({
    requestUid: uid,
    fromUid,
    toRole,
    toUid,
  });
  const requestBucket = resolveChatRequestBucket({ fromRole, toRole });
  const userVisible = isUserVisibleChatDocument({
    requestUid: uid,
    fromUid,
    toUid,
    toRole,
  });

  const docId = buildMirrorId(["request", rid, canonicalKind, mid]);
  const linkId = buildMirrorId(["request", rid, canonicalKind, mid, "link"]);

  return upsertDocumentAndLink({
    documentId: docId,
    linkId,
    documentPayload: {
      userUid: uid,
      requestId: rid,
      scope: "request",
      stage: "working",
      state: "meta_only",
      sourceChannel,
      createdByUid: safeStr(actorUid, 120) || safeStr(fromUid, 120) || uid,
      createdByRole: normalizeRole(fromRole),
      visibility: {
        user: userVisible,
        staff: true,
        admin: true,
      },
      display: {
        name,
        contentType,
        sizeBytes: safeNum(attachmentMeta?.size || attachmentMeta?.sizeBytes),
        note: safeStr(attachmentMeta?.note, 1200),
      },
      storage: {
        kind: "meta",
        externalUrl: "",
      },
      classification: {
        kind: canonicalKind,
      },
      legacyCollection: "serviceRequests.messages",
      legacyId: mid,
      legacyRequestPath: `serviceRequests/${rid}/messages/${mid}`,
    },
    linkPayload: {
      userUid: uid,
      requestId: rid,
      contextType: "request_chat",
      contextId: mid,
      userBucket,
      requestBucket,
      visibleToUser: userVisible,
      visibleToStaff: true,
      visibleToAdmin: true,
    },
  });
}

export async function mirrorPublishedChatPdf({
  requestId,
  requestUid,
  messageId,
  pdfMeta = {},
  fromRole = "user",
  fromUid = "",
  toRole = "staff",
  toUid = "",
  actorUid = "",
  sourceChannel = "chat_message",
} = {}) {
  return mirrorPublishedChatAttachment({
    requestId,
    requestUid,
    messageId,
    attachmentMeta: {
      ...(pdfMeta && typeof pdfMeta === "object" ? pdfMeta : {}),
      attachmentKind: "document",
    },
    fromRole,
    fromUid,
    toRole,
    toUid,
    actorUid,
    sourceChannel,
  });
}

export async function mirrorSelfHelpDocumentRecord({
  uid,
  record = {},
  actorUid = "",
} = {}) {
  const userUid = safeStr(uid, 120);
  const recordId = safeStr(record?.id, 240);
  if (!userUid || !recordId) return null;

  const docId = buildMirrorId(["self_help", userUid, recordId]);
  const linkId = buildMirrorId(["self_help", userUid, recordId, "link"]);

  return upsertDocumentAndLink({
    documentId: docId,
    linkId,
    documentPayload: {
      userUid,
      requestId: "",
      scope: "self_help",
      stage: "vault",
      state: "meta_only",
      sourceChannel: "self_help",
      createdByUid: safeStr(actorUid, 120) || userUid,
      createdByRole: "user",
      visibility: { user: true, staff: false, admin: true },
      display: {
        name: safeStr(record?.fileName || record?.documentType || "Self-help document", 180),
        contentType: safeStr(record?.fileType || "meta", 80),
        sizeBytes: safeNum(record?.fileSize),
        note: safeStr(record?.notes, 1200),
      },
      storage: {
        kind: "meta",
        externalUrl: safeStr(record?.localRef, 1200),
      },
      classification: {
        kind: "self_help_document",
      },
      context: {
        track: safeStr(record?.track, 30),
        country: safeStr(record?.country, 80),
        category: safeStr(record?.category, 80),
        stepId: safeStr(record?.stepId, 120),
        stepTitle: safeStr(record?.stepTitle, 180),
      },
      legacyCollection: "users.selfHelpDocuments",
      legacyId: recordId,
      legacyRequestPath: `users/${userUid}/selfHelpDocuments/${recordId}`,
    },
    linkPayload: {
      userUid,
      requestId: "",
      contextType: "self_help",
      contextId: recordId,
      userBucket: USER_BUCKET_UPLOADED,
      requestBucket: REQUEST_BUCKET_SELF_HELP,
      visibleToUser: true,
      visibleToStaff: false,
      visibleToAdmin: true,
    },
  });
}

export async function deleteSelfHelpDocumentMirror({ uid, recordId } = {}) {
  const userUid = safeStr(uid, 120);
  const rid = safeStr(recordId, 240);
  if (!userUid || !rid) return;

  const docId = buildMirrorId(["self_help", userUid, rid]);
  const linkId = buildMirrorId(["self_help", userUid, rid, "link"]);
  await Promise.all([
    deleteDoc(doc(db, DOCUMENT_LINKS_COLLECTION, linkId)).catch(() => {}),
    deleteDoc(doc(db, DOCUMENTS_COLLECTION, docId)).catch(() => {}),
  ]);
}

export function subscribeUserDocumentHub({
  uid,
  max = 400,
  onData,
  onError,
} = {}) {
  const userUid = safeStr(uid, 120);
  if (!userUid) {
    onData?.({ uploaded: [], downloaded: [], received: [], all: [] });
    return () => {};
  }

  const qy = query(
    collection(db, DOCUMENT_LINKS_COLLECTION),
    where("userUid", "==", userUid),
    limit(Math.max(1, safeNum(max) || 400))
  );

  return onSnapshot(
    qy,
    (snap) => {
      const allRows = snap.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((row) => row?.visibleToUser !== false)
        .sort(compareRowsByCreatedAtDesc);
      const uploaded = allRows.filter(
        (row) => safeStr(row?.userBucket, 30).toLowerCase() === USER_BUCKET_UPLOADED
      );
      const received = allRows.filter(
        (row) => safeStr(row?.userBucket, 30).toLowerCase() === USER_BUCKET_RECEIVED
      );
      onData?.({ uploaded, downloaded: received, received, all: allRows });
    },
    (error) => {
      onError?.(error);
    }
  );
}

export function subscribeRequestDocumentContext({
  requestId,
  viewerRole = "user",
  max = 500,
  onData,
  onError,
} = {}) {
  const rid = safeStr(requestId, 120);
  const role = normalizeRole(viewerRole);
  if (!rid) {
    onData?.([]);
    return () => {};
  }

  const qy = query(
    collection(db, DOCUMENT_LINKS_COLLECTION),
    where("requestId", "==", rid),
    limit(Math.max(1, safeNum(max) || 500))
  );

  return onSnapshot(
    qy,
    (snap) => {
      const rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      const filtered = rows
        .filter((row) => {
          if (role === "admin") return row?.visibleToAdmin !== false;
          if (role === "staff") return row?.visibleToStaff === true || row?.visibleToAdmin === true;
          return row?.visibleToUser !== false;
        })
        .sort(compareRowsByCreatedAtDesc);
      onData?.(filtered);
    },
    (error) => {
      onError?.(error);
    }
  );
}

function mapLinkStateToLegacyStatus(state) {
  const clean = safeStr(state, 40).toLowerCase();
  if (clean === "available") return "uploaded";
  if (clean === "failed") return "rejected";
  if (clean === "archived") return "archived";
  return "pending_upload";
}

function toCreatedAtMs(row) {
  return safeNum(row?.createdAtMs || toMs(row?.createdAt) || row?.updatedAtMs || toMs(row?.updatedAt));
}

function mapLinkToLegacyAttachment(row) {
  const requestId = safeStr(row?.requestId, 120);
  const documentId = safeStr(row?.documentId || row?.id, 220);
  return {
    id: documentId || safeStr(row?.id, 220),
    requestId,
    name: safeStr(row?.preview?.name, 180) || "Document",
    size: safeNum(row?.preview?.sizeBytes),
    contentType: safeStr(row?.preview?.contentType, 80) || "application/pdf",
    status: mapLinkStateToLegacyStatus(row?.preview?.state),
    url: safeStr(row?.preview?.externalUrl, 1200),
    fieldId: safeStr(row?.fieldId, 120),
    fieldLabel: safeStr(row?.fieldLabel, 180),
    label: safeStr(row?.fieldLabel, 180),
    kind: safeStr(row?.kind, 80),
    metaNote: safeStr(row?.note, 1200),
    sourceChannel: safeStr(row?.sourceChannel || row?.preview?.sourceChannel, 60),
    createdAtMs: toCreatedAtMs(row),
  };
}

function mapLinkToLegacyAdminFile(row) {
  const documentId = safeStr(row?.documentId || row?.id, 220);
  return {
    id: documentId || safeStr(row?.id, 220),
    name: safeStr(row?.preview?.name, 180) || "Document",
    url: safeStr(row?.preview?.externalUrl, 1200),
    source: safeStr(row?.preview?.sourceChannel || row?.sourceChannel, 60) || "document_engine",
    createdAtMs: toCreatedAtMs(row),
    meta: {
      contextType: safeStr(row?.contextType, 60),
      requestBucket: safeStr(row?.requestBucket, 40),
      kind: safeStr(row?.kind, 80),
      note: safeStr(row?.note, 1200),
    },
  };
}

export function splitRequestDocumentsForLegacyViews(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const receivedRows = [];
  const sentRows = [];

  list.forEach((row) => {
    const contextType = safeStr(row?.contextType, 60).toLowerCase();
    const bucket = safeStr(row?.requestBucket, 40).toLowerCase();
    if (contextType === "request_chat") {
      // Chat attachments should be visible in request documents for both directions.
      receivedRows.push(row);
      return;
    }
    if (bucket === REQUEST_BUCKET_RECEIVED_FROM_USER) {
      receivedRows.push(row);
      return;
    }
    if (bucket === REQUEST_BUCKET_SENT_TO_USER || bucket === REQUEST_BUCKET_FINAL) {
      sentRows.push(row);
    }
  });

  const attachments = receivedRows
    .map(mapLinkToLegacyAttachment)
    .sort((left, right) => safeNum(right?.createdAtMs) - safeNum(left?.createdAtMs));
  const adminFiles = sentRows
    .map(mapLinkToLegacyAdminFile)
    .sort((left, right) => safeNum(right?.createdAtMs) - safeNum(left?.createdAtMs));

  return { attachments, adminFiles };
}

function safeLimit(value, fallback = 300) {
  const clean = safeNum(value || fallback);
  if (!clean) return fallback;
  return Math.max(1, Math.min(5000, clean));
}

function safeDetailsLimit(value) {
  const clean = safeNum(value || MAX_AUDIT_DETAILS);
  if (!clean) return MAX_AUDIT_DETAILS;
  return Math.max(0, Math.min(240, clean));
}

function mapLegacyAttachmentAuditItem({ requestId, rowId, row = {} } = {}) {
  const rid = safeStr(requestId, 120);
  const legacyId = safeStr(rowId, 180);
  if (!rid || !legacyId) return null;
  return {
    source: "attachments",
    legacyId,
    legacyPath: `serviceRequests/${rid}/attachments/${legacyId}`,
    expectedDocumentId: buildMirrorId(["request", rid, "attachment", legacyId]),
    expectedLinkId: buildMirrorId(["request", rid, "attachment", legacyId, "link"]),
    name: safeStr(row?.name || row?.filename, 180) || "Document",
    meta: {
      status: safeStr(row?.status, 40),
      fieldId: safeStr(row?.fieldId, 120),
      fieldLabel: safeStr(row?.fieldLabel || row?.label, 180),
    },
  };
}

function mapLegacyAdminFileAuditItem({ requestId, rowId, row = {} } = {}) {
  const rid = safeStr(requestId, 120);
  const legacyId = safeStr(rowId, 180);
  if (!rid || !legacyId) return null;
  return {
    source: "adminFiles",
    legacyId,
    legacyPath: `serviceRequests/${rid}/adminFiles/${legacyId}`,
    expectedDocumentId: buildMirrorId(["request", rid, "admin_file", legacyId]),
    expectedLinkId: buildMirrorId(["request", rid, "admin_file", legacyId, "link"]),
    name: safeStr(row?.name, 180) || "Document",
    meta: {
      stage: "final",
    },
  };
}

function isEligibleLegacyChatPdfMessage(row = {}) {
  const type = safeStr(row?.type, 30).toLowerCase();
  const name = safeStr(row?.pdfMeta?.name, 180);
  return (type === "pdf" || type === "bundle") && Boolean(name);
}

function mapLegacyChatAuditItem({ requestId, rowId, row = {} } = {}) {
  const rid = safeStr(requestId, 120);
  const legacyId = safeStr(rowId, 180);
  if (!rid || !legacyId || !isEligibleLegacyChatPdfMessage(row)) return null;
  return {
    source: "messages",
    legacyId,
    legacyPath: `serviceRequests/${rid}/messages/${legacyId}`,
    expectedDocumentId: buildMirrorId(["request", rid, "chat_pdf", legacyId]),
    expectedLinkId: buildMirrorId(["request", rid, "chat_pdf", legacyId, "link"]),
    name: safeStr(row?.pdfMeta?.name, 180) || "Document",
    meta: {
      type: safeStr(row?.type, 20),
      fromRole: safeStr(row?.fromRole, 20),
      toRole: safeStr(row?.toRole, 20),
    },
  };
}

function mapLegacySelfHelpAuditItem({ uid, rowId, row = {} } = {}) {
  const userUid = safeStr(uid, 120);
  const legacyId = safeStr(rowId, 240);
  if (!userUid || !legacyId) return null;
  return {
    source: "selfHelpDocuments",
    legacyId,
    legacyPath: `users/${userUid}/selfHelpDocuments/${legacyId}`,
    expectedDocumentId: buildMirrorId(["self_help", userUid, legacyId]),
    expectedLinkId: buildMirrorId(["self_help", userUid, legacyId, "link"]),
    name: safeStr(row?.fileName || row?.documentType, 180) || "Self-help document",
    meta: {
      track: safeStr(row?.track, 30),
      country: safeStr(row?.country, 80),
    },
  };
}

function buildAuditMissingRows({ expected = [], linkIdSet, docIdSet, maxDetails = MAX_AUDIT_DETAILS }) {
  const detailsCap = safeDetailsLimit(maxDetails);
  const missingRows = [];
  let missingDocCount = 0;
  let missingLinkCount = 0;
  let fullyMissingCount = 0;

  expected.forEach((row) => {
    const hasDoc = docIdSet.has(row.expectedDocumentId);
    const hasLink = linkIdSet.has(row.expectedLinkId);
    if (hasDoc && hasLink) return;

    if (!hasDoc) missingDocCount += 1;
    if (!hasLink) missingLinkCount += 1;
    if (!hasDoc && !hasLink) fullyMissingCount += 1;

    if (missingRows.length >= detailsCap) return;
    missingRows.push({
      source: row.source,
      legacyId: row.legacyId,
      legacyPath: row.legacyPath,
      expectedDocumentId: row.expectedDocumentId,
      expectedLinkId: row.expectedLinkId,
      hasDocument: hasDoc,
      hasLink,
      name: row.name,
      meta: row.meta || {},
    });
  });

  return {
    missingRows,
    missingDocCount,
    missingLinkCount,
    fullyMissingCount,
  };
}

function summarizeRequestCanonicalLinks(rows = []) {
  const stats = {
    total: 0,
    byContextType: {},
    byRequestBucket: {},
    byUserBucket: {},
  };

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    stats.total += 1;
    const contextType = safeStr(row?.contextType, 60).toLowerCase() || "unknown";
    const requestBucket = safeStr(row?.requestBucket, 40).toLowerCase() || "unknown";
    const userBucket = safeStr(row?.userBucket, 30).toLowerCase() || "unknown";

    stats.byContextType[contextType] = (stats.byContextType[contextType] || 0) + 1;
    stats.byRequestBucket[requestBucket] = (stats.byRequestBucket[requestBucket] || 0) + 1;
    stats.byUserBucket[userBucket] = (stats.byUserBucket[userBucket] || 0) + 1;
  });

  return stats;
}

export async function auditRequestDocumentBackfill({
  requestId,
  maxLegacyPerSource = 1200,
  maxCanonicalLinks = 2500,
  maxDetails = MAX_AUDIT_DETAILS,
} = {}) {
  const rid = safeStr(requestId, 120);
  if (!rid) throw new Error("Missing requestId");

  const legacyLimit = safeLimit(maxLegacyPerSource, 1200);
  const canonicalLimit = safeLimit(maxCanonicalLinks, 2500);

  const [requestSnap, attachmentSnap, adminFileSnap, messageSnap, canonicalLinkSnap] =
    await Promise.all([
      getDoc(doc(db, "serviceRequests", rid)),
      getDocs(query(collection(db, "serviceRequests", rid, "attachments"), limit(legacyLimit))),
      getDocs(query(collection(db, "serviceRequests", rid, "adminFiles"), limit(legacyLimit))),
      getDocs(query(collection(db, "serviceRequests", rid, "messages"), limit(legacyLimit))),
      getDocs(
        query(
          collection(db, DOCUMENT_LINKS_COLLECTION),
          where("requestId", "==", rid),
          limit(canonicalLimit)
        )
      ),
    ]);

  const requestOwnerUid = safeStr(requestSnap.data()?.uid, 120);
  const legacyAttachments = attachmentSnap.docs
    .map((item) =>
      mapLegacyAttachmentAuditItem({
        requestId: rid,
        rowId: item.id,
        row: item.data() || {},
      })
    )
    .filter(Boolean);

  const legacyAdminFiles = adminFileSnap.docs
    .map((item) =>
      mapLegacyAdminFileAuditItem({
        requestId: rid,
        rowId: item.id,
        row: item.data() || {},
      })
    )
    .filter(Boolean);

  const legacyMessages = messageSnap.docs
    .map((item) =>
      mapLegacyChatAuditItem({
        requestId: rid,
        rowId: item.id,
        row: item.data() || {},
      })
    )
    .filter(Boolean);

  const expectedRows = [...legacyAttachments, ...legacyAdminFiles, ...legacyMessages];
  const canonicalRows = canonicalLinkSnap.docs.map((item) => ({ id: item.id, ...item.data() }));
  const linkIdSet = new Set(canonicalRows.map((row) => safeStr(row?.id, 220)).filter(Boolean));
  const docIdSet = new Set(
    canonicalRows.map((row) => safeStr(row?.documentId, 220)).filter(Boolean)
  );

  const missingSummary = buildAuditMissingRows({
    expected: expectedRows,
    linkIdSet,
    docIdSet,
    maxDetails,
  });

  const ownerMismatchCount = requestOwnerUid
    ? canonicalRows.filter((row) => {
        const userUid = safeStr(row?.userUid, 120);
        return userUid && userUid !== requestOwnerUid;
      }).length
    : 0;

  const sourceBreakdown = {
    attachments: legacyAttachments.length,
    adminFiles: legacyAdminFiles.length,
    messages: legacyMessages.length,
    totalExpected: expectedRows.length,
  };

  const canonicalBreakdown = summarizeRequestCanonicalLinks(canonicalRows);
  const missingPairs = Math.max(
    missingSummary.missingDocCount,
    missingSummary.missingLinkCount
  );

  return {
    requestId: rid,
    requestOwnerUid,
    scannedAtMs: Date.now(),
    limits: {
      maxLegacyPerSource: legacyLimit,
      maxCanonicalLinks: canonicalLimit,
      maxDetails: safeDetailsLimit(maxDetails),
      legacyScanTruncated:
        attachmentSnap.size >= legacyLimit ||
        adminFileSnap.size >= legacyLimit ||
        messageSnap.size >= legacyLimit,
      canonicalScanTruncated: canonicalLinkSnap.size >= canonicalLimit,
    },
    legacy: sourceBreakdown,
    canonical: canonicalBreakdown,
    parity: {
      expectedPairs: expectedRows.length,
      missingPairs,
      missingDocumentRows: missingSummary.missingDocCount,
      missingLinkRows: missingSummary.missingLinkCount,
      fullyMissingRows: missingSummary.fullyMissingCount,
      ownerMismatchCount,
      coveragePercent:
        expectedRows.length > 0
          ? Math.max(
              0,
              Math.round(
                ((expectedRows.length - missingPairs) / expectedRows.length) * 100
              )
            )
          : 100,
      safeForCanonicalReadCutover:
        missingSummary.missingDocCount === 0 &&
        missingSummary.missingLinkCount === 0 &&
        ownerMismatchCount === 0,
    },
    missingRows: missingSummary.missingRows,
  };
}

export async function auditUserVaultBackfill({
  uid,
  maxLegacy = 1200,
  maxCanonicalLinks = 2500,
  maxDetails = MAX_AUDIT_DETAILS,
} = {}) {
  const userUid = safeStr(uid, 120);
  if (!userUid) throw new Error("Missing uid");

  const legacyLimit = safeLimit(maxLegacy, 1200);
  const canonicalLimit = safeLimit(maxCanonicalLinks, 2500);

  const [legacySnap, canonicalLinkSnap] = await Promise.all([
    getDocs(query(collection(db, "users", userUid, "selfHelpDocuments"), limit(legacyLimit))),
    getDocs(
      query(
        collection(db, DOCUMENT_LINKS_COLLECTION),
        where("userUid", "==", userUid),
        limit(canonicalLimit)
      )
    ),
  ]);

  const expectedRows = legacySnap.docs
    .map((item) =>
      mapLegacySelfHelpAuditItem({
        uid: userUid,
        rowId: item.id,
        row: item.data() || {},
      })
    )
    .filter(Boolean);

  const canonicalRows = canonicalLinkSnap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((row) => {
      const contextType = safeStr(row?.contextType, 60).toLowerCase();
      const requestBucket = safeStr(row?.requestBucket, 40).toLowerCase();
      const requestId = safeStr(row?.requestId, 120);
      return (
        contextType === "self_help" ||
        requestBucket === REQUEST_BUCKET_SELF_HELP ||
        !requestId
      );
    });

  const linkIdSet = new Set(canonicalRows.map((row) => safeStr(row?.id, 220)).filter(Boolean));
  const docIdSet = new Set(
    canonicalRows.map((row) => safeStr(row?.documentId, 220)).filter(Boolean)
  );
  const missingSummary = buildAuditMissingRows({
    expected: expectedRows,
    linkIdSet,
    docIdSet,
    maxDetails,
  });
  const missingPairs = Math.max(
    missingSummary.missingDocCount,
    missingSummary.missingLinkCount
  );

  return {
    uid: userUid,
    scannedAtMs: Date.now(),
    limits: {
      maxLegacy: legacyLimit,
      maxCanonicalLinks: canonicalLimit,
      maxDetails: safeDetailsLimit(maxDetails),
      legacyScanTruncated: legacySnap.size >= legacyLimit,
      canonicalScanTruncated: canonicalLinkSnap.size >= canonicalLimit,
    },
    legacy: {
      selfHelpDocuments: expectedRows.length,
    },
    canonical: summarizeRequestCanonicalLinks(canonicalRows),
    parity: {
      expectedPairs: expectedRows.length,
      missingPairs,
      missingDocumentRows: missingSummary.missingDocCount,
      missingLinkRows: missingSummary.missingLinkCount,
      fullyMissingRows: missingSummary.fullyMissingCount,
      coveragePercent:
        expectedRows.length > 0
          ? Math.max(
              0,
              Math.round(
                ((expectedRows.length - missingPairs) / expectedRows.length) * 100
              )
            )
          : 100,
      safeForCanonicalReadCutover:
        missingSummary.missingDocCount === 0 && missingSummary.missingLinkCount === 0,
    },
    missingRows: missingSummary.missingRows,
  };
}

function normalizeUploadLifecycleStatus(status) {
  const clean = safeStr(status, 30).toLowerCase();
  if (clean === "queued" || clean === "uploading" || clean === "available" || clean === "failed") {
    return clean;
  }
  return "queued";
}

function stateFromLifecycleStatus(status) {
  const uploadStatus = normalizeUploadLifecycleStatus(status);
  if (uploadStatus === "available") return "available";
  if (uploadStatus === "failed") return "failed";
  return "meta_only";
}

async function syncDocumentLinkPreviews({
  documentId,
  preview = {},
  maxLinksToUpdate = MAX_LINKS_TO_UPDATE_PER_LIFECYCLE_WRITE,
} = {}) {
  const safeDocumentId = safeStr(documentId, 220);
  if (!safeDocumentId) return { updated: 0, total: 0, truncated: false };

  const linkLimit = Math.max(1, Math.min(2000, safeNum(maxLinksToUpdate || 0) || MAX_LINKS_TO_UPDATE_PER_LIFECYCLE_WRITE));
  const linksSnap = await getDocs(
    query(
      collection(db, DOCUMENT_LINKS_COLLECTION),
      where("documentId", "==", safeDocumentId),
      limit(linkLimit)
    )
  );

  if (linksSnap.empty) return { updated: 0, total: 0, truncated: false };

  const batch = writeBatch(db);
  linksSnap.docs.forEach((item) => {
    batch.set(
      doc(db, DOCUMENT_LINKS_COLLECTION, item.id),
      {
        preview: {
          name: safeStr(preview?.name, 180) || "Document",
          contentType: safeStr(preview?.contentType, 80),
          sizeBytes: safeNum(preview?.sizeBytes),
          state: safeStr(preview?.state, 40),
          stage: safeStr(preview?.stage, 30),
          storageKind: safeStr(preview?.storageKind, 30),
          externalUrl: safeStr(preview?.externalUrl, 1200),
          sourceChannel: safeStr(preview?.sourceChannel, 60),
        },
        updatedAt: serverTimestamp(),
        updatedAtMs: Date.now(),
      },
      { merge: true }
    );
  });

  await batch.commit();
  return {
    updated: linksSnap.size,
    total: linksSnap.size,
    truncated: linksSnap.size >= linkLimit,
  };
}

export async function updateCanonicalDocumentLifecycle({
  documentId,
  uploadStatus = "uploading",
  storage = {},
  display = {},
  note = "",
  errorCode = "",
  errorMessage = "",
  actorUid = "",
  actorRole = "admin",
  maxLinksToUpdate = MAX_LINKS_TO_UPDATE_PER_LIFECYCLE_WRITE,
} = {}) {
  const safeDocumentId = safeStr(documentId, 220);
  if (!safeDocumentId) throw new Error("Missing documentId");

  const documentRef = doc(db, DOCUMENTS_COLLECTION, safeDocumentId);
  const snapshot = await getDoc(documentRef);
  if (!snapshot.exists()) throw new Error("Document not found");

  const current = snapshot.data() || {};
  const lifecycleStatus = normalizeUploadLifecycleStatus(uploadStatus);
  const lifecycleState = stateFromLifecycleStatus(lifecycleStatus);
  const nowMs = Date.now();

  const nextDisplay = {
    name: safeStr(display?.name || current?.display?.name, 180) || "Document",
    contentType: safeStr(display?.contentType || current?.display?.contentType, 80),
    sizeBytes: safeNum(display?.sizeBytes || current?.display?.sizeBytes),
    note: safeStr(note || display?.note || current?.display?.note, 1200),
  };

  const nextStorage = {
    kind: normalizeStorageKind({
      explicitKind: storage?.kind || current?.storage?.kind,
      url: storage?.externalUrl || current?.storage?.externalUrl,
    }),
    externalUrl: safeStr(storage?.externalUrl || current?.storage?.externalUrl, 1200),
    bucket: safeStr(storage?.bucket || current?.storage?.bucket, 160),
    path: safeStr(storage?.path || current?.storage?.path, 400),
    checksum: safeStr(storage?.checksum || current?.storage?.checksum, 120),
    generation: safeStr(storage?.generation || current?.storage?.generation, 80),
  };

  const lifecyclePayload = {
    uploadStatus: lifecycleStatus,
    actorUid: safeStr(actorUid, 120),
    actorRole: normalizeRole(actorRole),
    errorCode: safeStr(errorCode, 80),
    errorMessage: safeStr(errorMessage, 240),
    updatedAtMs: nowMs,
  };

  await updateDoc(documentRef, {
    state: lifecycleState,
    display: nextDisplay,
    storage: nextStorage,
    lifecycle: lifecyclePayload,
    updatedAt: serverTimestamp(),
    updatedAtMs: nowMs,
  });

  const preview = {
    name: nextDisplay.name,
    contentType: nextDisplay.contentType,
    sizeBytes: nextDisplay.sizeBytes,
    state: lifecycleState,
    stage: safeStr(current?.stage, 30) || "working",
    storageKind: nextStorage.kind,
    externalUrl: nextStorage.externalUrl,
    sourceChannel: safeStr(current?.sourceChannel, 60),
  };

  const syncResult = await syncDocumentLinkPreviews({
    documentId: safeDocumentId,
    preview,
    maxLinksToUpdate,
  });

  return {
    documentId: safeDocumentId,
    uploadStatus: lifecycleStatus,
    state: lifecycleState,
    linksUpdated: syncResult.updated,
    linksTruncated: syncResult.truncated,
  };
}

export async function markDocumentUploading({
  documentId,
  bucket = "",
  path = "",
  actorUid = "",
  actorRole = "admin",
  note = "",
} = {}) {
  return updateCanonicalDocumentLifecycle({
    documentId,
    uploadStatus: "uploading",
    storage: {
      kind: "bucket",
      bucket,
      path,
    },
    note,
    actorUid,
    actorRole,
  });
}

export async function markDocumentAvailable({
  documentId,
  bucket = "",
  path = "",
  externalUrl = "",
  checksum = "",
  generation = "",
  contentType = "",
  sizeBytes = 0,
  actorUid = "",
  actorRole = "admin",
  note = "",
} = {}) {
  return updateCanonicalDocumentLifecycle({
    documentId,
    uploadStatus: "available",
    storage: {
      kind: bucket || path ? "bucket" : normalizeStorageKind({ url: externalUrl, explicitKind: "external" }),
      bucket,
      path,
      externalUrl,
      checksum,
      generation,
    },
    display: {
      contentType,
      sizeBytes,
      note,
    },
    note,
    actorUid,
    actorRole,
  });
}

export async function markDocumentFailed({
  documentId,
  errorCode = "",
  errorMessage = "",
  actorUid = "",
  actorRole = "admin",
} = {}) {
  return updateCanonicalDocumentLifecycle({
    documentId,
    uploadStatus: "failed",
    errorCode,
    errorMessage,
    actorUid,
    actorRole,
  });
}

export function getUserBucketUploadedValue() {
  return USER_BUCKET_UPLOADED;
}

export function getUserBucketReceivedValue() {
  return USER_BUCKET_RECEIVED;
}

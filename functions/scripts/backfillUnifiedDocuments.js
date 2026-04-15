/* global require, process */
/**
 * Backfill legacy document pathways into canonical:
 *   - /documents/{docId}
 *   - /documentLinks/{linkId}
 *
 * Sources:
 *   1) serviceRequests/{requestId}/attachments/{attachmentId}
 *   2) serviceRequests/{requestId}/adminFiles/{fileId}
 *   3) serviceRequests/{requestId}/messages/{messageId} (type pdf/bundle with pdfMeta)
 *   4) users/{uid}/selfHelpDocuments/{docId}
 *
 * Usage (from /functions):
 *   node scripts/backfillUnifiedDocuments.js
 *   node scripts/backfillUnifiedDocuments.js --verify
 *   node scripts/backfillUnifiedDocuments.js --write
 *   node scripts/backfillUnifiedDocuments.js --write --only=attachments,adminFiles
 *   node scripts/backfillUnifiedDocuments.js --write --max=5000
 */

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const DOC_ID = admin.firestore.FieldPath.documentId();

const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_BATCH_OPS_LIMIT = 400;

const SOURCE_ATTACHMENTS = "attachments";
const SOURCE_ADMIN_FILES = "adminFiles";
const SOURCE_MESSAGES = "messages";
const SOURCE_SELF_HELP = "selfHelpDocuments";

const VALID_SOURCES = new Set([
  SOURCE_ATTACHMENTS,
  SOURCE_ADMIN_FILES,
  SOURCE_MESSAGES,
  SOURCE_SELF_HELP,
]);

function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRole(role) {
  const clean = safeStr(role, 20).toLowerCase();
  if (clean === "admin" || clean === "staff" || clean === "user") return clean;
  return "user";
}

function normalizeStorageKind({ url = "", explicitKind = "" } = {}) {
  const kind = safeStr(explicitKind, 30).toLowerCase();
  if (kind === "meta" || kind === "external" || kind === "bucket") return kind;
  const cleanUrl = safeStr(url, 1200);
  if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) return "external";
  return "meta";
}

function normalizeDocState(status) {
  const clean = safeStr(status, 40).toLowerCase();
  if (clean === "uploaded" || clean === "approved") return "available";
  if (clean === "failed" || clean === "rejected") return "failed";
  if (clean === "archived") return "archived";
  return "meta_only";
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

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return safeNum(value);
  if (value instanceof Date) return safeNum(value.getTime());
  if (typeof value.toMillis === "function") return safeNum(value.toMillis());
  return 0;
}

function toFirestoreTimestamp(value) {
  const ms = toMillis(value);
  return ms > 0 ? admin.firestore.Timestamp.fromMillis(ms) : null;
}

function normalizeCreatedUpdatedMs({
  createdAt = null,
  createdAtMs = 0,
  updatedAt = null,
  updatedAtMs = 0,
} = {}) {
  const createdMs = safeNum(createdAtMs || toMillis(createdAt));
  const updatedMs = safeNum(updatedAtMs || toMillis(updatedAt)) || createdMs;
  return {
    createdAtMs: createdMs,
    updatedAtMs: updatedMs || createdMs,
  };
}

function buildPreview(documentData) {
  return {
    name: safeStr(documentData?.display?.name, 180) || "Document",
    contentType: safeStr(documentData?.display?.contentType, 80),
    sizeBytes: safeNum(documentData?.display?.sizeBytes),
    state: safeStr(documentData?.state, 40) || "meta_only",
    stage: safeStr(documentData?.stage, 30) || "working",
    storageKind: safeStr(documentData?.storage?.kind, 30) || "meta",
    externalUrl: safeStr(documentData?.storage?.externalUrl, 1200),
    sourceChannel: safeStr(documentData?.sourceChannel, 60),
  };
}

function withCreatedUpdatedTimestamps(payload, { createdAt, updatedAt } = {}) {
  const out = { ...(payload || {}) };
  const createdTs = toFirestoreTimestamp(createdAt);
  const updatedTs = toFirestoreTimestamp(updatedAt);
  if (createdTs) out.createdAt = createdTs;
  if (updatedTs) out.updatedAt = updatedTs;
  return out;
}

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const write = args.includes("--write");
  const verify = args.includes("--verify");
  const onlyRaw = safeStr(
    args.find((arg) => String(arg).startsWith("--only="))?.split("=")?.[1] || "",
    400
  );
  const only = onlyRaw
    ? onlyRaw
        .split(",")
        .map((item) => safeStr(item, 60))
        .filter(Boolean)
    : [];
  const maxRaw = safeStr(
    args.find((arg) => String(arg).startsWith("--max="))?.split("=")?.[1] || "",
    20
  );
  const pageRaw = safeStr(
    args.find((arg) => String(arg).startsWith("--page="))?.split("=")?.[1] || "",
    20
  );
  const max = safeNum(maxRaw, 0);
  const page = Math.max(1, safeNum(pageRaw, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE);

  return { write, verify, only, max, page };
}

async function getRequestOwnerUid(requestId, cache) {
  const rid = safeStr(requestId, 120);
  if (!rid) return "";
  if (cache.has(rid)) return cache.get(rid);

  try {
    const snap = await db.collection("serviceRequests").doc(rid).get();
    const uid = snap.exists ? safeStr(snap.data()?.uid, 120) : "";
    cache.set(rid, uid);
    return uid;
  } catch (error) {
    console.warn(`[owner] failed to resolve request owner for ${rid}:`, error?.message || error);
    cache.set(rid, "");
    return "";
  }
}

function resolveChatRequestBucket({ fromRole, toRole } = {}) {
  const from = safeStr(fromRole, 20).toLowerCase();
  const to = safeStr(toRole, 20).toLowerCase();
  if (from === "user") return "received_from_user";
  if (to === "user") return "sent_to_user";
  return "internal";
}

function resolveChatUserBucket({ requestUid, fromUid, toUid, toRole } = {}) {
  const owner = safeStr(requestUid, 120);
  const sender = safeStr(fromUid, 120);
  const receiver = safeStr(toUid, 120);
  if (owner && sender && owner === sender) return "uploaded";
  if ((owner && receiver && owner === receiver) || safeStr(toRole, 20).toLowerCase() === "user") {
    return "received";
  }
  return "received";
}

function isUserVisibleChatDocument({ requestUid, fromUid, toUid, toRole } = {}) {
  const owner = safeStr(requestUid, 120);
  if (!owner) return false;
  if (safeStr(fromUid, 120) === owner) return true;
  if (safeStr(toUid, 120) === owner) return true;
  return safeStr(toRole, 20).toLowerCase() === "user";
}

async function mapAttachmentDoc(docSnap, requestOwnerCache) {
  const parentReq = docSnap?.ref?.parent?.parent;
  const requestId = safeStr(parentReq?.id, 120);
  if (!requestId) return null;

  const data = docSnap.data() || {};
  const legacyId = safeStr(docSnap.id, 180);
  const requestUid = (await getRequestOwnerUid(requestId, requestOwnerCache)) || safeStr(data.uid, 120);
  if (!requestUid || !legacyId) return null;

  const docId = buildMirrorId(["request", requestId, "attachment", legacyId]);
  const linkId = buildMirrorId(["request", requestId, "attachment", legacyId, "link"]);
  const state = normalizeDocState(data.status);
  const createdMeta = normalizeCreatedUpdatedMs({
    createdAt: data.createdAt,
    createdAtMs: data.createdAtMs,
    updatedAt: data.updatedAt,
    updatedAtMs: data.updatedAtMs,
  });

  const documentData = withCreatedUpdatedTimestamps(
    {
      userUid: requestUid,
      requestId,
      scope: "request",
      stage: "working",
      state,
      sourceChannel: safeStr(data.source, 60) || "migration_attachment",
      createdByUid: safeStr(data.uid, 120) || requestUid,
      createdByRole: "user",
      visibility: {
        user: true,
        staff: true,
        admin: true,
      },
      display: {
        name: safeStr(data.name || data.filename, 180) || "Document",
        contentType: safeStr(data.contentType || data.type, 80) || "application/pdf",
        sizeBytes: safeNum(data.size),
        note: safeStr(data.metaNote || data.note, 1200),
      },
      storage: {
        kind: normalizeStorageKind({
          url: data.url || data.downloadUrl || data.fileUrl,
        }),
        externalUrl: safeStr(data.url || data.downloadUrl || data.fileUrl, 1200),
        bucket: safeStr(data.bucket, 160),
        path: safeStr(data.path || data.storagePath, 400),
        checksum: safeStr(data.checksum || data.md5Hash, 120),
        generation: safeStr(data.generation, 80),
      },
      classification: {
        docType: safeStr(data.docType, 80),
        tags: [],
        fieldId: safeStr(data.fieldId, 120),
        fieldLabel: safeStr(data.fieldLabel || data.label, 180),
        kind: safeStr(data.kind, 80),
      },
      context: {
        track: "",
        country: "",
        category: "",
        stepId: "",
        stepTitle: "",
      },
      legacy: {
        collection: "serviceRequests.attachments",
        id: legacyId,
        requestPath: `serviceRequests/${requestId}/attachments/${legacyId}`,
      },
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  const linkData = withCreatedUpdatedTimestamps(
    {
      documentId: docId,
      userUid: requestUid,
      requestId,
      contextType: "request_upload",
      contextId: legacyId,
      userBucket: "uploaded",
      requestBucket: "received_from_user",
      visibleToUser: true,
      visibleToStaff: true,
      visibleToAdmin: true,
      preview: buildPreview(documentData),
      fieldId: safeStr(data.fieldId, 120),
      fieldLabel: safeStr(data.fieldLabel || data.label, 180),
      kind: safeStr(data.kind, 80),
      note: safeStr(data.metaNote || data.note, 1200),
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  return { docId, linkId, documentData, linkData };
}

async function mapAdminFileDoc(docSnap, requestOwnerCache) {
  const parentReq = docSnap?.ref?.parent?.parent;
  const requestId = safeStr(parentReq?.id, 120);
  if (!requestId) return null;

  const data = docSnap.data() || {};
  const legacyId = safeStr(docSnap.id, 180);
  const requestUid = await getRequestOwnerUid(requestId, requestOwnerCache);
  if (!requestUid || !legacyId) return null;

  const docId = buildMirrorId(["request", requestId, "admin_file", legacyId]);
  const linkId = buildMirrorId(["request", requestId, "admin_file", legacyId, "link"]);
  const createdMeta = normalizeCreatedUpdatedMs({
    createdAt: data.createdAt,
    createdAtMs: data.createdAtMs,
    updatedAt: data.updatedAt,
    updatedAtMs: data.updatedAtMs,
  });

  const documentData = withCreatedUpdatedTimestamps(
    {
      userUid: requestUid,
      requestId,
      scope: "request",
      stage: "final",
      state: "available",
      sourceChannel: safeStr(data.source, 60) || "migration_admin_file",
      createdByUid: safeStr(data?.meta?.staffUid || data.staffUid, 120),
      createdByRole: "admin",
      visibility: {
        user: true,
        staff: true,
        admin: true,
      },
      display: {
        name: safeStr(data.name, 180) || "Document",
        contentType: safeStr(data.contentType || "link", 80) || "link",
        sizeBytes: safeNum(data.size || data.sizeBytes),
        note: safeStr(data?.meta?.note || data.note, 1200),
      },
      storage: {
        kind: normalizeStorageKind({ url: data.url, explicitKind: "external" }),
        externalUrl: safeStr(data.url, 1200),
        bucket: safeStr(data.bucket, 160),
        path: safeStr(data.path || data.storagePath, 400),
        checksum: safeStr(data.checksum || data.md5Hash, 120),
        generation: safeStr(data.generation, 80),
      },
      classification: {
        docType: safeStr(data.docType, 80),
        tags: [],
        fieldId: safeStr(data.fieldId, 120),
        fieldLabel: safeStr(data.fieldLabel || data.label, 180),
        kind: "admin_final_delivery",
      },
      context: {
        track: "",
        country: "",
        category: "",
        stepId: "",
        stepTitle: "",
      },
      legacy: {
        collection: "serviceRequests.adminFiles",
        id: legacyId,
        requestPath: `serviceRequests/${requestId}/adminFiles/${legacyId}`,
      },
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  const linkData = withCreatedUpdatedTimestamps(
    {
      documentId: docId,
      userUid: requestUid,
      requestId,
      contextType: "request_delivery",
      contextId: legacyId,
      userBucket: "received",
      requestBucket: "final",
      visibleToUser: true,
      visibleToStaff: true,
      visibleToAdmin: true,
      preview: buildPreview(documentData),
      fieldId: safeStr(data.fieldId, 120),
      fieldLabel: safeStr(data.fieldLabel || data.label, 180),
      kind: "admin_final_delivery",
      note: safeStr(data?.meta?.note || data.note, 1200),
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  return { docId, linkId, documentData, linkData };
}

async function mapMessageDoc(docSnap, requestOwnerCache) {
  const parentReq = docSnap?.ref?.parent?.parent;
  const requestId = safeStr(parentReq?.id, 120);
  if (!requestId) return null;

  const data = docSnap.data() || {};
  const type = safeStr(data.type, 30).toLowerCase();
  const pdfMeta = data.pdfMeta && typeof data.pdfMeta === "object" ? data.pdfMeta : null;
  const pdfName = safeStr(pdfMeta?.name, 180);
  if (!(type === "pdf" || type === "bundle") || !pdfMeta || !pdfName) return null;

  const legacyId = safeStr(docSnap.id, 180);
  const requestUid = await getRequestOwnerUid(requestId, requestOwnerCache);
  if (!requestUid || !legacyId) return null;

  const fromRole = normalizeRole(data.fromRole);
  const fromUid = safeStr(data.fromUid, 120);
  const toRole = normalizeRole(data.toRole);
  const toUid = safeStr(data.toUid, 120);
  const requestBucket = resolveChatRequestBucket({ fromRole, toRole });
  const userBucket = resolveChatUserBucket({ requestUid, fromUid, toUid, toRole });
  const visibleToUser = isUserVisibleChatDocument({ requestUid, fromUid, toUid, toRole });

  const createdMeta = normalizeCreatedUpdatedMs({
    createdAt: data.createdAt,
    createdAtMs: data.createdAtMs,
    updatedAt: data.updatedAt,
    updatedAtMs: data.updatedAtMs,
  });

  let sourceChannel = "chat_message";
  if (safeStr(data.sourcePendingId)) sourceChannel = "chat_approved_message";
  else if (fromRole === "admin" && type === "pdf") sourceChannel = "chat_admin_direct_pdf";
  else if (fromRole === "admin" && type === "bundle") sourceChannel = "chat_admin_direct_bundle";

  const docId = buildMirrorId(["request", requestId, "chat_pdf", legacyId]);
  const linkId = buildMirrorId(["request", requestId, "chat_pdf", legacyId, "link"]);

  const documentData = withCreatedUpdatedTimestamps(
    {
      userUid: requestUid,
      requestId,
      scope: "request",
      stage: "working",
      state: "meta_only",
      sourceChannel,
      createdByUid: fromUid || requestUid,
      createdByRole: fromRole,
      visibility: {
        user: visibleToUser,
        staff: true,
        admin: true,
      },
      display: {
        name: pdfName || "Document",
        contentType: safeStr(pdfMeta?.mime || pdfMeta?.type || "application/pdf", 80),
        sizeBytes: safeNum(pdfMeta?.size),
        note: safeStr(pdfMeta?.note, 1200),
      },
      storage: {
        kind: "meta",
        externalUrl: "",
        bucket: "",
        path: "",
        checksum: "",
        generation: "",
      },
      classification: {
        docType: "",
        tags: [],
        fieldId: "",
        fieldLabel: "",
        kind: "chat_pdf",
      },
      context: {
        track: "",
        country: "",
        category: "",
        stepId: "",
        stepTitle: "",
      },
      legacy: {
        collection: "serviceRequests.messages",
        id: legacyId,
        requestPath: `serviceRequests/${requestId}/messages/${legacyId}`,
      },
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  const linkData = withCreatedUpdatedTimestamps(
    {
      documentId: docId,
      userUid: requestUid,
      requestId,
      contextType: "request_chat",
      contextId: legacyId,
      userBucket,
      requestBucket,
      visibleToUser,
      visibleToStaff: true,
      visibleToAdmin: true,
      preview: buildPreview(documentData),
      fieldId: "",
      fieldLabel: "",
      kind: "chat_pdf",
      note: safeStr(pdfMeta?.note, 1200),
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  return { docId, linkId, documentData, linkData };
}

async function mapSelfHelpDoc(docSnap) {
  const parentUser = docSnap?.ref?.parent?.parent;
  const userUid = safeStr(parentUser?.id, 120);
  if (!userUid) return null;

  const data = docSnap.data() || {};
  const legacyId = safeStr(docSnap.id, 240);
  if (!legacyId) return null;

  const createdMeta = normalizeCreatedUpdatedMs({
    createdAt: data.createdAt,
    createdAtMs: data.addedAt || data.createdAtMs,
    updatedAt: data.updatedAt,
    updatedAtMs: data.updatedAtMs || data.updatedAt || data.addedAt,
  });

  const docId = buildMirrorId(["self_help", userUid, legacyId]);
  const linkId = buildMirrorId(["self_help", userUid, legacyId, "link"]);

  const documentData = withCreatedUpdatedTimestamps(
    {
      userUid,
      requestId: "",
      scope: "self_help",
      stage: "vault",
      state: "meta_only",
      sourceChannel: "self_help",
      createdByUid: userUid,
      createdByRole: "user",
      visibility: {
        user: true,
        staff: false,
        admin: true,
      },
      display: {
        name: safeStr(data.fileName || data.documentType || "Self-help document", 180),
        contentType: safeStr(data.fileType || "meta", 80),
        sizeBytes: safeNum(data.fileSize),
        note: safeStr(data.notes, 1200),
      },
      storage: {
        kind: "meta",
        externalUrl: safeStr(data.localRef, 1200),
        bucket: "",
        path: "",
        checksum: "",
        generation: "",
      },
      classification: {
        docType: "",
        tags: [],
        fieldId: "",
        fieldLabel: "",
        kind: "self_help_document",
      },
      context: {
        track: safeStr(data.track, 30),
        country: safeStr(data.country, 80),
        category: safeStr(data.category, 80),
        stepId: safeStr(data.stepId, 120),
        stepTitle: safeStr(data.stepTitle, 180),
      },
      legacy: {
        collection: "users.selfHelpDocuments",
        id: legacyId,
        requestPath: `users/${userUid}/selfHelpDocuments/${legacyId}`,
      },
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  const linkData = withCreatedUpdatedTimestamps(
    {
      documentId: docId,
      userUid,
      requestId: "",
      contextType: "self_help",
      contextId: legacyId,
      userBucket: "uploaded",
      requestBucket: "self_help",
      visibleToUser: true,
      visibleToStaff: false,
      visibleToAdmin: true,
      preview: buildPreview(documentData),
      fieldId: "",
      fieldLabel: "",
      kind: "self_help_document",
      note: safeStr(data.notes, 1200),
      createdAtMs: createdMeta.createdAtMs,
      updatedAtMs: createdMeta.updatedAtMs,
    },
    {
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  );

  return { docId, linkId, documentData, linkData };
}

function sourceConfig(name) {
  if (name === SOURCE_ATTACHMENTS) {
    return {
      label: SOURCE_ATTACHMENTS,
      queryFactory: () => db.collectionGroup(SOURCE_ATTACHMENTS),
      mapper: mapAttachmentDoc,
    };
  }
  if (name === SOURCE_ADMIN_FILES) {
    return {
      label: SOURCE_ADMIN_FILES,
      queryFactory: () => db.collectionGroup(SOURCE_ADMIN_FILES),
      mapper: mapAdminFileDoc,
    };
  }
  if (name === SOURCE_MESSAGES) {
    return {
      label: SOURCE_MESSAGES,
      queryFactory: () => db.collectionGroup(SOURCE_MESSAGES),
      mapper: mapMessageDoc,
    };
  }
  return {
    label: SOURCE_SELF_HELP,
    queryFactory: () => db.collectionGroup(SOURCE_SELF_HELP),
    mapper: mapSelfHelpDoc,
  };
}

async function runSource({
  sourceName,
  write,
  verify = false,
  maxRows = 0,
  pageSize = DEFAULT_PAGE_SIZE,
  requestOwnerCache,
} = {}) {
  const config = sourceConfig(sourceName);
  const stats = {
    source: config.label,
    scanned: 0,
    eligible: 0,
    mirrored: 0,
    verified: 0,
    existingPairs: 0,
    missingDocumentRows: 0,
    missingLinkRows: 0,
    errors: 0,
    batchCommits: 0,
  };

  let cursor = null;
  let processed = 0;
  let batch = db.batch();
  let batchOps = 0;

  async function flushBatch() {
    if (!write || batchOps <= 0) return;
    await batch.commit();
    stats.batchCommits += 1;
    batch = db.batch();
    batchOps = 0;
  }

  while (true) {
    if (maxRows > 0 && processed >= maxRows) break;

    let q = config.queryFactory().orderBy(DOC_ID).limit(pageSize);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      if (maxRows > 0 && processed >= maxRows) break;
      processed += 1;
      stats.scanned += 1;

      try {
        const mapped = await config.mapper(docSnap, requestOwnerCache);
        if (!mapped) continue;
        stats.eligible += 1;

        if (verify) {
          const [docCheck, linkCheck] = await Promise.all([
            db.collection("documents").doc(mapped.docId).get(),
            db.collection("documentLinks").doc(mapped.linkId).get(),
          ]);
          stats.verified += 1;
          if (docCheck.exists && linkCheck.exists) {
            stats.existingPairs += 1;
          } else {
            if (!docCheck.exists) stats.missingDocumentRows += 1;
            if (!linkCheck.exists) stats.missingLinkRows += 1;
          }
        }

        if (write) {
          batch.set(db.collection("documents").doc(mapped.docId), mapped.documentData, { merge: true });
          batch.set(db.collection("documentLinks").doc(mapped.linkId), mapped.linkData, { merge: true });
          batchOps += 2;
          if (batchOps >= DEFAULT_BATCH_OPS_LIMIT) {
            await flushBatch();
          }
        }
        stats.mirrored += 1;
      } catch (error) {
        stats.errors += 1;
        console.warn(
          `[${config.label}] failed for ${docSnap.ref.path}:`,
          error?.message || error
        );
      }
    }

    cursor = snap.docs[snap.docs.length - 1];
    console.log(
      `[${config.label}] scanned=${stats.scanned} eligible=${stats.eligible} mirrored=${stats.mirrored} verified=${stats.verified} existingPairs=${stats.existingPairs} missingDocs=${stats.missingDocumentRows} missingLinks=${stats.missingLinkRows} errors=${stats.errors}`
    );
  }

  await flushBatch();
  return stats;
}

function pickSources(only) {
  const requested = Array.isArray(only) ? only : [];
  if (!requested.length) {
    return [SOURCE_ATTACHMENTS, SOURCE_ADMIN_FILES, SOURCE_MESSAGES, SOURCE_SELF_HELP];
  }
  return requested.filter((item) => VALID_SOURCES.has(item));
}

async function main() {
  const { write, verify, only, max, page } = parseArgs(process.argv.slice(2));
  const selectedSources = pickSources(only);

  if (!selectedSources.length) {
    console.error(
      "No valid sources selected. Valid values for --only: attachments,adminFiles,messages,selfHelpDocuments"
    );
    process.exitCode = 1;
    return;
  }

  console.log(write ? "Running in WRITE mode." : "Running in DRY-RUN mode.");
  console.log(verify ? "Verification mode: ON (checks canonical row existence)." : "Verification mode: OFF");
  console.log(`Sources: ${selectedSources.join(", ")}`);
  if (max > 0) console.log(`Max rows per source: ${max}`);
  console.log(`Page size: ${page}`);

  const requestOwnerCache = new Map();
  const results = [];

  for (const sourceName of selectedSources) {
    // Sequential on purpose to keep load predictable.
    const row = await runSource({
      sourceName,
      write,
      verify,
      maxRows: max,
      pageSize: page,
      requestOwnerCache,
    });
    results.push(row);
  }

  const totals = results.reduce(
    (acc, row) => {
      acc.scanned += row.scanned;
      acc.eligible += row.eligible;
      acc.mirrored += row.mirrored;
      acc.verified += row.verified;
      acc.existingPairs += row.existingPairs;
      acc.missingDocumentRows += row.missingDocumentRows;
      acc.missingLinkRows += row.missingLinkRows;
      acc.errors += row.errors;
      acc.batchCommits += row.batchCommits;
      return acc;
    },
    {
      scanned: 0,
      eligible: 0,
      mirrored: 0,
      verified: 0,
      existingPairs: 0,
      missingDocumentRows: 0,
      missingLinkRows: 0,
      errors: 0,
      batchCommits: 0,
    }
  );

  console.log("Backfill complete.");
  console.log(
    `Totals: scanned=${totals.scanned} eligible=${totals.eligible} mirrored=${totals.mirrored} verified=${totals.verified} existingPairs=${totals.existingPairs} missingDocs=${totals.missingDocumentRows} missingLinks=${totals.missingLinkRows} errors=${totals.errors} commits=${totals.batchCommits}`
  );
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});

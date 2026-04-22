import { addDoc, collection, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { mirrorLegacyRequestAttachment } from "./documentEngineService";
import { uploadBinaryFile } from "./fileUploadService";
import { buildRequestAttachmentStoragePath } from "./storageContract";

const MAX_PDF_MB = 10;
const MAX_BYTES = MAX_PDF_MB * 1024 * 1024;

function safeStr(x, max = 300) {
  return String(x ?? "").trim().slice(0, max);
}

function safeNum(n, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function isPdfFile(file) {
  const name = safeStr(file?.name, 200).toLowerCase();
  const type = safeStr(file?.type, 120).toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function requireUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not logged in");
  return user;
}

function requireRequestId(requestId) {
  const id = safeStr(requestId, 120);
  if (!id) throw new Error("Missing requestId");
  return id;
}

async function mirrorAttachment({
  requestId,
  requestUid,
  attachmentId,
  attachment,
  sourceChannel,
} = {}) {
  try {
    await mirrorLegacyRequestAttachment({
      requestId,
      requestUid,
      attachmentId,
      attachment,
      actorUid: requestUid,
      actorRole: "user",
      sourceChannel,
    });
  } catch (error) {
    console.warn("document engine mirror failed for attachment:", error?.message || error);
  }
}

export async function createPendingAttachment({ requestId, file }) {
  const user = requireUser();
  const rid = requireRequestId(requestId);

  if (!file) throw new Error("Missing file");

  // Support wrapped files so we can preserve request-definition document metadata.
  const wrapper = file && typeof file === "object" && file?.file ? file : null;
  const actualFile = wrapper?.file || file;

  if (!isPdfFile(actualFile)) {
    throw new Error("Only PDF files are allowed");
  }

  const size = safeNum(actualFile?.size, 0, MAX_BYTES + 1);
  if (size > MAX_BYTES) {
    throw new Error(`PDF must be under ${MAX_PDF_MB}MB`);
  }

  const name = safeStr(actualFile?.name || "document.pdf", 120) || "document.pdf";
  const contentType = safeStr(actualFile?.type || "application/pdf", 80) || "application/pdf";

  const fieldId = safeStr(wrapper?.fieldId, 80);
  const fieldLabel = safeStr(wrapper?.fieldLabel, 140);
  const kind = safeStr(wrapper?.kind, 60);

  const ref = collection(db, "serviceRequests", rid, "attachments");

  const payload = {
    uid: user.uid,
    name,
    size,
    contentType,
    status: "pending_upload", // Storage comes later
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (fieldId) payload.fieldId = fieldId;
  if (fieldLabel) {
    payload.fieldLabel = fieldLabel;
    payload.label = fieldLabel;
  }
  if (kind) payload.kind = kind;

  const docRef = await addDoc(ref, payload);
  await mirrorAttachment({
    requestId: rid,
    requestUid: user.uid,
    attachmentId: docRef.id,
    attachment: payload,
    sourceChannel: "request_modal_pending",
  });

  try {
    const storagePath = buildRequestAttachmentStoragePath({
      requestId: rid,
      attachmentId: docRef.id,
      fileName: name,
      contentType,
    });
    const uploadResult = await uploadBinaryFile({
      file: actualFile,
      storagePath,
      contentType,
      customMetadata: {
        requestId: rid,
        attachmentId: docRef.id,
        ownerUid: user.uid,
        source: "request_upload",
      },
    });

    const finalizedPayload = {
      ...payload,
      status: "uploaded",
      size: safeNum(uploadResult?.sizeBytes, 0, MAX_BYTES + 1) || size,
      contentType: safeStr(uploadResult?.contentType, 80) || contentType,
      storageKind: safeStr(uploadResult?.storageKind || "bucket", 30).toLowerCase(),
      storageBucket: safeStr(uploadResult?.bucket, 200),
      storagePath: safeStr(uploadResult?.path, 500),
      storageGeneration: safeStr(uploadResult?.generation, 120),
      storageChecksum: safeStr(uploadResult?.checksum, 120),
      storageProvider: safeStr(uploadResult?.provider, 40).toLowerCase(),
      uploadedAt: serverTimestamp(),
      uploadedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    };

    await updateDoc(docRef, finalizedPayload);
    await mirrorAttachment({
      requestId: rid,
      requestUid: user.uid,
      attachmentId: docRef.id,
      attachment: finalizedPayload,
      sourceChannel: "request_modal_uploaded",
    });
  } catch (error) {
    const failedPayload = {
      status: "failed",
      errorMessage: safeStr(error?.message || "Upload failed", 280),
      updatedAt: serverTimestamp(),
      failedAt: serverTimestamp(),
      failedAtMs: Date.now(),
    };
    try {
      await updateDoc(docRef, failedPayload);
      await mirrorAttachment({
        requestId: rid,
        requestUid: user.uid,
        attachmentId: docRef.id,
        attachment: { ...payload, ...failedPayload },
        sourceChannel: "request_modal_failed",
      });
    } catch (innerError) {
      console.warn("failed attachment state update failed:", innerError?.message || innerError);
    }
    throw error;
  }

  return docRef.id;
}

/**
 * Creates a placeholder attachment doc from saved file metadata.
 * This is used after flows like dummy payment where the live File object
 * no longer exists but we still want the request's attachments subcollection
 * to reflect what the user selected.
 */
export async function createPendingAttachmentFromMeta({ requestId, fileMeta } = {}) {
  void requestId;
  void fileMeta;
  throw new Error(
    "Metadata-only attachment restore is disabled. Please reselect the original file so we can upload a real document."
  );
}

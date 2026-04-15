// attachmentservice.js (FULL COPY-PASTE)
// - Keeps your existing behavior for createPendingAttachment (PDF placeholder doc)
// - Adds LINK + META attachment helpers (no Storage required yet)

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { mirrorLegacyRequestAttachment } from "./documentEngineService";

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

function isHttpUrl(url) {
  const u = safeStr(url, 1200);
  return u.startsWith("http://") || u.startsWith("https://");
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

/**
 * ✅ Existing: creates a placeholder attachment doc for a PDF upload
 * - Backwards compatible: NO CHANGES in behavior
 * - Stored at: serviceRequests/{requestId}/attachments/{attId}
 */
export async function createPendingAttachment({ requestId, file }) {
  const user = requireUser();
  const rid = requireRequestId(requestId);

  if (!file) throw new Error("Missing file");

  // Support "wrapped" files so we can preserve request-definition document metadata.
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
  try {
    await mirrorLegacyRequestAttachment({
      requestId: rid,
      requestUid: user.uid,
      attachmentId: docRef.id,
      attachment: payload,
      actorUid: user.uid,
      actorRole: "user",
      sourceChannel: "request_modal",
    });
  } catch (error) {
    console.warn("document engine mirror failed for attachment:", error?.message || error);
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
  const user = requireUser();
  const rid = requireRequestId(requestId);
  const meta = fileMeta && typeof fileMeta === "object" ? fileMeta : {};

  const name = safeStr(meta?.name || "document.pdf", 120) || "document.pdf";
  const contentType = safeStr(meta?.type || meta?.contentType || "application/pdf", 80)
    || "application/pdf";
  const size = safeNum(meta?.size, 0, MAX_BYTES + 1);
  const fieldId = safeStr(meta?.fieldId, 80);
  const fieldLabel = safeStr(meta?.fieldLabel || meta?.label, 140);
  const kind = safeStr(meta?.kind, 60);

  if (!isPdfFile({ name, type: contentType })) {
    throw new Error("Only PDF files are allowed");
  }
  if (size > MAX_BYTES) {
    throw new Error(`PDF must be under ${MAX_PDF_MB}MB`);
  }

  const ref = collection(db, "serviceRequests", rid, "attachments");
  const payload = {
    uid: user.uid,
    name,
    size,
    contentType,
    status: "pending_upload",
    source: "meta_restore",
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
  try {
    await mirrorLegacyRequestAttachment({
      requestId: rid,
      requestUid: user.uid,
      attachmentId: docRef.id,
      attachment: payload,
      actorUid: user.uid,
      actorRole: "user",
      sourceChannel: "request_modal_meta_restore",
    });
  } catch (error) {
    console.warn("document engine mirror failed for meta attachment:", error?.message || error);
  }

  return docRef.id;
}

/**
 * ✅ NEW: create a LINK attachment (no file upload)
 * Useful when the "document" is a Drive link / Dropbox link / website link.
 *
 * Fields supported by your AdminRequestDocumentsScreen:
 * - url OR downloadUrl OR fileUrl
 * - name/filename
 * - contentType/type
 * - label, metaNote, kind (optional)
 */
export async function createLinkAttachment({
  requestId,
  name,
  url,
  label = "",
  metaNote = "",
  kind = "link",
} = {}) {
  const user = requireUser();
  const rid = requireRequestId(requestId);

  const cleanName = safeStr(name || "Document link", 120) || "Document link";
  const cleanUrl = safeStr(url || "", 1000);

  if (!isHttpUrl(cleanUrl)) {
    throw new Error("Valid URL required (must start with http/https)");
  }

  const ref = collection(db, "serviceRequests", rid, "attachments");

  const docRef = await addDoc(ref, {
    uid: user.uid,

    name: cleanName,
    url: cleanUrl, // ✅ AdminRequestDocumentsScreen already reads this
    size: 0,
    contentType: "link",

    // optional metadata
    label: safeStr(label, 60),
    metaNote: safeStr(metaNote, 800),
    kind: safeStr(kind, 60) || "link",

    status: "uploaded", // since it’s already a link
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    await mirrorLegacyRequestAttachment({
      requestId: rid,
      requestUid: user.uid,
      attachmentId: docRef.id,
      attachment: {
        name: cleanName,
        url: cleanUrl,
        size: 0,
        contentType: "link",
        status: "uploaded",
        label: safeStr(label, 60),
        metaNote: safeStr(metaNote, 800),
        kind: safeStr(kind, 60) || "link",
      },
      actorUid: user.uid,
      actorRole: "user",
      sourceChannel: "request_link_attachment",
    });
  } catch (error) {
    console.warn("document engine mirror failed for link attachment:", error?.message || error);
  }

  return docRef.id;
}

/**
 * ✅ NEW: “Meta/dummy attachment” (checklist-style)
 * Example: applicant "uploads" Passport but you only store metadata (no PDF).
 * You can optionally include a link too.
 */
export async function createMetaAttachment({
  requestId,
  label,
  metaNote = "",
  url = "",
  kind = "user_dummy_upload",
} = {}) {
  const user = requireUser();
  const rid = requireRequestId(requestId);

  const cleanLabel = safeStr(label || "", 60);
  if (!cleanLabel) throw new Error("label is required");

  const cleanUrl = safeStr(url || "", 1000);
  if (cleanUrl && !isHttpUrl(cleanUrl)) {
    throw new Error("If url is provided, it must start with http/https");
  }

  const ref = collection(db, "serviceRequests", rid, "attachments");

  const docRef = await addDoc(ref, {
    uid: user.uid,

    name: cleanLabel,
    label: cleanLabel,
    metaNote: safeStr(metaNote, 800),
    kind: safeStr(kind, 60) || "user_dummy_upload",

    url: cleanUrl || "",

    size: 0,
    contentType: cleanUrl ? "link" : "meta",
    status: "pending_upload", // still “pending” because no real file was uploaded

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  try {
    await mirrorLegacyRequestAttachment({
      requestId: rid,
      requestUid: user.uid,
      attachmentId: docRef.id,
      attachment: {
        name: cleanLabel,
        size: 0,
        contentType: cleanUrl ? "link" : "meta",
        status: "pending_upload",
        label: cleanLabel,
        metaNote: safeStr(metaNote, 800),
        kind: safeStr(kind, 60) || "user_dummy_upload",
        url: cleanUrl || "",
      },
      actorUid: user.uid,
      actorRole: "user",
      sourceChannel: "request_meta_attachment",
    });
  } catch (error) {
    console.warn("document engine mirror failed for meta-only attachment:", error?.message || error);
  }

  return docRef.id;
}

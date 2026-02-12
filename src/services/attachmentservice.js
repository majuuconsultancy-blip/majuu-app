import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";

const MAX_PDF_MB = 10;
const MAX_BYTES = MAX_PDF_MB * 1024 * 1024;

function safeStr(x, max = 300) {
  return String(x || "").trim().slice(0, max);
}

function isHttpUrl(url) {
  const u = String(url || "").trim();
  return u.startsWith("http://") || u.startsWith("https://");
}

function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

/**
 * ✅ Existing: creates a placeholder attachment doc for a PDF upload
 * - Backwards compatible: NO CHANGES in behavior
 * - Stored at: serviceRequests/{requestId}/attachments/{attId}
 */
export async function createPendingAttachment({ requestId, file }) {
  const user = auth.currentUser;

  if (!user) throw new Error("Not logged in");
  if (!requestId) throw new Error("Missing requestId");
  if (!file) throw new Error("Missing file");

  if (!isPdfFile(file)) {
    throw new Error("Only PDF files are allowed");
  }

  const size = Number(file.size || 0);
  if (size > MAX_BYTES) {
    throw new Error(`PDF must be under ${MAX_PDF_MB}MB`);
  }

  const name = safeStr(file.name || "document.pdf", 120);
  const contentType = safeStr(file.type || "application/pdf", 80);

  const ref = collection(db, "serviceRequests", requestId, "attachments");

  const docRef = await addDoc(ref, {
    uid: user.uid,
    name,
    size,
    contentType,
    status: "pending_upload", // Storage comes later
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

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
  const user = auth.currentUser;

  if (!user) throw new Error("Not logged in");
  if (!requestId) throw new Error("Missing requestId");

  const cleanName = safeStr(name || "Document link", 120);
  const cleanUrl = safeStr(url || "", 1000);

  if (!isHttpUrl(cleanUrl)) {
    throw new Error("Valid URL required (must start with http/https)");
  }

  const ref = collection(db, "serviceRequests", requestId, "attachments");

  const docRef = await addDoc(ref, {
    uid: user.uid,

    name: cleanName,
    url: cleanUrl, // ✅ AdminRequestDocumentsScreen already reads this
    size: 0,
    contentType: "link",

    // optional metadata (your UI already supports these)
    label: safeStr(label, 60),
    metaNote: safeStr(metaNote, 800),
    kind: safeStr(kind, 60),

    status: "uploaded", // since it’s already a link
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}

/**
 * ✅ NEW: “Meta/dummy attachment” (checklist-style)
 * Example: applicant uploads “Passport” but you only store metadata (no PDF).
 * You can optionally include a link too.
 */
export async function createMetaAttachment({
  requestId,
  label,
  metaNote = "",
  url = "",
  kind = "user_dummy_upload",
} = {}) {
  const user = auth.currentUser;

  if (!user) throw new Error("Not logged in");
  if (!requestId) throw new Error("Missing requestId");

  const cleanLabel = safeStr(label || "", 60);
  if (!cleanLabel) throw new Error("label is required");

  const cleanUrl = safeStr(url || "", 1000);
  if (cleanUrl && !isHttpUrl(cleanUrl)) {
    throw new Error("If url is provided, it must start with http/https");
  }

  const ref = collection(db, "serviceRequests", requestId, "attachments");

  const docRef = await addDoc(ref, {
    uid: user.uid,

    name: cleanLabel,
    label: cleanLabel,
    metaNote: safeStr(metaNote, 800),
    kind: safeStr(kind, 60),

    url: cleanUrl || "",

    size: 0,
    contentType: cleanUrl ? "link" : "meta",
    status: "pending_upload",

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}
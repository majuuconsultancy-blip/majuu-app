import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";

const MAX_PDF_MB = 10;
const MAX_BYTES = MAX_PDF_MB * 1024 * 1024;

function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

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

  const name = String(file.name || "document.pdf").trim().slice(0, 120);
  const contentType = String(file.type || "application/pdf").trim().slice(0, 80);

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
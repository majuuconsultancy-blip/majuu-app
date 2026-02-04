import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * ✅ Stage admin file links BEFORE accepting
 * Stored under:
 * serviceRequests/{requestId}/adminFileDrafts/{draftId}
 * NOT visible to the user until published.
 */
export async function stageAdminFile({ requestId, name, url }) {
  const cleanName = String(name || "").trim();
  const cleanUrl = String(url || "").trim();

  if (!requestId) throw new Error("Missing requestId");
  if (!cleanName) throw new Error("File name is required.");
  if (!cleanUrl) throw new Error("File link (URL) is required.");

  const ref = collection(db, "serviceRequests", requestId, "adminFileDrafts");

  const res = await addDoc(ref, {
    name: cleanName,
    url: cleanUrl,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return res.id;
}

/** ✅ Delete a staged draft */
export async function deleteStagedAdminFile({ requestId, draftId }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!draftId) throw new Error("Missing draftId");

  await deleteDoc(doc(db, "serviceRequests", requestId, "adminFileDrafts", draftId));
}

/**
 * ✅ Publish staged drafts AFTER admin accepts
 * Copies drafts into:
 * serviceRequests/{requestId}/adminFiles/{fileId}
 * then deletes the drafts.
 */
export async function publishStagedAdminFiles({ requestId }) {
  if (!requestId) throw new Error("Missing requestId");

  const draftsRef = collection(db, "serviceRequests", requestId, "adminFileDrafts");
  const snap = await getDocs(draftsRef);

  if (snap.empty) return { published: 0 };

  const batch = writeBatch(db);

  let publishedCount = 0;

  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const name = String(data.name || "").trim();
    const url = String(data.url || "").trim();

    // If draft is broken, delete it (don’t block publishing)
    if (!name || !url) {
      batch.delete(d.ref);
      return;
    }

    const targetRef = doc(collection(db, "serviceRequests", requestId, "adminFiles"));

    batch.set(targetRef, {
      name,
      url,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
      source: "admin_publish",
    });

    batch.delete(d.ref);
    publishedCount += 1;
  });

  await batch.commit();
  return { published: publishedCount };
}

/**
 * ✅ Admin deletes a published file/link (visible to user)
 * Stored under:
 * serviceRequests/{requestId}/adminFiles/{fileId}
 */
export async function deleteAdminFile({ requestId, fileId }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!fileId) throw new Error("Missing fileId");

  await deleteDoc(doc(db, "serviceRequests", requestId, "adminFiles", fileId));
}
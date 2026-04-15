import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  writeBatch,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { mirrorLegacyPublishedRequestDocument } from "./documentEngineService";


/* ======================================================
   STAGE ADMIN FILE LINKS (DRAFTS)
   Stored under:
   serviceRequests/{requestId}/adminFileDrafts/{draftId}
   NOT visible to the user until published
====================================================== */

/**
 * ✅ Stage admin file link (manual OR staff-driven)
 * If draftId is provided → uses it (prevents duplicates)
 */

export async function markStaffDraftStaged({ requestId, draftId }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!draftId) throw new Error("Missing draftId");

  await updateDoc(doc(db, "serviceRequests", requestId, "staffFileDrafts", draftId), {
    stagedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
export async function stageAdminFile({
  requestId,
  name,
  url,
  draftId = null,
  source = "admin_manual", // or "staff_recommendation"
  meta = {},
} = {}) {
  const cleanName = String(name || "").trim();
  const cleanUrl = String(url || "").trim();

  if (!requestId) throw new Error("Missing requestId");
  if (!cleanName) throw new Error("File name is required.");
  if (!cleanUrl) throw new Error("File link (URL) is required.");

  const draftsCol = collection(db, "serviceRequests", requestId, "adminFileDrafts");

  // ✅ If ID provided → deterministic (used for staff autofill)
  if (draftId) {
    const ref = doc(draftsCol, draftId);

    await setDoc(
      ref,
      {
        name: cleanName,
        url: cleanUrl,
        source,
        meta,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return draftId;
  }

  // ✅ Fallback: normal admin manual add
  const res = await addDoc(draftsCol, {
    name: cleanName,
    url: cleanUrl,
    source,
    meta,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return res.id;
}

/**
 * ✅ Stage admin file DIRECTLY from a staff draft
 * Uses SAME ID to prevent duplicates
 */
export async function stageAdminFileFromStaffDraft({
  requestId,
  staffDraft,
} = {}) {
  if (!requestId) throw new Error("Missing requestId");
  if (!staffDraft?.id) throw new Error("Invalid staff draft");

  return stageAdminFile({
    requestId,
    draftId: staffDraft.id, // 🔥 same ID = no duplicates
    name: staffDraft.label || staffDraft.name || "Document",
    url: staffDraft.url,
    source: "staff_recommendation",
    meta: {
      staffUid: staffDraft.createdBy || null,
      note: staffDraft.note || "",
      label: staffDraft.label || "",
    },
  });
}

/* ======================================================
   DELETE STAGED DRAFT
====================================================== */
export async function deleteStagedAdminFile({ requestId, draftId }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!draftId) throw new Error("Missing draftId");

  await deleteDoc(
    doc(db, "serviceRequests", requestId, "adminFileDrafts", draftId)
  );
}

/* ======================================================
   PUBLISH STAGED FILES (AFTER ACCEPT)
   Copies drafts → adminFiles
====================================================== */
export async function publishStagedAdminFiles({ requestId }) {
  if (!requestId) throw new Error("Missing requestId");

  const requestSnap = await getDoc(doc(db, "serviceRequests", requestId));
  const requestUid = requestSnap.exists()
    ? String(requestSnap.data()?.uid || "").trim()
    : "";

  const draftsRef = collection(db, "serviceRequests", requestId, "adminFileDrafts");
  const snap = await getDocs(draftsRef);

  if (snap.empty) return { published: 0 };

  const batch = writeBatch(db);
  const mirrorRows = [];
  let publishedCount = 0;

  snap.docs.forEach((d) => {
    const data = d.data() || {};
    const name = String(data.name || "").trim();
    const url = String(data.url || "").trim();

    // 🧹 Clean broken drafts
    if (!name || !url) {
      batch.delete(d.ref);
      return;
    }

    const targetRef = doc(
      collection(db, "serviceRequests", requestId, "adminFiles")
    );

    batch.set(targetRef, {
      name,
      url,
      source: data.source || "admin_publish",
      meta: data.meta || {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
    });

    mirrorRows.push({
      fileId: targetRef.id,
      name,
      url,
      meta: data.meta || {},
    });

    batch.delete(d.ref);
    publishedCount += 1;
  });

  await batch.commit();

  if (requestUid && mirrorRows.length > 0) {
    await Promise.all(
      mirrorRows.map((row) =>
        mirrorLegacyPublishedRequestDocument({
          requestId,
          requestUid,
          adminFileId: row.fileId,
          file: {
            name: row.name,
            url: row.url,
            contentType: "link",
            size: 0,
            meta: row.meta || {},
          },
          actorUid: "",
        }).catch((error) => {
          console.warn("document engine mirror failed for admin published file:", error?.message || error);
          return null;
        })
      )
    );
  }

  return { published: publishedCount };
}

/* ======================================================
   DELETE PUBLISHED FILE (VISIBLE TO USER)
====================================================== */
export async function deleteAdminFile({ requestId, fileId }) {
  if (!requestId) throw new Error("Missing requestId");
  if (!fileId) throw new Error("Missing fileId");

  await deleteDoc(
    doc(db, "serviceRequests", requestId, "adminFiles", fileId)
  );
}

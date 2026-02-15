// applicationservice.js (FULL COPY-PASTE)
// ✅ Same API you already use
// ✅ Adds input cleaning + safe defaults (no backend change required)

import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

function cleanStr(x, max = 120) {
  return String(x ?? "").trim().slice(0, max);
}

function cleanTrack(x) {
  const t = cleanStr(x, 20).toLowerCase();
  return t === "study" || t === "work" || t === "travel" ? t : "study";
}

function requireUid(uid) {
  const u = cleanStr(uid, 128);
  if (!u) throw new Error("Missing uid");
  return u;
}

// ✅ NEW: createApplication (recommended going forward)
export async function createApplication({ uid, track, title }) {
  const ref = collection(db, "applications");

  const cleanUid = requireUid(uid);
  const cleanT = cleanTrack(track);

  const cleanTitle =
    cleanStr(title, 120) || `${cleanT.charAt(0).toUpperCase()}${cleanT.slice(1)} application`;

  await addDoc(ref, {
    uid: cleanUid,
    track: cleanT, // study | work | travel
    title: cleanTitle,
    status: "Submitted",
    createdAt: serverTimestamp(),
  });
}

// ✅ KEEP: createTestApplication (backward compatible)
export async function createTestApplication(uid, track) {
  const t = cleanTrack(track);

  return createApplication({
    uid,
    track: t,
    title:
      t === "study"
        ? "Study Application"
        : t === "work"
        ? "Work Application"
        : "Travel Application",
  });
}

// ✅ Progress screen uses this
export async function getUserApplications(uid) {
  const cleanUid = requireUid(uid);

  const ref = collection(db, "applications");
  const q = query(ref, where("uid", "==", cleanUid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
}
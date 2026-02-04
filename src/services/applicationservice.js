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

// ✅ NEW: createApplication (recommended going forward)
export async function createApplication({ uid, track, title }) {
  const ref = collection(db, "applications");

  await addDoc(ref, {
    uid,
    track, // study | work | travel
    title: title || `${track} application`,
    status: "Submitted",
    createdAt: serverTimestamp(),
  });
}

// ✅ KEEP: createTestApplication (backward compatible)
export async function createTestApplication(uid, track) {
  return createApplication({
    uid,
    track,
    title:
      track === "study"
        ? "Study Application"
        : track === "work"
        ? "Work Application"
        : "Travel Application",
  });
}

// ✅ Progress screen uses this
export async function getUserApplications(uid) {
  const ref = collection(db, "applications");

  const q = query(ref, where("uid", "==", uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  return snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));
}

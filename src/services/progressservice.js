import { collection, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../firebase";
import { normalizeTextDeep } from "../utils/textNormalizer";

// No orderBy to avoid extra index needs; we sort in JS.
function sortByCreatedAtDesc(items) {
  return items.sort((a, b) => {
    const as = a.createdAt?.seconds || 0;
    const bs = b.createdAt?.seconds || 0;
    return bs - as;
  });
}

export async function getMyServiceRequests(uid, max = 20) {
  const ref = collection(db, "serviceRequests");
  const q = query(ref, where("uid", "==", uid), limit(max));
  const snap = await getDocs(q);

  const items = snap.docs
    .map((d) => normalizeTextDeep({ id: d.id, ...d.data() }))
    .filter((row) => row?.deletedByOwner !== true);
  return sortByCreatedAtDesc(items);
}

export async function getMyApplications(uid, max = 20) {
  const ref = collection(db, "applications");
  const q = query(ref, where("uid", "==", uid), limit(max));
  const snap = await getDocs(q);

  const items = snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));
  return sortByCreatedAtDesc(items);
}

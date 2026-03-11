import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";

function cleanStr(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function cleanTrack(value) {
  const t = cleanStr(value, 24).toLowerCase();
  return t === "study" || t === "work" || t === "travel" ? t : "study";
}

export function normalizeFullPackageItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const clean = cleanStr(item, 120);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out.slice(0, 60);
}

export function toFullPackageItemKey(item) {
  const base = cleanStr(item, 120).toLowerCase();
  if (!base) return "item";
  return (
    base
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "item"
  );
}

export function buildFullPackageHubPath(input, trackInput) {
  const fullPackageId =
    typeof input === "object" && input !== null
      ? cleanStr(input.fullPackageId, 120)
      : cleanStr(input, 120);
  const track =
    typeof input === "object" && input !== null
      ? cleanTrack(input.track || trackInput)
      : cleanTrack(trackInput);

  if (!fullPackageId) return "";
  return `/app/full-package/${encodeURIComponent(track)}?fullPackageId=${encodeURIComponent(
    fullPackageId
  )}`;
}

export async function createFullPackageDraft({
  uid,
  email,
  track,
  country,
  selectedItems,
  unlockAmount,
  depositAmount,
}) {
  const cleanUid = cleanStr(uid, 120);
  if (!cleanUid) throw new Error("Missing user ID for full package.");

  const ref = doc(collection(db, "fullPackages"));
  const normalizedItems = normalizeFullPackageItems(selectedItems);

  const resolvedUnlockAmount = Number(unlockAmount || depositAmount || 0);

  await setDoc(ref, {
    uid: cleanUid,
    email: cleanStr(email, 140),
    track: cleanTrack(track),
    country: cleanStr(country, 120),
    selectedItems: normalizedItems,
    unlockAmount: resolvedUnlockAmount,
    unlockPaid: false,
    unlockPaymentMeta: null,
    // legacy compatibility
    depositAmount: resolvedUnlockAmount,
    depositPaid: false,
    depositPaymentMeta: null,
    itemStates: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

export async function markFullPackageUnlockPaid({
  fullPackageId,
  selectedItems,
  unlockAmount,
  unlockPaymentMeta,
}) {
  const id = cleanStr(fullPackageId, 120);
  if (!id) throw new Error("Missing full package ID.");

  const resolvedUnlockAmount = Number(unlockAmount || 0);
  const meta =
    unlockPaymentMeta && typeof unlockPaymentMeta === "object"
      ? unlockPaymentMeta
      : null;

  await updateDoc(doc(db, "fullPackages", id), {
    selectedItems: normalizeFullPackageItems(selectedItems),
    unlockAmount: resolvedUnlockAmount,
    unlockPaid: true,
    unlockPaymentMeta: meta,
    // legacy compatibility
    depositAmount: resolvedUnlockAmount,
    depositPaid: true,
    depositPaymentMeta: meta,
    updatedAt: serverTimestamp(),
  });
}

export async function markFullPackageDepositPaid(input) {
  return markFullPackageUnlockPaid({
    ...input,
    unlockAmount: input?.unlockAmount ?? input?.depositAmount,
    unlockPaymentMeta: input?.unlockPaymentMeta ?? input?.depositPaymentMeta,
  });
}

export async function syncFullPackageSelection({ fullPackageId, selectedItems }) {
  const id = cleanStr(fullPackageId, 120);
  if (!id) return;

  await updateDoc(doc(db, "fullPackages", id), {
    selectedItems: normalizeFullPackageItems(selectedItems),
    updatedAt: serverTimestamp(),
  });
}

export async function syncFullPackageItemStates({ fullPackageId, itemStates }) {
  const id = cleanStr(fullPackageId, 120);
  if (!id) return;
  if (!itemStates || typeof itemStates !== "object") return;

  await updateDoc(doc(db, "fullPackages", id), {
    itemStates,
    updatedAt: serverTimestamp(),
  });
}

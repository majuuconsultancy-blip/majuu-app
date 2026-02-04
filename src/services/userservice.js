import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

// Create user doc if missing
export async function ensureUserDoc({ uid, email }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // inside setDoc(...) for new users
    await setDoc(ref, {
      email: email || "",
      name: "",
      phone: "",
      selectedTrack: null,
      hasActiveProcess: false,
      activeTrack: null,
      activeCountry: null,
      activeHelpType: null,
      activeRequestId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const latest = await getDoc(ref);
  return latest.exists() ? latest.data() : null;
}

// Read user state
export async function getUserState(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Backward compatibility for ProfileScreen
export async function getUserProfile(uid) {
  return getUserState(uid);
}

export async function setSelectedTrack(uid, track) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    selectedTrack: track,
    updatedAt: serverTimestamp(),
  });
}

// Old/simple setter (still okay to keep)
export async function setActiveProcess(uid, { hasActiveProcess, activeTrack }) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: Boolean(hasActiveProcess),
    activeTrack: hasActiveProcess ? activeTrack : null,
    updatedAt: serverTimestamp(),
  });
}

// ✅ New: save full active process details (track/country/helpType/requestId)
export async function setActiveProcessDetails(uid, details) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    ...details,
    updatedAt: serverTimestamp(),
  });
}

// Optional: context setter (if you still want it)
export async function setActiveContext(uid, { hasActiveProcess, activeTrack, activeCountry, activeHelpType }) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: Boolean(hasActiveProcess),
    activeTrack: hasActiveProcess ? activeTrack : null,
    activeCountry: hasActiveProcess ? (activeCountry || null) : null,
    activeHelpType: hasActiveProcess ? (activeHelpType || null) : null, // "self" | "we"
    updatedAt: serverTimestamp(),
  });
}

// ✅ Clear everything (used when admin closes/rejects)
export async function clearActiveProcess(uid) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: false,
    activeTrack: null,
    activeCountry: null,
    activeHelpType: null,
    activeRequestId: null,
    updatedAt: serverTimestamp(),
  });
}

// Optional: update name later
export async function updateUserName(uid, name) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    name: name || "",
    updatedAt: serverTimestamp(),
  });
}

//clear active process//
export async function clearActiveProcessIfSaidDone(uid) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: false,
    activeTrack: null,
    activeCountry: null,
    activeHelpType: null,
    activeRequestId: null,
    updatedAt: serverTimestamp(),
  });
}

// Save basic profile fields (name/phone) without overwriting everything
export async function upsertUserContact(uid, { name, phone }) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    name: String(name || "").trim(),
    phone: String(phone || "").trim(),
    updatedAt: serverTimestamp(),
  });
}

//update user profile//
export async function updateUserProfile(uid, { name, phone, countryOfResidence }) {
  const ref = doc(db, "users", uid);

  const payload = {
    updatedAt: serverTimestamp(),
  };

  if (typeof name !== "undefined") payload.name = String(name || "");
  if (typeof phone !== "undefined") payload.phone = String(phone || "");
  if (typeof countryOfResidence !== "undefined")
    payload.countryOfResidence = String(countryOfResidence || "");

  await updateDoc(ref, payload);
}
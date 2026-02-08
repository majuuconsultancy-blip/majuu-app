import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/* ----------------- NEW helpers (safe, no dependencies) ----------------- */
function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function normalizePhoneByResidence(countryOfResidence, phoneRaw) {
  const residence = String(countryOfResidence || "").trim();

  // Kenya strict: +254 + 9 digits (starting with 7 or 1)
  if (residence === "Kenya") {
    const digits = onlyDigits(phoneRaw);

    // allow pastes like 0712345678, 712345678, +254712345678, 254712345678
    let local = digits;

    if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
    if (local.startsWith("0") && local.length >= 10) local = local.slice(1);

    local = local.slice(-9);

    if (!/^(7|1)\d{8}$/.test(local)) {
      throw new Error("Invalid Kenya phone. Use 9 digits starting with 7 or 1 (e.g. +254712345678).");
    }

    return `+254${local}`;
  }

  // Other countries: keep as typed but basic sanity (at least 8 digits)
  const phone = String(phoneRaw || "").trim().replace(/\s+/g, "");
  if (!phone) return "";

  if (onlyDigits(phone).length < 8) {
    throw new Error("Phone number looks too short.");
  }

  // recommended: if user didn’t include +, we still accept (you can force later)
  return phone;
}

function validateProfilePayload({ name, phone, countryOfResidence }) {
  const residence = String(countryOfResidence || "").trim();

  if (typeof name !== "undefined") {
    const n = normalizeName(name);
    if (n.length < 3) throw new Error("Full name must be at least 3 characters.");
  }

  if (typeof countryOfResidence !== "undefined") {
    if (!residence) throw new Error("Country of residence is required.");
  }

  // if phone provided, validate relative to residence (if we have residence)
  if (typeof phone !== "undefined") {
    // If residence is missing here, we can’t do strict country-specific validation.
    // We still do basic check to avoid empty/garbage.
    const raw = String(phone || "").trim();
    if (!raw) throw new Error("Phone is required.");

    if (residence) {
      // full validation will happen in normalize
      normalizePhoneByResidence(residence, raw);
    } else {
      if (onlyDigits(raw).length < 8) throw new Error("Phone number looks too short.");
    }
  }
}

/* ----------------- Existing code (kept) ----------------- */

// Create user doc if missing
export async function ensureUserDoc({ uid, email }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      email: email || "",
      name: "",
      phone: "",
      countryOfResidence: "", // ✅ ensure field exists (harmless)
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
  const clean = normalizeName(name);
  if (clean && clean.length < 3) throw new Error("Full name must be at least 3 characters.");

  await updateDoc(ref, {
    name: clean || "",
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

  // ✅ fetch residence so Kenya normalization can apply
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data() : {};
  const residence = String(existing?.countryOfResidence || "").trim();

  const cleanName = normalizeName(name);
  const cleanPhone = residence ? normalizePhoneByResidence(residence, phone) : String(phone || "").trim();

  if (cleanName && cleanName.length < 3) {
    throw new Error("Full name must be at least 3 characters.");
  }
  if (!cleanPhone) {
    throw new Error("Phone is required.");
  }

  await updateDoc(ref, {
    name: cleanName || "",
    phone: cleanPhone || "",
    updatedAt: serverTimestamp(),
  });
}

//update user profile//
export async function updateUserProfile(uid, { name, phone, countryOfResidence }) {
  const ref = doc(db, "users", uid);

  // ✅ validate input
  validateProfilePayload({ name, phone, countryOfResidence });

  // ✅ if user is changing residence & phone together, normalize correctly
  // otherwise if only phone is passed, we fetch current residence for strict checks.
  let residence = typeof countryOfResidence !== "undefined"
    ? String(countryOfResidence || "").trim()
    : null;

  if (!residence && typeof phone !== "undefined") {
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : {};
    residence = String(existing?.countryOfResidence || "").trim();
  }

  const payload = {
    updatedAt: serverTimestamp(),
  };

  if (typeof name !== "undefined") payload.name = normalizeName(name);
  if (typeof countryOfResidence !== "undefined") payload.countryOfResidence = String(countryOfResidence || "").trim();

  if (typeof phone !== "undefined") {
    payload.phone = residence
      ? normalizePhoneByResidence(residence, phone)
      : String(phone || "").trim();
  }

  await updateDoc(ref, payload);
}
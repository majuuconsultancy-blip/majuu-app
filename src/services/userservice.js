import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/* ----------------- helpers ----------------- */
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
      throw new Error(
        "Invalid Kenya phone. Use 9 digits starting with 7 or 1 (e.g. +254712345678)."
      );
    }

    return `+254${local}`;
  }

  // Other countries: keep as typed but basic sanity (at least 8 digits)
  const phone = String(phoneRaw || "").trim().replace(/\s+/g, "");
  if (!phone) return "";

  if (onlyDigits(phone).length < 8) {
    throw new Error("Phone number looks too short.");
  }

  return phone;
}

function validateProfilePayload({ name, phone, countryOfResidence }) {
  const residence = String(countryOfResidence || "").trim();

  if (typeof name !== "undefined") {
    const n = normalizeName(name);
    if (!n) throw new Error("Full name is required.");
    if (n.length < 3) throw new Error("Full name must be at least 3 characters.");
  }

  if (typeof countryOfResidence !== "undefined") {
    if (!residence) throw new Error("Country of residence is required.");
  }

  if (typeof phone !== "undefined") {
    const raw = String(phone || "").trim();
    if (!raw) throw new Error("Phone is required.");

    if (residence) {
      normalizePhoneByResidence(residence, raw);
    } else {
      if (onlyDigits(raw).length < 8) throw new Error("Phone number looks too short.");
    }
  }
}

/**
 * ✅ Hard-safe “ensure”:
 * - If doc missing: create it
 * - If doc exists: ONLY fill missing fields, NEVER overwrite existing values
 */
export async function ensureUserDoc({ uid, email }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  const base = {
    email: email || "",
    name: "",
    phone: "",
    countryOfResidence: "",
    selectedTrack: null,
    hasActiveProcess: false,
    activeTrack: null,
    activeCountry: null,
    activeHelpType: null,
    activeRequestId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    // Create fresh
    await setDoc(ref, base, { merge: true });
  } else {
    // Repair only missing fields (do NOT wipe anything)
    const d = snap.data() || {};
    const patch = { updatedAt: serverTimestamp() };

    // only set if missing/undefined/null (not if empty string the user intentionally saved)
    const setIfMissing = (key, value) => {
      if (typeof d[key] === "undefined" || d[key] === null) patch[key] = value;
    };

    setIfMissing("email", email || d.email || "");
    setIfMissing("name", "");
    setIfMissing("phone", "");
    setIfMissing("countryOfResidence", "");
    setIfMissing("selectedTrack", null);
    setIfMissing("hasActiveProcess", false);
    setIfMissing("activeTrack", null);
    setIfMissing("activeCountry", null);
    setIfMissing("activeHelpType", null);
    setIfMissing("activeRequestId", null);
    setIfMissing("createdAt", serverTimestamp());

    // Only write if there is something to repair
    if (Object.keys(patch).length > 1) {
      await setDoc(ref, patch, { merge: true });
    }
  }

  const latest = await getDoc(ref);
  return latest.exists() ? latest.data() : null;
}

// Read user state (✅ auto-heal if missing)
export async function getUserState(uid, emailIfKnown = "") {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // ✅ This prevents Profile from loading null and looking “wiped”
    await ensureUserDoc({ uid, email: emailIfKnown || "" });
    const again = await getDoc(ref);
    return again.exists() ? again.data() : null;
  }

  return snap.data();
}

// Backward compatibility for ProfileScreen
export async function getUserProfile(uid, emailIfKnown = "") {
  return getUserState(uid, emailIfKnown);
}

export async function setSelectedTrack(uid, track) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    selectedTrack: track,
    updatedAt: serverTimestamp(),
  });
}

export async function setActiveProcess(uid, { hasActiveProcess, activeTrack }) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: Boolean(hasActiveProcess),
    activeTrack: hasActiveProcess ? activeTrack : null,
    updatedAt: serverTimestamp(),
  });
}

export async function setActiveProcessDetails(uid, details) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    ...details,
    updatedAt: serverTimestamp(),
  });
}

export async function setActiveContext(uid, { hasActiveProcess, activeTrack, activeCountry, activeHelpType }) {
  const ref = doc(db, "users", uid);
  await updateDoc(ref, {
    hasActiveProcess: Boolean(hasActiveProcess),
    activeTrack: hasActiveProcess ? activeTrack : null,
    activeCountry: hasActiveProcess ? (activeCountry || null) : null,
    activeHelpType: hasActiveProcess ? (activeHelpType || null) : null,
    updatedAt: serverTimestamp(),
  });
}

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

export async function updateUserName(uid, name) {
  const ref = doc(db, "users", uid);
  const clean = normalizeName(name);
  if (!clean) throw new Error("Full name is required.");
  if (clean.length < 3) throw new Error("Full name must be at least 3 characters.");

  await updateDoc(ref, {
    name: clean,
    updatedAt: serverTimestamp(),
  });
}

// clear active process (kept)
export async function clearActiveProcessIfSaidDone(uid) {
  return clearActiveProcess(uid);
}

export async function upsertUserContact(uid, { name, phone }) {
  const ref = doc(db, "users", uid);

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // if doc missing, create it first to prevent updateDoc crash
    await ensureUserDoc({ uid, email: "" });
  }

  const snap2 = await getDoc(ref);
  const existing = snap2.exists() ? snap2.data() : {};
  const residence = String(existing?.countryOfResidence || "").trim();

  const cleanName = normalizeName(name);
  if (!cleanName) throw new Error("Full name is required.");
  if (cleanName.length < 3) throw new Error("Full name must be at least 3 characters.");

  const cleanPhone = residence
    ? normalizePhoneByResidence(residence, phone)
    : String(phone || "").trim();

  if (!cleanPhone) throw new Error("Phone is required.");

  await updateDoc(ref, {
    name: cleanName,
    phone: cleanPhone,
    updatedAt: serverTimestamp(),
  });
}

export async function updateUserProfile(uid, { name, phone, countryOfResidence }) {
  const ref = doc(db, "users", uid);

  // ensure doc exists so updateDoc never fails
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await ensureUserDoc({ uid, email: "" });
  }

  // ✅ validate input (and prevents blank writes)
  validateProfilePayload({ name, phone, countryOfResidence });

  // determine residence for phone normalization
  let residence =
    typeof countryOfResidence !== "undefined"
      ? String(countryOfResidence || "").trim()
      : null;

  if (!residence && typeof phone !== "undefined") {
    const s2 = await getDoc(ref);
    const existing = s2.exists() ? s2.data() : {};
    residence = String(existing?.countryOfResidence || "").trim();
  }

  const payload = {
    updatedAt: serverTimestamp(),
  };

  if (typeof name !== "undefined") payload.name = normalizeName(name);
  if (typeof countryOfResidence !== "undefined")
    payload.countryOfResidence = String(countryOfResidence || "").trim();

  if (typeof phone !== "undefined") {
    payload.phone = residence
      ? normalizePhoneByResidence(residence, phone)
      : String(phone || "").trim();
  }

  await updateDoc(ref, payload);
}
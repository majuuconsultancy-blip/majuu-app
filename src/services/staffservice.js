// ✅ staffservice.js (FULL COPY-PASTE)
// Admin-only helper: find UID by email from /users, then write /staff/{uid}

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

export async function setStaffAccessByEmail({
  email,
  action,
  maxActive = 2,
  specialities = [],
  tracks = [],
} = {}) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !safeEmail.includes("@")) throw new Error("Invalid email.");

  // 1) Find user by email in /users collection
  const usersRef = collection(db, "users");
  const q = query(usersRef, where("email", "==", safeEmail), limit(1));
  const snap = await getDocs(q);

  if (snap.empty) {
    throw new Error("No user found with that email. They must sign up first.");
  }

  const userDoc = snap.docs[0];
  const uid = userDoc.id;

  // 2) Write staff doc
  const staffRef = doc(db, "staff", uid);

  if (action === "grant") {
    const payload = {
      uid,
      email: safeEmail,

      // ✅ admin-only flags
      active: true,
      onboarded: false,

      maxActive: Math.max(1, Number(maxActive) || 2),
      specialities: normalizeArray(specialities).map((s) => s.toLowerCase()),
      tracks: normalizeArray(tracks).map((t) => t.toLowerCase()),

      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(), // harmless with merge:true (won't overwrite existing)
    };

    // setDoc merge:true so you can re-grant without overwriting extra fields later
    await setDoc(staffRef, payload, { merge: true });
    return { email: safeEmail, uid };
  }

  if (action === "revoke") {
    await updateDoc(staffRef, {
      active: false,
      updatedAt: serverTimestamp(),
    });
    return { email: safeEmail, uid };
  }

  throw new Error("Invalid action. Use 'grant' or 'revoke'.");
}
// ✅ staffservice.js (FULL COPY-PASTE)
// Admin-only helper: find UID by email from /users, then write /staff/{uid}

import { collection, doc, getDocs, limit, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function setStaffAccessByEmail({ email, action, maxActive = 2, specialities = [] }) {
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
      active: true,
      onboarded: false,
      maxActive: Math.max(1, Number(maxActive) || 2),
      specialities: Array.isArray(specialities) ? specialities : [],
      updatedAt: Date.now(),
    };

    // setDoc merge:true so you can re-grant without overwriting extra fields later
    await setDoc(staffRef, payload, { merge: true });
    return { email: safeEmail, uid };
  }

  if (action === "revoke") {
    await updateDoc(staffRef, {
      active: false,
      updatedAt: Date.now(),
    });
    return { email: safeEmail, uid };
  }

  throw new Error("Invalid action. Use 'grant' or 'revoke'.");
}
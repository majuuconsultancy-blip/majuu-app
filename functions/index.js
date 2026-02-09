const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * ✅ ADMIN ONLY
 * Create or activate staff by email
 */
exports.grantStaffAccess = functions.https.onCall(async (data, context) => {
  // --- security ---
  if (!context.auth?.token?.email) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  if (context.auth.token.email !== "brioneroo@gmail.com") {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const email = String(data.email || "").toLowerCase().trim();
  const specialties = Array.isArray(data.specialties) ? data.specialties : [];

  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "Email required");
  }

  // get or create auth user
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch {
    user = await admin.auth().createUser({
      email,
      password: Math.random().toString(36).slice(-10),
    });
  }

  // create staff doc
  await db.collection("staff").doc(user.uid).set(
    {
      email,
      active: true,
      onboarded: false,
      specialties,
      maxActive: 2,
      activeCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, uid: user.uid };
});

/**
 * ❌ ADMIN ONLY
 * Revoke staff access
 */
exports.revokeStaffAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.email) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  if (context.auth.token.email !== "brioneroo@gmail.com") {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const uid = String(data.uid || "");
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "UID required");
  }

  await db.collection("staff").doc(uid).update({
    active: false,
  });

  return { ok: true };
});
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import {
  getCurrentUserRoleContext,
  normalizeAdminAvailability,
} from "./adminroleservice";
import {
  normalizeCountyList,
  normalizeCountyLowerList,
} from "../constants/kenyaCounties";

const ASSIGNED_ADMIN_ROLE_VARIANTS = [
  "assignedAdmin",
  "assignedadmin",
  "assigned_admin",
  "admin",
];

function safeStr(value) {
  return String(value || "").trim();
}

function normalizeEmail(email) {
  return safeStr(email).toLowerCase();
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function defaultAdminScopePayload() {
  return {
    counties: [],
    countiesLower: [],
    town: "",
    availability: "active",
    active: true,
    maxActiveRequests: 12,
    responseTimeoutMinutes: 20,
  };
}

async function requireSuperAdmin() {
  const actorUid = safeStr(auth.currentUser?.uid);
  if (!actorUid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(actorUid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only super admin can manage assigned admins.");
  }
  return roleCtx;
}

async function findUserUidByEmail(email) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !safeEmail.includes("@")) {
    throw new Error("Enter a valid email.");
  }

  const snap = await getDocs(
    query(collection(db, "users"), where("email", "==", safeEmail), limit(1))
  );
  if (snap.empty) {
    throw new Error("No user found with that email. They must sign up first.");
  }
  return snap.docs[0]?.id || "";
}

export async function listAssignedAdmins({ max = 100 } = {}) {
  await requireSuperAdmin();
  const maxRows = Math.max(1, Math.min(300, Number(max) || 100));
  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("role", "in", ASSIGNED_ADMIN_ROLE_VARIANTS),
      limit(maxRows)
    )
  );
  return snap.docs
    .map((d) => ({ uid: d.id, ...(d.data() || {}) }))
    .sort((a, b) => normalizeEmail(a?.email).localeCompare(normalizeEmail(b?.email)));
}

export async function setAssignedAdminByEmail({
  email,
  action = "upsert",
  counties = [],
  town = "",
  availability = "active",
  active = true,
  maxActiveRequests = 12,
  responseTimeoutMinutes = 20,
} = {}) {
  const superAdmin = await requireSuperAdmin();
  const uid = await findUserUidByEmail(email);
  const userRef = doc(db, "users", uid);

  const mode = safeStr(action).toLowerCase();
  if (mode !== "upsert" && mode !== "remove") {
    throw new Error("Invalid action. Use 'upsert' or 'remove'.");
  }

  if (mode === "remove") {
    await setDoc(
      userRef,
      {
        role: "user",
        adminScope: defaultAdminScopePayload(),
        adminUpdatedBy: superAdmin.uid,
        adminUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { uid, email: normalizeEmail(email), action: "removed" };
  }

  const cleanCounties = normalizeCountyList(counties);
  if (!cleanCounties.length) {
    throw new Error("Select at least one county.");
  }

  const scopePayload = {
    counties: cleanCounties,
    countiesLower: normalizeCountyLowerList(cleanCounties),
    town: safeStr(town).slice(0, 80),
    availability: normalizeAdminAvailability(availability),
    active: active !== false,
    maxActiveRequests: toBoundedInt(maxActiveRequests, 12, 1, 120),
    responseTimeoutMinutes: toBoundedInt(responseTimeoutMinutes, 20, 5, 240),
  };

  await setDoc(
    userRef,
    {
      role: "assignedAdmin",
      adminScope: scopePayload,
      adminUpdatedBy: superAdmin.uid,
      adminUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    uid,
    email: normalizeEmail(email),
    action: "upserted",
    counties: scopePayload.counties,
    town: scopePayload.town,
    availability: scopePayload.availability,
  };
}

export async function getAssignedAdminByUid(uid) {
  await requireSuperAdmin();
  const safeUid = safeStr(uid);
  if (!safeUid) throw new Error("Missing assigned admin uid.");

  const snap = await getDoc(doc(db, "users", safeUid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...(snap.data() || {}) };
}

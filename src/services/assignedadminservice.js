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

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanos = Number(value?.nanoseconds || 0);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
  }
  return 0;
}

function pickPrimaryDoc(rows = []) {
  const sorted = [...rows].sort((a, b) => {
    const aUpdated = toTimestampMs(a?.updatedAt);
    const bUpdated = toTimestampMs(b?.updatedAt);
    if (bUpdated !== aUpdated) return bUpdated - aUpdated;

    const aCreated = toTimestampMs(a?.createdAt);
    const bCreated = toTimestampMs(b?.createdAt);
    if (bCreated !== aCreated) return bCreated - aCreated;

    return safeStr(a?.uid).localeCompare(safeStr(b?.uid));
  });
  return sorted[0] || null;
}

function dedupeByEmail(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = normalizeEmail(row?.email);
    if (!key) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, row);
      return;
    }
    const winner = pickPrimaryDoc([current, row]);
    map.set(key, winner || current);
  });
  return Array.from(map.values());
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

async function findUserDocsByEmail(email) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !safeEmail.includes("@")) {
    throw new Error("Enter a valid email.");
  }

  const snap = await getDocs(
    query(collection(db, "users"), where("email", "==", safeEmail), limit(20))
  );
  if (snap.empty) {
    throw new Error("No user found with that email. They must sign up first.");
  }

  const rows = snap.docs.map((d) => ({ uid: d.id, ...(d.data() || {}) }));
  const primary = pickPrimaryDoc(rows);
  if (!primary?.uid) {
    throw new Error("Found user docs, but failed to resolve target account.");
  }
  return {
    email: safeEmail,
    rows,
    primaryUid: primary.uid,
  };
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
  const rows = snap.docs.map((d) => ({ uid: d.id, ...(d.data() || {}) }));
  return dedupeByEmail(rows)
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
  const match = await findUserDocsByEmail(email);
  const targetRows = Array.isArray(match?.rows) ? match.rows : [];
  const targetUids = targetRows.map((row) => safeStr(row?.uid)).filter(Boolean);

  if (!targetUids.length) {
    throw new Error("No user uid found for this email.");
  }
  if (targetUids.length > 1) {
    console.warn(
      "[assignedadminservice] duplicate users docs for email, applying update to all matches:",
      normalizeEmail(email),
      targetUids
    );
  }

  const mode = safeStr(action).toLowerCase();
  if (mode !== "upsert" && mode !== "remove") {
    throw new Error("Invalid action. Use 'upsert' or 'remove'.");
  }

  if (mode === "remove") {
    await Promise.all(
      targetUids.map((uid) =>
        setDoc(
          doc(db, "users", uid),
          {
            role: "user",
            adminScope: defaultAdminScopePayload(),
            adminUpdatedBy: superAdmin.uid,
            adminUpdatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      )
    );
    return {
      uid: match.primaryUid,
      uids: targetUids,
      email: normalizeEmail(email),
      action: "removed",
    };
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

  await Promise.all(
    targetUids.map((uid) =>
      setDoc(
        doc(db, "users", uid),
        {
          role: "assignedAdmin",
          adminScope: scopePayload,
          adminUpdatedBy: superAdmin.uid,
          adminUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );

  return {
    uid: match.primaryUid,
    uids: targetUids,
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

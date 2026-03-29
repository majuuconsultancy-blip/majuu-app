import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "../firebase";
import {
  getCurrentUserRoleContext,
  normalizeManagerScope,
  normalizeManagerStatus,
} from "./adminroleservice";
import {
  MANAGER_MODULE_CATALOG,
  normalizeManagerModules,
} from "./managerModules";

const functions = getFunctions(undefined, "us-central1");

const MANAGER_AUDIT_COLLECTION = "managerAuditLogs";
const MANAGER_INVITES_COLLECTION = "managerInvites";
const MANAGER_ROLE_VARIANTS = ["manager", "assignedManager", "assigned_manager"];

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return safeString(value, 320).toLowerCase();
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanoseconds = Number(value?.nanoseconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const extra = Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0;
  return seconds * 1000 + extra;
}

function formatManagerCallableError(error, callableName = "") {
  const code = safeString(error?.code, 160).toLowerCase();
  const message = safeString(error?.message, 600).toLowerCase();
  const isInfraError =
    code.includes("functions/internal") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/unimplemented") ||
    code.includes("functions/deadline-exceeded") ||
    (code.includes("internal") && !message.includes("permission")) ||
    message === "internal";

  const label = safeString(callableName, 80) || "Manager service";
  const wrapped = new Error(
    isInfraError
      ? `${label} is not available right now. Deploy Cloud Functions and retry (Firebase Blaze plan is required).`
      : safeString(error?.message, 600) || "Manager service request failed. Please try again."
  );
  wrapped.code = code;
  wrapped.isInfrastructureUnavailable = isInfraError;
  return wrapped;
}

function isCallableInfraUnavailable(error) {
  return Boolean(error?.isInfrastructureUnavailable);
}

function callManagerFunction(name, payload = {}) {
  const callable = httpsCallable(functions, name);
  return callable(payload)
    .then((result) => result?.data ?? null)
    .catch((error) => {
      throw formatManagerCallableError(error, name);
    });
}

function managerDocToRow(docSnap) {
  const row = docSnap?.data?.() || {};
  const managerScope = normalizeManagerScope(row?.managerScope);
  return {
    uid: safeString(docSnap?.id, 180),
    email: normalizeEmail(row?.email),
    name: safeString(row?.name || managerScope?.name, 120),
    role: safeString(row?.role, 80),
    managerScope,
    status: safeString(managerScope?.status, 40) || "active",
    assignedModules: normalizeManagerModules(managerScope?.assignedModules),
    stationedCountry: safeString(managerScope?.stationedCountry, 120),
    cityTown: safeString(managerScope?.cityTown, 120),
    managerRole: safeString(managerScope?.managerRole, 120),
    notes: safeString(managerScope?.notes, 2000),
    lastLoginAtMs: Number(managerScope?.lastLoginAtMs || row?.lastLoginAt || 0) || 0,
    updatedAtMs: Number(managerScope?.updatedAtMs || row?.updatedAtMs || 0) || 0,
  };
}

function pickPrimaryByRecency(rows = []) {
  return [...rows]
    .sort((left, right) => {
      const updatedGap = Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0);
      if (updatedGap !== 0) return updatedGap;
      return safeString(left?.uid, 180).localeCompare(safeString(right?.uid, 180));
    })[0] || null;
}

function dedupeManagersByEmail(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const email = normalizeEmail(row?.email);
    if (!email) return;
    const current = map.get(email);
    if (!current) {
      map.set(email, row);
      return;
    }
    map.set(email, pickPrimaryByRecency([current, row]) || current);
  });
  return Array.from(map.values());
}

async function requireSuperAdmin() {
  const actorUid = safeString(auth.currentUser?.uid, 180);
  if (!actorUid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(actorUid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can manage managers.");
  }
  return roleCtx;
}

function pickPrimaryUserDoc(rows = []) {
  return [...rows]
    .sort((left, right) => {
      const leftUpdated = Number(left?.updatedAtMs || toTimestampMs(left?.updatedAt) || 0);
      const rightUpdated = Number(right?.updatedAtMs || toTimestampMs(right?.updatedAt) || 0);
      if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
      const leftCreated = Number(left?.createdAtMs || toTimestampMs(left?.createdAt) || 0);
      const rightCreated = Number(right?.createdAtMs || toTimestampMs(right?.createdAt) || 0);
      if (rightCreated !== leftCreated) return rightCreated - leftCreated;
      return safeString(left?.uid, 180).localeCompare(safeString(right?.uid, 180));
    })[0] || null;
}

async function findUserDocsByEmail(email) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !safeEmail.includes("@")) {
    throw new Error("Enter a valid manager email.");
  }

  let snap = await getDocs(
    query(collection(db, "users"), where("email", "==", safeEmail), limit(30))
  );
  if (snap.empty) {
    snap = await getDocs(
      query(collection(db, "users"), where("emailLower", "==", safeEmail), limit(30))
    );
  }
  if (snap.empty) {
    throw new Error("No user found with that email. They must sign up first.");
  }

  const rows = snap.docs.map((docSnap) => ({ uid: docSnap.id, ...(docSnap.data() || {}) }));
  const primary = pickPrimaryUserDoc(rows);
  if (!primary?.uid) {
    throw new Error("Found user docs, but failed to resolve target account.");
  }

  return {
    email: safeEmail,
    rows,
    primaryUid: safeString(primary.uid, 180),
  };
}

function defaultManagerScopePayload(nowMs = Date.now()) {
  return {
    name: "",
    stationedCountry: "",
    stationedCountryLower: "",
    cityTown: "",
    managerRole: "",
    assignedModules: [],
    notes: "",
    status: "inactive",
    inviteToken: "",
    inviteId: "",
    inviteCreatedAtMs: 0,
    inviteExpiresAtMs: 0,
    lastLoginAtMs: 0,
    updatedAtMs: Number(nowMs || 0) || Date.now(),
  };
}

function buildManagerScopePayload(input = {}, existingScope = {}) {
  const existing = normalizeManagerScope(existingScope);
  const nextCountry = safeString(input?.stationedCountry || existing?.stationedCountry, 120);
  const hasExplicitNotes = Object.prototype.hasOwnProperty.call(input || {}, "notes");

  return {
    ...existing,
    name: safeString(input?.name || existing?.name, 120),
    stationedCountry: nextCountry,
    stationedCountryLower: safeString(
      input?.stationedCountryLower || nextCountry || existing?.stationedCountryLower,
      120
    ).toLowerCase(),
    cityTown: safeString(input?.cityTown || existing?.cityTown, 120),
    managerRole: safeString(input?.managerRole || existing?.managerRole, 120),
    assignedModules: normalizeManagerModules(
      Array.isArray(input?.assignedModules) && input.assignedModules.length
        ? input.assignedModules
        : existing?.assignedModules
    ),
    notes: safeString(hasExplicitNotes ? input?.notes : existing?.notes, 2000),
    status: normalizeManagerStatus(input?.status || existing?.status || "active"),
    updatedAtMs: Number(input?.updatedAtMs || Date.now()) || Date.now(),
  };
}

async function writeManagerAuditEntry({
  managerUid = "",
  managerEmail = "",
  action = "",
  moduleKey = "",
  details = "",
  metadata = {},
  actorUid = "",
  actorEmail = "",
  actorRole = "",
} = {}) {
  const now = Date.now();
  const safeManagerUid = safeString(managerUid, 180);
  const safeAction = safeString(action, 120).toLowerCase() || "manager_activity";
  const docId = `${safeManagerUid || "manager"}_${now}_${Math.random().toString(36).slice(2, 8)}`;

  await setDoc(doc(db, MANAGER_AUDIT_COLLECTION, docId), {
    managerUid: safeManagerUid,
    managerEmail: normalizeEmail(managerEmail),
    action: safeAction,
    moduleKey: safeString(moduleKey, 120).toLowerCase(),
    details: safeString(details, 3000),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    actorUid: safeString(actorUid, 180),
    actorEmail: normalizeEmail(actorEmail),
    actorRole: safeString(actorRole, 60).toLowerCase(),
    createdAt: serverTimestamp(),
    createdAtMs: now,
  });

  return docId;
}

async function upsertManagerAssignmentByEmailDirect(input = {}) {
  const superAdmin = await requireSuperAdmin();
  const email = normalizeEmail(input?.email);
  if (!email || !email.includes("@")) {
    throw new Error("Valid manager email is required.");
  }

  const assignedModules = normalizeManagerModules(input?.assignedModules);
  if (!assignedModules.length) {
    throw new Error("Select at least one manager module.");
  }

  const status = normalizeManagerStatus(input?.status || "active");
  const now = Date.now();
  const match = await findUserDocsByEmail(email);
  const targetRows = Array.isArray(match?.rows) ? match.rows : [];
  const targetUids = targetRows.map((row) => safeString(row?.uid, 180)).filter(Boolean);

  await Promise.all(
    targetRows.map((row) => {
      const uid = safeString(row?.uid, 180);
      if (!uid) return Promise.resolve();
      const scope = buildManagerScopePayload(
        {
          name: safeString(input?.name, 120),
          stationedCountry: safeString(input?.stationedCountry, 120),
          cityTown: safeString(input?.cityTown, 120),
          managerRole: safeString(input?.managerRole, 120),
          assignedModules,
          notes: safeString(input?.notes, 2000),
          status,
          updatedAtMs: now,
        },
        row?.managerScope
      );

      return setDoc(
        doc(db, "users", uid),
        {
          email,
          role: "manager",
          managerScope: scope,
          managerUpdatedBy: safeString(superAdmin?.uid, 180),
          managerUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
        },
        { merge: true }
      );
    })
  );

  await Promise.all(
    targetUids.map((uid) =>
      writeManagerAuditEntry({
        managerUid: uid,
        managerEmail: email,
        action: "manager_assignment_updated",
        moduleKey: assignedModules[0] || "",
        details: `Manager modules updated: ${assignedModules.join(", ")}`,
        metadata: {
          assignedModules,
          status,
          directAssign: true,
        },
        actorUid: safeString(superAdmin?.uid, 180),
        actorEmail: normalizeEmail(superAdmin?.email),
        actorRole: "superadmin",
      })
    )
  );

  return {
    ok: true,
    directAssign: true,
    email,
    uid: safeString(match?.primaryUid, 180),
    uids: targetUids,
    assignedModules,
    status,
  };
}

async function revokeManagerByEmailDirect(input = {}) {
  const superAdmin = await requireSuperAdmin();
  const email = normalizeEmail(input?.email);
  if (!email || !email.includes("@")) {
    throw new Error("Valid manager email is required.");
  }

  const now = Date.now();
  const match = await findUserDocsByEmail(email);
  const targetRows = Array.isArray(match?.rows) ? match.rows : [];
  const targetUids = targetRows.map((row) => safeString(row?.uid, 180)).filter(Boolean);

  await Promise.all(
    targetUids.map((uid) =>
      setDoc(
        doc(db, "users", uid),
        {
          role: "user",
          managerScope: defaultManagerScopePayload(now),
          managerUpdatedBy: safeString(superAdmin?.uid, 180),
          managerUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedAtMs: now,
        },
        { merge: true }
      )
    )
  );

  await Promise.all(
    targetUids.map((uid) =>
      writeManagerAuditEntry({
        managerUid: uid,
        managerEmail: email,
        action: "manager_revoked",
        details: "Manager role revoked via direct assignment flow.",
        metadata: { directAssign: true },
        actorUid: safeString(superAdmin?.uid, 180),
        actorEmail: normalizeEmail(superAdmin?.email),
        actorRole: "superadmin",
      })
    )
  );

  return {
    ok: true,
    directAssign: true,
    email,
    uid: safeString(match?.primaryUid, 180),
    uids: targetUids,
    revoked: targetUids.length,
  };
}

export function getManagerModuleOptions() {
  return MANAGER_MODULE_CATALOG;
}

export function buildManagerInviteLink(inviteToken, { email = "" } = {}) {
  const token = safeString(inviteToken, 220);
  if (!token) return "";
  if (typeof window === "undefined") return "";
  const url = new URL("/signup", window.location.origin);
  url.searchParams.set("managerInvite", token);
  const safeEmail = normalizeEmail(email);
  if (safeEmail) url.searchParams.set("email", safeEmail);
  return url.toString();
}

export async function createManagerInvite(input = {}) {
  const appBaseUrl =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const payload = {
    email: normalizeEmail(input?.email),
    name: safeString(input?.name, 120),
    stationedCountry: safeString(input?.stationedCountry, 120),
    cityTown: safeString(input?.cityTown, 120),
    managerRole: safeString(input?.managerRole, 120),
    assignedModules: normalizeManagerModules(input?.assignedModules),
    notes: safeString(input?.notes, 2000),
    expiresInHours: Number(input?.expiresInHours || 24) || 24,
    appBaseUrl,
  };
  const result = await callManagerFunction("createManagerInvite", payload);
  return {
    ...(result || {}),
    inviteLink:
      safeString(result?.inviteLink, 1800) ||
      buildManagerInviteLink(result?.inviteToken, { email: payload.email }),
  };
}

export async function redeemManagerInvite(inviteToken = "") {
  return callManagerFunction("redeemManagerInvite", {
    inviteToken: safeString(inviteToken, 220),
  });
}

export async function upsertManagerAssignmentByEmail(input = {}) {
  const payload = {
    email: normalizeEmail(input?.email),
    name: safeString(input?.name, 120),
    stationedCountry: safeString(input?.stationedCountry, 120),
    cityTown: safeString(input?.cityTown, 120),
    managerRole: safeString(input?.managerRole, 120),
    assignedModules: normalizeManagerModules(input?.assignedModules),
    notes: safeString(input?.notes, 2000),
    status: safeString(input?.status, 40) || "active",
  };

  try {
    return await callManagerFunction("upsertManagerAssignmentByEmail", payload);
  } catch (error) {
    if (isCallableInfraUnavailable(error)) {
      return upsertManagerAssignmentByEmailDirect(payload);
    }
    throw error;
  }
}

export async function assignManagerByEmailDirect(input = {}) {
  return upsertManagerAssignmentByEmailDirect({
    ...input,
    status: safeString(input?.status, 40) || "active",
  });
}

export async function revokeManagerByEmail(input = {}) {
  const payload = { email: normalizeEmail(input?.email) };
  try {
    return await callManagerFunction("revokeManagerByEmail", payload);
  } catch (error) {
    if (isCallableInfraUnavailable(error)) {
      return revokeManagerByEmailDirect(payload);
    }
    throw error;
  }
}

export async function listAssignedManagers({ max = 250, dedupeEmail = true } = {}) {
  const roleCtx = await getCurrentUserRoleContext();
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can load manager assignments.");
  }

  const maxRows = Math.max(1, Math.min(300, Number(max) || 250));
  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("role", "in", MANAGER_ROLE_VARIANTS),
      limit(maxRows)
    )
  );

  const rows = snap.docs.map((docSnap) => managerDocToRow(docSnap));
  const scoped = dedupeEmail ? dedupeManagersByEmail(rows) : rows;
  return scoped.sort((left, right) =>
    normalizeEmail(left?.email).localeCompare(normalizeEmail(right?.email))
  );
}

export async function listPendingManagerInvites({ max = 250 } = {}) {
  const roleCtx = await getCurrentUserRoleContext();
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can load pending manager invites.");
  }

  const maxRows = Math.max(1, Math.min(300, Number(max) || 250));
  const snap = await getDocs(
    query(
      collection(db, MANAGER_INVITES_COLLECTION),
      where("status", "==", "pending"),
      limit(maxRows)
    )
  );

  return snap.docs
    .map((docSnap) => {
      const row = docSnap.data() || {};
      return {
        id: safeString(docSnap.id, 180),
        inviteId: safeString(docSnap.id, 180),
        email: normalizeEmail(row?.email || row?.emailLower),
        name: safeString(row?.name, 120),
        stationedCountry: safeString(row?.stationedCountry, 120),
        cityTown: safeString(row?.cityTown, 120),
        managerRole: safeString(row?.managerRole, 120),
        assignedModules: normalizeManagerModules(row?.assignedModules),
        notes: safeString(row?.notes, 2000),
        status: safeString(row?.status, 40) || "pending",
        expiresAtMs: Number(row?.expiresAtMs || 0) || 0,
        createdAtMs: Number(row?.createdAtMs || 0) || toTimestampMs(row?.createdAt),
      };
    })
    .sort((left, right) => Number(right?.createdAtMs || 0) - Number(left?.createdAtMs || 0));
}

export async function listManagerAuditLogs({ managerUid = "", max = 40 } = {}) {
  const roleCtx = await getCurrentUserRoleContext();
  const safeManagerUid = safeString(managerUid, 180);
  if (!safeManagerUid) return [];

  if (!roleCtx?.isSuperAdmin && safeManagerUid !== safeString(roleCtx?.uid, 180)) {
    throw new Error("You do not have permission to view these manager logs.");
  }

  const maxRows = Math.max(1, Math.min(120, Number(max) || 40));
  const snap = await getDocs(
    query(
      collection(db, MANAGER_AUDIT_COLLECTION),
      where("managerUid", "==", safeManagerUid),
      limit(maxRows)
    )
  );

  return snap.docs
    .map((docSnap) => {
      const row = docSnap.data() || {};
      const createdAtMs = Number(row?.createdAtMs || 0) || toTimestampMs(row?.createdAt);
      return {
        id: safeString(docSnap.id, 180),
        managerUid: safeString(row?.managerUid, 180),
        managerEmail: normalizeEmail(row?.managerEmail),
        action: safeString(row?.action, 120),
        moduleKey: safeString(row?.moduleKey, 120),
        details: safeString(row?.details, 3000),
        actorUid: safeString(row?.actorUid, 180),
        actorEmail: normalizeEmail(row?.actorEmail),
        actorRole: safeString(row?.actorRole, 60),
        createdAtMs,
      };
    })
    .sort((left, right) => Number(right?.createdAtMs || 0) - Number(left?.createdAtMs || 0));
}

export async function touchManagerLastLogin({ managerUid = "" } = {}) {
  const uid = safeString(managerUid || auth.currentUser?.uid, 180);
  if (!uid) return false;
  const roleCtx = await getCurrentUserRoleContext(uid);
  if (!roleCtx?.isManager) return false;

  await setDoc(
    doc(db, "users", uid),
    {
      managerScope: {
        ...(roleCtx?.managerScope || {}),
        lastLoginAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    },
    { merge: true }
  );
  return true;
}

export async function logManagerModuleActivity({
  moduleKey = "",
  action = "",
  details = "",
  metadata = {},
} = {}) {
  const roleCtx = await getCurrentUserRoleContext();
  if (!roleCtx?.isManager) return false;

  const now = Date.now();
  const actionKey = safeString(action, 120).toLowerCase() || "module_activity";
  const safeModuleKey = safeString(moduleKey, 120).toLowerCase();
  const actorUid = safeString(roleCtx?.uid, 180);
  const docId = `${actorUid}_${now}_${Math.random().toString(36).slice(2, 8)}`;

  await setDoc(doc(db, MANAGER_AUDIT_COLLECTION, docId), {
    managerUid: actorUid,
    managerEmail: normalizeEmail(roleCtx?.email),
    action: actionKey,
    moduleKey: safeModuleKey,
    details: safeString(details, 3000),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    actorUid,
    actorEmail: normalizeEmail(roleCtx?.email),
    actorRole: "manager",
    createdAt: serverTimestamp(),
    createdAtMs: now,
  });

  return true;
}

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
  normalizeManagerScope,
  normalizeManagerStatus,
} from "./adminroleservice";
import {
  MANAGER_MODULE_CATALOG,
  normalizeManagerModules,
} from "./managerModules";

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

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function randomTokenSegment(length = 20) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const size = Math.max(8, Math.min(64, Number(length) || 20));
  let output = "";

  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint8Array(size);
    globalThis.crypto.getRandomValues(buffer);
    buffer.forEach((value) => {
      output += chars[value % chars.length];
    });
    return output;
  }

  for (let index = 0; index < size; index += 1) {
    output += chars[Math.floor(Math.random() * chars.length)];
  }
  return output;
}

function generateManagerInviteToken() {
  return `mgr_${Date.now().toString(36)}_${randomTokenSegment(18)}`;
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

async function createManagerInviteDirect(input = {}) {
  const superAdmin = await requireSuperAdmin();
  const email = normalizeEmail(input?.email);
  if (!email || !email.includes("@")) {
    throw new Error("Valid manager email is required.");
  }

  const assignedModules = normalizeManagerModules(input?.assignedModules);
  if (!assignedModules.length) {
    throw new Error("Select at least one manager module.");
  }

  const now = Date.now();
  const expiresInHours = clampNumber(input?.expiresInHours || 24, 1, 168);
  const expiresAtMs = now + expiresInHours * 60 * 60 * 1000;
  const inviteToken = generateManagerInviteToken();
  const inviteLink = buildManagerInviteLink(inviteToken, { email });

  await setDoc(
    doc(db, MANAGER_INVITES_COLLECTION, inviteToken),
    {
      id: inviteToken,
      inviteToken,
      email,
      emailLower: email,
      name: safeString(input?.name, 120),
      stationedCountry: safeString(input?.stationedCountry, 120),
      stationedCountryLower: safeString(input?.stationedCountry, 120).toLowerCase(),
      cityTown: safeString(input?.cityTown, 120),
      managerRole: safeString(input?.managerRole, 120),
      assignedModules,
      notes: safeString(input?.notes, 2000),
      status: "pending",
      singleUse: true,
      expiresAtMs,
      createdByUid: safeString(superAdmin?.uid, 180),
      createdByEmail: normalizeEmail(superAdmin?.email),
      createdAt: serverTimestamp(),
      createdAtMs: now,
      updatedAt: serverTimestamp(),
      updatedAtMs: now,
    },
    { merge: true }
  );

  await writeManagerAuditEntry({
    managerUid: "",
    managerEmail: email,
    action: "manager_invite_created",
    moduleKey: assignedModules[0] || "",
    details: `Invite created for ${email}`,
    metadata: {
      inviteId: inviteToken,
      assignedModules,
      expiresAtMs,
    },
    actorUid: safeString(superAdmin?.uid, 180),
    actorEmail: normalizeEmail(superAdmin?.email),
    actorRole: "superadmin",
  });

  return {
    ok: true,
    inviteId: inviteToken,
    inviteToken,
    inviteLink,
    email,
    assignedModules,
    expiresAtMs,
    localFallback: true,
  };
}

async function redeemManagerInviteDirect(inviteToken = "") {
  const callerUid = safeString(auth.currentUser?.uid, 180);
  if (!callerUid) {
    throw new Error("Login required");
  }

  const safeInviteToken = safeString(inviteToken, 220);
  if (!safeInviteToken) {
    throw new Error("inviteToken is required");
  }

  const inviteRef = doc(db, MANAGER_INVITES_COLLECTION, safeInviteToken);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) {
    throw new Error("Manager invite was not found");
  }

  const invite = inviteSnap.data() || {};
  const inviteStatus = safeString(invite?.status, 40).toLowerCase() || "pending";
  if (inviteStatus !== "pending") {
    throw new Error("Invite has already been used");
  }

  const now = Date.now();
  const expiresAtMs = Number(invite?.expiresAtMs || 0) || 0;
  if (expiresAtMs > 0 && now > expiresAtMs) {
    await setDoc(
      inviteRef,
      {
        status: "expired",
        updatedAt: serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    );
    throw new Error("Invite has expired");
  }

  const inviteEmail = normalizeEmail(invite?.email || invite?.emailLower);
  const callerEmail = normalizeEmail(auth.currentUser?.email);
  if (!callerEmail || !inviteEmail || callerEmail !== inviteEmail) {
    throw new Error("Invite email does not match signed-in account");
  }

  const userSnap = await getDoc(doc(db, "users", callerUid));
  const userDoc = userSnap.exists() ? userSnap.data() || {} : {};
  const managerScope = buildManagerScopePayload(
    {
      name: safeString(invite?.name || userDoc?.name, 120),
      stationedCountry: safeString(invite?.stationedCountry, 120),
      cityTown: safeString(invite?.cityTown, 120),
      managerRole: safeString(invite?.managerRole, 120),
      assignedModules: normalizeManagerModules(invite?.assignedModules),
      notes: safeString(invite?.notes, 2000),
      status: "active",
      inviteToken: safeInviteToken,
      inviteId: safeInviteToken,
      inviteCreatedAtMs: Number(invite?.createdAtMs || now) || now,
      inviteExpiresAtMs: expiresAtMs,
      lastLoginAtMs: now,
      updatedAtMs: now,
    },
    userDoc?.managerScope
  );

  if (!managerScope.assignedModules.length) {
    throw new Error("Invite has no modules assigned");
  }

  await Promise.all([
    setDoc(
      doc(db, "users", callerUid),
      {
        email: inviteEmail,
        emailLower: inviteEmail,
        role: "manager",
        managerScope,
        managerUpdatedBy: `invite:${safeInviteToken}`,
        managerUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    ),
    setDoc(
      inviteRef,
      {
        status: "accepted",
        acceptedByUid: callerUid,
        acceptedByEmail: callerEmail,
        acceptedAt: serverTimestamp(),
        acceptedAtMs: now,
        updatedAt: serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    ),
    writeManagerAuditEntry({
      managerUid: callerUid,
      managerEmail: inviteEmail,
      action: "manager_invite_redeemed",
      moduleKey: managerScope.assignedModules[0] || "",
      details: `Manager invite redeemed by ${inviteEmail}`,
      metadata: {
        inviteId: safeInviteToken,
        assignedModules: managerScope.assignedModules,
      },
      actorUid: callerUid,
      actorEmail: inviteEmail,
      actorRole: "manager",
    }),
  ]);

  return {
    ok: true,
    uid: callerUid,
    email: inviteEmail,
    inviteToken: safeInviteToken,
    assignedModules: managerScope.assignedModules,
    localFallback: true,
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
  const result = await createManagerInviteDirect(payload);
  return {
    ...(result || {}),
    inviteLink:
      safeString(result?.inviteLink, 1800) ||
      buildManagerInviteLink(result?.inviteToken, { email: payload.email }),
  };
}

export async function redeemManagerInvite(inviteToken = "") {
  return redeemManagerInviteDirect(safeString(inviteToken, 220));
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

  return upsertManagerAssignmentByEmailDirect(payload);
}

export async function assignManagerByEmailDirect(input = {}) {
  return upsertManagerAssignmentByEmailDirect({
    ...input,
    status: safeString(input?.status, 40) || "active",
  });
}

export async function revokeManagerByEmail(input = {}) {
  const payload = { email: normalizeEmail(input?.email) };
  return revokeManagerByEmailDirect(payload);
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

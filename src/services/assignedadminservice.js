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
  normalizeAdminScope,
} from "./adminroleservice";
import {
  normalizeCountyList,
  normalizeCountyLowerList,
} from "../constants/kenyaCounties";
import { fetchPartnerById } from "./partnershipService";

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
    partnerId: "",
    partnerName: "",
    partnerStatus: "inactive",
    primaryCounty: "",
    primaryCountyLower: "",
    neighboringCounties: [],
    neighboringCountiesLower: [],
    counties: [],
    countiesLower: [],
    town: "",
    availability: "active",
    active: true,
    maxActiveRequests: 12,
    responseTimeoutMinutes: 20,
  };
}

function buildCoverageCountySet(primaryCounty = "", neighboringCounties = []) {
  return normalizeCountyList([primaryCounty, ...(neighboringCounties || [])]);
}

function assertPartnerCoversAdminCounties(partner, counties = []) {
  const safePartner = partner && typeof partner === "object" ? partner : null;
  if (!safePartner?.id) {
    throw new Error("Select a valid partner.");
  }
  if (safePartner.isActive === false) {
    throw new Error("Selected partner is inactive.");
  }

  const coverageSet = new Set(
    (Array.isArray(safePartner?.supportedCountiesLower)
      ? safePartner.supportedCountiesLower
      : Array.isArray(safePartner?.coverageCountiesLower)
      ? safePartner.coverageCountiesLower
      : []
    ).map((value) => safeStr(value).toLowerCase())
  );

  const invalidCounty = normalizeCountyList(counties).find(
    (county) => !coverageSet.has(safeStr(county).toLowerCase())
  );
  if (invalidCounty) {
    throw new Error(
      `${invalidCounty} is outside the selected partner's county coverage.`
    );
  }
}

async function resolvePartnerAssignment(partnerId, { allowInactive = false } = {}) {
  const safePartnerId = safeStr(partnerId);
  if (!safePartnerId) {
    throw new Error("Select a partner.");
  }

  const partner = await fetchPartnerById(safePartnerId);
  if (!partner) {
    throw new Error("Selected partner was not found.");
  }
  if (!allowInactive && partner.isActive === false) {
    throw new Error("Selected partner is inactive.");
  }
  return partner;
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

export async function listAssignedAdmins({ max = 100, dedupeEmail = true } = {}) {
  await requireSuperAdmin();
  const maxRows = Math.max(1, Math.min(300, Number(max) || 100));
  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("role", "in", ASSIGNED_ADMIN_ROLE_VARIANTS),
      limit(maxRows)
    )
  );
  const rows = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      uid: d.id,
      ...data,
      adminScope: normalizeAdminScope(data?.adminScope),
    };
  });
  const scoped = dedupeEmail === false ?rows : dedupeByEmail(rows);
  return scoped.sort((a, b) => {
    const emailCmp = normalizeEmail(a?.email).localeCompare(normalizeEmail(b?.email));
    if (emailCmp !== 0) return emailCmp;
    return safeStr(a?.uid).localeCompare(safeStr(b?.uid));
  });
}

export async function setAssignedAdminByEmail({
  email,
  action = "upsert",
  partnerId = "",
  primaryCounty = "",
  neighboringCounties = [],
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

  const resolvedPartner = await resolvePartnerAssignment(partnerId);
  const cleanPrimaryCounty = normalizeCountyList([
    primaryCounty || normalizeCountyList(counties)[0] || "",
  ])[0];
  if (!cleanPrimaryCounty) {
    throw new Error("Select a primary county.");
  }
  const cleanNeighboringCounties = normalizeCountyList(
    neighboringCounties?.length
      ? neighboringCounties
      : normalizeCountyList(counties).filter((county) => county !== cleanPrimaryCounty)
  ).filter((county) => county !== cleanPrimaryCounty);
  const cleanCounties = buildCoverageCountySet(cleanPrimaryCounty, cleanNeighboringCounties);
  assertPartnerCoversAdminCounties(resolvedPartner, cleanCounties);

  const scopePayload = {
    partnerId: safeStr(resolvedPartner.id),
    partnerName: safeStr(resolvedPartner.displayName),
    partnerStatus: resolvedPartner.isActive === false ? "inactive" : "active",
    primaryCounty: cleanPrimaryCounty,
    primaryCountyLower: safeStr(cleanPrimaryCounty).toLowerCase(),
    neighboringCounties: cleanNeighboringCounties,
    neighboringCountiesLower: normalizeCountyLowerList(cleanNeighboringCounties),
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
    partnerId: scopePayload.partnerId,
    partnerName: scopePayload.partnerName,
    primaryCounty: scopePayload.primaryCounty,
    neighboringCounties: scopePayload.neighboringCounties,
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

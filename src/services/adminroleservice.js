import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { isEligibleStaffProfile } from "./staffaccessservice";

export const HARDCODED_SUPER_ADMIN_EMAIL = "brioneroo@gmail.com";
export const ADMIN_SCOPE_AVAILABILITIES = new Set(["active", "busy", "offline"]);

function safeStr(value) {
  return String(value || "").trim();
}

function lower(value) {
  return safeStr(value).toLowerCase();
}

export function normalizeUserRole(role) {
  const r = lower(role);
  if (r === "superadmin" || r === "super_admin") return "superAdmin";
  if (r === "assignedadmin" || r === "assigned_admin") return "assignedAdmin";
  if (r === "admin") return "assignedAdmin"; // legacy admin compatibility
  if (r === "staff") return "staff";
  return "user";
}

export function isSuperAdminRole(role) {
  return normalizeUserRole(role) === "superAdmin";
}

export function isAssignedAdminRole(role) {
  return normalizeUserRole(role) === "assignedAdmin";
}

export function isAnyAdminRole(role) {
  const normalized = normalizeUserRole(role);
  return normalized === "superAdmin" || normalized === "assignedAdmin";
}

export function normalizeAdminAvailability(value) {
  const v = lower(value);
  return ADMIN_SCOPE_AVAILABILITIES.has(v) ? v : "active";
}

export function normalizeAdminScope(rawScope) {
  const scope = rawScope && typeof rawScope === "object" ? rawScope : {};
  const primaryCounty = safeStr(scope?.primaryCounty || scope?.county);
  const primaryCountyLower = lower(scope?.primaryCountyLower || primaryCounty);
  const neighboringCounties = Array.isArray(scope?.neighboringCounties)
    ? scope.neighboringCounties.map((v) => safeStr(v)).filter(Boolean)
    : [];
  const neighboringCountiesLower = Array.isArray(scope?.neighboringCountiesLower)
    ? scope.neighboringCountiesLower.map((v) => lower(v)).filter(Boolean)
    : [];
  const directCounties = Array.isArray(scope?.counties)
    ? scope.counties.map((v) => safeStr(v)).filter(Boolean)
    : [];
  const directCountiesLower = Array.isArray(scope?.countiesLower)
    ? scope.countiesLower.map((v) => lower(v)).filter(Boolean)
    : [];
  const mergedCounties = [
    ...(primaryCounty ? [primaryCounty] : []),
    ...neighboringCounties,
    ...directCounties,
  ].filter(Boolean);
  const mergedCountiesLower = [
    ...(primaryCountyLower ? [primaryCountyLower] : []),
    ...neighboringCountiesLower,
    ...directCountiesLower,
    ...mergedCounties.map((v) => lower(v)),
  ].filter(Boolean);
  const seenCounties = new Set();
  const counties = mergedCounties.filter((value) => {
    const key = lower(value);
    if (!key || seenCounties.has(key)) return false;
    seenCounties.add(key);
    return true;
  });
  const seenCountiesLower = new Set();
  const countiesLower = mergedCountiesLower.filter((value) => {
    const key = lower(value);
    if (!key || seenCountiesLower.has(key)) return false;
    seenCountiesLower.add(key);
    return true;
  });
  const maxActiveRequests = Number(scope?.maxActiveRequests || 0);
  const responseTimeoutMinutes = Number(scope?.responseTimeoutMinutes || 0);
  return {
    partnerId: safeStr(scope?.partnerId, 140),
    partnerName: safeStr(scope?.partnerName || scope?.partnerDisplayName, 120),
    partnerStatus: safeStr(scope?.partnerStatus || "active", 20).toLowerCase() || "active",
    primaryCounty,
    primaryCountyLower,
    neighboringCounties,
    neighboringCountiesLower,
    counties,
    countiesLower,
    town: safeStr(scope?.town),
    availability: normalizeAdminAvailability(scope?.availability),
    active: scope?.active !== false,
    maxActiveRequests: Number.isFinite(maxActiveRequests) && maxActiveRequests > 0
      ? Math.min(120, Math.max(1, Math.round(maxActiveRequests)))
      : 12,
    responseTimeoutMinutes: Number.isFinite(responseTimeoutMinutes) && responseTimeoutMinutes > 0
      ? Math.min(240, Math.max(5, Math.round(responseTimeoutMinutes)))
      : 20,
  };
}

export function resolveRoleFromUserDoc({
  role,
  email,
  adminScope = null,
  adminUpdatedBy = "",
  adminUpdatedAt = null,
  hasActiveStaffAccess = false,
}) {
  const normalizedRole = normalizeUserRole(role);
  const safeEmail = lower(email);

  // Hardcoded super admin source of truth.
  if (safeEmail && safeEmail === lower(HARDCODED_SUPER_ADMIN_EMAIL)) {
    return "superAdmin";
  }

  // Role-based super admin (stored in users/{uid}.role) for additional super admins.
  if (normalizedRole === "superAdmin") return "superAdmin";
  if (normalizedRole === "assignedAdmin") return "assignedAdmin";

  // Recovery path: if role is stale but admin scope clearly looks assigned-admin managed,
  // treat as assigned admin so access does not break.
  if (normalizedRole === "user") {
    const scope = normalizeAdminScope(adminScope);
    const hasScopeSignal = Array.isArray(scope?.counties) && scope.counties.length > 0 && scope.active !== false;
    const hasAdminAuditSignal = Boolean(safeStr(adminUpdatedBy)) || Boolean(adminUpdatedAt);
    if (hasScopeSignal && hasAdminAuditSignal) return "assignedAdmin";
  }

  if (hasActiveStaffAccess) return "staff";
  return normalizedRole;
}

export async function getCurrentUserRoleContext(uid = "") {
  const currentUid = safeStr(uid || auth.currentUser?.uid);
  const currentEmail = safeStr(auth.currentUser?.email);
  if (!currentUid) {
    return {
      uid: "",
      email: currentEmail,
      role: "user",
      roleSource: "none",
      adminScope: normalizeAdminScope({}),
      isAdmin: false,
      isSuperAdmin: false,
      isAssignedAdmin: false,
    };
  }

  const userSnap = await getDoc(doc(db, "users", currentUid));
  const userData = userSnap.exists() ? userSnap.data() || {} : {};

  let hasActiveStaffAccess = false;
  try {
    const staffSnap = await getDoc(doc(db, "staff", currentUid));
    hasActiveStaffAccess = staffSnap.exists() && isEligibleStaffProfile(staffSnap.data() || {});
  } catch {
    hasActiveStaffAccess = false;
  }

  const email = safeStr(userData?.email || currentEmail);
  const role = resolveRoleFromUserDoc({
    role: userData?.role,
    email,
    adminScope: userData?.adminScope,
    adminUpdatedBy: userData?.adminUpdatedBy,
    adminUpdatedAt: userData?.adminUpdatedAt,
    hasActiveStaffAccess,
  });

  const adminScope = normalizeAdminScope(userData?.adminScope);
  const isSuperAdmin = isSuperAdminRole(role);
  const isAssignedAdmin = isAssignedAdminRole(role);

  return {
    uid: currentUid,
    email,
    role,
    roleSource: safeStr(userData?.role) ? "userDoc" : hasActiveStaffAccess ? "staffDoc" : "fallback",
    adminScope,
    isAdmin: isSuperAdmin || isAssignedAdmin,
    isSuperAdmin,
    isAssignedAdmin,
  };
}

import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { isEligibleStaffProfile } from "./staffaccessservice";
import {
  MANAGER_STATUS_PENDING,
  managerHasModuleAccess,
  normalizeManagerModules,
} from "./managerModules";

export const ADMIN_SCOPE_AVAILABILITIES = new Set(["active", "busy", "offline"]);
export const MANAGER_SCOPE_STATUSES = new Set(["active", MANAGER_STATUS_PENDING, "inactive"]);

function safeStr(value) {
  return String(value || "").trim();
}

function lower(value) {
  return safeStr(value).toLowerCase();
}

export function normalizeUserRole(role) {
  const r = lower(role);
  if (r === "superadmin" || r === "super_admin" || r === "super-admin" || r === "super admin") {
    return "superAdmin";
  }
  if (
    r === "assignedadmin" ||
    r === "assigned_admin" ||
    r === "assigned-admin" ||
    r === "assigned admin"
  ) {
    return "assignedAdmin";
  }
  if (r === "admin") return "assignedAdmin"; // legacy admin compatibility
  if (
    r === "manager" ||
    r === "assignedmanager" ||
    r === "assigned_manager" ||
    r === "assigned-manager" ||
    r === "assigned manager"
  ) {
    return "manager";
  }
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

export function isManagerRole(role) {
  return normalizeUserRole(role) === "manager";
}

export function normalizeAdminAvailability(value) {
  const v = lower(value);
  return ADMIN_SCOPE_AVAILABILITIES.has(v) ? v : "active";
}

export function normalizeAdminScope(rawScope) {
  const scope = rawScope && typeof rawScope === "object" ? rawScope : {};
  const stationedCountry = safeStr(scope?.stationedCountry || scope?.country);
  const stationedCountryLower = lower(
    scope?.stationedCountryLower || scope?.countryLower || stationedCountry
  );
  const country = stationedCountry;
  const countryLower = stationedCountryLower;
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
    stationedCountry,
    stationedCountryLower,
    country,
    countryLower,
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

export function normalizeManagerStatus(value) {
  const safe = lower(value);
  return MANAGER_SCOPE_STATUSES.has(safe) ? safe : "active";
}

export function normalizeManagerScope(rawScope) {
  const scope = rawScope && typeof rawScope === "object" ? rawScope : {};
  return {
    name: safeStr(scope?.name || scope?.fullName || scope?.managerName),
    stationedCountry: safeStr(scope?.stationedCountry || scope?.country),
    stationedCountryLower: lower(scope?.stationedCountryLower || scope?.stationedCountry || scope?.country),
    cityTown: safeStr(scope?.cityTown || scope?.town || scope?.city),
    managerRole: safeStr(scope?.managerRole || scope?.roleLabel),
    assignedModules: normalizeManagerModules(scope?.assignedModules),
    notes: safeStr(scope?.notes, 1000),
    status: normalizeManagerStatus(scope?.status),
    inviteToken: safeStr(scope?.inviteToken, 160),
    inviteId: safeStr(scope?.inviteId, 160),
    inviteCreatedAtMs: Number(scope?.inviteCreatedAtMs || 0) || 0,
    inviteExpiresAtMs: Number(scope?.inviteExpiresAtMs || 0) || 0,
    lastLoginAtMs: Number(scope?.lastLoginAtMs || scope?.lastSeenAtMs || 0) || 0,
    updatedAtMs: Number(scope?.updatedAtMs || 0) || 0,
  };
}

export function resolveRoleFromUserDoc({
  role,
  adminScope = null,
  adminUpdatedBy = "",
  adminUpdatedAt = null,
  hasActiveStaffAccess = false,
}) {
  const normalizedRole = normalizeUserRole(role);

  // Role-based super admin source of truth (stored in users/{uid}.role).
  if (normalizedRole === "superAdmin") return "superAdmin";
  if (normalizedRole === "assignedAdmin") return "assignedAdmin";
  if (normalizedRole === "manager") return "manager";

  // Recovery path: if role is stale but admin scope clearly looks assigned-admin managed,
  // treat as assigned admin so access does not break.
  if (normalizedRole === "user") {
    const scope = normalizeAdminScope(adminScope);
    const hasScopeSignal =
      scope.active !== false &&
      Boolean(safeStr(scope?.partnerId)) &&
      (Boolean(safeStr(scope?.stationedCountry || scope?.country)) ||
        (Array.isArray(scope?.counties) && scope.counties.length > 0));
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
      managerScope: normalizeManagerScope({}),
      isAdmin: false,
      isSuperAdmin: false,
      isAssignedAdmin: false,
      isManager: false,
      hasAdminPortalAccess: false,
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
  const managerScope = normalizeManagerScope(userData?.managerScope);
  const isSuperAdmin = isSuperAdminRole(role);
  const isAssignedAdmin = isAssignedAdminRole(role);
  const isManager = isManagerRole(role);
  const hasAdminPortalAccess = isSuperAdmin || isAssignedAdmin || isManager;

  return {
    uid: currentUid,
    email,
    role,
    roleSource: safeStr(userData?.role) ? "userDoc" : hasActiveStaffAccess ? "staffDoc" : "fallback",
    adminScope,
    managerScope,
    isAdmin: isSuperAdmin || isAssignedAdmin,
    isSuperAdmin,
    isAssignedAdmin,
    isManager,
    hasAdminPortalAccess,
    canAccessManagerModule: (moduleKey = "") =>
      isSuperAdmin || (isManager && managerHasModuleAccess(managerScope, moduleKey)),
  };
}

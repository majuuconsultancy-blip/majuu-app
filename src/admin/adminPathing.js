export const ADMIN_ROUTES = Object.freeze({
  root: "/admin",
  dashboard: "/admin/dashboard",
  requests: "/admin/requests",
  notifications: "/admin/notifications",
  assignSystem: "/admin/assign-system",
  assignAdmin: "/admin/assign-system/admins/assign",
  manageAdmins: "/admin/assign-system/admins/manage",
  assignManager: "/admin/assign-system/managers/assign",
  manageManagers: "/admin/assign-system/managers/manage",
  staff: "/admin/staff",
  partnerships: "/admin/partnerships",
  countries: "/admin/countries",
  pricing: "/admin/pricing",
  finances: "/admin/finances",
  news: "/admin/news",
  selfHelp: "/admin/self-help",
  pushCampaigns: "/admin/push-campaigns",
  analytics: "/admin/analytics",
  requestManagement: "/admin/system/request-management",
  documentEngine: "/admin/system/document-engine",
  homeDesign: "/admin/system/home-design",
});

function safeString(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function safeSearch(search = "") {
  const value = safeString(search, 1200);
  if (!value) return "";
  return value.startsWith("?") ? value : `?${value}`;
}

function withSearch(pathname, search = "") {
  const safePath = safeString(pathname, 600) || ADMIN_ROUTES.requests;
  return `${safePath}${safeSearch(search)}`;
}

function decodeSegment(value) {
  const raw = safeString(value, 220);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function isAdminRoutePath(pathname = "") {
  const path = safeString(pathname, 400).toLowerCase();
  return (
    path === ADMIN_ROUTES.root ||
    path.startsWith(`${ADMIN_ROUTES.root}/`) ||
    path === "/app/admin" ||
    path.startsWith("/app/admin/")
  );
}

export function buildAdminRequestPath(requestId = "", { openChat = false } = {}) {
  const rid = safeString(requestId, 220);
  const suffix = openChat ? "?openChat=1" : "";
  if (!rid) return ADMIN_ROUTES.requests;
  return `${ADMIN_ROUTES.requests}/${encodeURIComponent(rid)}${suffix}`;
}

export function buildAdminRequestDocumentsPath(requestId = "") {
  const rid = safeString(requestId, 220);
  if (!rid) return ADMIN_ROUTES.requests;
  return `${ADMIN_ROUTES.requests}/${encodeURIComponent(rid)}/documents`;
}

export function resolveAdminLandingPath(roleCtx = null) {
  if (roleCtx?.isSuperAdmin || roleCtx?.isManager) return ADMIN_ROUTES.dashboard;
  if (roleCtx?.isAdmin) return ADMIN_ROUTES.requests;
  return "";
}

export function adminFallbackRouteForNotificationScope(scope = "") {
  const normalizedScope = safeString(scope, 80).toLowerCase();
  if (normalizedScope === "assignedadmin") return ADMIN_ROUTES.requests;
  if (normalizedScope === "admin" || normalizedScope === "manager") {
    return ADMIN_ROUTES.dashboard;
  }
  return ADMIN_ROUTES.requests;
}

export function mapLegacyAdminPath({ pathname = "", search = "" } = {}) {
  const path = safeString(pathname, 600);
  const lower = path.toLowerCase();

  const requestDocsMatch = path.match(/^\/app\/admin\/request\/([^/]+)\/documents$/i);
  if (requestDocsMatch?.[1]) {
    return withSearch(buildAdminRequestDocumentsPath(decodeSegment(requestDocsMatch[1])), search);
  }

  const requestMatch = path.match(/^\/app\/admin\/request\/([^/]+)$/i);
  if (requestMatch?.[1]) {
    return withSearch(buildAdminRequestPath(decodeSegment(requestMatch[1])), search);
  }

  if (lower === "/app/admin" || lower === "/app/admin/") {
    return withSearch(ADMIN_ROUTES.requests, search);
  }
  if (lower === "/app/admin/notifications") {
    return withSearch(ADMIN_ROUTES.notifications, search);
  }
  if (lower === "/app/admin/manage-staff") {
    return withSearch(ADMIN_ROUTES.staff, search);
  }
  if (lower === "/app/admin/assign-admin") {
    return withSearch(ADMIN_ROUTES.assignAdmin, search);
  }
  if (lower === "/app/admin/manage-admins") {
    return withSearch(ADMIN_ROUTES.manageAdmins, search);
  }
  if (lower === "/app/admin/sacc" || lower === "/app/admin/sacc/") {
    return withSearch(ADMIN_ROUTES.dashboard, search);
  }
  if (lower === "/app/admin/sacc/assign-manager") {
    return withSearch(ADMIN_ROUTES.assignManager, search);
  }
  if (lower === "/app/admin/sacc/manage-managers") {
    return withSearch(ADMIN_ROUTES.manageManagers, search);
  }
  if (lower === "/app/admin/sacc/analytics") {
    return withSearch(ADMIN_ROUTES.analytics, search);
  }
  if (lower === "/app/admin/sacc/request-management") {
    return withSearch(ADMIN_ROUTES.requestManagement, search);
  }
  if (lower === "/app/admin/sacc/document-engine") {
    return withSearch(ADMIN_ROUTES.documentEngine, search);
  }
  if (lower === "/app/admin/sacc/home-design") {
    return withSearch(ADMIN_ROUTES.homeDesign, search);
  }
  if (lower === "/app/admin/sacc/news") {
    return withSearch(ADMIN_ROUTES.news, search);
  }
  if (lower === "/app/admin/sacc/partnerships") {
    return withSearch(ADMIN_ROUTES.partnerships, search);
  }
  if (lower === "/app/admin/sacc/push-campaigns") {
    return withSearch(ADMIN_ROUTES.pushCampaigns, search);
  }
  if (lower === "/app/admin/sacc/pricing") {
    return withSearch(ADMIN_ROUTES.pricing, search);
  }
  if (lower === "/app/admin/sacc/finances") {
    return withSearch(ADMIN_ROUTES.finances, search);
  }
  if (lower === "/app/admin/sacc/selfhelp-links") {
    return withSearch(ADMIN_ROUTES.selfHelp, search);
  }
  if (lower === "/app/admin/sacc/countries") {
    return withSearch(ADMIN_ROUTES.countries, search);
  }

  return withSearch(ADMIN_ROUTES.requests, search);
}

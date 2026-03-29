export const MANAGER_STATUS_PENDING = "pending";

export const MANAGER_MODULE_CATALOG = Object.freeze([
  {
    key: "finances",
    label: "Finances",
    description: "Payment controls, payout review, and finance settings.",
    saccPath: "/app/admin/sacc/finances",
  },
  {
    key: "news",
    label: "News",
    description: "News and discovery publication management.",
    saccPath: "/app/admin/sacc/news",
  },
  {
    key: "request-management",
    label: "Requests",
    description: "Request definitions and request module structure.",
    saccPath: "/app/admin/sacc/request-management",
  },
  {
    key: "selfhelp-links",
    label: "Affiliates",
    description: "Affiliate/self-help link resources and partner links.",
    saccPath: "/app/admin/sacc/selfhelp-links",
  },
]);

const MODULE_KEY_SET = new Set(MANAGER_MODULE_CATALOG.map((module) => module.key));

const MODULE_KEY_ALIASES = new Map(
  Object.entries({
    finance: "finances",
    finances: "finances",
    payments: "finances",
    payouts: "finances",
    news: "news",
    discovery: "news",
    requests: "request-management",
    request: "request-management",
    request_management: "request-management",
    "request-management": "request-management",
    affiliates: "selfhelp-links",
    affiliate: "selfhelp-links",
    selfhelp: "selfhelp-links",
    self_help: "selfhelp-links",
    "selfhelp-links": "selfhelp-links",
    selfhelplinks: "selfhelp-links",
  })
);

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export function normalizeManagerModuleKey(value) {
  const raw = safeString(value, 80).toLowerCase();
  if (!raw) return "";
  const aliasResolved = MODULE_KEY_ALIASES.get(raw) || raw;
  return MODULE_KEY_SET.has(aliasResolved) ? aliasResolved : "";
}

export function normalizeManagerModules(values = [], { max = 12 } = {}) {
  const rows = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];

  rows.forEach((value) => {
    const key = normalizeManagerModuleKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });

  return out.slice(0, Math.max(1, Number(max) || 12));
}

export function getManagerModuleMeta(moduleKey) {
  const safeKey = normalizeManagerModuleKey(moduleKey);
  return MANAGER_MODULE_CATALOG.find((module) => module.key === safeKey) || null;
}

export function managerHasModuleAccess(managerScope = {}, moduleKey = "") {
  const safeKey = normalizeManagerModuleKey(moduleKey);
  if (!safeKey) return false;
  const assigned = normalizeManagerModules(managerScope?.assignedModules || []);
  return assigned.includes(safeKey);
}

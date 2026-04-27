import {
  BarChart3,
  BellRing,
  Coins,
  Database,
  FileText,
  Globe2,
  ImagePlus,
  Link2,
  Newspaper,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";

import { managerHasModuleAccess } from "../services/managerModules";
import { ADMIN_ROUTES } from "./adminPathing";

export const ADMIN_NAV_ITEMS = Object.freeze([
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Executive overview, quick access, and platform health.",
    path: ADMIN_ROUTES.dashboard,
    icon: Settings2,
    access: "adminPortal",
    sidebar: true,
  },
  {
    key: "requests",
    label: "Requests",
    description: "Request queue, search, filters, and moderation flow.",
    path: ADMIN_ROUTES.requests,
    icon: FileText,
    access: "adminOnly",
    sidebar: true,
  },
  {
    key: "assign-system",
    label: "Assign System",
    description: "Assigned admin bindings and manager assignment controls.",
    path: ADMIN_ROUTES.assignSystem,
    icon: Users,
    access: "superAdminOnly",
    sidebar: true,
  },
  {
    key: "partnerships",
    label: "Partnerships",
    description: "Partner onboarding, coverage, and operational bindings.",
    path: ADMIN_ROUTES.partnerships,
    icon: Link2,
    access: "superAdminOnly",
    sidebar: true,
  },
  {
    key: "countries",
    label: "Country Management",
    description: "Destination countries, routing context, and live country data.",
    path: ADMIN_ROUTES.countries,
    icon: Globe2,
    access: "superAdminOnly",
    sidebar: true,
  },
  {
    key: "pricing",
    label: "Pricing Controls",
    description: "Pricing logic, request prices, and package pricing.",
    path: ADMIN_ROUTES.pricing,
    icon: Coins,
    access: "superAdminOnly",
    sidebar: true,
  },
  {
    key: "finances",
    label: "Finances",
    description: "Payouts, refunds, held funds, and finance controls.",
    path: ADMIN_ROUTES.finances,
    icon: ShieldCheck,
    access: "managerModule:finances",
    sidebar: true,
  },
  {
    key: "news",
    label: "News & Discovery",
    description: "Discovery publication and news management.",
    path: ADMIN_ROUTES.news,
    icon: Newspaper,
    access: "managerModule:news",
    sidebar: true,
  },
  {
    key: "self-help",
    label: "Self-Help / Affiliate",
    description: "Affiliate resources and self-help outbound links.",
    path: ADMIN_ROUTES.selfHelp,
    icon: Link2,
    access: "managerModule:selfhelp-links",
    sidebar: true,
  },
  {
    key: "push-campaigns",
    label: "Push Campaign",
    description: "Push subscriptions, quotas, and campaign controls.",
    path: ADMIN_ROUTES.pushCampaigns,
    icon: BellRing,
    access: "superAdminOnly",
    sidebar: true,
  },
  {
    key: "analytics",
    label: "Analytics",
    description: "Demand, usage, funnel, and operating metrics.",
    path: ADMIN_ROUTES.analytics,
    icon: BarChart3,
    access: "superAdminOnly",
    sidebar: true,
  },
  {
    key: "request-management",
    label: "Request Management",
    description: "Request definitions, structure, and submission controls.",
    path: ADMIN_ROUTES.requestManagement,
    icon: FileText,
    access: "managerModule:request-management",
    sidebar: false,
  },
  {
    key: "document-engine",
    label: "Document Engine",
    description: "Unified document mode and document system operations.",
    path: ADMIN_ROUTES.documentEngine,
    icon: Database,
    access: "superAdminOnly",
    sidebar: false,
  },
  {
    key: "home-design",
    label: "Home Design",
    description: "Home screen content and presentation controls.",
    path: ADMIN_ROUTES.homeDesign,
    icon: ImagePlus,
    access: "superAdminOnly",
    sidebar: false,
  },
  {
    key: "staff",
    label: "Staff Management",
    description: "Operational staff access and assignment support.",
    path: ADMIN_ROUTES.staff,
    icon: Users,
    access: "adminOnly",
    sidebar: false,
  },
]);

function normalizePath(pathname = "") {
  return String(pathname || "").trim().toLowerCase();
}

function hasAccess(item, roleCtx = null) {
  if (!item || !roleCtx) return false;

  const access = String(item.access || "").trim();
  if (access === "adminPortal") {
    return Boolean(roleCtx?.hasAdminPortalAccess);
  }
  if (access === "adminOnly") {
    return Boolean(roleCtx?.isAdmin);
  }
  if (access === "superAdminOnly") {
    return Boolean(roleCtx?.isSuperAdmin);
  }
  if (access.startsWith("managerModule:")) {
    const moduleKey = access.split(":")[1] || "";
    return (
      Boolean(roleCtx?.isSuperAdmin) ||
      (Boolean(roleCtx?.isManager) &&
        managerHasModuleAccess(roleCtx?.managerScope, moduleKey))
    );
  }

  return false;
}

export function getVisibleAdminNav(roleCtx = null) {
  return ADMIN_NAV_ITEMS.filter((item) => hasAccess(item, roleCtx));
}

export function getVisibleSidebarAdminNav(roleCtx = null) {
  return getVisibleAdminNav(roleCtx).filter((item) => item.sidebar !== false);
}

export function findAdminNavItemByPath(pathname = "", roleCtx = null) {
  const path = normalizePath(pathname);
  const rows = roleCtx ? getVisibleAdminNav(roleCtx) : ADMIN_NAV_ITEMS;
  return (
    rows.find((item) => {
      const itemPath = normalizePath(item.path);
      return path === itemPath || path.startsWith(`${itemPath}/`);
    }) || null
  );
}

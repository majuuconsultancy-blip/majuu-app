import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Coins,
  FileText,
  Globe2,
  ImagePlus,
  Link2,
  Newspaper,
  Settings2,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  MANAGER_MODULE_CATALOG,
  managerHasModuleAccess,
} from "../services/managerModules";
import { smartBack } from "../utils/navBack";

const SACC_MODULES = [
  {
    key: "partnerships",
    title: "Partnerships",
    description: "Manage partner onboarding and operational coverage.",
    path: "/app/admin/sacc/partnerships",
    icon: Link2,
    group: "onboarding",
  },
  {
    key: "finances",
    title: "Finances",
    description: "Manage payment operations, payouts, and records.",
    path: "/app/admin/sacc/finances",
    icon: ShieldCheck,
    group: "finances",
  },
  {
    key: "countries",
    title: "Country Management",
    description: "Manage live destination countries and routing context.",
    path: "/app/admin/sacc/countries",
    icon: Globe2,
    group: "onboarding",
  },
  {
    key: "request-management",
    title: "Request Management",
    description: "Configure request structure, fields, and submission behavior.",
    path: "/app/admin/sacc/request-management",
    icon: FileText,
    group: "request-operations",
  },
  {
    key: "pricing",
    title: "Pricing Controls",
    description: "Control request and package pricing logic.",
    path: "/app/admin/sacc/pricing",
    icon: Coins,
    group: "finances",
  },
  {
    key: "analytics",
    title: "Analytics",
    description: "Monitor demand, usage trends, and performance outcomes.",
    path: "/app/admin/sacc/analytics",
    icon: BarChart3,
    group: "analytics",
  },
  {
    key: "home-design",
    title: "Home Design",
    description: "Manage home screen layout content and presentation.",
    path: "/app/admin/sacc/home-design",
    icon: ImagePlus,
    group: "content-design",
  },
  {
    key: "news",
    title: "News & Discovery Publication",
    description: "Publish migration news and track-country discovery content.",
    path: "/app/admin/sacc/news",
    icon: Newspaper,
    group: "content-design",
  },
  {
    key: "selfhelp-links",
    title: "Affiliate Management",
    description: "Manage affiliate and self-help outbound link resources.",
    path: "/app/admin/sacc/selfhelp-links",
    icon: Link2,
    group: "content-design",
  },
];

const MODULE_GROUPS = [
  { key: "all", label: "All" },
  { key: "onboarding", label: "Onboarding" },
  { key: "finances", label: "Finances" },
  { key: "request-operations", label: "Request Ops" },
  { key: "analytics", label: "Analytics" },
  { key: "content-design", label: "Content / Design" },
];

function ManagerAccessPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const shell =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/65 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition dark:border-zinc-800 dark:bg-zinc-900/40";
  const headerBtn =
    "w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition active:scale-[0.99]";
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const assignBtn = "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const manageBtn =
    "border border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900/90";

  return (
    <div className="mt-5">
      <div className={shell}>
        <button type="button" onClick={() => setOpen((value) => !value)} className={headerBtn}>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Manager Assignment & Management
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Assign managers and control module access with invite links.
            </div>
          </div>
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition ${
              open ? "rotate-180" : "rotate-0"
            }`}
          >
            <AppIcon size={ICON_MD} icon={ChevronDown} />
          </span>
        </button>

        <div
          className={`grid transition-all duration-300 ease-out ${
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => navigate("/app/admin/sacc/assign-manager")}
                  className={`${btnBase} ${assignBtn}`}
                >
                  <AppIcon size={ICON_MD} icon={UserPlus} />
                  Assign Manager
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/app/admin/sacc/manage-managers")}
                  className={`${btnBase} ${manageBtn}`}
                >
                  <AppIcon size={ICON_MD} icon={Users} />
                  Manage Managers
                </button>
              </div>
              <div className="mt-3 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/85 via-white to-emerald-50/65 px-3.5 py-2 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                Invite links are single-use and can expire after 24 hours.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminSaccScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [roleCtx, setRoleCtx] = useState(null);
  const [moduleGroup, setModuleGroup] = useState("all");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setRoleCtx(ctx || null);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setRoleCtx(null);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const isSuperAdmin = Boolean(roleCtx?.isSuperAdmin);
  const isManager = Boolean(roleCtx?.isManager);
  const managerModuleSet = useMemo(() => {
    if (!isManager) return new Set();
    return new Set(
      (roleCtx?.managerScope?.assignedModules || []).map((moduleKey) => String(moduleKey || "").trim())
    );
  }, [isManager, roleCtx?.managerScope?.assignedModules]);
  const managerEligibleSet = useMemo(
    () => new Set(MANAGER_MODULE_CATALOG.map((module) => module.key)),
    []
  );

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const visibleByRole = useMemo(() => {
    if (isSuperAdmin) return SACC_MODULES;
    if (!isManager) return [];
    return SACC_MODULES.filter(
      (module) =>
        managerEligibleSet.has(module.key) &&
        managerModuleSet.has(module.key) &&
        managerHasModuleAccess(roleCtx?.managerScope, module.key)
    );
  }, [isManager, isSuperAdmin, managerEligibleSet, managerModuleSet, roleCtx?.managerScope]);
  const visibleModules = useMemo(() => {
    if (moduleGroup === "all") return visibleByRole;
    return visibleByRole.filter((module) => module.group === moduleGroup);
  }, [moduleGroup, visibleByRole]);
  const availableGroups = useMemo(() => {
    if (isSuperAdmin) return MODULE_GROUPS;
    const set = new Set(visibleByRole.map((module) => module.group));
    return MODULE_GROUPS.filter((group) => group.key === "all" || set.has(group.key));
  }, [isSuperAdmin, visibleByRole]);

  return (
    <div className={pageBg}>
      <div className="app-page-shell app-page-shell--medium">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Settings2} size={ICON_SM} />
              SACC
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Super Admin Control Center
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {isManager
                ? "Your access is limited to assigned manager modules."
                : "Access operational modules by function."}
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            aria-label="Back"
            title="Back"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin && !isManager ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            You do not have SACC access.
          </div>
        ) : (
          <>
            {isSuperAdmin ? <ManagerAccessPanel /> : null}

            <div className={`mt-5 ${card} p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Control Modules
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {visibleModules.length} of {visibleByRole.length} visible modules
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableGroups.map((group) => {
                    const active = moduleGroup === group.key;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => setModuleGroup(group.key)}
                        className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                          active
                            ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                            : "border-zinc-200 bg-white/80 text-zinc-600 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                        }`}
                      >
                        {group.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {isManager ? (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-white to-emerald-50/60 px-4 py-3 text-xs text-emerald-800 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200">
                Assigned modules are editable by Super Admin and become available to you instantly.
              </div>
            ) : null}

            {visibleModules.length === 0 ? (
              <div className={`mt-4 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                {isManager
                  ? "No manager modules assigned yet."
                  : "No modules available for this filter."}
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {visibleModules.map((module) => (
                  <button
                    key={module.key}
                    type="button"
                    onClick={() => navigate(module.path)}
                    className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                        <AppIcon icon={module.icon} size={ICON_MD} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {module.title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                          {module.description}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {MODULE_GROUPS.find((group) => group.key === module.group)?.label || "General"}
                        </div>
                      </div>

                      <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

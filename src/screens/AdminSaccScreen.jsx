import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BellRing,
  ChevronDown,
  ChevronRight,
  Coins,
  Database,
  FileText,
  Globe2,
  ImagePlus,
  Link2,
  Newspaper,
  RefreshCw,
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
import { loadSaccExecutiveDashboardSnapshot } from "../services/saccDashboardService";
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
    key: "push-campaigns",
    title: "Push Campaigns",
    description: "Manage partner push subscriptions, quotas, and campaigns.",
    path: "/app/admin/sacc/push-campaigns",
    icon: BellRing,
    group: "content-design",
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
    key: "document-engine",
    title: "Document Engine Ops",
    description: "Control unified document mode, parity checks, and cutover safety.",
    path: "/app/admin/sacc/document-engine",
    icon: Database,
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

function formatNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : "0";
}

function formatMoney(value, currency = "KES") {
  const n = Math.max(0, Number(value || 0));
  return `${String(currency || "KES").toUpperCase()} ${Math.round(n).toLocaleString()}`;
}

function percent(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n)}%`;
}

function moduleGroupLabel(key) {
  return MODULE_GROUPS.find((group) => group.key === key)?.label || "General";
}

function DonutTrackChart({ rows = [] }) {
  const total = rows.reduce((acc, row) => acc + Number(row?.value || 0), 0);
  const normalized = rows.map((row) => ({
    ...row,
    value: Math.max(0, Number(row?.value || 0)),
  }));
  const segments = [];
  let offset = 0;
  normalized.forEach((row) => {
    const ratio = total > 0 ? row.value / total : 0;
    const from = Math.round(offset * 360);
    const to = Math.round((offset + ratio) * 360);
    segments.push({
      ...row,
      from,
      to,
    });
    offset += ratio;
  });
  const palette = ["#0f766e", "#15803d", "#65a30d", "#84cc16"];
  const gradient =
    segments.length === 0
      ? "conic-gradient(#dcfce7 0deg 360deg)"
      : `conic-gradient(${segments
          .map((segment, index) => `${palette[index % palette.length]} ${segment.from}deg ${segment.to}deg`)
          .join(", ")})`;

  return (
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
      <div className="mx-auto h-40 w-40 rounded-full border border-emerald-100 bg-emerald-50/60 p-4">
        <div
          className="h-full w-full rounded-full"
          style={{
            background: gradient,
          }}
        >
          <div className="mx-auto mt-[34px] h-16 w-16 rounded-full bg-white/95 text-center text-xs font-semibold text-zinc-700 shadow-sm">
            <div className="pt-3">Total</div>
            <div>{formatNumber(total)}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {normalized.map((row, index) => (
          <div key={row.track} className="rounded-xl border border-zinc-200 bg-white/85 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900/70">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">{String(row.track || "Track")}</div>
              <div className="text-zinc-600 dark:text-zinc-300">{formatNumber(row.value)}</div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-1.5 rounded-full"
                style={{
                  width: `${total > 0 ? Math.max(4, Math.round((row.value / total) * 100)) : 0}%`,
                  backgroundColor: ["#0f766e", "#15803d", "#65a30d", "#84cc16"][index % 4],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleBars({ rows = [], valueKey = "value", labelKey = "label", tone = "emerald" }) {
  const maxValue = rows.reduce((acc, row) => Math.max(acc, Number(row?.[valueKey] || 0)), 0);
  const barClass =
    tone === "mint"
      ? "from-emerald-400 to-lime-400"
      : tone === "forest"
      ? "from-emerald-600 to-green-700"
      : "from-emerald-500 to-teal-500";

  return (
    <div className="grid gap-2">
      {rows.map((row, index) => {
        const value = Number(row?.[valueKey] || 0);
        const width = maxValue > 0 ? Math.max(6, Math.round((value / maxValue) * 100)) : 0;
        return (
          <div key={`${row?.[labelKey] || index}`} className="rounded-xl border border-zinc-200 bg-white/85 p-2.5 dark:border-zinc-700 dark:bg-zinc-900/70">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div className="truncate font-medium text-zinc-800 dark:text-zinc-100">{String(row?.[labelKey] || "-")}</div>
              <div className="text-zinc-600 dark:text-zinc-300">{formatNumber(value)}</div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={`h-1.5 rounded-full bg-gradient-to-r ${barClass}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
    <div className="mt-4">
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
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboard, setDashboard] = useState(null);

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

  const refreshDashboard = useCallback(async () => {
    if (!isSuperAdmin) return;
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const snapshot = await loadSaccExecutiveDashboardSnapshot({
        partnerLimit: 8,
        countryLimit: 8,
        revenueMonths: 6,
      });
      setDashboard(snapshot || null);
    } catch (error) {
      console.error(error);
      setDashboard(null);
      setDashboardError(error?.message || "Failed to load dashboard metrics.");
    } finally {
      setDashboardLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void refreshDashboard();
  }, [isSuperAdmin, refreshDashboard]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-[#f3fff5] via-white to-[#f9fff8] dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/65 shadow-sm backdrop-blur";

  const kpis = dashboard?.kpis || {};
  const funnel = dashboard?.funnel || {};
  const revenueTrend = Array.isArray(dashboard?.revenueTrend) ? dashboard.revenueTrend : [];
  const tracks = Array.isArray(dashboard?.trackDistribution) ? dashboard.trackDistribution : [];
  const countries = Array.isArray(dashboard?.countryDemand) ? dashboard.countryDemand : [];
  const partnerRanking = Array.isArray(dashboard?.partnerRanking) ? dashboard.partnerRanking : [];
  const refundMetrics = dashboard?.refundMetrics || {};
  const sla = dashboard?.sla || {};

  const funnelRows = [
    { label: "Signups", value: funnel.signups || 0 },
    { label: "Profile Complete", value: funnel.profileComplete || 0 },
    { label: "Journey Setup", value: funnel.journeySetup || 0 },
    { label: "WeHelp Opens", value: funnel.weHelpOpens || 0 },
    { label: "Request Sent", value: funnel.requestSent || 0 },
    { label: "In Progress", value: funnel.inProgress || 0 },
    { label: "Completed", value: funnel.completed || 0 },
  ];

  if (checkingRole) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className={`${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Checking access...</div>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin && !isManager) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            You do not have SACC access.
          </div>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin && isManager) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                <AppIcon icon={Settings2} size={ICON_SM} />
                SACC
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Manager Control Center
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Your access is limited to assigned manager modules.
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

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {visibleModules.map((module) => (
              <button
                key={module.key}
                type="button"
                onClick={() => navigate(module.path)}
                className={`${card} p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/60 dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={module.icon} size={ICON_MD} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{module.title}</div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{module.description}</div>
                  </div>
                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>
            ))}
            {visibleModules.length === 0 ? (
              <div className={`${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                No manager modules assigned yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={pageBg}>
      <div className="mx-auto max-w-[1400px] px-5 py-6">
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
              {isManager && !isSuperAdmin
                ? "Your access is limited to assigned manager modules."
                : "Investor-grade operations dashboard with partner, finance, and routing visibility."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isSuperAdmin ? (
              <button
                type="button"
                onClick={() => void refreshDashboard()}
                disabled={dashboardLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
              >
                <AppIcon icon={RefreshCw} size={ICON_MD} className={dashboardLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            ) : null}
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
        </div>

        {dashboardError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            {dashboardError}
          </div>
        ) : null}

        {isSuperAdmin ? <ManagerAccessPanel /> : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className={`${card} h-fit p-4 xl:sticky xl:top-4`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Modules</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {visibleModules.length} of {visibleByRole.length} visible
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
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

            <div className="mt-3 grid gap-2">
              {visibleModules.map((module) => (
                <button
                  key={module.key}
                  type="button"
                  onClick={() => navigate(module.path)}
                  className="rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/70 dark:border-zinc-700 dark:bg-zinc-900/75 dark:hover:bg-zinc-900"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      <AppIcon icon={module.icon} size={ICON_SM} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{module.title}</div>
                      <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{moduleGroupLabel(module.group)}</div>
                    </div>
                    <AppIcon icon={ChevronRight} size={ICON_SM} className="text-zinc-400" />
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Total Users</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(kpis.totalUsers)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Monthly Active Users</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(kpis.monthlyActiveUsers)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Total Revenue</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatMoney(kpis.totalRevenue)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Escrow Held Balance</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatMoney(kpis.escrowHeldBalance)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Released Payouts</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatMoney(kpis.releasedPayouts)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Refunded Amount</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatMoney(kpis.refundedAmount)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Active Requests</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(kpis.activeRequests)}</div>
              </div>
              <div className={`${card} p-4`}>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Requests In Progress</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(kpis.requestsInProgress)}</div>
              </div>
            </div>

            <div className="grid gap-4 2xl:grid-cols-2">
              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <AppIcon icon={Activity} size={ICON_SM} />
                  Request Funnel
                </div>
                <div className="mt-3">
                  <SimpleBars
                    rows={funnelRows.map((row) => ({ label: row.label, value: row.value }))}
                    valueKey="value"
                    labelKey="label"
                    tone="forest"
                  />
                </div>
              </div>

              <div className={`${card} p-4`}>
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  <AppIcon icon={BarChart3} size={ICON_SM} />
                  Revenue Trend
                </div>
                <div className="mt-3">
                  <SimpleBars
                    rows={revenueTrend.map((row) => ({ label: row.label, amount: row.amount }))}
                    valueKey="amount"
                    labelKey="label"
                    tone="emerald"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 2xl:grid-cols-3">
              <div className={`${card} p-4`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Track Distribution</div>
                <div className="mt-3">
                  <DonutTrackChart rows={tracks.map((row) => ({ track: String(row?.track || "").toUpperCase(), value: row?.value || 0 }))} />
                </div>
              </div>

              <div className={`${card} p-4`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Country Demand</div>
                <div className="mt-3">
                  <SimpleBars
                    rows={countries.map((row) => ({ label: row.country, totalTaps: row.totalTaps }))}
                    valueKey="totalTaps"
                    labelKey="label"
                    tone="mint"
                  />
                </div>
              </div>

              <div className={`${card} p-4`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Partner Performance Ranking</div>
                <div className="mt-3 grid gap-2">
                  {partnerRanking.map((row) => (
                    <div key={row.partnerId} className="rounded-xl border border-zinc-200 bg-white/85 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {row.rank}. {row.partnerName}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{formatNumber(row.payoutCount)} payouts</div>
                      </div>
                      <div className="mt-1 text-sm text-emerald-700 dark:text-emerald-200">
                        {formatMoney(row.totalReleased)}
                      </div>
                    </div>
                  ))}
                  {partnerRanking.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-200 bg-white/70 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
                      No partner payout performance data yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className={`${card} p-4`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Refund Metrics</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Refund Rate</div>
                    <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{percent(refundMetrics.refundRate)}</div>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Auto Refund Rate</div>
                    <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{percent(refundMetrics.autoRefundRate)}</div>
                  </div>
                </div>
              </div>

              <div className={`${card} p-4`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">SLA: Avg Time To In Progress</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Average Minutes</div>
                    <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{formatNumber(sla.avgMinutesToInProgress)}</div>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="text-xs uppercase tracking-[0.12em] text-zinc-500">Under 24h</div>
                    <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{percent(sla.under24hRate)}</div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

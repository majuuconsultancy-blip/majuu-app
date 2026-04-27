import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  Activity,
  BarChart3,
  ChevronRight,
  CircleAlert,
  Globe2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { loadSaccExecutiveDashboardSnapshot } from "../services/saccDashboardService";
import { getVisibleAdminNav } from "./adminNavigation";

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
  return Number.isFinite(n) ? `${Math.round(n)}%` : "0%";
}

function StatCard({ label, value, tone = "emerald" }) {
  const accent = tone === "sky"
    ? "from-sky-50 to-white text-sky-800 dark:from-sky-950/25 dark:to-zinc-950 dark:text-sky-100"
    : tone === "amber"
    ? "from-amber-50 to-white text-amber-800 dark:from-amber-950/25 dark:to-zinc-950 dark:text-amber-100"
    : "from-emerald-50 to-white text-emerald-800 dark:from-emerald-950/25 dark:to-zinc-950 dark:text-emerald-100";

  return (
    <div className={`rounded-[1.75rem] border border-zinc-200 bg-gradient-to-br ${accent} p-5 shadow-sm dark:border-zinc-800`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}

function ActionCard({ item, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-[1.75rem] border border-zinc-200 bg-white/84 p-4 text-left shadow-sm backdrop-blur transition hover:-translate-y-[1px] hover:border-emerald-200 hover:bg-white active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-950/55 dark:hover:border-emerald-900/40 dark:hover:bg-zinc-950/70"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
          <AppIcon icon={item.icon} size={ICON_MD} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {item.label}
          </span>
          <span className="mt-1 block truncate text-sm text-zinc-600 dark:text-zinc-300">
            {item.description}
          </span>
        </span>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-300">
          <AppIcon icon={ChevronRight} size={ICON_MD} />
        </span>
      </div>
    </button>
  );
}

export default function AdminDashboardScreen() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const roleCtx = outletContext?.roleCtx || null;
  const [dashboard, setDashboard] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState("");

  const visibleNav = useMemo(() => getVisibleAdminNav(roleCtx), [roleCtx]);
  const quickAccessItems = useMemo(
    () => visibleNav.filter((item) => item.key !== "dashboard"),
    [visibleNav]
  );

  const refreshDashboard = useCallback(async () => {
    if (!roleCtx?.isSuperAdmin) return;
    setLoadingDashboard(true);
    setDashboardError("");
    try {
      const snapshot = await loadSaccExecutiveDashboardSnapshot({
        partnerLimit: 6,
        countryLimit: 6,
        revenueMonths: 6,
      });
      setDashboard(snapshot || null);
    } catch (error) {
      console.error(error);
      setDashboard(null);
      setDashboardError(error?.message || "Failed to load dashboard metrics.");
    } finally {
      setLoadingDashboard(false);
    }
  }, [roleCtx?.isSuperAdmin]);

  useEffect(() => {
    if (!roleCtx?.isSuperAdmin) return;
    void refreshDashboard();
  }, [refreshDashboard, roleCtx?.isSuperAdmin]);

  const topCountries = Array.isArray(dashboard?.countryDemand)
    ? dashboard.countryDemand.slice(0, 5)
    : [];
  const topPartners = Array.isArray(dashboard?.partnerRanking)
    ? dashboard.partnerRanking.slice(0, 4)
    : [];

  const roleBanner = roleCtx?.isSuperAdmin
    ? "Super admin desktop workspace with direct access to platform-wide controls."
    : roleCtx?.isManager
    ? "Manager dashboard with module-scoped quick access and oversight."
    : roleCtx?.isAssignedAdmin
    ? "Assigned admin workspace focused on request operations and follow-through."
    : "Admin workspace.";
  const dashboardTitle = roleCtx?.isSuperAdmin
    ? "Super Admin Control Center"
    : roleCtx?.isManager
    ? "Manager Control Center"
    : "Admin Control Center";

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <section className="rounded-[2rem] border border-zinc-200 bg-white/86 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={ShieldCheck} size={ICON_SM} />
              Dashboard
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {dashboardTitle}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
              {roleBanner}
            </p>
          </div>

          {roleCtx?.isSuperAdmin ? (
            <button
              type="button"
              onClick={() => void refreshDashboard()}
              disabled={loadingDashboard}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white/92 px-4 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/85 dark:text-zinc-100"
            >
              <AppIcon
                icon={RefreshCw}
                size={ICON_MD}
                className={loadingDashboard ? "animate-spin" : ""}
              />
              Refresh metrics
            </button>
          ) : null}
        </div>
      </section>

      {dashboardError ? (
        <div className="rounded-[1.75rem] border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
          {dashboardError}
        </div>
      ) : null}

      {roleCtx?.isSuperAdmin ? (
        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <StatCard label="Total Users" value={formatNumber(dashboard?.kpis?.totalUsers)} />
          <StatCard
            label="Active Requests"
            value={formatNumber(dashboard?.kpis?.activeRequests)}
            tone="sky"
          />
          <StatCard
            label="Total Revenue"
            value={formatMoney(dashboard?.kpis?.totalRevenue)}
          />
          <StatCard
            label="Auto Refund Rate"
            value={percent(dashboard?.refundMetrics?.autoRefundRate)}
            tone="amber"
          />
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Accessible Modules"
            value={formatNumber(quickAccessItems.length)}
            tone="sky"
          />
          <StatCard label="Workspace" value="Admin Portal" />
          <StatCard label="Notifications" value="Global top bar" tone="amber" />
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="rounded-[2rem] border border-zinc-200 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
          <div className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            <AppIcon icon={Activity} size={ICON_SM} />
            Quick Access
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Jump straight into the areas you can actively manage from the new admin shell.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {quickAccessItems.map((item) => (
              <ActionCard key={item.key} item={item} onClick={() => navigate(item.path)} />
            ))}
            {quickAccessItems.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-zinc-200 bg-white/75 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-400">
                No admin modules are available for this account yet.
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[2rem] border border-zinc-200 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
            <div className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <AppIcon icon={BarChart3} size={ICON_SM} />
              Snapshot
            </div>
            <div className="mt-4 grid gap-3">
              <div className="rounded-[1.5rem] border border-zinc-200 bg-white/88 p-4 dark:border-zinc-700 dark:bg-zinc-900/70">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                  Funnel
                </div>
                <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Request sent: {formatNumber(dashboard?.funnel?.requestSent)}
                </div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  In progress: {formatNumber(dashboard?.funnel?.inProgress)}
                </div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Completed: {formatNumber(dashboard?.funnel?.completed)}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-zinc-200 bg-white/88 p-4 dark:border-zinc-700 dark:bg-zinc-900/70">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                  SLA
                </div>
                <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Avg minutes to in progress: {formatNumber(dashboard?.sla?.avgMinutesToInProgress)}
                </div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Under 24h rate: {percent(dashboard?.sla?.under24hRate)}
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-zinc-200 bg-white/88 p-4 dark:border-zinc-700 dark:bg-zinc-900/70">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                  <AppIcon icon={CircleAlert} size={ICON_SM} />
                  Routing Watch
                </div>
                <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Requests in progress: {formatNumber(dashboard?.kpis?.requestsInProgress)}
                </div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Escrow held balance: {formatMoney(dashboard?.kpis?.escrowHeldBalance)}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-zinc-200 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
            <div className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <AppIcon icon={Globe2} size={ICON_SM} />
              Live Demand
            </div>
            <div className="mt-4 grid gap-3">
              {topCountries.map((row) => (
                <div
                  key={String(row?.country || "")}
                  className="rounded-[1.35rem] border border-zinc-200 bg-white/88 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {String(row?.country || "Unknown")}
                    </div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">
                      {formatNumber(row?.totalTaps)}
                    </div>
                  </div>
                </div>
              ))}
              {!topCountries.length ? (
                <div className="rounded-[1.35rem] border border-dashed border-zinc-200 bg-white/75 px-4 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-400">
                  Demand data will appear here once enough discovery activity is collected.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {roleCtx?.isSuperAdmin ? (
        <section className="rounded-[2rem] border border-zinc-200 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Top partner performance
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {topPartners.map((row) => (
              <div
                key={String(row?.partnerId || "")}
                className="rounded-[1.5rem] border border-zinc-200 bg-white/88 px-4 py-4 dark:border-zinc-700 dark:bg-zinc-900/70"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {String(row?.rank || "-")}. {String(row?.partnerName || "Partner")}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Released payouts: {formatNumber(row?.payoutCount)}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">
                    {formatMoney(row?.totalReleased)}
                  </div>
                </div>
              </div>
            ))}
            {!topPartners.length ? (
              <div className="rounded-[1.5rem] border border-dashed border-zinc-200 bg-white/75 px-4 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-400">
                Partner payout metrics will appear here once released payouts are available.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

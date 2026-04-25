import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { loadSaccAnalyticsSnapshot } from "../services/analyticsAdminService";
import {
  formatPaymentDropoffPhone,
  loadPaymentDropoffAnalytics,
  paymentDropoffStepLabel,
} from "../services/paymentDropoffAnalyticsService";
import { smartBack } from "../utils/navBack";

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value) {
  return `KES ${safeNumber(value).toLocaleString()}`;
}

function formatTimestamp(value) {
  const safeValue = safeNumber(value);
  if (!safeValue) return "--";
  try {
    return new Date(safeValue).toLocaleString();
  } catch {
    return "--";
  }
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="text-sm text-zinc-600 dark:text-zinc-300">{label}</div>
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {safeNumber(value).toLocaleString()}
      </div>
    </div>
  );
}

function TopRow({ index, title, subtitle, valueLabel }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white/80 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
            {index}
          </span>
          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </div>
        </div>
        {subtitle ? (
          <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</div>
        ) : null}
      </div>
      <div className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
        {valueLabel}
      </div>
    </div>
  );
}

export default function AdminAnalyticsScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [paymentDropoffs, setPaymentDropoffs] = useState([]);
  const [refreshedAtMs, setRefreshedAtMs] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setIsSuperAdmin(Boolean(roleCtx?.isSuperAdmin));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setIsSuperAdmin(false);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    setLoading(true);
    setErr("");
    try {
      const [snap, dropoffRows] = await Promise.all([
        loadSaccAnalyticsSnapshot({ topLimit: 10 }),
        loadPaymentDropoffAnalytics({ limit: 40 }),
      ]);
      setData(snap);
      setPaymentDropoffs(dropoffRows);
      setRefreshedAtMs(Date.now());
    } catch (error) {
      console.error(error);
      setData(null);
      setPaymentDropoffs([]);
      setErr(error?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    void refresh();
  }, [isSuperAdmin]);

  const counts = data?.counts || {};
  const top = data?.top || {};

  const refreshedLabel = useMemo(() => {
    if (!refreshedAtMs) return "";
    try {
      return new Date(refreshedAtMs).toLocaleString();
    } catch {
      return "";
    }
  }, [refreshedAtMs]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={BarChart3} size={ICON_SM} />
              Analytics
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Analytics
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              A lightweight operational summary for high-signal product metrics.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => smartBack(navigate, "/app/admin/sacc")}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            >
              <AppIcon icon={ArrowLeft} size={ICON_MD} />
              Back
            </button>

            {isSuperAdmin ? (
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
              >
                <AppIcon icon={RefreshCw} size={ICON_MD} className={loading ? "animate-spin" : ""} />
                Refresh
              </button>
            ) : null}
          </div>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can open SACC Analytics.
          </div>
        ) : (
          <>
            {err ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            <div className={`mt-5 ${card}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Key metrics
                </div>
                {refreshedLabel ? (
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Updated {refreshedLabel}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                <StatRow label="Total signups" value={counts.totalSignups} />
                <StatRow label="Total profile completions" value={counts.totalProfileCompletions} />
                <StatRow label="Journey setups completed" value={counts.journeySetupsCompleted} />
                <StatRow label="App launches with saved journey" value={counts.appLaunchWithSavedJourney} />
                <StatRow label="App launches without saved journey" value={counts.appLaunchWithoutSavedJourney} />
                <StatRow label="SelfHelp opens" value={counts.selfHelpOpens} />
                <StatRow label="WeHelp opens" value={counts.weHelpOpens} />
                <StatRow label="Affiliate link clicks" value={counts.affiliateLinkClicks} />
                <StatRow label="Other link clicks" value={counts.otherLinkClicks} />
                <StatRow label="Total requests sent" value={counts.requests?.total} />
                <StatRow label="Total requests accepted" value={counts.requests?.accepted} />
                <StatRow label="Total requests rejected" value={counts.requests?.rejected} />
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <div className={card}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Payment drop-off follow-up
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Sorted by most recent activity, then by intent priority.
                    </p>
                  </div>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    {paymentDropoffs.length.toLocaleString()} rows
                  </div>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200/70 text-xs uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800/70 dark:text-zinc-400">
                        <th className="px-2 py-2 font-semibold">Phone</th>
                        <th className="px-2 py-2 font-semibold">Amount</th>
                        <th className="px-2 py-2 font-semibold">Service</th>
                        <th className="px-2 py-2 font-semibold">Step</th>
                        <th className="px-2 py-2 font-semibold">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentDropoffs.map((row) => (
                        <tr
                          key={row.id || `${row.requestId}:${row.step}:${row.createdAtMs}`}
                          className="border-b border-zinc-200/60 last:border-b-0 dark:border-zinc-800/60"
                        >
                          <td className="px-2 py-3 align-top font-medium text-zinc-900 dark:text-zinc-100">
                            {formatPaymentDropoffPhone(row.phoneNumber) || "--"}
                          </td>
                          <td className="px-2 py-3 align-top text-zinc-700 dark:text-zinc-200">
                            {formatMoney(row.amount)}
                          </td>
                          <td className="px-2 py-3 align-top text-zinc-700 dark:text-zinc-200">
                            <div className="font-medium">{row.service || "--"}</div>
                            {row.requestId ? (
                              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                Request: {row.requestId}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-3 align-top">
                            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                              {paymentDropoffStepLabel(row.step)}
                            </span>
                          </td>
                          <td className="px-2 py-3 align-top text-zinc-600 dark:text-zinc-300">
                            {formatTimestamp(row.createdAtMs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!paymentDropoffs.length ? (
                    <div className="py-4 text-sm text-zinc-600 dark:text-zinc-300">
                      No payment drop-off activity yet.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={card}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Track distribution
                </div>
                <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                  <StatRow label="Study" value={counts.trackSelections?.study} />
                  <StatRow label="Work" value={counts.trackSelections?.work} />
                  <StatRow label="Travel" value={counts.trackSelections?.travel} />
                </div>
              </div>

              <div className={card}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Top tapped countries
                </div>
                <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                  {(Array.isArray(top.tappedCountries) ? top.tappedCountries : []).slice(0, 10).map((row, idx) => (
                    <TopRow
                      key={row.id || `${idx}`}
                      index={idx + 1}
                      title={row.countryDisplay || row.countryKey || row.id}
                      subtitle={row.uniqueUserCount ? `${safeNumber(row.uniqueUserCount)} unique users` : ""}
                      valueLabel={`${safeNumber(row.totalTaps)} taps`}
                    />
                  ))}
                  {!top.tappedCountries?.length ? (
                    <div className="py-3 text-sm text-zinc-600 dark:text-zinc-300">
                      No data yet.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={card}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Top unsupported custom countries
                </div>
                <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                  {(Array.isArray(top.unsupportedCountries) ? top.unsupportedCountries : []).slice(0, 10).map((row, idx) => (
                    <TopRow
                      key={row.id || `${idx}`}
                      index={idx + 1}
                      title={row.countryDisplay || row.countryKey || row.id}
                      subtitle={row.uniqueUserCount ? `${safeNumber(row.uniqueUserCount)} unique users` : ""}
                      valueLabel={`${safeNumber(row.totalSubmissions)} entries`}
                    />
                  ))}
                  {!top.unsupportedCountries?.length ? (
                    <div className="py-3 text-sm text-zinc-600 dark:text-zinc-300">
                      No data yet.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={card}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Top news routes
                </div>
                <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                  {(Array.isArray(top.newsRoutes) ? top.newsRoutes : []).slice(0, 10).map((row, idx) => (
                    <TopRow
                      key={row.id || `${idx}`}
                      index={idx + 1}
                      title={row.countryDisplay || row.countryKey || row.id}
                      subtitle={row.track ? `Track: ${row.track}` : ""}
                      valueLabel={`${safeNumber(row.totalViews)} views`}
                    />
                  ))}
                  {!top.newsRoutes?.length ? (
                    <div className="py-3 text-sm text-zinc-600 dark:text-zinc-300">
                      No data yet.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={card}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Top news countries
                </div>
                <div className="mt-3 divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                  {(Array.isArray(top.newsCountries) ? top.newsCountries : []).slice(0, 10).map((row, idx) => (
                    <TopRow
                      key={row.id || `${idx}`}
                      index={idx + 1}
                      title={row.countryDisplay || row.countryKey || row.id}
                      subtitle={row.uniqueUserCount ? `${safeNumber(row.uniqueUserCount)} unique users` : ""}
                      valueLabel={`${safeNumber(row.totalViews)} views`}
                    />
                  ))}
                  {!top.newsCountries?.length ? (
                    <div className="py-3 text-sm text-zinc-600 dark:text-zinc-300">
                      No data yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Coins,
  FileText,
  Globe2,
  Link2,
  Newspaper,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { smartBack } from "../utils/navBack";

export default function AdminSaccScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

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

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Settings2} size={ICON_SM} />
              SACC
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Super Admin Control Center
            </h1>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can open SACC.
          </div>
        ) : (
          <>
            <div className={`mt-5 ${card} p-4`}>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Control Modules
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/request-management")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={FileText} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Request Management
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Manage request definitions by title, track, country, and extra request-specific fields while leaving the current core request flow untouched.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/analytics")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={BarChart3} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Analytics
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      View high-signal product metrics like signups, journey demand, SelfHelp/WeHelp usage, top countries, and request outcomes.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/countries")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={Globe2} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Country Management
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Create, edit, activate/deactivate countries, set supported tracks, and assign currency context for downstream modules.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/partnerships")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={Link2} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Partnerships
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Onboard partners, manage status, configure track and geographic coverage, and feed admin partner binding plus preferred-agent routing.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/pricing")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={Coins} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Pricing Controls
                      </div>
                      <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                        Live
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      View request pricing, edit amounts inline, and publish updates instantly across request checkout flows.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/finances")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={ShieldCheck} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Finances
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Configure provider readiness, partner financial profiles, payout queue rules, settlement visibility, and finance audit evidence without mixing them into pricing.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/news")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={Newspaper} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        News Management
                      </div>
                      <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                        Live
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Create, edit, publish, unpublish, and prioritize migration news updates.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => navigate("/app/admin/sacc/selfhelp-links")}
                className={`${card} w-full px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:hover:bg-zinc-900/80`}
              >
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={Link2} size={ICON_MD} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      SelfHelp Links Management
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Control SelfHelp resource links, partner flags, countries, track routing, and click counts from SACC.
                    </div>
                  </div>

                  <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

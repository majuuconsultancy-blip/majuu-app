import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  Coins,
  FileText,
  Globe2,
  ImagePlus,
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

const SACC_MODULES = [
  {
    key: "partnerships",
    title: "Partnerships",
    description: "Manage partner accounts, coverage, and routing eligibility.",
    path: "/app/admin/sacc/partnerships",
    icon: Link2,
  },
  {
    key: "finances",
    title: "Finances",
    description: "Control payment rules, payouts, and finance records.",
    path: "/app/admin/sacc/finances",
    icon: ShieldCheck,
  },
  {
    key: "countries",
    title: "Country Management",
    description: "Set up supported countries, tracks, and local settings.",
    path: "/app/admin/sacc/countries",
    icon: Globe2,
  },
  {
    key: "request-management",
    title: "Request Management",
    description: "Build modular request types and extra fields.",
    path: "/app/admin/sacc/request-management",
    icon: FileText,
  },
  {
    key: "pricing",
    title: "Pricing Controls",
    description: "Set request prices for checkout and package sales.",
    path: "/app/admin/sacc/pricing",
    icon: Coins,
    badge: "Live",
  },
  {
    key: "analytics",
    title: "Analytics",
    description: "Track demand, usage, and request outcomes.",
    path: "/app/admin/sacc/analytics",
    icon: BarChart3,
  },
  {
    key: "home-design",
    title: "Home Design Module",
    description: "Control featured country carousels, metadata, and visuals.",
    path: "/app/admin/sacc/home-design",
    icon: ImagePlus,
  },
  {
    key: "news",
    title: "News Management",
    description: "Publish migration updates and announcements.",
    path: "/app/admin/sacc/news",
    icon: Newspaper,
    badge: "Live",
  },
  {
    key: "selfhelp-links",
    title: "SelfHelp Links Management",
    description: "Manage links shown across SelfHelp resources.",
    path: "/app/admin/sacc/selfhelp-links",
    icon: Link2,
  },
];

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
      <div className="app-page-shell app-page-shell--medium">
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
              {SACC_MODULES.map((module) => (
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
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {module.title}
                        </div>
                        {module.badge ? (
                          <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                            {module.badge}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {module.description}
                      </div>
                    </div>

                    <AppIcon icon={ChevronRight} size={ICON_MD} className="text-zinc-400" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

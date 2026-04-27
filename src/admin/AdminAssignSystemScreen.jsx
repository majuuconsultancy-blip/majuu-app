import { useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ChevronRight, UserPlus, Users } from "lucide-react";

import AppIcon from "../components/AppIcon";
import { ICON_MD } from "../constants/iconSizes";
import { ADMIN_ROUTES } from "./adminPathing";

function ActionCard({ title, description, icon, onClick, tone = "emerald" }) {
  const iconTone = tone === "sky"
    ? "border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-200"
    : "border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-[1.75rem] border border-zinc-200 bg-white/82 p-5 text-left shadow-sm backdrop-blur transition hover:-translate-y-[1px] hover:border-emerald-200 hover:bg-white active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-950/55 dark:hover:border-emerald-900/40 dark:hover:bg-zinc-950/70"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${iconTone}`}>
            <AppIcon icon={icon} size={ICON_MD} />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </span>
            <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-300">
              {description}
            </span>
          </span>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-300">
          <AppIcon icon={ChevronRight} size={ICON_MD} />
        </span>
      </div>
    </button>
  );
}

export default function AdminAssignSystemScreen() {
  const navigate = useNavigate();
  const outletContext = useOutletContext() || {};
  const roleCtx = outletContext?.roleCtx || null;

  const roleSummary = useMemo(() => {
    if (roleCtx?.isSuperAdmin) return "Super admin tools for admin and manager assignment workflows.";
    return "Assignment tools are only available to super admins.";
  }, [roleCtx]);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <section className="rounded-[2rem] border border-zinc-200 bg-white/86 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
          <AppIcon icon={Users} size={ICON_MD} />
          Assign System
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Admin and manager assignment workspace
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
          {roleSummary}
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-[2rem] border border-zinc-200 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Assigned Admins
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Bind admin accounts to partner coverage, countries, and branch assignments.
          </p>
          <div className="mt-4 grid gap-3">
            <ActionCard
              title="Assign Admin"
              description="Grant assigned-admin access and connect the account to partner coverage."
              icon={UserPlus}
              onClick={() => navigate(ADMIN_ROUTES.assignAdmin)}
            />
            <ActionCard
              title="Manage Admins"
              description="Review assigned admins, update bindings, and remove stale access safely."
              icon={Users}
              onClick={() => navigate(ADMIN_ROUTES.manageAdmins)}
            />
          </div>
        </div>

        <div className="rounded-[2rem] border border-zinc-200 bg-white/82 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/55">
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Managers
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Assign managers, control module scope, and manage invite-driven access.
          </p>
          <div className="mt-4 grid gap-3">
            <ActionCard
              title="Assign Manager"
              description="Create or update manager assignments and generate onboarding invites."
              icon={UserPlus}
              tone="sky"
              onClick={() => navigate(ADMIN_ROUTES.assignManager)}
            />
            <ActionCard
              title="Manage Managers"
              description="Review active managers, assigned modules, and invite status in one place."
              icon={Users}
              tone="sky"
              onClick={() => navigate(ADMIN_ROUTES.manageManagers)}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

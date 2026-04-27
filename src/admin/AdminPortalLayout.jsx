import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Bell, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";

import AppIcon from "../components/AppIcon";
import ScreenLoader from "../components/ScreenLoader";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { useNotifsV2Store } from "../services/notifsV2Store";
import { ADMIN_ROUTES } from "./adminPathing";
import {
  findAdminNavItemByPath,
  getVisibleSidebarAdminNav,
} from "./adminNavigation";

const SIDEBAR_STORAGE_KEY = "majuu_admin_sidebar_collapsed_v1";

function readCollapsedState() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function roleLabel(roleCtx = null) {
  if (roleCtx?.isSuperAdmin) return "Super Admin";
  if (roleCtx?.isManager) return "Manager";
  if (roleCtx?.isAssignedAdmin) return "Assigned Admin";
  return "Admin";
}

function currentSubtitle(navItem = null, roleCtx = null) {
  if (navItem?.description) return navItem.description;
  if (roleCtx?.isSuperAdmin) {
    return "Desktop control center for admin operations, routing, and oversight.";
  }
  if (roleCtx?.isManager) {
    return "Module-scoped workspace for your assigned management responsibilities.";
  }
  return "Focused admin workspace for managing operational requests and follow-ups.";
}

export default function AdminPortalLayout() {
  const location = useLocation();
  const [roleCtx, setRoleCtx] = useState(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readCollapsedState());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const unreadNotifCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextRoleCtx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setRoleCtx(nextRoleCtx || null);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setRoleCtx(null);
      } finally {
        if (!cancelled) setLoadingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const sidebarItems = useMemo(
    () => getVisibleSidebarAdminNav(roleCtx),
    [roleCtx]
  );
  const activeNavItem = useMemo(
    () => findAdminNavItemByPath(location.pathname, roleCtx),
    [location.pathname, roleCtx]
  );

  if (loadingRole) {
    return (
      <ScreenLoader
        title="Loading admin workspace..."
        subtitle="Preparing your control center"
        variant="minimal"
      />
    );
  }

  const desktopSidebarWidth = sidebarCollapsed ? "lg:w-[6.25rem]" : "lg:w-[18rem]";
  const roleTone = roleCtx?.isSuperAdmin
    ? "border-rose-200 bg-rose-50/90 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200"
    : roleCtx?.isManager
    ? "border-sky-200 bg-sky-50/90 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-200"
    : "border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200";

  const SidebarNav = ({ mobile = false }) => (
    <nav className="grid gap-2">
      {sidebarItems.map((item) => {
        const showLabel = mobile || !sidebarCollapsed;
        return (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition",
                isActive
                  ? "border-emerald-200 bg-emerald-50/90 text-emerald-800 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100"
                  : "border-transparent text-zinc-600 hover:border-zinc-200 hover:bg-white/85 hover:text-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900/80 dark:hover:text-zinc-100",
                !showLabel ? "justify-center px-0" : "",
              ].join(" ")
            }
            title={sidebarCollapsed && !mobile ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                <span
                  className={[
                    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition",
                    isActive
                      ? "border-emerald-200 bg-white/90 text-emerald-700 dark:border-emerald-900/40 dark:bg-zinc-950/40 dark:text-emerald-200"
                      : "border-zinc-200 bg-white/80 text-zinc-600 group-hover:border-emerald-200 group-hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:group-hover:text-emerald-200",
                  ].join(" ")}
                >
                  <AppIcon icon={item.icon} size={ICON_MD} />
                </span>
                {showLabel ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {item.description}
                    </span>
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );

  return (
    <div
      className="bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_36%),linear-gradient(180deg,_#f5fbf7_0%,_#eef4f2_100%)] text-zinc-900 dark:bg-[linear-gradient(180deg,_#09090b_0%,_#0f172a_100%)] dark:text-zinc-100"
      style={{
        minHeight: "calc(var(--app-viewport-height) - var(--app-safe-top))",
      }}
    >
      <div className="flex min-h-[inherit]">
        <aside
          className={[
            "hidden border-r border-white/70 bg-white/75 px-3 py-4 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/70 lg:flex lg:flex-col",
            desktopSidebarWidth,
          ].join(" ")}
        >
          <div
            className={`flex items-center ${sidebarCollapsed ? "justify-center" : "justify-between"} gap-3 px-2 pb-4`}
          >
            {sidebarCollapsed ? (
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/90 text-emerald-700 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                <AppIcon icon={Bell} size={ICON_MD} />
              </div>
            ) : (
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                  Majuu Admin
                </div>
                <div className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Control Center
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/85 text-zinc-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:text-emerald-200"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <AppIcon icon={sidebarCollapsed ? ChevronRight : ChevronLeft} size={ICON_SM} />
            </button>
          </div>

          <div className="mt-2 flex-1 overflow-y-auto pr-1">
            <SidebarNav />
          </div>
        </aside>

        {mobileSidebarOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-zinc-950/45 backdrop-blur-[2px]"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <aside className="relative h-full w-[min(20rem,88vw)] border-r border-white/70 bg-white/92 px-4 py-4 shadow-2xl backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/92">
              <div className="flex items-center justify-between gap-3 pb-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                    Majuu Admin
                  </div>
                  <div className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    Control Center
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:text-emerald-200"
                  aria-label="Close sidebar"
                >
                  <AppIcon icon={X} size={ICON_SM} />
                </button>
              </div>
              <SidebarNav mobile />
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-white/70 bg-white/72 px-4 py-3 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/68 md:px-6 lg:px-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:text-emerald-200 lg:hidden"
                  aria-label="Open sidebar"
                >
                  <AppIcon icon={Menu} size={ICON_MD} />
                </button>

                <div className="min-w-0">
                  <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {activeNavItem?.label || "Admin Workspace"}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                    {currentSubtitle(activeNavItem, roleCtx)}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={[
                    "hidden rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] md:inline-flex",
                    roleTone,
                  ].join(" ")}
                >
                  {roleLabel(roleCtx)}
                </span>

                <NavLink
                  to={ADMIN_ROUTES.notifications}
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200 dark:hover:text-emerald-200"
                  aria-label="Admin notifications"
                  title="Admin notifications"
                >
                  <AppIcon icon={Bell} size={ICON_MD} />
                  {unreadNotifCount > 0 ? (
                    <span className="absolute right-0 top-0 inline-flex min-w-[18px] -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white shadow-[0_0_0_3px_rgba(244,63,94,0.18)]">
                      {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
                    </span>
                  ) : null}
                </NavLink>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-4 md:px-6 lg:px-8 lg:py-6">
            <Outlet context={{ roleCtx, sidebarItems }} />
          </main>
        </div>
      </div>
    </div>
  );
}

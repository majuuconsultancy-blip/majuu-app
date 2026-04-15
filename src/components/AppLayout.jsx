import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase";
import { useNotifsV2Store } from "../services/notifsV2Store";
import ScreenLoader from "./ScreenLoader";

import { AnimatePresence } from "../utils/motionProxy";
import PageTransitions from "./PageTransitions";
import { resolveLandingPathFromUserState } from "../journey/journeyLanding";

// ✅ offline banner + online status
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import OfflineBanner from "./OfflineBanner";

// ✅ if you added this in firebase.js (recommended). If not, remove this import + await below.
import { authPersistenceReady } from "../firebase";

const VALID_TRACKS = new Set(["study", "work", "travel"]);
const TAB_KEYS = new Set(["home", "progress", "news", "profile"]);
const AUTH_NULL_GRACE_MS = 1200;

function matchTrackFromPath(pathname) {
  const match = String(pathname || "").match(/^\/app\/(study|work|travel)(?:\/|$)/i);
  return match?.[1] ? String(match[1]).toLowerCase() : "";
}

function explicitTabKeyFromPathname(pathname) {
  const path = String(pathname || "");
  if (path.startsWith("/app/progress")) return "progress";
  if (path.startsWith("/app/news")) return "news";

  if (
    path.startsWith("/app/profile") ||
    path.startsWith("/app/settings") ||
    path === "/app/legal"
  ) {
    return "profile";
  }

  if (
    path.startsWith("/app/home") ||
    path.startsWith("/app/study") ||
    path.startsWith("/app/work") ||
    path.startsWith("/app/travel") ||
    path.startsWith("/app/full-package") ||
    path.startsWith("/app/service-partner/onboarding")
  ) {
    return "home";
  }

  return "";
}

function IconHome(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 10.5 12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H15v-6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6H5.5A1.5 1.5 0 0 1 4 20v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconProgress(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4.5 19.5V5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 19.5H20" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M7 15l4-4 3 3 5-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18.8 8H19.9V9.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M20 21a8 8 0 1 0-16 0" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function IconNews(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 6.5h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 18.5H6A1.5 1.5 0 0 1 4.5 17V8A1.5 1.5 0 0 1 6 6.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 10h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15.5 13.5h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { online } = useNetworkStatus();
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState(null);
  const [activeTrack, setActiveTrack] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(null);
  const [journeyTrack, setJourneyTrack] = useState(null);
  const [hasActiveProcess, setHasActiveProcess] = useState(false);
  const unreadNotifCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);
  const [scrollY, setScrollY] = useState(0);
  const [tabContext, setTabContext] = useState(() => {
    const explicit = explicitTabKeyFromPathname(location.pathname);
    const hinted = String(location.state?.tabContext || "");
    if (TAB_KEYS.has(hinted)) return hinted;
    return explicit || "home";
  });

  const tabMemoryRef = useRef({
    home: null,
    progress: null,
    news: null,
    profile: null,
  });

  const rafRef = useRef(null);
  useEffect(() => {
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setScrollY(window.scrollY || 0);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // ✅ critical: logout-confirm timer ref (prevents “false logout”)
  const logoutTimerRef = useRef(null);

  useEffect(() => {
    let unsubUserDoc = null;
    let unsubAuth = null;
    let cancelled = false;

    const cleanupRealtime = () => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }
    };

    const clearLogoutTimer = () => {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };

    (async () => {
      // ✅ wait for persistence (prevents “null user” on resume if storage is slow)
      try {
        await authPersistenceReady;
      } catch {
        // ignore if not available / failed
      }
      if (typeof auth?.authStateReady === "function") {
        try {
          await auth.authStateReady();
        } catch (error) {
          void error;
        }
      }
      if (cancelled) return;

      unsubAuth = onAuthStateChanged(auth, (user) => {
        // if auth recovers, cancel any pending logout
        if (user) clearLogoutTimer();

        // always reset listeners when auth changes
        cleanupRealtime();

        // ✅ if Firebase emits null briefly (PWA resume), DO NOT redirect immediately
        if (!user) {
          setCheckingAuth(true);

          clearLogoutTimer();
          logoutTimerRef.current = setTimeout(() => {
            const u2 = auth.currentUser;

            // still no user -> confirmed logout
            if (!u2) {
              setUid(null);
              setHasActiveProcess(false);
              setActiveTrack(null);
              setCheckingAuth(false);
              navigate("/login", { replace: true, state: { from: pathRef.current } });
              return;
            }

            // user came back -> keep session
            setCheckingAuth(false);
          }, AUTH_NULL_GRACE_MS);

          return;
        }

        // ✅ signed in
        setUid(user.uid);

        // user doc listener
        unsubUserDoc = onSnapshot(
          doc(db, "users", user.uid),
          (snap) => {
            const state = snap.exists() ? snap.data() : null;
            const landing = resolveLandingPathFromUserState(state || {});
            if (landing === "/setup") {
              setCheckingAuth(false);
              navigate("/setup", { replace: true });
              return;
            }
            const active = String(state?.activeTrack || "").toLowerCase();
            const selected = String(state?.selectedTrack || "").toLowerCase();
            const journey = String(state?.journey?.track || "").toLowerCase();

            setHasActiveProcess(Boolean(state?.hasActiveProcess));
            setActiveTrack(VALID_TRACKS.has(active) ? active : null);
            setSelectedTrack(VALID_TRACKS.has(selected) ? selected : null);
            setJourneyTrack(VALID_TRACKS.has(journey) ? journey : null);
            setCheckingAuth(false);
          },
          () => {
            setHasActiveProcess(false);
            setActiveTrack(null);
            setSelectedTrack(null);
            setJourneyTrack(null);
            setCheckingAuth(false);
          }
        );

      });
    })();

    return () => {
      cancelled = true;
      if (unsubAuth) unsubAuth();
      cleanupRealtime();
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };
  }, [navigate]);

  useEffect(() => {
    const explicit = explicitTabKeyFromPathname(location.pathname);
    if (explicit) {
      setTabContext(explicit);
      return;
    }

    const hinted = String(location.state?.tabContext || "");
    if (TAB_KEYS.has(hinted)) {
      setTabContext(hinted);
    }
  }, [location.pathname, location.state]);

  const activeTabKey = useMemo(
    () => explicitTabKeyFromPathname(location.pathname) || tabContext || "home",
    [location.pathname, tabContext]
  );

  useEffect(() => {
    const tabKey = explicitTabKeyFromPathname(location.pathname) || tabContext || "home";
    tabMemoryRef.current[tabKey] = {
      pathname: location.pathname,
      search: location.search || "",
      hash: location.hash || "",
      state: location.state,
    };
  }, [location.hash, location.key, location.pathname, location.search, location.state, tabContext]);

  const resolveHomeRootPath = () => {
    const preferred = journeyTrack || activeTrack || selectedTrack || matchTrackFromPath(location.pathname);
    if (preferred && VALID_TRACKS.has(preferred)) return `/app/${preferred}`;
    return "/app/home";
  };

  const tabRoot = (tabKey) => {
    if (tabKey === "progress") return { pathname: "/app/progress", search: "", hash: "", state: undefined };
    if (tabKey === "news") return { pathname: "/app/news", search: "", hash: "", state: newsNavState };
    if (tabKey === "profile") return { pathname: "/app/profile", search: "", hash: "", state: undefined };
    return { pathname: resolveHomeRootPath(), search: "", hash: "", state: undefined };
  };

  const navigateStored = (stored, options = {}) => {
    const target = stored && typeof stored === "object" ? stored : null;
    const pathname = String(target?.pathname || "");
    const search = String(target?.search || "");
    const hash = String(target?.hash || "");
    const state = typeof target?.state !== "undefined" ? target.state : undefined;
    if (!pathname) return;
    navigate(`${pathname}${search}${hash}`, {
      replace: Boolean(options.replace),
      state,
    });
  };

  const handleTabPress = (tabKey, event) => {
    const key = String(tabKey || "");
    if (!key) return;

    const sameTab = activeTabKey === key;
    const root = tabRoot(key);

    if (sameTab) {
      const currentHref = `${location.pathname}${location.search || ""}${location.hash || ""}`;
      const rootHref = `${root.pathname}${root.search || ""}${root.hash || ""}`;
      if (currentHref === rootHref) {
        window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
        return;
      }
      navigateStored(root, { replace: true });
      return;
    }

    const stored = tabMemoryRef.current[key] || root;
    setTabContext(key);
    navigateStored(stored, { replace: false });
  };

  const trackMatch = location.pathname.match(/^\/app\/(study|work|travel)(?:\/|$)/i);
  const newsParams = new URLSearchParams(location.search || "");
  const newsNavState = {
    trackContext: trackMatch?.[1] ? String(trackMatch[1]).toLowerCase() : "",
    countryContext: newsParams.get("country") || "",
  };

  const progressActive = activeTabKey === "progress";
  const newsActive = activeTabKey === "news";
  const profileActive = activeTabKey === "profile";
  const homeActive = activeTabKey === "home";
  const routeShellClass = useMemo(() => {
    const path = String(location.pathname || "").toLowerCase();
    if (
      path.startsWith("/app/admin") ||
      path.startsWith("/app/request/") ||
      path.startsWith("/app/progress") ||
      path.startsWith("/app/full-package/")
    ) {
      return "max-w-7xl";
    }
    if (
      path.startsWith("/app/study/we-help") ||
      path.startsWith("/app/work/we-help") ||
      path.startsWith("/app/travel/we-help")
    ) {
      return "max-w-5xl";
    }
    return "max-w-4xl";
  }, [location.pathname]);

  if (checkingAuth) {
    return (
      <ScreenLoader title="Preparing your session…" subtitle="Checking your account and syncing progress" />
    );
  }

  const itemBase =
    "flex min-h-[3rem] w-full flex-col items-center justify-center gap-1 rounded-[1rem] px-2 py-1.5 text-[11px] font-semibold leading-none transition duration-150 t-fade active:scale-[0.99]";
  const itemOn = "bg-emerald-600 text-white shadow-sm";
  const itemOff =
    "text-zinc-700 hover:bg-emerald-50/70 dark:text-zinc-200 dark:hover:bg-zinc-900/60";

  return (
    <div className="app-shell min-h-screen overflow-x-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <OfflineBanner online={online} />

      <div
        className="app-shell-content min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950"
      >
        <div className={`mx-auto min-h-screen w-full ${routeShellClass}`}>
          <AnimatePresence initial={false} mode="sync">
            <PageTransitions key={location.pathname}>
              <Outlet />
            </PageTransitions>
          </AnimatePresence>
        </div>
      </div>

      {uid && hasActiveProcess && activeTrack && (
        <div
          className="fixed left-0 right-0 z-40 pointer-events-none"
          style={{
            paddingLeft: "calc(var(--app-safe-left) + 1rem)",
            paddingRight: "calc(var(--app-safe-right) + 1rem)",
            bottom: "var(--app-active-track-offset)",
            opacity: Math.max(0, 1 - scrollY / 120),
            transition: "opacity 120ms linear",
          }}
        >
          <div className="max-w-xl mx-auto text-center text-[10px] text-zinc-500 dark:text-zinc-400">
            Active{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {activeTrack.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      <nav
        className="app-bottom-nav fixed inset-x-0 z-50"
      >
        <div className="max-w-xl mx-auto">
          <div
            className="app-bottom-nav-inner rounded-[1.55rem] border border-white/55 bg-white/18 px-2.5 py-1.5 shadow-[0_10px_26px_rgba(15,23,42,0.12)] t-pop dark:border-zinc-700/45 dark:bg-zinc-900/20"
            style={{
              WebkitBackdropFilter: "blur(14px)",
              backdropFilter: "blur(14px)",
            }}
          >
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={(event) => handleTabPress("home", event)}
                className={`${itemBase} ${homeActive ? itemOn : itemOff}`}
              >
                <IconHome className="h-[1.15rem] w-[1.15rem]" />
                <span>Home</span>
              </button>

              <button
                type="button"
                onClick={(event) => handleTabPress("progress", event)}
                className={`${itemBase} ${progressActive ? itemOn : itemOff} relative`}
              >
                <span className="relative">
                  <IconProgress className="h-[1.15rem] w-[1.15rem]" />
                  {unreadNotifCount > 0 ? (
                    <span
                      className={`absolute -right-2 -top-1.5 h-2.5 w-2.5 rounded-full ${
                        progressActive ? "bg-white dark:bg-zinc-900/60" : "bg-rose-600"
                      }`}
                      aria-label="Unread notifications"
                      title="Unread notifications"
                    />
                  ) : null}
                </span>

                <span>Progress</span>
              </button>

              <button
                type="button"
                onClick={(event) => handleTabPress("news", event)}
                className={`${itemBase} ${newsActive ? itemOn : itemOff}`}
              >
                <IconNews className="h-[1.15rem] w-[1.15rem]" />
                <span>News</span>
              </button>

              <button
                type="button"
                onClick={(event) => handleTabPress("profile", event)}
                className={`${itemBase} ${profileActive ? itemOn : itemOff}`}
              >
                <IconUser className="h-[1.15rem] w-[1.15rem]" />
                <span>Profile</span>
              </button>
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}

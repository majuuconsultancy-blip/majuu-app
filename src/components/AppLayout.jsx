import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase";
import { useNotifsV2Store } from "../services/notifsV2Store";
import ScreenLoader from "./ScreenLoader";

import { AnimatePresence } from "../utils/motionProxy";
import PageTransitions from "./PageTransitions";

// ✅ offline banner + online status
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import OfflineBanner from "./OfflineBanner";

// ✅ if you added this in firebase.js (recommended). If not, remove this import + await below.
import { authPersistenceReady } from "../firebase";

const VALID_TRACKS = new Set(["study", "work", "travel"]);
const AUTH_NULL_GRACE_MS = 1200;

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

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const online = useNetworkStatus();
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState(null);
  const [activeTrack, setActiveTrack] = useState(null);
  const [hasActiveProcess, setHasActiveProcess] = useState(false);
  const unreadNotifCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);
  const [scrollY, setScrollY] = useState(0);

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
        } catch {}
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
            const active = String(state?.activeTrack || "").toLowerCase();

            setHasActiveProcess(Boolean(state?.hasActiveProcess));
            setActiveTrack(VALID_TRACKS.has(active) ? active : null);
            setCheckingAuth(false);
          },
          () => {
            setHasActiveProcess(false);
            setActiveTrack(null);
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

  const goSmartHome = () => {
    if (hasActiveProcess && activeTrack) {
      navigate(`/app/${activeTrack}`, { replace: true });
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  const progressActive = useMemo(() => {
    return location.pathname === "/app/progress" || location.pathname.startsWith("/app/progress/");
  }, [location.pathname]);

  const profileActive = useMemo(() => {
    return location.pathname === "/app/profile" || location.pathname.startsWith("/app/profile/");
  }, [location.pathname]);

  const homeActive = useMemo(() => {
    return (
      location.pathname === "/dashboard" ||
      location.pathname === "/app/home" ||
      (location.pathname.startsWith("/app/") && !progressActive && !profileActive)
    );
  }, [location.pathname, progressActive, profileActive]);

  if (checkingAuth) {
    return (
      <ScreenLoader title="Preparing your session…" subtitle="Checking your account and syncing progress" />
    );
  }

  const itemBase =
    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition duration-150 t-fade active:scale-[0.99]";
  const itemOn = "bg-emerald-600 text-white shadow-sm";
  const itemOff =
    "text-zinc-700 dark:text-zinc-300 hover:bg-emerald-50/70 dark:text-zinc-200 dark:hover:bg-zinc-900/60";

  return (
    <div className="app-shell min-h-screen overflow-x-hidden bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <OfflineBanner online={online} />

      <div
        className="app-shell-content min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950"
      >
        <div className="max-w-xl mx-auto min-h-screen">
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
            className="app-bottom-nav-inner rounded-2xl border border-white/50 dark:border-zinc-700/45 bg-white/15 dark:bg-zinc-900/18 px-2 py-1.5 shadow-[0_6px_18px_rgba(15,23,42,0.10)] t-pop"
            style={{
              WebkitBackdropFilter: "blur(10px)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="flex items-center justify-between">
              <button onClick={goSmartHome} className={`${itemBase} ${homeActive ? itemOn : itemOff}`}>
                <IconHome className="h-5 w-5" />
                <span>Home</span>
              </button>

              <NavLink
                to="/app/progress"
                className={({ isActive }) => `${itemBase} ${isActive ? itemOn : itemOff} relative`}
              >
                <span className="relative">
                  <IconProgress className="h-5 w-5" />
                  {unreadNotifCount > 0 ? (
                    <span
                      className={`absolute -top-2 -right-19 h-2.5 w-2.5 rounded-full ${
                        progressActive ? "bg-white dark:bg-zinc-900/60" : "bg-rose-600"
                      }`}
                      aria-label="Unread notifications"
                      title="Unread notifications"
                    />
                  ) : null}
                </span>

                <span>Progress</span>
              </NavLink>

              <NavLink to="/app/profile" className={({ isActive }) => `${itemBase} ${isActive ? itemOn : itemOff}`}>
                <IconUser className="h-5 w-5" />
                <span>Profile</span>
              </NavLink>
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}

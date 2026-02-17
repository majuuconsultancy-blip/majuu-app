import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import ScreenLoader from "./ScreenLoader";

import { motion, AnimatePresence } from "../utils/motionProxy";
import PageTransitions from "./PageTransitions";

// ✅ NEW: offline banner + online status
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import OfflineBanner from "./OfflineBanner";

const VALID_TRACKS = new Set(["study", "work", "travel"]);

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

/* ✅ Minimal uptrend icon */
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
      <path
        d="M20 21a8 8 0 1 0-16 0"
        stroke="currentColor"
        strokeWidth="1.8"
      />
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

  // ✅ NEW: online/offline status for banner + action guarding later
  const online = useNetworkStatus();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState(null);
  const [activeTrack, setActiveTrack] = useState(null);
  const [hasActiveProcess, setHasActiveProcess] = useState(false);

  /* ✅ NEW: unread notifications count (for badge) */
  const [unreadCount, setUnreadCount] = useState(0);

  /* ✅ scroll tracking for fade */
  const [scrollY, setScrollY] = useState(0);

  // ✅ tiny perf fix: update scrollY at most once per animation frame
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

  useEffect(() => {
    let unsubUserDoc = null;
    let unsubNotifs = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }
      if (unsubNotifs) {
        unsubNotifs();
        unsubNotifs = null;
      }

      if (!user) {
        setUid(null);
        setHasActiveProcess(false);
        setActiveTrack(null);
        setUnreadCount(0);
        setCheckingAuth(false);
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);

      // ✅ user doc listener (existing)
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

      // ✅ notifications listener for badge
      const nRef = collection(db, "users", user.uid, "notifications");
      const nQ = query(nRef, orderBy("createdAt", "desc"), limit(50));

      unsubNotifs = onSnapshot(
        nQ,
        (snap) => {
          // unread = no readAt
          let count = 0;
          snap.forEach((d) => {
            const data = d.data();
            if (!data?.readAt) count += 1;
          });
          setUnreadCount(count);
        },
        () => {
          // if permissions fail etc., just hide badge
          setUnreadCount(0);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubUserDoc) unsubUserDoc();
      if (unsubNotifs) unsubNotifs();
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
    return (
      location.pathname === "/app/progress" ||
      location.pathname.startsWith("/app/progress/")
    );
  }, [location.pathname]);

  const profileActive = useMemo(() => {
    return (
      location.pathname === "/app/profile" ||
      location.pathname.startsWith("/app/profile/")
    );
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
      <ScreenLoader
        title="Preparing your session…"
        subtitle="Checking your account and syncing progress"
      />
    );
  }

  const itemBase =
    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const itemOn = "bg-emerald-600 text-white shadow-sm";
  const itemOff =
    "text-zinc-700 hover:bg-emerald-50/70 dark:text-zinc-200 dark:hover:bg-zinc-900/60";

  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ✅ Offline banner: applies to /app/* shell only */}
      <OfflineBanner online={online} />

      {/* background + constrained app column */}
      <div
        className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-28
                   dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950"
      >
        <div className="max-w-xl mx-auto min-h-screen">
          <AnimatePresence mode="wait">
            <PageTransitions key={location.pathname}>
              <Outlet />
            </PageTransitions>
          </AnimatePresence>
        </div>
      </div>

      {/* ✅ Active track (fades on scroll) - constrained to same width as nav */}
      {uid && hasActiveProcess && activeTrack && (
        <div
          className="fixed left-0 right-0 z-40 pointer-events-none px-4"
          style={{
            bottom: "calc(4.5rem + env(safe-area-inset-bottom))",
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

      {/* bottom nav */}
      <nav className="fixed bottom-4 left-0 right-0 z-50 px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur px-2 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="flex items-center justify-between">
              <button
                onClick={goSmartHome}
                className={`${itemBase} ${homeActive ? itemOn : itemOff}`}
              >
                <IconHome className="h-5 w-5" />
                <span>Home</span>
              </button>

              <NavLink
                to="/app/progress"
                className={({ isActive }) =>
                  `${itemBase} ${isActive ? itemOn : itemOff} relative`
                }
              >
                {/* icon + badge wrapper */}
                <span className="relative">
                  <IconProgress className="h-5 w-5" />

                  {/* ✅ unread badge */}
                  {unreadCount > 0 ? (
                    <span
                      className={`absolute -top-2 -right-19 h-2.5 w-2.5 rounded-full ${
                        progressActive ? "bg-white" : "bg-rose-600"
                      }`}
                      aria-label={`${unreadCount} unread notifications`}
                      title={`${unreadCount} unread notifications`}
                    />
                  ) : null}
                </span>

                <span>Progress</span>

                {/* optional count pill (only shows when 10+ unread) */}
                {unreadCount >= 10 ? (
                  <span
                    className={`ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-2 text-[11px] font-semibold ${
                      progressActive
                        ? "bg-white/90 text-emerald-900"
                        : "bg-rose-600 text-white"
                    }`}
                    aria-hidden="true"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </NavLink>

              <NavLink
                to="/app/profile"
                className={({ isActive }) =>
                  `${itemBase} ${isActive ? itemOn : itemOff}`
                }
              >
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
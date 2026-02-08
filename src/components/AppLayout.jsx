import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase";
import ScreenLoader from "./ScreenLoader";

import { AnimatePresence } from "framer-motion";
import PageTransitions from "./PageTransitions";

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

/* ✅ Minimal uptrend icon for Progress */
function IconProgress(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {/* axis */}
      <path
        d="M4.5 19.5V5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4.5 19.5H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* trend line */}
      <path
        d="M7 15l4-4 3 3 5-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* arrow head */}
      <path
        d="M18.8 8H19.9V9.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
        strokeLinecap="round"
      />
      <path
        d="M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState(null);

  const [activeTrack, setActiveTrack] = useState(null);
  const [hasActiveProcess, setHasActiveProcess] = useState(false);

  useEffect(() => {
    let unsubUserDoc = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (!user) {
        setUid(null);
        setHasActiveProcess(false);
        setActiveTrack(null);
        setCheckingAuth(false);
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);

      const userRef = doc(db, "users", user.uid);
      unsubUserDoc = onSnapshot(
        userRef,
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

    return () => {
      unsubAuth();
      if (unsubUserDoc) unsubUserDoc();
    };
  }, [navigate]);

  const goSmartHome = () => {
    if (hasActiveProcess && activeTrack) {
      navigate(`/app/${activeTrack}`, { replace: true });
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  const homeActive = useMemo(() => {
    return (
      location.pathname === "/app/home" ||
      location.pathname === "/dashboard" ||
      location.pathname.startsWith("/app/study") ||
      location.pathname.startsWith("/app/work") ||
      location.pathname.startsWith("/app/travel")
    );
  }, [location.pathname]);

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

  const iconCls = "h-5 w-5";

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* background wash */}
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

      {/* bottom nav */}
     {uid && hasActiveProcess && activeTrack ? (
  <div
    className="fixed left-0 right-0 z-50 px-4 pointer-events-none"
    style={{
      bottom: "calc(4rem + env(safe-area-inset-bottom))",
    }}
  >
    <div className="max-w-xl mx-auto text-center">
      <span className="text-[10px] tracking-wide text-zinc-500 dark:text-zinc-400">
        Active:{" "}
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          {activeTrack.toUpperCase()}
        </span>
      </span>
    </div>
  </div>
) : null}


      <nav className="fixed bottom-4 left-0 right-0 z-50 px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto">
          <div
            className="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur shadow-sm px-2 py-2
                dark:border-zinc-800 dark:bg-zinc-900/70"
          >

            <div className="flex items-center justify-between">
              <button
                onClick={goSmartHome}
                className={`${itemBase} ${homeActive ? itemOn : itemOff}`}
              >
                <IconHome className={iconCls} />
                <span>Home</span>
              </button>

              <NavLink
                to="/app/progress"
                className={({ isActive }) =>
                  `${itemBase} ${isActive ? itemOn : itemOff}`
                }
              >
                <IconProgress className={iconCls} />
                <span>Progress</span>
              </NavLink>

              <NavLink
                to="/app/profile"
                className={({ isActive }) =>
                  `${itemBase} ${isActive ? itemOn : itemOff}`
                }
              >
                <IconUser className={iconCls} />
                <span>Profile</span>
              </NavLink>
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}

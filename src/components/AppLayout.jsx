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

function IconProgress(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 16V10m5 6V7m5 9v-4M5 20h14a2 2 0 0 0 2-2V6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
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
  const itemOff = "text-zinc-700 hover:bg-emerald-50/70";

  const iconCls = "h-5 w-5";

  return (
    <div className="min-h-screen bg-white">
      {/* background wash */}
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-28">
        <div className="max-w-xl mx-auto min-h-screen">
  <AnimatePresence mode="wait">
    <PageTransitions key={location.pathname}>
      <Outlet />
    </PageTransitions>
  </AnimatePresence>
</div>
      </div>

      {/* bottom nav */}
      <nav className="fixed bottom-4 left-0 right-0 z-50 px-4">
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur shadow-sm px-2 py-2 flex items-center justify-between">
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

          {uid && hasActiveProcess && activeTrack ? (
            <div className="mt-2 text-[11px] text-zinc-500 text-center">
              Active:{" "}
              <span className="font-semibold text-emerald-700">
                {activeTrack.toUpperCase()}
              </span>
            </div>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
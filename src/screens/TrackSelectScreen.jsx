// ✅ TrackSelectScreen.jsx (FULL COPY-PASTE)
// UI POLISHES (backend untouched — same auth/firestore/services):
// - ✅ More “floaty” tiles + subtle entrance animation + nicer hover/press states
// - ✅ Cleaner header + badge-like loading tiles
// - ✅ Dark mode consistency across screen
// - ✅ Staff Portal button refined (smaller, premium, still staff-only)
// - ✅ Better loading skeleton + softMsg preserved
// - ✅ Keeps: staff/{uid}.active check (fail-closed), setSelectedTrack + localStorage, skip logic

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import {
  BookOpen,
  Briefcase,
  ChevronRight,
  Plane,
  ShieldCheck,
} from "lucide-react";

import { auth, db } from "../firebase";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { getUserState, setSelectedTrack } from "../services/userservice";
import { getResumeTarget, setSnapshot } from "../resume/resumeEngine";

export default function TrackSelectScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState(null);
  const [userState, setUserState] = useState(null);

  const [loading, setLoading] = useState(true);
  const [softMsg, setSoftMsg] = useState("Loading…");
  const [going, setGoing] = useState(""); // track being clicked

  // ✅ staff check
  const [isStaff, setIsStaff] = useState(false);

  // ✅ light entrance animation for tiles
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSoftMsg("Taking longer than usual. Please check your connection.");
      setLoading(false);
    }, 7000);

    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timer);

      if (!user) {
        setLoading(false);
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);

      // ✅ staff role check (fails closed)
      try {
        const staffSnap = await getDoc(doc(db, "staff", user.uid));
        const ok = staffSnap.exists() && Boolean(staffSnap.data()?.active);
        setIsStaff(ok);
      } catch (e) {
        setIsStaff(false);
      }

      try {
        const state = await getUserState(user.uid);
        setUserState(state || null);
        setSoftMsg("");
      } catch (e) {
        console.error("TrackSelect getUserState error:", e);
        setSoftMsg("Could not load your profile state.");
      } finally {
        setLoading(false);
        setTimeout(() => setMounted(true), 40);
      }
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [navigate]);

  const showSkip = Boolean(userState?.hasActiveProcess);

  const skipLabel = useMemo(() => {
    const trackRaw = String(userState?.activeTrack || "").toLowerCase();
    const track = trackRaw ? `${trackRaw.slice(0, 1).toUpperCase()}${trackRaw.slice(1)}` : "";
    if (!showSkip) return "";
    return track ? `Continue your ${track} application` : "Continue your application";
  }, [showSkip, userState]);

  useEffect(() => {
    if (!userState) return;
    const activeTrack = String(userState?.activeTrack || "").toLowerCase();
    const activeCountry = String(userState?.activeCountry || "");
    const activeHelpType = String(userState?.activeHelpType || "").toLowerCase();

    setSnapshot({
      trackSelect: {
        selectedTrack: activeTrack,
        destination: activeCountry,
        country: activeCountry,
        category: activeTrack,
        helpType: activeHelpType,
        subStep: showSkip ? "dashboard-active-process" : "dashboard-idle",
      },
    });
  }, [userState, showSkip]);

  const go = async (track) => {
    if (!uid) return;

    setGoing(track);
    localStorage.setItem("majuu_track", track);
    setSnapshot({
      trackSelect: {
        selectedTrack: track,
        category: track,
        subStep: "track-selected",
      },
      route: { path: `/app/${track}`, search: "" },
    });

    try {
      await setSelectedTrack(uid, track);
    } catch (e) {
      console.error("setSelectedTrack error:", e);
      // still navigate even if saving failed
    } finally {
      navigate(`/app/${track}`);
    }
  };

  const skipToOngoing = async () => {
    const resumeTarget = await getResumeTarget();
    if (resumeTarget?.path) {
      navigate(`${resumeTarget.path}${resumeTarget.search || ""}`, {
        replace: true,
        state: resumeTarget.state,
      });
      return;
    }

    if (!userState?.hasActiveProcess) return;

    const helpType = String(userState?.activeHelpType || "").toLowerCase();
    const requestId = String(userState?.activeRequestId || "").trim();
    const track = String(userState?.activeTrack || "").toLowerCase();

    if (helpType === "we" && requestId) {
      navigate(`/app/request/${requestId}`);
      return;
    }
    if (track) {
      navigate(`/app/${track}`);
      return;
    }
    navigate("/app/progress");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 flex items-center justify-center px-5">
          <div className="w-full max-w-md rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl border border-emerald-100 bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-950/40 animate-pulse" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Loading</p>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{softMsg}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              <div className="h-20 rounded-3xl bg-zinc-100 dark:bg-zinc-900/40 animate-pulse" />
              <div className="h-20 rounded-3xl bg-zinc-100 dark:bg-zinc-900/40 animate-pulse" />
              <div className="h-20 rounded-3xl bg-zinc-100 dark:bg-zinc-900/40 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const Tile = ({ icon, title, desc, onClick, active, delay = 0 }) => (
    <button
      onClick={onClick}
      disabled={Boolean(going)}
      style={{ transitionDelay: `${delay}ms` }}
      className={[
        "w-full text-left rounded-3xl border bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-5 shadow-sm transition",
        "border-zinc-200 dark:border-zinc-800 hover:border-emerald-200 hover:bg-white hover:shadow-md",
        "active:scale-[0.99] disabled:opacity-60",
        "dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-900",
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        active ? "ring-2 ring-emerald-200 dark:ring-emerald-300/20" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={[
              "h-11 w-11 rounded-2xl border flex items-center justify-center",
              "border-emerald-100 bg-emerald-50/70 text-emerald-800",
              "dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200",
              "shadow-[0_10px_25px_rgba(16,185,129,0.10)]",
            ].join(" ")}
          >
            <AppIcon size={ICON_MD} icon={icon} aria-hidden="true" />
          </div>

          <div className="min-w-0">
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{desc}</div>

            {active ? (
              <div className="mt-3 text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                Opening…
              </div>
            ) : null}
          </div>
        </div>

        <div className="text-zinc-400 mt-1 dark:text-zinc-500">
          <AppIcon size={ICON_MD} icon={ChevronRight} aria-hidden="true" />
        </div>
      </div>
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-8">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Choose your path
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Study • Work • Travel
              </p>
            </div>

            <div className="h-11 w-11 rounded-2xl border border-emerald-100 bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-950/40" />
          </div>

          {/* Lower content wrapper (stronger offset for Android/Capacitor visual spacing) */}
          <div className="pt-20 sm:pt-24">
            <div aria-hidden="true" className="mb-4 h-8" />
            {/* ✅ Staff Portal button (ONLY for staff) */}
            {isStaff ? (
              <div className={`transition ${mounted ? "opacity-100" : "opacity-0"}`}>
                <button
                  type="button"
                  onClick={() => navigate("/staff/tasks")}
                  className="w-full rounded-3xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-100 active:scale-[0.99] dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/45"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-emerald-200 bg-white/70 dark:bg-zinc-900/60 text-emerald-800 dark:border-emerald-900/40 dark:bg-zinc-950/40 dark:text-emerald-200">
                      <AppIcon size={ICON_SM} icon={ShieldCheck} aria-hidden="true" />
                    </span>
                    Staff Portal
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-emerald-200 bg-white/60 dark:bg-zinc-900/60 text-emerald-800 dark:border-emerald-900/40 dark:bg-zinc-950/40 dark:text-emerald-200">
                      <AppIcon size={ICON_MD} icon={ChevronRight} aria-hidden="true" />
                    </span>
                  </span>
                </button>

                <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Visible to staff accounts only.
                </div>
              </div>
            ) : null}

            {/* Tiles */}
            <div className={[isStaff ? "mt-4" : "", "grid gap-3"].join(" ").trim()}>
              <Tile
                icon={BookOpen}
                title="Study abroad"
                desc="Admissions, visas, scholarships."
                onClick={() => go("study")}
                active={going === "study"}
                delay={0}
              />

              <Tile
                icon={Briefcase}
                title="Work abroad"
                desc="Jobs, CV support, work permits."
                onClick={() => go("work")}
                active={going === "work"}
                delay={60}
              />

              <Tile
                icon={Plane}
                title="Travel abroad"
                desc="Trips, tours, travel planning."
                onClick={() => go("travel")}
                active={going === "travel"}
                delay={120}
              />
            </div>

            {/* Skip block */}
            {showSkip ? (
              <div
                className={[
                  "mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur transition",
                  "dark:border-zinc-800 dark:bg-zinc-900/60",
                  mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
                ].join(" ")}
              >
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  You have something in progress
                </div>
                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{skipLabel}</div>

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => navigate("/app/progress")}
                    className="flex-1 min-w-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/60 px-3 py-2.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    View progress
                  </button>

                  <button
                    onClick={skipToOngoing}
                    className="flex-1 min-w-0 rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99]"
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}



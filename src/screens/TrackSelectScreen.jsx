import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
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
import { waitForAuthRestore } from "../utils/authRestore";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { isStaffAccessEnabled } from "../services/staffaccessservice";

const AUTH_NULL_GRACE_MS = 1200;

export default function TrackSelectScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState(null);
  const [userState, setUserState] = useState(null);

  const [loading, setLoading] = useState(true);
  const [softMsg, setSoftMsg] = useState("Loading...");
  const [going, setGoing] = useState("");

  const [isStaff, setIsStaff] = useState(false);

  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    let unsub = () => {};
    let cancelled = false;
    let nullTimer = null;

    const clearNullTimer = () => {
      if (nullTimer) {
        window.clearTimeout(nullTimer);
        nullTimer = null;
      }
    };

    const timer = setTimeout(() => {
      if (cancelled) return;
      setSoftMsg("Taking longer than usual. Please check your connection.");
      setLoading(false);
      setMounted(true);
    }, 7000);

    void (async () => {
      await waitForAuthRestore(7000);
      if (cancelled) return;

      unsub = onAuthStateChanged(auth, async (user) => {
        clearTimeout(timer);
        clearNullTimer();

        if (!user) {
          setLoading(true);
          nullTimer = window.setTimeout(() => {
            if (cancelled) return;
            if (auth.currentUser) return;
            setLoading(false);
            navigate("/login", { replace: true });
          }, AUTH_NULL_GRACE_MS);
          return;
        }

        setUid(user.uid);

        const [staffSnap, roleCtx] = await Promise.all([
          getDoc(doc(db, "staff", user.uid)).catch((error) => {
            console.warn("TrackSelect staff doc read failed:", error?.code || error?.message || error);
            return null;
          }),
          getCurrentUserRoleContext(user.uid).catch((error) => {
            console.warn("TrackSelect role context failed:", error?.code || error?.message || error);
            return null;
          }),
        ]);
        const hasStaffDoc = Boolean(staffSnap?.exists?.());
        const staffData = hasStaffDoc ? staffSnap.data() || {} : null;
        const byStaffDoc = hasStaffDoc && isStaffAccessEnabled(staffData);
        const byRoleCtx = roleCtx?.role === "staff";

        const [taskProbe, requestProbe] = await Promise.all([
          getDocs(query(collection(db, "staff", user.uid, "tasks"), limit(1))).catch(() => null),
          getDocs(
            query(collection(db, "serviceRequests"), where("assignedTo", "==", user.uid), limit(1))
          ).catch(() => null),
        ]);
        const byAssignmentSignal = Boolean(taskProbe?.docs?.length || requestProbe?.docs?.length);

        if (!cancelled) setIsStaff(Boolean(byStaffDoc || byRoleCtx || byAssignmentSignal));

        try {
          const state = await getUserState(user.uid);
          if (!cancelled) {
            setUserState(state || null);
            setSoftMsg("");
          }
        } catch (error) {
          console.error("TrackSelect getUserState error:", error);
          if (!cancelled) setSoftMsg("Could not load your profile state.");
        } finally {
          if (!cancelled) {
            setLoading(false);
            window.setTimeout(() => {
              if (!cancelled) setMounted(true);
            }, 40);
          }
        }
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearNullTimer();
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
    } catch (error) {
      console.error("setSelectedTrack error:", error);
    } finally {
      navigate(`/app/${track}`, { replace: true });
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
      navigate(`/app/request/${requestId}`, { replace: true });
      return;
    }
    if (track) {
      navigate(`/app/${track}`, { replace: true });
      return;
    }
    navigate("/app/progress", { replace: true });
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
                Opening...
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
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Choose your path
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Study / Work / Travel</p>
            </div>

            <div className="h-11 w-11 rounded-2xl border border-emerald-100 bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-950/40" />
          </div>

          <div className="pt-20 sm:pt-24">
            <div aria-hidden="true" className="mb-4 h-8" />
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

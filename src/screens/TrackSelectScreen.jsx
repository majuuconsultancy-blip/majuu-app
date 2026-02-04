import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../firebase";
import { getUserState, setSelectedTrack } from "../services/userservice";

/* Minimal icons (no libs) */
function IconCap(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M3 8.5 12 4l9 4.5-9 4.5L3 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6 10.5V16c0 .6.3 1.1.8 1.4 1.7 1 3.7 1.6 5.2 1.6 1.5 0 3.5-.6 5.2-1.6.5-.3.8-.8.8-1.4v-5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBriefcase(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M9 7V6.2A2.2 2.2 0 0 1 11.2 4h1.6A2.2 2.2 0 0 1 15 6.2V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 7h12a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4 12h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPlane(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {/* clean airplane silhouette */}
      <path
        d="M21 12l-8.6-2.4V4.8c0-.5-.4-.8-.8-.8h-.8c-.4 0-.8.3-.8.8v4.8L3 12v1.2l7.9 1.2v4.1l-2.3 1.4v1l3.5-.9 3.5.9v-1l-2.3-1.4v-4.1L21 13.2V12Z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconArrowRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M9 18l6-6-6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TrackSelectScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState(null);
  const [userState, setUserState] = useState(null);

  const [loading, setLoading] = useState(true);
  const [softMsg, setSoftMsg] = useState("Loading…");
  const [going, setGoing] = useState(""); // track being clicked

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

      try {
        const state = await getUserState(user.uid);
        setUserState(state || null);
        setSoftMsg("");
      } catch (e) {
        console.error("TrackSelect getUserState error:", e);
        setSoftMsg("Could not load your profile state.");
      } finally {
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [navigate]);

  const showSkip = Boolean(userState?.hasActiveProcess);

  const skipLabel = useMemo(() => {
    const helpType = String(userState?.activeHelpType || "").toLowerCase();
    const track = String(userState?.activeTrack || "").toUpperCase();
    if (!showSkip) return "";
    if (helpType === "we") return `Continue your request${track ? ` (${track})` : ""}`;
    return `Continue your process${track ? ` (${track})` : ""}`;
  }, [showSkip, userState]);

  const go = async (track) => {
    if (!uid) return;

    setGoing(track);
    localStorage.setItem("majuu_track", track);

    try {
      await setSelectedTrack(uid, track);
    } catch (e) {
      console.error("setSelectedTrack error:", e);
      // still navigate even if saving failed
    } finally {
      navigate(`/app/${track}`);
    }
  };

  const skipToOngoing = () => {
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
      <div className="min-h-screen bg-white">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white flex items-center justify-center px-5">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white/70 p-6 shadow-sm backdrop-blur">
            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/60" />
            <p className="mt-3 text-sm font-semibold text-zinc-900">Loading</p>
            <p className="mt-1 text-sm text-zinc-600">{softMsg}</p>
          </div>
        </div>
      </div>
    );
  }

  const Tile = ({ icon, title, desc, onClick, active }) => (
    <button
      onClick={onClick}
      disabled={Boolean(going)}
      className={[
        "w-full text-left rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm transition",
        "border-zinc-200 hover:border-emerald-200 hover:bg-white",
        "active:scale-[0.99] disabled:opacity-60",
        active ? "ring-2 ring-emerald-200" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl border border-emerald-100 bg-emerald-50/70 flex items-center justify-center text-emerald-800">
            {icon}
          </div>

          <div>
            <div className="text-base font-semibold text-zinc-900">{title}</div>
            <div className="mt-1 text-sm text-zinc-600">{desc}</div>
          </div>
        </div>

        <div className="text-zinc-400 mt-1">
          <IconArrowRight className="h-5 w-5" />
        </div>
      </div>

      {/* subtle “loading” hint when clicking */}
      {active ? (
        <div className="mt-3 text-xs text-emerald-700">
          Opening…
        </div>
      ) : null}
    </button>
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white">
        <div className="max-w-xl mx-auto px-5 py-8">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                Choose your path
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Study-Work-Travel.
              </p>
            </div>

            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/60" />
          </div>

          {/* Tiles */}
          <div className="mt-6 grid gap-3">
            <Tile
              icon={<IconCap className="h-5 w-5" />}
              title="Study abroad"
              desc="Admissions, visas, scholarships."
              onClick={() => go("study")}
              active={going === "study"}
            />

            <Tile
              icon={<IconBriefcase className="h-5 w-5" />}
              title="Work abroad"
              desc="Jobs, CV support, work permits."
              onClick={() => go("work")}
              active={going === "work"}
            />

            <Tile
              icon={<IconPlane className="h-5 w-5" />}
              title="Travel abroad"
              desc="Trips, tours, travel planning."
              onClick={() => go("travel")}
              active={going === "travel"}
            />
          </div>

          {/* Skip block */}
          {showSkip ? (
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
              <div className="text-sm font-semibold text-zinc-900">
                You have something in progress
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                {skipLabel}
              </div>

              <div className="mt-4 grid gap-2">
                <button
                  onClick={skipToOngoing}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99]"
                >
                  Continue
                </button>

                <button
                  onClick={() => navigate("/app/progress")}
                  className="w-full rounded-xl border border-zinc-200 bg-white/50 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99]"
                >
                  View progress
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
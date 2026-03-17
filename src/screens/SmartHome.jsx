import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { getUserState } from "../services/userservice";

const VALID_TRACKS = new Set(["study", "work", "travel"]);

function IconSpinner(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3a9 9 0 1 0 9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function SmartHome() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;

      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        const state = await getUserState(user.uid);

        const hasActive = Boolean(state?.hasActiveProcess);
        const helpType = String(state?.activeHelpType || "").toLowerCase();
        const requestId = String(state?.activeRequestId || "").trim();
        const track = String(state?.activeTrack || "").toLowerCase();
        const selected = String(state?.selectedTrack || "").toLowerCase();
        const journey = String(state?.journey?.track || "").toLowerCase();

        // ✅ If We-Help + requestId → go to request status
        if (hasActive && helpType === "we" && requestId) {
          navigate(`/app/request/${requestId}`, { replace: true });
          return;
        }

        // ✅ If journey track exists → go to that track home
        if (VALID_TRACKS.has(journey)) {
          navigate(`/app/${journey}`, { replace: true });
          return;
        }

        // ✅ Else go to active track if valid
        if (hasActive && VALID_TRACKS.has(track)) {
          navigate(`/app/${track}`, { replace: true });
          return;
        }

        // ✅ Else go to the last selected track (if any)
        if (VALID_TRACKS.has(selected)) {
          navigate(`/app/${selected}`, { replace: true });
          return;
        }

        // ✅ Default
        navigate("/dashboard", { replace: true });
      } catch (e) {
        console.error("SmartHome error:", e);
        navigate("/dashboard", { replace: true });
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-10">
          <div className="mt-10 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-6 shadow-sm backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="grid place-items-center h-11 w-11 rounded-2xl border border-emerald-100 bg-emerald-50/70">
                <IconSpinner className="h-5 w-5 text-emerald-700 animate-spin" />
              </div>

              <div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Preparing your workspace
                </div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                  Redirecting you to where you left off…
                </div>
              </div>
            </div>

            <div className="mt-5 h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
              <div className="h-full w-1/2 bg-emerald-500/70 rounded-full animate-pulse" />
            </div>

            <div className="mt-4 text-[11px] text-zinc-500">
              If this takes too long, go back and reopen the app.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



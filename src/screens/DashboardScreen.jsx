import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { getUserProfile } from "../services/userservice";
import ThemeToggle from "../components/ThemeToggle";

/* Minimal icon tiles (no emojis) */
function IconCap(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5 3 8l9 4.5L21 8l-9-4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7 10.5V16c0 2 2.2 3.8 5 3.8s5-1.8 5-3.8v-5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconBriefcase(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 7V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5.5 8.5h13A2 2 0 0 1 20.5 10v8A2 2 0 0 1 18.5 20h-13A2 2 0 0 1 3.5 18v-8A2 2 0 0 1 5.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 13h17"
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
      <path
        d="M3 13.5l18-7.5-7.5 18-2.2-7.1L3 13.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M11.3 16.9 21 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconPulse(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 13.2h3.2l1.6-6.1 3.3 13 2.2-7.1H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DashboardScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      const data = await getUserProfile(user.uid);
      setProfile(data);
      setLoading(false);
    });

    return () => unsub();
  }, [navigate]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="max-w-xl mx-auto px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading…
            </p>
          </div>
        </div>
      </div>
    );
  }

  const card =
    "rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-white hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-emerald-900/40 dark:hover:bg-zinc-900";

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-6">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-emerald-200">
                MAJUU
              </div>

              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Dashboard
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Choose a track to begin, or check your progress.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="rounded-xl border border-zinc-200 bg-white/70 px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]
                           dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Tiles */}
          <div className="mt-8 grid gap-3">
            <button
              onClick={() => navigate("/app/study")}
              className={`${card} text-left`}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60 text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <IconCap className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Study Abroad
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Start your study track (Self-Help or We-Help).
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={() => navigate("/app/work")}
              className={`${card} text-left`}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60 text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <IconBriefcase className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Work Abroad
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Start your work track (Self-Help or We-Help).
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={() => navigate("/app/travel")}
              className={`${card} text-left`}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60 text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <IconPlane className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Travel Abroad
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Start your travel track (Self-Help or We-Help).
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={() => navigate("/app/progress")}
              className={`${card} text-left`}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60 text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <IconPulse className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Progress
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Track requests, retry rejected, and continue your process.
                  </div>
                </div>
              </div>
            </button>
          </div>

          {/* small spacer */}
          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

/* ---------- Minimal icons ---------- */
function IconStudy(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3.5 8.5 12 4l8.5 4.5L12 13 3.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.2V16c0 1.7 3 3.2 5.5 3.2s5.5-1.5 5.5-3.2v-5.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWork(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 7V6.2A2.2 2.2 0 0 1 11.2 4h1.6A2.2 2.2 0 0 1 15 6.2V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5.5 8.5h13A2 2 0 0 1 20.5 10.5v7A2 2 0 0 1 18.5 19.5h-13A2 2 0 0 1 3.5 17.5v-7A2 2 0 0 1 5.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTravel(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3.5 12.3 20.5 7.5l-5.2 17-2.2-7-7.6-2.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.1 17.5 20.5 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 5.5 15.5 12 9 18.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- Track config ---------- */
const TRACKS = {
  study: { title: "Study Abroad", Icon: IconStudy },
  work: { title: "Work Abroad", Icon: IconWork },
  travel: { title: "Travel Abroad", Icon: IconTravel },
};

export default function AppHomeScreen() {
  const navigate = useNavigate();

  const track = useMemo(
    () => localStorage.getItem("majuu_track") || "study",
    []
  );

  const info = TRACKS[track] || TRACKS.study;
  const HeaderIcon = info.Icon;

  const cardBase =
    "group rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm transition";
  const cardHover =
    "hover:border-emerald-200 hover:bg-white hover:shadow-md active:scale-[0.99]";

  return (
    <div className="px-5 py-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-100 bg-white/70 dark:bg-zinc-900/60">
              <HeaderIcon className="h-4 w-4 text-emerald-700" />
            </span>
            {info.title}
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Continue where you left off or start something new.
          </p>
        </div>

        <button
          onClick={() => navigate("/dashboard")}
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
        >
          Change track
        </button>
      </div>

      {/* Quick actions */}
      <div className="mt-7 grid gap-3">
        <button
          onClick={() => navigate(`/app/${track}`)}
          className={`${cardBase} ${cardHover} text-left`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Continue {info.title}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Pick a country and choose help mode
              </div>
            </div>

            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition group-hover:border-emerald-200 group-hover:bg-emerald-50/60 group-hover:text-emerald-800">
              <IconChevronRight className="h-5 w-5" />
            </span>
          </div>
        </button>

        <button
          onClick={() => navigate("/app/progress")}
          className={`${cardBase} ${cardHover} text-left`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                View your progress
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Track active and past requests
              </div>
            </div>

            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition group-hover:border-emerald-200 group-hover:bg-emerald-50/60 group-hover:text-emerald-800">
              <IconChevronRight className="h-5 w-5" />
            </span>
          </div>
        </button>

        <button
          onClick={() => navigate("/app/profile")}
          className={`${cardBase} ${cardHover} text-left`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Manage profile
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Update contact and personal details
              </div>
            </div>

            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition group-hover:border-emerald-200 group-hover:bg-emerald-50/60 group-hover:text-emerald-800">
              <IconChevronRight className="h-5 w-5" />
            </span>
          </div>
        </button>
      </div>

      {/* Footer hint */}
      <div className="mt-6 text-center text-xs text-zinc-500">
        Your progress is saved automatically.
      </div>
    </div>
  );
}


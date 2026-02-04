import { useLocation, useNavigate } from "react-router-dom";

/* -------- Minimal icon -------- */
function IconBriefcase(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 7h16a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M2 12h20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function WorkSelfHelp() {
  const navigate = useNavigate();
  const location = useLocation();

  const country = new URLSearchParams(location.search).get("country");

  const goBackToChoice = () => {
    navigate(`/app/work?country=${encodeURIComponent(country || "")}`);
  };

  return (
    <div className="min-h-screen">
      <div className="px-5 py-6">
        {/* Back */}
        <button
          onClick={goBackToChoice}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          ← Back
        </button>

        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70">
                <IconBriefcase className="h-4 w-4 text-emerald-700" />
              </span>
              Work · Self-Help
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Work abroad, step by step
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Country:{" "}
              <span className="font-medium text-zinc-900">
                {country || "Not selected"}
              </span>
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {/* Content card */}
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
          <h2 className="text-base font-semibold text-zinc-900">
            What this section will include
          </h2>

          <p className="mt-2 text-sm text-zinc-600">
            This self-help section will guide you through the process of working
            abroad using official resources and best practices.
          </p>

          <ul className="mt-4 grid gap-2 text-sm text-zinc-700">
            <li className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
              Job search platforms and employer portals
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
              Work permit and visa guidance
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
              CV and cover letter best practices
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
              Official government and embassy links
            </li>
          </ul>

          <div className="mt-4 text-xs italic text-zinc-500">
            Detailed guides and resources coming soon.
          </div>
        </div>
      </div>
    </div>
  );
}
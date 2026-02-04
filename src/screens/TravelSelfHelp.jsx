import { useLocation, useNavigate } from "react-router-dom";

/* -------- Minimal icons -------- */
function IconCompass(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M9.5 14.5l1.8-4.2 4.2-1.8-1.8 4.2-4.2 1.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconArrowRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TravelSelfHelp() {
  const navigate = useNavigate();
  const location = useLocation();

  const country = new URLSearchParams(location.search).get("country") || "Not selected";

  const goBackToChoice = () => {
    // back to the track screen modal (your TrackScreen)
    navigate(`/app/travel?country=${encodeURIComponent(country)}&from=choice`);
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
                <IconCompass className="h-4 w-4 text-emerald-700" />
              </span>
              Travel · Self-Help
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Plan your trip independently
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Trusted resources to help you prepare and travel confidently.
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {/* Country card */}
        <div className="mt-5 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold text-zinc-500">Selected country</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">{country}</p>
        </div>

        {/* Content blocks */}
        <div className="mt-7 grid gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold text-zinc-900">What you’ll find here</h2>

            <ul className="mt-3 grid gap-2 text-sm text-zinc-700">
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                Travel planning basics & timelines
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                Visa & embassy guidance links
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                Flight booking & accommodation tips
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                Pre-departure checklists
              </li>
            </ul>
          </div>

          {/* Coming soon */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Resources coming soon</h3>
                <p className="mt-1 text-sm text-zinc-600">
                  We’re curating official links and step-by-step guides.
                </p>
              </div>

              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-white/70 text-emerald-700">
                <IconArrowRight className="h-5 w-5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
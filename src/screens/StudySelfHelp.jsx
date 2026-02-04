import { useLocation, useNavigate } from "react-router-dom";

/* ---------- Minimal icons ---------- */
function IconBook(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 5.5h10a3 3 0 0 1 3 3v11H7.5a3 3 0 0 0-3 3v-17Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 19.5V8.5A3 3 0 0 1 10.5 5.5h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.5 12.5 10 17l8.5-9"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function StudySelfHelp() {
  const navigate = useNavigate();
  const location = useLocation();
  const country = new URLSearchParams(location.search).get("country") || "";

  const goBackToChoice = () => {
    // goes back to /app/study and re-opens the modal for the same country
    navigate(`/app/study?country=${encodeURIComponent(country)}&from=choice`);
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
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70 border border-emerald-100">
                <IconBook className="h-4 w-4 text-emerald-700" />
              </span>
              Study Abroad · Self-Help
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Do it yourself, step by step
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Follow trusted resources and official guidance.
            </p>
          </div>

          {/* Decorative */}
          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {/* Country */}
        <div className="mt-5 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold text-zinc-500">Selected country</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {country || "Not selected"}
          </p>
        </div>

        {/* Content */}
        <div className="mt-6 grid gap-4">
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
            <h2 className="text-sm font-semibold text-zinc-900">
              What you’ll find here
            </h2>

            <ul className="mt-4 grid gap-3 text-sm text-zinc-700">
              <li className="flex items-start gap-3">
                <IconCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
                Official university and admissions links
              </li>

              <li className="flex items-start gap-3">
                <IconCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
                Visa and embassy application guidance
              </li>

              <li className="flex items-start gap-3">
                <IconCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
                Scholarships and funding resources
              </li>

              <li className="flex items-start gap-3">
                <IconCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
                Timelines and common mistakes to avoid
              </li>
            </ul>
          </div>

          {/* Placeholder */}
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/40 p-5 text-sm text-zinc-600">
            Detailed step-by-step guides coming soon.
            <br />
            Powered by MAJUU.
          </div>
        </div>
      </div>
    </div>
  );
}
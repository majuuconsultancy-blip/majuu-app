import { useNavigate } from "react-router-dom";

import { smartBack } from "../utils/navBack";

function IconArrowLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 18 8.5 12l6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DummyPaymentScreen() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-white px-4 py-6">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => smartBack(navigate, "/app/progress")}
          className="mb-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="rounded-3xl border border-zinc-200/80 bg-white/90 p-5 shadow-sm">
          <h1 className="text-lg font-semibold text-zinc-900">Legacy payment screen retired</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Payments now run through the M-Pesa STK push flow and are confirmed by webhook.
            Restart payment from your request screen to continue.
          </p>
          <button
            type="button"
            onClick={() => navigate("/app/progress", { replace: true })}
            className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Go to Progress
          </button>
        </div>
      </div>
    </div>
  );
}

import { useNavigate } from "react-router-dom";

function IconArrowLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
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

export default function PaymentScreen() {
  const navigate = useNavigate();

  const goBack = () => {
    navigate(-1); // return to request modal
  };

  const continueFlow = () => {
    // mark payment as passed
    sessionStorage.setItem("request_paid", "true");
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white px-5 py-6">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <button
          onClick={goBack}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-zinc-700"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back
        </button>

        <h1 className="text-2xl font-semibold text-zinc-900">
          Complete payment
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Choose a payment method to continue
        </p>

        {/* Payment methods */}
        <div className="mt-6 grid gap-4">
          {/* Mpesa */}
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-zinc-900">M-Pesa</div>
                <div className="text-xs text-zinc-500">
                  Pay via Safaricom M-Pesa
                </div>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                Coming soon
              </span>
            </div>
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-zinc-900">
                  Debit / Credit Card
                </div>
                <div className="text-xs text-zinc-500">
                  Visa, Mastercard
                </div>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                Coming soon
              </span>
            </div>
          </div>
        </div>

        {/* Continue */}
        <button
          onClick={continueFlow}
          className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
        >
          Continue
        </button>

        <p className="mt-3 text-center text-xs text-zinc-500">
          You will return to your request to finish submission
        </p>
      </div>
    </div>
  );
}
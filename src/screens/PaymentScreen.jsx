import { useNavigate } from "react-router-dom";
import { smartBack } from "../utils/navBack";
import { buildLegalDocRoute, LEGAL_DOC_KEYS } from "../legal/legalRegistry";

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
    smartBack(navigate, "/app/home");
  };

  const continueFlow = () => {
    // mark payment as passed
    sessionStorage.setItem("request_paid", "true");
    navigate(-1);
  };

  const openLegalDoc = (docKey) => {
    navigate(buildLegalDocRoute(docKey, { scope: "app" }), {
      state: { backTo: "/app/payment" },
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 px-5 py-6">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <button
          onClick={goBack}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back
        </button>

        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Complete payment
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Choose a payment method to continue
        </p>

        {/* Payment methods */}
        <div className="mt-6 grid gap-4">
          {/* Mpesa */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">M-Pesa</div>
                <div className="text-xs text-zinc-500">
                  Pay via Safaricom M-Pesa
                </div>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                Coming soon
              </span>
            </div>
          </div>

          {/* Card */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                  Debit / Credit Card
                </div>
                <div className="text-xs text-zinc-500">
                  Visa, Mastercard
                </div>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
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

        <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Review{" "}
          <button
            type="button"
            onClick={() => openLegalDoc(LEGAL_DOC_KEYS.ESCROW_POLICY)}
            className="font-semibold text-emerald-700 transition hover:text-emerald-800"
          >
            Escrow Policy
          </button>{" "}
          and{" "}
          <button
            type="button"
            onClick={() => openLegalDoc(LEGAL_DOC_KEYS.REFUND_POLICY)}
            className="font-semibold text-emerald-700 transition hover:text-emerald-800"
          >
            Refund Policy
          </button>{" "}
          for payment handling details.
        </div>
      </div>
    </div>
  );
}



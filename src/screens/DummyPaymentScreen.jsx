import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { smartBack } from "../utils/navBack";
import {
  buildDummyTransactionReference,
  userPayAwaitingPayment,
} from "../services/paymentservice";
import {
  saveWorkflowDraft,
  WORKFLOW_DRAFT_STATUSES,
} from "../services/workflowdraftservice";
import { markFullPackageUnlockPaid } from "../services/fullpackageservice";
import { buildLegalDocRoute, LEGAL_DOC_KEYS } from "../legal/legalRegistry";
import {
  getDummyPaymentDraft,
  getDummyPaymentState,
  markDummyPaymentPaid,
  setDummyPaymentState,
} from "../utils/dummyPayment";
import { useRequestPricingEntry } from "../hooks/useRequestPricing";

const PROCESSING_DELAY_MS = 5000;

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

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m6.8 12.8 3.1 3.1 7.4-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function safeDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function formatCardNumber(value) {
  return safeDigits(value)
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, "$1 ")
    .trim();
}

function formatExpiry(value) {
  const digits = safeDigits(value).slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function formatCvv(value) {
  return safeDigits(value).slice(0, 4);
}

function normalizeContext(value) {
  return value && typeof value === "object" ? value : null;
}

function toAmountNumber(value) {
  const digits = String(value || "")
    .replace(/[^0-9.]+/g, "")
    .trim();
  const num = Number(digits || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

function buildReturnState({ paymentContext, formState, requestDraftId }) {
  const context = normalizeContext(paymentContext);
  if (!context) return null;

  const flow = String(context.flow || "").trim().toLowerCase();
  const mergedFormState = {
    ...(formState && typeof formState === "object" ? formState : {}),
    paid: true,
    requestDraftId: String(requestDraftId || ""),
  };

  if (flow === "wehelp") {
    const track = String(context.track || "").trim().toLowerCase();
    const serviceName = String(context.serviceName || "").trim();
    if (!track || !serviceName) return null;

    return {
      resumeWeHelp: {
        track,
        requestModal: {
          open: true,
          serviceName,
          requestType: String(context.requestType || "single"),
          step: "submit",
          formState: mergedFormState,
        },
      },
    };
  }

  if (flow === "fullpackage") {
    const track = String(context.track || "").trim().toLowerCase();
    const country = String(context.country || "").trim();
    const fullPackageId = String(context.fullPackageId || "").trim();
    const selectedItem = String(context.selectedItem || "").trim();
    if (!track) return null;

    return {
      ...(fullPackageId ? { fullPackageId } : {}),
      resumeFullPackage: {
        track,
        country,
        fullPackageId,
        selectedItem,
        requestModal: {
          open: true,
          selectedItem,
          step: "submit",
          formState: mergedFormState,
        },
      },
    };
  }

  if (flow === "fullpackageunlock" || flow === "fullpackagedeposit") {
    const track = String(context.track || "").trim().toLowerCase();
    const fullPackageId = String(context.fullPackageId || "").trim();
    const selectedItems = Array.isArray(context.selectedItems)
      ? context.selectedItems.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const unlockAmount = Number(context.unlockAmount || context.depositAmount || 0);
    if (!track || !fullPackageId) return null;

    return {
      resumeWeHelp: {
        track,
        fullPackage: {
          detailsOpen: true,
          diagnosticOpen: true,
          unlock: {
            requestDraftId: String(requestDraftId || ""),
            fullPackageId,
            selectedItems,
            unlockAmount,
          },
        },
      },
    };
  }

  return null;
}

export default function DummyPaymentScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const timerRef = useRef(null);

  const query = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);

  const requestDraftId = useMemo(() => {
    const stateValue = String(location.state?.requestDraftId || "").trim();
    if (stateValue) return stateValue;
    return String(query.get("draft") || "").trim();
  }, [location.state, query]);

  const returnTo = useMemo(() => {
    const stateValue = String(location.state?.returnTo || "").trim();
    if (stateValue) return stateValue;
    return String(query.get("returnTo") || "").trim();
  }, [location.state, query]);

  const storedDraft = useMemo(() => {
    if (!requestDraftId) return null;
    return getDummyPaymentDraft(requestDraftId);
  }, [requestDraftId]);

  const paymentContext = useMemo(() => {
    return normalizeContext(location.state?.paymentContext) || normalizeContext(storedDraft?.paymentContext);
  }, [location.state, storedDraft]);

  const paymentFlow = useMemo(() => {
    return String(paymentContext?.flow || "").trim().toLowerCase();
  }, [paymentContext]);

  const isInProgressFlow = paymentFlow === "inprogresspayment";

  const liveRequestPricing = useRequestPricingEntry({
    pricingKey: paymentContext?.pricingKey,
    track: paymentContext?.track,
    country: paymentContext?.country,
    serviceName: paymentContext?.serviceName,
    requestType: paymentContext?.requestType || "single",
  });

  const seedFormState = useMemo(() => {
    const fromState = normalizeContext(location.state?.draftForm);
    if (fromState) return fromState;
    return normalizeContext(storedDraft?.formState);
  }, [location.state, storedDraft]);

  const amount = useMemo(() => {
    const fromState = String(location.state?.amount || "").trim();
    if (fromState) return fromState;
    const fromQuery = String(query.get("amount") || "").trim();
    if (fromQuery) return fromQuery;
    const fromDraft = String(storedDraft?.amount || "").trim();
    return fromDraft || liveRequestPricing.amountText || "";
  }, [location.state, query, storedDraft, liveRequestPricing.amountText]);

  const storedPayment = useMemo(() => {
    if (isInProgressFlow) return null;
    if (!requestDraftId) return null;
    const raw = getDummyPaymentState(requestDraftId);
    return raw && typeof raw === "object" ? raw : null;
  }, [isInProgressFlow, requestDraftId]);

  const initialMethod = useMemo(() => {
    const savedMethod = String(storedPayment?.method || "").toLowerCase();
    return savedMethod === "card" ? "card" : "mpesa";
  }, [storedPayment]);

  const initialSuccess = useMemo(() => {
    const status = String(storedPayment?.status || "").toLowerCase();
    return status === "confirmed" || status === "paid";
  }, [storedPayment]);

  const [method, setMethod] = useState(initialMethod);
  const [phone, setPhone] = useState(() => String(seedFormState?.phone || ""));
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [nameOnCard, setNameOnCard] = useState(() => String(seedFormState?.name || ""));

  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(initialSuccess);
  const [error, setError] = useState("");
  const [transactionReference, setTransactionReference] = useState(() =>
    String(storedPayment?.transactionReference || storedPayment?.ref || "").trim()
  );

  const openLegalDoc = (docKey) => {
    navigate(buildLegalDocRoute(docKey, { scope: "app" }), {
      state: { backTo: `${location.pathname}${location.search}` },
    });
  };

  useEffect(() => {
    return () => {
      if (!timerRef.current) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const controlsDisabled = processing || success;

  const validate = () => {
    if (!isInProgressFlow && !requestDraftId) {
      return "Unable to identify this request draft. Go back and try again.";
    }

    if (isInProgressFlow) {
      const reqId = String(paymentContext?.requestId || "").trim();
      const payId = String(paymentContext?.paymentId || "").trim();
      if (!reqId || !payId) return "Missing payment request details. Go back and retry.";
    }

    if (method === "mpesa") {
      const digits = safeDigits(phone);
      if (digits.length < 10) return "Enter a valid M-Pesa phone number.";
      return "";
    }

    const cardDigits = safeDigits(cardNumber);
    if (cardDigits.length < 13) return "Enter a valid card number.";

    const expiryDigits = safeDigits(expiry);
    if (expiryDigits.length !== 4) return "Enter expiry in MM/YY format.";

    const month = Number(expiryDigits.slice(0, 2));
    if (month < 1 || month > 12) return "Expiry month must be between 01 and 12.";

    const cvvDigits = safeDigits(cvv);
    if (cvvDigits.length < 3) return "Enter a valid CVV.";

    if (!String(nameOnCard || "").trim()) return "Enter the cardholder name.";

    return "";
  };

  const goBack = () => {
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    smartBack(navigate, "/app/home");
  };

  const checkoutTitle = isInProgressFlow ? "Request Payment" : "Secure Payment";
  const checkoutSubtitle = isInProgressFlow
    ? "Complete this demo checkout to continue your in-progress request."
    : "Complete this demo checkout to unlock request submission.";

  const handlePayNow = () => {
    setError("Demo checkout is retired. Please restart payment from the secure hosted checkout flow.");
  };

  const handleContinue = async () => {
    if (isInProgressFlow) {
      const reqId = String(paymentContext?.requestId || "").trim();
      const payId = String(paymentContext?.paymentId || "").trim();
      if (!reqId || !payId) {
        setError("Missing payment request details. Please go back and retry.");
        return;
      }

      try {
        await userPayAwaitingPayment({
          requestId: reqId,
          paymentId: payId,
          method,
          paidAtMs: Date.now(),
        });
      } catch (payErr) {
        setError(payErr?.message || "Unable to confirm payment right now.");
        return;
      }

      if (returnTo) {
        navigate(returnTo, { replace: true });
        return;
      }
      navigate(`/app/request/${encodeURIComponent(reqId)}`, { replace: true });
      return;
    }

    if (!requestDraftId) {
      setError("Unable to continue. Please go back and retry payment.");
      return;
    }

    markDummyPaymentPaid(requestDraftId, {
      method,
      amount,
      confirmedAt: Date.now(),
      transactionReference: transactionReference || buildDummyTransactionReference(Date.now()),
    });

    const returnState = buildReturnState({
      paymentContext,
      requestDraftId,
      formState: seedFormState,
    });

    if (returnTo) {
      navigate(returnTo, {
        replace: true,
        state: returnState || undefined,
      });
      return;
    }

    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 px-4 py-6">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={goBack}
          className="mb-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="rounded-3xl border border-zinc-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/70 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.10)] backdrop-blur">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{checkoutTitle}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{checkoutSubtitle}</p>

          {amount ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-900">
              Amount: <span className="font-semibold">{amount}</span>
            </div>
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 p-1">
            <button
              type="button"
              onClick={() => setMethod("mpesa")}
              disabled={controlsDisabled}
              className={[
                "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                method === "mpesa"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-transparent text-zinc-700 dark:text-zinc-300",
              ].join(" ")}
            >
              M-Pesa
            </button>
            <button
              type="button"
              onClick={() => setMethod("card")}
              disabled={controlsDisabled}
              className={[
                "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
                method === "card"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-transparent text-zinc-700 dark:text-zinc-300",
              ].join(" ")}
            >
              Card
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            {method === "mpesa" ? (
              <div>
                <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Phone Number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={controlsDisabled}
                  placeholder="e.g. 07XXXXXXXX"
                  className="mt-1.5 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-200"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Card Number</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    disabled={controlsDisabled}
                    placeholder="1234 5678 9012 3456"
                    className="mt-1.5 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Expiry (MM/YY)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={expiry}
                      onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                      disabled={controlsDisabled}
                      placeholder="MM/YY"
                      className="mt-1.5 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">CVV</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      value={cvv}
                      onChange={(e) => setCvv(formatCvv(e.target.value))}
                      disabled={controlsDisabled}
                      placeholder="123"
                      className="mt-1.5 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Name on Card</label>
                  <input
                    type="text"
                    value={nameOnCard}
                    onChange={(e) => setNameOnCard(e.target.value)}
                    disabled={controlsDisabled}
                    placeholder="Cardholder name"
                    className="mt-1.5 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                </div>
              </>
            )}
          </div>

          {processing ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
              <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-emerald-600" />
              Processing payment...
            </div>
          ) : null}

          {success ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-900">
              <div className="flex items-center gap-2 font-semibold">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <IconCheck className="h-4 w-4" />
                </span>
                Payment Confirmed
              </div>
              <p className="mt-1 text-sm">We have received your payment.</p>
              {transactionReference ? (
                <p className="mt-1 text-xs text-emerald-900/80">
                  Ref: <span className="font-semibold">{transactionReference}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          {!success ? (
            <button
              type="button"
              onClick={handlePayNow}
              disabled={processing}
              className="mt-5 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
            >
              Pay Now
            </button>
          ) : (
            <button
              type="button"
              onClick={handleContinue}
              className="mt-5 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99]"
            >
              Continue
            </button>
          )}

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
            if you need payment handling details before continuing.
          </div>
        </div>
      </div>
    </div>
  );
}

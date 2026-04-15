import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import {
  createPaymentCheckoutSession,
  paymentStatusUi,
  resolveSharedPaymentLink,
} from "../services/paymentservice";

function safeStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function isValidEmail(value) {
  const email = safeStr(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").slice(-12);
}

export default function SharedPaymentScreen() {
  const { shareToken = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    resolveSharedPaymentLink({ shareToken })
      .then((result) => {
        if (cancelled) return;
        setPayload(result);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError?.message || "This payment link could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  const startPayment = async () => {
    const cleanEmail = safeStr(email, 160).toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError("Enter a valid email address before continuing.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const session = await createPaymentCheckoutSession({
        shareToken,
        email: cleanEmail,
        phoneNumber: normalizePhone(phoneNumber),
        appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
        returnTo: `${location.pathname}${location.search || ""}`,
      });
      const redirectUrl = safeStr(session?.authorizationUrl || session?.redirectUrl, 1000);
      if (!redirectUrl) {
        throw new Error("Hosted checkout is unavailable right now.");
      }
      window.location.assign(redirectUrl);
    } catch (nextError) {
      setError(nextError?.message || "Failed to start payment.");
      setBusy(false);
    }
  };

  const payment = payload?.payment || null;
  const valid = payload?.valid === true && payment;
  const alreadyPaid = payload?.alreadyPaid === true || payload?.reason === "already_paid";

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white px-5 py-10">
      <div className="mx-auto max-w-md rounded-3xl border border-zinc-200 bg-white/85 p-6 shadow-sm">
        <button
          type="button"
          onClick={() => navigate("/login")}
          className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-700"
        >
          Back
        </button>

        <div className="mt-5 text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700">
          Shared Full Payment
        </div>
        <h1 className="mt-3 text-xl font-semibold text-zinc-900">
          {loading ? "Checking link" : valid ? payment.paymentLabel : "Payment link unavailable"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {loading
            ? "We are checking whether this payment request is still valid."
            : valid
            ? "This link can only be used to pay the full currently approved amount."
            : alreadyPaid
            ? "This payment link has already been paid."
            : error || "This payment link is no longer valid."}
        </p>

        {valid ? (
          <div className="mt-5 grid gap-4">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
              <div className="text-sm font-semibold text-zinc-900">{payment.paymentLabel}</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">
                {payment.currency} {Number(payment.amount || 0).toLocaleString()}
              </div>
              {Number(payment?.discountAmount || 0) > 0 ? (
                <div className="mt-2 text-xs text-emerald-700">
                  Discount applied: {payment.currency}{" "}
                  {Number(payment.discountAmount || 0).toLocaleString()}
                </div>
              ) : null}
              {safeStr(payment?.note, 600) ? (
                <div className="mt-2 text-xs text-zinc-600 whitespace-pre-wrap">
                  {safeStr(payment.note, 600)}
                </div>
              ) : null}
              <div className="mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold">
                <span className={paymentStatusUi(payment.status).cls}>
                  {paymentStatusUi(payment.status).label}
                </span>
              </div>
            </div>

            <label className="grid gap-2 text-sm font-medium text-zinc-800">
              Your email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-300"
                disabled={busy}
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-zinc-800">
              Phone number (M-PESA)
              <input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="0712345678"
                className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-300"
                disabled={busy}
              />
            </label>

            <button
              type="button"
              onClick={startPayment}
              disabled={busy}
              className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Redirecting..." : "Pay Directly"}
            </button>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}

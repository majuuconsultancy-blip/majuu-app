import { useCallback, useEffect, useMemo, useState } from "react";

function safeStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function cleanAmount(value) {
  const source = typeof value === "string" ? value.replace(/[^0-9.]+/g, "") : value;
  const num = Number(source || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

function formatMoney(amount, currency = "KES") {
  const value = cleanAmount(amount);
  const code = safeStr(currency || "KES", 8).toUpperCase() || "KES";
  return `${code} ${value.toLocaleString()}`;
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

function formatPhoneNumber(value) {
  return safeDigits(value).slice(0, 12);
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function Spinner() {
  return (
    <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
  );
}

function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.8 11.2V8.8a4.2 4.2 0 1 1 8.4 0v2.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect
        x="5.5"
        y="11.2"
        width="13"
        height="9.3"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function IconCard(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 10h17" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7.5 14.2h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="7.5" y="3.5" width="9" height="17" rx="2.3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.2 6.8h3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="0.9" fill="currentColor" />
    </svg>
  );
}

function MethodButton({ active, icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition",
        active
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-[0_10px_24px_rgba(16,185,129,0.10)]"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
        disabled ? "cursor-not-allowed opacity-70" : "",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DemoPaystackCheckoutModal({
  email,
  amount,
  currency,
  reference,
  metadata,
  onResolve,
  onReject,
}) {
  const [entered, setEntered] = useState(false);
  const [method, setMethod] = useState("card");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const amountLabel = useMemo(() => formatMoney(amount, currency), [amount, currency]);
  const maskedReference = useMemo(() => safeStr(reference, 120) || "DEMO-CHECKOUT", [reference]);
  const payerEmail = useMemo(() => safeStr(email, 160).toLowerCase(), [email]);
  const flowLabel = useMemo(() => safeStr(metadata?.flowType || metadata?.paymentType || "checkout", 60), [metadata]);
  const paymentLabel = useMemo(
    () => safeStr(metadata?.paymentLabel || metadata?.serviceName || metadata?.label, 120),
    [metadata]
  );
  const discountAmount = useMemo(() => cleanAmount(metadata?.discountAmount || 0), [metadata]);
  const paymentNote = useMemo(() => safeStr(metadata?.note, 280), [metadata]);
  const cancelCheckout = useCallback(() => {
    if (processing) return;
    onReject(new Error("Demo checkout cancelled."));
  }, [onReject, processing]);

  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 12);
    const onKeyDown = (event) => {
      if (event.key === "Escape") cancelCheckout();
    };
    const onNativeBack = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      cancelCheckout();
    };
    const onPopState = (event) => {
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      cancelCheckout();
    };

    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("backbutton", onNativeBack);
    window.addEventListener("popstate", onPopState, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("backbutton", onNativeBack);
      window.removeEventListener("popstate", onPopState, true);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [cancelCheckout]);

  const canSubmit = useMemo(() => {
    if (processing) return false;
    if (method === "mpesa") {
      return safeDigits(phoneNumber).length >= 10;
    }
    return (
      safeDigits(cardNumber).length >= 12 &&
      safeDigits(expiry).length === 4 &&
      safeDigits(cvv).length >= 3
    );
  }, [processing, method, phoneNumber, cardNumber, expiry, cvv]);

  const handlePay = async () => {
    if (!canSubmit) {
      setError(
        method === "mpesa"
          ? "Enter the M-PESA phone number to continue."
          : "Enter payment details to continue."
      );
      return;
    }

    setProcessing(true);
    setError("");
    await wait(2000);

    if (Math.random() < 0.9) {
      onResolve({
        status: "success",
        reference: `DEMO-${Date.now()}`,
        method,
        provider: method === "mpesa" ? "mpesa" : "",
        phone: method === "mpesa" ? phoneNumber : "",
      });
      return;
    }

    setProcessing(false);
    setError("Payment failed. Try again.");
  };

  return (
    <div
      className={[
        "fixed inset-0 z-[1200] flex items-center justify-center px-4 py-6 transition duration-200",
        entered ? "bg-zinc-950/45 opacity-100 backdrop-blur-[2px]" : "bg-zinc-950/0 opacity-0",
      ].join(" ")}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          cancelCheckout();
        }
      }}
      role="presentation"
    >
      <div
        className={[
          "w-full max-w-[430px] overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.22)] transition duration-200",
          entered ? "translate-y-0 scale-100" : "translate-y-3 scale-[0.985]",
        ].join(" ")}
      >
        <div className="bg-[linear-gradient(135deg,#f8fffb_0%,#ffffff_58%,#eefaf4_100%)] px-6 pb-5 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                MAJUU Pay
              </div>
              <div className="mt-4 text-sm font-medium text-zinc-500">Paying with</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">{payerEmail || "demo@majuu.app"}</div>
            </div>
            <button
              type="button"
              onClick={cancelCheckout}
              disabled={processing}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 disabled:opacity-50"
              aria-label="Close demo checkout"
            >
              <span className="text-lg leading-none">x</span>
            </button>
          </div>

          <div className="mt-5 rounded-[24px] border border-emerald-100 bg-white px-5 py-4 shadow-[0_12px_30px_rgba(16,185,129,0.08)]">
            {paymentLabel ? (
              <div className="text-xs font-medium text-zinc-600">For: {paymentLabel}</div>
            ) : null}
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Amount</div>
            <div className="mt-2 text-[2rem] font-semibold leading-none tracking-tight text-zinc-950">
              {amountLabel}
            </div>
            {discountAmount > 0 ? (
              <div className="mt-2 text-xs text-emerald-700">
                Discount applied: {formatMoney(discountAmount, currency)}
              </div>
            ) : null}
            {paymentNote ? (
              <div className="mt-2 text-xs text-zinc-600 whitespace-pre-wrap">{paymentNote}</div>
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-500">
              <span>Reference: {maskedReference}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                {flowLabel || "checkout"}
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6 pt-5">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Payment Method
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MethodButton active={method === "card"} icon={<IconCard className="h-4 w-4" />} label="Card" onClick={() => setMethod("card")} disabled={processing} />
            <MethodButton active={method === "mpesa"} icon={<IconPhone className="h-4 w-4" />} label="M-PESA" onClick={() => setMethod("mpesa")} disabled={processing} />
          </div>

          <div className="mt-5 rounded-[24px] border border-zinc-200 bg-zinc-50/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-zinc-900">Authorization details</div>
              <div className="text-xs text-zinc-500">
                {method === "card" ? "Card payment" : "M-PESA payment"}
              </div>
            </div>

            <div className="grid gap-3">
              {method === "card" ? (
                <>
                  <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                    Card Number
                    <input
                      value={cardNumber}
                      onChange={(event) => setCardNumber(formatCardNumber(event.target.value))}
                      inputMode="numeric"
                      autoFocus
                      disabled={processing}
                      placeholder="4084 0840 8408 4081"
                      className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:bg-zinc-100"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      Expiry
                      <input
                        value={expiry}
                        onChange={(event) => setExpiry(formatExpiry(event.target.value))}
                        inputMode="numeric"
                        disabled={processing}
                        placeholder="09/28"
                        className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:bg-zinc-100"
                      />
                    </label>

                    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                      CVV
                      <input
                        value={cvv}
                        onChange={(event) => setCvv(formatCvv(event.target.value))}
                        inputMode="numeric"
                        disabled={processing}
                        placeholder="123"
                        className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:bg-zinc-100"
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {method === "mpesa" ? (
                <>
                  <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
                    M-PESA Phone Number
                    <input
                      value={phoneNumber}
                      onChange={(event) => setPhoneNumber(formatPhoneNumber(event.target.value))}
                      inputMode="tel"
                      autoFocus
                      disabled={processing}
                      placeholder="0712345678"
                      className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 disabled:bg-zinc-100"
                    />
                  </label>

                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                    STK push will come here later. For now, demo mode only needs the mobile number.
                  </div>
                </>
              ) : null}

              <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500">
                Demo mode keeps all payment methods interactive while using a single secure-looking authorization form.
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={!canSubmit}
            className={[
              "mt-5 flex w-full items-center justify-center gap-2 rounded-[22px] px-4 py-3.5 text-sm font-semibold text-white transition",
              canSubmit
                ? "bg-emerald-600 shadow-[0_16px_32px_rgba(5,150,105,0.22)] hover:bg-emerald-700"
                : "bg-zinc-300",
            ].join(" ")}
          >
            {processing ? <Spinner /> : <IconLock className="h-4 w-4" />}
            <span>{processing ? "Processing payment..." : `Pay ${amountLabel}`}</span>
          </button>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-zinc-500">
            <IconLock className="h-4 w-4" />
            <span>Secured by MAJUU Payments - Demo Mode</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DemoPaystackCheckoutModal;

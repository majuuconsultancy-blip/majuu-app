import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, DollarSign, X } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import {
  fetchCurrencyQuote,
  getCurrencyMeta,
  getSupportedSelfHelpCurrencies,
} from "./selfHelpCurrency";

function safeAmount(value) {
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 2) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("")}`;
}

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0.00";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function CurrencyConverterSheet({
  open,
  onClose,
  destinationCountry = "",
  profileCountry = "",
  localCurrency = "",
  destinationCurrency = "",
}) {
  const [amount, setAmount] = useState("1000");
  const [fromCurrency, setFromCurrency] = useState(localCurrency || "");
  const [toCurrency, setToCurrency] = useState(destinationCurrency || "");
  const [quote, setQuote] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const supportedCurrencies = useMemo(() => getSupportedSelfHelpCurrencies(), []);

  useEffect(() => {
    if (!open) return;
    if (!fromCurrency || !toCurrency) return;
    if (!amount || Number(amount) <= 0) return;

    const controller = new AbortController();
    const run = async () => {
      setStatus("loading");
      setError("");

      try {
        const nextQuote = await fetchCurrencyQuote({
          amount: Number(amount),
          from: fromCurrency,
          to: toCurrency,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setQuote(nextQuote);
        setStatus("ready");
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setQuote(null);
        setStatus("error");
        setError(nextError?.message || "We could not load live rates right now.");
      }
    };

    void run();

    return () => controller.abort();
  }, [amount, fromCurrency, open, toCurrency]);

  if (!open) return null;

  const fromMeta = getCurrencyMeta(fromCurrency);
  const toMeta = getCurrencyMeta(toCurrency);
  const needsManualLocalCurrency = !localCurrency;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 app-overlay-safe">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-[28px] border border-zinc-200/80 bg-white/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/92"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
              <AppIcon size={ICON_SM} icon={DollarSign} />
              Currency converter
            </div>
            <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Fast planning rates
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Local side starts from {profileCountry || "your profile"} and converts into{" "}
              {destinationCountry || "your destination"} by default.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-900"
            aria-label="Close currency converter"
          >
            <AppIcon size={ICON_MD} icon={X} />
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              Amount
            </div>
            <input
              value={amount}
              onChange={(event) => setAmount(safeAmount(event.target.value))}
              inputMode="decimal"
              placeholder="1000"
              className="mt-2 w-full border-0 bg-transparent p-0 text-2xl font-semibold text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                From
              </div>
              <select
                value={fromCurrency}
                onChange={(event) => setFromCurrency(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-white/85 px-3 py-2.5 text-sm font-semibold text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100"
              >
                <option value="">Select currency</option>
                {supportedCurrencies.map((currency) => (
                  <option key={`from-${currency.code}`} value={currency.code}>
                    {currency.code} - {currency.label}
                  </option>
                ))}
              </select>
              {fromMeta ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {fromMeta.symbol} {fromMeta.label}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                setFromCurrency(toCurrency);
                setToCurrency(fromCurrency);
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white/85 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-900"
              aria-label="Switch currencies"
            >
              <AppIcon size={ICON_MD} icon={ArrowUpDown} />
            </button>

            <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                To
              </div>
              <select
                value={toCurrency}
                onChange={(event) => setToCurrency(event.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-200 bg-white/85 px-3 py-2.5 text-sm font-semibold text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100"
              >
                <option value="">Select currency</option>
                {supportedCurrencies.map((currency) => (
                  <option key={`to-${currency.code}`} value={currency.code}>
                    {currency.code} - {currency.label}
                  </option>
                ))}
              </select>
              {toMeta ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {toMeta.symbol} {toMeta.label}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/35 dark:bg-emerald-950/20">
          {status === "loading" ? (
            <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
              Refreshing live rate...
            </div>
          ) : null}

          {status === "ready" && quote ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                Converted estimate
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                {formatAmount(quote.convertedAmount)} {quote.to}
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                {formatAmount(quote.amount)} {quote.from} at {quote.rate.toFixed(4)} per {quote.from}
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Indicative live rate{quote.date ? ` from ${quote.date}` : ""}.
              </div>
            </>
          ) : null}

          {status === "error" ? (
            <div className="text-sm text-rose-700 dark:text-rose-300">{error}</div>
          ) : null}

          {status === "idle" ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Add an amount and pick both currencies to load a quick estimate.
            </div>
          ) : null}
        </div>

        {needsManualLocalCurrency ? (
          <div className="mt-4 text-xs text-amber-700 dark:text-amber-300">
            We could not infer your local currency from profile yet. Choose it once here, or update
            your country of residence in Profile.
          </div>
        ) : null}

        <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Live rates are indicative and can shift during the day.
        </div>
      </div>
    </div>
  );
}

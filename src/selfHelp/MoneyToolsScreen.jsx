import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRightLeft,
  Briefcase,
  CalendarDays,
  DollarSign,
  GraduationCap,
  Plane,
} from "lucide-react";
import { motion as Motion } from "../utils/motionProxy";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { auth } from "../firebase";
import { getUserState } from "../services/userservice";
import { SELF_HELP_TRACK_META } from "./selfHelpCatalog";
import {
  buildCurrencyToolState,
  buildTimelinePlan,
  getMoneyToolTabs,
  getTimelineTargetMeta,
  hydrateBudgetPlannerRows,
  hydrateTimelineState,
} from "./moneyToolsConfig";
import {
  fetchCurrencyQuote,
  getCurrencyForCountry,
  getKnownExchangeRate,
  getCurrencyMeta,
  getSupportedSelfHelpCurrencies,
} from "./selfHelpCurrency";
import {
  buildMoneyToolsRouteTarget,
  buildSelfHelpRouteTarget,
} from "./selfHelpLinking";
import {
  getSelfHelpMoneyToolsState,
  getSelfHelpProgress,
  getSelfHelpRouteState,
  peekSelfHelpProgress,
  saveSelfHelpMoneyToolsState,
} from "./selfHelpProgressStore";

const TRACK_ICONS = {
  study: GraduationCap,
  work: Briefcase,
  travel: Plane,
};

const pageMotion = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] },
  },
};

function safeString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

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

function formatMonthLabel(value) {
  const text = safeString(value, 10);
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) return "Set month";

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return "Set month";
  }

  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function uniqueCurrencies(localCurrency, destinationCurrency, stateCurrencies = []) {
  return Array.from(
    new Set(
      [localCurrency, destinationCurrency, ...stateCurrencies]
        .map((value) => safeString(value, 6).toUpperCase())
        .filter(Boolean)
    )
  );
}

function buildRouteSearch(country) {
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  return params.toString() ? `?${params.toString()}` : "";
}

function resolveProfileCountry(userState) {
  return safeString(
    userState?.countryOfResidence ||
      userState?.nationality ||
      userState?.country ||
      userState?.residenceCountry,
    80
  );
}

function readProfileCountryCache(uid) {
  if (!uid || typeof window === "undefined") return "";

  try {
    const raw = window.localStorage.getItem(`majuu_profile_cache_${uid}`);
    const parsed = JSON.parse(raw || "null");
    return resolveProfileCountry(parsed);
  } catch {
    return "";
  }
}

function useExchangeRate(fromCurrency, toCurrency) {
  const [exchangeState, setExchangeState] = useState({
    status: "idle",
    error: "",
    rate: getKnownExchangeRate(fromCurrency, toCurrency),
    date: "",
    sourceLabel: "",
    sourceUrl: "",
    isFallback: false,
  });

  useEffect(() => {
    const knownRate = getKnownExchangeRate(fromCurrency, toCurrency);
    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return;

    const controller = new AbortController();
    const run = async () => {
      setExchangeState({
        status: "loading",
        error: "",
        rate: knownRate,
        date: "",
        sourceLabel: "",
        sourceUrl: "",
        isFallback: knownRate !== 1,
      });

      try {
        const quote = await fetchCurrencyQuote({
          amount: 1,
          from: fromCurrency,
          to: toCurrency,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setExchangeState({
          status: "ready",
          error: "",
          rate: Number(quote.rate || 1) || 1,
          date: safeString(quote.date, 20),
          sourceLabel: safeString(quote.sourceLabel, 80),
          sourceUrl: safeString(quote.sourceUrl, 240),
          isFallback: Boolean(quote.isFallback),
        });
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setExchangeState({
          status: "error",
          error: nextError?.message || "We could not load the latest rate.",
          rate: 1,
          date: "",
          sourceLabel: "",
          sourceUrl: "",
          isFallback: false,
        });
      }
    };

    void run();
    return () => controller.abort();
  }, [fromCurrency, toCurrency]);

  if (!fromCurrency || !toCurrency) {
    return {
      rate: 1,
      status: "idle",
      error: "",
      date: "",
      sourceLabel: "",
      sourceUrl: "",
      isFallback: false,
    };
  }

  if (fromCurrency === toCurrency) {
    return {
      rate: 1,
      status: "ready",
      error: "",
      date: "",
      sourceLabel: "Same currency",
      sourceUrl: "",
      isFallback: false,
    };
  }

  return exchangeState;
}

function CurrencyTab({ value, onChange }) {
  const supportedCurrencies = useMemo(() => getSupportedSelfHelpCurrencies(), []);
  const [quoteState, setQuoteState] = useState({
    status: "idle",
    error: "",
    quote: null,
  });

  const amount = value?.amount || "";
  const fromCurrency = value?.fromCurrency || "";
  const toCurrency = value?.toCurrency || "";

  useEffect(() => {
    if (!fromCurrency || !toCurrency || !amount || Number(amount) <= 0) return;

    const controller = new AbortController();
    const run = async () => {
      setQuoteState({
        status: "loading",
        error: "",
        quote: null,
      });

      try {
        const nextQuote = await fetchCurrencyQuote({
          amount: Number(amount),
          from: fromCurrency,
          to: toCurrency,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setQuoteState({
          status: "ready",
          error: "",
          quote: nextQuote,
        });
      } catch (nextError) {
        if (controller.signal.aborted) return;
        setQuoteState({
          status: "error",
          error: nextError?.message || "We could not load a live quote right now.",
          quote: null,
        });
      }
    };

    void run();
    return () => controller.abort();
  }, [amount, fromCurrency, toCurrency]);

  const fromMeta = getCurrencyMeta(fromCurrency);
  const toMeta = getCurrencyMeta(toCurrency);
  const currencyState =
    !fromCurrency || !toCurrency || !amount || Number(amount) <= 0
      ? { status: "idle", error: "", quote: null }
      : quoteState;

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-zinc-200/80 bg-white/85 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Converter
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            Amount
          </div>
          <input
            value={amount}
            onChange={(event) =>
              onChange({
                ...value,
                amount: safeAmount(event.target.value),
              })
            }
            inputMode="decimal"
            placeholder="1000"
            className="mt-2 w-full border-0 bg-transparent p-0 text-2xl font-semibold text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              From
            </div>
            <select
              value={fromCurrency}
              onChange={(event) =>
                onChange({
                  ...value,
                  fromCurrency: event.target.value,
                })
              }
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
            onClick={() =>
              onChange({
                ...value,
                fromCurrency: toCurrency,
                toCurrency: fromCurrency,
              })
            }
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white/85 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 dark:hover:bg-zinc-900"
            aria-label="Switch currencies"
          >
            <AppIcon size={ICON_MD} icon={ArrowRightLeft} />
          </button>

          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-3 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              To
            </div>
            <select
              value={toCurrency}
              onChange={(event) =>
                onChange({
                  ...value,
                  toCurrency: event.target.value,
                })
              }
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

        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/35 dark:bg-emerald-950/20">
          {currencyState.status === "loading" ? (
            <div className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
              Refreshing rate...
            </div>
          ) : null}

          {currencyState.status === "ready" && currencyState.quote ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                Converted amount
              </div>
              <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                {formatAmount(currencyState.quote.convertedAmount)} {currencyState.quote.to}
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                {formatAmount(currencyState.quote.amount)} {currencyState.quote.from} at{" "}
                {currencyState.quote.rate.toFixed(4)} per {currencyState.quote.from}
              </div>
              {currencyState.quote.date ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {currencyState.quote.isFallback ? "Fallback snapshot" : "Latest rate"} on{" "}
                  {currencyState.quote.date} via {currencyState.quote.sourceLabel}
                </div>
              ) : null}
              {currencyState.quote.sourceUrl ? (
                <a
                  href={currencyState.quote.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex text-xs font-semibold text-emerald-800 underline underline-offset-2 dark:text-emerald-200"
                >
                  Rate source
                </a>
              ) : null}
            </>
          ) : null}

          {currencyState.status === "error" ? (
            <div className="text-sm text-rose-700 dark:text-rose-300">{currencyState.error}</div>
          ) : null}

          {currencyState.status === "idle" ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              Enter an amount and choose both currencies.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlannerTab({
  localCurrency,
  destinationCurrency,
  rows,
  onRowsChange,
}) {
  const currencyOptions = useMemo(
    () => uniqueCurrencies(localCurrency, destinationCurrency, rows.map((row) => row.currency)),
    [destinationCurrency, localCurrency, rows]
  );
  const { rate, status, error, date, sourceLabel, sourceUrl } = useExchangeRate(
    localCurrency,
    destinationCurrency
  );
  const effectiveRate = Number(rate || 0) > 0 ? Number(rate) : getKnownExchangeRate(localCurrency, destinationCurrency);

  const totals = useMemo(() => {
    return rows.reduce(
      (summary, row) => {
        const amount = Number(row.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          return summary;
        }

        if (row.currency === localCurrency) {
          summary.local += amount;
          summary.destination += localCurrency === destinationCurrency ? amount : amount * effectiveRate;
          return summary;
        }

        if (row.currency === destinationCurrency) {
          summary.destination += amount;
          summary.local += localCurrency === destinationCurrency ? amount : amount / (effectiveRate || 1);
          return summary;
        }

        summary.destination += amount;
        return summary;
      },
      { local: 0, destination: 0 }
    );
  }, [destinationCurrency, effectiveRate, localCurrency, rows]);

  const localMeta = getCurrencyMeta(localCurrency);
  const destinationMeta = getCurrencyMeta(destinationCurrency);

  const convertRowAmount = (amount, fromCurrency, toCurrency) => {
    const numeric = Number(amount || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return safeAmount(amount);
    }

    if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
      return safeAmount(amount);
    }

    if (fromCurrency === localCurrency && toCurrency === destinationCurrency) {
      return String((numeric * (effectiveRate || 1)).toFixed(2));
    }

    if (fromCurrency === destinationCurrency && toCurrency === localCurrency) {
      return String((numeric / (effectiveRate || 1)).toFixed(2));
    }

    return safeAmount(amount);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-zinc-200/80 bg-white/85 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Budget Plan
        </div>

        <div className="mt-4 grid gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/85 p-3 dark:border-zinc-800 dark:bg-zinc-900/55 sm:grid-cols-[1.3fr_1fr_0.8fr]"
            >
              <div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {row.label}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Estimate
                </div>
              </div>

              <input
                value={row.amount}
                onChange={(event) => {
                  const nextValue = safeAmount(event.target.value);
                  onRowsChange(
                    rows.map((item) =>
                      item.id === row.id ? { ...item, amount: nextValue } : item
                    )
                  );
                }}
                inputMode="decimal"
                placeholder="0"
                className="w-full rounded-xl border border-zinc-200 bg-white/90 px-3 py-2.5 text-sm font-semibold text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100"
              />

              <select
                value={row.currency}
                onChange={(event) =>
                  onRowsChange(
                    rows.map((item) =>
                      item.id === row.id
                        ? {
                            ...item,
                            amount: convertRowAmount(item.amount, item.currency, event.target.value),
                            currency: event.target.value,
                          }
                        : item
                    )
                  )
                }
                className="w-full rounded-xl border border-zinc-200 bg-white/90 px-3 py-2.5 text-sm font-semibold text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100"
              >
                {currencyOptions.length === 0 ? <option value="">Select currency</option> : null}
                {currencyOptions.map((currencyCode) => (
                  <option key={`${row.id}-${currencyCode}`} value={currencyCode}>
                    {currencyCode}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              Local total
            </div>
            <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {localCurrency ? `${formatAmount(totals.local)} ${localCurrency}` : "Set profile country"}
            </div>
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {localMeta ? `${localMeta.symbol} ${localMeta.label}` : "Add your residence country in Profile."}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/35 dark:bg-emerald-950/20">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
              Destination total
            </div>
            <div className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {destinationCurrency
                ? `${formatAmount(totals.destination)} ${destinationCurrency}`
                : "Set destination"}
            </div>
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {destinationMeta
                ? `${destinationMeta.symbol} ${destinationMeta.label}`
                : "Pick a destination country in SelfHelp."}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/70 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/35 dark:text-zinc-300">
          {status === "loading" ? "Refreshing rate..." : null}
          {status === "ready" && localCurrency && destinationCurrency ? (
            <span>
              Rate: 1 {localCurrency} = {effectiveRate.toFixed(4)} {destinationCurrency}
            </span>
          ) : null}
          {status === "error" ? <span className="text-rose-700 dark:text-rose-300">{error}</span> : null}
          {!localCurrency || !destinationCurrency ? (
            <span>Set both your profile and destination countries to compare totals.</span>
          ) : null}
          {status === "ready" && date ? (
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {date} via {sourceLabel || "exchange source"}
              {sourceUrl ? (
                <>
                  {" "}
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-emerald-800 underline underline-offset-2 dark:text-emerald-200"
                  >
                    source
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TimelineTab({
  track,
  trackLabel,
  country,
  profileCountry,
  value,
  onChange,
  completedStepIds,
}) {
  const targetMeta = useMemo(() => getTimelineTargetMeta(track), [track]);
  const journeyCompleted = useMemo(
    () =>
      new Set(
        (Array.isArray(completedStepIds) ? completedStepIds : [])
          .map((item) => safeString(item, 80))
          .filter(Boolean)
      ),
    [completedStepIds]
  );
  const targetMonth = value?.targetMonth || "";
  const items = Array.isArray(value?.items) ? value.items : [];

  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-zinc-200/80 bg-white/85 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Timeline planner
        </div>
        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          Timeline for {trackLabel} to {country || "your destination"}.
        </div>

        <div className="mt-4 grid gap-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/85 p-4 dark:border-zinc-800 dark:bg-zinc-900/55 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              Timeline input
            </div>
            <div className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {targetMeta.label}
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {formatMonthLabel(targetMonth)}
            </div>
            {profileCountry ? (
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Using {profileCountry} lead-time assumptions where relevant.
              </div>
            ) : null}
          </div>

          <input
            type="month"
            value={targetMonth}
            onChange={(event) => {
              const nextTargetMonth = event.target.value;
              const nextItems = buildTimelinePlan(track, nextTargetMonth, profileCountry).map((item) => {
                const existing = items.find((entry) => entry.id === item.id);
                return {
                  ...item,
                  completed: Boolean(existing?.completed),
                  month: item.month,
                };
              });
              onChange({
                targetMonth: nextTargetMonth,
                items: nextItems,
              });
            }}
            className="w-full rounded-xl border border-zinc-200 bg-white/90 px-3 py-2.5 text-sm font-semibold text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-100 sm:w-auto"
          />
        </div>

        <div className="mt-4 grid gap-3">
          {items.map((item, index) => {
            const linkedToJourney = journeyCompleted.has(item.id);
            return (
              <div
                key={item.id}
                className={`grid gap-3 rounded-2xl border p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                  item.completed
                    ? "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/35 dark:bg-emerald-950/18"
                    : "border-zinc-200/80 bg-zinc-50/85 dark:border-zinc-800 dark:bg-zinc-900/55"
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      items: items.map((entry) =>
                        entry.id === item.id ? { ...entry, completed: !entry.completed } : entry
                      ),
                    })
                  }
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-sm font-semibold transition ${
                    item.completed
                      ? "border-emerald-200 bg-emerald-600 text-white dark:border-emerald-900/40"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200"
                  }`}
                  aria-label={item.completed ? `Mark ${item.title} incomplete` : `Mark ${item.title} complete`}
                >
                  {item.completed ? "OK" : index + 1}
                </button>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </div>
                    {linkedToJourney ? (
                      <span className="rounded-full border border-emerald-100 bg-emerald-50/75 px-2 py-0.5 text-[11px] font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                        Done in journey
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {formatMonthLabel(item.month)}
                  </div>
                </div>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                  {index + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MoneyToolsPanels({
  uid,
  progress,
  setProgress,
  setStatusMsg,
  track,
  trackLabel,
  country,
  profileCountry,
  localCurrency,
  destinationCurrency,
  activeTab,
}) {
  const stored = useMemo(
    () => getSelfHelpMoneyToolsState(progress, track, country),
    [country, progress, track]
  );
  const routeState = useMemo(
    () => getSelfHelpRouteState(progress, track, country),
    [country, progress, track]
  );
  const completedStepIds = routeState?.completedStepIds || [];
  const [currencyState, setCurrencyState] = useState(() =>
    buildCurrencyToolState(localCurrency, destinationCurrency, stored.currency)
  );
  const [plannerRows, setPlannerRows] = useState(() =>
    hydrateBudgetPlannerRows(track, localCurrency, destinationCurrency, stored.planner?.rows)
  );
  const [timelineState, setTimelineState] = useState(() =>
    hydrateTimelineState(track, stored.timeline, profileCountry)
  );
  const skipNextSaveRef = useRef(true);

  useEffect(() => {
    if (!uid || !country) return;

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await saveSelfHelpMoneyToolsState(uid, {
            track,
            country,
            routePath: `/app/${track}/self-help`,
            routeSearch: buildRouteSearch(country),
            moneyTools: {
              currency: currencyState,
              planner: { rows: plannerRows },
              timeline: timelineState,
            },
          });
          setProgress(next);
        } catch (error) {
          console.error("MoneyTools save failed:", error);
          setStatusMsg("We could not save your money tools changes right now.");
        }
      })();
    }, 320);

    return () => window.clearTimeout(timer);
  }, [country, currencyState, plannerRows, setProgress, setStatusMsg, timelineState, track, uid]);

  let activePanel = (
    <CurrencyTab
      profileCountry={profileCountry}
      destinationCountry={country}
      value={currencyState}
      onChange={setCurrencyState}
    />
  );

  if (activeTab === "planner") {
    activePanel = (
      <PlannerTab
        trackLabel={trackLabel}
        country={country}
        localCurrency={localCurrency}
        destinationCurrency={destinationCurrency}
        profileCountry={profileCountry}
        rows={plannerRows}
        onRowsChange={setPlannerRows}
      />
    );
  }

  if (activeTab === "timeline") {
    activePanel = (
      <TimelineTab
        track={track}
        trackLabel={trackLabel}
        country={country}
        profileCountry={profileCountry}
        value={timelineState}
        onChange={setTimelineState}
        completedStepIds={completedStepIds}
      />
    );
  }

  return (
    <>
      <Motion.div
        key={`money-tab-${activeTab}`}
        className="mt-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {activePanel}
      </Motion.div>

      <div className="mt-6 rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300">
        <div className="inline-flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
          <AppIcon size={ICON_SM} icon={CalendarDays} />
          Keep planning lightweight
        </div>
        <div className="mt-1">
          These tools are route-aware helpers for SelfHelp. Planner and timeline changes are saved per destination so you can return to the same working context later.
        </div>
      </div>
    </>
  );
}

export default function MoneyToolsScreen({ track }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const country = safeString(params.get("country"), 80);
  const tabParam = safeString(params.get("tab"), 24).toLowerCase();
  const tabs = useMemo(() => getMoneyToolTabs(), []);
  const activeTab = tabs.some((tab) => tab.id === tabParam) ? tabParam : tabs[0]?.id || "currency";
  const trackMeta = SELF_HELP_TRACK_META[track] || SELF_HELP_TRACK_META.study;
  const HeaderIcon = TRACK_ICONS[track] || GraduationCap;

  const [uid, setUid] = useState("");
  const [profileCountry, setProfileCountry] = useState("");
  const [progress, setProgress] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");

  const localCurrency = getCurrencyForCountry(profileCountry);
  const destinationCurrency = getCurrencyForCountry(country);
  const localMeta = getCurrencyMeta(localCurrency);
  const destinationMeta = getCurrencyMeta(destinationCurrency);
  const safeProgress = progress || {
    routeStates: [],
    history: [],
    bookmarks: [],
    documents: [],
    lastContext: {},
  };

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setProfileCountry(readProfileCountryCache(user.uid));
      setProgress(peekSelfHelpProgress(user.uid));

      try {
        const [userState, nextProgress] = await Promise.all([
          getUserState(user.uid),
          getSelfHelpProgress(user.uid),
        ]);
        if (!active) return;
        setProfileCountry(resolveProfileCountry(userState));
        setProgress(nextProgress);
      } catch (error) {
        console.error("MoneyTools load failed:", error);
        if (active) {
          setStatusMsg("We could not load your profile currency defaults right now.");
        }
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [navigate]);

  const selfHelpTarget = useMemo(
    () => buildSelfHelpRouteTarget({ track, country }),
    [country, track]
  );
  const workspaceKey = [uid, track, country, localCurrency, destinationCurrency, progress ? "ready" : "pending"].join("::");

  const goBack = () => {
    if (selfHelpTarget?.path) {
      navigate(`${selfHelpTarget.path}${selfHelpTarget.search || ""}`, {
        replace: true,
        state: selfHelpTarget.state,
      });
      return;
    }

    navigate(`/app/${track}/self-help`, { replace: true });
  };

  useEffect(() => {
    const backHref = selfHelpTarget?.path
      ? `${selfHelpTarget.path}${selfHelpTarget.search || ""}`
      : `/app/${track}/self-help`;

    try {
      window.history.pushState({ __majuu_moneytools: true }, "", window.location.href);
    } catch {
      // ignore
    }

    const onPopState = () => {
      navigate(backHref, {
        replace: true,
        state: selfHelpTarget?.state,
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, selfHelpTarget, track]);

  const openTab = (tabId) => {
    const nextTarget = buildMoneyToolsRouteTarget({ track, country, tab: tabId });
    if (!nextTarget?.path) return;
    navigate(`${nextTarget.path}${nextTarget.search || ""}`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/55 via-white to-white pb-8 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <Motion.div
          className="mx-auto max-w-3xl px-5 py-6"
          variants={pageMotion}
          initial="hidden"
          animate="show"
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Back
            </button>

            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/85 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
              <AppIcon size={ICON_MD} icon={DollarSign} />
            </span>
          </div>

          <div className="mt-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/80 dark:border-emerald-900/40 dark:bg-zinc-950/50">
                  <AppIcon size={ICON_SM} icon={HeaderIcon} className="text-emerald-700 dark:text-emerald-200" />
                </span>
                {trackMeta.label} money tools
              </div>

              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Money Tools
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
                Fast budgeting, live conversion, and a route-aware preparation timeline for{" "}
                {country || "your destination"}.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100">
              Local: {localCurrency || "Set in Profile"}
            </span>
            <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100">
              Destination: {destinationCurrency || "Set in SelfHelp"}
            </span>
            {localMeta ? (
              <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                {localMeta.symbol} {localMeta.label}
              </span>
            ) : null}
            {destinationMeta ? (
              <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                {destinationMeta.symbol} {destinationMeta.label}
              </span>
            ) : null}
          </div>

          {statusMsg ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/75 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/35 dark:bg-amber-950/20 dark:text-amber-100">
              {statusMsg}
            </div>
          ) : null}

          {!country ? (
            <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/85 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/55 dark:text-zinc-300">
              Open Money Tools from a destination-specific SelfHelp route to prefill the correct planning context.
            </div>
          ) : null}

          <div className="mt-6 flex justify-center">
            <div className="inline-flex flex-wrap rounded-2xl border border-zinc-200 bg-white/80 p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
            {tabs.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => openTab(tab.id)}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-950"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
            </div>
          </div>

          {uid ? (
            <MoneyToolsPanels
              key={workspaceKey}
              uid={uid}
              progress={safeProgress}
              setProgress={setProgress}
              setStatusMsg={setStatusMsg}
              track={track}
              trackLabel={trackMeta.label}
              country={country}
              profileCountry={profileCountry}
              localCurrency={localCurrency}
              destinationCurrency={destinationCurrency}
              activeTab={activeTab}
            />
          ) : null}
        </Motion.div>
      </div>
    </div>
  );
}

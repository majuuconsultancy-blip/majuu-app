import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRightLeft, ChevronRight } from "lucide-react";

import AppIcon from "../components/AppIcon";
import { ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, normalizeTrackType } from "../constants/migrationOptions";
import { useDiscoveryCountries } from "../hooks/useDiscoveryCountries";
import {
  decodeDiscoveryCountryParam,
  encodeDiscoveryCountryParam,
  toCountryLookupKey,
} from "../services/discoveryService";

function safeString(value, max = 220) {
  return String(value || "").trim().slice(0, max);
}

function parseNumber(value) {
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : null;
}

function parseDurationDays(value) {
  const input = safeString(value, 220).toLowerCase();
  if (!input) return null;
  const numbers = [...input.matchAll(/(\d+(?:\.\d+)?)/g)].map((item) => Number(item?.[1]));
  const usable = numbers.filter((num) => Number.isFinite(num) && num > 0);
  if (!usable.length) return null;
  const pivot = usable.length > 1 ? (usable[0] + usable[1]) / 2 : usable[0];
  let unit = 1;
  if (input.includes("hour")) unit = 1 / 24;
  else if (input.includes("day")) unit = 1;
  else if (input.includes("week")) unit = 7;
  else if (input.includes("month")) unit = 30;
  else if (input.includes("year")) unit = 365;
  return pivot * unit;
}

function parseCurrencyEstimate(value) {
  const input = safeString(value, 220).toLowerCase();
  if (!input) return null;
  const match = input.match(/(\d[\d,]*(?:\.\d+)?)(?:\s*([kmb]))?/i);
  if (!match) return null;
  const base = Number(String(match[1] || "").replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const suffix = safeString(match[2], 1).toLowerCase();
  if (suffix === "k") return base * 1000;
  if (suffix === "m") return base * 1000000;
  if (suffix === "b") return base * 1000000000;
  return base;
}

function parseAffordabilityRank(value) {
  const safe = safeString(value, 60).toLowerCase();
  if (!safe) return null;
  if (safe.includes("budget") || safe.includes("low") || safe.includes("tight")) return 1;
  if (safe.includes("moderate") || safe.includes("balanced") || safe.includes("mid")) return 2;
  if (safe.includes("premium") || safe.includes("high") || safe.includes("luxury")) return 3;
  return null;
}

function joinTags(value) {
  if (!Array.isArray(value)) return "";
  return value.filter(Boolean).slice(0, 4).join(", ");
}

function resolveCountryCompare(country) {
  const compareData =
    country?.compareData && typeof country.compareData === "object" ? country.compareData : {};
  return {
    visaAcceptance: parseNumber(compareData?.visaAcceptanceRatePercent ?? compareData?.visaAcceptanceRate),
    visaResultTime: safeString(compareData?.visaResultTime, 160),
    processTime: safeString(compareData?.processCompletionTime || compareData?.fullProcessDuration, 160),
    averageCost: safeString(compareData?.averageCostEstimate || compareData?.typicalApplicationCost, 160),
    startupBudget: safeString(compareData?.estimatedStarterBudget, 160),
    affordability: safeString(compareData?.affordabilityTier, 80),
    speed: parseNumber(compareData?.speedScore ?? compareData?.easeScore),
    bestFor: safeString(joinTags(compareData?.bestForTags) || compareData?.bestFor, 360) || "-",
    strength: safeString(compareData?.featuredStrength, 300) || "-",
    practicalNotes: safeString(compareData?.practicalNotes, 320) || "-",
  };
}

function pickWinner(leftValue, rightValue, prefers = "higher") {
  if (!Number.isFinite(Number(leftValue)) || !Number.isFinite(Number(rightValue))) return "";
  const left = Number(leftValue);
  const right = Number(rightValue);
  if (Math.abs(left - right) < 0.001) return "";
  if (prefers === "lower") return left < right ? "left" : "right";
  return left > right ? "left" : "right";
}

function buildCompareRows(leftCountry, rightCountry) {
  if (!leftCountry || !rightCountry) return [];
  const left = resolveCountryCompare(leftCountry);
  const right = resolveCountryCompare(rightCountry);

  return [
    {
      label: "Visa acceptance rate",
      left: Number.isFinite(left.visaAcceptance) ? `${left.visaAcceptance}%` : "-",
      right: Number.isFinite(right.visaAcceptance) ? `${right.visaAcceptance}%` : "-",
      winner: pickWinner(left.visaAcceptance, right.visaAcceptance, "higher"),
    },
    {
      label: "Visa result time",
      left: left.visaResultTime || "-",
      right: right.visaResultTime || "-",
      winner: pickWinner(parseDurationDays(left.visaResultTime), parseDurationDays(right.visaResultTime), "lower"),
    },
    {
      label: "Full process completion time",
      left: left.processTime || "-",
      right: right.processTime || "-",
      winner: pickWinner(parseDurationDays(left.processTime), parseDurationDays(right.processTime), "lower"),
    },
    {
      label: "Average cost estimate",
      left: left.averageCost || "-",
      right: right.averageCost || "-",
      winner: pickWinner(parseCurrencyEstimate(left.averageCost), parseCurrencyEstimate(right.averageCost), "lower"),
    },
    {
      label: "Estimated startup budget",
      left: left.startupBudget || "-",
      right: right.startupBudget || "-",
      winner: pickWinner(parseCurrencyEstimate(left.startupBudget), parseCurrencyEstimate(right.startupBudget), "lower"),
    },
    {
      label: "Affordability tier",
      left: left.affordability || "-",
      right: right.affordability || "-",
      winner: pickWinner(parseAffordabilityRank(left.affordability), parseAffordabilityRank(right.affordability), "lower"),
    },
    {
      label: "Speed score",
      left: Number.isFinite(left.speed) ? `${left.speed}/10` : "-",
      right: Number.isFinite(right.speed) ? `${right.speed}/10` : "-",
      winner: pickWinner(left.speed, right.speed, "higher"),
    },
    {
      label: "Best for",
      left: left.bestFor,
      right: right.bestFor,
      winner: "",
    },
    {
      label: "Featured strength",
      left: left.strength,
      right: right.strength,
      winner: "",
    },
    {
      label: "Practical notes",
      left: left.practicalNotes,
      right: right.practicalNotes,
      winner: "",
    },
  ];
}

function optionLabel(country) {
  const name = safeString(country?.name, 90) || "Country";
  if (safeString(country?.flag, 8)) return `${country.flag} ${name}`;
  return name;
}

export default function CompareCountriesScreen({ track = "study" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const safeTrack = normalizeTrackType(track || "study");
  const trackMeta = APP_TRACK_META[safeTrack] || APP_TRACK_META.study;
  const pinnedCountry = useMemo(
    () => decodeDiscoveryCountryParam(params.get("country") || ""),
    [params]
  );

  const { countries, loading, error } = useDiscoveryCountries({
    trackType: safeTrack,
  });

  const compareCountries = useMemo(() => {
    return (Array.isArray(countries) ? countries : [])
      .filter((country) => country?.hasPublication)
      .sort((left, right) =>
        safeString(left?.name, 140).localeCompare(safeString(right?.name, 140))
      );
  }, [countries]);

  const countryMap = useMemo(() => {
    const map = new Map();
    compareCountries.forEach((country) => {
      map.set(toCountryLookupKey(country?.name), country);
    });
    return map;
  }, [compareCountries]);

  const defaultLeftKey = useMemo(() => {
    if (!compareCountries.length) return "";
    const pinnedKey = toCountryLookupKey(pinnedCountry);
    if (pinnedKey && countryMap.has(pinnedKey)) return pinnedKey;
    return toCountryLookupKey(compareCountries[0]?.name);
  }, [compareCountries, countryMap, pinnedCountry]);

  const defaultRightKey = useMemo(() => {
    if (!compareCountries.length) return "";
    const candidate = compareCountries.find(
      (country) => toCountryLookupKey(country?.name) !== defaultLeftKey
    );
    return toCountryLookupKey(candidate?.name);
  }, [compareCountries, defaultLeftKey]);

  const [selectedLeftKey, setSelectedLeftKey] = useState("");
  const [selectedRightKey, setSelectedRightKey] = useState("");
  const [comparedPair, setComparedPair] = useState({ leftKey: "", rightKey: "" });

  const resolvedLeftKey = useMemo(() => {
    if (selectedLeftKey && countryMap.has(selectedLeftKey)) return selectedLeftKey;
    return defaultLeftKey;
  }, [countryMap, defaultLeftKey, selectedLeftKey]);

  const resolvedRightKey = useMemo(() => {
    if (
      selectedRightKey &&
      countryMap.has(selectedRightKey) &&
      selectedRightKey !== resolvedLeftKey
    ) {
      return selectedRightKey;
    }
    if (defaultRightKey && defaultRightKey !== resolvedLeftKey) return defaultRightKey;
    return "";
  }, [countryMap, defaultRightKey, resolvedLeftKey, selectedRightKey]);

  const compareBlocked =
    loading ||
    !resolvedLeftKey ||
    !resolvedRightKey ||
    resolvedLeftKey === resolvedRightKey;

  const comparedLeftCountry = useMemo(() => {
    if (!comparedPair.leftKey || !countryMap.has(comparedPair.leftKey)) return null;
    return countryMap.get(comparedPair.leftKey) || null;
  }, [comparedPair.leftKey, countryMap]);

  const comparedRightCountry = useMemo(() => {
    if (!comparedPair.rightKey || !countryMap.has(comparedPair.rightKey)) return null;
    return countryMap.get(comparedPair.rightKey) || null;
  }, [comparedPair.rightKey, countryMap]);

  const compareRows = useMemo(
    () => buildCompareRows(comparedLeftCountry, comparedRightCountry),
    [comparedLeftCountry, comparedRightCountry]
  );

  const outcome = useMemo(() => {
    if (!comparedLeftCountry || !comparedRightCountry || !compareRows.length) return null;
    const scoredRows = compareRows.filter((row) => row.winner === "left" || row.winner === "right");
    if (!scoredRows.length) {
      return {
        summary: `Balanced outcome for ${trackMeta.label}`,
        detail: "Both countries are closely matched on measurable fields.",
        recommendedCountry: comparedLeftCountry,
      };
    }

    let leftWins = 0;
    let rightWins = 0;
    const leftReasons = [];
    const rightReasons = [];
    scoredRows.forEach((row) => {
      if (row.winner === "left") {
        leftWins += 1;
        leftReasons.push(row.label);
      } else if (row.winner === "right") {
        rightWins += 1;
        rightReasons.push(row.label);
      }
    });

    if (leftWins === rightWins) {
      return {
        summary: `Balanced outcome for ${trackMeta.label}`,
        detail: "Each country leads in different practical metrics.",
        recommendedCountry: comparedLeftCountry,
      };
    }

    const winnerSide = leftWins > rightWins ? "left" : "right";
    const winnerCountry =
      winnerSide === "left" ? comparedLeftCountry : comparedRightCountry;
    const reasons = (winnerSide === "left" ? leftReasons : rightReasons).slice(0, 3);
    return {
      summary: `${safeString(winnerCountry?.name, 80)} has the edge for ${trackMeta.label}`,
      detail: reasons.length
        ? `Published metrics favor this route for ${reasons.join(", ").toLowerCase()}.`
        : "Published metrics give this route a stronger overall fit.",
      recommendedCountry: winnerCountry,
    };
  }, [compareRows, comparedLeftCountry, comparedRightCountry, trackMeta.label]);

  const runComparison = () => {
    if (compareBlocked) return;
    setComparedPair({
      leftKey: resolvedLeftKey,
      rightKey: resolvedRightKey,
    });
  };

  const openDetails = (country) => {
    if (!country?.name) return;
    navigate(`/app/${safeTrack}/discovery/${encodeDiscoveryCountryParam(country.name)}`);
  };

  const openWeHelp = (country) => {
    if (!country?.name) return;
    navigate(`/app/${safeTrack}/we-help?country=${encodeURIComponent(country.name)}&from=compare`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white pb-10 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto max-w-4xl px-5 py-6">
        <button
          type="button"
          onClick={() => navigate(`/app/${safeTrack}/discovery`)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-700 transition hover:text-emerald-800 dark:text-zinc-200 dark:hover:text-emerald-200"
        >
          <AppIcon size={ICON_SM} icon={ArrowLeft} />
          Discovery
        </button>

        <div className="mt-3">
          <h1 className="text-[1.55rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Compare Countries
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Compare published country data side by side.
          </p>
        </div>

        <section className="mt-5 border-t border-b border-zinc-200/85 py-4 dark:border-zinc-800/85">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                Country A
              </span>
              <select
                value={resolvedLeftKey}
                onChange={(event) => setSelectedLeftKey(event.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-emerald-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {compareCountries.map((country) => {
                  const key = toCountryLookupKey(country?.name);
                  return (
                    <option key={`left-option-${key}`} value={key}>
                      {optionLabel(country)}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                Country B
              </span>
              <select
                value={resolvedRightKey}
                onChange={(event) => setSelectedRightKey(event.target.value)}
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none transition focus:border-emerald-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {compareCountries.map((country) => {
                  const key = toCountryLookupKey(country?.name);
                  const disabled = key === resolvedLeftKey;
                  return (
                    <option key={`right-option-${key}`} value={key} disabled={disabled}>
                      {optionLabel(country)}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={runComparison}
              disabled={compareBlocked}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              <AppIcon size={ICON_SM} icon={ArrowRightLeft} />
              Sync Comparison
            </button>
          </div>

          {error ? (
            <p className="mt-2 text-sm text-rose-700 dark:text-rose-200">{error}</p>
          ) : null}
          {!loading && compareCountries.length < 2 ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              At least two published countries are required for comparison on this track.
            </p>
          ) : null}
        </section>

        {outcome ? (
          <section className="mt-4 border-b border-zinc-200/85 pb-3 dark:border-zinc-800/85">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{outcome.summary}</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{outcome.detail}</p>
          </section>
        ) : null}

        {compareRows.length ? (
          <section className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200/85 dark:border-zinc-800/85">
                  <th className="py-2 pr-3 text-left text-xs font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                    Metric
                  </th>
                  <th className="py-2 px-2 text-left text-xs font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                    {optionLabel(comparedLeftCountry)}
                  </th>
                  <th className="py-2 pl-2 text-left text-xs font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                    {optionLabel(comparedRightCountry)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => {
                  const leftWinner = row.winner === "left";
                  const rightWinner = row.winner === "right";
                  return (
                    <tr
                      key={`compare-row-${row.label}`}
                      className="border-b border-zinc-200/75 dark:border-zinc-800/75"
                    >
                      <td className="py-3 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300">
                        {row.label}
                      </td>
                      <td
                        className={`py-3 px-2 text-sm ${
                          leftWinner
                            ? "font-semibold text-emerald-700 dark:text-emerald-200"
                            : "text-zinc-800 dark:text-zinc-100"
                        }`}
                      >
                        {row.left}
                      </td>
                      <td
                        className={`py-3 pl-2 text-sm ${
                          rightWinner
                            ? "font-semibold text-emerald-700 dark:text-emerald-200"
                            : "text-zinc-800 dark:text-zinc-100"
                        }`}
                      >
                        {row.right}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : null}

        {compareRows.length ? (
          <section className="mt-5 flex flex-wrap gap-2 border-t border-zinc-200/85 pt-4 dark:border-zinc-800/85">
            <button
              type="button"
              onClick={() => openDetails(comparedLeftCountry)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-300 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              View Country A Details
              <AppIcon size={ICON_SM} icon={ChevronRight} />
            </button>
            <button
              type="button"
              onClick={() => openDetails(comparedRightCountry)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:border-emerald-300 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              View Country B Details
              <AppIcon size={ICON_SM} icon={ChevronRight} />
            </button>
            <button
              type="button"
              onClick={() => openWeHelp(outcome?.recommendedCountry)}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 dark:border-emerald-900/45"
            >
              Start WeHelp with Recommended Country
              <AppIcon size={ICON_SM} icon={ChevronRight} className="text-white" />
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}

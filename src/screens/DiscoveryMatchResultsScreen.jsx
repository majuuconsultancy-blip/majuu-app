import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Compass, RefreshCcw, Sparkles } from "lucide-react";

import { motion as Motion } from "../utils/motionproxy";
import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, normalizeTrackType } from "../constants/migrationOptions";
import { useDiscoveryCountries } from "../hooks/useDiscoveryCountries";
import { encodeDiscoveryCountryParam } from "../services/discoveryService";
import { rankDiscoveryCountryMatches } from "../services/discoveryMatchService";

function safeString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

export default function DiscoveryMatchResultsScreen({ track = "study" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const safeTrack = normalizeTrackType(track || "study");
  const trackMeta = APP_TRACK_META[safeTrack] || APP_TRACK_META.study;
  const { countries, loading } = useDiscoveryCountries({ trackType: safeTrack });

  const answers =
    location?.state && typeof location.state === "object" && location.state.answers
      ? location.state.answers
      : null;

  const rankedResults = useMemo(
    () => rankDiscoveryCountryMatches({ trackType: safeTrack, answers, countries, limit: 3 }),
    [answers, countries, safeTrack]
  );

  const startQuestionnaire = () => {
    navigate(`/app/${safeTrack}/discovery/match`);
  };

  const openCountry = (countryName) => {
    const encoded = encodeDiscoveryCountryParam(countryName);
    navigate(`/app/${safeTrack}/discovery/${encoded}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white pb-10 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto max-w-3xl px-5 py-6">
        <section className="relative overflow-hidden rounded-[30px] border border-white/75 bg-white/80 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-zinc-800 dark:bg-zinc-900/60">
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-700/20"
            animate={{ x: [0, -7, 0], y: [0, 7, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-10 left-[-54px] h-36 w-36 rounded-full bg-emerald-300/24 blur-3xl dark:bg-emerald-700/18"
            animate={{ x: [0, 7, 0], y: [0, -7, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(`/app/${safeTrack}/discovery`)}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/85 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Discovery
            </button>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon size={ICON_SM} icon={Compass} />
              {trackMeta.label} Match
            </div>
          </div>

          <h1 className="relative mt-4 text-[1.56rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Your Best Country Matches
          </h1>
          <p className="relative mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            Top recommendations from your preferences and published Discovery data.
          </p>
        </section>

        {!answers ? (
          <section className="mt-5 rounded-[26px] border border-zinc-200/80 bg-white/82 p-4 dark:border-zinc-800 dark:bg-zinc-900/58">
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Start your match questionnaire first
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Answer a few quick prompts and we will rank your best-fit destinations.
            </p>
            <button
              type="button"
              onClick={startQuestionnaire}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 dark:border-emerald-900/40"
            >
              Start Questionnaire
              <AppIcon size={ICON_SM} icon={ChevronRight} className="text-white" />
            </button>
          </section>
        ) : loading ? (
          <section className="mt-5 grid gap-3">
            {[0, 1, 2].map((item) => (
              <div
                key={`match-loading-${item}`}
                className="h-[8.5rem] animate-pulse rounded-3xl border border-zinc-200/80 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60"
              />
            ))}
          </section>
        ) : !rankedResults.length ? (
          <section className="mt-5 rounded-[26px] border border-dashed border-zinc-200 bg-white/80 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/55 dark:text-zinc-300">
            No published Discovery destinations are available for {trackMeta.label} right now.
          </section>
        ) : (
          <section className="mt-5 grid gap-3">
            {rankedResults.map((result, index) => (
              <button
                key={`match-result-${result.countryName}-${index}`}
                type="button"
                onClick={() => openCountry(result.countryName)}
                className="group w-full rounded-[26px] border border-zinc-200/80 bg-white/86 px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/45 dark:border-zinc-800 dark:bg-zinc-900/58 dark:hover:border-emerald-900/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                      <AppIcon size={ICON_SM} icon={Sparkles} />
                      {result.matchLabel}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[1.08rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                      {result.countryFlag ? <span>{result.countryFlag}</span> : null}
                      <span className="truncate">{result.countryName}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="inline-flex h-10 items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      {result.scorePercent}%
                    </span>
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/85 text-zinc-700 transition group-hover:border-emerald-200 group-hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      <AppIcon size={ICON_SM} icon={ChevronRight} />
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(Array.isArray(result.reasons) ? result.reasons : []).map((reason, reasonIndex) => (
                    <span
                      key={`reason-${result.countryName}-${reasonIndex}`}
                      className="inline-flex items-center rounded-full border border-zinc-200/80 bg-white/85 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                    >
                      {safeString(reason, 88)}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </section>
        )}

        {answers ? (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={startQuestionnaire}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/85 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.11em] text-zinc-600 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
            >
              <AppIcon size={ICON_SM} icon={RefreshCcw} />
              Retake Match
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

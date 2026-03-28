import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronRight,
  Compass,
  Globe,
  Sparkles,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, normalizeTrackType } from "../constants/migrationOptions";
import { useDiscoveryCountries } from "../hooks/useDiscoveryCountries";
import {
  decodeDiscoveryCountryParam,
  encodeDiscoveryCountryParam,
  getMediaWindow,
  shuffleWithSeed,
  toCountryLookupKey,
} from "../services/discoveryService";

function safeString(value, max = 260) {
  return String(value || "").trim().slice(0, max);
}

function findCountryByParam(countries, rawParam) {
  const decoded = decodeDiscoveryCountryParam(rawParam);
  const key = toCountryLookupKey(decoded);
  const safeRows = Array.isArray(countries) ? countries : [];
  if (!safeRows.length) return null;

  return (
    safeRows.find((row) => {
      if (!row) return false;
      if (toCountryLookupKey(row?.name) === key) return true;
      if (safeString(row?.code, 8).toLowerCase() === safeString(decoded, 8).toLowerCase()) return true;
      if (safeString(row?.id, 140).toLowerCase() === safeString(decoded, 140).toLowerCase()) return true;
      return false;
    }) || null
  );
}

export default function DiscoveryDetailScreen({ track = "study" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { countryParam = "" } = useParams();
  const safeTrack = normalizeTrackType(track || "study");

  const { countries, loading } = useDiscoveryCountries({
    trackType: safeTrack,
  });
  const country = useMemo(() => findCountryByParam(countries, countryParam), [countries, countryParam]);
  const trackMeta = APP_TRACK_META[safeTrack] || APP_TRACK_META.study;

  const sessionSeed = safeString(location.key, 60) || "discovery";
  const stableMedia = useMemo(() => {
    const mediaPool = Array.isArray(country?.mediaPool) ? country.mediaPool : [];
    return shuffleWithSeed(
      mediaPool,
      `${sessionSeed}:${safeTrack}:${safeString(country?.name, 120)}:${mediaPool.length}`
    );
  }, [country, safeTrack, sessionSeed]);

  const heroImage = stableMedia[0] || "";
  const supportingImages = useMemo(() => getMediaWindow(stableMedia, 1, 2), [stableMedia]);
  const galleryImages = useMemo(() => getMediaWindow(stableMedia, 3, 4), [stableMedia]);
  const editorialSections = useMemo(() => {
    const overview = country?.overview && typeof country.overview === "object" ? country.overview : {};
    const whyChoose = safeString(overview?.whyChoose, 2200) || safeString(country?.editorial, 2200);
    const trackNotes = safeString(overview?.trackNotes, 2200);
    const interestingFacts =
      safeString(overview?.interestingFacts, 2200) ||
      safeString(country?.compareData?.interestingFacts, 2200) ||
      (Array.isArray(country?.highlights) ? country.highlights.slice(0, 3).join(" ") : "");

    return [
      { key: "why-choose", title: "Why Choose This Country", body: whyChoose },
      { key: "track-notes", title: "Track-Specific Notes", body: trackNotes },
      { key: "interesting-facts", title: "Interesting Facts", body: interestingFacts },
    ].filter((item) => safeString(item.body, 10));
  }, [country]);
  const confidenceRows = useMemo(() => {
    const compareData = country?.compareData && typeof country.compareData === "object" ? country.compareData : {};
    const bestForFromTags = Array.isArray(compareData?.bestForTags)
      ? compareData.bestForTags.filter(Boolean).slice(0, 4).join(", ")
      : "";
    const bestFor = safeString(bestForFromTags || compareData?.bestFor, 700);
    const strength = safeString(compareData?.featuredStrength, 420) || safeString(country?.quickHighlight, 420);
    const practicalNotes =
      safeString(compareData?.practicalNotes, 700) ||
      (Array.isArray(country?.practicalDetails) ? safeString(country.practicalDetails[0]?.value, 700) : "");

    return [
      { key: "best-for", label: "Best For", value: bestFor },
      { key: "strength", label: "Strength", value: strength },
      { key: "practical-notes", label: "Practical Notes", value: practicalNotes },
    ].filter((item) => safeString(item.value, 10));
  }, [country]);

  const goBack = () => navigate(`/app/${safeTrack}/discovery`);

  const openCompare = () => {
    if (!country?.name) {
      navigate(`/app/${safeTrack}/discovery/compare`);
      return;
    }
    navigate(
      `/app/${safeTrack}/discovery/compare?country=${encodeDiscoveryCountryParam(country.name)}`
    );
  };

  const openWeHelp = () => {
    if (!country?.name) return;
    navigate(`/app/${safeTrack}/we-help?country=${encodeURIComponent(country.name)}&from=discovery`);
  };

  if (!loading && !country) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="mx-auto max-w-3xl px-5 py-8">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/85 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
          >
            <AppIcon size={ICON_SM} icon={ArrowLeft} />
            Back to Discovery
          </button>
          <div className="mt-6 rounded-3xl border border-zinc-200/80 bg-white/78 px-5 py-6 dark:border-zinc-800 dark:bg-zinc-900/55">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Destination not found
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              This destination may be inactive or no longer available for {trackMeta.label}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-10 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <section className="relative overflow-hidden">
        <div className="relative h-[43vh] min-h-[20.5rem] w-full overflow-hidden">
          {heroImage ? (
            <img
              src={heroImage}
              alt=""
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-zinc-200 dark:bg-zinc-800" />
          )}

          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/78 via-black/28 to-black/22" />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/40 to-transparent" />

          <div className="absolute inset-x-0 top-0 mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-5 pb-4 pt-5">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-black/30 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-black/45"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} className="text-white" />
              Discovery
            </button>

            <button
              type="button"
              onClick={openCompare}
              className="inline-flex items-center gap-2 rounded-full border border-white/45 bg-black/30 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-black/45"
            >
              <AppIcon size={ICON_SM} icon={ArrowRightLeft} className="text-white" />
              Compare
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-4xl px-5 pb-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/45 bg-white/15">
                <AppIcon size={ICON_SM} icon={Compass} className="text-white" />
              </span>
              {trackMeta.label} Discovery
            </div>

            <h1 className="mt-3 flex items-center gap-2 text-[2rem] font-semibold leading-tight tracking-tight text-white">
              {country?.flag ? <span>{country.flag}</span> : null}
              <span>{country?.name || "Loading..."}</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/90">{country?.summary}</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-5">
        {editorialSections.length ? (
          <section className="mt-5 divide-y divide-zinc-200/80 border-y border-zinc-200/80 dark:divide-zinc-800/80 dark:border-zinc-800/80">
            {editorialSections.map((item) => (
              <div key={item.key} className="py-4">
                <h2 className="text-[1.04rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {item.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                  {item.body}
                </p>
              </div>
            ))}
          </section>
        ) : null}

        {supportingImages.length ? (
          <section className="mt-5 grid grid-cols-2 gap-3">
            {supportingImages.map((image, index) => (
              <div
                key={`support-${image}-${index}`}
                className="relative h-[9.5rem] overflow-hidden rounded-[22px] border border-zinc-200/80 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/65"
              >
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-[1.18rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Why this destination stands out
          </h2>
          <div className="mt-2 divide-y divide-zinc-200/75 border-y border-zinc-200/75 dark:divide-zinc-800/75 dark:border-zinc-800/75">
            {(Array.isArray(country?.highlights) ? country.highlights : []).map((line, index) => (
              <div key={`highlight-${index}`} className="flex items-start gap-3 py-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                  <AppIcon size={ICON_SM} icon={Sparkles} />
                </span>
                <p className="text-sm text-zinc-700 dark:text-zinc-200">{line}</p>
              </div>
            ))}
          </div>
        </section>

        {confidenceRows.length ? (
          <section className="mt-6 grid gap-3 sm:grid-cols-3">
            {confidenceRows.map((item) => (
              <div
                key={item.key}
                className="rounded-2xl border border-zinc-200/75 bg-white/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/55"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                  {item.label}
                </div>
                <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {item.value}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="text-[1.18rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Practical Facts
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Array.isArray(country?.facts) ? country.facts : []).map((fact, index) => (
              <span
                key={`fact-${index}`}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/85 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
              >
                <span className="text-zinc-500 dark:text-zinc-400">{fact?.label}:</span>
                <span>{fact?.value}</span>
              </span>
            ))}
          </div>
        </section>

        {galleryImages.length ? (
          <section className="mt-6 grid grid-cols-2 gap-3">
            {galleryImages.map((image, index) => (
              <div
                key={`gallery-${image}-${index}`}
                className="relative h-[8.6rem] overflow-hidden rounded-[20px] border border-zinc-200/80 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/65"
              >
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </section>
        ) : null}

        <section className="relative mt-7 rounded-[26px] border border-zinc-200/80 bg-white/82 p-4 dark:border-zinc-800 dark:bg-zinc-900/58">
          <span className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white/85 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
            <AppIcon size={ICON_SM} icon={Globe} />
          </span>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            Next Step
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Ready to continue with {country?.name}?
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Keep the momentum and move forward with direct MAJUU support for this route.
          </p>

          <div className="mt-4">
            <button
              type="button"
              onClick={openWeHelp}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 dark:border-emerald-900/40"
            >
              Start with WeHelp
              <AppIcon size={ICON_SM} icon={ChevronRight} className="text-white" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRightLeft, ChevronRight, Compass, Route, Search, Sparkles } from "lucide-react";

import { motion as Motion } from "../utils/motionProxy";
import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, normalizeTrackType } from "../constants/migrationOptions";
import { useDiscoveryCountries } from "../hooks/useDiscoveryCountries";
import { encodeDiscoveryCountryParam } from "../services/discoveryService";
import { buildCountryAccentSurfaceStyle } from "../utils/countryAccent";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function trackLabel(trackType) {
  return APP_TRACK_META[trackType]?.label || APP_TRACK_META.study.label;
}

export default function DiscoveryScreen({ track = "study" }) {
  const navigate = useNavigate();
  const safeTrack = normalizeTrackType(track || "study");
  const [query, setQuery] = useState("");

  const { countries, loading, hasManagedDocs } = useDiscoveryCountries({
    trackType: safeTrack,
  });

  const filteredCountries = useMemo(() => {
    const needle = safeString(query, 80).toLowerCase();
    if (!needle) return countries;
    return countries.filter((row) => {
      const searchSpace = [
        safeString(row?.name, 120),
        safeString(row?.quickHighlight, 180),
        safeString(row?.line, 180),
      ]
        .join(" ")
        .toLowerCase();
      return searchSpace.includes(needle);
    });
  }, [countries, query]);

  const spotlightCountries = useMemo(() => filteredCountries.slice(0, 8), [filteredCountries]);

  const goBack = () => {
    navigate(`/app/${safeTrack}`, { replace: true });
  };

  const openCompare = () => {
    navigate(`/app/${safeTrack}/discovery/compare`);
  };

  const openMatch = () => {
    navigate(`/app/${safeTrack}/discovery/match`);
  };

  const openCountry = (countryName) => {
    const encoded = encodeDiscoveryCountryParam(countryName);
    navigate(`/app/${safeTrack}/discovery/${encoded}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-white pb-8 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="mx-auto max-w-4xl px-5 py-6">
        <section className="relative overflow-hidden rounded-[30px] border border-white/75 bg-white/78 p-5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-zinc-800 dark:bg-zinc-900/58">
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-cyan-300/20 blur-3xl dark:bg-cyan-700/20"
            animate={{ x: [0, -7, 0], y: [0, 8, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-10 left-[-56px] h-36 w-36 rounded-full bg-emerald-300/24 blur-3xl dark:bg-emerald-700/20"
            animate={{ x: [0, 6, 0], y: [0, -8, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative flex items-start justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/85 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:border-emerald-900/40"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Track
            </button>
          </div>

          <div className="relative mt-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/25">
                <AppIcon size={ICON_SM} icon={Compass} className="text-emerald-700 dark:text-emerald-200" />
              </span>
              Discovery | {trackLabel(safeTrack)}
            </div>

            <h1 className="mt-3 text-[1.75rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Discover Destinations
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Browse live countries from SACC, open rich destination details, and compare options faster.
            </p>
          </div>
        </section>

        <div className="mt-5">
          <label className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
              <AppIcon size={ICON_SM} icon={Search} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search country, vibe, or highlight"
              className="w-full rounded-2xl border border-zinc-200/80 bg-white/88 py-3 pl-10 pr-4 text-sm font-medium text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-900/35"
            />
          </label>
        </div>

        <section className="mt-5 grid gap-2.5">
          <button
            type="button"
            onClick={openMatch}
            className="group relative overflow-hidden rounded-[24px] border border-emerald-200/70 bg-gradient-to-r from-emerald-500 to-cyan-500 p-4 text-left text-white shadow-[0_12px_28px_rgba(16,185,129,0.24)] transition active:scale-[0.99]"
          >
            <span className="pointer-events-none absolute -right-10 top-[-48px] h-28 w-28 rounded-full bg-white/18 blur-3xl" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/45 bg-black/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-white/95">
                  <AppIcon size={ICON_SM} icon={Sparkles} className="text-white" />
                  Personalized
                </div>
                <h2 className="mt-2 text-[1.15rem] font-semibold tracking-tight">Find My Best Match</h2>
                <p className="mt-1 text-sm text-white/90">
                  Get personalized country recommendations.
                </p>
              </div>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/45 bg-black/25">
                <AppIcon size={ICON_MD} icon={Route} className="text-white" />
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={openCompare}
            className="inline-flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/86 px-4 py-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:hover:border-emerald-900/40"
          >
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                Compare
              </div>
              <div className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Compare Countries
              </div>
            </div>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              <AppIcon size={ICON_SM} icon={ArrowRightLeft} />
            </span>
          </button>
        </section>

        <section className="mt-5">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-[1.2rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Spotlight
            </h2>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              {filteredCountries.length} countries
            </span>
          </div>

          {loading ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((item) => (
                <div
                  key={`discovery-loading-${item}`}
                  className="h-[11rem] animate-pulse rounded-[24px] border border-zinc-200/70 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/55"
                />
              ))}
            </div>
          ) : spotlightCountries.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-zinc-200 bg-white/80 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/52 dark:text-zinc-300">
              {hasManagedDocs
                ? "No active countries are available for this track right now."
                : "Discovery will appear once countries are available."}
            </div>
          ) : (
            <div className="mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {spotlightCountries.map((country) => (
                <button
                  key={`spotlight-${country.name}`}
                  type="button"
                  onClick={() => openCountry(country.name)}
                  className="group relative h-[11.5rem] min-w-[15rem] snap-start overflow-hidden rounded-[26px] border border-zinc-200/80 text-left shadow-sm transition active:scale-[0.99] dark:border-zinc-700/80"
                  style={buildCountryAccentSurfaceStyle(country.accentColor, { strong: true })}
                >
                  {country.heroImage ? (
                    <img
                      src={country.heroImage}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : null}
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/0" />

                  <div className="relative flex h-full flex-col justify-between p-4 text-white">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/85">
                        {trackLabel(safeTrack)} Discovery
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-lg font-semibold">
                        {country.flag ? <span>{country.flag}</span> : null}
                        <span className="truncate">{country.name}</span>
                      </div>
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <p className="line-clamp-2 text-xs text-white/90">{country.quickHighlight}</p>
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/50 bg-black/30">
                        <AppIcon size={ICON_MD} icon={ChevronRight} className="text-white" />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="mt-5">
          {!loading && !filteredCountries.length ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/80 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/52 dark:text-zinc-300">
              No countries match your search right now.
            </div>
          ) : (
            <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800/70">
              {filteredCountries.map((country) => (
                <button
                  key={`country-row-${country.name}`}
                  type="button"
                  onClick={() => openCountry(country.name)}
                  className="group flex w-full items-stretch gap-3 rounded-2xl px-1 py-3.5 text-left transition hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60"
                >
                  <div className="relative h-[5.4rem] w-[6rem] shrink-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60">
                    {country.previewImage ? (
                      <img
                        src={country.previewImage}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                      />
                    ) : null}
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      {country.flag ? <span>{country.flag}</span> : null}
                      <span className="truncate">{country.name}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {country.quickHighlight}
                    </p>
                    <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.11em] text-zinc-500 dark:text-zinc-400">
                      {country.line}
                    </div>
                  </div>

                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-2xl border border-zinc-200 bg-white/85 text-zinc-700 transition group-hover:border-emerald-200 group-hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/65 dark:text-zinc-100">
                    <AppIcon size={ICON_SM} icon={ChevronRight} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

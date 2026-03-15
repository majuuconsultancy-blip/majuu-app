import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useLocation } from "react-router-dom";
import {
  ExternalLink,
  Globe2,
  Newspaper,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import OpenExternalLinkDialog from "../components/OpenExternalLinkDialog";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  APP_DESTINATION_COUNTRIES,
  APP_TRACK_META,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import { NEWS_SOURCE_TYPE_LABELS } from "../constants/news";
import { auth, db } from "../firebase";
import {
  getImpactLabel,
  getNewsTimestampMs,
  pickBreakingNewsItem,
  subscribePublishedNews,
} from "../services/newsservice";

function safeString(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function formatRelativeTime(timestampMs) {
  const ts = Number(timestampMs || 0);
  if (!ts) return "";

  const diffMs = Date.now() - ts;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function sourceTone(sourceType) {
  const safeType = String(sourceType || "").trim().toLowerCase();
  if (safeType === "official") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200";
  }
  if (safeType === "media") {
    return "border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-200";
  }
  return "border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
}

function impactTone(label) {
  if (label === "Critical") {
    return "border-rose-200 bg-rose-50/85 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  }
  if (label === "High Impact") {
    return "border-amber-200 bg-amber-50/85 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  if (label === "Important") {
    return "border-emerald-200 bg-emerald-50/85 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200";
  }
  return "border-zinc-200 bg-zinc-50/80 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
}

function FeedMetaRow({ item, onOpenLink }) {
  const safeTimestamp = formatRelativeTime(getNewsTimestampMs(item));
  const sourceTypeLabel = NEWS_SOURCE_TYPE_LABELS[item?.sourceType] || "Other";

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
      <span className="truncate">Source: {item?.sourceName || "Unknown source"}</span>
      <span className={`rounded-full border px-2 py-0.5 ${sourceTone(item?.sourceType)}`}>
        {sourceTypeLabel}
      </span>
      {safeTimestamp ? <span>{safeTimestamp}</span> : null}
      {item?.sourceLink ? (
        <button
          type="button"
          onClick={() => onOpenLink(item?.sourceLink)}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
        >
          <AppIcon icon={ExternalLink} size={ICON_SM} />
          Open source
        </button>
      ) : null}
    </div>
  );
}

function NewsRow({ item, onOpenLink }) {
  const impactLabel = getImpactLabel(item);

  return (
    <article className="px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-5 text-zinc-900 dark:text-zinc-100">
            {item?.title}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-zinc-600 dark:text-zinc-300">
            {item?.summary}
          </p>
        </div>

        {impactLabel ? (
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${impactTone(impactLabel)}`}>
            {impactLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/50">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
          Why this matters
        </div>
        <p className="mt-1.5 text-[13px] leading-5 text-zinc-700 dark:text-zinc-200">
          {item?.whyThisMatters}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(Array.isArray(item?.tags) ? item.tags : []).map((tag) => (
          <span
            key={`${item?.id}-${tag}`}
            className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-3">
        <FeedMetaRow item={item} onOpenLink={onOpenLink} />
      </div>
    </article>
  );
}

export default function NewsScreen() {
  const location = useLocation();
  const routedTrackContext = safeString(location.state?.trackContext, 20).toLowerCase();
  const routedCountryContext = normalizeDestinationCountry(location.state?.countryContext);
  const initialTrack =
    routedTrackContext === "study" || routedTrackContext === "work" || routedTrackContext === "travel"
      ? routedTrackContext
      : "study";

  const [trackType, setTrackType] = useState(initialTrack);
  const [selectedCountry, setSelectedCountry] = useState(routedCountryContext || "");
  const [feedItems, setFeedItems] = useState([]);
  const [loadingContext, setLoadingContext] = useState(true);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [feedError, setFeedError] = useState("");
  const [pendingLink, setPendingLink] = useState("");

  const seededCountryRef = useRef(Boolean(routedCountryContext));

  useEffect(() => {
    let unsubUserDoc = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }

      if (!user?.uid) {
        setTrackType("study");
        setSelectedCountry(APP_DESTINATION_COUNTRIES[0]);
        setLoadingContext(false);
        return;
      }

      unsubUserDoc = onSnapshot(
        doc(db, "users", user.uid),
        (snapshot) => {
          const userState = snapshot.exists() ? snapshot.data() || {} : {};
          const nextTrack = normalizeTrackType(
            routedTrackContext || userState?.activeTrack || userState?.selectedTrack || "study"
          );
          const nextCountry =
            routedCountryContext ||
            normalizeDestinationCountry(userState?.activeCountry) ||
            APP_DESTINATION_COUNTRIES[0];

          setLoadingFeed(true);
          setFeedError("");
          setTrackType(nextTrack);
          setSelectedCountry((current) => {
            const safeCurrent = normalizeDestinationCountry(current);
            if (!seededCountryRef.current) {
              seededCountryRef.current = true;
              return nextCountry;
            }
            return safeCurrent || nextCountry;
          });
          setLoadingContext(false);
        },
        (error) => {
          console.error("news context load failed:", error);
          setTrackType(normalizeTrackType(routedTrackContext || "study"));
          setSelectedCountry((current) => {
            const safeCurrent = normalizeDestinationCountry(current);
            return safeCurrent || routedCountryContext || APP_DESTINATION_COUNTRIES[0];
          });
          setLoadingContext(false);
        }
      );
    });

    return () => {
      if (unsubUserDoc) unsubUserDoc();
      unsubAuth();
    };
  }, [routedCountryContext, routedTrackContext]);

  useEffect(() => {
    const safeCountry = normalizeDestinationCountry(selectedCountry);
    if (!safeCountry) return undefined;

    return subscribePublishedNews({
      trackType,
      country: safeCountry,
      onData: (items) => {
        setFeedItems(items);
        setLoadingFeed(false);
      },
      onError: (error) => {
        setFeedItems([]);
        setFeedError(error?.message || "Failed to load news.");
        setLoadingFeed(false);
      },
    });
  }, [trackType, selectedCountry]);

  const trackMeta = APP_TRACK_META[trackType] || APP_TRACK_META.study;
  const breakingItem = useMemo(() => pickBreakingNewsItem(feedItems), [feedItems]);
  const regularItems = breakingItem?.id
    ? feedItems.filter((item) => item.id !== breakingItem.id)
    : feedItems;

  const openSourceLink = (url) => {
    const safeUrl = safeString(url, 500);
    if (!safeUrl) return;
    setPendingLink(safeUrl);
  };

  const confirmOpenExternal = () => {
    const safeUrl = safeString(pendingLink, 500);
    if (!safeUrl) return;
    window.open(safeUrl, "_blank", "noopener,noreferrer");
    setPendingLink("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="rounded-[28px] border border-emerald-100 bg-white/75 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                <AppIcon icon={Newspaper} size={ICON_SM} />
                Migration News
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {trackMeta.label} News
              </h1>
              <p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-300">
                Clean updates for {trackMeta.label.toLowerCase()} migration moves, policy shifts, and trusted destination changes.
              </p>
            </div>

            <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-3xl border border-emerald-100 bg-emerald-50/70 text-emerald-700 dark:flex dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Radio} size={ICON_MD} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="rounded-2xl border border-zinc-200/80 bg-white/85 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                <AppIcon icon={Sparkles} size={ICON_SM} />
                Active Track Context
              </div>
              <div className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {trackMeta.title}
              </div>
            </div>

            <label className="grid gap-1.5">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                <AppIcon icon={Globe2} size={ICON_SM} />
                Country
              </span>
              <select
                className="w-full rounded-2xl border border-zinc-200 bg-white/90 px-3.5 py-3 text-sm font-semibold text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                value={selectedCountry}
                onChange={(event) => {
                  setLoadingFeed(true);
                  setFeedError("");
                  setSelectedCountry(event.target.value);
                }}
                disabled={loadingContext}
              >
                {APP_DESTINATION_COUNTRIES.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {breakingItem ? (
          <article className="mt-5 rounded-[28px] border border-rose-200 bg-gradient-to-r from-rose-50 via-white to-white p-4 shadow-sm dark:border-rose-900/40 dark:from-rose-950/25 dark:via-zinc-900 dark:to-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                  <AppIcon icon={Radio} size={ICON_SM} />
                  Breaking
                </div>
                <h2 className="mt-3 text-lg font-semibold leading-6 text-zinc-950 dark:text-zinc-50">
                  {breakingItem.title}
                </h2>
                {breakingItem.summary ? (
                  <p className="mt-2 text-sm leading-5 text-zinc-700 dark:text-zinc-200">
                    {breakingItem.summary}
                  </p>
                ) : null}
              </div>

              <div className="hidden rounded-3xl border border-rose-200 bg-white/85 px-3 py-2 text-right text-[11px] font-medium text-zinc-600 dark:block dark:border-rose-900/40 dark:bg-zinc-950/50 dark:text-zinc-300">
                <div className="text-rose-700 dark:text-rose-200">Critical update</div>
                <div className="mt-1">{formatRelativeTime(getNewsTimestampMs(breakingItem))}</div>
              </div>
            </div>

            {breakingItem.whyThisMatters ? (
              <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950/45">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                  Why this matters
                </div>
                <p className="mt-1.5 text-sm leading-5 text-zinc-700 dark:text-zinc-200">
                  {breakingItem.whyThisMatters}
                </p>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(Array.isArray(breakingItem.tags) ? breakingItem.tags : []).map((tag) => (
                <span
                  key={`${breakingItem.id}-${tag}`}
                  className="rounded-full border border-rose-200 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-rose-900/40 dark:bg-zinc-950/45 dark:text-zinc-200"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-3">
              <FeedMetaRow item={breakingItem} onOpenLink={openSourceLink} />
            </div>
          </article>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-[28px] border border-zinc-200 bg-white/80 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-800 sm:px-5">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {trackMeta.label} updates for {selectedCountry || APP_DESTINATION_COUNTRIES[0]}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                Importance first, then newer updates for ties.
              </div>
            </div>

            <div className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-300">
              {regularItems.length + (breakingItem ? 1 : 0)} items
            </div>
          </div>

          {loadingContext || loadingFeed ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-600 dark:text-zinc-300 sm:px-5">
              Loading news feed...
            </div>
          ) : feedError ? (
            <div className="px-4 py-10 text-center text-sm text-rose-700 dark:text-rose-200 sm:px-5">
              {feedError}
            </div>
          ) : !feedItems.length ? (
            <div className="px-4 py-10 text-center sm:px-5">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-3xl border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
                <AppIcon icon={Newspaper} size={ICON_MD} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                No published news yet for {trackMeta.label.toLowerCase()} in {selectedCountry}.
              </div>
              <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Try another destination country or publish items from SACC News Management.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
              {regularItems.map((item) => (
                <NewsRow key={item.id} item={item} onOpenLink={openSourceLink} />
              ))}
            </div>
          )}
        </div>
      </div>

      <OpenExternalLinkDialog
        open={Boolean(pendingLink)}
        linkLabel={pendingLink}
        onOpen={confirmOpenExternal}
        onCancel={() => setPendingLink("")}
      />
    </div>
  );
}

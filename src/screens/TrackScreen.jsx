import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "../utils/motionProxy";
import {
  ArrowLeft,
  Briefcase,
  ChevronRight,
  Compass,
  GraduationCap,
  IdCard,
  Plane,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import CurrentProcessRing from "../components/home/CurrentProcessRing";
import RequestModal from "../components/RequestModal";
import TrackPulseStrip from "../components/home/TrackPulseStrip";
import { useI18n } from "../lib/i18n";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  APP_TRACK_META,
  APP_DESTINATION_COUNTRIES,
  normalizeDestinationCountry,
} from "../constants/migrationOptions";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { auth, db } from "../firebase";
import { useCountryDirectory } from "../hooks/useCountryDirectory";
import { useHomeDesignModule } from "../hooks/useHomeDesignModule";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { useUserJourney } from "../hooks/useUserJourney";
import { journeyShouldHighlightCountry } from "../journey/journeyMatchers";
import { setSnapshot } from "../resume/resumeEngine";
import { logAnalyticsEvent, trackManagedCountryTap } from "../services/analyticsService";
import {
  createPendingAttachment,
  createPendingAttachmentFromMeta,
} from "../services/attachmentservice";
import {
  activatePreparedUnlockRequest,
  createUnlockCheckoutSession,
} from "../services/paymentservice";
import {
  getImpactLabel,
  getNewsTimestampMs,
  listPublishedNews,
} from "../services/newsservice";
import { subscribeRequestProgressUpdates } from "../services/requestcontinuityservice";
import { subscribeActiveRequestDefinitions } from "../services/requestDefinitionService";
import {
  getUserState,
  setActiveContext,
  setActiveProcessDetails,
  setSelectedTrack,
  upsertUserContact,
} from "../services/userservice";
import { buildRequestPricingKey } from "../constants/requestCatalog";
import { getRequestPricingQuote, toRequestPricingSnapshot } from "../services/pricingservice";
import { createServiceRequest } from "../services/requestservice";
import { archiveWorkflowDraft } from "../services/workflowdraftservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import { getUserRequestState } from "../utils/requestLifecycle";
import { getRequestWorkProgress } from "../utils/requestWorkProgress";
import { normalizeTextDeep } from "../utils/textNormalizer";
import {
  buildCountryAccentBadgeStyle,
  buildCountryAccentRailStyle,
  buildCountryAccentSurfaceStyle,
  resolveCountryAccentColor,
} from "../utils/countryAccent";

const TRACKS = {
  study: {
    title: "Study Abroad",
    subtitle: "Compare routes, choose a destination, or start a direct request.",
    Icon: GraduationCap,
  },
  work: {
    title: "Work Abroad",
    subtitle: "Pick a country flow or launch a direct admin-routed request.",
    Icon: Briefcase,
  },
  travel: {
    title: "Travel Abroad",
    subtitle: "Browse destinations first, then open the right request path.",
    Icon: Plane,
  },
};

const FEATURED_COUNTRY_IMAGES = {
  Canada: "https://images.unsplash.com/photo-1503614472-8c93d56e92ce?auto=format&fit=crop&w=1200&q=70",
  Australia:
    "https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?auto=format&fit=crop&w=1200&q=70",
  UK: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=70",
  Germany:
    "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1200&q=70",
  USA: "https://images.unsplash.com/photo-1499092346589-b9b6be3e94b2?auto=format&fit=crop&w=1200&q=70",
};

const FEATURED_COUNTRY_CODES = {
  Canada: "CA",
  Australia: "AU",
  UK: "UK",
  Germany: "DE",
  USA: "US",
};

const COUNTRY_FILTERS = [
  { key: "all", label: "All" },
  { key: "a-f", label: "A-F" },
  { key: "g-l", label: "G-L" },
  { key: "m-r", label: "M-R" },
  { key: "s-z", label: "S-Z" },
];

// Keep a lightweight in-memory snapshot per track so revisits feel instant.
const TRACK_SCREEN_SNAPSHOT_CACHE = new Map();

const overlayMotion = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] } },
};

const sheetMotion = {
  hidden: { opacity: 0, y: 6, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.17, ease: [0.2, 0.8, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    y: 4,
    scale: 0.99,
    transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] },
  },
};

const listWrap = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.03 } },
};

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
  },
};

function safeString(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function getFirstName(value) {
  const safe = safeString(value, 120);
  if (!safe) return "";
  return safe.split(/\s+/).filter(Boolean)[0] || "";
}

function getTrackGreeting(name) {
  if (!name) return "Hello";
  const hours = new Date().getHours();
  if (hours >= 5 && hours < 12) return `Good morning, ${name}`;
  if (hours >= 12 && hours < 18) return `Good afternoon, ${name}`;
  if (hours >= 18 && hours < 24) return `Good evening, ${name}`;
  return `Hello, ${name}`;
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampPercent(value, fallback = 0) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(100, next));
}

function requestSortMs(request) {
  return Math.max(
    toMillis(request?.updatedAtMs),
    toMillis(request?.updatedAt),
    toMillis(request?.createdAtMs),
    toMillis(request?.createdAt),
    toMillis(request?.staffProgressUpdatedAtMs),
    toMillis(request?.staffProgressUpdatedAt)
  );
}

function hasStartedWorkEvidence(request) {
  const data = request && typeof request === "object" ? request : {};
  const status = safeString(data?.status, 40).toLowerCase();
  if (status === "closed" || status === "rejected" || status === "accepted") return false;

  const startedAtMs = Math.max(
    toMillis(data?.staffStartedAtMs),
    toMillis(data?.staffStartedAt),
    toMillis(data?.markedInProgressAtMs),
    toMillis(data?.markedInProgressAt)
  );

  // Keep this strict to match Start Work modal behavior:
  // only treat a request as started when start timestamps were actually written.
  return startedAtMs > 0;
}

function toTitleLabel(value) {
  const safe = safeString(value, 160);
  if (!safe) return "";
  return safe
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toRequestDisplayName(request) {
  const serviceName = safeString(request?.serviceName, 160);
  if (serviceName) return serviceName;

  const requestType = safeString(request?.requestType, 120).toLowerCase();
  if (requestType === "full") return "Full Package";
  if (requestType) return toTitleLabel(requestType);
  return "Request";
}

function countryMatchesFilterGroup(country, groupKey) {
  const first = safeString(country, 120).slice(0, 1).toUpperCase();
  if (!first) return false;
  if (groupKey === "a-f") return first >= "A" && first <= "F";
  if (groupKey === "g-l") return first >= "G" && first <= "L";
  if (groupKey === "m-r") return first >= "M" && first <= "R";
  if (groupKey === "s-z") return first >= "S" && first <= "Z";
  return true;
}

function isSameLatestRequest(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (safeString(left?.id, 180) !== safeString(right?.id, 180)) return false;
  if (requestSortMs(left) !== requestSortMs(right)) return false;
  if (safeString(left?.status, 40) !== safeString(right?.status, 40)) return false;
  if (safeString(left?.serviceName, 160) !== safeString(right?.serviceName, 160)) return false;
  return true;
}

function isSameProgressRows(leftRows = [], rightRows = []) {
  const left = Array.isArray(leftRows) ? leftRows : [];
  const right = Array.isArray(rightRows) ? rightRows : [];
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftRow = left[index];
    const rightRow = right[index];
    if (safeString(leftRow?.id, 180) !== safeString(rightRow?.id, 180)) return false;
    if (Number(leftRow?.progressPercent || 0) !== Number(rightRow?.progressPercent || 0)) {
      return false;
    }
    const leftMs = Math.max(toMillis(leftRow?.createdAtMs), toMillis(leftRow?.createdAt));
    const rightMs = Math.max(toMillis(rightRow?.createdAtMs), toMillis(rightRow?.createdAt));
    if (leftMs !== rightMs) return false;
  }
  return true;
}

function isSamePulseItems(leftItems = [], rightItems = []) {
  const left = Array.isArray(leftItems) ? leftItems : [];
  const right = Array.isArray(rightItems) ? rightItems : [];
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    const leftKey = safeString(leftItem?.id || leftItem?.title, 180);
    const rightKey = safeString(rightItem?.id || rightItem?.title, 180);
    if (leftKey !== rightKey) return false;
    if (Number(leftItem?.timestampMs || 0) !== Number(rightItem?.timestampMs || 0)) return false;
    if (safeString(leftItem?.impactLabel, 60) !== safeString(rightItem?.impactLabel, 60)) {
      return false;
    }
    const leftCountry = safeString(leftItem?.pulseCountry || leftItem?.country, 120);
    const rightCountry = safeString(rightItem?.pulseCountry || rightItem?.country, 120);
    if (leftCountry !== rightCountry) return false;
  }
  return true;
}

function getSimpleRequestIcon(definition) {
  const title = safeString(definition?.title, 120).toLowerCase();
  const tag = safeString(definition?.tag, 40).toLowerCase();
  if (title.includes("passport")) return IdCard;
  if (tag === "docs" || title.includes("document")) return IdCard;
  return Sparkles;
}

function buildTrackSimpleRequestMeta({
  definition = null,
  track = "",
  profileCountry = "",
  serviceName = "",
  pricingKey = "",
  requestDefinitionKey = "",
} = {}) {
  const resolvedServiceName = safeString(serviceName || definition?.title, 140);
  const resolvedTrack = safeString(track, 20).toLowerCase();
  const resolvedCountry = safeString(profileCountry, 120);
  const resolvedPricingKey =
    safeString(pricingKey, 200) ||
    buildRequestPricingKey({
      track: resolvedTrack,
      requestType: "single",
      country: resolvedCountry,
      serviceName: resolvedServiceName,
    });

  return {
    requestType: "single",
    serviceName: resolvedServiceName,
    pricingKey: resolvedPricingKey,
    requestDefinitionKey:
      safeString(requestDefinitionKey, 200) || safeString(definition?.definitionKey, 200),
    requestDefinitionCountry: "",
    isCustom: true,
  };
}

export default function TrackScreen({ track }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { journey } = useUserJourney();
  const safeTrack = useMemo(() => (TRACKS[track] ? track : "study"), [track]);
  const info = TRACKS[safeTrack];
  const cacheKey = safeTrack;
  const initialSnapshot = useMemo(
    () => TRACK_SCREEN_SNAPSHOT_CACHE.get(cacheKey) || null,
    [cacheKey]
  );

  const qs = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const homeContext = safeString(qs.get("context"), 60) || "default";
  const shouldAutoOpenSimple = qs.get("autoOpen") === "1";
  const querySimpleServiceName = safeString(qs.get("open"), 140);
  const querySimpleDefinitionKey = safeString(qs.get("definitionKey"), 200);
  const querySimplePricingKey = safeString(qs.get("pricingKey"), 200);

  const {
    countries: managedCountriesForTrack,
    hasManagedDocs: hasManagedCountries,
    loading: countriesLoading,
  } = useManagedDestinationCountries({
    trackType: safeTrack,
    fallbackCountries: APP_DESTINATION_COUNTRIES,
  });
  const { countryMap } = useCountryDirectory();
  const { module: homeDesignModule, loading: homeDesignLoading } = useHomeDesignModule({
    trackType: safeTrack,
    contextKey: homeContext,
  });

  const [uid, setUid] = useState(null);
  const resolvedUid = safeString(uid || auth.currentUser?.uid, 160);
  const [userState, setUserState] = useState(() => initialSnapshot?.userState || null);
  const [profileCountry, setProfileCountry] = useState(() =>
    safeString(initialSnapshot?.profileCountry, 120)
  );
  const [profileLoading, setProfileLoading] = useState(() => !initialSnapshot?.profileChecked);
  const [profileChecked, setProfileChecked] = useState(() => Boolean(initialSnapshot?.profileChecked));
  const [defaultName, setDefaultName] = useState(() => safeString(initialSnapshot?.defaultName, 140));
  const [defaultPhone, setDefaultPhone] = useState(() =>
    safeString(initialSnapshot?.defaultPhone, 80)
  );
  const [defaultCounty, setDefaultCounty] = useState(() =>
    safeString(initialSnapshot?.defaultCounty, 120)
  );
  const [defaultTown, setDefaultTown] = useState(() => safeString(initialSnapshot?.defaultTown, 120));
  const [simpleDefinitions, setSimpleDefinitions] = useState(() =>
    Array.isArray(initialSnapshot?.simpleDefinitions) ? initialSnapshot.simpleDefinitions : []
  );
  const [simpleLoading, setSimpleLoading] = useState(() => Boolean(initialSnapshot?.simpleLoading));
  const [simpleError, setSimpleError] = useState(() => safeString(initialSnapshot?.simpleError, 260));
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [simpleModalOpen, setSimpleModalOpen] = useState(false);
  const [simpleRequestMeta, setSimpleRequestMeta] = useState(null);
  const [simpleModalResumeState, setSimpleModalResumeState] = useState(null);
  const [startingType, setStartingType] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");
  const [pulseItems, setPulseItems] = useState(() =>
    Array.isArray(initialSnapshot?.pulseItems) ? initialSnapshot.pulseItems : []
  );
  const [pulseLoading, setPulseLoading] = useState(() =>
    initialSnapshot?.pulseReady ? false : true
  );
  const [latestRequest, setLatestRequest] = useState(() => initialSnapshot?.latestRequest || null);
  const [latestRequestLoading, setLatestRequestLoading] = useState(() =>
    initialSnapshot?.latestRequestReady ? false : true
  );
  const [latestRequestProgressRows, setLatestRequestProgressRows] = useState(() =>
    Array.isArray(initialSnapshot?.latestRequestProgressRows)
      ? initialSnapshot.latestRequestProgressRows
      : []
  );
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const featuredScrollerRef = useRef(null);
  const simpleResumeAppliedRef = useRef(false);
  const simpleAutoOpenedRef = useRef(false);
  const shouldBlockPulseSkeletonRef = useRef(!initialSnapshot?.pulseReady);
  const shouldBlockSimpleSkeletonRef = useRef(!initialSnapshot?.simpleDefinitionsReady);

  const visibleCountries = useMemo(() => {
    if (countriesLoading) {
      const cachedVisible = Array.isArray(initialSnapshot?.visibleCountries)
        ? initialSnapshot.visibleCountries
        : [];
      if (cachedVisible.length) return cachedVisible;
      return APP_DESTINATION_COUNTRIES;
    }
    return hasManagedCountries ? managedCountriesForTrack : APP_DESTINATION_COUNTRIES;
  }, [countriesLoading, hasManagedCountries, initialSnapshot, managedCountriesForTrack]);

  const featuredCountries = useMemo(() => {
    const configured = (Array.isArray(homeDesignModule?.featuredCountries)
      ? homeDesignModule.featuredCountries
      : []
    ).filter((entry) => entry?.isActive !== false && safeString(entry?.country, 120));

    if (configured.length) return configured;

    return visibleCountries.slice(0, 6).map((country, index) => ({
      id: `fallback_${country}_${index}`,
      country,
      label: country,
      eyebrow: "Featured",
      metaLabel: "",
      metaValue: "",
      description: "",
      imageUrl: "",
      flagOverride: "",
      isActive: true,
      sortOrder: index + 1,
    }));
  }, [homeDesignModule, visibleCountries]);

  const polishedFeaturedCountries = useMemo(() => {
    return featuredCountries.map((entry) => {
      const rawCountry = safeString(entry?.country, 120);
      const country = normalizeDestinationCountry(rawCountry) || rawCountry;
      const adminImage = safeString(entry?.imageUrl, 1200);
      return {
        ...entry,
        country,
        label: safeString(entry?.label, 120) || country,
        imageUrl: adminImage || FEATURED_COUNTRY_IMAGES[country] || "",
        flagOverride:
          safeString(entry?.flagOverride, 32) ||
          FEATURED_COUNTRY_CODES[country] ||
          country.slice(0, 2).toUpperCase(),
      };
    });
  }, [featuredCountries]);

  const pulseCountries = useMemo(() => {
    const merged = [
      ...polishedFeaturedCountries.map((entry) => safeString(entry?.country, 120)),
      ...visibleCountries.map((country) => safeString(country, 120)),
    ].filter(Boolean);
    const seen = new Set();
    const unique = [];
    merged.forEach((country) => {
      const key = country.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(country);
    });
    return unique.slice(0, 5);
  }, [polishedFeaturedCountries, visibleCountries]);

  const filteredVisibleCountries = useMemo(() => {
    const needle = safeString(countrySearch, 120).toLowerCase();
    return visibleCountries.filter((country) => {
      if (countryFilter !== "all" && !countryMatchesFilterGroup(country, countryFilter)) {
        return false;
      }
      if (needle && !safeString(country, 120).toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [countryFilter, countrySearch, visibleCountries]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user ? user.uid : null);
      if (!user) {
        TRACK_SCREEN_SNAPSHOT_CACHE.clear();
        setUserState(null);
        setProfileCountry("");
        setProfileChecked(true);
        setDefaultName("");
        setDefaultPhone("");
        setDefaultCounty("");
        setDefaultTown("");
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      setProfileChecked(false);
      getUserState(user.uid)
        .then((nextState) => {
          setUserState(nextState || null);
          setProfileCountry(safeString(nextState?.countryOfResidence, 120));
          setDefaultName(safeString(nextState?.name, 140));
          setDefaultPhone(safeString(nextState?.phone, 80));
          setDefaultCounty(safeString(nextState?.county, 120));
          setDefaultTown(safeString(nextState?.town || nextState?.city, 120));
        })
        .catch((error) => {
          console.error("TrackScreen profile load failed:", error);
          setUserState(null);
          setProfileCountry("");
          setDefaultName("");
          setDefaultPhone("");
          setDefaultCounty("");
          setDefaultTown("");
        })
        .finally(() => {
          setProfileLoading(false);
          setProfileChecked(true);
        });
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!resolvedUid) return;
    void logAnalyticsEvent({
      uid: resolvedUid,
      eventType: ANALYTICS_EVENT_TYPES.TRACK_SCREEN_OPENED,
      trackType: safeTrack,
      sourceScreen: "TrackScreen",
      metadata: { contextKey: homeContext },
    });
  }, [homeContext, resolvedUid, safeTrack]);

  useEffect(() => {
    if (!resolvedUid || !profileCountry) {
      setSimpleDefinitions([]);
      setSimpleError("");
      setSimpleLoading(false);
      return undefined;
    }

    if (shouldBlockSimpleSkeletonRef.current) setSimpleLoading(true);
    setSimpleError("");

    return subscribeActiveRequestDefinitions({
      trackType: safeTrack,
      country: profileCountry,
      entryPlacement: "track_simple",
      countrySource: "profile_country_of_residence",
      onData: (rows) => {
        setSimpleDefinitions(Array.isArray(rows) ? rows : []);
        setSimpleLoading(false);
        shouldBlockSimpleSkeletonRef.current = false;
      },
      onError: (error) => {
        console.error("track simple request definitions load failed:", error);
        setSimpleError(error?.message || "Failed to load simple request types.");
        setSimpleLoading(false);
        shouldBlockSimpleSkeletonRef.current = false;
      },
    });
  }, [profileCountry, resolvedUid, safeTrack]);

  useEffect(() => {
    let cancelled = false;
    if (!pulseCountries.length) {
      setPulseItems([]);
      setPulseLoading(false);
      return undefined;
    }

    if (shouldBlockPulseSkeletonRef.current) setPulseLoading(true);
    void (async () => {
      try {
        const bundles = await Promise.all(
          pulseCountries.map(async (country) => {
            const rows = await listPublishedNews({
              trackType: safeTrack,
              country,
            });
            return (Array.isArray(rows) ? rows : []).slice(0, 2).map((item) => ({
              ...item,
              pulseCountry: country,
              impactLabel: getImpactLabel(item),
              timestampMs: getNewsTimestampMs(item),
            }));
          })
        );
        if (cancelled) return;

        const merged = bundles.flat().filter((item) => safeString(item?.title, 220));
        merged.sort((left, right) => {
          const importanceGap = Number(right?.importanceScore || 0) - Number(left?.importanceScore || 0);
          if (importanceGap !== 0) return importanceGap;
          return Number(right?.timestampMs || 0) - Number(left?.timestampMs || 0);
        });
        const nextPulse = merged.slice(0, 9);
        setPulseItems((prev) => (isSamePulseItems(prev, nextPulse) ? prev : nextPulse));
      } catch (error) {
        if (cancelled) return;
        console.error("track pulse load failed:", error);
      } finally {
        if (!cancelled) {
          setPulseLoading(false);
          shouldBlockPulseSkeletonRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pulseCountries, safeTrack]);

  useEffect(() => {
    if (!resolvedUid) {
      setLatestRequest(null);
      setLatestRequestLoading(false);
      return undefined;
    }

    return onSnapshot(
      query(collection(db, "serviceRequests"), where("uid", "==", resolvedUid)),
      (snapshot) => {
        const rows = snapshot.docs
          .map((row) => normalizeTextDeep({ id: row.id, ...(row.data() || {}) }))
          .filter((row) => hasStartedWorkEvidence(row))
          .sort((left, right) => requestSortMs(right) - requestSortMs(left));
        const nextLatest = rows[0] || null;
        setLatestRequest((prev) => (isSameLatestRequest(prev, nextLatest) ? prev : nextLatest));
        setLatestRequestLoading(false);
      },
      (error) => {
        console.error("track latest request snapshot failed:", error);
        setLatestRequestLoading(false);
      }
    );
  }, [resolvedUid]);

  useEffect(() => {
    const requestId = safeString(latestRequest?.id, 180);
    if (!requestId) {
      setLatestRequestProgressRows([]);
      return undefined;
    }

    return subscribeRequestProgressUpdates({
      requestId,
      viewerRole: "user",
      onData: (rows) => {
        const nextRows = Array.isArray(rows) ? rows : [];
        setLatestRequestProgressRows((prev) => (isSameProgressRows(prev, nextRows) ? prev : nextRows));
      },
      onError: (error) => {
        console.error("track latest progress updates failed:", error);
      },
    });
  }, [latestRequest?.id]);

  useEffect(() => {
    const country = qs.get("country");
    const from = safeString(qs.get("from"), 40).toLowerCase();

    if (country && from === "choice") {
      setSelectedCountry(normalizeDestinationCountry(country) || country);
      setShowModal(true);
    }
  }, [qs]);

  const clearSimpleRequestQueryParams = () => {
    const nextQuery = new URLSearchParams(location.search || "");
    [
      "autoOpen",
      "open",
      "draft",
      "definitionKey",
      "definitionCountry",
      "pricingKey",
    ].forEach((key) => nextQuery.delete(key));
    navigate(
      {
        pathname: location.pathname,
        search: nextQuery.toString() ? `?${nextQuery.toString()}` : "",
      },
      { replace: true }
    );
  };

  useEffect(() => {
    if (simpleResumeAppliedRef.current) return;
    if (!profileChecked || !profileCountry) return;

    const resumeState = location.state?.resumeTrackSimple;
    if (!resumeState || String(resumeState.track || "").toLowerCase() !== safeTrack) return;
    const modalState = resumeState?.requestModal;
    if (!modalState?.open || !modalState?.serviceName) return;

    simpleResumeAppliedRef.current = true;
    setSimpleRequestMeta(
      buildTrackSimpleRequestMeta({
        track: safeTrack,
        profileCountry,
        serviceName: modalState.serviceName,
        pricingKey: modalState.pricingKey,
        requestDefinitionKey: modalState.definitionKey,
      })
    );
    setSimpleModalResumeState(modalState);
    setSimpleModalOpen(true);
  }, [location.state, profileChecked, profileCountry, safeTrack]);

  useEffect(() => {
    if (simpleAutoOpenedRef.current) return;
    if (!shouldAutoOpenSimple || !querySimpleServiceName) return;
    if (!profileChecked || !profileCountry) return;

    simpleAutoOpenedRef.current = true;
    setSimpleRequestMeta(
      buildTrackSimpleRequestMeta({
        track: safeTrack,
        profileCountry,
        serviceName: querySimpleServiceName,
        pricingKey: querySimplePricingKey,
        requestDefinitionKey: querySimpleDefinitionKey,
      })
    );
    setSimpleModalResumeState(null);
    setSimpleModalOpen(true);
  }, [
    profileChecked,
    profileCountry,
    querySimpleDefinitionKey,
    querySimplePricingKey,
    querySimpleServiceName,
    safeTrack,
    shouldAutoOpenSimple,
  ]);

  useEffect(() => {
    setSnapshot({
      route: {
        path: location.pathname,
        search: location.search || "",
      },
      trackSelect: {
        selectedTrack: safeTrack,
        destination: selectedCountry || "",
        country: selectedCountry || "",
        category: safeTrack,
        profileCountry,
        contextKey: homeContext,
        subStep: simpleModalOpen
          ? "track-simple-modal-open"
          : showModal
          ? "country-selected-modal-open"
          : selectedCountry
          ? "country-selected"
          : simpleDefinitions.length
          ? "track-simple-ready"
          : "country-list",
        requestModal: simpleModalOpen
          ? {
              open: true,
              serviceName: simpleRequestMeta?.serviceName || "",
              definitionKey: simpleRequestMeta?.requestDefinitionKey || "",
              pricingKey: simpleRequestMeta?.pricingKey || "",
            }
          : null,
      },
    });
  }, [
    homeContext,
    location.pathname,
    location.search,
    profileCountry,
    safeTrack,
    selectedCountry,
    simpleModalOpen,
    simpleRequestMeta,
    showModal,
    simpleDefinitions.length,
  ]);

  useEffect(() => {
    if (!showModal) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape" && !saving) setShowModal(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, saving]);

  useEffect(() => {
    setFeaturedIndex(0);
  }, [polishedFeaturedCountries.length]);

  const resolveAccentColor = (country) => resolveCountryAccentColor(countryMap, country, "");
  const profileAccentColor = resolveAccentColor(profileCountry);
  const firstName = useMemo(
    () => getFirstName(defaultName || userState?.name || auth.currentUser?.displayName || ""),
    [defaultName, userState]
  );
  const greetingTitle = useMemo(() => getTrackGreeting(firstName), [firstName]);
  const trackMeta = APP_TRACK_META[safeTrack] || APP_TRACK_META.study;
  const topBg = "bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const countryCard =
    "relative group w-full overflow-hidden text-left rounded-3xl border border-zinc-200/70 bg-white/80 p-4 shadow-sm backdrop-blur transition will-change-transform hover:border-emerald-200/70 hover:shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-zinc-800 dark:bg-zinc-900/55 dark:hover:border-emerald-900/45";
  const sectionTitle = "text-[1.25rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100";
  const sectionSubtitle = "mt-1 text-sm text-zinc-600 dark:text-zinc-300";

  const latestRequestState = useMemo(() => {
    if (!latestRequest) return "";
    return getUserRequestState(latestRequest);
  }, [latestRequest]);

  const latestRequestPercent = useMemo(() => {
    if (!latestRequest) return 0;
    const fromUpdates = [...(Array.isArray(latestRequestProgressRows) ? latestRequestProgressRows : [])]
      .reverse()
      .find((row) => Number.isFinite(Number(row?.progressPercent)));
    if (fromUpdates) return clampPercent(fromUpdates.progressPercent, 12);

    const workProgress = getRequestWorkProgress(latestRequest);
    if (Number.isFinite(Number(workProgress?.progressPercent))) {
      return clampPercent(workProgress.progressPercent, 12);
    }
    if (latestRequestState === "completed") return 100;
    if (latestRequestState === "rejected") return 35;
    if (latestRequestState === "in_progress" || workProgress.isStarted) return 44;
    return 12;
  }, [latestRequest, latestRequestProgressRows, latestRequestState]);

  const latestRequestName = useMemo(
    () => (latestRequest ? toRequestDisplayName(latestRequest) : ""),
    [latestRequest]
  );

  const latestRequestCountry = useMemo(() => {
    if (!latestRequest) return "";
    return (
      normalizeDestinationCountry(
        latestRequest?.country || latestRequest?.destinationCountry || latestRequest?.activeCountry
      ) ||
      safeString(
        latestRequest?.country || latestRequest?.destinationCountry || latestRequest?.activeCountry,
        120
      )
    );
  }, [latestRequest]);

  const latestRequestStatusLabel = useMemo(() => {
    if (!latestRequestState) return "";
    if (latestRequestState === "completed") return "Completed";
    if (latestRequestState === "rejected") return "Needs correction";
    if (latestRequestState === "in_progress") return "In progress";
    return "Submitted";
  }, [latestRequestState]);

  const latestRequestUpdatedAtLabel = useMemo(() => {
    const timestamp = requestSortMs(latestRequest);
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }, [latestRequest]);

  const trackLabelLower = safeString(trackMeta?.label, 40).toLowerCase();
  const discoveryTaglinePhrases = useMemo(() => {
    const firstPhrase = trackLabelLower
      ? `Find your best ${trackLabelLower} destination`
      : "Find your best destination";
    return [
      firstPhrase,
      "Compare countries side by side",
      "Explore countries before you decide",
    ];
  }, [trackLabelLower]);
  const [discoveryTaglineIndex, setDiscoveryTaglineIndex] = useState(0);
  const [discoveryTaglineText, setDiscoveryTaglineText] = useState("");
  const [discoveryTaglineDeleting, setDiscoveryTaglineDeleting] = useState(false);

  useEffect(() => {
    setDiscoveryTaglineIndex(0);
    setDiscoveryTaglineText("");
    setDiscoveryTaglineDeleting(false);
  }, [discoveryTaglinePhrases]);

  useEffect(() => {
    if (!discoveryTaglinePhrases.length) return undefined;
    const fullText = discoveryTaglinePhrases[discoveryTaglineIndex] || "";
    const typedLength = discoveryTaglineText.length;

    if (!discoveryTaglineDeleting && discoveryTaglineText === fullText) {
      const pauseTimer = window.setTimeout(() => {
        setDiscoveryTaglineDeleting(true);
      }, 3800);
      return () => window.clearTimeout(pauseTimer);
    }

    if (discoveryTaglineDeleting && typedLength === 0) {
      const nextTimer = window.setTimeout(() => {
        setDiscoveryTaglineDeleting(false);
        setDiscoveryTaglineIndex((current) => (current + 1) % discoveryTaglinePhrases.length);
      }, 320);
      return () => window.clearTimeout(nextTimer);
    }

    const tickTimer = window.setTimeout(
      () => {
        setDiscoveryTaglineText((current) =>
          discoveryTaglineDeleting
            ? fullText.slice(0, Math.max(0, current.length - 1))
            : fullText.slice(0, Math.min(fullText.length, current.length + 1))
        );
      },
      discoveryTaglineDeleting ? 36 : 52
    );
    return () => window.clearTimeout(tickTimer);
  }, [
    discoveryTaglineDeleting,
    discoveryTaglineIndex,
    discoveryTaglinePhrases,
    discoveryTaglineText,
  ]);

  useEffect(() => {
    TRACK_SCREEN_SNAPSHOT_CACHE.set(cacheKey, {
      userState,
      profileCountry,
      profileChecked,
      defaultName,
      defaultPhone,
      defaultCounty,
      defaultTown,
      simpleDefinitions,
      simpleLoading,
      simpleError,
      simpleDefinitionsReady: !simpleLoading,
      pulseItems,
      pulseReady: !pulseLoading,
      latestRequest,
      latestRequestReady: !latestRequestLoading,
      latestRequestProgressRows,
      visibleCountries,
      cachedAtMs: Date.now(),
    });
  }, [
    cacheKey,
    defaultCounty,
    defaultName,
    defaultPhone,
    defaultTown,
    latestRequest,
    latestRequestLoading,
    latestRequestProgressRows,
    profileChecked,
    profileCountry,
    pulseItems,
    pulseLoading,
    simpleDefinitions,
    simpleError,
    simpleLoading,
    userState,
    visibleCountries,
  ]);

  const goToTrackSelect = () => {
    if (saving) return;
    navigate("/dashboard", { replace: true });
  };

  const openNewsScreen = (countryContext = "") => {
    navigate("/app/news", {
      state: {
        trackContext: safeTrack,
        countryContext: safeString(countryContext, 120),
        tabContext: "news",
      },
    });
  };

  const openDiscovery = () => {
    navigate(`/app/${safeTrack}/discovery`, {
      state: {
        trackContext: safeTrack,
        tabContext: "home",
      },
    });
  };

  const handleFeaturedScroll = (event) => {
    const node = event.currentTarget;
    const firstChild = node.firstElementChild;
    const cardWidth = Number(firstChild?.clientWidth || 0);
    if (!cardWidth || !polishedFeaturedCountries.length) return;
    const gap = 16;
    const nextIndex = Math.round(node.scrollLeft / (cardWidth + gap));
    setFeaturedIndex(Math.max(0, Math.min(polishedFeaturedCountries.length - 1, nextIndex)));
  };

  const jumpToFeatured = (index) => {
    const node = featuredScrollerRef.current;
    if (!node) return;
    const firstChild = node.firstElementChild;
    const cardWidth = Number(firstChild?.clientWidth || 0);
    if (!cardWidth) return;
    const gap = 16;
    node.scrollTo({
      left: index * (cardWidth + gap),
      behavior: "smooth",
    });
  };

  const openCountry = (country) => {
    const normalized = normalizeDestinationCountry(country) || country;
    setSelectedCountry(normalized);
    setShowModal(true);
    setStatusMsg("");
    setStartingType("");

    void trackManagedCountryTap({
      trackType: safeTrack,
      country: normalized,
      sourceScreen: "TrackScreen",
    });
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
  };

  const closeSimpleModal = () => {
    setSimpleModalOpen(false);
    setSimpleModalResumeState(null);
    clearSimpleRequestQueryParams();
  };

  const startProcessAndGo = async (helpType) => {
    const actorUid = resolvedUid;
    if (!actorUid) {
      navigate("/login", { replace: true });
      return;
    }

    const canonicalCountry = normalizeDestinationCountry(selectedCountry) || selectedCountry;
    if (!canonicalCountry || saving) return;

    setSaving(true);
    setStartingType(helpType);
    setStatusMsg("Saving your progress...");

    try {
      await setSelectedTrack(actorUid, safeTrack);
      await setActiveContext(actorUid, {
        hasActiveProcess: true,
        activeTrack: safeTrack,
        activeCountry: canonicalCountry,
        activeHelpType: helpType,
      });

      const encodedCountry = encodeURIComponent(canonicalCountry);
      navigate(`/app/${safeTrack}/${helpType === "self" ? "self-help" : "we-help"}?country=${encodedCountry}&from=choice`, {
        replace: true,
      });
      setShowModal(false);
    } catch (error) {
      console.error(error);
      setStatusMsg(error?.message || "Failed to save progress.");
    } finally {
      setSaving(false);
      setStartingType("");
    }
  };

  const launchSimpleRequest = async (definition) => {
    const actorUid = resolvedUid;
    if (!actorUid) {
      navigate("/login", { replace: true });
      return;
    }

    const meta = buildTrackSimpleRequestMeta({
      definition,
      track: safeTrack,
      profileCountry,
    });
    if (!meta?.serviceName || saving) return;
    if (!profileCountry) {
      setStatusMsg("Set your country of residence first to use direct request types.");
      return;
    }

    setSaving(true);
    setStartingType(`simple:${meta.serviceName}`);
    setStatusMsg("Preparing request...");

    try {
      await setSelectedTrack(actorUid, safeTrack);
      const pricingQuote = await getRequestPricingQuote({
        pricingKey: meta.pricingKey,
        track: safeTrack,
        country: profileCountry,
        serviceName: meta.serviceName,
        requestType: meta.requestType,
      });
      if (!pricingQuote) {
        alert("This request is configured in SACC but is not live yet: pricing is not set for it.");
        return;
      }
      setSimpleRequestMeta(meta);
      setSimpleModalResumeState(null);
      setSimpleModalOpen(true);
    } catch (error) {
      console.error(error);
      setStatusMsg(error?.message || "Failed to launch request.");
    } finally {
      setSaving(false);
      setStartingType("");
    }
  };

  const submitSimpleRequest = async ({
    name,
    phone,
    note,
    dummyFiles,
    requestUploadMeta,
    extraFieldAnswers,
    email: formEmail,
    requestDraftId,
    county,
    town,
    preferredAgentId,
    paid,
    paymentMeta,
    unlockPaymentReceipt,
  }) => {
    const actorUid = resolvedUid;
    if (!actorUid || !simpleRequestMeta) return;

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      closeSimpleModal();
      navigate("/app/profile");
      return;
    }

    try {
      const cleanName = safeString(name, 140);
      const cleanPhone = safeString(phone, 80);
      if (cleanName && cleanPhone) {
        await upsertUserContact(actorUid, { name: cleanName, phone: cleanPhone });
        setDefaultName(cleanName);
        setDefaultPhone(cleanPhone);
        setUserState((prev) => ({
          ...(prev || {}),
          name: cleanName,
          phone: cleanPhone,
        }));
      }
    } catch (error) {
      console.warn("upsertUserContact failed (continuing anyway):", error);
    }

    const pricingQuote = await getRequestPricingQuote({
      pricingKey: simpleRequestMeta.pricingKey,
      track: safeTrack,
      country: profileCountry,
      serviceName: simpleRequestMeta.serviceName,
      requestType: simpleRequestMeta.requestType,
    });
    const appliedPricing = toRequestPricingSnapshot(pricingQuote, {
      amount: unlockPaymentReceipt?.amount,
      currency: unlockPaymentReceipt?.currency || pricingQuote?.currency,
    });
    if (!appliedPricing) {
      throw new Error("Request pricing is unavailable right now. Please try again.");
    }

    const pendingRequestId = safeString(
      unlockPaymentReceipt?.requestId || paymentMeta?.requestId,
      160
    );
    if (paid && !pendingRequestId) {
      throw new Error("This paid unlock session could not be linked safely. Please start checkout again.");
    }

    const requestId = pendingRequestId
      ? pendingRequestId
      : await createServiceRequest({
          uid: actorUid,
          email: safeString(formEmail || auth.currentUser?.email || "", 200),
          track: safeTrack,
          country: profileCountry,
          requestType: simpleRequestMeta.requestType,
          serviceName: simpleRequestMeta.serviceName,
          name,
          phone,
          note,
          county: safeString(county, 120),
          town: safeString(town, 120),
          city: safeString(town, 120),
          countryOfResidence: profileCountry,
          partnerFilterMode: "home_country",
          preferredAgentId: safeString(preferredAgentId, 140),
          paid: false,
          paymentMeta: null,
          pricingSnapshot: appliedPricing,
          requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
          extraFieldAnswers: extraFieldAnswers || null,
        });

    if (pendingRequestId) {
      const activation = await activatePreparedUnlockRequest({
        requestId: pendingRequestId,
        unlockPaymentReceipt,
      });
      if (activation?.alreadyActivated) {
        if (requestDraftId) {
          await archiveWorkflowDraft(requestDraftId, {
            status: "submitted",
            archivedReason: "request_already_activated",
            linkedRequestId: pendingRequestId,
          });
        }
        closeSimpleModal();
        navigate(`/app/request/${pendingRequestId}`, { replace: true });
        return { requestId: pendingRequestId, alreadyActivated: true };
      }
    }

    const picked = Array.isArray(dummyFiles) ? dummyFiles : [];
    if (picked.length > 0) {
      for (const file of picked) {
        await createPendingAttachment({ requestId, file });
      }
    } else {
      const metaFiles = Array.isArray(requestUploadMeta?.files) ? requestUploadMeta.files : [];
      for (const fileMeta of metaFiles) {
        await createPendingAttachmentFromMeta({ requestId, fileMeta });
      }
    }

    await setActiveProcessDetails(actorUid, {
      hasActiveProcess: true,
      activeTrack: safeTrack,
      activeCountry: profileCountry,
      activeHelpType: "we",
      activeRequestId: requestId,
    });

    if (requestDraftId) {
      await archiveWorkflowDraft(requestDraftId, {
        status: "submitted",
        archivedReason: "request_submitted",
        linkedRequestId: requestId,
      });
    }

    closeSimpleModal();
    navigate(`/app/request/${requestId}`, { replace: true });
    return { requestId };
  };

  const prepareSimpleUnlockCheckout = async ({
    requestDraftId,
    returnTo,
    name,
    phone,
    email: formEmail,
    county,
    town,
    note,
    preferredAgentId,
    requestUploadMeta,
    extraFieldAnswers,
  } = {}) => {
    const actorUid = resolvedUid;
    if (!actorUid || !simpleRequestMeta) {
      throw new Error("Request details are not ready yet.");
    }

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      closeSimpleModal();
      navigate("/app/profile");
      throw new Error("Profile is incomplete.");
    }

    const pricingQuote = await getRequestPricingQuote({
      pricingKey: simpleRequestMeta.pricingKey,
      track: safeTrack,
      country: profileCountry,
      serviceName: simpleRequestMeta.serviceName,
      requestType: simpleRequestMeta.requestType,
    });
    const appliedPricing = toRequestPricingSnapshot(pricingQuote);
    if (!appliedPricing) {
      throw new Error("Request pricing is unavailable right now. Please try again.");
    }

    const requestId = await createServiceRequest({
      uid: actorUid,
      email: safeString(formEmail || auth.currentUser?.email || "", 200),
      track: safeTrack,
      country: profileCountry,
      requestType: simpleRequestMeta.requestType,
      serviceName: simpleRequestMeta.serviceName,
      name: safeString(name, 140),
      phone: safeString(phone, 80),
      note,
      county: safeString(county, 120),
      town: safeString(town, 120),
      city: safeString(town, 120),
      countryOfResidence: profileCountry,
      partnerFilterMode: "home_country",
      preferredAgentId: safeString(preferredAgentId, 140),
      paid: false,
      paymentMeta: null,
      pricingSnapshot: appliedPricing,
      requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
      extraFieldAnswers: extraFieldAnswers || null,
      status: "payment_pending",
      skipAdminPush: true,
    });

    return createUnlockCheckoutSession({
      requestId,
      draftId: requestDraftId,
      returnTo,
      appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
    });
  };

  const simpleModalTitle = useMemo(() => {
    if (!simpleRequestMeta?.serviceName) return t("request");
    return `${t("request_label")}: ${simpleRequestMeta.serviceName}`;
  }, [simpleRequestMeta, t]);

  const simpleModalSubtitle = useMemo(() => {
    const profileLabel = profileCountry || t("profile_country");
    return `${info.title} - ${profileLabel}`;
  }, [info.title, profileCountry, t]);

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-6xl px-5 py-6 pb-10">
        <section className="relative overflow-hidden rounded-[30px] border border-white/70 bg-white/78 p-5 shadow-[0_14px_44px_rgba(15,23,42,0.08)] dark:border-zinc-800/90 dark:bg-zinc-900/62">
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 right-[-56px] h-44 w-44 rounded-full bg-emerald-300/25 blur-3xl dark:bg-emerald-600/20"
            animate={{ x: [0, -12, 0], y: [0, 8, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
          />
          <Motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 left-[-56px] h-40 w-40 rounded-full bg-cyan-300/16 blur-3xl dark:bg-cyan-600/12"
            animate={{ x: [0, 8, 0], y: [0, -6, 0] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[1.95rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {greetingTitle}
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Choose a destination to start your journey
              </p>
            </div>

            <button
              type="button"
              onClick={goToTrackSelect}
              disabled={saving}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white/85 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100 dark:hover:border-emerald-900/45"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Tracks
            </button>
          </div>

        </section>

        {statusMsg ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/75 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
            {statusMsg}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4">
          <section className="order-1">
            <h2 className="text-[1.06rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Your Current Process
            </h2>

            {latestRequestLoading ? (
              <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-zinc-200/75 bg-white/72 p-2.5 dark:border-zinc-700 dark:bg-zinc-900/55">
                <div className="h-16 w-16 animate-pulse rounded-full border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/70" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-3 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-2.5 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                </div>
              </div>
            ) : latestRequest ? (
              <button
                type="button"
                onClick={() => navigate(`/app/request/${latestRequest.id}`)}
                className="mt-2.5 flex w-full items-center gap-3 rounded-xl border border-zinc-200/80 bg-white/80 p-2.5 text-left transition hover:border-emerald-200 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/58 dark:hover:border-emerald-900/40"
              >
                <CurrentProcessRing
                  percent={latestRequestPercent}
                  size={90}
                  stroke={9}
                  label={`${latestRequestPercent}% complete`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {latestRequestName}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {latestRequestCountry
                      ? `${latestRequestCountry} - ${trackMeta.label}`
                      : trackMeta.title}
                  </div>
                  {latestRequestUpdatedAtLabel ? (
                    <div className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Updated {latestRequestUpdatedAtLabel}
                    </div>
                  ) : null}
                  <div className="mt-1.5 inline-flex rounded-full border border-emerald-100 bg-emerald-50/75 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                    {latestRequestStatusLabel}
                  </div>
                </div>
              </button>
            ) : (
              <div className="mt-2.5 rounded-xl border border-dashed border-zinc-200 bg-white/72 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                No in-progress request yet. Start a route to continue here.
              </div>
            )}
          </section>

          <TrackPulseStrip
            className="order-2"
            items={pulseItems}
            loading={pulseLoading}
            onOpenItem={(item) =>
              openNewsScreen(item?.pulseCountry || item?.country || profileCountry)
            }
            onOpenFeed={() => openNewsScreen(profileCountry)}
          />

          <section className="order-3 relative overflow-hidden rounded-[22px] border border-emerald-200/65 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 p-3 shadow-[0_10px_28px_rgba(16,185,129,0.25)] dark:border-emerald-900/45">
            <Motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/20 blur-3xl"
              animate={{ x: [0, -8, 0], y: [0, 8, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />
            <Motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-12 left-[-52px] h-32 w-32 rounded-full bg-black/10 blur-3xl"
              animate={{ x: [0, 6, 0], y: [0, -8, 0] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            />

            <button
              type="button"
              onClick={openDiscovery}
              className="group relative flex w-full items-center gap-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/85">
                  Discovery
                </div>
                <div className="mt-0.5 text-[1rem] font-semibold tracking-tight text-white">
                  Discover Destinations
                </div>
                <p className="mt-0.5 h-[1.05rem] text-xs text-white/90">
                  <span className="block max-w-full truncate whitespace-nowrap">
                    {discoveryTaglineText}
                  </span>
                </p>
              </div>

              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/45 bg-black/15 text-white transition group-hover:bg-black/25">
                <AppIcon size={ICON_MD} icon={Compass} className="text-white" />
              </span>
            </button>
          </section>

          <section className="order-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className={sectionTitle}>{homeDesignModule?.title || t("top_countries")}</h2>
                <p className={sectionSubtitle}>
                  {homeDesignModule?.subtitle || "Top selected countries by users"}
                </p>
              </div>
              <span className="rounded-full border border-zinc-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/65 dark:text-zinc-300">
                {polishedFeaturedCountries.length} picks
              </span>
            </div>

            {homeDesignLoading && !polishedFeaturedCountries.length ? (
              <div className="mt-4 rounded-2xl border border-zinc-200/70 bg-white/75 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/58 dark:text-zinc-300">
                Loading featured countries...
              </div>
            ) : (
              <div className="mt-4">
                <div
                  ref={featuredScrollerRef}
                  onScroll={handleFeaturedScroll}
                  className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  {polishedFeaturedCountries.map((entry) => {
                    const country = safeString(entry?.country, 120);
                    const accentColor = resolveAccentColor(country);
                    const imageUrl = safeString(entry?.imageUrl, 1200);
                    return (
                      <button
                        key={entry.id || country}
                        type="button"
                        onClick={() => openCountry(country)}
                        className="group relative h-[14.2rem] min-w-[16.8rem] flex-none snap-start overflow-hidden rounded-[28px] border border-zinc-200/80 text-left shadow-sm transition active:scale-[0.99] dark:border-zinc-700/80"
                        style={buildCountryAccentSurfaceStyle(accentColor, { strong: true })}
                      >
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                        ) : null}
                        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-black/25 to-black/0" />
                        <span
                          className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
                          style={buildCountryAccentRailStyle(accentColor)}
                        />

                        <div className="relative flex h-full flex-col justify-between p-4 text-white">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
                                {entry.eyebrow || "Featured"}
                              </div>
                              <div className="mt-2 text-xl font-semibold leading-tight">
                                {entry.label || country}
                              </div>
                            </div>
                            <span className="rounded-full border border-white/45 bg-black/25 px-2.5 py-1 text-[11px] font-semibold">
                              {entry.flagOverride}
                            </span>
                          </div>

                          <div>
                            {entry.description ? (
                              <p className="text-sm text-white/90">{entry.description}</p>
                            ) : null}
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                {entry.metaLabel && entry.metaValue ? (
                                  <>
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/75">
                                      {entry.metaLabel}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-white">
                                      {entry.metaValue}
                                    </div>
                                  </>
                                ) : null}
                              </div>
                              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/45 bg-black/25 text-white">
                                <AppIcon size={ICON_MD} icon={ChevronRight} />
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {polishedFeaturedCountries.length > 1 ? (
                  <div className="mt-3 flex items-center justify-center gap-2">
                    {polishedFeaturedCountries.map((entry, index) => (
                      <button
                        key={`featured-dot-${entry.id || entry.country || index}`}
                        type="button"
                        onClick={() => jumpToFeatured(index)}
                        className={`h-2.5 rounded-full transition ${
                          featuredIndex === index
                            ? "w-7 bg-emerald-500"
                            : "w-2.5 bg-zinc-300 dark:bg-zinc-700"
                        }`}
                        aria-label={`Go to featured country ${index + 1}`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="order-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className={sectionTitle}>{t("country_selection")}</h2>
                <p className={sectionSubtitle}>Search, filter, and choose a destination</p>
              </div>
              <span className="rounded-full border border-zinc-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/65 dark:text-zinc-300">
                {filteredVisibleCountries.length} available
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
                  <AppIcon size={ICON_SM} icon={Search} />
                </span>
                <input
                  type="search"
                  value={countrySearch}
                  onChange={(event) => setCountrySearch(event.target.value)}
                  placeholder="Search country..."
                  className="w-full rounded-2xl border border-zinc-200/80 bg-white/90 py-3 pl-10 pr-20 text-sm font-medium text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-900/35"
                />
                {countrySearch ? (
                  <button
                    type="button"
                    onClick={() => setCountrySearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-600 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    Clear
                  </button>
                ) : null}
              </label>

              <div className="flex flex-wrap gap-2">
                {COUNTRY_FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setCountryFilter(item.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      countryFilter === item.key
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                        : "border-zinc-200 bg-white/85 text-zinc-600 hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-emerald-900/40"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {!countriesLoading && hasManagedCountries && visibleCountries.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/75 p-4 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/58 dark:text-zinc-300">
                No active countries are available for this track right now.
              </div>
            ) : filteredVisibleCountries.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-white/75 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                No countries match your search right now.
              </div>
            ) : (
              <Motion.div
                className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                variants={listWrap}
                initial="hidden"
                animate="show"
              >
                {filteredVisibleCountries.map((country) => {
                  const highlighted = journeyShouldHighlightCountry(journey, {
                    track: safeTrack,
                    country,
                  });
                  const accentColor = resolveAccentColor(country);
                  return (
                    <Motion.button
                      key={country}
                      type="button"
                      onClick={() => openCountry(country)}
                      variants={listItem}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.99 }}
                      className={countryCard}
                      style={buildCountryAccentSurfaceStyle(accentColor, { strong: highlighted })}
                    >
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-3xl"
                        style={buildCountryAccentRailStyle(accentColor)}
                      />
                      <div className="relative flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {country}
                          </div>
                          {highlighted ? (
                            <div className="mt-2">
                              <span
                                className="rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                                style={buildCountryAccentBadgeStyle(accentColor)}
                              >
                                Continue journey
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100">
                          <AppIcon size={ICON_MD} icon={ChevronRight} />
                        </span>
                      </div>
                    </Motion.button>
                  );
                })}
              </Motion.div>
            )}
          </section>

          <section className="order-6">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className={sectionTitle}>{t("simple_requests")}</h2>
                <p className={sectionSubtitle}>Direct requests resolved from your profile country</p>
              </div>
            </div>

            {!profileCountry && !profileLoading ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                Add your country of residence in your profile before using simple request types.
              </div>
            ) : simpleError ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                {simpleError}
              </div>
            ) : simpleLoading ? (
              <div className="mt-4 rounded-2xl border border-zinc-200/70 bg-white/75 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/58 dark:text-zinc-300">
                Loading simple request types...
              </div>
            ) : simpleDefinitions.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-white/75 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                No direct request types are configured yet for {profileCountry || "this profile"}.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {simpleDefinitions.map((definition) => {
                  const icon = getSimpleRequestIcon(definition);
                  const serviceName = safeString(definition?.title, 140);
                  const isLaunching = startingType === `simple:${serviceName}`;
                  return (
                    <button
                      key={definition.definitionKey || definition.id}
                      type="button"
                      onClick={() => void launchSimpleRequest(definition)}
                      disabled={saving}
                      className="relative overflow-hidden rounded-[24px] border border-zinc-200/80 bg-white/84 p-4 text-left shadow-sm transition hover:-translate-y-[1px] hover:shadow-[0_14px_40px_rgba(15,23,42,0.08)] active:scale-[0.99] disabled:opacity-65 dark:border-zinc-700 dark:bg-zinc-900/62"
                      style={buildCountryAccentSurfaceStyle(profileAccentColor, { strong: true })}
                    >
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-[24px]"
                        style={buildCountryAccentRailStyle(profileAccentColor)}
                      />

                      <div className="relative">
                        <div className="flex items-start justify-between gap-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100">
                            <AppIcon size={ICON_MD} icon={icon} />
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            {definition.tag ? (
                              <span
                                className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                                style={buildCountryAccentBadgeStyle(profileAccentColor)}
                              >
                                {definition.tag}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                          {definition.title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                          {definition.summary || `Uses ${profileCountry} from your profile automatically.`}
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          <span>{isLaunching ? t("opening") : t("start_request")}</span>
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100">
                            <AppIcon size={ICON_SM} icon={ChevronRight} />
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="order-7">
            <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <AppIcon
                  size={ICON_SM}
                  icon={ShieldCheck}
                  className="animate-pulse text-emerald-500 dark:text-emerald-300"
                />
                Verified Partners
              </span>
              <span className="inline-flex items-center gap-1.5">
                <AppIcon size={ICON_SM} icon={User} />
                Human Guidance
              </span>
            </div>
          </section>
        </div>
      </div>

      <AnimatePresence>
        {showModal ? (
          <Motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center"
            variants={overlayMotion}
            initial="hidden"
            animate="show"
            exit="exit"
            onMouseDown={closeModal}
          >
            <Motion.div
              className="w-full max-w-md rounded-3xl border border-white/75 bg-white/66 p-5 shadow-[0_18px_52px_rgba(15,23,42,0.2)] backdrop-blur-xl dark:border-zinc-700/70 dark:bg-zinc-900/50"
              variants={sheetMotion}
              initial="hidden"
              animate="show"
              exit="exit"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                    {t("selected_country")}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedCountry}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {t("choose_request_path")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/60 text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-950/45"
                  aria-label="Close"
                >
                  <AppIcon size={ICON_MD} icon={X} />
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  onClick={() => void startProcessAndGo("self")}
                  disabled={saving}
                  className="group w-full rounded-3xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 disabled:opacity-60 dark:border-zinc-600 dark:bg-white dark:text-zinc-900"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white">
                      <AppIcon size={ICON_MD} icon={User} className="text-zinc-700" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span>{saving && startingType === "self" ? "Starting..." : "Self-Help"}</span>
                        <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                          Free
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-zinc-600">
                        Guide yourself independly with curated resources
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void startProcessAndGo("we")}
                  disabled={saving}
                  className="group w-full rounded-3xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-100 bg-white">
                      <AppIcon size={ICON_MD} icon={Users} className="text-zinc-900" />
                    </span>
                    <div className="min-w-0">
                      <div>{saving && startingType === "we" ? "Starting..." : "We-Help"}</div>
                      <div className="mt-0.5 text-xs font-medium text-white/80">
                        Choose a guided support from our  verified Agent networks
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="w-full rounded-3xl border border-zinc-200 bg-transparent px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-950/35"
                >
                  {t("cancel")}
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <RequestModal
        open={simpleModalOpen}
        onClose={closeSimpleModal}
        onSubmit={submitSimpleRequest}
        onPay={prepareSimpleUnlockCheckout}
        title={simpleModalTitle}
        subtitle={simpleModalSubtitle}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={auth.currentUser?.email || ""}
        defaultCounty={defaultCounty}
        defaultTown={defaultTown}
        paymentContext={
          simpleRequestMeta
            ? {
                flow: "wehelp",
                track: safeTrack,
                country: profileCountry,
                countryOfResidence: profileCountry,
                partnerFilterMode: "home_country",
                requestType: simpleRequestMeta.requestType || "single",
                serviceName: simpleRequestMeta.serviceName || "",
                pricingKey: simpleRequestMeta.pricingKey || "",
                requestDefinitionKey: simpleRequestMeta.requestDefinitionKey || "",
                requestDefinitionCountry: "",
              }
            : null
        }
        initialState={simpleModalResumeState?.formState || null}
        onStateChange={setSimpleModalResumeState}
        maxPdfMb={10}
      />
    </div>
  );
}

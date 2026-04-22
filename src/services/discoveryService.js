import {
  APP_TRACK_META,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import { DEFAULT_COUNTRY_ACCENT, normalizeHexColor } from "../utils/countryAccent";

const TRACK_DISCOVERY_COPY = {
  study: {
    line: "Programs, student life, and a clearer next step.",
    summary:
      "Explore study routes with a practical lens: learning quality, student rhythm, and budget reality.",
    quickHighlight: "Student pathways and campus-ready planning",
    editorial:
      "This destination can fit learners who want clear education pathways, dependable timelines, and a smoother onboarding into student life.",
    ctaLabel: "Start Self-Help Planning",
    highlights: [
      "Education pathways are easier to compare when timelines and requirements are visible.",
      "Student life quality matters as much as school ranking for long-term success.",
      "Early financial planning reduces last-minute pressure during admission and visa stages.",
    ],
    practical: [
      { label: "Best for", value: "Academic progression and structured migration planning" },
      { label: "Planning focus", value: "Tuition, housing, visa readiness, and intake windows" },
      { label: "Next move", value: "Build a verified checklist before any major payment" },
    ],
    facts: [
      { label: "Decision style", value: "Evidence-first" },
      { label: "Primary signal", value: "Program fit + budget stability" },
      { label: "Momentum tip", value: "Lock a target intake and work backward" },
    ],
  },
  work: {
    line: "Career opportunities with real-world move planning.",
    summary:
      "Assess this destination from a work-first angle: demand, living setup, and relocation practicality.",
    quickHighlight: "Career routes and relocation readiness",
    editorial:
      "This destination may suit professionals who need stronger career mobility, better income potential, and a stable day-to-day setup.",
    ctaLabel: "Explore Work Readiness",
    highlights: [
      "Job-market momentum can change quickly, so practical timing matters.",
      "Professional profile fit often decides how fast opportunities appear.",
      "Relocation planning is stronger when documents and savings are aligned early.",
    ],
    practical: [
      { label: "Best for", value: "Career growth and structured relocation goals" },
      { label: "Planning focus", value: "Work eligibility, profile fit, and first-month budget" },
      { label: "Next move", value: "Set role targets before starting a formal request" },
    ],
    facts: [
      { label: "Decision style", value: "Career-outcome driven" },
      { label: "Primary signal", value: "Role demand + settlement viability" },
      { label: "Momentum tip", value: "Prioritize markets with active hiring windows" },
    ],
  },
  travel: {
    line: "Trip inspiration with clean practical decisions.",
    summary:
      "Discover the destination through a travel lens: experiences, comfort, and smooth trip logistics.",
    quickHighlight: "Experiences, access, and travel confidence",
    editorial:
      "This destination can be ideal for travelers who want memorable experiences with a balanced level of convenience and reliability.",
    ctaLabel: "Plan My Travel Route",
    highlights: [
      "Trip quality improves when local logistics are planned before booking rush.",
      "Seasonal timing can dramatically affect budget and overall experience.",
      "Layered planning keeps your itinerary exciting while still predictable.",
    ],
    practical: [
      { label: "Best for", value: "Memorable travel with practical comfort planning" },
      { label: "Planning focus", value: "Entry requirements, stay zones, and budget control" },
      { label: "Next move", value: "Map your route and reserve your highest-priority stops" },
    ],
    facts: [
      { label: "Decision style", value: "Experience + comfort balance" },
      { label: "Primary signal", value: "Season, route, and accommodation value" },
      { label: "Momentum tip", value: "Book anchors first, then flexible add-ons" },
    ],
  },
};

const TRACK_FALLBACK_MEDIA = {
  study: [
    "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1456324504439-367cee3b3c32?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1492538368677-f6e0afe31dcc?auto=format&fit=crop&w=1600&q=70",
  ],
  work: [
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1460472178825-e5240623afd5?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=70",
  ],
  travel: [
    "https://images.unsplash.com/photo-1488085061387-422e29b40080?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1530521954074-e64f6810b32d?auto=format&fit=crop&w=1600&q=70",
    "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1600&q=70",
  ],
};

const COUNTRY_MEDIA_OVERRIDES = {
  australia: [
    "https://images.unsplash.com/photo-1523482580672-f109ba8cb9be?auto=format&fit=crop&w=1600&q=70",
  ],
  canada: [
    "https://images.unsplash.com/photo-1503614472-8c93d56e92ce?auto=format&fit=crop&w=1600&q=70",
  ],
  germany: [
    "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=1600&q=70",
  ],
  uk: [
    "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1600&q=70",
  ],
  usa: [
    "https://images.unsplash.com/photo-1499092346589-b9b6be3e94b2?auto=format&fit=crop&w=1600&q=70",
  ],
  "united kingdom": [
    "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1600&q=70",
  ],
  "united states": [
    "https://images.unsplash.com/photo-1499092346589-b9b6be3e94b2?auto=format&fit=crop&w=1600&q=70",
  ],
};

const COUNTRY_FLAG_OVERRIDES = {
  australia: "AU",
  canada: "CA",
  germany: "DE",
  kenya: "KE",
  uk: "GB",
  usa: "US",
  "united kingdom": "GB",
  "united states": "US",
};

function safeString(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function safeTrack(value) {
  return normalizeTrackType(value || "study");
}

function toLookupKey(value) {
  return safeString(value, 160).toLowerCase();
}

function normalizeArray(value, { maxItems = 8, maxItemLength = 320 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const item = safeString(raw, maxItemLength);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeNullableNumber(value, { min = 0, max = 10 } = {}) {
  if (value == null || value === "") return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function normalizeTagList(value, { maxItems = 12, maxItemLength = 84 } = {}) {
  const rows = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/,|\n|;|\u2022/g)
        .map((item) => safeString(item, maxItemLength));
  const seen = new Set();
  const out = [];
  rows.forEach((item) => {
    const tag = safeString(item, maxItemLength);
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  });
  return out.slice(0, maxItems);
}

function normalizeMediaUrls(value, maxItems = 14) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const url = safeString(raw, 1400);
    if (!/^https?:\/\//i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeFactRows(value, fallback = []) {
  const rows = Array.isArray(value) ? value : [];
  if (!rows.length) return fallback;

  const out = [];
  rows.forEach((row) => {
    if (typeof row === "string") {
      const text = safeString(row, 180);
      if (!text) return;
      out.push({ label: "Insight", value: text });
      return;
    }

    const label = safeString(row?.label || row?.title, 80);
    const valueText = safeString(row?.value || row?.description || row?.text, 200);
    if (!label || !valueText) return;
    out.push({ label, value: valueText });
  });

  return out.length ? out.slice(0, 6) : fallback;
}

function normalizePracticalRows(value, fallback = []) {
  const rows = Array.isArray(value) ? value : [];
  if (!rows.length) return fallback;

  const out = [];
  rows.forEach((row) => {
    if (typeof row === "string") {
      const text = safeString(row, 220);
      if (!text) return;
      out.push({ label: "Tip", value: text });
      return;
    }
    const label = safeString(row?.label || row?.title, 80);
    const valueText = safeString(row?.value || row?.description || row?.text, 220);
    if (!label || !valueText) return;
    out.push({ label, value: valueText });
  });

  return out.length ? out.slice(0, 6) : fallback;
}

function normalizePublication(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const overview = source.overview && typeof source.overview === "object" ? source.overview : {};
  const compareData =
    source.compareData && typeof source.compareData === "object" ? source.compareData : {};
  const extras = source.extras && typeof source.extras === "object" ? source.extras : {};
  const visaAcceptanceRatePercent = normalizeNullableNumber(
    compareData?.visaAcceptanceRatePercent ?? compareData?.visaAcceptanceRate,
    { min: 0, max: 100 }
  );
  const processCompletionTime = safeString(
    compareData?.processCompletionTime || compareData?.fullProcessDuration,
    140
  );
  const averageCostEstimate = safeString(
    compareData?.averageCostEstimate || compareData?.typicalApplicationCost,
    140
  );
  const speedScore = normalizeNullableNumber(compareData?.speedScore ?? compareData?.easeScore, {
    min: 0,
    max: 10,
  });
  const bestForTags = normalizeTagList(compareData?.bestForTags || compareData?.bestFor, {
    maxItems: 10,
    maxItemLength: 84,
  });

  return {
    overview: {
      summary: safeString(overview.summary, 1600),
      interestingFacts: safeString(overview.interestingFacts, 2200),
      whyChoose: safeString(overview.whyChoose, 2200),
      trackNotes: safeString(overview.trackNotes, 2200),
      highlightCta: safeString(overview.highlightCta, 420),
    },
    compareData: {
      visaAcceptanceRatePercent,
      visaResultTime: safeString(compareData?.visaResultTime, 140),
      processCompletionTime,
      averageCostEstimate,
      affordabilityTier: safeString(compareData?.affordabilityTier, 60),
      speedScore,
      trackSuitabilityTags: normalizeTagList(compareData?.trackSuitabilityTags, {
        maxItems: 12,
        maxItemLength: 84,
      }),
      bestForTags,
      featuredStrength: safeString(compareData?.featuredStrength, 220),
      interestingFacts: safeString(compareData?.interestingFacts, 2200),
      practicalNotes: safeString(compareData?.practicalNotes, 2200),
      topStudyFields: normalizeTagList(compareData?.topStudyFields, {
        maxItems: 10,
        maxItemLength: 84,
      }),
      studentFriendlyScore: normalizeNullableNumber(compareData?.studentFriendlyScore, {
        min: 0,
        max: 10,
      }),
      educationValueScore: normalizeNullableNumber(compareData?.educationValueScore, {
        min: 0,
        max: 10,
      }),
      topWorkFields: normalizeTagList(compareData?.topWorkFields, {
        maxItems: 10,
        maxItemLength: 84,
      }),
      workOpportunityScore: normalizeNullableNumber(compareData?.workOpportunityScore, {
        min: 0,
        max: 10,
      }),
      employabilityScore: normalizeNullableNumber(compareData?.employabilityScore, {
        min: 0,
        max: 10,
      }),
      travelEaseScore: normalizeNullableNumber(compareData?.travelEaseScore, {
        min: 0,
        max: 10,
      }),
      tourismAppealScore: normalizeNullableNumber(compareData?.tourismAppealScore, {
        min: 0,
        max: 10,
      }),
      tripStyleTags: normalizeTagList(compareData?.tripStyleTags, {
        maxItems: 10,
        maxItemLength: 84,
      }),
      // Legacy aliases for downstream compatibility.
      visaAcceptanceRate: visaAcceptanceRatePercent,
      fullProcessDuration: processCompletionTime,
      typicalApplicationCost: averageCostEstimate,
      estimatedStarterBudget: safeString(compareData?.estimatedStarterBudget, 140),
      easeScore: speedScore,
      documentIntensity: safeString(compareData?.documentIntensity, 140),
      bestFor: safeString(compareData?.bestFor || bestForTags.join(", "), 700),
    },
    extras: {
      additionalNotes: safeString(extras.additionalNotes, 2200),
      internalNotes: safeString(extras.internalNotes, 2200),
      conversionCta: safeString(extras.conversionCta, 420),
      trackGuidanceSnippet: safeString(extras.trackGuidanceSnippet, 700),
    },
    isPublished: source.isPublished !== false,
  };
}

function textToBullets(value, maxItems = 6) {
  const safe = safeString(value, 2800);
  if (!safe) return [];
  return safe
    .split(/\n|•|·|;|\u2022/g)
    .map((item) => safeString(item, 220))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeCode(value) {
  return safeString(value, 8).toUpperCase().replace(/[^A-Z]/g, "");
}

function codeToFlagEmoji(code) {
  const normalized = normalizeCode(code);
  if (normalized.length < 2) return "";
  const letters = normalized.slice(0, 2).split("");
  if (!letters.every((char) => /[A-Z]/.test(char))) return "";
  return letters.map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join("");
}

function getTrackCopy(trackType) {
  const track = safeTrack(trackType);
  return TRACK_DISCOVERY_COPY[track] || TRACK_DISCOVERY_COPY.study;
}

function getTrackMediaFallback(trackType) {
  const track = safeTrack(trackType);
  return TRACK_FALLBACK_MEDIA[track] || TRACK_FALLBACK_MEDIA.study;
}

function getCountryOverridePool(countryName) {
  const key = toLookupKey(countryName);
  return normalizeMediaUrls(COUNTRY_MEDIA_OVERRIDES[key] || [], 6);
}

function toTrackNode(source, trackType) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const node = source[safeTrack(trackType)];
  if (!node || typeof node !== "object" || Array.isArray(node)) return null;
  return node;
}

function resolveTrackDiscoveryNode(countryRow, trackType) {
  const row = countryRow && typeof countryRow === "object" ? countryRow : null;
  if (!row) return null;

  return (
    toTrackNode(row.discovery, trackType) ||
    toTrackNode(row.discoveryContent, trackType) ||
    toTrackNode(row.trackDiscovery, trackType) ||
    null
  );
}

function resolveCountryCode({ countryName = "", countryRow = null } = {}) {
  const rowCode = normalizeCode(countryRow?.code);
  if (rowCode.length >= 2) return rowCode.slice(0, 2);
  const mapped = normalizeCode(COUNTRY_FLAG_OVERRIDES[toLookupKey(countryName)] || "");
  if (mapped.length >= 2) return mapped.slice(0, 2);
  return "";
}

function resolveCountryFlag({ countryName = "", countryRow = null } = {}) {
  const rawFlag = safeString(countryRow?.flag, 12);
  if (rawFlag) return rawFlag;
  const code = resolveCountryCode({ countryName, countryRow });
  return codeToFlagEmoji(code) || "";
}

function resolveAccentColor(countryRow) {
  return (
    normalizeHexColor(countryRow?.accentColor, DEFAULT_COUNTRY_ACCENT) ||
    DEFAULT_COUNTRY_ACCENT
  );
}

function resolveTrackSummary({ trackType, countryName, discoveryNode, publication }) {
  const trackCopy = getTrackCopy(trackType);
  const publicationSummary = safeString(publication?.overview?.summary, 420);
  return (
    publicationSummary ||
    safeString(discoveryNode?.summary || discoveryNode?.intro, 420) ||
    `${countryName}: ${trackCopy.summary}`
  );
}

function resolveQuickHighlight({ trackType, countryName, discoveryNode, featuredEntry, publication }) {
  const bestForTag = Array.isArray(publication?.compareData?.bestForTags)
    ? safeString(publication.compareData.bestForTags[0], 140)
    : "";
  const publicationHighlight =
    safeString(publication?.overview?.highlightCta, 180) ||
    safeString(publication?.extras?.conversionCta, 180) ||
    safeString(publication?.compareData?.featuredStrength, 180) ||
    bestForTag ||
    safeString(publication?.compareData?.bestFor, 180);
  if (publicationHighlight) return publicationHighlight;

  const featuredMetaLabel = safeString(featuredEntry?.metaLabel, 80);
  const featuredMetaValue = safeString(featuredEntry?.metaValue, 120);
  if (featuredMetaLabel && featuredMetaValue) {
    return `${featuredMetaLabel}: ${featuredMetaValue}`;
  }

  const featuredDescription = safeString(featuredEntry?.description, 140);
  if (featuredDescription) return featuredDescription;

  const adminHighlight =
    safeString(discoveryNode?.quickHighlight, 180) ||
    safeString(discoveryNode?.highlight, 180);
  if (adminHighlight) return adminHighlight;

  return `${countryName}: ${getTrackCopy(trackType).quickHighlight}`;
}

function resolveHighlights({ trackType, discoveryNode, publication }) {
  const fromPublication = [
    ...textToBullets(publication?.overview?.interestingFacts, 4),
    ...textToBullets(publication?.overview?.whyChoose, 4),
  ];
  const publicationHighlights = normalizeArray(fromPublication, { maxItems: 6, maxItemLength: 220 });
  if (publicationHighlights.length) return publicationHighlights;

  const admin = normalizeArray(
    Array.isArray(discoveryNode?.highlights) ? discoveryNode.highlights : [],
    { maxItems: 6, maxItemLength: 220 }
  );
  if (admin.length) return admin;
  return getTrackCopy(trackType).highlights.slice(0, 4);
}

function resolveFacts({ trackType, discoveryNode, countryRow, publication }) {
  const fallback = getTrackCopy(trackType).facts.slice(0, 4);
  const compareData = publication?.compareData || {};
  const publicationFacts = [
    Number.isFinite(compareData.visaAcceptanceRatePercent)
      ? { label: "Visa Acceptance", value: `${compareData.visaAcceptanceRatePercent}%` }
      : null,
    compareData.visaResultTime
      ? { label: "Visa Result Time", value: compareData.visaResultTime }
      : null,
    compareData.processCompletionTime
      ? { label: "Process Completion", value: compareData.processCompletionTime }
      : null,
    compareData.averageCostEstimate
      ? { label: "Average Cost", value: compareData.averageCostEstimate }
      : null,
    compareData.affordabilityTier
      ? { label: "Affordability Tier", value: compareData.affordabilityTier }
      : null,
    compareData.estimatedStarterBudget
      ? { label: "Starter Budget", value: compareData.estimatedStarterBudget }
      : null,
    Number.isFinite(compareData.speedScore)
      ? { label: "Speed Score", value: `${compareData.speedScore}/10` }
      : null,
  ].filter(Boolean);
  if (publicationFacts.length) return publicationFacts.slice(0, 6);

  const adminFacts = normalizeFactRows(discoveryNode?.facts, fallback);
  const currency = safeString(countryRow?.currency, 10).toUpperCase();
  if (!currency) return adminFacts;
  if (adminFacts.some((row) => toLookupKey(row?.label) === "currency")) return adminFacts;
  return [...adminFacts, { label: "Currency", value: currency }].slice(0, 5);
}

function resolvePractical({ trackType, discoveryNode, countryName, publication }) {
  const compareData = publication?.compareData || {};
  const bestForTags = Array.isArray(compareData.bestForTags)
    ? compareData.bestForTags.filter(Boolean).slice(0, 4).join(", ")
    : "";
  const fromPublication = [
    bestForTags ? { label: "Best For", value: bestForTags } : null,
    compareData.featuredStrength
      ? { label: "Featured Strength", value: compareData.featuredStrength }
      : null,
    compareData.practicalNotes ? { label: "Practical Notes", value: compareData.practicalNotes } : null,
    publication?.extras?.trackGuidanceSnippet
      ? { label: "Track Guidance", value: publication.extras.trackGuidanceSnippet }
      : null,
    publication?.overview?.trackNotes
      ? { label: "Track Notes", value: publication.overview.trackNotes }
      : null,
  ].filter(Boolean);
  if (fromPublication.length) return fromPublication.slice(0, 4);

  const fallback = getTrackCopy(trackType).practical.slice(0, 4);
  const practical = normalizePracticalRows(discoveryNode?.practicalDetails, fallback);
  if (practical.length >= 3) return practical;
  return [
    ...practical,
    { label: "Country focus", value: `${countryName} - ${APP_TRACK_META[safeTrack(trackType)]?.label || "Track"}` },
  ].slice(0, 4);
}

function resolveEditorial({ trackType, discoveryNode, countryName, publication }) {
  const publicationEditorial = [
    publication?.overview?.whyChoose,
    publication?.overview?.trackNotes,
    publication?.compareData?.interestingFacts,
  ]
    .map((item) => safeString(item, 900))
    .filter(Boolean)
    .join(" ");
  if (publicationEditorial) return publicationEditorial;

  const adminBody = safeString(discoveryNode?.editorial || discoveryNode?.body, 1300);
  if (adminBody) return adminBody;
  return `${countryName}. ${getTrackCopy(trackType).editorial}`;
}

function resolveCtaLabel({ trackType, discoveryNode, publication }) {
  return (
    safeString(publication?.extras?.conversionCta, 80) ||
    safeString(publication?.overview?.highlightCta, 80) ||
    safeString(discoveryNode?.ctaLabel, 80) ||
    getTrackCopy(trackType).ctaLabel
  );
}

export function encodeDiscoveryCountryParam(value) {
  return encodeURIComponent(safeString(value, 180));
}

export function decodeDiscoveryCountryParam(value) {
  const raw = safeString(value, 260);
  if (!raw) return "";
  try {
    return safeString(decodeURIComponent(raw), 180);
  } catch {
    return raw;
  }
}

export function toCountryLookupKey(value) {
  return toLookupKey(normalizeDestinationCountry(value) || value);
}

export function resolveCountryRowFromMap(countryMap, countryName) {
  const map = countryMap instanceof Map ? countryMap : new Map();
  const normalizedCountry = normalizeDestinationCountry(countryName) || countryName;
  const key = toCountryLookupKey(normalizedCountry);
  if (key && map.has(key)) return map.get(key) || null;

  const aliasKeys = (() => {
    const lowered = key;
    if (lowered === "uk") return ["uk", "gb", "united kingdom"];
    if (lowered === "usa") return ["usa", "us", "united states"];
    return [lowered];
  })();

  for (const alias of aliasKeys) {
    if (alias && map.has(alias)) return map.get(alias) || null;
  }

  return null;
}

export function buildDiscoveryCountryView({
  countryName = "",
  countryRow = null,
  trackType = "",
  featuredEntry = null,
  publication = null,
} = {}) {
  const canonicalCountry =
    normalizeDestinationCountry(countryName) ||
    normalizeDestinationCountry(countryRow?.name) ||
    safeString(countryRow?.name, 120) ||
    safeString(countryName, 120);
  if (!canonicalCountry) return null;

  const safeTrackType = safeTrack(trackType);
  const discoveryNode = resolveTrackDiscoveryNode(countryRow, safeTrackType);
  const normalizedPublication = normalizePublication(publication);
  const hasPublication =
    publication && typeof publication === "object" && !Array.isArray(publication);
  const countryImage = (() => {
    const url = safeString(countryRow?.imageUrl, 1400);
    return /^https?:\/\//i.test(url) ? url : "";
  })();
  const countryPool = getCountryOverridePool(canonicalCountry);
  const trackPool = getTrackMediaFallback(safeTrackType);

  const mediaPool = normalizeMediaUrls(
    [
      countryImage,
      ...countryPool,
      ...trackPool,
    ].filter(Boolean),
    16
  );

  const fallbackCode = resolveCountryCode({
    countryName: canonicalCountry,
    countryRow,
  });
  const flag = resolveCountryFlag({ countryName: canonicalCountry, countryRow }) || fallbackCode;
  const quickHighlight = resolveQuickHighlight({
    trackType: safeTrackType,
    countryName: canonicalCountry,
    discoveryNode,
    featuredEntry,
    publication: normalizedPublication,
  });

  return {
    id: safeString(countryRow?.id, 120) || safeString(countryRow?.code, 8) || canonicalCountry,
    trackType: safeTrackType,
    name: canonicalCountry,
    nameKey: toCountryLookupKey(canonicalCountry),
    code: resolveCountryCode({ countryName: canonicalCountry, countryRow }) || fallbackCode,
    flag,
    currency: safeString(countryRow?.currency, 12).toUpperCase(),
    accentColor: resolveAccentColor(countryRow),
    quickHighlight,
    line: safeString(discoveryNode?.line, 220) || getTrackCopy(safeTrackType).line,
    summary: resolveTrackSummary({
      trackType: safeTrackType,
      countryName: canonicalCountry,
      discoveryNode,
      publication: normalizedPublication,
    }),
    editorial: resolveEditorial({
      trackType: safeTrackType,
      discoveryNode,
      countryName: canonicalCountry,
      publication: normalizedPublication,
    }),
    highlights: resolveHighlights({
      trackType: safeTrackType,
      discoveryNode,
      publication: normalizedPublication,
    }),
    facts: resolveFacts({
      trackType: safeTrackType,
      discoveryNode,
      countryRow,
      publication: normalizedPublication,
    }),
    practicalDetails: resolvePractical({
      trackType: safeTrackType,
      discoveryNode,
      countryName: canonicalCountry,
      publication: normalizedPublication,
    }),
    ctaLabel: resolveCtaLabel({
      trackType: safeTrackType,
      discoveryNode,
      publication: normalizedPublication,
    }),
    overview: normalizedPublication.overview,
    compareData: normalizedPublication.compareData,
    hasPublication: Boolean(hasPublication && normalizedPublication.isPublished),
    isPublished: Boolean(normalizedPublication.isPublished),
    mediaPool,
    heroImage: mediaPool[0] || "",
    previewImage: mediaPool[1] || mediaPool[0] || "",
    featuredOrder: Number(featuredEntry?.sortOrder || 0) || 0,
    source: countryRow ? "managed" : "fallback",
  };
}

export function createSeededRandom(seedInput = "") {
  const text = safeString(seedInput, 240) || "majuu";
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithSeed(items, seedInput = "") {
  const rows = Array.isArray(items) ? [...items] : [];
  if (rows.length < 2) return rows;
  const random = createSeededRandom(seedInput);
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = rows[index];
    rows[index] = rows[swapIndex];
    rows[swapIndex] = current;
  }
  return rows;
}

export function getMediaWindow(pool, start = 0, count = 3) {
  const list = normalizeMediaUrls(pool, 24);
  if (!list.length || count <= 0) return [];
  const out = [];
  for (let index = 0; index < count; index += 1) {
    const value = list[(start + index) % list.length];
    if (value) out.push(value);
  }
  return out;
}

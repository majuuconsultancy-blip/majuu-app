import { getDefaultCityForCountry } from "./selfHelpCatalog";

const BADGE_META = {
  featured: {
    label: "Featured",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200",
  },
  partner: {
    label: "Partner",
    className:
      "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-200",
  },
  affiliate: {
    label: "Affiliate",
    className:
      "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/25 dark:text-fuchsia-200",
  },
  official: {
    label: "Official",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200",
  },
  recommended: {
    label: "Recommended",
    className:
      "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100",
  },
  smart: {
    label: "Smart Link",
    className:
      "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200",
  },
  "verified-step": {
    label: "Verified Step Resource",
    className:
      "border-emerald-200 bg-emerald-100/80 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-100",
  },
};

const STAY_TYPE_OPTIONS = {
  study: [
    { value: "student-housing", label: "Student housing" },
    { value: "arrival-stay", label: "Arrival stay" },
    { value: "shared-apartment", label: "Shared apartment" },
  ],
  work: [
    { value: "arrival-stay", label: "Arrival stay" },
    { value: "serviced-apartment", label: "Serviced apartment" },
    { value: "long-stay", label: "Long stay" },
  ],
  travel: [
    { value: "hotel", label: "Hotel" },
    { value: "apartment", label: "Apartment" },
    { value: "hostel", label: "Hostel" },
  ],
};

const STAY_TYPE_LABELS = Object.fromEntries(
  Object.values(STAY_TYPE_OPTIONS)
    .flat()
    .map((option) => [option.value, option.label])
);

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function cleanDate(value) {
  const text = safeString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function buildGoogleFlightsUrl(resource, { track, country }) {
  const phrases = {
    study: "student travel",
    work: "one-way relocation",
    travel: "holiday travel",
  };

  const query = safeString(
    `Flights from Nairobi to ${safeString(country, 80)} ${phrases[track] || ""}`,
    180
  );

  const url = new URL(resource.baseUrl);
  url.searchParams.set("q", query);
  return url.toString();
}

function buildBookingStayUrl(resource, { country, smartParams }) {
  const city = safeString(smartParams?.city, 80) || getDefaultCityForCountry(country);
  const stayType = safeString(smartParams?.stayType, 60);
  const stayLabel = STAY_TYPE_LABELS[stayType] || "";
  const checkIn = cleanDate(smartParams?.checkIn);

  const searchTerms = [city, country].filter(Boolean).join(", ");
  const smartSearch = stayLabel ? `${searchTerms} ${stayLabel}` : searchTerms;

  const url = new URL(resource.baseUrl);
  url.searchParams.set("ss", smartSearch);
  if (checkIn) {
    url.searchParams.set("checkin", checkIn);
  }

  return url.toString();
}

export function getSelfHelpBadgeMeta(label) {
  return BADGE_META[label] || null;
}

export function getSelfHelpBadges(resource, extraLabels = []) {
  const labels = Array.from(
    new Set([
      ...(Array.isArray(resource?.labels) ? resource.labels : []),
      ...(Array.isArray(extraLabels) ? extraLabels : []),
    ])
  );
  return labels.map((label) => getSelfHelpBadgeMeta(label)).filter(Boolean);
}

export function getStayTypeOptions(track) {
  return STAY_TYPE_OPTIONS[track] || STAY_TYPE_OPTIONS.travel;
}

export function buildSmartPromptFields(resource, track, country) {
  if (resource?.smartBuilder !== "booking-stay") return [];

  return [
    {
      id: "city",
      label: "City / area",
      type: "text",
      placeholder: getDefaultCityForCountry(country) || "City or area",
      required: true,
    },
    {
      id: "stayType",
      label: "Stay type",
      type: "select",
      options: getStayTypeOptions(track),
      required: true,
    },
    {
      id: "checkIn",
      label: "Timing",
      type: "date",
      required: false,
    },
  ];
}

export function getInitialSmartPromptValues(resource, track, country, latestEntry) {
  if (resource?.smartBuilder !== "booking-stay") return {};

  return {
    city:
      safeString(latestEntry?.smartParams?.city, 80) ||
      getDefaultCityForCountry(country) ||
      "",
    stayType:
      safeString(latestEntry?.smartParams?.stayType, 60) ||
      getStayTypeOptions(track)[0]?.value ||
      "",
    checkIn: cleanDate(latestEntry?.smartParams?.checkIn),
  };
}

export function sanitizeSmartParams(resource, params) {
  if (resource?.smartBuilder !== "booking-stay") return null;

  return {
    city: safeString(params?.city, 80),
    stayType: safeString(params?.stayType, 60),
    checkIn: cleanDate(params?.checkIn),
  };
}

export function requiresSmartPrompt(resource) {
  return resource?.linkMode === "smart" && Array.isArray(resource?.requiredFields) && resource.requiredFields.length > 0;
}

export function resolveSelfHelpResourceUrl(resource, context) {
  if (!resource) return "";

  if (resource.linkMode !== "smart") {
    return safeString(resource.baseUrl, 1000);
  }

  switch (resource.smartBuilder) {
    case "google-flights":
      return buildGoogleFlightsUrl(resource, context);
    case "booking-stay":
      return buildBookingStayUrl(resource, context);
    default:
      return safeString(resource.baseUrl, 1000);
  }
}

export function getResourceDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function openExternalUrl(url) {
  const safeUrl = safeString(url, 1200);
  if (!safeUrl || typeof window === "undefined") return false;

  try {
    const popup = window.open(safeUrl, "_blank", "noopener,noreferrer");
    if (popup) {
      try {
        popup.opener = null;
      } catch {
        // ignore popup opener hardening issues
      }
      return true;
    }
  } catch {
    // fall through to anchor fallback
  }

  try {
    const anchor = window.document.createElement("a");
    anchor.href = safeUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    window.document.body.appendChild(anchor);
    anchor.click();
    window.document.body.removeChild(anchor);
    return true;
  } catch {
    return false;
  }
}

export function buildSelfHelpRouteTarget({ track, country, sectionId, stepId }) {
  const safeTrack = safeString(track, 20).toLowerCase();
  if (!safeTrack) return null;

  const params = new URLSearchParams();
  if (country) params.set("country", country);

  return {
    path: `/app/${safeTrack}/self-help`,
    search: params.toString() ? `?${params.toString()}` : "",
    state: {
      restoreSelfHelp: {
        sectionId: safeString(sectionId, 40),
        stepId: safeString(stepId, 60),
      },
    },
  };
}

export function buildMoneyToolsRouteTarget({ track, country, tab = "currency" }) {
  const safeTrack = safeString(track, 20).toLowerCase();
  if (!safeTrack) return null;

  const params = new URLSearchParams();
  if (country) params.set("country", country);
  if (tab) params.set("tab", safeString(tab, 24).toLowerCase());

  return {
    path: `/app/${safeTrack}/self-help/money-tools`,
    search: params.toString() ? `?${params.toString()}` : "",
  };
}

export function buildSelfHelpDocumentsRouteTarget({
  track,
  country,
  stepId = "",
  categoryId = "",
  create = false,
}) {
  const safeTrack = safeString(track, 20).toLowerCase();
  if (!safeTrack) return null;

  const params = new URLSearchParams();
  if (country) params.set("country", country);
  if (stepId) params.set("step", safeString(stepId, 80));
  if (categoryId) params.set("docCategory", safeString(categoryId, 40).toLowerCase());
  if (create) params.set("create", "1");

  return {
    path: `/app/${safeTrack}/self-help/documents`,
    search: params.toString() ? `?${params.toString()}` : "",
  };
}

const TRACKS = new Set(["study", "work", "travel"]);

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function toSlug(value) {
  const clean = safeString(value, 160).toLowerCase();
  if (!clean) return "";
  return clean
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function sameText(left, right) {
  return safeString(left, 160).toLowerCase() === safeString(right, 160).toLowerCase();
}

export function normalizeRequestCatalogTrack(value) {
  const track = safeString(value, 20).toLowerCase();
  return TRACKS.has(track) ? track : "";
}

export function normalizeRequestCatalogRequestType(value) {
  const requestType = safeString(value, 20).toLowerCase();
  return requestType === "full" ? "full" : "single";
}

export function buildRequestPricingKey({
  requestType = "single",
  track = "",
  serviceName = "",
} = {}) {
  const safeRequestType = normalizeRequestCatalogRequestType(requestType);
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeServiceName = safeString(serviceName, 140);
  if (!safeTrack || !safeServiceName) return "";
  return `${safeRequestType}__${safeTrack}__${toSlug(safeServiceName)}`;
}

export const DEFAULT_REQUEST_PRICE_KES = 10000;

function createCatalogEntry({
  requestType = "single",
  track,
  serviceName,
  note,
  tag,
  sortOrder,
  defaultAmount = DEFAULT_REQUEST_PRICE_KES,
  currency = "KES",
}) {
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeRequestType = normalizeRequestCatalogRequestType(requestType);
  const safeServiceName = safeString(serviceName, 120);

  return {
    pricingKey: buildRequestPricingKey({
      requestType: safeRequestType,
      track: safeTrack,
      serviceName: safeServiceName,
    }),
    scope: "single_request",
    requestType: safeRequestType,
    track: safeTrack,
    serviceName: safeServiceName,
    label: safeServiceName,
    note: safeString(note, 220),
    tag: safeString(tag, 40),
    currency: safeString(currency, 8).toUpperCase() || "KES",
    defaultAmount: Math.max(1, Math.round(Number(defaultAmount || DEFAULT_REQUEST_PRICE_KES))),
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
  };
}

const REQUEST_CATALOG_SOURCE = [
  {
    track: "study",
    services: [
      { serviceName: "Passport Application", note: "Guidance + document checklist", tag: "Docs" },
      { serviceName: "Visa Application", note: "Forms + appointment + submission support", tag: "Visa" },
      { serviceName: "IELTS Training", note: "Prep plan + resources + practice schedule", tag: "Test" },
      { serviceName: "SOP / Motivation Letter", note: "Writing + polishing", tag: "Writing" },
      { serviceName: "CV / Resume", note: "Professional formatting + improvements", tag: "CV" },
      { serviceName: "Document Review", note: "Verify missing items before submission", tag: "Docs" },
    ],
  },
  {
    track: "work",
    services: [
      { serviceName: "Passport Application", note: "Guidance + document checklist", tag: "Docs" },
      { serviceName: "Visa Application", note: "Forms + appointment + submission support", tag: "Visa" },
      { serviceName: "CV / Resume", note: "Professional formatting + improvements", tag: "CV" },
      { serviceName: "Job Search Strategy", note: "Plan + targeting + profile advice", tag: "Jobs" },
      { serviceName: "Interview Preparation", note: "Practice questions + confidence", tag: "Interview" },
      { serviceName: "Document Review", note: "Verify missing items before submission", tag: "Docs" },
    ],
  },
  {
    track: "travel",
    services: [
      { serviceName: "Passport Application", note: "Guidance + document checklist", tag: "Docs" },
      { serviceName: "Visa Application", note: "Forms + appointment + submission support", tag: "Visa" },
      { serviceName: "IELTS Training", note: "Prep plan + resources + practice schedule", tag: "Test" },
      { serviceName: "SOP / Motivation Letter", note: "Writing + polishing", tag: "Writing" },
      { serviceName: "CV / Resume", note: "Professional formatting + improvements", tag: "CV" },
      { serviceName: "Document Review", note: "Verify missing items before submission", tag: "Docs" },
    ],
  },
];

export const REQUEST_PRICING_CATALOG = REQUEST_CATALOG_SOURCE.flatMap(({ track, services }, trackIndex) =>
  services.map((service, serviceIndex) =>
    createCatalogEntry({
      track,
      sortOrder: (trackIndex + 1) * 100 + serviceIndex,
      ...service,
    })
  )
);

const TRACK_SORT_WEIGHT = {
  study: 1,
  work: 2,
  travel: 3,
};

const REQUEST_CATALOG_BY_KEY = new Map(
  REQUEST_PRICING_CATALOG.map((entry) => [entry.pricingKey, entry])
);

function compareEntries(left, right) {
  const trackGap =
    (TRACK_SORT_WEIGHT[left?.track] || 99) - (TRACK_SORT_WEIGHT[right?.track] || 99);
  if (trackGap !== 0) return trackGap;

  const orderGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (orderGap !== 0) return orderGap;

  return safeString(left?.serviceName, 160).localeCompare(safeString(right?.serviceName, 160));
}

export function listRequestCatalogEntries({ requestType = "", track = "" } = {}) {
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeRequestType = requestType
    ? normalizeRequestCatalogRequestType(requestType)
    : "";

  return REQUEST_PRICING_CATALOG.filter((entry) => {
    if (safeRequestType && entry.requestType !== safeRequestType) return false;
    if (safeTrack && entry.track !== safeTrack) return false;
    return true;
  }).sort(compareEntries);
}

export function listSingleRequestCatalogByTrack(track = "") {
  return listRequestCatalogEntries({ requestType: "single", track });
}

export function findRequestCatalogEntry({
  pricingKey = "",
  requestType = "",
  track = "",
  serviceName = "",
} = {}) {
  const safePricingKey = safeString(pricingKey, 180);
  if (safePricingKey && REQUEST_CATALOG_BY_KEY.has(safePricingKey)) {
    return REQUEST_CATALOG_BY_KEY.get(safePricingKey) || null;
  }

  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeRequestType = requestType
    ? normalizeRequestCatalogRequestType(requestType)
    : "";
  const safeServiceName = safeString(serviceName, 140);
  if (!safeServiceName) return null;

  return (
    REQUEST_PRICING_CATALOG.find((entry) => {
      if (safeRequestType && entry.requestType !== safeRequestType) return false;
      if (safeTrack && entry.track !== safeTrack) return false;
      return sameText(entry.serviceName, safeServiceName);
    }) || null
  );
}

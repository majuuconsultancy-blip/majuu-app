import {
  APP_DESTINATION_COUNTRIES,
  normalizeDestinationCountry,
} from "./migrationOptions";

const TRACKS = new Set(["study", "work", "travel"]);

export const PRICING_SCOPE_SINGLE_REQUEST = "single_request";
export const PRICING_SCOPE_FULL_PACKAGE_ITEM = "full_package_item";
export const DEFAULT_REQUEST_PRICE_KES = 10000;

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

function normalizeCountryFilterValue(value) {
  const raw = safeString(value, 120);
  if (!raw) return "";
  return normalizeRequestCatalogCountry(raw) || "__invalid_country__";
}

export function normalizeRequestCatalogTrack(value) {
  const track = safeString(value, 20).toLowerCase();
  return TRACKS.has(track) ? track : "";
}

export function normalizeRequestCatalogRequestType(value) {
  const requestType = safeString(value, 20).toLowerCase();
  return requestType === "full" ? "full" : "single";
}

export function normalizeRequestCatalogCountry(value) {
  return normalizeDestinationCountry(value);
}

export function buildPricingKey({
  scope = PRICING_SCOPE_SINGLE_REQUEST,
  requestType = "single",
  track = "",
  country = "",
  serviceName = "",
} = {}) {
  const safeScope = safeString(scope, 80).toLowerCase() || PRICING_SCOPE_SINGLE_REQUEST;
  const safeRequestType = normalizeRequestCatalogRequestType(requestType);
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeCountry = normalizeRequestCatalogCountry(country);
  const safeServiceName = safeString(serviceName, 140);
  if (!safeTrack || !safeCountry || !safeServiceName) return "";
  return [
    safeScope,
    safeRequestType,
    safeTrack,
    toSlug(safeCountry),
    toSlug(safeServiceName),
  ].join("__");
}

export function buildRequestPricingKey(input = {}) {
  return buildPricingKey({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    requestType: input?.requestType || "single",
    track: input?.track,
    country: input?.country,
    serviceName: input?.serviceName,
  });
}

export function buildFullPackageItemPricingKey(input = {}) {
  return buildPricingKey({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
    track: input?.track,
    country: input?.country,
    serviceName: input?.serviceName || input?.itemName,
  });
}

const SINGLE_REQUEST_SOURCE = [
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

const FULL_PACKAGE_SOURCE = [
  {
    track: "study",
    items: [
      { serviceName: "Passport", note: "Already have your passport ready", tag: "Docs", defaultAmount: 1700 },
      { serviceName: "SOP / Motivation Letter", note: "Already have a strong SOP or motivation letter", tag: "Writing", defaultAmount: 1400 },
      { serviceName: "IELTS", note: "Already have IELTS covered", tag: "Test", defaultAmount: 2200 },
      { serviceName: "CV / Resume", note: "Already have your CV or resume ready", tag: "CV", defaultAmount: 900 },
      { serviceName: "Offer Letter", note: "Already have an offer letter secured", tag: "Offers", defaultAmount: 1600 },
      { serviceName: "Proof of Funds", note: "Already have proof of funds prepared", tag: "Finance", defaultAmount: 1400 },
    ],
  },
  {
    track: "work",
    items: [
      { serviceName: "Passport", note: "Already have your passport ready", tag: "Docs", defaultAmount: 1700 },
      { serviceName: "SOP / Motivation Letter", note: "Already have a strong supporting letter", tag: "Writing", defaultAmount: 1400 },
      { serviceName: "IELTS", note: "Already have language testing covered", tag: "Test", defaultAmount: 2200 },
      { serviceName: "CV / Resume", note: "Already have your CV or resume ready", tag: "CV", defaultAmount: 900 },
      { serviceName: "Offer Letter", note: "Already have a job or offer letter secured", tag: "Offers", defaultAmount: 1600 },
      { serviceName: "Proof of Funds", note: "Already have proof of funds prepared", tag: "Finance", defaultAmount: 1400 },
    ],
  },
  {
    track: "travel",
    items: [
      { serviceName: "Passport", note: "Already have your passport ready", tag: "Docs", defaultAmount: 1700 },
      { serviceName: "SOP / Motivation Letter", note: "Already have your supporting letter ready", tag: "Writing", defaultAmount: 1400 },
      { serviceName: "IELTS", note: "Already have language testing covered", tag: "Test", defaultAmount: 2200 },
      { serviceName: "CV / Resume", note: "Already have your CV or resume ready", tag: "CV", defaultAmount: 900 },
      { serviceName: "Offer Letter", note: "Already have an invitation or offer letter ready", tag: "Offers", defaultAmount: 1600 },
      { serviceName: "Proof of Funds", note: "Already have proof of funds prepared", tag: "Finance", defaultAmount: 1400 },
    ],
  },
];

function createPricingCatalogEntry({
  scope,
  requestType,
  track,
  country,
  serviceName,
  note,
  tag,
  sortOrder,
  defaultAmount,
  currency = "KES",
}) {
  const safeScope = safeString(scope, 80).toLowerCase();
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeCountry = normalizeRequestCatalogCountry(country);
  const safeRequestType = normalizeRequestCatalogRequestType(requestType);
  const safeServiceName = safeString(serviceName, 120);

  return {
    pricingKey: buildPricingKey({
      scope: safeScope,
      requestType: safeRequestType,
      track: safeTrack,
      country: safeCountry,
      serviceName: safeServiceName,
    }),
    scope: safeScope,
    requestType: safeRequestType,
    track: safeTrack,
    country: safeCountry,
    serviceName: safeServiceName,
    label: safeServiceName,
    note: safeString(note, 220),
    tag: safeString(tag, 40),
    currency: safeString(currency, 8).toUpperCase() || "KES",
    defaultAmount: Math.max(1, Math.round(Number(defaultAmount || DEFAULT_REQUEST_PRICE_KES))),
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
  };
}

function expandCountryRows(source, { scope, requestType, defaultAmount = DEFAULT_REQUEST_PRICE_KES }) {
  return source.flatMap(({ track, services, items }, trackIndex) => {
    const rows = Array.isArray(services) ? services : Array.isArray(items) ? items : [];
    return APP_DESTINATION_COUNTRIES.flatMap((country, countryIndex) =>
      rows.map((entry, entryIndex) =>
        createPricingCatalogEntry({
          scope,
          requestType,
          track,
          country,
          serviceName: entry.serviceName,
          note: entry.note,
          tag: entry.tag,
          sortOrder:
            (trackIndex + 1) * 1000 + (countryIndex + 1) * 100 + entryIndex,
          defaultAmount: entry.defaultAmount || defaultAmount,
        })
      )
    );
  });
}

export const SINGLE_REQUEST_PRICING_CATALOG = expandCountryRows(SINGLE_REQUEST_SOURCE, {
  scope: PRICING_SCOPE_SINGLE_REQUEST,
  requestType: "single",
  defaultAmount: DEFAULT_REQUEST_PRICE_KES,
});

export const FULL_PACKAGE_PRICING_CATALOG = expandCountryRows(FULL_PACKAGE_SOURCE, {
  scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
  requestType: "full",
});

export const PRICING_CATALOG = [
  ...SINGLE_REQUEST_PRICING_CATALOG,
  ...FULL_PACKAGE_PRICING_CATALOG,
];

const PRICING_CATALOG_BY_KEY = new Map(
  PRICING_CATALOG.map((entry) => [entry.pricingKey, entry])
);

const TRACK_SORT_WEIGHT = {
  study: 1,
  work: 2,
  travel: 3,
};

function compareEntries(left, right) {
  const scopeGap = safeString(left?.scope, 80).localeCompare(safeString(right?.scope, 80));
  if (scopeGap !== 0) return scopeGap;

  const trackGap =
    (TRACK_SORT_WEIGHT[left?.track] || 99) - (TRACK_SORT_WEIGHT[right?.track] || 99);
  if (trackGap !== 0) return trackGap;

  const countryGap = safeString(left?.country, 80).localeCompare(safeString(right?.country, 80));
  if (countryGap !== 0) return countryGap;

  const orderGap = Number(left?.sortOrder || 0) - Number(right?.sortOrder || 0);
  if (orderGap !== 0) return orderGap;

  return safeString(left?.serviceName, 160).localeCompare(safeString(right?.serviceName, 160));
}

export function listPricingCatalogEntries({
  scope = "",
  requestType = "",
  track = "",
  country = "",
} = {}) {
  const safeScope = safeString(scope, 80).toLowerCase();
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeCountry = normalizeCountryFilterValue(country);
  const safeRequestType = requestType
    ? normalizeRequestCatalogRequestType(requestType)
    : "";

  return PRICING_CATALOG.filter((entry) => {
    if (safeScope && entry.scope !== safeScope) return false;
    if (safeRequestType && entry.requestType !== safeRequestType) return false;
    if (safeTrack && entry.track !== safeTrack) return false;
    if (safeCountry && entry.country !== safeCountry) return false;
    return true;
  }).sort(compareEntries);
}

export function listRequestCatalogEntries(options = {}) {
  return listPricingCatalogEntries({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    ...options,
  });
}

export function listSingleRequestCatalogByTrack(track = "") {
  const safeTrack = normalizeRequestCatalogTrack(track);
  const source = SINGLE_REQUEST_SOURCE.find((entry) => entry.track === safeTrack);
  if (!source) return [];

  return source.services.map((service, index) => ({
    requestType: "single",
    track: safeTrack,
    serviceName: safeString(service.serviceName, 120),
    label: safeString(service.serviceName, 120),
    note: safeString(service.note, 220),
    tag: safeString(service.tag, 40),
    sortOrder: index,
  }));
}

export function listFullPackageItemCatalogByTrack(track = "") {
  const safeTrack = normalizeRequestCatalogTrack(track);
  const source = FULL_PACKAGE_SOURCE.find((entry) => entry.track === safeTrack);
  if (!source) return [];

  return source.items.map((item, index) => ({
    requestType: "full",
    track: safeTrack,
    serviceName: safeString(item.serviceName, 120),
    label: safeString(item.serviceName, 120),
    note: safeString(item.note, 220),
    tag: safeString(item.tag, 40),
    defaultAmount: Math.max(1, Math.round(Number(item.defaultAmount || 0))),
    sortOrder: index,
  }));
}

export function findPricingCatalogEntry({
  pricingKey = "",
  scope = "",
  requestType = "",
  track = "",
  country = "",
  serviceName = "",
} = {}) {
  const safePricingKey = safeString(pricingKey, 180);
  if (safePricingKey && PRICING_CATALOG_BY_KEY.has(safePricingKey)) {
    return PRICING_CATALOG_BY_KEY.get(safePricingKey) || null;
  }

  const safeScope = safeString(scope, 80).toLowerCase();
  const safeTrack = normalizeRequestCatalogTrack(track);
  const safeCountry = normalizeCountryFilterValue(country);
  const safeRequestType = requestType
    ? normalizeRequestCatalogRequestType(requestType)
    : "";
  const safeServiceName = safeString(serviceName, 140);
  if (!safeServiceName) return null;

  const matches = PRICING_CATALOG.filter((entry) => {
    if (safeScope && entry.scope !== safeScope) return false;
    if (safeRequestType && entry.requestType !== safeRequestType) return false;
    if (safeTrack && entry.track !== safeTrack) return false;
    if (safeCountry && entry.country !== safeCountry) return false;
    return sameText(entry.serviceName, safeServiceName);
  });

  if (matches.length === 1) return matches[0];
  return null;
}

export function findRequestCatalogEntry(input = {}) {
  return findPricingCatalogEntry({
    ...input,
    scope: PRICING_SCOPE_SINGLE_REQUEST,
  });
}

export function findFullPackageCatalogEntry(input = {}) {
  return findPricingCatalogEntry({
    ...input,
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    requestType: "full",
  });
}

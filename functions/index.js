const functions = require("firebase-functions");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const buildFinanceFoundation = require("./finance-foundation");
const buildRequestCommandFoundation = require("./request-command-foundation");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const REGION = "us-central1";
const EVENT_LOCKS = "_functionEvents";
const USERS_NOTIFS = "users";
const ACTIVE_REQUEST_STATUSES = new Set(["new", "contacted"]);
const ADMIN_AVAILABILITY_WEIGHTS = { active: 1, busy: 0.35, offline: 0 };
const DEFAULT_MAX_ACTIVE_REQUESTS = 12;
const DEFAULT_ADMIN_RESPONSE_TIMEOUT_MINUTES = 20;
const DEFAULT_ROUTING_SWEEP_LIMIT = 500;
const PARTNERS_COLLECTION = "partners";
const PARTNER_COVERAGE_COLLECTION = "partnerCoverage";
const REQUEST_DEFINITION_COLLECTION = "requestDefinitions";
const REQUEST_DEFINITION_ENGAGEMENT_COLLECTION = "analytics_requestDefinitionEngagement";
const DOCUMENTS_COLLECTION = "documents";
const DOCUMENT_LINKS_COLLECTION = "documentLinks";
const USER_BUCKET_UPLOADED = "uploaded";
const USER_BUCKET_RECEIVED = "received";
const REQUEST_BUCKET_RECEIVED_FROM_USER = "received_from_user";
const REQUEST_BUCKET_SENT_TO_USER = "sent_to_user";
const REQUEST_BUCKET_INTERNAL = "internal";
const PARTNER_FILTER_MODES = {
  HOME_COUNTRY: "home_country",
  DESTINATION_COUNTRY: "destination_country",
};
const SUPER_ADMIN_ROLE_VARIANTS = [
  "superAdmin",
  "superadmin",
  "super_admin",
  "super-admin",
  "super admin",
];
const ASSIGNED_ADMIN_ROLE_VARIANTS = [
  "assignedAdmin",
  "assignedadmin",
  "assigned_admin",
  "assigned-admin",
  "assigned admin",
  "admin",
];
const MANAGER_ROLE_VARIANTS = [
  "manager",
  "assignedManager",
  "assignedmanager",
  "assigned_manager",
  "assigned-manager",
  "assigned manager",
];
const MANAGER_MODULE_KEYS = new Set([
  "finances",
  "news",
  "request-management",
  "selfhelp-links",
]);
const MANAGER_MODULE_ALIAS_MAP = new Map(
  Object.entries({
    finance: "finances",
    finances: "finances",
    payments: "finances",
    payout: "finances",
    payouts: "finances",
    news: "news",
    discovery: "news",
    request: "request-management",
    requests: "request-management",
    request_management: "request-management",
    "request-management": "request-management",
    affiliate: "selfhelp-links",
    affiliates: "selfhelp-links",
    selfhelp: "selfhelp-links",
    self_help: "selfhelp-links",
    selfhelplinks: "selfhelp-links",
    "selfhelp-links": "selfhelp-links",
  })
);
const MANAGER_STATUS_VALUES = new Set(["active", "pending", "inactive"]);
const MANAGER_INVITES_COLLECTION = "managerInvites";
const MANAGER_AUDIT_COLLECTION = "managerAuditLogs";
const DEFAULT_MANAGER_INVITE_EXPIRY_HOURS = 24;
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
const REQUEST_DEFINITION_ENGAGEMENT_EVENT_TYPES = new Set(["tap", "open", "submission"]);

function safeStr(value) {
  return String(value || "").trim();
}

function lower(value) {
  return safeStr(value).toLowerCase();
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeRole(rawRole) {
  const role = lower(rawRole);
  if (role === "superadmin" || role === "super_admin" || role === "super-admin" || role === "super admin") {
    return "superAdmin";
  }
  if (
    role === "assignedadmin" ||
    role === "assigned_admin" ||
    role === "assigned-admin" ||
    role === "assigned admin"
  ) {
    return "assignedAdmin";
  }
  if (role === "admin") return "assignedAdmin"; // legacy role fallback
  if (
    role === "manager" ||
    role === "assignedmanager" ||
    role === "assigned_manager" ||
    role === "assigned-manager" ||
    role === "assigned manager"
  ) {
    return "manager";
  }
  if (role === "staff") return "staff";
  return "user";
}

function normalizeCountyLower(value) {
  return lower(value);
}

function normalizeCountryLower(value) {
  return lower(value);
}

function normalizePartnerFilterMode(value) {
  const mode = lower(value);
  return mode === PARTNER_FILTER_MODES.HOME_COUNTRY
    ? PARTNER_FILTER_MODES.HOME_COUNTRY
    : PARTNER_FILTER_MODES.DESTINATION_COUNTRY;
}

function normalizeAvailability(value) {
  const v = lower(value);
  return Object.prototype.hasOwnProperty.call(ADMIN_AVAILABILITY_WEIGHTS, v) ? v : "active";
}

function normalizeStringList(values, { max = 120, lowercase = false } = {}) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const normalized = lowercase ? lower(String(value || "").slice(0, max)) : safeStr(value).slice(0, max);
    const key = lowercase ? normalized : lower(normalized);
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizePartnerIdList(values = []) {
  const arr = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const safeId = safeStr(value);
    const key = lower(safeId);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(safeId);
  });
  return out.slice(0, 500);
}

function toMaybeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFiniteDistance(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
}

function normalizeLatLng(rawLat, rawLng) {
  const lat = toMaybeNum(rawLat);
  const lng = toMaybeNum(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function resolveRequestCoordinates(requestData = {}) {
  const geo = requestData?.geo && typeof requestData.geo === "object" ? requestData.geo : {};
  const geolocation =
    requestData?.geolocation && typeof requestData.geolocation === "object"
      ? requestData.geolocation
      : {};
  const location = requestData?.location && typeof requestData.location === "object" ? requestData.location : {};
  return (
    normalizeLatLng(requestData?.latitude, requestData?.longitude) ||
    normalizeLatLng(requestData?.lat, requestData?.lng) ||
    normalizeLatLng(requestData?.lat, requestData?.lon) ||
    normalizeLatLng(geo?.latitude, geo?.longitude) ||
    normalizeLatLng(geo?.lat, geo?.lng) ||
    normalizeLatLng(geolocation?.latitude, geolocation?.longitude) ||
    normalizeLatLng(geolocation?.lat, geolocation?.lng) ||
    normalizeLatLng(location?.latitude, location?.longitude) ||
    normalizeLatLng(location?.lat, location?.lng) ||
    null
  );
}

function resolveScopeCoordinates(scope = {}) {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  return (
    normalizeLatLng(safeScope?.latitude, safeScope?.longitude) ||
    normalizeLatLng(safeScope?.lat, safeScope?.lng) ||
    normalizeLatLng(safeScope?.lat, safeScope?.lon) ||
    normalizeLatLng(safeScope?.geo?.latitude, safeScope?.geo?.longitude) ||
    normalizeLatLng(safeScope?.geo?.lat, safeScope?.geo?.lng) ||
    normalizeLatLng(safeScope?.location?.latitude, safeScope?.location?.longitude) ||
    normalizeLatLng(safeScope?.location?.lat, safeScope?.location?.lng) ||
    null
  );
}

function haversineDistanceKm(pointA, pointB) {
  if (!pointA || !pointB) return Number.POSITIVE_INFINITY;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(pointB.lat - pointA.lat);
  const dLng = toRad(pointB.lng - pointA.lng);
  const lat1 = toRad(pointA.lat);
  const lat2 = toRad(pointB.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.max(0, earthKm * c);
}

function normalizePartnerBranches(rawBranches = []) {
  const rows = Array.isArray(rawBranches) ? rawBranches : [];
  const seen = new Set();
  const out = [];
  rows.forEach((row, index) => {
    const source = row && typeof row === "object" ? row : {};
    const branchId = safeStr(source?.branchId || source?.id || `branch_${index + 1}`);
    const key = lower(branchId);
    if (!key || seen.has(key)) return;
    seen.add(key);

    const primaryCountyLower = normalizeCountyLower(source?.primaryCounty || source?.county);
    const neighboringCountiesLower = normalizeStringList(
      source?.neighboringCountiesLower || source?.neighboringCounties || source?.neighboring,
      { lowercase: true, max: 120 }
    ).filter((countyLower) => countyLower !== primaryCountyLower);
    const coverageCountiesLower = mergeUniqueLowerLists(
      primaryCountyLower ? [primaryCountyLower] : [],
      neighboringCountiesLower,
      source?.coverageCountiesLower,
      source?.coverageCounties
    );
    const coordinates =
      normalizeLatLng(source?.latitude, source?.longitude) ||
      normalizeLatLng(source?.lat, source?.lng) ||
      normalizeLatLng(source?.lat, source?.lon) ||
      normalizeLatLng(source?.geo?.latitude, source?.geo?.longitude) ||
      normalizeLatLng(source?.geo?.lat, source?.geo?.lng) ||
      normalizeLatLng(source?.location?.latitude, source?.location?.longitude) ||
      normalizeLatLng(source?.location?.lat, source?.location?.lng) ||
      null;

    out.push({
      branchId,
      branchName: safeStr(source?.branchName || source?.name),
      active: source?.active !== false && source?.isActive !== false,
      countryLower: normalizeCountryLower(source?.country),
      primaryCountyLower,
      neighboringCountiesLower,
      coverageCountiesLower,
      coordinates,
    });
  });
  return out.slice(0, 80);
}

function normalizeManagerModuleKey(value) {
  const raw = lower(value);
  if (!raw) return "";
  const resolved = MANAGER_MODULE_ALIAS_MAP.get(raw) || raw;
  return MANAGER_MODULE_KEYS.has(resolved) ? resolved : "";
}

function normalizeManagerModules(values = [], { max = 12 } = {}) {
  const rows = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const out = [];

  rows.forEach((value) => {
    const key = normalizeManagerModuleKey(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });

  return out.slice(0, clamp(toNum(max, 12), 1, 20));
}

function normalizeManagerStatus(value) {
  const safe = lower(value);
  return MANAGER_STATUS_VALUES.has(safe) ? safe : "active";
}

function normalizeManagerScope(rawScope) {
  const scope = rawScope && typeof rawScope === "object" ? rawScope : {};
  return {
    name: safeStr(scope?.name || scope?.fullName || scope?.managerName, 140),
    stationedCountry: safeStr(scope?.stationedCountry || scope?.country, 120),
    stationedCountryLower: lower(scope?.stationedCountryLower || scope?.stationedCountry || scope?.country, 120),
    cityTown: safeStr(scope?.cityTown || scope?.city || scope?.town, 120),
    managerRole: safeStr(scope?.managerRole || scope?.roleLabel, 120),
    assignedModules: normalizeManagerModules(scope?.assignedModules),
    notes: safeStr(scope?.notes, 2000),
    status: normalizeManagerStatus(scope?.status),
    inviteToken: safeStr(scope?.inviteToken, 220),
    inviteId: safeStr(scope?.inviteId, 220),
    inviteCreatedAtMs: toNum(scope?.inviteCreatedAtMs, 0),
    inviteExpiresAtMs: toNum(scope?.inviteExpiresAtMs, 0),
    lastLoginAtMs: toNum(scope?.lastLoginAtMs || scope?.lastSeenAtMs, 0),
    updatedAtMs: toNum(scope?.updatedAtMs, 0),
  };
}

function defaultManagerScopePayload() {
  return {
    name: "",
    stationedCountry: "",
    stationedCountryLower: "",
    cityTown: "",
    managerRole: "",
    assignedModules: [],
    notes: "",
    status: "inactive",
    inviteToken: "",
    inviteId: "",
    inviteCreatedAtMs: 0,
    inviteExpiresAtMs: 0,
    lastLoginAtMs: 0,
    updatedAtMs: 0,
  };
}

function hasManagerModuleAccess(managerScope, moduleKey) {
  const normalizedModule = normalizeManagerModuleKey(moduleKey);
  if (!normalizedModule) return false;
  const scope = normalizeManagerScope(managerScope);
  return scope.assignedModules.includes(normalizedModule);
}

function mergeUniqueLowerLists(...lists) {
  return normalizeStringList(lists.flat(), { lowercase: true, max: 120 });
}

function normalizePartnerDoc(partnerId, partnerData = {}, coverageData = {}) {
  const displayName = safeStr(partnerData?.displayName);
  if (!displayName) return null;

  const status = lower(
    partnerData?.status || (partnerData?.isActive === false ? "inactive" : "active")
  ) === "inactive"
    ? "inactive"
    : "active";
  const supportedTracks = normalizeStringList(
    coverageData?.supportedTracks || partnerData?.supportedTracks,
    { lowercase: true, max: 40 }
  );
  const supportedCountriesLower = normalizeStringList(
    coverageData?.supportedCountriesLower ||
      coverageData?.supportedCountries ||
      partnerData?.supportedCountries,
    { lowercase: true, max: 120 }
  );
  const supportedCountiesLower = normalizeStringList(
    coverageData?.supportedCountiesLower ||
      coverageData?.supportedCounties ||
      partnerData?.supportedCounties,
    { lowercase: true, max: 120 }
  );
  const branches = normalizePartnerBranches(
    Array.isArray(coverageData?.branches) && coverageData.branches.length
      ? coverageData.branches
      : partnerData?.branches
  );
  const branchPrimaryCountiesLower = mergeUniqueLowerLists(
    ...branches.map((branch) =>
      branch?.active !== false && safeStr(branch?.primaryCountyLower)
        ? [safeStr(branch.primaryCountyLower)]
        : []
    )
  );
  const branchNeighboringCountiesLower = mergeUniqueLowerLists(
    ...branches.map((branch) =>
      branch?.active !== false ? branch?.neighboringCountiesLower || [] : []
    )
  );
  const branchCoverageCountiesLower = mergeUniqueLowerLists(
    ...branches.map((branch) => (branch?.active !== false ? branch?.coverageCountiesLower || [] : []))
  );
  const neighboringCountiesLower = normalizeStringList(
    coverageData?.neighboringCountiesLower ||
      coverageData?.neighboringCounties ||
      partnerData?.neighboringCounties ||
      branchNeighboringCountiesLower,
    { lowercase: true, max: 120 }
  );
  const homeCountriesLower = normalizeStringList(
    coverageData?.homeCountriesLower || coverageData?.homeCountries || partnerData?.homeCountries,
    { lowercase: true, max: 120 }
  );
  const coverageCountiesLower = mergeUniqueLowerLists(
    coverageData?.coverageCountiesLower,
    coverageData?.coverageCounties,
    partnerData?.coverageCounties,
    branchCoverageCountiesLower,
    supportedCountiesLower
  );

  return {
    id: safeStr(partnerId),
    displayName,
    status,
    isActive: status === "active",
    supportedTracks,
    homeCountriesLower,
    supportedCountriesLower,
    supportedCountiesLower,
    branchPrimaryCountiesLower,
    branchNeighboringCountiesLower,
    branchCoverageCountiesLower,
    branches,
    neighboringCountiesLower,
    coverageCountiesLower,
  };
}

async function listPartners({ activeOnly = false, max = 250 } = {}) {
  const maxRows = clamp(toNum(max, 250), 1, 400);
  const partnerQuery = activeOnly
    ? db.collection(PARTNERS_COLLECTION).where("isActive", "==", true).limit(maxRows)
    : db.collection(PARTNERS_COLLECTION).limit(maxRows);

  const [partnerSnap, coverageSnap] = await Promise.all([
    partnerQuery.get(),
    db.collection(PARTNER_COVERAGE_COLLECTION).limit(maxRows).get(),
  ]);

  const coverageMap = new Map();
  coverageSnap.docs.forEach((docSnap) => {
    coverageMap.set(docSnap.id, docSnap.data() || {});
  });

  return partnerSnap.docs
    .map((docSnap) =>
      normalizePartnerDoc(docSnap.id, docSnap.data() || {}, coverageMap.get(docSnap.id))
    )
    .filter(Boolean)
    .sort((a, b) => safeStr(a?.displayName).localeCompare(safeStr(b?.displayName)));
}

async function fetchPartnerById(partnerId) {
  const safePartnerId = safeStr(partnerId);
  if (!safePartnerId) return null;

  const [partnerSnap, coverageSnap] = await Promise.all([
    db.collection(PARTNERS_COLLECTION).doc(safePartnerId).get(),
    db.collection(PARTNER_COVERAGE_COLLECTION).doc(safePartnerId).get(),
  ]);
  if (!partnerSnap.exists) return null;

  return normalizePartnerDoc(
    safePartnerId,
    partnerSnap.data() || {},
    coverageSnap.exists ? coverageSnap.data() || {} : {}
  );
}

function evaluatePartnerRequestCompatibility(
  partner,
  {
    trackType = "",
    country = "",
    county = "",
    countryOfResidence = "",
    filterMode = PARTNER_FILTER_MODES.DESTINATION_COUNTRY,
    eligiblePartnerIds = [],
  } = {}
) {
  const safePartner = partner && typeof partner === "object" ? partner : {};
  const safeTrack = lower(trackType);
  const safeCountry = lower(country);
  const safeResidenceCountry = lower(countryOfResidence);
  const safeCounty = normalizeCountyLower(county);
  const safeFilterMode = normalizePartnerFilterMode(filterMode);
  const eligiblePartnerSet = new Set(
    normalizePartnerIdList(eligiblePartnerIds).map((partnerId) => lower(partnerId))
  );
  const requestTypeAllowed =
    eligiblePartnerSet.size === 0 || eligiblePartnerSet.has(lower(safePartner?.id));
  const trackOk = Boolean(safeTrack) && safePartner.supportedTracks?.includes(safeTrack);
  const homeCountryOk =
    !safeResidenceCountry || safePartner.homeCountriesLower?.includes(safeResidenceCountry);
  const countryOk =
    safeFilterMode === PARTNER_FILTER_MODES.HOME_COUNTRY
      ? true
      : Boolean(safeCountry) && safePartner.supportedCountriesLower?.includes(safeCountry);
  const branchPrimaryLower = Array.isArray(safePartner?.branchPrimaryCountiesLower)
    ? safePartner.branchPrimaryCountiesLower
    : [];
  const branchNeighborLower = Array.isArray(safePartner?.branchNeighboringCountiesLower)
    ? safePartner.branchNeighboringCountiesLower
    : [];
  const partnerCountyCoverage = mergeUniqueLowerLists(
    safePartner?.supportedCountiesLower || [],
    safePartner?.coverageCountiesLower || [],
    safePartner?.branchCoverageCountiesLower || []
  );
  const countyDirect =
    Boolean(safeCounty) &&
    (branchPrimaryLower.includes(safeCounty) ||
      (!branchPrimaryLower.length && partnerCountyCoverage.includes(safeCounty)));
  const countyNeighbor =
    Boolean(safeCounty) &&
    (branchNeighborLower.includes(safeCounty) ||
      (!branchPrimaryLower.length && !countyDirect && partnerCountyCoverage.includes(safeCounty)));
  const countyOk = !safeCounty || countyDirect || countyNeighbor;

  const reasons = [];
  if (safePartner.isActive === false) reasons.push("partner_inactive");
  if (!requestTypeAllowed) reasons.push("request_type_not_allowed");
  if (!trackOk) reasons.push("track_not_supported");
  if (!homeCountryOk) reasons.push("home_country_not_supported");
  if (!countryOk) reasons.push("country_not_supported");
  if (!countyOk) reasons.push("county_not_supported");

  return {
    partnerId: safeStr(safePartner?.id),
    partnerName: safeStr(safePartner?.displayName),
    eligible: reasons.length === 0,
    reasons,
    countyMatchType: countyDirect ? "direct" : countyNeighbor ? "neighboring" : "",
    matches: {
      requestTypeAllowed,
      homeCountry: homeCountryOk,
      country: countryOk,
      county: countyOk,
      countyDirect,
      countyNeighbor,
      hasCounty: Boolean(safeCounty),
    },
  };
}

function preferredAgentReasonLabel(reason) {
  const safeReason = lower(reason);
  if (safeReason === "partner_inactive") return "Selected agent is inactive.";
  if (safeReason === "request_type_not_allowed") {
    return "Selected agent is not eligible for this request type.";
  }
  if (safeReason === "track_not_supported") return "Selected agent does not support this track.";
  if (safeReason === "home_country_not_supported") {
    return "Selected agent does not support your home country.";
  }
  if (safeReason === "country_not_supported") return "Selected agent does not support this country.";
  if (safeReason === "county_not_supported") return "Selected agent does not support this county.";
  if (safeReason === "partner_not_found") return "Selected agent was not found.";
  if (safeReason === "admin_unavailable") return "Assigned admin is unavailable.";
  if (safeReason === "admin_at_capacity") return "Assigned admin is at max capacity.";
  return "Selected agent is not valid for this request.";
}

function normalizeRequestDefinitionEngagementEventType(value) {
  const eventType = lower(value);
  if (eventType === "submit" || eventType === "submitted") return "submission";
  return REQUEST_DEFINITION_ENGAGEMENT_EVENT_TYPES.has(eventType) ? eventType : "open";
}

function requestDefinitionEngagementFieldForEventType(eventType) {
  if (eventType === "tap") return "tapCount";
  if (eventType === "submission") return "submissionCount";
  return "openCount";
}

function requestDefinitionEngagementScoreDelta(eventType) {
  if (eventType === "tap") return 3;
  if (eventType === "submission") return 4;
  return 2;
}

function toDataStrings(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v == null) return;
    out[String(k)] = String(v);
  });
  return out;
}

function tsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  return 0;
}

async function claimEventLock(eventId, prefix) {
  const eid = safeStr(eventId);
  if (!eid) return true;

  const id = `${safeStr(prefix) || "evt"}_${eid}`;
  try {
    await db.collection(EVENT_LOCKS).doc(id).create({
      createdAt: FieldValue.serverTimestamp(),
      eventId: eid,
      prefix: safeStr(prefix),
    });
    return true;
  } catch (e) {
    const code = e?.code;
    const already = code === 6 || code === "already-exists" || /already exists/i.test(String(e?.message || ""));
    if (already) {
      logger.info("Duplicate event skipped", { id });
      return false;
    }
    throw e;
  }
}

async function getRequestDoc(requestId) {
  const rid = safeStr(requestId);
  if (!rid) return null;
  const snap = await db.collection("serviceRequests").doc(rid).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

function requestLabel(req) {
  const track = safeStr(req?.track).toUpperCase();
  const country = safeStr(req?.country);
  const serviceName = safeStr(req?.serviceName);
  const parts = [];
  if (track) parts.push(track);
  if (country) parts.push(country);
  if (serviceName) parts.push(serviceName);
  return parts.join(" • ");
}

function chatPreview(msg) {
  const messageKind = chatMessageKind(msg);
  const text = safeStr(msg?.text);
  if ((messageKind === "message" || messageKind === "bundle") && text) return text.slice(0, 120);
  if (messageKind === "photo") return "Sent a photo";
  return "Sent a document";
}

function chatMessageKind(msg = {}) {
  const explicit = lower(msg?.messageKind || msg?.kind);
  if (explicit === "message" || explicit === "document" || explicit === "photo") return explicit;

  const type = lower(msg?.type || "text");
  const text = safeStr(msg?.text);
  if (type === "text") return "message";
  if (type === "image" || type === "photo") return "photo";
  if (type === "document" || type === "pdf") return "document";

  const attachmentMeta =
    msg?.attachmentMeta && typeof msg.attachmentMeta === "object"
      ? msg.attachmentMeta
      : msg?.pdfMeta && typeof msg.pdfMeta === "object"
      ? msg.pdfMeta
      : null;
  const attachmentKind = lower(attachmentMeta?.attachmentKind || attachmentMeta?.kind);
  if (attachmentKind === "photo" || attachmentKind === "image") return "photo";
  if (attachmentMeta) return "document";

  if (type === "bundle") {
    if (text) return "bundle";
    return "document";
  }

  return "message";
}

function chatNotificationTitleByKind(kind) {
  if (kind === "photo") return "New photo";
  if (kind === "document") return "New document";
  return "New message";
}

function chatNotificationTypeByKind(kind, role = "user", fromRole = "") {
  const safeRole = lower(role);
  const sender = lower(fromRole);
  if (safeRole === "staff") {
    if (kind === "photo") return "STAFF_NEW_PHOTO";
    if (kind === "document") return "STAFF_NEW_DOCUMENT";
    return "STAFF_NEW_MESSAGE";
  }

  if (safeRole === "admin") {
    if (sender === "user") {
      if (kind === "photo") return "ADMIN_NEW_PHOTO_FROM_USER";
      if (kind === "document") return "ADMIN_NEW_DOCUMENT_FROM_USER";
      return "ADMIN_NEW_MESSAGE_FROM_USER";
    }
    if (sender === "staff") {
      if (kind === "photo") return "ADMIN_NEW_PHOTO_FROM_STAFF";
      if (kind === "document") return "ADMIN_NEW_DOCUMENT_FROM_STAFF";
      return "ADMIN_NEW_MESSAGE_FROM_STAFF";
    }
    if (kind === "photo") return "ADMIN_NEW_PHOTO";
    if (kind === "document") return "ADMIN_NEW_DOCUMENT";
    return "ADMIN_NEW_MESSAGE";
  }

  if (kind === "photo") return "NEW_PHOTO";
  if (kind === "document") return "NEW_DOCUMENT";
  return "NEW_MESSAGE";
}

function idPart(value, max = 80) {
  const clean = safeStr(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, max);
  return clean || "x";
}

function buildMirrorId(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => idPart(part))
    .filter(Boolean)
    .join("__")
    .slice(0, 220);
}

function normalizeDocumentActorRole(role = "") {
  const safeRole = lower(role);
  if (safeRole === "admin" || safeRole === "staff" || safeRole === "user") return safeRole;
  return "user";
}

function normalizeChatAttachmentForMirror(message = {}) {
  const source =
    message?.attachmentMeta && typeof message.attachmentMeta === "object"
      ? message.attachmentMeta
      : message?.pdfMeta && typeof message.pdfMeta === "object"
      ? message.pdfMeta
      : null;
  if (!source) return null;

  const name = safeStr(source?.name || source?.fileName || source?.filename).slice(0, 180);
  if (!name) return null;

  const contentType =
    safeStr(source?.mime || source?.type || source?.contentType || "application/octet-stream").slice(0, 80) ||
    "application/octet-stream";
  const rawKind = lower(source?.attachmentKind || source?.kind);
  const type = lower(message?.type);
  const isPhoto =
    rawKind === "photo" ||
    rawKind === "image" ||
    type === "photo" ||
    type === "image" ||
    contentType.startsWith("image/");

  return {
    name,
    contentType,
    note: safeStr(source?.note).slice(0, 1200),
    sizeBytes: Math.max(0, Math.floor(toNum(source?.size || source?.sizeBytes, 0))),
    attachmentKind: isPhoto ? "photo" : "document",
  };
}

function resolveChatUserBucketForMirror({ requestUid, fromUid, toRole, toUid } = {}) {
  const owner = safeStr(requestUid);
  const sender = safeStr(fromUid);
  const receiver = safeStr(toUid);

  const userIsSender = owner && sender && owner === sender;
  const userIsReceiver = (owner && receiver && owner === receiver) || lower(toRole) === "user";

  if (userIsSender) return USER_BUCKET_UPLOADED;
  if (userIsReceiver) return USER_BUCKET_RECEIVED;
  return USER_BUCKET_RECEIVED;
}

function resolveChatRequestBucketForMirror({ fromRole, toRole } = {}) {
  const from = lower(fromRole);
  const to = lower(toRole);
  if (from === "user") return REQUEST_BUCKET_RECEIVED_FROM_USER;
  if (to === "user") return REQUEST_BUCKET_SENT_TO_USER;
  return REQUEST_BUCKET_INTERNAL;
}

function isUserVisibleChatDocumentForMirror({ requestUid, fromUid, toUid, toRole } = {}) {
  const owner = safeStr(requestUid);
  if (!owner) return false;
  if (safeStr(fromUid) === owner) return true;
  if (safeStr(toUid) === owner) return true;
  return lower(toRole) === "user";
}

async function mirrorPublishedChatAttachment({
  requestId = "",
  messageId = "",
  requestData = {},
  messageData = {},
} = {}) {
  const rid = safeStr(requestId);
  const mid = safeStr(messageId);
  const requestUid = safeStr(requestData?.uid);
  const attachment = normalizeChatAttachmentForMirror(messageData);
  if (!rid || !mid || !requestUid || !attachment) {
    return { ok: false, skipped: true, reason: "not_eligible" };
  }

  const fromRole = lower(messageData?.fromRole);
  const fromUid = safeStr(messageData?.fromUid);
  const toRole = lower(messageData?.toRole);
  const toUid = safeStr(messageData?.toUid);
  const canonicalKind = attachment.attachmentKind === "photo" ? "chat_photo" : "chat_document";

  const userBucket = resolveChatUserBucketForMirror({
    requestUid,
    fromUid,
    toRole,
    toUid,
  });
  const requestBucket = resolveChatRequestBucketForMirror({ fromRole, toRole });
  const userVisible = isUserVisibleChatDocumentForMirror({
    requestUid,
    fromUid,
    toUid,
    toRole,
  });

  const docId = buildMirrorId(["request", rid, canonicalKind, mid]);
  const linkId = buildMirrorId(["request", rid, canonicalKind, mid, "link"]);
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(docId);
  const linkRef = db.collection(DOCUMENT_LINKS_COLLECTION).doc(linkId);
  const [existingDoc, existingLink] = await Promise.all([docRef.get(), linkRef.get()]);
  if (existingDoc.exists && existingLink.exists) {
    return { ok: true, skipped: true, docId, linkId };
  }

  const now = Date.now();
  const batch = db.batch();

  batch.set(
    docRef,
    {
      userUid: requestUid,
      requestId: rid,
      scope: "request",
      stage: "working",
      state: "meta_only",
      sourceChannel: "chat_message",
      createdByUid: safeStr(messageData?.approvedBy || fromUid || requestUid),
      createdByRole: normalizeDocumentActorRole(fromRole),
      visibility: {
        user: userVisible,
        staff: true,
        admin: true,
      },
      display: {
        name: attachment.name,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        note: attachment.note,
      },
      storage: {
        kind: "meta",
        externalUrl: "",
      },
      classification: {
        kind: canonicalKind,
      },
      legacyCollection: "serviceRequests.messages",
      legacyId: mid,
      legacyRequestPath: `serviceRequests/${rid}/messages/${mid}`,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    },
    { merge: true }
  );

  batch.set(
    linkRef,
    {
      userUid: requestUid,
      requestId: rid,
      contextType: "request_chat",
      contextId: mid,
      userBucket,
      requestBucket,
      visibleToUser: userVisible,
      visibleToStaff: true,
      visibleToAdmin: true,
      preview: {
        name: attachment.name,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        state: "meta_only",
        stage: "working",
        storageKind: "meta",
        externalUrl: "",
        sourceChannel: "chat_message",
      },
      sourceChannel: "chat_message",
      kind: canonicalKind,
      note: attachment.note,
      documentId: docId,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    },
    { merge: true }
  );

  await batch.commit();
  return { ok: true, skipped: false, docId, linkId };
}

function buildStatusNotificationText(req, status) {
  const s = lower(status);
  const label = requestLabel(req);
  const suffix = label ? ` (${label})` : "";

  if (s === "rejected") {
    return {
      title: "Request update",
      body: `Your request needs attention${suffix}.`,
    };
  }
  if (s === "closed" || s === "accepted") {
    return {
      title: "Update on your request",
      body: `Your request was completed${suffix}.`,
    };
  }
  if (s === "contacted" || s === "in_progress") {
    return {
      title: "Update on your request",
      body: `We have an update for your request${suffix}.`,
    };
  }

  return {
    title: "Request update",
    body: `Your request status is now: ${s || "updated"}${suffix}.`,
  };
}

function resolveUserRequestNotificationType(status) {
  const safeStatus = lower(status);
  if (safeStatus === "rejected") return "REQUEST_DENIED";
  if (safeStatus === "closed" || safeStatus === "accepted") return "REQUEST_ACCEPTED";
  if (safeStatus === "contacted" || safeStatus === "in_progress") return "REQUEST_IN_PROGRESS";
  return "REQUEST_UPDATED";
}

function resolvePushSubscriptionEndAtMs(row = {}) {
  const endAtMs = toNum(row?.endAtMs, 0);
  if (endAtMs > 0) return endAtMs;
  const endDate = safeStr(row?.endDate);
  if (!endDate) return 0;
  const parsed = Date.parse(`${endDate}T23:59:59.999Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function notifySuperAdminsPushSubscriptionExpiringSoon({
  partnerId = "",
  partnerName = "",
  endAtMs = 0,
  endDate = "",
} = {}) {
  const safePartnerId = safeStr(partnerId);
  const safeEndAtMs = toNum(endAtMs, 0);
  if (!safePartnerId || safeEndAtMs <= 0) return 0;

  const safeEndDate = safeStr(endDate) || new Date(safeEndAtMs).toISOString().slice(0, 10);
  const safePartnerName = safeStr(partnerName || safePartnerId);
  const title = "Push subscription expiring in 5 days";
  const body = `${safePartnerName} push subscription expires on ${safeEndDate}.`;
  const route = "/app/admin/sacc/push-campaigns";

  const superRows = await listSuperAdminCandidates();
  if (!superRows.length) return 0;

  const results = await Promise.all(
    superRows.slice(0, 40).map(async (row) => {
      const uid = safeStr(row?.uid);
      if (!uid) return 0;
      const notificationId = `push_sub_expiry_${safePartnerId}_${safeEndDate}_${uid}`;
      const existing = await db
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .doc(notificationId)
        .get();
      if (existing.exists) return 0;

      await Promise.all([
        sendPushToRecipient({
          uid,
          role: "admin",
          title,
          body,
          data: {
            type: "SUPER_ADMIN_PUSH_SUBSCRIPTION_EXPIRING_5_DAYS",
            partnerId: safePartnerId,
            partnerName: safePartnerName,
            endDate: safeEndDate,
            endAtMs: String(safeEndAtMs),
            route,
            targetRole: "admin",
          },
        }),
        writeScopedNotificationDoc({
          uid,
          scope: "users",
          notificationId,
          payload: {
            type: "SUPER_ADMIN_PUSH_SUBSCRIPTION_EXPIRING_5_DAYS",
            title,
            body,
            route,
            partnerId: safePartnerId,
            partnerName: safePartnerName,
            subscriptionEndDate: safeEndDate,
            subscriptionEndAtMs: safeEndAtMs,
          },
        }),
      ]);
      return 1;
    })
  );

  return results.reduce((sum, count) => sum + toNum(count, 0), 0);
}

async function listActiveTokenDocs(pathParts) {
  const snap = await db.collection(...pathParts).get();
  return snap.docs
    .map((d) => ({ ref: d.ref, id: d.id, ...d.data() }))
    .filter((x) => safeStr(x.token) && x.disabled !== true);
}

async function getRecipientTokenDocs({ uid, role }) {
  const id = safeStr(uid);
  if (!id) return [];

  const rows = [];
  const seen = new Set();

  const collect = async (parts) => {
    try {
      const docs = await listActiveTokenDocs(parts);
      docs.forEach((row) => {
        const tok = safeStr(row.token);
        if (!tok || seen.has(tok)) return;
        seen.add(tok);
        rows.push(row);
      });
    } catch (e) {
      logger.warn("Token lookup failed", { path: parts.join("/"), error: e?.message || String(e) });
    }
  };

  if (lower(role) === "staff") {
    await collect(["staff", id, "pushTokens"]);
    await collect(["users", id, "pushTokens"]); // fallback for staff devices stored under users path
  } else {
    await collect(["users", id, "pushTokens"]);
  }

  return rows;
}

async function disableInvalidTokenDocs(tokenDocs, responses) {
  const batch = db.batch();
  let writes = 0;

  tokenDocs.forEach((tokenDoc, idx) => {
    const res = responses?.[idx];
    if (res?.success) return;

    const code = safeStr(res?.error?.code);
    if (!INVALID_TOKEN_CODES.has(code)) return;

    batch.set(
      tokenDoc.ref,
      {
        disabled: true,
        disabledReason: code,
        disabledAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    writes += 1;
  });

  if (writes > 0) {
    await batch.commit();
  }
}

async function sendPushToRecipient({ uid, role, title, body, data }) {
  const recipientUid = safeStr(uid);
  if (!recipientUid) return { ok: false, sent: 0, reason: "missing_uid" };

  const tokenDocs = await getRecipientTokenDocs({ uid: recipientUid, role });
  const tokens = tokenDocs.map((x) => safeStr(x.token)).filter(Boolean);
  if (!tokens.length) {
    return { ok: false, sent: 0, reason: "no_tokens" };
  }

  const payload = {
    notification: {
      title: safeStr(title || "Notification"),
      body: safeStr(body || ""),
    },
    data: toDataStrings(data),
    android: {
      priority: "high",
      notification: {
        channelId: "majuu_default",
      },
    },
    tokens,
  };

  const resp = await admin.messaging().sendEachForMulticast(payload);
  await disableInvalidTokenDocs(tokenDocs, resp.responses);

  logger.info("Push send result", {
    uid: recipientUid,
    role: lower(role),
    successCount: resp.successCount,
    failureCount: resp.failureCount,
    type: payload.data?.type || "",
  });

  return { ok: true, sent: resp.successCount, failed: resp.failureCount };
}

async function writeUserNotificationDoc(uid, notificationId, payload) {
  const userUid = safeStr(uid);
  const nid = safeStr(notificationId);
  if (!userUid || !nid) return;

  const docRef = db.collection(USERS_NOTIFS).doc(userUid).collection("notifications").doc(nid);
  await docRef.set(
    {
      type: safeStr(payload.type),
      title: safeStr(payload.title),
      body: safeStr(payload.body),
      requestId: safeStr(payload.requestId),
      createdAt: FieldValue.serverTimestamp(),
      readAt: null,
      ...(payload.status ? { status: safeStr(payload.status) } : {}),
      ...(payload.pendingId ? { pendingId: safeStr(payload.pendingId) } : {}),
      ...(payload.messageId ? { messageId: safeStr(payload.messageId) } : {}),
      ...(payload.actorRole ? { actorRole: safeStr(payload.actorRole) } : {}),
      ...(payload.actorUid ? { actorUid: safeStr(payload.actorUid) } : {}),
    },
    { merge: true }
  );
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanos = Number(value?.nanoseconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1e6) : 0);
}

function pickPrimaryUserDoc(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((left, right) => {
      const leftUpdated = toTimestampMs(left?.updatedAt);
      const rightUpdated = toTimestampMs(right?.updatedAt);
      if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
      const leftCreated = toTimestampMs(left?.createdAt);
      const rightCreated = toTimestampMs(right?.createdAt);
      if (rightCreated !== leftCreated) return rightCreated - leftCreated;
      return safeStr(left?.id).localeCompare(safeStr(right?.id));
    })[0] || null;
}

async function findUserDocsByEmail(email) {
  const safeEmail = safeStr(email).toLowerCase();
  if (!safeEmail || !safeEmail.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "Valid email is required");
  }

  const snap = await db
    .collection("users")
    .where("email", "==", safeEmail)
    .limit(20)
    .get();

  const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  const primary = pickPrimaryUserDoc(rows);
  return {
    email: safeEmail,
    rows,
    primaryUid: safeStr(primary?.id),
  };
}

function generateManagerInviteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

async function writeManagerAuditLog({
  managerUid = "",
  managerEmail = "",
  action = "",
  moduleKey = "",
  details = "",
  metadata = {},
  actorUid = "",
  actorEmail = "",
  actorRole = "",
} = {}) {
  const safeAction = lower(action);
  if (!safeAction) return "";

  const now = Date.now();
  const id = `mgr_audit_${now}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection(MANAGER_AUDIT_COLLECTION).doc(id).set(
    {
      id,
      managerUid: safeStr(managerUid),
      managerEmail: safeStr(managerEmail).toLowerCase(),
      action: safeAction,
      moduleKey: normalizeManagerModuleKey(moduleKey),
      details: safeStr(details, 3000),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      actorUid: safeStr(actorUid),
      actorEmail: safeStr(actorEmail).toLowerCase(),
      actorRole: safeStr(actorRole, 80),
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: now,
    },
    { merge: true }
  );
  return id;
}

async function getUserDocByUid(uid) {
  const safeUid = safeStr(uid);
  if (!safeUid) return null;
  const snap = await db.collection("users").doc(safeUid).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function resolveAuthUidByEmail(email, fallbackUid = "") {
  const safeEmail = safeStr(email).toLowerCase();
  if (!safeEmail) return safeStr(fallbackUid);
  try {
    const user = await admin.auth().getUserByEmail(safeEmail);
    return safeStr(user?.uid) || safeStr(fallbackUid);
  } catch {
    return safeStr(fallbackUid);
  }
}

async function getCallerRoleFromContext(context) {
  const callerUid = safeStr(context?.auth?.uid);
  if (!callerUid) return "";
  const userDoc = await getUserDocByUid(callerUid);
  return normalizeRole(userDoc?.role);
}

async function requireAdminCallerContext(
  context,
  {
    superOnly = false,
    allowManager = false,
    requiredManagerModule = "",
    allowAssignedAdmin = true,
  } = {}
) {
  const callerUid = safeStr(context?.auth?.uid);
  if (!callerUid) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const callerDoc = await getUserDocByUid(callerUid);
  const normalizedRole = normalizeRole(callerDoc?.role);
  const isSuperAdmin = normalizedRole === "superAdmin";
  const isAssignedAdmin = normalizedRole === "assignedAdmin";
  const isManager = normalizedRole === "manager";
  const managerScope = normalizeManagerScope(callerDoc?.managerScope);
  const hasRequiredManagerModule =
    !safeStr(requiredManagerModule) ||
    hasManagerModuleAccess(managerScope, requiredManagerModule);
  const hasAdminAccess =
    isSuperAdmin ||
    (allowAssignedAdmin && isAssignedAdmin) ||
    (allowManager && isManager && hasRequiredManagerModule);

  if (superOnly && !isSuperAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Super admin only");
  }

  if (!superOnly && !hasAdminAccess) {
    throw new functions.https.HttpsError("permission-denied", "Admin access required");
  }

  return {
    callerUid,
    callerDoc: callerDoc || {},
    callerRole: isSuperAdmin ? "superAdmin" : isAssignedAdmin ? "assignedAdmin" : "manager",
    isSuperAdmin,
    isAssignedAdmin,
    isManager,
    managerScope,
    hasRequiredManagerModule,
  };
}

function normalizeAdminScope(rawScope) {
  const scope = rawScope && typeof rawScope === "object" ? rawScope : {};
  const primaryCountyLower = normalizeCountyLower(scope?.primaryCounty);
  const neighboringCountiesLower = normalizeStringList(
    scope?.neighboringCountiesLower || scope?.neighboringCounties,
    { lowercase: true, max: 120 }
  );
  const countiesLower = Array.isArray(scope?.countiesLower)
    ? scope.countiesLower.map((x) => lower(x)).filter(Boolean)
    : [];
  const countiesFallback = Array.isArray(scope?.counties)
    ? scope.counties.map((x) => lower(x)).filter(Boolean)
    : [];
  const mergedCountiesLower = mergeUniqueLowerLists(
    primaryCountyLower ? [primaryCountyLower] : [],
    neighboringCountiesLower,
    countiesLower,
    countiesFallback
  );
  const assignedBranchIds = normalizePartnerIdList(
    scope?.assignedBranchIds ||
      scope?.assignedBranches?.map((row) => safeStr(row?.branchId || row?.id))
  );
  const scopedCoordinates = resolveScopeCoordinates(scope);
  return {
    active: scope?.active !== false,
    availability: normalizeAvailability(scope?.availability),
    maxActiveRequests: clamp(
      toNum(scope?.maxActiveRequests, DEFAULT_MAX_ACTIVE_REQUESTS),
      1,
      120
    ),
    responseTimeoutMinutes: clamp(
      toNum(scope?.responseTimeoutMinutes, DEFAULT_ADMIN_RESPONSE_TIMEOUT_MINUTES),
      5,
      240
    ),
    partnerId: safeStr(scope?.partnerId),
    partnerName: safeStr(scope?.partnerName),
    partnerStatus: lower(scope?.partnerStatus || "active"),
    primaryCountyLower,
    neighboringCountiesLower,
    countiesLower: mergedCountiesLower,
    assignedBranchIds,
    assignedBranchId: safeStr(assignedBranchIds[0]),
    coverageSource: safeStr(scope?.coverageSource || scope?.derivedCoverage?.source || "legacy_manual"),
    town: safeStr(scope?.town),
    coordinates: scopedCoordinates,
  };
}

function normalizeSimpleStringList(values = []) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const clean = safeStr(value);
    const key = lower(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function getScopeCountryCoverage(scope) {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  return normalizeSimpleStringList([
    ...(Array.isArray(safeScope?.countries) ? safeScope.countries : []),
    ...(Array.isArray(safeScope?.derivedCoverage?.countries)
      ? safeScope.derivedCoverage.countries
      : []),
    safeScope?.stationedCountry,
    safeScope?.country,
  ]);
}

function getScopeCountryCoverageLower(scope) {
  return getScopeCountryCoverage(scope).map((value) => normalizeCountryLower(value));
}

function getStationedCountryLower(scope) {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  return normalizeCountryLower(
    safeScope?.stationedCountryLower ||
      safeScope?.stationedCountry ||
      safeScope?.countryLower ||
      safeScope?.country
  );
}

async function writeScopedNotificationDoc({
  uid = "",
  scope = "user",
  notificationId = "",
  payload = {},
} = {}) {
  const targetUid = safeStr(uid);
  const docId = safeStr(notificationId);
  if (!targetUid || !docId) return;
  const safeScope = lower(scope) === "staff" ? "staff" : "users";
  const source = payload && typeof payload === "object" ? payload : {};
  await db
    .collection(safeScope)
    .doc(targetUid)
    .collection("notifications")
    .doc(docId)
    .set(
      {
        ...source,
        requestId: safeStr(source?.requestId) || null,
        paymentId: safeStr(source?.paymentId) || null,
        refundId: safeStr(source?.refundId) || null,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: toNum(source?.createdAtMs, Date.now()),
        readAt: null,
      },
      { merge: true }
    );
}

function getRequestCountryValue(requestData = {}) {
  const safeRequest = requestData && typeof requestData === "object" ? requestData : {};
  const routingMeta =
    safeRequest?.routingMeta && typeof safeRequest.routingMeta === "object"
      ? safeRequest.routingMeta
      : {};
  const mode = normalizePartnerFilterMode(
    safeRequest?.partnerFilterMode || routingMeta?.partnerFilterMode
  );
  const candidates = [
    safeRequest?.countryOfResidence,
    routingMeta?.countryOfResidence,
    safeRequest?.residenceCountry,
    routingMeta?.residenceCountry,
    safeRequest?.locationCountry,
    safeRequest?.country,
    routingMeta?.country,
  ];
  if (mode === PARTNER_FILTER_MODES.HOME_COUNTRY) {
    candidates.push(safeRequest?.country, routingMeta?.country);
  }
  return normalizeSimpleStringList(candidates)[0] || "";
}

function getRequestCountryLower(requestData = {}) {
  return normalizeCountryLower(getRequestCountryValue(requestData));
}

function getRequestCountyValue(requestData = {}) {
  const safeRequest = requestData && typeof requestData === "object" ? requestData : {};
  const routingMeta =
    safeRequest?.routingMeta && typeof safeRequest.routingMeta === "object"
      ? safeRequest.routingMeta
      : {};
  const geo = safeRequest?.geo && typeof safeRequest.geo === "object" ? safeRequest.geo : {};
  const geolocation =
    safeRequest?.geolocation && typeof safeRequest.geolocation === "object"
      ? safeRequest.geolocation
      : {};
  const location = safeRequest?.location && typeof safeRequest.location === "object" ? safeRequest.location : {};
  return (
    normalizeSimpleStringList([
      safeRequest?.county,
      routingMeta?.county,
      safeRequest?.countyName,
      safeRequest?.locationCounty,
      location?.county,
      location?.countyName,
      geolocation?.county,
      geolocation?.region,
      geolocation?.state,
      geo?.county,
      geo?.region,
      geo?.state,
    ])[0] || ""
  );
}

function getRequestCountyLower(requestData = {}) {
  return normalizeCountyLower(
    safeStr(requestData?.countyLower) ||
      safeStr(requestData?.routingMeta?.countyLower) ||
      getRequestCountyValue(requestData)
  );
}

function adminScopeRequiresCountyCoverage(scope, requestCountryLower = "") {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  const scopeCountriesLower = getScopeCountryCoverageLower(safeScope);
  const explicitStationedLower = getStationedCountryLower(safeScope);
  const targetCountryLower = normalizeCountryLower(requestCountryLower);
  const hasKenyaCoverage =
    scopeCountriesLower.includes("kenya") ||
    (!scopeCountriesLower.length && explicitStationedLower === "kenya");
  if (targetCountryLower) {
    return targetCountryLower === "kenya" && hasKenyaCoverage;
  }
  return hasKenyaCoverage || (!scopeCountriesLower.length && (safeScope?.countiesLower || []).length > 0);
}

function determineCountyTier(scope, countyLower, requiresCountyCoverage) {
  if (!requiresCountyCoverage) {
    return { countyTier: 3, countyMatchType: "country" };
  }
  const safeCounty = normalizeCountyLower(countyLower);
  if (!safeCounty) {
    return { countyTier: 3, countyMatchType: "distance" };
  }
  if (safeStr(scope?.primaryCountyLower) === safeCounty) {
    return { countyTier: 1, countyMatchType: "direct" };
  }
  if (
    Array.isArray(scope?.neighboringCountiesLower) &&
    scope.neighboringCountiesLower.includes(safeCounty)
  ) {
    return { countyTier: 2, countyMatchType: "neighboring" };
  }
  if (Array.isArray(scope?.countiesLower) && scope.countiesLower.includes(safeCounty)) {
    return { countyTier: 2, countyMatchType: "neighboring" };
  }
  return { countyTier: 3, countyMatchType: "distance" };
}

function isDistanceFallbackCandidate(compatibility) {
  const reasons = Array.isArray(compatibility?.reasons) ? compatibility.reasons : [];
  if (!reasons.length) return Boolean(compatibility?.eligible);
  return reasons.every((reason) => safeStr(reason) === "county_not_supported");
}

function compareAdminCandidatesForRouting(left, right) {
  const leftTier = toNum(left?.countyTier, 3);
  const rightTier = toNum(right?.countyTier, 3);
  if (leftTier !== rightTier) return leftTier - rightTier;

  const leftDistance = toFiniteDistance(left?.distanceKm);
  const rightDistance = toFiniteDistance(right?.distanceKm);
  if (leftDistance !== rightDistance) return leftDistance - rightDistance;

  const scoreGap = Number(right?.score || 0) - Number(left?.score || 0);
  if (scoreGap !== 0) return scoreGap;

  const loadGap = Number(left?.activeLoad || 0) - Number(right?.activeLoad || 0);
  if (loadGap !== 0) return loadGap;

  return safeStr(left?.email || left?.uid).localeCompare(safeStr(right?.email || right?.uid));
}

function enrichAdminCandidate(candidate, loadMap = {}) {
  const uid = safeStr(candidate?.uid);
  const availability = normalizeAvailability(candidate?.availability);
  const availabilityWeight = ADMIN_AVAILABILITY_WEIGHTS[availability] || 0;
  const activeLoad = Math.max(0, toNum(loadMap?.[uid], 0));
  const maxActive = clamp(
    toNum(candidate?.maxActiveRequests, DEFAULT_MAX_ACTIVE_REQUESTS),
    1,
    120
  );
  const capacityRatio = activeLoad / maxActive;
  const hasCapacity = capacityRatio < 1;
  const eligible = Boolean(uid) && availabilityWeight > 0 && hasCapacity;
  const capacityWeight = eligible ? clamp(1 - capacityRatio, 0.08, 1) : 0;
  const fairnessWeight = eligible ? 1 / (1 + activeLoad) : 0;

  return {
    ...candidate,
    availability,
    activeLoad,
    maxActiveRequests: maxActive,
    availableSlots: Math.max(0, maxActive - activeLoad),
    capacityRatio,
    eligible,
    ineligibleReason:
      !uid
        ? "missing_admin_uid"
        : availabilityWeight <= 0
        ? "admin_unavailable"
        : !hasCapacity
        ? "admin_at_capacity"
        : "",
    score: eligible ? availabilityWeight * capacityWeight * fairnessWeight : 0,
  };
}

function buildEligibleAdminOptions(candidates, loadMap = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => enrichAdminCandidate(candidate, loadMap))
    .filter((candidate) => candidate.eligible)
    .sort(compareAdminCandidatesForRouting);
}

function pickAdminCandidate(candidates, loadMap = {}) {
  return buildEligibleAdminOptions(candidates, loadMap)[0] || null;
}

async function listAssignedAdminCandidatesForRequest(
  requestData,
  { partnerId = "", excludeUids = [] } = {}
) {
  const safeCountyLower = getRequestCountyLower(requestData);
  const requestCountryLower = getRequestCountryLower(requestData);
  const requestCoordinates = resolveRequestCoordinates(requestData);
  const safePartnerId = safeStr(partnerId);
  if (!safePartnerId || !requestCountryLower) return [];

  const excluded = new Set((excludeUids || []).map((x) => safeStr(x)).filter(Boolean));
  const snap = await db
    .collection("users")
    .where("role", "in", ASSIGNED_ADMIN_ROLE_VARIANTS)
    .get();
  const rows = [];

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = safeStr(docSnap.id);
    if (!uid || excluded.has(uid)) return;
    const scope = normalizeAdminScope(data?.adminScope);
    if (!scope.active) return;
    if (safeStr(scope?.partnerId) !== safePartnerId) return;
    const stationedCountryLower = getStationedCountryLower(scope);
    const scopeCountriesLower = getScopeCountryCoverageLower(scope);
    const countryOriginMatch = scopeCountriesLower.length
      ? scopeCountriesLower.includes(requestCountryLower)
      : Boolean(stationedCountryLower) && stationedCountryLower === requestCountryLower;
    if (!countryOriginMatch) return;

    const requiresCountyCoverage = adminScopeRequiresCountyCoverage(scope, requestCountryLower);
    const countyTierPayload = determineCountyTier(scope, safeCountyLower, requiresCountyCoverage);
    const distanceKm = haversineDistanceKm(requestCoordinates, scope?.coordinates);

    rows.push({
      uid,
      email: safeStr(data?.email),
      role: "assignedAdmin",
      availability: scope.availability,
      maxActiveRequests: scope.maxActiveRequests,
      responseTimeoutMinutes: scope.responseTimeoutMinutes,
      town: scope.town,
      partnerId: safePartnerId,
      partnerName: safeStr(scope?.partnerName),
      assignedBranchIds: Array.isArray(scope?.assignedBranchIds) ? scope.assignedBranchIds : [],
      assignedBranchId: safeStr(scope?.assignedBranchId || scope?.assignedBranchIds?.[0]),
      coverageSource: safeStr(scope?.coverageSource || "legacy_manual"),
      countries: getScopeCountryCoverage(scope),
      stationedCountry: safeStr(scope?.stationedCountry || scope?.country),
      countryOriginMatch,
      countyTier: countyTierPayload.countyTier,
      countyMatchType: countyTierPayload.countyMatchType,
      distanceKm,
    });
  });

  return rows;
}

async function listSuperAdminCandidates({ excludeUids = [] } = {}) {
  const excluded = new Set((excludeUids || []).map((x) => safeStr(x)).filter(Boolean));
  const rows = [];
  const snap = await db
    .collection("users")
    .where("role", "in", SUPER_ADMIN_ROLE_VARIANTS)
    .limit(50)
    .get();

  snap.docs.forEach((docSnap) => {
    const uid = safeStr(docSnap.id);
    if (!uid || excluded.has(uid)) return;
    const data = docSnap.data() || {};
    const scope = normalizeAdminScope(data?.adminScope);
    rows.push({
      uid,
      email: safeStr(data?.email),
      role: "superAdmin",
      availability: scope.availability,
      maxActiveRequests: scope.maxActiveRequests,
      responseTimeoutMinutes: scope.responseTimeoutMinutes,
      town: scope.town,
    });
  });

  return rows;
}

async function buildActiveLoadMap() {
  const loadMap = {};
  const snap = await db
    .collection("serviceRequests")
    .where("status", "in", Array.from(ACTIVE_REQUEST_STATUSES))
    .limit(4000)
    .get();

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const adminUid = safeStr(data?.currentAdminUid);
    if (!adminUid) return;
    loadMap[adminUid] = (loadMap[adminUid] || 0) + 1;
  });

  return loadMap;
}

function buildReassignmentHistory(currentRequest, nextEntry) {
  const routingMeta =
    currentRequest?.routingMeta && typeof currentRequest.routingMeta === "object"
      ? currentRequest.routingMeta
      : {};
  const currentHistory = Array.isArray(routingMeta?.reassignmentHistory)
    ? routingMeta.reassignmentHistory
    : [];
  const next = [...currentHistory, nextEntry];
  return next.slice(Math.max(0, next.length - 25));
}

async function resolveSuperAdminFallback({ excludeUids = [] } = {}) {
  const rows = await listSuperAdminCandidates({ excludeUids });
  const candidate = rows[0] || null;
  if (!candidate) return null;

  return {
    ...candidate,
    partnerId: "",
    partnerName: "",
    countyMatchType: "",
    unresolvedInbox: true,
  };
}

function comparePartnerRoutingOptions(left, right) {
  const leftAdmin = left?.bestAdmin || {};
  const rightAdmin = right?.bestAdmin || {};
  const tierGap = toNum(leftAdmin?.countyTier, 3) - toNum(rightAdmin?.countyTier, 3);
  if (tierGap !== 0) return tierGap;

  const distanceGap =
    toFiniteDistance(leftAdmin?.distanceKm) - toFiniteDistance(rightAdmin?.distanceKm);
  if (distanceGap !== 0) return distanceGap;

  const scoreGap = Number(rightAdmin?.score || 0) - Number(leftAdmin?.score || 0);
  if (scoreGap !== 0) return scoreGap;

  const loadGap = Number(leftAdmin?.activeLoad || 0) - Number(rightAdmin?.activeLoad || 0);
  if (loadGap !== 0) return loadGap;

  return safeStr(left?.partner?.displayName).localeCompare(safeStr(right?.partner?.displayName));
}

async function buildRoutingSnapshot(
  requestData,
  { excludeAdminUids = [], includeAdminOptions = false } = {}
) {
  const trackType = lower(requestData?.track);
  const country = safeStr(requestData?.country || requestData?.routingMeta?.country);
  const county = getRequestCountyValue(requestData);
  const countryOfResidence = getRequestCountryValue(requestData);
  const filterMode = normalizePartnerFilterMode(
    requestData?.partnerFilterMode || requestData?.routingMeta?.partnerFilterMode
  );
  const preferredAgentId = safeStr(requestData?.preferredAgentId);
  const eligiblePartnerIds = normalizePartnerIdList(
    requestData?.eligiblePartnerIds || requestData?.routingMeta?.eligiblePartnerIds || []
  );
  const partnerRows = await listPartners({ activeOnly: false, max: 250 });
  const evaluations = partnerRows.map((partner) => ({
    partner,
    compatibility: evaluatePartnerRequestCompatibility(partner, {
      trackType,
      country,
      county,
      countryOfResidence,
      filterMode,
      eligiblePartnerIds,
    }),
  }));

  const strictEligiblePartners = evaluations.filter((row) => row.compatibility?.eligible);
  const countyFallbackPartners = evaluations
    .filter((row) => isDistanceFallbackCandidate(row?.compatibility))
    .map((row) => ({
      ...row,
      compatibility: {
        ...(row?.compatibility || {}),
        eligible: true,
        countyMatchType: "distance",
      },
    }));
  const preferredRow = preferredAgentId
    ? evaluations.find((row) => safeStr(row?.partner?.id) === preferredAgentId)
    : null;

  let preferredAgentValid = false;
  let preferredAgentReason = safeStr(requestData?.preferredAgentInvalidReason);
  let partnerDecisionSource = "auto";
  let candidatePartners = strictEligiblePartners;
  let usedCountyFallback = false;

  if (preferredAgentId) {
    if (!preferredRow) {
      preferredAgentReason = preferredAgentReason || "partner_not_found";
      partnerDecisionSource = "preferred_agent_invalid";
      candidatePartners = [];
    } else if (preferredRow.compatibility?.eligible) {
      preferredAgentValid = true;
      candidatePartners = [preferredRow];
      partnerDecisionSource = "preferred_agent";
    } else if (isDistanceFallbackCandidate(preferredRow.compatibility)) {
      preferredAgentValid = true;
      preferredAgentReason = "";
      candidatePartners = [
        {
          ...preferredRow,
          compatibility: {
            ...(preferredRow?.compatibility || {}),
            eligible: true,
            countyMatchType: "distance",
          },
        },
      ];
      partnerDecisionSource = "preferred_agent_distance_fallback";
      usedCountyFallback = true;
    } else {
      preferredAgentReason =
        preferredAgentReason || safeStr(preferredRow.compatibility?.reasons?.[0]);
      partnerDecisionSource = "preferred_agent_invalid";
      candidatePartners = [];
    }
  } else if (!candidatePartners.length && countyFallbackPartners.length) {
    candidatePartners = countyFallbackPartners;
    partnerDecisionSource = "county_distance_fallback";
    usedCountyFallback = true;
  }

  const activeLoadMap = await buildActiveLoadMap();
  const partnerSourceRows = includeAdminOptions
    ? [
        ...strictEligiblePartners,
        ...(usedCountyFallback ? candidatePartners : []),
      ].filter((row, index, arr) => {
        const key = safeStr(row?.partner?.id);
        return arr.findIndex((candidate) => safeStr(candidate?.partner?.id) === key) === index;
      })
    : candidatePartners;
  const partnerOptions = [];
  for (const row of partnerSourceRows) {
    const adminCandidates = await listAssignedAdminCandidatesForRequest(requestData, {
      partnerId: row.partner.id,
      excludeUids: excludeAdminUids,
    });
    const eligibleAdminOptions = buildEligibleAdminOptions(adminCandidates, activeLoadMap);
    const bestAdmin = eligibleAdminOptions[0] || null;

    partnerOptions.push({
      partner: row.partner,
      compatibility: row.compatibility,
      adminOptions: includeAdminOptions ? eligibleAdminOptions : [],
      bestAdmin,
      pairScore: bestAdmin ? Number(bestAdmin.score || 0) : 0,
    });
  }

  const autoCandidatePartnerIds = new Set(candidatePartners.map((row) => safeStr(row?.partner?.id)));
  const viableOptions = partnerOptions
    .filter((row) => autoCandidatePartnerIds.has(safeStr(row?.partner?.id)))
    .filter((row) => row.bestAdmin)
    .sort(comparePartnerRoutingOptions);
  const bestOption = viableOptions[0] || null;

  let unresolvedReason = "";
  if (preferredAgentId && !candidatePartners.length) {
    unresolvedReason = preferredAgentReason || "preferred_agent_invalid";
  } else if (!strictEligiblePartners.length && !candidatePartners.length) {
    unresolvedReason = preferredAgentReason || "no_eligible_partner";
  } else if (!viableOptions.length) {
    unresolvedReason = "no_eligible_assigned_admin";
  }

  return {
    preferredAgentId,
    preferredAgentValid,
    preferredAgentReason,
    preferredAgentReasonLabel: preferredAgentReason
      ? preferredAgentReasonLabel(preferredAgentReason)
      : "",
    partnerDecisionSource:
      bestOption && partnerDecisionSource === "auto"
        ? "auto"
        : bestOption
        ? partnerDecisionSource
        : partnerDecisionSource === "auto"
        ? "unresolved"
        : partnerDecisionSource,
    routingStatus: bestOption ? "assigned" : "unresolved",
    unresolvedReason,
    eligiblePartnerCount: strictEligiblePartners.length,
    eligibleAdminCount: viableOptions.length,
    usedCountyFallback,
    requestDefinitionId: safeStr(requestData?.requestDefinitionId || requestData?.routingMeta?.requestDefinitionId),
    requestDefinitionKey: safeStr(
      requestData?.requestDefinitionKey || requestData?.routingMeta?.requestDefinitionKey
    ),
    eligiblePartnerIds,
    eligiblePartners: partnerOptions.map((row) => ({
      id: safeStr(row?.partner?.id),
      displayName: safeStr(row?.partner?.displayName),
      countyMatchType: safeStr(row?.compatibility?.countyMatchType),
      countyTier: toNum(row?.bestAdmin?.countyTier, 0),
      distanceKm: Number.isFinite(Number(row?.bestAdmin?.distanceKm))
        ? Number(row?.bestAdmin?.distanceKm)
        : null,
      adminCount: Array.isArray(row?.adminOptions) ? row.adminOptions.length : 0,
      admins: Array.isArray(row?.adminOptions) ? row.adminOptions : [],
      isPreferred: safeStr(row?.partner?.id) === preferredAgentId,
    })),
    bestOption,
  };
}

async function resolveExplicitAdminCandidate(targetAdminUid, requestData = {}) {
  const uid = safeStr(targetAdminUid);
  if (!uid) throw new Error("Target admin is required.");

  const data = await getUserDocByUid(uid);
  if (!data) throw new Error("Target admin user does not exist.");

  const email = safeStr(data?.email);
  const normalizedRole = normalizeRole(data?.role);
  const isSuperAdmin = normalizedRole === "superAdmin";
  const isAssigned = normalizedRole === "assignedAdmin";

  if (!(isSuperAdmin || isAssigned)) {
    throw new Error("Target user is not an assigned admin.");
  }

  const scope = normalizeAdminScope(data?.adminScope);
  if (isAssigned && !safeStr(scope?.partnerId)) {
    throw new Error("Target admin is missing a partner binding.");
  }

  const countyLower = getRequestCountyLower(requestData);
  const requestCountryLower = getRequestCountryLower(requestData);
  const stationedCountryLower = getStationedCountryLower(scope);
  const scopeCountriesLower = getScopeCountryCoverageLower(scope);
  const hasCountryCoverage = Boolean(scopeCountriesLower.length || stationedCountryLower);
  const countryOriginMatch = scopeCountriesLower.length
    ? scopeCountriesLower.includes(requestCountryLower)
    : Boolean(stationedCountryLower) && stationedCountryLower === requestCountryLower;
  const requiresCountyCoverage = adminScopeRequiresCountyCoverage(scope, requestCountryLower);
  const countyTierPayload = determineCountyTier(scope, countyLower, requiresCountyCoverage);
  const requestCoordinates = resolveRequestCoordinates(requestData);
  const distanceKm = haversineDistanceKm(requestCoordinates, scope?.coordinates);

  const candidateBase = {
    uid,
    email,
    role: isSuperAdmin ? "superAdmin" : "assignedAdmin",
    availability: scope.availability,
    maxActiveRequests: scope.maxActiveRequests,
    responseTimeoutMinutes: scope.responseTimeoutMinutes,
    town: scope.town,
    partnerId: safeStr(scope?.partnerId),
    partnerName: safeStr(scope?.partnerName),
    assignedBranchIds: Array.isArray(scope?.assignedBranchIds) ? scope.assignedBranchIds : [],
    assignedBranchId: safeStr(scope?.assignedBranchId || scope?.assignedBranchIds?.[0]),
    coverageSource: safeStr(scope?.coverageSource || "legacy_manual"),
    countries: getScopeCountryCoverage(scope),
    stationedCountry: safeStr(scope?.stationedCountry || scope?.country),
    countryOriginMatch,
    countyTier: countyTierPayload.countyTier,
    countyMatchType: countyTierPayload.countyMatchType,
    distanceKm,
  };

  if (!isAssigned) {
    return candidateBase;
  }

  if (!hasCountryCoverage) {
    throw new Error("Target admin is missing country coverage.");
  }
  if (!countryOriginMatch) {
    throw new Error("Target admin does not cover the request origin country.");
  }

  const partner = await fetchPartnerById(scope.partnerId);
  if (!partner) {
    throw new Error("Target admin's partner no longer exists.");
  }

  const compatibility = evaluatePartnerRequestCompatibility(partner, {
    trackType: requestData?.track,
    country: requestData?.country || requestData?.routingMeta?.country,
    county: getRequestCountyValue(requestData),
    countryOfResidence: getRequestCountryValue(requestData),
    filterMode: requestData?.partnerFilterMode || requestData?.routingMeta?.partnerFilterMode,
    eligiblePartnerIds:
      requestData?.eligiblePartnerIds || requestData?.routingMeta?.eligiblePartnerIds || [],
  });
  if (!compatibility?.eligible && !isDistanceFallbackCandidate(compatibility)) {
    throw new Error(
      preferredAgentReasonLabel(safeStr(compatibility?.reasons?.[0])) ||
        "Target admin's partner is incompatible with this request."
    );
  }

  const activeLoadMap = await buildActiveLoadMap();
  const eligibility = enrichAdminCandidate(
    {
      ...candidateBase,
      partnerId: safeStr(partner?.id || scope?.partnerId),
      partnerName: safeStr(partner?.displayName || scope?.partnerName),
    },
    activeLoadMap
  );
  if (!eligibility.eligible) {
    if (eligibility.ineligibleReason === "admin_unavailable") {
      throw new Error("Target admin is unavailable.");
    }
    if (eligibility.ineligibleReason === "admin_at_capacity") {
      throw new Error("Target admin has reached max capacity.");
    }
    throw new Error("Target admin is not eligible for routing.");
  }

  return eligibility;
}

async function resolveRoutingCandidate({ requestData, excludeAdminUids = [] } = {}) {
  const routingSnapshot = await buildRoutingSnapshot(requestData, { excludeAdminUids });
  if (routingSnapshot?.bestOption?.bestAdmin) {
    return {
      candidate: {
        ...routingSnapshot.bestOption.bestAdmin,
        partnerId: safeStr(routingSnapshot.bestOption?.partner?.id),
        partnerName: safeStr(routingSnapshot.bestOption?.partner?.displayName),
        countyMatchType:
          safeStr(routingSnapshot.bestOption?.bestAdmin?.countyMatchType) ||
          safeStr(routingSnapshot.bestOption?.compatibility?.countyMatchType),
        countyTier: toNum(routingSnapshot.bestOption?.bestAdmin?.countyTier, 0),
      },
      routingSnapshot,
      escalationReason: "",
    };
  }

  const fallback = await resolveSuperAdminFallback({ excludeUids: excludeAdminUids });
  return {
    candidate: fallback,
    routingSnapshot,
    escalationReason: safeStr(routingSnapshot?.unresolvedReason || "manual_intervention_required"),
  };
}

async function notifyAdminRoutedRequest({ requestId, adminUid, reason }) {
  const safeRid = safeStr(requestId);
  const safeAdminUid = safeStr(adminUid);
  if (!safeRid || !safeAdminUid) return;
  const route = `/app/admin/request/${encodeURIComponent(safeRid)}`;

  const body =
    reason === "timeout_reassignment"
      ? "A request was reassigned to your queue after timeout."
      : "A new request was routed to your queue.";

  await Promise.allSettled([
    sendPushToRecipient({
      uid: safeAdminUid,
      role: "user",
      title: "New routed request",
      body,
      data: {
        type: "NEW_REQUEST",
        requestId: safeRid,
        route,
      },
    }),
    writeUserNotificationDoc(safeAdminUid, `admin_route_${safeRid}_${Date.now()}`, {
      type: "NEW_REQUEST",
      title: "New routed request",
      body,
      requestId: safeRid,
      status: "new",
      route,
    }),
  ]);

  const superRows = await listSuperAdminCandidates({ excludeUids: [safeAdminUid] });
  await Promise.allSettled(
    superRows.slice(0, 40).map(async (row) => {
      const uid = safeStr(row?.uid);
      if (!uid) return;

      await sendPushToRecipient({
        uid,
        role: "admin",
        title: "New routed request",
        body,
        data: {
          type: "SUPER_ADMIN_NEW_REQUEST",
          requestId: safeRid,
          route,
        },
      });

      await writeScopedNotificationDoc({
        uid,
        scope: "users",
        notificationId: `super_admin_route_${safeRid}_${uid}`,
        payload: {
          type: "SUPER_ADMIN_NEW_REQUEST",
          title: "New routed request",
          body,
          requestId: safeRid,
          status: "new",
          route,
        },
      });
    })
  );
}

async function routeRequestToAdmin({
  requestId,
  requestData,
  candidate,
  reason,
  escalationReason = "",
  previousAdminUid = "",
  routingSnapshot = null,
}) {
  const safeRid = safeStr(requestId);
  const targetUid = safeStr(candidate?.uid);
  if (!safeRid || !targetUid) return { ok: false, reason: "missing_target" };

  const snapshot = routingSnapshot && typeof routingSnapshot === "object" ? routingSnapshot : {};
  const nowMs = Date.now();
  const timeoutMin = clamp(
    toNum(candidate?.responseTimeoutMinutes, DEFAULT_ADMIN_RESPONSE_TIMEOUT_MINUTES),
    5,
    240
  );
  const deadlineMs = nowMs + timeoutMin * 60 * 1000;
  const previousUid = safeStr(previousAdminUid || requestData?.currentAdminUid);
  const assignedAdminId = safeStr(candidate?.role) === "assignedAdmin" ? targetUid : "";
  const assignedPartnerId =
    safeStr(candidate?.role) === "assignedAdmin" ? safeStr(candidate?.partnerId) : "";
  const assignedPartnerName =
    safeStr(candidate?.role) === "assignedAdmin" ? safeStr(candidate?.partnerName) : "";
  const assignedBranchIds =
    safeStr(candidate?.role) === "assignedAdmin"
      ? normalizePartnerIdList(candidate?.assignedBranchIds || candidate?.assignedBranchId || [])
      : [];
  const assignedBranchId = safeStr(candidate?.assignedBranchId || assignedBranchIds[0]);
  const coverageSource = safeStr(candidate?.coverageSource || "legacy_manual");
  const routingStatus = safeStr(
    snapshot?.routingStatus || (assignedAdminId ? "assigned" : "unresolved")
  );
  const unresolvedReason = safeStr(snapshot?.unresolvedReason || "");
  const historyEntry = {
    fromAdminUid: previousUid || null,
    toAdminUid: targetUid,
    reason: safeStr(reason),
    escalationReason: safeStr(escalationReason),
    routedAtMs: nowMs,
    availabilityAtRouting: normalizeAvailability(candidate?.availability),
    assignedPartnerId: assignedPartnerId || null,
    assignedBranchIds: assignedBranchIds.length ? assignedBranchIds : null,
    coverageSource,
  };
  const reassignmentHistory = buildReassignmentHistory(requestData, historyEntry);
  const escalationCount =
    toNum(requestData?.escalationCount, 0) + (safeStr(escalationReason) ? 1 : 0);
  const county = safeStr(requestData?.county);
  const town = safeStr(requestData?.town || requestData?.city);

  await db
    .collection("serviceRequests")
    .doc(safeRid)
    .set(
      {
        county,
        town,
        city: town,
        countyLower: normalizeCountyLower(requestData?.countyLower || county),
        currentAdminUid: targetUid,
        currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
        currentAdminEmail: safeStr(candidate?.email),
        currentAdminAvailability: normalizeAvailability(candidate?.availability),
        assignedAdminId,
        assignedPartnerId,
        assignedPartnerName,
        assignedBranchIds,
        assignedBranchId,
        coverageSource,
        routingStatus,
        routedAt: FieldValue.serverTimestamp(),
        routedAtMs: nowMs,
        routingReason: safeStr(reason) || "auto_route",
        escalationReason: safeStr(escalationReason),
        escalationCount,
        responseDeadlineAtMs: deadlineMs,
        updatedAt: FieldValue.serverTimestamp(),
        routingMeta: {
          county,
          town,
          track: safeStr(requestData?.track),
          country: safeStr(requestData?.country),
          currentAdminUid: targetUid,
          currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
          currentAdminEmail: safeStr(candidate?.email),
          assignedAdminId,
          assignedPartnerId,
          assignedPartnerName,
          assignedBranchIds,
          assignedBranchId,
          coverageSource,
          preferredAgentId: safeStr(requestData?.preferredAgentId),
          preferredAgentName: safeStr(requestData?.preferredAgentName),
          preferredAgentStatus: safeStr(requestData?.preferredAgentStatus),
          preferredAgentInvalidReason: safeStr(
            snapshot?.preferredAgentReason || requestData?.preferredAgentInvalidReason
          ),
          preferredAgentInvalidMessage:
            safeStr(snapshot?.preferredAgentReasonLabel) ||
            safeStr(requestData?.preferredAgentInvalidMessage),
          routedAt: FieldValue.serverTimestamp(),
          routedAtMs: nowMs,
          routingReason: safeStr(reason) || "auto_route",
          routingStatus,
          adminAvailabilityAtRouting: normalizeAvailability(candidate?.availability),
          escalationReason: safeStr(escalationReason),
          unresolvedReason,
          partnerDecisionSource: safeStr(snapshot?.partnerDecisionSource),
          countyMatchType: safeStr(candidate?.countyMatchType || ""),
          countyTier: toNum(candidate?.countyTier, 0),
          distanceKm: Number.isFinite(Number(candidate?.distanceKm))
            ? Number(candidate?.distanceKm)
            : null,
          requestDefinitionId: safeStr(
            snapshot?.requestDefinitionId ||
              requestData?.requestDefinitionId ||
              requestData?.routingMeta?.requestDefinitionId
          ),
          requestDefinitionKey: safeStr(
            snapshot?.requestDefinitionKey ||
              requestData?.requestDefinitionKey ||
              requestData?.routingMeta?.requestDefinitionKey
          ),
          eligiblePartnerIds: normalizePartnerIdList(
            snapshot?.eligiblePartnerIds ||
              requestData?.eligiblePartnerIds ||
              requestData?.routingMeta?.eligiblePartnerIds ||
              []
          ),
          eligiblePartnerCount: toNum(snapshot?.eligiblePartnerCount, 0),
          eligibleAdminCount: toNum(snapshot?.eligibleAdminCount, 0),
          escalationCount,
          reassignmentHistory,
          acceptedAt: requestData?.routingMeta?.acceptedAt || null,
          acceptedAtMs: toNum(requestData?.routingMeta?.acceptedAtMs, 0),
          lockedOwnerAdminUid: safeStr(requestData?.ownerLockedAdminUid),
          responseDeadlineAtMs: deadlineMs,
        },
      },
      { merge: true }
    );

  await notifyAdminRoutedRequest({ requestId: safeRid, adminUid: targetUid, reason });
  return { ok: true, uid: targetUid, reason: safeStr(reason), escalationReason };
}

async function autoRouteRequest({
  requestId,
  requestData,
  reason = "auto_route",
  excludeAdminUids = [],
}) {
  const safeRid = safeStr(requestId);
  if (!safeRid) return { ok: false, reason: "missing_request_id" };

  const data = requestData && typeof requestData === "object" ? requestData : {};
  if (safeStr(data?.ownerLockedAdminUid)) {
    return { ok: false, reason: "locked_owner" };
  }

  const excluded = Array.from(
    new Set(
      [safeStr(data?.currentAdminUid), ...excludeAdminUids]
        .map((x) => safeStr(x))
        .filter(Boolean)
    )
  );

  const auto = await resolveRoutingCandidate({
    requestData: data,
    excludeAdminUids: excluded,
  });
  if (auto?.candidate) {
    return routeRequestToAdmin({
      requestId: safeRid,
      requestData: data,
      candidate: auto.candidate,
      reason,
      escalationReason: safeStr(auto?.escalationReason),
      previousAdminUid: safeStr(data?.currentAdminUid),
      routingSnapshot: auto?.routingSnapshot || null,
    });
  }

  await db.collection("serviceRequests").doc(safeRid).set(
    {
      routingStatus: "unresolved",
      escalationReason:
        safeStr(auto?.routingSnapshot?.unresolvedReason || "no_valid_admin_available"),
      escalationCount: toNum(data?.escalationCount, 0) + 1,
      routingReason: safeStr(reason) || "auto_route",
      updatedAt: FieldValue.serverTimestamp(),
      routingMeta: {
        ...(data?.routingMeta && typeof data.routingMeta === "object" ? data.routingMeta : {}),
        routingStatus: "unresolved",
        unresolvedReason: safeStr(
          auto?.routingSnapshot?.unresolvedReason || "no_valid_admin_available"
        ),
        partnerDecisionSource: safeStr(auto?.routingSnapshot?.partnerDecisionSource || "unresolved"),
        eligiblePartnerCount: toNum(auto?.routingSnapshot?.eligiblePartnerCount, 0),
        eligibleAdminCount: toNum(auto?.routingSnapshot?.eligibleAdminCount, 0),
      },
    },
    { merge: true }
  );

  return {
    ok: false,
    reason: safeStr(auto?.routingSnapshot?.unresolvedReason || "no_valid_admin_available"),
  };
}

async function notifyRequestOwnerStatus({
  requestId,
  reqAfter,
  status,
  pushType = "",
  eventId = "",
}) {
  const ownerUid = safeStr(reqAfter?.uid);
  if (!ownerUid) return;

  const text = buildStatusNotificationText(reqAfter, status);
  const notificationType = resolveUserRequestNotificationType(status);
  const pushSignal = safeStr(pushType) || lower(notificationType) || "request_status";
  const notificationKey = safeStr(pushSignal || notificationType || "request_status");
  await Promise.all([
    sendPushToRecipient({
      uid: ownerUid,
      role: "user",
      title: text.title,
      body: text.body,
      data: {
        type: pushSignal,
        requestId,
        status: safeStr(status),
        targetRole: "user",
      },
    }),
    writeUserNotificationDoc(
      ownerUid,
      `status_${requestId}_${notificationKey}_${safeStr(status)}_${safeStr(eventId) || "evt"}`,
      {
        type: notificationType,
        title: text.title,
        body: text.body,
        requestId,
        status,
      }
    ),
  ]);
}

function buildManagerScopePayload(input = {}, existingScope = {}) {
  const now = Date.now();
  const existing = normalizeManagerScope(existingScope);
  const assignedModules = normalizeManagerModules(
    input?.assignedModules?.length ? input.assignedModules : existing.assignedModules
  );

  return {
    ...existing,
    name: safeStr(input?.name || existing.name),
    stationedCountry: safeStr(input?.stationedCountry || existing.stationedCountry),
    stationedCountryLower: lower(
      input?.stationedCountryLower ||
        input?.stationedCountry ||
        existing.stationedCountryLower ||
        existing.stationedCountry
    ),
    cityTown: safeStr(input?.cityTown || existing.cityTown),
    managerRole: safeStr(input?.managerRole || existing.managerRole),
    assignedModules,
    notes: safeStr(input?.notes ?? existing.notes),
    status: normalizeManagerStatus(input?.status || existing.status || "active"),
    inviteToken: safeStr(input?.inviteToken || existing.inviteToken),
    inviteId: safeStr(input?.inviteId || existing.inviteId),
    inviteCreatedAtMs: toNum(input?.inviteCreatedAtMs || existing.inviteCreatedAtMs, 0),
    inviteExpiresAtMs: toNum(input?.inviteExpiresAtMs || existing.inviteExpiresAtMs, 0),
    lastLoginAtMs: toNum(input?.lastLoginAtMs || existing.lastLoginAtMs, 0),
    updatedAtMs: now,
  };
}

function buildInviteLink(appBaseUrl, inviteToken, email) {
  const base = safeStr(appBaseUrl);
  const token = safeStr(inviteToken);
  if (!token) return "";
  if (!base || (!base.startsWith("http://") && !base.startsWith("https://"))) return "";
  try {
    const url = new URL("/signup", base);
    url.searchParams.set("managerInvite", token);
    const safeEmail = safeStr(email).toLowerCase();
    if (safeEmail) url.searchParams.set("email", safeEmail);
    return url.toString();
  } catch {
    return "";
  }
}

async function updatePendingInvitesForEmail(email, patch = {}) {
  const safeEmail = safeStr(email).toLowerCase();
  if (!safeEmail) return 0;
  const inviteSnap = await db
    .collection(MANAGER_INVITES_COLLECTION)
    .where("emailLower", "==", safeEmail)
    .where("status", "==", "pending")
    .limit(20)
    .get();
  if (inviteSnap.empty) return 0;
  const batch = db.batch();
  inviteSnap.docs.forEach((docSnap) => {
    batch.set(
      docSnap.ref,
      {
        ...(patch && typeof patch === "object" ? patch : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      },
      { merge: true }
    );
  });
  await batch.commit();
  return inviteSnap.docs.length;
}

exports.createManagerInvite = functions.https.onCall(async (data, context) => {
  const caller = await requireAdminCallerContext(context, { superOnly: true });
  const email = safeStr(data?.email).toLowerCase();
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "Valid manager email is required");
  }

  const assignedModules = normalizeManagerModules(data?.assignedModules);
  if (!assignedModules.length) {
    throw new functions.https.HttpsError("invalid-argument", "At least one module is required");
  }

  const now = Date.now();
  const expiryHours = clamp(
    toNum(data?.expiresInHours, DEFAULT_MANAGER_INVITE_EXPIRY_HOURS),
    1,
    168
  );
  const expiresAtMs = now + expiryHours * 60 * 60 * 1000;
  const inviteToken = generateManagerInviteToken();
  const inviteLink = buildInviteLink(data?.appBaseUrl, inviteToken, email);

  await db
    .collection(MANAGER_INVITES_COLLECTION)
    .doc(inviteToken)
    .set(
      {
        id: inviteToken,
        inviteToken,
        email,
        emailLower: email,
        name: safeStr(data?.name),
        stationedCountry: safeStr(data?.stationedCountry),
        stationedCountryLower: lower(data?.stationedCountry),
        cityTown: safeStr(data?.cityTown),
        managerRole: safeStr(data?.managerRole),
        assignedModules,
        notes: safeStr(data?.notes),
        status: "pending",
        singleUse: true,
        expiresAtMs,
        createdByUid: caller.callerUid,
        createdByEmail: safeStr(caller?.callerDoc?.email).toLowerCase(),
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: now,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    );

  await writeManagerAuditLog({
    managerUid: "",
    managerEmail: email,
    action: "manager_invite_created",
    moduleKey: assignedModules[0] || "",
    details: `Invite created for ${email}`,
    metadata: {
      inviteId: inviteToken,
      assignedModules,
      expiresAtMs,
    },
    actorUid: caller.callerUid,
    actorEmail: safeStr(caller?.callerDoc?.email).toLowerCase(),
    actorRole: caller.callerRole,
  });

  return {
    ok: true,
    inviteId: inviteToken,
    inviteToken,
    inviteLink,
    email,
    assignedModules,
    expiresAtMs,
  };
});

exports.redeemManagerInvite = functions.https.onCall(async (data, context) => {
  const callerUid = safeStr(context?.auth?.uid);
  if (!callerUid) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const inviteToken = safeStr(data?.inviteToken);
  if (!inviteToken) {
    throw new functions.https.HttpsError("invalid-argument", "inviteToken is required");
  }

  const inviteRef = db.collection(MANAGER_INVITES_COLLECTION).doc(inviteToken);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Manager invite was not found");
  }
  const invite = inviteSnap.data() || {};
  const inviteStatus = lower(invite?.status || "pending");
  if (inviteStatus !== "pending") {
    throw new functions.https.HttpsError("failed-precondition", "Invite has already been used");
  }

  const now = Date.now();
  const expiresAtMs = toNum(invite?.expiresAtMs, 0);
  if (expiresAtMs > 0 && now > expiresAtMs) {
    await inviteRef.set(
      {
        status: "expired",
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    );
    throw new functions.https.HttpsError("failed-precondition", "Invite has expired");
  }

  const inviteEmail = safeStr(invite?.email || invite?.emailLower).toLowerCase();
  const callerEmail = safeStr(context?.auth?.token?.email).toLowerCase();
  if (!callerEmail || !inviteEmail || callerEmail !== inviteEmail) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Invite email does not match signed-in account"
    );
  }

  const userDoc = (await getUserDocByUid(callerUid)) || {};
  const managerScope = buildManagerScopePayload(
    {
      name: safeStr(invite?.name || userDoc?.name),
      stationedCountry: safeStr(invite?.stationedCountry),
      cityTown: safeStr(invite?.cityTown),
      managerRole: safeStr(invite?.managerRole),
      assignedModules: normalizeManagerModules(invite?.assignedModules),
      notes: safeStr(invite?.notes),
      status: "active",
      inviteToken,
      inviteId: inviteToken,
      inviteCreatedAtMs: toNum(invite?.createdAtMs, now),
      inviteExpiresAtMs: expiresAtMs,
      lastLoginAtMs: now,
    },
    userDoc?.managerScope
  );
  if (!managerScope.assignedModules.length) {
    throw new functions.https.HttpsError("failed-precondition", "Invite has no modules assigned");
  }

  const batch = db.batch();
  batch.set(
    db.collection("users").doc(callerUid),
    {
      email: inviteEmail,
      role: "manager",
      managerScope,
      managerUpdatedBy: `invite:${inviteToken}`,
      managerUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    },
    { merge: true }
  );
  batch.set(
    inviteRef,
    {
      status: "redeemed",
      redeemedByUid: callerUid,
      redeemedByEmail: callerEmail,
      redeemedAt: FieldValue.serverTimestamp(),
      redeemedAtMs: now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: now,
    },
    { merge: true }
  );
  await batch.commit();

  await writeManagerAuditLog({
    managerUid: callerUid,
    managerEmail: inviteEmail,
    action: "manager_invite_redeemed",
    details: "Manager invite redeemed and modules assigned",
    metadata: {
      inviteId: inviteToken,
      assignedModules: managerScope.assignedModules,
    },
    actorUid: callerUid,
    actorEmail: callerEmail,
    actorRole: "manager",
  });

  return {
    ok: true,
    uid: callerUid,
    email: inviteEmail,
    assignedModules: managerScope.assignedModules,
    status: managerScope.status,
  };
});

exports.upsertManagerAssignmentByEmail = functions.https.onCall(async (data, context) => {
  const caller = await requireAdminCallerContext(context, { superOnly: true });
  const email = safeStr(data?.email).toLowerCase();
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "Valid manager email is required");
  }

  const assignedModules = normalizeManagerModules(data?.assignedModules);
  if (!assignedModules.length) {
    throw new functions.https.HttpsError("invalid-argument", "At least one module is required");
  }

  const matches = await findUserDocsByEmail(email);
  const targetRows = Array.isArray(matches?.rows) ? matches.rows : [];
  if (!targetRows.length) {
    throw new functions.https.HttpsError(
      "not-found",
      "No user account found for this email. Invite them first."
    );
  }

  const now = Date.now();
  const status = normalizeManagerStatus(data?.status || "active");
  const batch = db.batch();

  targetRows.forEach((row) => {
    const uid = safeStr(row?.id);
    if (!uid) return;
    const scope = buildManagerScopePayload(
      {
        name: safeStr(data?.name || row?.name),
        stationedCountry: safeStr(data?.stationedCountry),
        cityTown: safeStr(data?.cityTown),
        managerRole: safeStr(data?.managerRole),
        assignedModules,
        notes: safeStr(data?.notes),
        status,
      },
      row?.managerScope
    );

    batch.set(
      db.collection("users").doc(uid),
      {
        email,
        role: "manager",
        managerScope: scope,
        managerUpdatedBy: caller.callerUid,
        managerUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    );
  });

  await batch.commit();
  await updatePendingInvitesForEmail(email, {
    assignedModules,
    status: "pending",
    name: safeStr(data?.name),
    stationedCountry: safeStr(data?.stationedCountry),
    stationedCountryLower: lower(data?.stationedCountry),
    cityTown: safeStr(data?.cityTown),
    managerRole: safeStr(data?.managerRole),
    notes: safeStr(data?.notes),
  });

  await Promise.all(
    targetRows.map((row) =>
      writeManagerAuditLog({
        managerUid: safeStr(row?.id),
        managerEmail: email,
        action: "manager_assignment_updated",
        moduleKey: assignedModules[0] || "",
        details: `Manager modules updated: ${assignedModules.join(", ")}`,
        metadata: { assignedModules, status },
        actorUid: caller.callerUid,
        actorEmail: safeStr(caller?.callerDoc?.email).toLowerCase(),
        actorRole: caller.callerRole,
      })
    )
  );

  return {
    ok: true,
    email,
    uid: safeStr(matches?.primaryUid),
    uids: targetRows.map((row) => safeStr(row?.id)).filter(Boolean),
    assignedModules,
    status,
  };
});

exports.revokeManagerByEmail = functions.https.onCall(async (data, context) => {
  const caller = await requireAdminCallerContext(context, { superOnly: true });
  const email = safeStr(data?.email).toLowerCase();
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "Valid manager email is required");
  }

  const matches = await findUserDocsByEmail(email);
  const targetRows = Array.isArray(matches?.rows) ? matches.rows : [];
  const targetUids = targetRows.map((row) => safeStr(row?.id)).filter(Boolean);
  const now = Date.now();

  if (targetUids.length) {
    const batch = db.batch();
    targetUids.forEach((uid) => {
      batch.set(
        db.collection("users").doc(uid),
        {
          role: "user",
          managerScope: defaultManagerScopePayload(),
          managerUpdatedBy: caller.callerUid,
          managerUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: now,
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  await updatePendingInvitesForEmail(email, {
    status: "revoked",
    revokedByUid: caller.callerUid,
    revokedByEmail: safeStr(caller?.callerDoc?.email).toLowerCase(),
    revokedAt: FieldValue.serverTimestamp(),
    revokedAtMs: now,
  });

  await Promise.all(
    targetUids.map((uid) =>
      writeManagerAuditLog({
        managerUid: uid,
        managerEmail: email,
        action: "manager_revoked",
        details: "Manager role revoked",
        actorUid: caller.callerUid,
        actorEmail: safeStr(caller?.callerDoc?.email).toLowerCase(),
        actorRole: caller.callerRole,
      })
    )
  );

  return {
    ok: true,
    email,
    uid: safeStr(matches?.primaryUid),
    uids: targetUids,
    revoked: targetUids.length,
  };
});

/* ======================================================
   Existing callable functions (kept)
====================================================== */

exports.grantStaffAccess = functions.https.onCall(async (data, context) => {
  const caller = await requireAdminCallerContext(context);

  const email = safeStr(data?.email).toLowerCase();
  if (!email || !email.includes("@")) {
    throw new functions.https.HttpsError("invalid-argument", "Email required");
  }

  const specialties = Array.isArray(data?.specialties)
    ? data.specialties
    : Array.isArray(data?.specialities)
    ? data.specialities
    : [];
  const tracks = Array.isArray(data?.tracks)
    ? data.tracks.map((x) => lower(x)).filter(Boolean).slice(0, 10)
    : [];
  const maxActive = clamp(toNum(data?.maxActive, 2), 1, 20);

  const requestedOwnerAdminUid = safeStr(data?.ownerAdminUid);
  const ownerAdminUid =
    caller.isSuperAdmin && requestedOwnerAdminUid ? requestedOwnerAdminUid : caller.callerUid;

  if (caller.isAssignedAdmin && ownerAdminUid !== caller.callerUid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Assigned admin can only grant staff under own account"
    );
  }

  const ownerAdminDoc = await getUserDocByUid(ownerAdminUid);
  const ownerAdminRole = normalizeRole(ownerAdminDoc?.role);
  const ownerIsSuperAdmin = ownerAdminRole === "superAdmin";
  if (!(ownerAdminRole === "assignedAdmin" || ownerIsSuperAdmin)) {
    throw new functions.https.HttpsError("invalid-argument", "ownerAdminUid must be an admin user");
  }

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch {
    user = await admin.auth().createUser({
      email,
      password: Math.random().toString(36).slice(-10),
    });
  }

  const staffRef = db.collection("staff").doc(user.uid);
  const existingSnap = await staffRef.get();
  const existing = existingSnap.exists ? existingSnap.data() || {} : {};
  const existingOwnerUid = safeStr(existing?.ownerAdminUid);
  if (caller.isAssignedAdmin && existingOwnerUid && existingOwnerUid !== caller.callerUid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This staff member belongs to another assigned admin"
    );
  }

  await staffRef.set(
    {
      email,
      active: true,
      onboarded: existing?.onboarded === true,
      specialities: specialties,
      specialties,
      tracks,
      maxActive,
      ownerAdminUid,
      ownerAdminRole: ownerIsSuperAdmin ? "superAdmin" : ownerAdminRole,
      ownerAdminEmail: safeStr(ownerAdminDoc?.email).toLowerCase(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(existingSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );

  return { ok: true, uid: user.uid, email, ownerAdminUid };
});

exports.revokeStaffAccess = functions.https.onCall(async (data, context) => {
  const caller = await requireAdminCallerContext(context);

  let targetUid = safeStr(data?.uid);
  const email = safeStr(data?.email).toLowerCase();

  if (!targetUid && email) {
    try {
      const user = await admin.auth().getUserByEmail(email);
      targetUid = safeStr(user?.uid);
    } catch {
      targetUid = "";
    }
  }

  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "uid or email required");
  }

  const staffRef = db.collection("staff").doc(targetUid);
  const staffSnap = await staffRef.get();
  if (!staffSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Staff record not found");
  }

  const staffData = staffSnap.data() || {};
  const existingOwnerUid = safeStr(staffData?.ownerAdminUid);
  if (caller.isAssignedAdmin && existingOwnerUid && existingOwnerUid !== caller.callerUid) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "You can only revoke staff under your assigned admin account"
    );
  }

  const access = staffData?.access && typeof staffData.access === "object" ? staffData.access : {};
  const revokeCount = toNum(access?.revokeCount, 0) + 1;
  const rehireCount = toNum(access?.rehireCount, 0);

  await staffRef.set(
    {
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
      access: {
        revokeCount,
        rehireCount,
        lastAction: "revoke",
        lastRevokedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  return { ok: true, uid: targetUid };
});

exports.superAdminOverrideRouteRequest = functions.https.onCall(async (data, context) => {
  const caller = await requireAdminCallerContext(context, { superOnly: true });

  const requestId = safeStr(data?.requestId);
  const targetAdminUid = safeStr(data?.targetAdminUid);
  const reason = safeStr(data?.reason) || "super_admin_override";
  if (!requestId) {
    throw new functions.https.HttpsError("invalid-argument", "requestId is required");
  }

  const reqRef = db.collection("serviceRequests").doc(requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Request not found");
  }
  const reqData = reqSnap.data() || {};

  if (!targetAdminUid) {
    if (safeStr(reqData?.ownerLockedAdminUid)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Locked requests require targetAdminUid for manual override"
      );
    }

    const result = await autoRouteRequest({
      requestId,
      requestData: reqData,
      reason,
    });
    return { ok: Boolean(result?.ok), mode: "auto", result };
  }

  const selectedTargetAdminDoc = await getUserDocByUid(targetAdminUid);
  if (!selectedTargetAdminDoc) {
    throw new functions.https.HttpsError("not-found", "Target admin user does not exist");
  }
  const selectedTargetRole = normalizeRole(selectedTargetAdminDoc?.role);
  const selectedIsSuperAdmin = selectedTargetRole === "superAdmin";
  if (!(selectedIsSuperAdmin || selectedTargetRole === "assignedAdmin")) {
    throw new functions.https.HttpsError("invalid-argument", "Target user is not an admin");
  }

  const canonicalTargetAdminUid = await resolveAuthUidByEmail(
    selectedTargetAdminDoc?.email,
    targetAdminUid
  );
  const effectiveTargetAdminUid = safeStr(canonicalTargetAdminUid || targetAdminUid);

  let targetAdminDoc = selectedTargetAdminDoc;
  if (effectiveTargetAdminUid && effectiveTargetAdminUid !== safeStr(targetAdminUid)) {
    const canonicalDoc = await getUserDocByUid(effectiveTargetAdminUid);
    if (canonicalDoc) {
      targetAdminDoc = canonicalDoc;
    } else {
      await db.collection("users").doc(effectiveTargetAdminUid).set(
        {
          email: safeStr(selectedTargetAdminDoc?.email),
          role: "assignedAdmin",
          adminScope:
            selectedTargetAdminDoc?.adminScope &&
            typeof selectedTargetAdminDoc.adminScope === "object"
              ? selectedTargetAdminDoc.adminScope
              : {},
          adminUpdatedBy: safeStr(caller?.callerUid),
          adminUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      targetAdminDoc = await getUserDocByUid(effectiveTargetAdminUid);
    }
  }

  let candidate = null;
  try {
    candidate = await resolveExplicitAdminCandidate(
      effectiveTargetAdminUid || safeStr(targetAdminUid),
      reqData
    );
  } catch (error) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      safeStr(error?.message || "Target admin is not eligible for this request.")
    );
  }

  const routingSnapshot = {
    routingStatus: safeStr(candidate?.role) === "assignedAdmin" ? "assigned" : "unresolved",
    unresolvedReason: safeStr(candidate?.role) === "assignedAdmin" ? "" : "manual_intervention_required",
    partnerDecisionSource: "manual_override",
    eligiblePartnerCount: candidate?.partnerId ? 1 : 0,
    eligibleAdminCount: safeStr(candidate?.role) === "assignedAdmin" ? 1 : 0,
  };

  const result = await routeRequestToAdmin({
    requestId,
    requestData: reqData,
    candidate,
    reason,
    escalationReason:
      safeStr(candidate?.role) === "assignedAdmin"
        ? "super_admin_override"
        : "manual_intervention_required",
    previousAdminUid: safeStr(reqData?.currentAdminUid),
    routingSnapshot,
  });

  if (safeStr(reqData?.ownerLockedAdminUid)) {
    await reqRef.set(
      {
        ownerLockedAdminUid: candidate.uid,
        ownerLockedAt: FieldValue.serverTimestamp(),
        routingMeta: {
          ...(reqData?.routingMeta && typeof reqData.routingMeta === "object"
            ? reqData.routingMeta
            : {}),
          lockedOwnerAdminUid: candidate.uid,
        },
      },
      { merge: true }
    );
  }

  return { ok: Boolean(result?.ok), mode: "manual", result };
});

exports.recordRequestDefinitionEngagement = functions.https.onCall(async (data, context) => {
  const callerUid = safeStr(context?.auth?.uid);
  if (!callerUid) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const definitionId = safeStr(data?.definitionId);
  const definitionKey = safeStr(data?.definitionKey);
  if (!definitionId && !definitionKey) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "definitionId or definitionKey is required"
    );
  }

  let definitionRef = null;
  let definitionSnap = null;

  if (definitionId) {
    definitionRef = db.collection(REQUEST_DEFINITION_COLLECTION).doc(definitionId);
    definitionSnap = await definitionRef.get();
  }

  if ((!definitionSnap || !definitionSnap.exists) && definitionKey) {
    const querySnap = await db
      .collection(REQUEST_DEFINITION_COLLECTION)
      .where("definitionKey", "==", definitionKey)
      .limit(1)
      .get();
    if (!querySnap.empty) {
      definitionSnap = querySnap.docs[0];
      definitionRef = definitionSnap.ref;
    }
  }

  if (!definitionRef || !definitionSnap || !definitionSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Request definition not found");
  }

  const eventType = normalizeRequestDefinitionEngagementEventType(data?.eventType);
  const engagementField = requestDefinitionEngagementFieldForEventType(eventType);
  const scoreDelta = requestDefinitionEngagementScoreDelta(eventType);
  const now = Date.now();
  const eventId = `${safeStr(definitionRef.id)}_${eventType}_${callerUid}_${now}`;
  const resolvedKey = safeStr(definitionSnap.data()?.definitionKey || definitionKey);

  await Promise.all([
    definitionRef.set(
      {
        engagement: {
          [engagementField]: FieldValue.increment(1),
          lastEventType: eventType,
          lastEventAt: FieldValue.serverTimestamp(),
          lastEventAtMs: now,
        },
        engagementScore: FieldValue.increment(scoreDelta),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: now,
      },
      { merge: true }
    ),
    db.collection(REQUEST_DEFINITION_ENGAGEMENT_COLLECTION).doc(eventId).set(
      {
        eventId,
        definitionId: safeStr(definitionRef.id),
        definitionKey: resolvedKey,
        eventType,
        scoreDelta,
        actorUid: callerUid,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: now,
      },
      { merge: true }
    ),
  ]);

  return {
    ok: true,
    definitionId: safeStr(definitionRef.id),
    definitionKey: resolvedKey,
    eventType,
    scoreDelta,
  };
});

exports.onServiceRequestAutoRoute = onDocumentCreated(
  {
    region: REGION,
    document: "serviceRequests/{requestId}",
  },
  async (event) => {
    const requestId = safeStr(event?.params?.requestId);
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "service_request_auto_route"))) return;

    const data = snap.data() || {};
    const status = lower(data?.status || "new");
    if (status !== "new") return;

    try {
      await autoRouteRequest({
        requestId,
        requestData: data,
        reason: "new_request_auto_route",
      });
    } catch (error) {
      logger.error("Auto-route failed", {
        requestId,
        error: error?.message || String(error),
      });
      await db.collection("serviceRequests").doc(requestId).set(
        {
          escalationReason: "auto_route_failed",
          routingReason: "new_request_auto_route",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }
);

exports.sweepUnresponsiveAdminRoutes = onSchedule(
  {
    region: REGION,
    schedule: "every 5 minutes",
    timeZone: "Etc/UTC",
  },
  async () => {
    const nowMs = Date.now();
    const snap = await db
      .collection("serviceRequests")
      .where("status", "==", "new")
      .limit(DEFAULT_ROUTING_SWEEP_LIMIT)
      .get();

    let scanned = 0;
    let rerouted = 0;
    let skippedLocked = 0;

    for (const docSnap of snap.docs) {
      scanned += 1;
      const requestId = safeStr(docSnap.id);
      const data = docSnap.data() || {};

      if (safeStr(data?.ownerLockedAdminUid)) {
        skippedLocked += 1;
        continue;
      }

      const currentAdminUid = safeStr(data?.currentAdminUid);
      const deadlineMs = toNum(
        data?.responseDeadlineAtMs || data?.routingMeta?.responseDeadlineAtMs,
        0
      );
      const respondedAtMs = toNum(
        data?.adminRespondedAtMs || data?.routingMeta?.acceptedAtMs,
        0
      );

      if (!currentAdminUid) {
        const result = await autoRouteRequest({
          requestId,
          requestData: data,
          reason: "sweep_missing_admin_route",
        });
        if (result?.ok) rerouted += 1;
        continue;
      }

      if (respondedAtMs > 0) continue;
      if (!deadlineMs || deadlineMs > nowMs) continue;

      const history = Array.isArray(data?.routingMeta?.reassignmentHistory)
        ? data.routingMeta.reassignmentHistory
        : [];
      const exclude = history.map((row) => safeStr(row?.toAdminUid)).filter(Boolean);
      exclude.push(currentAdminUid);

      const result = await autoRouteRequest({
        requestId,
        requestData: data,
        reason: "timeout_reassignment",
        excludeAdminUids: exclude,
      });
      if (result?.ok) rerouted += 1;
    }

    logger.info("sweepUnresponsiveAdminRoutes complete", {
      scanned,
      rerouted,
      skippedLocked,
    });
  }
);

/* ======================================================
   Push / in-app notification triggers (v2)
====================================================== */

exports.onPendingMessagePush = onDocumentCreated(
  {
    region: REGION,
    document: "serviceRequests/{requestId}/pendingMessages/{pendingId}",
  },
  async (event) => {
    const requestId = safeStr(event?.params?.requestId);
    const pendingId = safeStr(event?.params?.pendingId);
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "pending_msg_push"))) return;

    const msg = snap.data() || {};
    const fromRole = lower(msg?.fromRole);
    const fromUid = safeStr(msg?.fromUid);
    if (fromRole !== "user" && fromRole !== "staff") return;

    const req = await getRequestDoc(requestId);
    if (!req) return;

    const adminUid = safeStr(req?.ownerLockedAdminUid || req?.currentAdminUid || req?.assignedAdminId);
    const messageKind = chatMessageKind(msg);
    const title = chatNotificationTitleByKind(messageKind);
    const adminType = chatNotificationTypeByKind(messageKind, "admin", fromRole);
    const senderLabel = fromRole === "staff" ? "staff" : "user";
    const body = `New ${messageKind} from ${senderLabel}.`;
    const route = `/app/admin/request/${encodeURIComponent(requestId)}?openChat=1`;

    if (adminUid && adminUid !== fromUid) {
      await sendPushToRecipient({
        uid: adminUid,
        role: "admin",
        title,
        body,
        data: {
          type: "chat_pending",
          requestId,
          pendingId,
          messageKind,
          fromRole,
        },
      });
      await writeScopedNotificationDoc({
        uid: adminUid,
        scope: "users",
        notificationId: `pending_chat_${requestId}_${pendingId}`,
        payload: {
          type: adminType,
          title,
          body,
          requestId,
          pendingId,
          actorRole: fromRole,
          actorUid: fromUid,
          route,
        },
      });
    }

    const superRows = await listSuperAdminCandidates({
      excludeUids: [fromUid, adminUid].filter(Boolean),
    });
    await Promise.all(
      superRows.slice(0, 40).map(async (row) => {
        const uid = safeStr(row?.uid);
        if (!uid || uid === fromUid) return;
        await sendPushToRecipient({
          uid,
          role: "admin",
          title,
          body,
          data: {
            type: "chat_pending_super_admin",
            requestId,
            pendingId,
            messageKind,
            fromRole,
          },
        });
        await writeScopedNotificationDoc({
          uid,
          scope: "users",
          notificationId: `pending_chat_super_${requestId}_${pendingId}_${uid}`,
          payload: {
            type: `SUPER_${adminType}`,
            title,
            body,
            requestId,
            pendingId,
            actorRole: fromRole,
            actorUid: fromUid,
            route,
          },
        });
      })
    );
  }
);

exports.onPublishedMessagePush = onDocumentCreated(
  {
    region: REGION,
    document: "serviceRequests/{requestId}/messages/{mid}",
  },
  async (event) => {
    const requestId = safeStr(event?.params?.requestId);
    const mid = safeStr(event?.params?.mid);
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "msg_created_push"))) return;

    const msg = snap.data() || {};
    const req = await getRequestDoc(requestId);
    if (!req) return;

    try {
      await mirrorPublishedChatAttachment({
        requestId,
        messageId: mid,
        requestData: req,
        messageData: msg,
      });
    } catch (error) {
      logger.warn("chat attachment mirror failed", {
        requestId,
        mid,
        message: safeStr(error?.message || String(error)).slice(0, 220),
      });
    }

    const fromRole = lower(msg.fromRole);
    const fromUid = safeStr(msg.fromUid);
    const messageKind = chatMessageKind(msg);
    const title = chatNotificationTitleByKind(messageKind);
    const body = chatPreview(msg);

    let recipientUid = "";
    let targetRole = "";

    if (fromRole === "admin" || fromRole === "staff") {
      recipientUid = safeStr(req.uid);
      targetRole = "user";
    } else if (fromRole === "user") {
      recipientUid = safeStr(req.assignedTo);
      targetRole = "staff";
    }

    const canNotifyRecipient = Boolean(recipientUid) && recipientUid !== fromUid;
    if (!canNotifyRecipient) {
      logger.info("Published message push skipped (no recipient)", { requestId, mid, fromRole });
    } else {
      await sendPushToRecipient({
        uid: recipientUid,
        role: targetRole,
        title,
        body,
        data: {
          type: "chat",
          requestId,
          mid,
          messageKind,
          fromRole: fromRole || "unknown",
          targetRole,
        },
      });

      await writeScopedNotificationDoc({
        uid: recipientUid,
        scope: targetRole === "staff" ? "staff" : "users",
        notificationId: `chat_${requestId}_${mid}_${targetRole}`,
        payload: {
          type: chatNotificationTypeByKind(messageKind, targetRole, fromRole),
          title,
          body,
          requestId,
          messageId: mid,
          actorRole: fromRole,
          actorUid: fromUid,
          route:
            targetRole === "staff"
              ? `/staff/request/${encodeURIComponent(requestId)}?openChat=1`
              : `/app/request/${encodeURIComponent(requestId)}?openChat=1`,
        },
      });
    }

    const sourcePendingId = safeStr(msg?.sourcePendingId);

    // Assigned admin + super admins receive granular chat notifications from user/staff.
    // For moderated chats (sourcePendingId exists), admin/super were already notified on pending creation.
    if ((fromRole === "user" || fromRole === "staff") && !sourcePendingId) {
      const adminUid = safeStr(req?.ownerLockedAdminUid || req?.currentAdminUid || req?.assignedAdminId);
      const senderLabel = fromRole === "user" ? "user" : "staff";
      const adminType = chatNotificationTypeByKind(messageKind, "admin", fromRole);
      const adminRoute = `/app/admin/request/${encodeURIComponent(requestId)}?openChat=1`;
      const adminBody = `New ${messageKind} from ${senderLabel}.`;

      if (adminUid && adminUid !== fromUid) {
        await sendPushToRecipient({
          uid: adminUid,
          role: "admin",
          title,
          body: adminBody,
          data: {
            type: "chat_admin",
            requestId,
            mid,
            messageKind,
            fromRole,
          },
        });
        await writeScopedNotificationDoc({
          uid: adminUid,
          scope: "users",
          notificationId: `chat_admin_${requestId}_${mid}`,
          payload: {
            type: adminType,
            title,
            body: adminBody,
            requestId,
            messageId: mid,
            actorRole: fromRole,
            actorUid: fromUid,
            route: adminRoute,
          },
        });
      }

      const superRows = await listSuperAdminCandidates({
        excludeUids: [fromUid, adminUid].filter(Boolean),
      });
      await Promise.all(
        superRows.slice(0, 40).map(async (row) => {
          const superUid = safeStr(row?.uid);
          if (!superUid || superUid === fromUid) return;
          await sendPushToRecipient({
            uid: superUid,
            role: "admin",
            title,
            body: adminBody,
            data: {
              type: "chat_super_admin",
              requestId,
              mid,
              messageKind,
              fromRole,
            },
          });
          await writeScopedNotificationDoc({
            uid: superUid,
            scope: "users",
            notificationId: `chat_super_${requestId}_${mid}_${superUid}`,
            payload: {
              type: `SUPER_${adminType}`,
              title,
              body: adminBody,
              requestId,
              messageId: mid,
              actorRole: fromRole,
              actorUid: fromUid,
              route: adminRoute,
            },
          });
        })
      );
    }
  }
);

exports.onRequestStatusPush = onDocumentUpdated(
  {
    region: REGION,
    document: "serviceRequests/{requestId}",
  },
  async (event) => {
    const requestId = safeStr(event?.params?.requestId);
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    if (!beforeSnap?.exists || !afterSnap?.exists) return;

    if (!(await claimEventLock(event.id, "request_update_push"))) return;

    const before = beforeSnap.data() || {};
    const after = afterSnap.data() || {};

    const beforeStatus = lower(before.status);
    const afterStatus = lower(after.status);
    const beforeStaffStatus = lower(before.staffStatus);
    const afterStaffStatus = lower(after.staffStatus);

    const statusChanged = beforeStatus !== afterStatus && !!afterStatus;
    const startedAtBecameSet =
      tsMillis(before.staffStartedAt) <= 0 && tsMillis(after.staffStartedAt) > 0;
    const staffInProgressChanged =
      beforeStaffStatus !== "in_progress" && afterStaffStatus === "in_progress";
    const startedWorkSignal = startedAtBecameSet || staffInProgressChanged;

    const shouldSendStartedWorkPush =
      startedWorkSignal || (statusChanged && (afterStatus === "contacted" || afterStatus === "in_progress"));

    // If status becomes contacted/in_progress in the same update as staff start, send only the friendlier started-work push.
    const statusHandledByStartedWork =
      statusChanged &&
      shouldSendStartedWorkPush &&
      (afterStatus === "contacted" || afterStatus === "in_progress");

    if (statusChanged && !statusHandledByStartedWork) {
      await notifyRequestOwnerStatus({
        requestId,
        reqAfter: after,
        status: afterStatus,
        eventId: event.id,
      });
    }

    if (shouldSendStartedWorkPush) {
      const ownerUid = safeStr(after.uid);
      const label = requestLabel(after);
      const body = label
        ? `We've started working on your request (${label}).`
        : "We've started working on your request.";

      if (ownerUid) {
        await Promise.all([
          sendPushToRecipient({
            uid: ownerUid,
            role: "user",
            title: "We started your request",
            body,
            data: {
              type: "request_in_progress",
              requestId,
              status: "in_progress",
              targetRole: "user",
            },
          }),
          writeUserNotificationDoc(ownerUid, `inprogress_${requestId}_${safeStr(event.id)}`, {
            type: "REQUEST_IN_PROGRESS",
            title: "Update on your request",
            body,
            requestId,
            status: "in_progress",
          }),
        ]);
      }

      const adminUid = safeStr(after?.ownerLockedAdminUid || after?.currentAdminUid || after?.assignedAdminId);
      const adminTitle = "Request in progress";
      const adminBody = label
        ? `Request moved to in-progress (${label}).`
        : "A request moved to in-progress.";
      const adminRoute = `/app/admin/request/${encodeURIComponent(requestId)}`;

      if (adminUid) {
        await sendPushToRecipient({
          uid: adminUid,
          role: "admin",
          title: adminTitle,
          body: adminBody,
          data: {
            type: "REQUEST_PUT_IN_PROGRESS",
            requestId,
            status: "in_progress",
            targetRole: "admin",
          },
        });
        await writeScopedNotificationDoc({
          uid: adminUid,
          scope: "users",
          notificationId: `req_inprogress_admin_${requestId}_${safeStr(event.id)}`,
          payload: {
            type: "REQUEST_PUT_IN_PROGRESS",
            title: adminTitle,
            body: adminBody,
            requestId,
            status: "in_progress",
            route: adminRoute,
          },
        });
      }

      const superRows = await listSuperAdminCandidates({
        excludeUids: adminUid ? [adminUid] : [],
      });
      await Promise.all(
        superRows.slice(0, 40).map(async (row) => {
          const superUid = safeStr(row?.uid);
          if (!superUid) return;
          await sendPushToRecipient({
            uid: superUid,
            role: "admin",
            title: adminTitle,
            body: adminBody,
            data: {
              type: "SUPER_ADMIN_REQUEST_PUT_IN_PROGRESS",
              requestId,
              status: "in_progress",
              targetRole: "admin",
            },
          });
          await writeScopedNotificationDoc({
            uid: superUid,
            scope: "users",
            notificationId: `req_inprogress_super_${requestId}_${safeStr(event.id)}_${superUid}`,
            payload: {
              type: "SUPER_ADMIN_REQUEST_PUT_IN_PROGRESS",
              title: adminTitle,
              body: adminBody,
              requestId,
              status: "in_progress",
              route: adminRoute,
            },
          });
        })
      );
    }
  }
);

exports.onRequestProgressUpdatePush = onDocumentCreated(
  {
    region: REGION,
    document: "serviceRequests/{requestId}/progressUpdates/{updateId}",
  },
  async (event) => {
    const requestId = safeStr(event?.params?.requestId);
    const updateId = safeStr(event?.params?.updateId);
    const snap = event.data;
    if (!requestId || !updateId || !snap?.exists) return;

    if (!(await claimEventLock(event.id, "request_progress_update_push"))) return;

    const progress = snap.data() || {};
    if (progress?.visibleToUser === false) return;

    const req = await getRequestDoc(requestId);
    const ownerUid = safeStr(req?.uid);
    if (!ownerUid) return;

    const title = "Progress updated";
    const body =
      safeStr(progress?.content) || "There is a new progress update on your request.";
    const route = `/app/request/${encodeURIComponent(requestId)}`;

    await Promise.all([
      sendPushToRecipient({
        uid: ownerUid,
        role: "user",
        title,
        body,
        data: {
          type: "PROGRESS_UPDATED",
          requestId,
          updateId,
          targetRole: "user",
        },
      }),
      writeScopedNotificationDoc({
        uid: ownerUid,
        scope: "users",
        notificationId: `progress_update_${requestId}_${updateId}`,
        payload: {
          type: "PROGRESS_UPDATED",
          title,
          body,
          requestId,
          route,
          actorRole: safeStr(progress?.staffId ? "staff" : progress?.createdBy ? "admin" : ""),
          actorUid: safeStr(progress?.staffId || progress?.createdBy),
        },
      }),
    ]);
  }
);

exports.onPartnerPushSubscriptionExpiringSoonPush = onDocumentUpdated(
  {
    region: REGION,
    document: "partnerPushSubscriptions/{partnerId}",
  },
  async (event) => {
    const partnerId = safeStr(event?.params?.partnerId);
    const afterSnap = event.data?.after;
    if (!partnerId || !afterSnap?.exists) return;

    if (!(await claimEventLock(event.id, "push_subscription_expiry_notice"))) return;

    const before = event.data?.before?.exists ? event.data.before.data() || {} : {};
    const after = afterSnap.data() || {};

    const nowMs = Date.now();
    const notifyWindowMs = 5 * 24 * 60 * 60 * 1000;

    const afterEndAtMs = resolvePushSubscriptionEndAtMs(after);
    const beforeEndAtMs = resolvePushSubscriptionEndAtMs(before);
    const afterStatus = lower(after?.status);
    const beforeStatus = lower(before?.status);

    const shouldNotifyNow =
      afterStatus === "active" &&
      afterEndAtMs > nowMs &&
      afterEndAtMs - nowMs <= notifyWindowMs;

    if (!shouldNotifyNow) return;

    const wasAlreadyInWindow =
      beforeStatus === "active" &&
      beforeEndAtMs > nowMs &&
      beforeEndAtMs - nowMs <= notifyWindowMs;

    if (wasAlreadyInWindow && beforeEndAtMs === afterEndAtMs) return;

    await notifySuperAdminsPushSubscriptionExpiringSoon({
      partnerId,
      partnerName: safeStr(after?.partnerName || partnerId),
      endAtMs: afterEndAtMs,
      endDate: safeStr(after?.endDate),
    });
  }
);

exports.sweepPartnerPushSubscriptionExpiringSoonPush = onSchedule(
  {
    region: REGION,
    schedule: "every 12 hours",
    timeZone: "UTC",
  },
  async (event) => {
    if (!(await claimEventLock(event.id, "push_subscription_expiry_sweep"))) return;

    const nowMs = Date.now();
    const notifyWindowMs = 5 * 24 * 60 * 60 * 1000;
    const maxRows = 500;
    let scanned = 0;
    let eligible = 0;
    let notified = 0;

    let snap = null;
    try {
      snap = await db
        .collection("partnerPushSubscriptions")
        .where("status", "==", "active")
        .where("endAtMs", ">", nowMs)
        .where("endAtMs", "<=", nowMs + notifyWindowMs)
        .limit(maxRows)
        .get();
    } catch (error) {
      logger.warn("push subscription expiry sweep fallback query", {
        message: safeStr(error?.message || String(error), 220),
      });
      snap = await db
        .collection("partnerPushSubscriptions")
        .where("status", "==", "active")
        .limit(maxRows)
        .get();
    }

    for (const docSnap of snap.docs) {
      scanned += 1;
      const row = docSnap.data() || {};
      const endAtMs = resolvePushSubscriptionEndAtMs(row);
      if (endAtMs <= nowMs || endAtMs > nowMs + notifyWindowMs) continue;
      eligible += 1;
      notified += await notifySuperAdminsPushSubscriptionExpiringSoon({
        partnerId: safeStr(row?.partnerId || docSnap.id),
        partnerName: safeStr(row?.partnerName || row?.displayName || docSnap.id),
        endAtMs,
        endDate: safeStr(row?.endDate),
      });
    }

    logger.info("push subscription expiry sweep completed", {
      scanned,
      eligible,
      notified,
    });
  }
);

exports.onStaffTaskAssignedPush = onDocumentCreated(
  {
    region: REGION,
    document: "staff/{staffUid}/tasks/{requestId}",
  },
  async (event) => {
    const staffUid = safeStr(event?.params?.staffUid);
    const requestId = safeStr(event?.params?.requestId);
    const taskSnap = event.data;
    if (!taskSnap?.exists) return;

    if (!(await claimEventLock(event.id, "staff_task_assigned_push"))) return;

    const task = taskSnap.data() || {};
    const req = (await getRequestDoc(requestId)) || {};
    const label = requestLabel({ ...req, ...task });
    const body = label ? `You have a new assigned request (${label}).` : "You have a new assigned request.";

    await Promise.all([
      sendPushToRecipient({
        uid: staffUid,
        role: "staff",
        title: "New task assigned",
        body,
        data: {
          type: "request_assigned",
          requestId,
          targetRole: "staff",
        },
      }),
      writeUserNotificationDoc(staffUid, `assigned_${requestId}`, {
        type: "request_assigned",
        title: "New task assigned",
        body,
        requestId,
      }),
    ]);
  }
);

exports.onCustomCountryDemand = onDocumentCreated(
  {
    region: REGION,
    document: "analytics_customCountryDemand/{eventId}",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "custom_country_demand"))) return;

    const data = snap.data() || {};
    const uid = safeStr(data?.uid);
    const rawKey = safeStr(data?.countryKey) || lower(data?.countryLower) || lower(data?.country);
    const countryKey = safeStr(rawKey)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);

    if (!uid || !countryKey) return;

    const nowMs = Date.now();
    const countRef = db.collection("analytics_customCountryDemandCounts").doc(countryKey);
    const userRef = countRef.collection("users").doc(uid);

    let isNewUser = false;
    try {
      await userRef.create({
        uid,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      isNewUser = true;
    } catch (error) {
      const code = error?.code;
      const already =
        code === 6 ||
        code === "already-exists" ||
        /already exists/i.test(String(error?.message || ""));
      if (!already) throw error;
    }

    const countryDisplay = safeStr(data?.countryDisplay) || safeStr(data?.country) || countryKey;
    const countryLower = lower(data?.countryLower) || lower(countryDisplay);
    const lastTrack = safeStr(data?.track);

    await countRef.set(
      {
        countryKey,
        countryLower,
        countryDisplay,
        lastTrack,
        uniqueUserCount: FieldValue.increment(isNewUser ? 1 : 0),
        totalSubmissions: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      },
      { merge: true }
    );
  }
);

exports.onCountryDemand = onDocumentCreated(
  {
    region: REGION,
    document: "analytics_countryDemand/{eventId}",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "country_demand"))) return;

    const data = snap.data() || {};
    const uid = safeStr(data?.uid);
    const rawKey = safeStr(data?.countryKey) || lower(data?.countryLower) || lower(data?.country);
    const countryKey = safeStr(rawKey)
      .toLowerCase()
      .replace(/['â€™]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);

    if (!uid || !countryKey) return;

    const nowMs = Date.now();
    const countRef = db.collection("analytics_countryDemandCounts").doc(countryKey);
    const userRef = countRef.collection("users").doc(uid);

    let isNewUser = false;
    try {
      await userRef.create({
        uid,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      isNewUser = true;
    } catch (error) {
      const code = error?.code;
      const already =
        code === 6 ||
        code === "already-exists" ||
        /already exists/i.test(String(error?.message || ""));
      if (!already) throw error;
    }

    const countryDisplay = safeStr(data?.countryDisplay) || safeStr(data?.country) || countryKey;
    const countryLower = lower(data?.countryLower) || lower(countryDisplay);
    const track = lower(data?.track);
    const safeTrack = track === "study" || track === "work" || track === "travel" ? track : "";

    const update = {
      countryKey,
      countryLower,
      countryDisplay,
      lastTrack: safeTrack,
      uniqueUserCount: FieldValue.increment(isNewUser ? 1 : 0),
      totalTaps: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    };

    if (safeTrack) {
      update[`trackCounts.${safeTrack}`] = FieldValue.increment(1);
    }

    await countRef.set(update, { merge: true });
  }
);

exports.onNewsRouteView = onDocumentCreated(
  {
    region: REGION,
    document: "analytics_newsRouteViews/{eventId}",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "news_route_view"))) return;

    const data = snap.data() || {};
    const uid = safeStr(data?.uid);
    const track = lower(data?.track);
    const safeTrack = track === "study" || track === "work" || track === "travel" ? track : "";
    const rawCountryKey = safeStr(data?.countryKey) || lower(data?.countryLower) || lower(data?.country);
    const countryKey = safeStr(rawCountryKey)
      .toLowerCase()
      .replace(/['â€™]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);

    const rawRouteKey = safeStr(data?.routeKey);
    const routeKey = safeStr(rawRouteKey || (safeTrack && countryKey ? `${safeTrack}_${countryKey}` : ""))
      .toLowerCase()
      .replace(/['â€™]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120);

    if (!uid || !safeTrack || !countryKey || !routeKey) return;

    const nowMs = Date.now();

    const countryDisplay = safeStr(data?.country) || countryKey;
    const countryLower = lower(data?.countryLower) || lower(countryDisplay);

    const routeRef = db.collection("analytics_newsRouteViewCounts").doc(routeKey);
    const routeUserRef = routeRef.collection("users").doc(uid);
    const countryRef = db.collection("analytics_newsCountryViewCounts").doc(countryKey);
    const countryUserRef = countryRef.collection("users").doc(uid);

    let isNewRouteUser = false;
    try {
      await routeUserRef.create({ uid, createdAt: FieldValue.serverTimestamp(), createdAtMs: nowMs });
      isNewRouteUser = true;
    } catch (error) {
      const code = error?.code;
      const already =
        code === 6 ||
        code === "already-exists" ||
        /already exists/i.test(String(error?.message || ""));
      if (!already) throw error;
    }

    let isNewCountryUser = false;
    try {
      await countryUserRef.create({ uid, createdAt: FieldValue.serverTimestamp(), createdAtMs: nowMs });
      isNewCountryUser = true;
    } catch (error) {
      const code = error?.code;
      const already =
        code === 6 ||
        code === "already-exists" ||
        /already exists/i.test(String(error?.message || ""));
      if (!already) throw error;
    }

    await Promise.all([
      routeRef.set(
        {
          routeKey,
          track: safeTrack,
          countryKey,
          countryLower,
          countryDisplay,
          uniqueUserCount: FieldValue.increment(isNewRouteUser ? 1 : 0),
          totalViews: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        },
        { merge: true }
      ),
      countryRef.set(
        {
          countryKey,
          countryLower,
          countryDisplay,
          lastTrack: safeTrack,
          uniqueUserCount: FieldValue.increment(isNewCountryUser ? 1 : 0),
          totalViews: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
          [`trackCounts.${safeTrack}`]: FieldValue.increment(1),
        },
        { merge: true }
      ),
    ]);
  }
);

exports.onSelfHelpLinkClick = onDocumentCreated(
  {
    region: REGION,
    document: "analytics_selfHelpLinkClicks/{eventId}",
  },
  async (event) => {
    const snap = event.data;
    if (!snap?.exists) return;

    if (!(await claimEventLock(event.id, "selfhelp_link_click"))) return;

    const data = snap.data() || {};
    const uid = safeStr(data?.uid);
    if (!uid) return;

    const bucket = data?.isAffiliate === true ? "affiliate" : "other";
    const track = lower(data?.track);
    const safeTrack = track === "study" || track === "work" || track === "travel" ? track : "";

    const nowMs = Date.now();
    const ref = db.collection("analytics_selfHelpLinkClickCounts").doc(bucket);

    const update = {
      bucket,
      totalClicks: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    };

    if (safeTrack) {
      update[`trackCounts.${safeTrack}`] = FieldValue.increment(1);
    }

    await ref.set(update, { merge: true });
  }
);

Object.assign(
  exports,
  buildRequestCommandFoundation({
    functions,
    admin,
    db,
    FieldValue,
    safeStr,
    lower,
    toNum,
    normalizeRole,
    getUserDocByUid,
    autoRouteRequest,
    writeUserNotificationDoc,
  })
);

Object.assign(
  exports,
  buildFinanceFoundation({
    functions,
    onDocumentUpdated,
    onSchedule,
    logger,
    db,
    FieldValue,
    REGION,
    safeStr,
    lower,
    toNum,
    clamp,
    getUserDocByUid,
    requireAdminCallerContext,
    normalizeAdminScope,
    fetchPartnerById,
    claimEventLock,
    autoRouteRequest,
    writeManagerAuditLog,
    writeScopedNotificationDoc,
  })
);

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  getCurrentUserRoleContext,
  normalizeAdminScope,
  normalizeUserRole,
} from "./adminroleservice";
import { createAdminNotification, createUserNotification } from "./notificationDocs";
import {
  evaluatePartnerRequestCompatibility,
  fetchPartnerById,
  listPartners,
  preferredAgentReasonLabel,
} from "./partnershipService";

const ASSIGNED_ADMIN_ROLE_VARIANTS = [
  "assignedAdmin",
  "assignedadmin",
  "assigned_admin",
  "admin",
];
const ACTIVE_REQUEST_STATUSES = ["new", "contacted"];
const ADMIN_AVAILABILITY_WEIGHTS = { active: 1, busy: 0.35, offline: 0 };

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

function normalizeCountyLower(value) {
  return lower(value);
}

function normalizeCountryLower(value) {
  return lower(value);
}

function normalizeStringList(values = []) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const clean = safeStr(value);
    const key = clean.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
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

function getScopeCountryCoverage(scope) {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  return normalizeStringList([
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

function getRequestCountryValue(requestData = {}) {
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
  const location =
    safeRequest?.location && typeof safeRequest.location === "object" ? safeRequest.location : {};
  const mode = lower(safeRequest?.partnerFilterMode || routingMeta?.partnerFilterMode);
  const candidates = [
    safeRequest?.countryOfResidence,
    routingMeta?.countryOfResidence,
    safeRequest?.residenceCountry,
    routingMeta?.residenceCountry,
    safeRequest?.originCountry,
    safeRequest?.locationCountry,
    geo?.country,
    geolocation?.country,
    location?.country,
    location?.countryName,
    geolocation?.countryName,
    geo?.countryName,
  ];
  if (mode === "home_country") {
    candidates.push(safeRequest?.country, routingMeta?.country);
  }
  return normalizeStringList(candidates)[0] || "";
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
  const location =
    safeRequest?.location && typeof safeRequest.location === "object" ? safeRequest.location : {};
  const candidates = [
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
  ];
  return normalizeStringList(candidates)[0] || "";
}

function getRequestCountyLower(requestData = {}) {
  return normalizeCountyLower(
    safeStr(requestData?.countyLower) || safeStr(requestData?.routingMeta?.countyLower) || getRequestCountyValue(requestData)
  );
}

function adminScopeRequiresCountyCoverage(scope, requestCountryLower = "") {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  const scopeCountriesLower = getScopeCountryCoverageLower(safeScope);
  const explicitStationedLower = getStationedCountryLower(safeScope);
  const targetCountryLower = normalizeCountryLower(requestCountryLower);
  const hasKenyaCoverage =
    scopeCountriesLower.includes("kenya") || (!scopeCountriesLower.length && explicitStationedLower === "kenya");
  if (targetCountryLower) {
    return targetCountryLower === "kenya" && hasKenyaCoverage;
  }
  return hasKenyaCoverage || (!scopeCountriesLower.length && (safeScope?.countiesLower || []).length > 0);
}

function normalizeAvailability(value) {
  const v = lower(value);
  return Object.prototype.hasOwnProperty.call(ADMIN_AVAILABILITY_WEIGHTS, v) ? v : "active";
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

function enrichAdminCandidate(candidate, loadMap = {}) {
  const uid = safeStr(candidate?.uid);
  const availability = normalizeAvailability(candidate?.availability);
  const availabilityWeight = ADMIN_AVAILABILITY_WEIGHTS[availability] || 0;
  const activeLoad = Math.max(0, toNum(loadMap?.[uid], 0));
  const maxActive = clamp(toNum(candidate?.maxActiveRequests, 12), 1, 120);
  const capacityRatio = activeLoad / maxActive;
  const hasCapacity = capacityRatio < 1;
  const isEligible = Boolean(uid) && availabilityWeight > 0 && hasCapacity;
  const capacityWeight = isEligible ? clamp(1 - capacityRatio, 0.08, 1) : 0;
  const fairnessWeight = isEligible ? 1 / (1 + activeLoad) : 0;

  return {
    ...candidate,
    availability,
    activeLoad,
    maxActiveRequests: maxActive,
    availableSlots: Math.max(0, maxActive - activeLoad),
    capacityRatio,
    eligible: isEligible,
    ineligibleReason:
      !uid
        ? "missing_admin_uid"
        : availabilityWeight <= 0
        ? "admin_unavailable"
        : !hasCapacity
        ? "admin_at_capacity"
        : "",
    score: isEligible ? availabilityWeight * capacityWeight * fairnessWeight : 0,
  };
}

function buildEligibleAdminOptions(candidates, loadMap = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => enrichAdminCandidate(candidate, loadMap))
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => {
      const countryGap =
        Number(Boolean(b?.countryOriginMatch)) - Number(Boolean(a?.countryOriginMatch));
      if (countryGap !== 0) return countryGap;

      const directGap =
        Number(safeStr(b?.countyMatchType) === "direct") -
        Number(safeStr(a?.countyMatchType) === "direct");
      if (directGap !== 0) return directGap;

      const loadGap = Number(a?.activeLoad || 0) - Number(b?.activeLoad || 0);
      if (loadGap !== 0) return loadGap;

      return safeStr(a?.email || a?.uid).localeCompare(safeStr(b?.email || b?.uid));
    });
}

function pickAdminCandidate(candidates, loadMap = {}) {
  return buildEligibleAdminOptions(candidates, loadMap)[0] || null;
}

async function buildActiveLoadMap() {
  const loadMap = {};
  const snap = await getDocs(
    query(
      collection(db, "serviceRequests"),
      where("status", "in", ACTIVE_REQUEST_STATUSES),
      limit(4000)
    )
  );

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const adminUid = safeStr(data?.currentAdminUid);
    if (!adminUid) return;
    loadMap[adminUid] = (loadMap[adminUid] || 0) + 1;
  });

  return loadMap;
}

function buildSuperAdminFallbackCandidate(roleCtx) {
  if (!roleCtx?.isSuperAdmin) return null;
  const scope = normalizeAdminScope(roleCtx?.adminScope);
  return {
    uid: safeStr(roleCtx?.uid),
    email: safeStr(roleCtx?.email),
    role: "superAdmin",
    availability: normalizeAvailability(scope.availability || "active"),
    maxActiveRequests: scope.maxActiveRequests,
    responseTimeoutMinutes: scope.responseTimeoutMinutes,
    town: scope.town,
    partnerId: "",
    partnerName: "",
    countyMatchType: "",
    unresolvedInbox: true,
  };
}

async function listAssignedAdminCandidatesForRequest(
  requestData,
  { partnerId = "", excludeUids = [] } = {}
) {
  const countyLower = getRequestCountyLower(requestData);
  const requestCountryLower = getRequestCountryLower(requestData);
  const safePartnerId = safeStr(partnerId);
  if (!safePartnerId || !requestCountryLower) return [];

  const excluded = new Set((excludeUids || []).map((x) => safeStr(x)).filter(Boolean));
  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("role", "in", ASSIGNED_ADMIN_ROLE_VARIANTS),
      limit(300)
    )
  );

  const rows = [];
  snap.docs.forEach((userSnap) => {
    const data = userSnap.data() || {};
    const uid = safeStr(userSnap.id);
    if (!uid || excluded.has(uid)) return;

    const scope = normalizeAdminScope(data?.adminScope);
    const stationedCountryLower = getStationedCountryLower(scope);
    const scopeCountriesLower = getScopeCountryCoverageLower(scope);
    const countryOriginMatch = scopeCountriesLower.length
      ? scopeCountriesLower.includes(requestCountryLower)
      : Boolean(stationedCountryLower) && stationedCountryLower === requestCountryLower;
    const requiresCountyCoverage = adminScopeRequiresCountyCoverage(scope, requestCountryLower);
    if (!scope.active) return;
    if (safeStr(scope?.partnerId) !== safePartnerId) return;
    if (!countryOriginMatch) return;
    if (requiresCountyCoverage) {
      if (!countyLower || !scope.countiesLower.includes(countyLower)) return;
    }

    rows.push({
      uid,
      email: safeStr(data?.email),
      role: "assignedAdmin",
      availability: normalizeAvailability(scope.availability),
      maxActiveRequests: scope.maxActiveRequests,
      responseTimeoutMinutes: scope.responseTimeoutMinutes,
      town: scope.town,
      partnerId: safePartnerId,
      partnerName: safeStr(scope?.partnerName),
      assignedBranchIds: Array.isArray(scope?.assignedBranchIds) ? scope.assignedBranchIds : [],
      coverageSource: safeStr(scope?.coverageSource || scope?.derivedCoverage?.source || "legacy_manual"),
      countries: getScopeCountryCoverage(scope),
      stationedCountry: safeStr(scope?.stationedCountry || scope?.country),
      countryOriginMatch,
      countyMatchType: requiresCountyCoverage
        ? safeStr(scope?.primaryCountyLower) === countyLower
          ? "direct"
          : "neighboring"
        : "country",
    });
  });

  return rows;
}

async function buildRoutingSnapshot(
  requestData,
  { excludeAdminUids = [], includeAdminOptions = false, selectedPartnerId = "" } = {}
) {
  const trackType = safeStr(requestData?.track).toLowerCase();
  const country = safeStr(requestData?.country || requestData?.routingMeta?.country);
  const county = getRequestCountyValue(requestData);
  const countryOfResidence = getRequestCountryValue(requestData);
  const partnerFilterMode = safeStr(
    requestData?.partnerFilterMode || requestData?.routingMeta?.partnerFilterMode
  );
  const preferredAgentId = safeStr(requestData?.preferredAgentId);
  const chosenPartnerId = safeStr(selectedPartnerId);
  const partnerRows = await listPartners({ activeOnly: false, max: 250 });
  const evaluations = partnerRows.map((partner) => ({
    partner,
    compatibility: evaluatePartnerRequestCompatibility(partner, {
      trackType,
      country,
      county,
      countryOfResidence,
      filterMode: partnerFilterMode,
    }),
  }));

  const eligiblePartners = evaluations.filter((row) => row.compatibility?.eligible);
  const preferredRow = preferredAgentId
    ? evaluations.find((row) => safeStr(row?.partner?.id) === preferredAgentId)
    : null;
  const selectedRow = chosenPartnerId
    ? evaluations.find((row) => safeStr(row?.partner?.id) === chosenPartnerId)
    : null;

  let preferredAgentValid = false;
  let preferredAgentReason = safeStr(requestData?.preferredAgentInvalidReason);
  let partnerDecisionSource = "auto";
  let candidatePartners = eligiblePartners;
  let selectedPartnerReason = "";

  if (chosenPartnerId) {
    if (!selectedRow) {
      selectedPartnerReason = "partner_not_found";
      partnerDecisionSource = "selected_partner_invalid";
      candidatePartners = [];
    } else if (!selectedRow.compatibility?.eligible) {
      selectedPartnerReason = safeStr(selectedRow.compatibility?.reasons?.[0]) || "partner_not_supported";
      partnerDecisionSource = "selected_partner_invalid";
      candidatePartners = [];
    } else {
      candidatePartners = [selectedRow];
      partnerDecisionSource = "selected_partner";
      if (
        preferredAgentId &&
        safeStr(selectedRow?.partner?.id) === preferredAgentId &&
        selectedRow.compatibility?.eligible
      ) {
        preferredAgentValid = true;
        partnerDecisionSource = "preferred_agent";
      }
    }
  } else if (preferredAgentId) {
    if (!preferredRow) {
      preferredAgentReason = preferredAgentReason || "partner_not_found";
      partnerDecisionSource = "preferred_agent_invalid";
    } else if (preferredRow.compatibility?.eligible) {
      preferredAgentValid = true;
      candidatePartners = [preferredRow];
      partnerDecisionSource = "preferred_agent";
    } else {
      preferredAgentReason =
        preferredAgentReason || safeStr(preferredRow.compatibility?.reasons?.[0]);
      partnerDecisionSource = "preferred_agent_invalid";
    }
  }

  const activeLoadMap = await buildActiveLoadMap();
  const partnerSourceRows = includeAdminOptions
    ? chosenPartnerId
      ? candidatePartners
      : eligiblePartners
    : candidatePartners;
  const partnerOptions = [];
  for (const row of partnerSourceRows) {
    const adminCandidates = await listAssignedAdminCandidatesForRequest(requestData, {
      partnerId: row.partner.id,
      excludeUids: excludeAdminUids,
    });
    const eligibleAdminOptions = buildEligibleAdminOptions(adminCandidates, activeLoadMap);
    const bestAdmin = pickAdminCandidate(adminCandidates, activeLoadMap);
    const countryWeight = bestAdmin?.countryOriginMatch ? 1.16 : 1;
    const countyWeight = row.compatibility?.countyMatchType === "direct" ? 1.08 : 1;
    const preferredWeight =
      preferredAgentValid && safeStr(row?.partner?.id) === preferredAgentId ? 1.12 : 1;
    partnerOptions.push({
      partner: row.partner,
      compatibility: row.compatibility,
      adminOptions: includeAdminOptions
        ? eligibleAdminOptions
        : [],
      bestAdmin,
      pairScore: bestAdmin
        ? Number(bestAdmin.score || 0) * countryWeight * countyWeight * preferredWeight
        : 0,
    });
  }

  const autoCandidatePartnerIds = new Set(candidatePartners.map((row) => safeStr(row?.partner?.id)));
  const viableOptions = partnerOptions
    .filter((row) => autoCandidatePartnerIds.has(safeStr(row?.partner?.id)))
    .filter((row) => row.bestAdmin)
    .sort((a, b) => Number(b.pairScore || 0) - Number(a.pairScore || 0));
  const bestOption = viableOptions[0] || null;

  let unresolvedReason = "";
  if (chosenPartnerId && !candidatePartners.length) {
    unresolvedReason = selectedPartnerReason || "partner_selection_required";
  } else if (!eligiblePartners.length) {
    unresolvedReason = preferredAgentReason || "no_eligible_partner";
  } else if (!viableOptions.length) {
    unresolvedReason = "no_eligible_assigned_admin";
  }

  return {
    selectedPartnerId: chosenPartnerId,
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
    eligiblePartnerCount: eligiblePartners.length,
    eligibleAdminCount: viableOptions.length,
    eligiblePartners: partnerOptions.map((row) => ({
      id: safeStr(row?.partner?.id),
      displayName: safeStr(row?.partner?.displayName),
      displayLabel: safeStr(row?.partner?.displayLabel || row?.partner?.displayName),
      homeCountries: Array.isArray(row?.partner?.homeCountries) ? row.partner.homeCountries : [],
      countyMatchType: safeStr(row?.compatibility?.countyMatchType),
      adminCount: Array.isArray(row?.adminOptions) ? row.adminOptions.length : 0,
      admins: Array.isArray(row?.adminOptions) ? row.adminOptions : [],
      isPreferred: safeStr(row?.partner?.id) === preferredAgentId,
    })),
    bestOption,
  };
}

export async function getRoutingOptionsForRequest(requestData) {
  return buildRoutingSnapshot(requestData, { includeAdminOptions: true });
}

async function resolveExplicitAdminCandidate(
  targetAdminUid,
  requestData = {},
  { selectedPartnerId = "" } = {}
) {
  const uid = safeStr(targetAdminUid);
  if (!uid) throw new Error("Target admin is required.");

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("Target admin user does not exist.");

  const data = snap.data() || {};
  const email = safeStr(data?.email);
  const normalizedRole = normalizeUserRole(data?.role);
  const isSuperAdmin = normalizedRole === "superAdmin";
  const isAssigned = normalizedRole === "assignedAdmin";

  if (!(isSuperAdmin || isAssigned)) {
    throw new Error("Target user is not an assigned admin.");
  }

  const scope = normalizeAdminScope(data?.adminScope);
  if (isAssigned && !safeStr(scope?.partnerId)) {
    throw new Error("Target admin is missing a partner binding.");
  }
  if (isAssigned && safeStr(selectedPartnerId) && safeStr(scope?.partnerId) !== safeStr(selectedPartnerId)) {
    throw new Error("Target admin does not belong to the selected partner.");
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
  if (isAssigned && !hasCountryCoverage) {
    throw new Error("Target admin is missing country coverage.");
  }
  if (isAssigned && !countryOriginMatch) {
    throw new Error("Target admin does not cover the request origin country.");
  }
  if (isAssigned && requiresCountyCoverage && countyLower && !scope.countiesLower.includes(countyLower)) {
    throw new Error("Target admin does not cover this county.");
  }

  const activeLoadMap = await buildActiveLoadMap();
  let partner = null;
  if (isAssigned) {
    partner = await fetchPartnerById(scope.partnerId);
    if (!partner) {
      throw new Error("Target admin's partner no longer exists.");
    }
    const compatibility = evaluatePartnerRequestCompatibility(partner, {
      trackType: requestData?.track,
      country: requestData?.country,
      county: getRequestCountyValue(requestData),
      countryOfResidence: getRequestCountryValue(requestData),
      filterMode: requestData?.partnerFilterMode,
    });
    if (!compatibility?.eligible) {
      throw new Error(
        preferredAgentReasonLabel(safeStr(compatibility?.reasons?.[0])) ||
          "Target admin's partner is incompatible with this request."
      );
    }

    const eligibility = enrichAdminCandidate(
      {
        uid,
        email,
        role: "assignedAdmin",
        availability: scope.availability,
        maxActiveRequests: scope.maxActiveRequests,
        responseTimeoutMinutes: scope.responseTimeoutMinutes,
        town: scope.town,
        partnerId: safeStr(partner?.id || scope?.partnerId),
        partnerName: safeStr(partner?.displayName || scope?.partnerName),
        assignedBranchIds: Array.isArray(scope?.assignedBranchIds) ? scope.assignedBranchIds : [],
        coverageSource: safeStr(scope?.coverageSource || scope?.derivedCoverage?.source || "legacy_manual"),
        countries: getScopeCountryCoverage(scope),
        stationedCountry: safeStr(scope?.stationedCountry || scope?.country),
        countryOriginMatch,
        countyMatchType: requiresCountyCoverage
          ? safeStr(scope?.primaryCountyLower) === countyLower
            ? "direct"
            : countyLower
            ? "neighboring"
            : ""
          : "country",
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

  return {
    uid,
    email,
    role: isSuperAdmin ? "superAdmin" : "assignedAdmin",
    availability: normalizeAvailability(scope.availability),
    maxActiveRequests: scope.maxActiveRequests,
    responseTimeoutMinutes: scope.responseTimeoutMinutes,
    town: scope.town,
    partnerId: safeStr(partner?.id || scope?.partnerId),
    partnerName: safeStr(partner?.displayName || scope?.partnerName),
    assignedBranchIds: Array.isArray(scope?.assignedBranchIds) ? scope.assignedBranchIds : [],
    coverageSource: safeStr(scope?.coverageSource || scope?.derivedCoverage?.source || "legacy_manual"),
    countyMatchType:
      safeStr(scope?.primaryCountyLower) === countyLower ? "direct" : countyLower ? "neighboring" : "",
  };
}

async function resolveRoutingCandidate({
  requestData,
  excludeAdminUids = [],
  actorRoleCtx,
  selectedPartnerId = "",
}) {
  const snapshot = await buildRoutingSnapshot(requestData, {
    excludeAdminUids,
    selectedPartnerId,
  });
  if (snapshot?.bestOption?.bestAdmin) {
    return {
      candidate: {
        ...snapshot.bestOption.bestAdmin,
        partnerId: safeStr(snapshot.bestOption?.partner?.id),
        partnerName: safeStr(snapshot.bestOption?.partner?.displayName),
        countyMatchType: safeStr(snapshot.bestOption?.compatibility?.countyMatchType),
      },
      routingSnapshot: snapshot,
      escalationReason: "",
    };
  }

  const fallback = buildSuperAdminFallbackCandidate(actorRoleCtx);
  return {
    candidate: fallback,
    routingSnapshot: snapshot,
    escalationReason: safeStr(snapshot?.unresolvedReason || "manual_intervention_required"),
  };
}

async function applyRouteToRequest({
  requestRef,
  requestData,
  candidate,
  reason,
  escalationReason = "",
  previousAdminUid = "",
  routingSnapshot = null,
}) {
  const targetUid = safeStr(candidate?.uid);
  if (!targetUid) {
    throw new Error("Unable to route request: missing target admin.");
  }

  const snapshot = routingSnapshot && typeof routingSnapshot === "object" ? routingSnapshot : {};
  const nowMs = Date.now();
  const timeoutMin = clamp(toNum(candidate?.responseTimeoutMinutes, 20), 5, 240);
  const deadlineMs = nowMs + timeoutMin * 60 * 1000;
  const previousUid = safeStr(previousAdminUid || requestData?.currentAdminUid);
  const assignedAdminId = safeStr(candidate?.role) === "assignedAdmin" ? targetUid : "";
  const assignedPartnerId =
    safeStr(candidate?.role) === "assignedAdmin" ? safeStr(candidate?.partnerId) : "";
  const assignedPartnerName =
    safeStr(candidate?.role) === "assignedAdmin" ? safeStr(candidate?.partnerName) : "";
  const assignedBranchIds =
    safeStr(candidate?.role) === "assignedAdmin" && Array.isArray(candidate?.assignedBranchIds)
      ? candidate.assignedBranchIds
      : [];
  const coverageSource = safeStr(candidate?.coverageSource || "legacy_manual");
  const routingStatus = safeStr(snapshot?.routingStatus || (assignedAdminId ? "assigned" : "unresolved"));
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
  const county = getRequestCountyValue(requestData);
  const countryOfResidence = getRequestCountryValue(requestData);
  const town = safeStr(requestData?.town || requestData?.city);

  await setDoc(
    requestRef,
    {
      county,
      town,
      city: town,
      countyLower: normalizeCountyLower(requestData?.countyLower || county),
      countryOfResidence: countryOfResidence || safeStr(requestData?.countryOfResidence),
      currentAdminUid: targetUid,
      currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
      currentAdminEmail: safeStr(candidate?.email),
    currentAdminAvailability: normalizeAvailability(candidate?.availability),
    assignedAdminId,
    assignedPartnerId,
      assignedPartnerName,
    assignedBranchIds,
    coverageSource,
      routingStatus,
      routedAt: serverTimestamp(),
      routedAtMs: nowMs,
      routingReason: safeStr(reason) || "manual_override_local",
      escalationReason: safeStr(escalationReason),
      escalationCount,
      responseDeadlineAtMs: deadlineMs,
      updatedAt: serverTimestamp(),
      routingMeta: {
        county,
        town,
        track: safeStr(requestData?.track),
        country: safeStr(requestData?.country),
        countryOfResidence,
        selectedPartnerId: safeStr(snapshot?.selectedPartnerId || ""),
        currentAdminUid: targetUid,
        currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
        currentAdminEmail: safeStr(candidate?.email),
        assignedAdminId,
        assignedPartnerId,
        assignedPartnerName,
        assignedBranchIds,
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
        routedAt: serverTimestamp(),
        routedAtMs: nowMs,
        routingReason: safeStr(reason) || "manual_override_local",
        routingStatus,
        adminAvailabilityAtRouting: normalizeAvailability(candidate?.availability),
        escalationReason: safeStr(escalationReason),
        unresolvedReason,
        partnerDecisionSource: safeStr(snapshot?.partnerDecisionSource),
        stationedCountryAtRouting: safeStr(
          candidate?.stationedCountry || candidate?.country || ""
        ),
        countyMatchType: safeStr(candidate?.countyMatchType || ""),
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

  const requestOwnerUid = safeStr(requestData?.uid);
  const routedBody =
    safeStr(reason) === "timeout_reassignment"
      ? "A request was reassigned to your queue after timeout."
      : "A new request was routed to your queue.";

  try {
    await createAdminNotification({
      uid: targetUid,
      type: "NEW_REQUEST",
      requestId,
      notificationId: `admin_route_${safeStr(requestId)}_${targetUid}`,
      extras: {
        title: "New routed request",
        body: routedBody,
      },
    });
  } catch (error) {
    console.warn("Failed to write routed admin notification:", error?.message || error);
  }

  if (requestOwnerUid) {
    try {
      await createUserNotification({
        uid: requestOwnerUid,
        type: "REQUEST_RECEIVED",
        requestId,
        notificationId: `request_received_${safeStr(requestId)}`,
      });
    } catch (error) {
      console.warn("Failed to write request received notification:", error?.message || error);
    }
  }

  return {
    ok: true,
    uid: targetUid,
    reason: safeStr(reason),
    escalationReason: safeStr(escalationReason),
  };
}

async function _superAdminOverrideRouteRequestLocal({
  requestId,
  selectedPartnerId = "",
  targetAdminUid = "",
  reason = "super_admin_manual_override",
}) {
  const roleCtx = await getCurrentUserRoleContext();
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Super admin access required.");
  }

  const reqRef = doc(db, "serviceRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error("Request not found.");
  }
  const reqData = reqSnap.data() || {};
  const safeSelectedPartnerId = safeStr(selectedPartnerId);
  const safeTarget = safeStr(targetAdminUid);
  if (!safeSelectedPartnerId) {
    throw new Error("Select a partner first.");
  }

  if (!safeTarget && safeStr(reqData?.ownerLockedAdminUid)) {
    throw new Error("Locked requests require selecting a specific admin.");
  }

  let candidate = null;
  let escalationReason = "";
  let routingSnapshot = null;

  if (safeTarget) {
    candidate = await resolveExplicitAdminCandidate(safeTarget, reqData, {
      selectedPartnerId: safeSelectedPartnerId,
    });
    routingSnapshot = {
      selectedPartnerId: safeSelectedPartnerId,
      routingStatus: "assigned",
      unresolvedReason: "",
      partnerDecisionSource: "manual_override",
      eligiblePartnerCount: candidate?.partnerId ? 1 : 0,
      eligibleAdminCount: 1,
    };
    escalationReason = "super_admin_override";
  } else {
    const auto = await resolveRoutingCandidate({
      requestData: reqData,
      actorRoleCtx: roleCtx,
      selectedPartnerId: safeSelectedPartnerId,
    });
    candidate = auto.candidate;
    escalationReason = auto.escalationReason;
    routingSnapshot = auto.routingSnapshot;
  }

  if (!candidate) {
    await setDoc(
      reqRef,
      {
        currentAdminUid: safeStr(roleCtx?.uid),
        currentAdminRole: "superAdmin",
        currentAdminEmail: safeStr(roleCtx?.email),
        routingStatus: "unresolved",
        escalationReason: safeStr(routingSnapshot?.unresolvedReason || "no_valid_admin_available"),
        escalationCount: toNum(reqData?.escalationCount, 0) + 1,
        routingReason: safeStr(reason) || "super_admin_manual_override",
        updatedAt: serverTimestamp(),
        routingMeta: {
          ...(reqData?.routingMeta && typeof reqData.routingMeta === "object"
            ? reqData.routingMeta
            : {}),
          selectedPartnerId: safeSelectedPartnerId,
          routingStatus: "unresolved",
          unresolvedReason: safeStr(routingSnapshot?.unresolvedReason || "no_valid_admin_available"),
        },
      },
      { merge: true }
    );
    return {
      ok: false,
      mode: safeTarget ? "manual_local" : "auto_local",
      reason: "no_valid_admin_available",
    };
  }

  const result = await applyRouteToRequest({
    requestRef: reqRef,
    requestData: reqData,
    candidate,
    reason: safeStr(reason) || "super_admin_manual_override",
    escalationReason,
    previousAdminUid: safeStr(reqData?.currentAdminUid),
    routingSnapshot,
  });

  if (safeTarget && safeStr(reqData?.ownerLockedAdminUid)) {
    await setDoc(
      reqRef,
      {
        ownerLockedAdminUid: safeTarget,
        ownerLockedAt: serverTimestamp(),
        routingMeta: {
          ...(reqData?.routingMeta && typeof reqData.routingMeta === "object"
            ? reqData.routingMeta
            : {}),
          lockedOwnerAdminUid: safeTarget,
        },
      },
      { merge: true }
    );
  }

  return { ok: true, mode: safeTarget ? "manual_local" : "auto_local", result };
}

export async function superAdminOverrideRouteRequest({
  requestId,
  selectedPartnerId = "",
  targetAdminUid = "",
  reason = "super_admin_manual_override",
} = {}) {
  const rid = safeStr(requestId);
  if (!rid) {
    throw new Error("requestId is required");
  }
  if (!safeStr(selectedPartnerId)) {
    throw new Error("Select a partner first.");
  }

  const payload = {
    requestId: rid,
    selectedPartnerId: safeStr(selectedPartnerId),
    targetAdminUid: safeStr(targetAdminUid),
    reason: safeStr(reason) || "super_admin_manual_override",
  };
  return _superAdminOverrideRouteRequestLocal(payload);
}

export async function routeUnroutedNewRequests({
  max = 120,
  reason = "super_admin_manual_bulk_route",
} = {}) {
  const roleCtx = await getCurrentUserRoleContext();
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Super admin access required.");
  }

  const payload = {
    max: clamp(toNum(max, 120), 1, 300),
    reason: safeStr(reason) || "super_admin_manual_bulk_route",
  };
  return _routeUnroutedNewRequestsLocal(payload, roleCtx);
}

async function _routeUnroutedNewRequestsLocal(
  {
    max = 120,
    reason = "super_admin_manual_bulk_route",
  } = {},
  roleCtx = null
) {
  const effectiveRoleCtx = roleCtx || (await getCurrentUserRoleContext());
  if (!effectiveRoleCtx?.isSuperAdmin) {
    throw new Error("Super admin access required.");
  }

  const maxRows = clamp(toNum(max, 120), 1, 300);
  const reqSnap = await getDocs(
    query(
      collection(db, "serviceRequests"),
      where("status", "==", "new"),
      limit(maxRows)
    )
  );

  let scanned = 0;
  let routed = 0;
  let skippedAlreadyRouted = 0;
  let skippedInvalidLockedOwner = 0;
  let noCandidate = 0;
  let failed = 0;
  const failureSamples = [];

  for (const row of reqSnap.docs) {
    scanned += 1;
    const requestId = safeStr(row.id);
    const requestData = row.data() || {};
    const currentAdminUid = safeStr(requestData?.currentAdminUid);
    if (currentAdminUid) {
      skippedAlreadyRouted += 1;
      continue;
    }

    const ownerLockedAdminUid = safeStr(requestData?.ownerLockedAdminUid);
    let candidate = null;
    let escalationReason = "";
    let routingSnapshot = null;

    if (ownerLockedAdminUid) {
      try {
        candidate = await resolveExplicitAdminCandidate(ownerLockedAdminUid, requestData);
        routingSnapshot = {
          routingStatus: "assigned",
          unresolvedReason: "",
          partnerDecisionSource: "locked_owner_backfill",
          eligiblePartnerCount: candidate?.partnerId ? 1 : 0,
          eligibleAdminCount: 1,
        };
        escalationReason = "locked_owner_backfill";
      } catch (error) {
        skippedInvalidLockedOwner += 1;
        if (failureSamples.length < 5) {
          failureSamples.push(`${requestId}: ${safeStr(error?.message || "invalid_locked_owner")}`);
        }
        continue;
      }
    } else {
      const auto = await resolveRoutingCandidate({
        requestData,
        actorRoleCtx: effectiveRoleCtx,
      });
      candidate = auto?.candidate || null;
      escalationReason = safeStr(auto?.escalationReason);
      routingSnapshot = auto?.routingSnapshot || null;
    }

    if (!candidate) {
      noCandidate += 1;
      continue;
    }

    try {
      await applyRouteToRequest({
        requestRef: doc(db, "serviceRequests", requestId),
        requestData,
        candidate,
        reason: safeStr(reason) || "super_admin_manual_bulk_route",
        escalationReason,
        previousAdminUid: safeStr(requestData?.currentAdminUid),
        routingSnapshot,
      });
      routed += 1;
    } catch (error) {
      failed += 1;
      if (failureSamples.length < 5) {
        failureSamples.push(`${requestId}: ${safeStr(error?.message || "route_failed")}`);
      }
    }
  }

  return {
    ok: true,
    scanned,
    routed,
    skippedAlreadyRouted,
    skippedInvalidLockedOwner,
    noCandidate,
    failed,
    failureSamples,
  };
}

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { APP_TRACK_OPTIONS, normalizeDestinationCountry } from "../constants/migrationOptions";
import {
  normalizeCountyList,
  normalizeCountyLowerList,
} from "../constants/kenyaCounties";
import { auth, db } from "../firebase";
import { getCurrentUserRoleContext } from "./adminroleservice";

export const PARTNERS_COLLECTION = "partners";
export const PARTNER_COVERAGE_COLLECTION = "partnerCoverage";
export const PARTNER_STATUS_OPTIONS = ["active", "inactive"];
export const PARTNER_FILTER_MODES = {
  HOME_COUNTRY: "home_country",
  DESTINATION_COUNTRY: "destination_country",
};

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeParagraph(value, max = 2000) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function lower(value, max = 400) {
  return safeString(value, max).toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanoseconds = Number(value?.nanoseconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000 + Math.floor((Number.isFinite(nanoseconds) ? nanoseconds : 0) / 1e6);
}

function createLocalId(prefix = "item") {
  const head = safeString(prefix, 20).toLowerCase() || "item";
  const stamp = Date.now().toString(36);
  const tail = Math.random().toString(36).slice(2, 8);
  return `${head}_${stamp}_${tail}`;
}

function normalizeTrackValue(value) {
  const raw = lower(value, 20);
  return APP_TRACK_OPTIONS.includes(raw) ? raw : "";
}

function normalizeTrackList(value) {
  if (!Array.isArray(value)) return [];
  const set = new Set();
  value.forEach((track) => {
    const safeTrack = normalizeTrackValue(track);
    if (safeTrack) set.add(safeTrack);
  });
  return APP_TRACK_OPTIONS.filter((track) => set.has(track));
}

function normalizeCountryValue(value) {
  const safeCountry = safeString(value, 120);
  if (!safeCountry) return "";
  return normalizeDestinationCountry(safeCountry) || safeCountry;
}

function normalizeCountryList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  value.forEach((country) => {
    const clean = normalizeCountryValue(country);
    const key = lower(clean, 120);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    rows.push(clean);
  });
  return rows.sort((a, b) => a.localeCompare(b));
}

function normalizeHomeCountryList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  value.forEach((country) => {
    const clean = safeString(country, 120);
    const key = lower(clean, 120);
    if (!clean || seen.has(key)) return;
    seen.add(key);
    rows.push(clean);
  });
  return rows.sort((a, b) => a.localeCompare(b));
}

function normalizePartnerFilterMode(value, fallback = PARTNER_FILTER_MODES.DESTINATION_COUNTRY) {
  const raw = lower(value, 40);
  return Object.values(PARTNER_FILTER_MODES).includes(raw) ? raw : fallback;
}

function mergeCoverageCounties(supportedCounties = []) {
  return normalizeCountyList([...(supportedCounties || [])]);
}

function normalizePartnerStatus(value, fallback = "active") {
  const raw = lower(value, 20);
  return PARTNER_STATUS_OPTIONS.includes(raw) ? raw : fallback;
}

function normalizeBranchRecord(raw = {}, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const country = normalizeCountryValue(source?.country);
  const county = safeString(source?.county, 120);
  return {
    id: safeString(source?.id, 80) || createLocalId(`branch_${index + 1}`),
    name: safeString(source?.name, 120),
    country,
    countryLower: lower(country, 120),
    county,
    countyLower: lower(county, 120),
    town: safeString(source?.town || source?.city, 120),
    address: safeParagraph(source?.address, 240),
    isActive: normalizeBoolean(source?.isActive, true),
    notes: safeParagraph(source?.notes, 240),
  };
}

function normalizeBranchList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  value.forEach((branch, index) => {
    const clean = normalizeBranchRecord(branch, index);
    const key = lower(clean.id, 80);
    if (!clean.name || !key || seen.has(key)) return;
    seen.add(key);
    rows.push(clean);
  });
  return rows.slice(0, 50);
}

function normalizePartnerCorePayload(input = {}, { existingId = "" } = {}) {
  const displayName = safeString(input?.displayName, 120);
  const internalName = safeString(input?.internalName, 120);
  const status = normalizePartnerStatus(
    input?.status,
    normalizeBoolean(input?.isActive, true) ? "active" : "inactive"
  );
  const isActive = status === "active";
  const branches = normalizeBranchList(input?.branches);

  if (!displayName) {
    throw new Error("Partner display name is required.");
  }

  return {
    id: safeString(existingId || input?.id, 140),
    displayName,
    displayNameLower: lower(displayName, 120),
    internalName,
    internalNameLower: lower(internalName, 120),
    agentLabel: displayName,
    status,
    isActive,
    notes: safeParagraph(input?.notes, 2000),
    metadata: input?.metadata && typeof input.metadata === "object" ? input.metadata : {},
    branches,
    branchCount: branches.length,
  };
}

function normalizePartnerCoveragePayload(input = {}, { partnerId = "" } = {}) {
  const supportedTracks = normalizeTrackList(input?.supportedTracks);
  const supportedCountries = normalizeCountryList(input?.supportedCountries);
  const homeCountries = normalizeHomeCountryList(input?.homeCountries);
  const supportedCounties = normalizeCountyList(input?.supportedCounties || []);
  const neighboringCounties = [];
  const coverageCounties = mergeCoverageCounties(supportedCounties);

  if (!partnerId) {
    throw new Error("Missing partner id for coverage.");
  }
  if (!supportedTracks.length) {
    throw new Error("Select at least one supported track.");
  }
  if (!supportedCountries.length) {
    throw new Error("Select at least one supported country.");
  }
  if (!homeCountries.length) {
    throw new Error("Select at least one home country.");
  }
  if (!supportedCounties.length) {
    throw new Error("Select at least one supported county.");
  }

  return {
    id: partnerId,
    partnerId,
    supportedTracks,
    homeCountries,
    homeCountriesLower: homeCountries.map((country) => lower(country, 120)),
    supportedCountries,
    supportedCountriesLower: supportedCountries.map((country) => lower(country, 120)),
    supportedCounties,
    supportedCountiesLower: normalizeCountyLowerList(supportedCounties),
    neighboringCounties,
    neighboringCountiesLower: [],
    coverageCounties,
    coverageCountiesLower: normalizeCountyLowerList(coverageCounties),
    branchCount: normalizeBranchList(input?.branches).length,
    notes: safeParagraph(input?.coverageNotes || input?.notes, 1000),
  };
}

function comparePartners(left, right) {
  const activeGap = Number(Boolean(right?.isActive)) - Number(Boolean(left?.isActive));
  if (activeGap !== 0) return activeGap;
  return safeString(left?.displayName, 120).localeCompare(safeString(right?.displayName, 120));
}

function mergePartnerAndCoverage(id, partnerData = {}, coverageData = {}) {
  const core = normalizePartnerCorePayload({ ...(partnerData || {}), id }, { existingId: id });
  const coverage = normalizePartnerCoveragePayload(
    {
      ...(partnerData || {}),
      ...(coverageData || {}),
      branches:
        Array.isArray(coverageData?.branches) && coverageData.branches.length
          ? coverageData.branches
          : partnerData?.branches,
    },
    { partnerId: safeString(id, 140) }
  );

  return {
    ...core,
    ...coverage,
    createdAt: partnerData?.createdAt || null,
    updatedAt: partnerData?.updatedAt || null,
    createdAtMs:
      Number(partnerData?.createdAtMs || 0) ||
      toTimestampMs(partnerData?.createdAt) ||
      Number(coverageData?.createdAtMs || 0),
    updatedAtMs:
      Number(partnerData?.updatedAtMs || 0) ||
      toTimestampMs(partnerData?.updatedAt) ||
      Number(coverageData?.updatedAtMs || 0) ||
      toTimestampMs(coverageData?.updatedAt),
    coverageUpdatedAt: coverageData?.updatedAt || null,
    coverageUpdatedAtMs:
      Number(coverageData?.updatedAtMs || 0) || toTimestampMs(coverageData?.updatedAt),
    updatedByUid: safeString(partnerData?.updatedByUid || coverageData?.updatedByUid, 140),
    updatedByEmail: safeString(partnerData?.updatedByEmail || coverageData?.updatedByEmail, 180),
  };
}

function safeMergePartnerAndCoverage(id, partnerData = {}, coverageData = {}) {
  const partnerSource = partnerData && typeof partnerData === "object" ? partnerData : {};
  const coverageSource = coverageData && typeof coverageData === "object" ? coverageData : {};

  const displayName = safeString(partnerSource?.displayName, 120);
  if (!displayName) return null;

  try {
    return mergePartnerAndCoverage(id, partnerSource, coverageSource);
  } catch (error) {
    console.warn("partner merge failed:", error?.message || error);
    return {
      id: safeString(id, 140),
      displayName,
      displayNameLower: lower(displayName, 120),
      internalName: safeString(partnerSource?.internalName, 120),
      internalNameLower: lower(partnerSource?.internalName, 120),
      agentLabel: displayName,
      status: normalizePartnerStatus(partnerSource?.status, partnerSource?.isActive === false ? "inactive" : "active"),
      isActive: normalizePartnerStatus(
        partnerSource?.status,
        partnerSource?.isActive === false ? "inactive" : "active"
      ) === "active",
      notes: safeParagraph(partnerSource?.notes, 2000),
      metadata: partnerSource?.metadata && typeof partnerSource.metadata === "object" ? partnerSource.metadata : {},
      branches: normalizeBranchList(partnerSource?.branches),
      branchCount: normalizeBranchList(partnerSource?.branches).length,
      supportedTracks: normalizeTrackList(coverageSource?.supportedTracks || partnerSource?.supportedTracks),
      homeCountries: normalizeHomeCountryList(
        coverageSource?.homeCountries || partnerSource?.homeCountries
      ),
      homeCountriesLower: normalizeHomeCountryList(
        coverageSource?.homeCountries || partnerSource?.homeCountries
      ).map((country) => lower(country, 120)),
      supportedCountries: normalizeCountryList(
        coverageSource?.supportedCountries || partnerSource?.supportedCountries
      ),
      supportedCountriesLower: normalizeCountryList(
        coverageSource?.supportedCountries || partnerSource?.supportedCountries
      ).map((country) => lower(country, 120)),
      supportedCounties: normalizeCountyList(
        coverageSource?.supportedCounties || partnerSource?.supportedCounties || []
      ),
      supportedCountiesLower: normalizeCountyLowerList(
        coverageSource?.supportedCounties || partnerSource?.supportedCounties || []
      ),
      neighboringCounties: [],
      neighboringCountiesLower: [],
      coverageCounties: mergeCoverageCounties(
        coverageSource?.supportedCounties || partnerSource?.supportedCounties || []
      ),
      coverageCountiesLower: normalizeCountyLowerList(
        mergeCoverageCounties(
          coverageSource?.supportedCounties || partnerSource?.supportedCounties || []
        )
      ),
      createdAt: partnerSource?.createdAt || null,
      updatedAt: partnerSource?.updatedAt || null,
      createdAtMs: Number(partnerSource?.createdAtMs || 0) || toTimestampMs(partnerSource?.createdAt),
      updatedAtMs: Number(partnerSource?.updatedAtMs || 0) || toTimestampMs(partnerSource?.updatedAt),
      coverageUpdatedAt: coverageSource?.updatedAt || null,
      coverageUpdatedAtMs:
        Number(coverageSource?.updatedAtMs || 0) || toTimestampMs(coverageSource?.updatedAt),
      updatedByUid: safeString(partnerSource?.updatedByUid || coverageSource?.updatedByUid, 140),
      updatedByEmail: safeString(partnerSource?.updatedByEmail || coverageSource?.updatedByEmail, 180),
    };
  }
}

async function requireSuperAdminActor() {
  const uid = safeString(auth.currentUser?.uid, 120);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only Super Admin can manage partnerships.");
  }
  return roleCtx;
}

async function ensureUniquePartnerName({ partnerId = "", displayName = "", internalName = "" } = {}) {
  const safeId = safeString(partnerId, 140);
  const displayLower = lower(displayName, 120);
  const internalLower = lower(internalName, 120);
  const snap = await getDocs(collection(db, PARTNERS_COLLECTION));
  const duplicate = snap.docs.find((row) => {
    const data = row.data() || {};
    if (row.id === safeId) return false;
    const sameDisplay = displayLower && lower(data?.displayName, 120) === displayLower;
    const sameInternal = internalLower && lower(data?.internalName, 120) === internalLower;
    return sameDisplay || sameInternal;
  });
  if (duplicate) {
    throw new Error("A partner with this display or internal name already exists.");
  }
}

async function loadPartnerMaps({ max = 250, activeOnly = false } = {}) {
  const maxRows = Math.max(1, Math.min(400, Number(max) || 250));
  const partnersQuery = activeOnly
    ? query(collection(db, PARTNERS_COLLECTION), where("isActive", "==", true), limit(maxRows))
    : query(collection(db, PARTNERS_COLLECTION), limit(maxRows));
  const coverageQuery = query(collection(db, PARTNER_COVERAGE_COLLECTION), limit(maxRows));

  const [partnerSnap, coverageSnap] = await Promise.all([
    getDocs(partnersQuery),
    getDocs(coverageQuery),
  ]);

  const coverageMap = new Map();
  coverageSnap.docs.forEach((row) => {
    coverageMap.set(String(row.id), row.data() || {});
  });

  const partners = partnerSnap.docs
    .map((row) => safeMergePartnerAndCoverage(row.id, row.data() || {}, coverageMap.get(row.id)))
    .filter(Boolean)
    .sort(comparePartners);

  return partners;
}

export function createEmptyPartnerDraft() {
  return {
    displayName: "",
    internalName: "",
    status: "active",
    notes: "",
    supportedTracks: [],
    homeCountries: [],
    supportedCountries: [],
    supportedCounties: [],
    neighboringCounties: [],
    branches: [],
    metadata: {},
  };
}

export function draftFromPartner(partner) {
  const clean = partner && typeof partner === "object" ? partner : {};
  return {
    displayName: safeString(clean?.displayName, 120),
    internalName: safeString(clean?.internalName, 120),
    status: normalizePartnerStatus(clean?.status, clean?.isActive === false ? "inactive" : "active"),
    notes: safeParagraph(clean?.notes, 2000),
    supportedTracks: normalizeTrackList(clean?.supportedTracks),
    homeCountries: normalizeHomeCountryList(clean?.homeCountries),
    supportedCountries: normalizeCountryList(clean?.supportedCountries),
    supportedCounties: normalizeCountyList(clean?.supportedCounties || []),
    neighboringCounties: [],
    branches: normalizeBranchList(clean?.branches),
    metadata: clean?.metadata && typeof clean.metadata === "object" ? clean.metadata : {},
  };
}

export async function listPartners({ activeOnly = false, max = 250 } = {}) {
  return loadPartnerMaps({ activeOnly, max });
}

export async function fetchPartnerById(partnerId = "") {
  const safeId = safeString(partnerId, 140);
  if (!safeId) return null;
  const [partnerSnap, coverageSnap] = await Promise.all([
    getDoc(doc(db, PARTNERS_COLLECTION, safeId)),
    getDoc(doc(db, PARTNER_COVERAGE_COLLECTION, safeId)),
  ]);
  if (!partnerSnap.exists()) return null;
  return safeMergePartnerAndCoverage(
    safeId,
    partnerSnap.data() || {},
    coverageSnap.exists() ? coverageSnap.data() || {} : {}
  );
}

export function evaluatePartnerRequestCompatibility(
  partner,
  {
    trackType = "",
    country = "",
    county = "",
    countryOfResidence = "",
    filterMode = PARTNER_FILTER_MODES.DESTINATION_COUNTRY,
  } = {}
) {
  const safePartner = partner && typeof partner === "object" ? partner : {};
  const safeFilterMode = normalizePartnerFilterMode(filterMode);
  const safeTrack = normalizeTrackValue(trackType);
  const safeCountry = normalizeCountryValue(country);
  const safeCountryLower = lower(safeCountry, 120);
  const safeResidenceCountry = safeString(countryOfResidence, 120);
  const safeResidenceLower = lower(safeResidenceCountry, 120);

  const supportedTracks = normalizeTrackList(safePartner?.supportedTracks);
  const homeCountries = normalizeHomeCountryList(safePartner?.homeCountries);
  const homeCountriesLower = homeCountries.map((value) => lower(value, 120));
  const supportedCountries = normalizeCountryList(safePartner?.supportedCountries);
  const supportedCountriesLower = supportedCountries.map((value) => lower(value, 120));
  const partnerActive =
    normalizePartnerStatus(safePartner?.status, safePartner?.isActive === false ? "inactive" : "active") ===
    "active";

  const trackOk = Boolean(safeTrack) && supportedTracks.includes(safeTrack);
  const residenceHomeCountryOk = Boolean(safeResidenceLower) && homeCountriesLower.includes(safeResidenceLower);
  const targetCoverageOk = Boolean(safeCountryLower) && supportedCountriesLower.includes(safeCountryLower);
  const usesHomeCountryFilter = safeFilterMode === PARTNER_FILTER_MODES.HOME_COUNTRY;
  const homeCountryOk = residenceHomeCountryOk;
  const countryOk = usesHomeCountryFilter
    ? true
    : targetCoverageOk;
  const hasResidenceCountry = Boolean(safeResidenceLower);
  const hasDestinationCountry = Boolean(safeCountryLower);

  const reasons = [];
  if (!partnerActive) reasons.push("partner_inactive");
  if (!safeTrack || !trackOk) reasons.push("track_not_supported");
  if (hasResidenceCountry && !homeCountryOk) {
    reasons.push("home_country_not_supported");
  }
  if (!usesHomeCountryFilter && hasDestinationCountry && !countryOk) {
    reasons.push("country_not_supported");
  }

  return {
    partnerId: safeString(safePartner?.id, 140),
    partnerName: safeString(safePartner?.displayName, 120),
    eligible: reasons.length === 0,
    reasons,
    countyMatchType: "",
    matches: {
      active: partnerActive,
      track: trackOk,
      filterMode: safeFilterMode,
      homeCountry: homeCountryOk,
      country: countryOk,
      county: true,
      countyDirect: false,
      countyNeighbor: false,
    },
  };
}

export function preferredAgentReasonLabel(reason) {
  const safeReason = safeString(reason, 80).toLowerCase();
  if (safeReason === "partner_inactive") return "Selected agent is inactive.";
  if (safeReason === "track_not_supported") return "Selected agent does not support this track.";
  if (safeReason === "home_country_not_supported") {
    return "Selected agent does not support your home country.";
  }
  if (safeReason === "country_not_supported") return "Selected agent does not support this country.";
  if (safeReason === "county_not_supported") return "Selected agent does not support this county.";
  if (safeReason === "partner_not_found") return "Selected agent was not found.";
  return "Selected agent is not valid for this request.";
}

export async function validatePreferredAgentSelection({
  partnerId = "",
  trackType = "",
  country = "",
  county = "",
  countryOfResidence = "",
  filterMode = PARTNER_FILTER_MODES.DESTINATION_COUNTRY,
} = {}) {
  const safePartnerId = safeString(partnerId, 140);
  if (!safePartnerId) {
    return {
      valid: false,
      reason: "partner_not_found",
      partner: null,
    };
  }

  const partner = await fetchPartnerById(safePartnerId);
  if (!partner) {
    return {
      valid: false,
      reason: "partner_not_found",
      partner: null,
    };
  }

  const result = evaluatePartnerRequestCompatibility(partner, {
    trackType,
    country,
    county,
    countryOfResidence,
    filterMode,
  });

  return {
    valid: Boolean(result?.eligible),
    reason: result?.eligible ? "" : safeString(result?.reasons?.[0], 80) || "partner_invalid",
    details: result,
    partner,
  };
}

export async function listEligiblePreferredAgents({
  trackType = "",
  country = "",
  county = "",
  countryOfResidence = "",
  filterMode = PARTNER_FILTER_MODES.DESTINATION_COUNTRY,
  max = 250,
} = {}) {
  const safeFilterMode = normalizePartnerFilterMode(filterMode);
  const partners = await listPartners({ activeOnly: true, max });
  return partners
    .map((partner) => ({
      partner,
      compatibility: evaluatePartnerRequestCompatibility(partner, {
        trackType,
        country,
        county,
        countryOfResidence,
        filterMode: safeFilterMode,
      }),
    }))
    .filter((row) => row.compatibility?.eligible)
    .sort((a, b) => {
      const aWeight = a.compatibility?.countyMatchType === "direct" ? 1 : 0;
      const bWeight = b.compatibility?.countyMatchType === "direct" ? 1 : 0;
      if (bWeight !== aWeight) return bWeight - aWeight;
      return safeString(a.partner?.displayName, 120).localeCompare(
        safeString(b.partner?.displayName, 120)
      );
    })
    .map((row) => ({
      id: row.partner.id,
      displayName: row.partner.displayName,
      agentLabel: row.partner.agentLabel || row.partner.displayName,
      displayLabel: row.partner.displayName,
      homeCountries: row.partner.homeCountries || [],
      countyMatchType: row.compatibility?.countyMatchType || "",
      partner: row.partner,
      compatibility: row.compatibility,
    }));
}

export async function createPartner(input = {}) {
  await requireSuperAdminActor();

  const ref = doc(collection(db, PARTNERS_COLLECTION));
  const corePayload = normalizePartnerCorePayload(input, { existingId: ref.id });
  const coveragePayload = normalizePartnerCoveragePayload(
    {
      ...input,
      branches: corePayload.branches,
      notes: safeParagraph(input?.notes, 2000),
    },
    { partnerId: ref.id }
  );

  await ensureUniquePartnerName({
    displayName: corePayload.displayName,
    internalName: corePayload.internalName,
  });

  const nowMs = Date.now();
  const actorUid = safeString(auth.currentUser?.uid, 120);
  const actorEmail = safeString(auth.currentUser?.email, 160);

  await Promise.all([
    setDoc(ref, {
      ...corePayload,
      supportedTracks: coveragePayload.supportedTracks,
      homeCountries: coveragePayload.homeCountries,
      supportedCountries: coveragePayload.supportedCountries,
      supportedCounties: coveragePayload.supportedCounties,
      neighboringCounties: coveragePayload.neighboringCounties,
      coverageCounties: coveragePayload.coverageCounties,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedByUid: actorUid,
      updatedByEmail: actorEmail,
    }),
    setDoc(doc(db, PARTNER_COVERAGE_COLLECTION, ref.id), {
      ...coveragePayload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedByUid: actorUid,
      updatedByEmail: actorEmail,
    }),
  ]);

  return ref.id;
}

export async function updatePartner(partnerId, input = {}) {
  await requireSuperAdminActor();

  const safeId = safeString(partnerId, 140);
  if (!safeId) throw new Error("Missing partner id.");

  const corePayload = normalizePartnerCorePayload(input, { existingId: safeId });
  const coveragePayload = normalizePartnerCoveragePayload(
    {
      ...input,
      branches: corePayload.branches,
      notes: safeParagraph(input?.notes, 2000),
    },
    { partnerId: safeId }
  );

  await ensureUniquePartnerName({
    partnerId: safeId,
    displayName: corePayload.displayName,
    internalName: corePayload.internalName,
  });

  const nowMs = Date.now();
  const actorUid = safeString(auth.currentUser?.uid, 120);
  const actorEmail = safeString(auth.currentUser?.email, 160);

  await Promise.all([
    setDoc(
      doc(db, PARTNERS_COLLECTION, safeId),
      {
        ...corePayload,
        supportedTracks: coveragePayload.supportedTracks,
        homeCountries: coveragePayload.homeCountries,
        supportedCountries: coveragePayload.supportedCountries,
        supportedCounties: coveragePayload.supportedCounties,
        neighboringCounties: coveragePayload.neighboringCounties,
        coverageCounties: coveragePayload.coverageCounties,
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs,
        updatedByUid: actorUid,
        updatedByEmail: actorEmail,
      },
      { merge: true }
    ),
    setDoc(
      doc(db, PARTNER_COVERAGE_COLLECTION, safeId),
      {
        ...coveragePayload,
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs,
        updatedByUid: actorUid,
        updatedByEmail: actorEmail,
      },
      { merge: true }
    ),
  ]);
}

export async function setPartnerActiveState(partnerId, isActive) {
  await requireSuperAdminActor();

  const safeId = safeString(partnerId, 140);
  if (!safeId) throw new Error("Missing partner id.");
  const nextStatus = normalizeBoolean(isActive, true) ? "active" : "inactive";
  const actorUid = safeString(auth.currentUser?.uid, 120);
  const actorEmail = safeString(auth.currentUser?.email, 160);
  const nowMs = Date.now();

  await Promise.all([
    updateDoc(doc(db, PARTNERS_COLLECTION, safeId), {
      isActive: normalizeBoolean(isActive, true),
      status: nextStatus,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
      updatedByUid: actorUid,
      updatedByEmail: actorEmail,
    }),
    setDoc(
      doc(db, PARTNER_COVERAGE_COLLECTION, safeId),
      {
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs,
        updatedByUid: actorUid,
        updatedByEmail: actorEmail,
      },
      { merge: true }
    ),
  ]);
}

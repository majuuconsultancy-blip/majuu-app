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

function roundRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
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

function normalizeBranchPayoutDestination(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const typeRaw = lower(source?.type, 40);
  const type = typeRaw === "mpesa" ? "mpesa" : typeRaw === "other" ? "other" : "bank_transfer";
  const mpesaModeRaw = lower(
    source?.mpesaMode || source?.mode || (safeString(source?.paybillNumber || source?.businessNumber) ? "paybill" : "till"),
    20
  );
  const mpesaMode = mpesaModeRaw === "paybill" ? "paybill" : "till";
  const bankName = safeString(source?.bankName, 120);
  const bankBranchName = safeString(source?.bankBranchName || source?.branchName, 120);
  const accountName = safeString(source?.accountName, 120);
  const accountNumber = safeString(source?.accountNumber || source?.accountNo, 80);
  const accountNumberLast4 = safeString(
    source?.accountNumberLast4 || source?.accountLast4 || accountNumber,
    12
  ).slice(-4);
  const phoneNumber = safeString(source?.phoneNumber || source?.msisdn, 40);
  const shortCode = safeString(
    source?.shortCode || source?.paybillNumber || source?.businessNumber,
    80
  );
  const tillNumber = safeString(source?.tillNumber, 80);
  const paybillNumber = safeString(source?.paybillNumber || source?.businessNumber, 80);
  const paybillAccountNumber = safeString(
    source?.paybillAccountNumber || source?.accountReference || source?.accountNumber,
    120
  );
  const reference = safeString(source?.reference || source?.destinationReference, 160);
  const otherLabel = safeString(source?.otherLabel || source?.providerName, 120);
  const destinationDetails = safeString(
    source?.destinationDetails || source?.details || source?.accountDetails,
    280
  );
  const hasAny = Boolean(
    bankName ||
      bankBranchName ||
      accountName ||
      accountNumber ||
      accountNumberLast4 ||
      phoneNumber ||
      shortCode ||
      tillNumber ||
      paybillNumber ||
      paybillAccountNumber ||
      reference ||
      otherLabel ||
      destinationDetails
  );
  return hasAny
    ? {
        type,
        mpesaMode,
        bankName,
        bankBranchName,
        accountName,
        accountNumber,
        accountNumberLast4,
        phoneNumber,
        shortCode,
        tillNumber,
        paybillNumber,
        businessNumber: paybillNumber,
        paybillAccountNumber,
        reference,
        otherLabel,
        destinationDetails,
      }
    : null;
}

function normalizeBranchPayoutMetadata(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  Object.entries(input).forEach(([key, value]) => {
    const safeKey = safeString(key, 80);
    if (!safeKey) return;
    out[safeKey] = safeString(value, 400);
  });
  return out;
}

function normalizeBranchFinancialStatus(value, fallback = "active") {
  return lower(value, 40) === "inactive" ? "inactive" : fallback === "inactive" ? "inactive" : "active";
}

function normalizeBranchPlatformCutType(value, fallback = "percentage") {
  const safe = lower(value, 40);
  return safe === "flat" ? "flat" : fallback === "flat" ? "flat" : "percentage";
}

function normalizeBranchPlatformCutBase(value, fallback = "official_plus_service_fee") {
  const safe = lower(value, 60);
  return safe === "official_amount"
    ? "official_amount"
    : fallback === "official_amount"
    ? "official_amount"
    : "official_plus_service_fee";
}

function normalizeBranchReleaseBehavior(value, fallback = "manual_review") {
  const safe = lower(value, 60);
  if (safe === "auto_release" || safe === "auto") return "auto_release";
  if (safe === "manual_review" || safe === "manual") return "manual_review";
  return fallback === "auto_release" ? "auto_release" : "manual_review";
}

function normalizeBranchFinancialSettings(input = {}, { payoutDestination = null } = {}) {
  const source = input && typeof input === "object" ? input : {};
  const activeFinancialStatus = normalizeBranchFinancialStatus(
    source?.activeFinancialStatus || source?.financialStatus,
    "active"
  );
  const platformCutType = normalizeBranchPlatformCutType(
    source?.platformCutType || source?.defaultPlatformCutType,
    "percentage"
  );
  const platformCutValue = roundRate(
    source?.platformCutValue ?? source?.defaultPlatformCutValue ?? 10
  );
  const platformCutBase = normalizeBranchPlatformCutBase(
    source?.platformCutBase,
    "official_plus_service_fee"
  );
  const releaseBehaviorOverride = normalizeBranchReleaseBehavior(
    source?.releaseBehaviorOverride || source?.payoutReleaseBehavior,
    "manual_review"
  );
  const payoutDestinationReady =
    typeof source?.payoutDestinationReady === "boolean"
      ? source.payoutDestinationReady
      : Boolean(payoutDestination);
  return {
    activeFinancialStatus,
    financialStatus: activeFinancialStatus,
    platformCutType,
    platformCutValue,
    defaultPlatformCutType: platformCutType,
    defaultPlatformCutValue: platformCutValue,
    platformCutBase,
    releaseBehaviorOverride,
    payoutReleaseBehavior: releaseBehaviorOverride,
    payoutDestinationReady,
  };
}

function mergeBranchCoverage(primaryCounty = "", neighboringCounties = []) {
  return normalizeCountyList([primaryCounty, ...(neighboringCounties || [])]);
}

function normalizeBranchRecord(raw = {}, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const country = normalizeCountryValue(source?.country);
  const branchId = safeString(source?.branchId || source?.id, 80) || createLocalId(`branch_${index + 1}`);
  const branchName = safeString(source?.branchName || source?.name, 120);
  const primaryCounty = normalizeCountyList([source?.primaryCounty || source?.county || ""])[0] || "";
  const neighboringCounties = normalizeCountyList(
    source?.neighboringCounties ||
      source?.neighboring ||
      source?.coverageCounties
  ).filter((county) => county !== primaryCounty);
  const coverageCounties = mergeBranchCoverage(primaryCounty, neighboringCounties);
  const physicalTown = safeString(source?.physicalTown || source?.town || source?.city, 120);
  const active =
    source?.active === false
      ? false
      : source?.isActive === false
      ? false
      : normalizeBoolean(source?.active, normalizeBoolean(source?.isActive, true));
  const payoutDestination = normalizeBranchPayoutDestination(
    source?.payoutDestination && typeof source.payoutDestination === "object"
      ? source.payoutDestination
      : source?.payoutDetails
  );
  const payoutMetadata = normalizeBranchPayoutMetadata(
    source?.payoutMetadata && typeof source.payoutMetadata === "object"
      ? source.payoutMetadata
      : source?.metadata
  );
  const financial = normalizeBranchFinancialSettings(
    source?.financial && typeof source.financial === "object"
      ? source.financial
      : source,
    { payoutDestination }
  );
  return {
    branchId,
    id: branchId, // legacy alias
    branchName,
    name: branchName, // legacy alias
    country,
    countryLower: lower(country, 120),
    primaryCounty,
    county: primaryCounty, // legacy alias
    primaryCountyLower: lower(primaryCounty, 120),
    countyLower: lower(primaryCounty, 120), // legacy alias
    neighboringCounties,
    neighboringCountiesLower: normalizeCountyLowerList(neighboringCounties),
    coverageCounties,
    coverageCountiesLower: normalizeCountyLowerList(coverageCounties),
    physicalTown,
    town: physicalTown, // legacy alias
    city: physicalTown,
    address: safeParagraph(source?.address, 240),
    payoutDestination,
    payoutMetadata,
    payoutDestinationLabel:
      safeString(
        source?.payoutDestinationLabel ||
          source?.payoutLabel ||
          source?.payoutDestination?.reference ||
          payoutDestination?.reference,
        160
      ) || "",
    financial,
    activeFinancialStatus: financial.activeFinancialStatus,
    financialStatus: financial.financialStatus,
    platformCutType: financial.platformCutType,
    platformCutValue: financial.platformCutValue,
    platformCutBase: financial.platformCutBase,
    releaseBehaviorOverride: financial.releaseBehaviorOverride,
    payoutReleaseBehavior: financial.payoutReleaseBehavior,
    payoutDestinationReady: financial.payoutDestinationReady,
    active,
    isActive: active, // legacy alias
    notes: safeParagraph(source?.notes, 240),
  };
}

function normalizeBranchList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  value.forEach((branch, index) => {
    const clean = normalizeBranchRecord(branch, index);
    const key = lower(clean.branchId || clean.id, 80);
    if (!clean.branchName || !key || seen.has(key)) return;
    seen.add(key);
    rows.push(clean);
  });
  return rows.slice(0, 50);
}

function deriveBranchCoverage(branches = [], { activeOnly = true } = {}) {
  const rows = normalizeBranchList(branches);
  const filtered = activeOnly
    ? rows.filter((branch) => branch?.active !== false && branch?.isActive !== false)
    : rows;
  const primaryCounties = normalizeCountyList(filtered.map((branch) => branch.primaryCounty || branch.county));
  const neighboringCounties = normalizeCountyList(
    filtered.flatMap((branch) =>
      Array.isArray(branch?.neighboringCounties) ? branch.neighboringCounties : []
    )
  );
  const coverageCounties = mergeCoverageCounties([...primaryCounties, ...neighboringCounties]);
  return {
    branches: filtered,
    primaryCounties,
    neighboringCounties,
    coverageCounties,
  };
}

export function deriveOperationalBranchCoverage(source, { activeOnly = true } = {}) {
  const branches = Array.isArray(source) ? source : source?.branches;
  return deriveBranchCoverage(branches, { activeOnly });
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

function normalizePartnerCoveragePayload(
  input = {},
  { partnerId = "", strictBranchCountryFromHome = false } = {}
) {
  const branches = normalizeBranchList(input?.branches);
  const branchCoverage = deriveBranchCoverage(branches, { activeOnly: true });
  const supportedTracks = normalizeTrackList(input?.supportedTracks);
  const supportedCountries = normalizeCountryList(input?.supportedCountries);
  const homeCountries = normalizeHomeCountryList(input?.homeCountries);
  const legacySupportedCounties = normalizeCountyList(input?.supportedCounties || []);
  const supportedCounties = branchCoverage.coverageCounties.length
    ? mergeCoverageCounties([...branchCoverage.coverageCounties, ...legacySupportedCounties])
    : legacySupportedCounties;
  const neighboringCounties = branchCoverage.neighboringCounties.length
    ? branchCoverage.neighboringCounties
    : normalizeCountyList(input?.neighboringCounties || []);
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
  if (strictBranchCountryFromHome) {
    const homeCountryLowerSet = new Set(homeCountries.map((country) => lower(country, 120)));
    const invalidBranch = branches.find((branch) => {
      const branchCountry = safeString(branch?.country, 120);
      return branchCountry && !homeCountryLowerSet.has(lower(branchCountry, 120));
    });
    if (invalidBranch) {
      throw new Error(
        `Branch '${safeString(invalidBranch?.branchName || invalidBranch?.name || invalidBranch?.branchId, 120)}' country must be selected from Home Countries.`
      );
    }
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
    neighboringCountiesLower: normalizeCountyLowerList(neighboringCounties),
    coverageCounties,
    coverageCountiesLower: normalizeCountyLowerList(coverageCounties),
    branchCoverageCounties: branchCoverage.coverageCounties,
    branchCoverageCountiesLower: normalizeCountyLowerList(branchCoverage.coverageCounties),
    branchPrimaryCounties: branchCoverage.primaryCounties,
    branchPrimaryCountiesLower: normalizeCountyLowerList(branchCoverage.primaryCounties),
    branchNeighboringCounties: branchCoverage.neighboringCounties,
    branchNeighboringCountiesLower: normalizeCountyLowerList(branchCoverage.neighboringCounties),
    branchCount: branches.length,
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
    const branches = normalizeBranchList(partnerSource?.branches || coverageSource?.branches);
    const branchCoverage = deriveBranchCoverage(branches, { activeOnly: true });
    const baseSupportedCounties = normalizeCountyList(
      coverageSource?.supportedCounties || partnerSource?.supportedCounties || []
    );
    const supportedCounties = branchCoverage.coverageCounties.length
      ? mergeCoverageCounties([...branchCoverage.coverageCounties, ...baseSupportedCounties])
      : baseSupportedCounties;
    const neighboringCounties = branchCoverage.neighboringCounties.length
      ? branchCoverage.neighboringCounties
      : normalizeCountyList(coverageSource?.neighboringCounties || partnerSource?.neighboringCounties || []);
    const coverageCounties = mergeCoverageCounties(supportedCounties);
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
      branches,
      branchCount: branches.length,
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
      supportedCounties,
      supportedCountiesLower: normalizeCountyLowerList(supportedCounties),
      neighboringCounties,
      neighboringCountiesLower: normalizeCountyLowerList(neighboringCounties),
      coverageCounties,
      coverageCountiesLower: normalizeCountyLowerList(coverageCounties),
      branchCoverageCounties: branchCoverage.coverageCounties,
      branchCoverageCountiesLower: normalizeCountyLowerList(branchCoverage.coverageCounties),
      branchPrimaryCounties: branchCoverage.primaryCounties,
      branchPrimaryCountiesLower: normalizeCountyLowerList(branchCoverage.primaryCounties),
      branchNeighboringCounties: branchCoverage.neighboringCounties,
      branchNeighboringCountiesLower: normalizeCountyLowerList(branchCoverage.neighboringCounties),
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
    neighboringCounties: [], // legacy top-level fallback
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
    eligiblePartnerIds = [],
  } = {}
) {
  const safePartner = partner && typeof partner === "object" ? partner : {};
  const safeFilterMode = normalizePartnerFilterMode(filterMode);
  const safeTrack = normalizeTrackValue(trackType);
  const safeCountry = normalizeCountryValue(country);
  const safeCountryLower = lower(safeCountry, 120);
  const safeCounty = safeString(county, 120);
  const safeCountyLower = lower(safeCounty, 120);
  const safeResidenceCountry = safeString(countryOfResidence, 120);
  const safeResidenceLower = lower(safeResidenceCountry, 120);

  const supportedTracks = normalizeTrackList(safePartner?.supportedTracks);
  const homeCountries = normalizeHomeCountryList(safePartner?.homeCountries);
  const homeCountriesLower = homeCountries.map((value) => lower(value, 120));
  const supportedCountries = normalizeCountryList(safePartner?.supportedCountries);
  const supportedCountriesLower = supportedCountries.map((value) => lower(value, 120));
  const branches = normalizeBranchList(safePartner?.branches);
  const activeBranchCoverage = deriveBranchCoverage(branches, { activeOnly: true });
  const branchPrimaryLower = normalizeCountyLowerList(activeBranchCoverage.primaryCounties);
  const branchNeighborLower = normalizeCountyLowerList(activeBranchCoverage.neighboringCounties);
  const supportedCounties = normalizeCountyList(
    activeBranchCoverage.coverageCounties.length
      ? [...activeBranchCoverage.coverageCounties, ...(safePartner?.supportedCounties || [])]
      : safePartner?.coverageCounties || safePartner?.supportedCounties || []
  );
  const supportedCountiesLower = normalizeCountyLowerList(supportedCounties);
  const partnerActive =
    normalizePartnerStatus(safePartner?.status, safePartner?.isActive === false ? "inactive" : "active") ===
    "active";
  const safePartnerId = safeString(safePartner?.id, 140);
  const eligiblePartnerSet = new Set(
    (Array.isArray(eligiblePartnerIds) ? eligiblePartnerIds : [])
      .map((value) => safeString(value, 140).toLowerCase())
      .filter(Boolean)
  );
  const requestTypeAllowed =
    eligiblePartnerSet.size === 0 || eligiblePartnerSet.has(safePartnerId.toLowerCase());

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
  const hasCounty = Boolean(safeCountyLower);
  const countyDirectOk = hasCounty && (
    branchPrimaryLower.includes(safeCountyLower) ||
    (!branchPrimaryLower.length && supportedCountiesLower.includes(safeCountyLower))
  );
  const countyNeighborOk = hasCounty && (
    branchNeighborLower.includes(safeCountyLower) ||
    (!branchPrimaryLower.length && !countyDirectOk && supportedCountiesLower.includes(safeCountyLower))
  );
  const countyOk = hasCounty ? countyDirectOk || countyNeighborOk : true;

  const reasons = [];
  if (!partnerActive) reasons.push("partner_inactive");
  if (!requestTypeAllowed) reasons.push("request_type_not_allowed");
  if (!safeTrack || !trackOk) reasons.push("track_not_supported");
  if (hasResidenceCountry && !homeCountryOk) {
    reasons.push("home_country_not_supported");
  }
  if (!usesHomeCountryFilter && hasDestinationCountry && !countryOk) {
    reasons.push("country_not_supported");
  }
  if (hasCounty && !countyOk) {
    reasons.push("county_not_supported");
  }

  return {
    partnerId: safeString(safePartner?.id, 140),
    partnerName: safeString(safePartner?.displayName, 120),
    eligible: reasons.length === 0,
    reasons,
    countyMatchType: countyDirectOk ? "direct" : countyNeighborOk ? "neighboring" : "",
    matches: {
      active: partnerActive,
      requestTypeAllowed,
      track: trackOk,
      filterMode: safeFilterMode,
      homeCountry: homeCountryOk,
      country: countryOk,
      county: countyOk,
      countyDirect: countyDirectOk,
      countyNeighbor: countyNeighborOk,
      hasCounty,
      supportedCounties,
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
  if (safeReason === "request_type_not_allowed") {
    return "Selected agent is not eligible for this request type.";
  }
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
  eligiblePartnerIds = [],
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
    eligiblePartnerIds,
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
  eligiblePartnerIds = [],
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
        eligiblePartnerIds,
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
    { partnerId: ref.id, strictBranchCountryFromHome: true }
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
    { partnerId: safeId, strictBranchCountryFromHome: true }
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

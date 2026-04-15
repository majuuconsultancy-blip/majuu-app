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
import { auth, db } from "../firebase";
import {
  getCurrentUserRoleContext,
  normalizeAdminAvailability,
  normalizeAdminScope,
} from "./adminroleservice";
import {
  normalizeCountyList,
  normalizeCountyLowerList,
} from "../constants/kenyaCounties";
import {
  deriveOperationalBranchCoverage,
  fetchPartnerById,
} from "./partnershipService";
import {
  getSingleAssignedBranchId,
  normalizeSingleAssignedBranchIds,
} from "./assignedAdminBranchBinding";

const ASSIGNED_ADMIN_ROLE_VARIANTS = [
  "assignedAdmin",
  "assignedadmin",
  "assigned_admin",
  "admin",
];

function safeStr(value) {
  return String(value || "").trim();
}

function normalizeEmail(email) {
  return safeStr(email).toLowerCase();
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanos = Number(value?.nanoseconds || 0);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6);
  }
  return 0;
}

function pickPrimaryDoc(rows = []) {
  const sorted = [...rows].sort((a, b) => {
    const aUpdated = toTimestampMs(a?.updatedAt);
    const bUpdated = toTimestampMs(b?.updatedAt);
    if (bUpdated !== aUpdated) return bUpdated - aUpdated;

    const aCreated = toTimestampMs(a?.createdAt);
    const bCreated = toTimestampMs(b?.createdAt);
    if (bCreated !== aCreated) return bCreated - aCreated;

    return safeStr(a?.uid).localeCompare(safeStr(b?.uid));
  });
  return sorted[0] || null;
}

function dedupeByEmail(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const key = normalizeEmail(row?.email);
    if (!key) return;
    const current = map.get(key);
    if (!current) {
      map.set(key, row);
      return;
    }
    const winner = pickPrimaryDoc([current, row]);
    map.set(key, winner || current);
  });
  return Array.from(map.values());
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function defaultAdminScopePayload() {
  return {
    partnerId: "",
    partnerName: "",
    partnerStatus: "inactive",
    stationedCountry: "",
    stationedCountryLower: "",
    country: "",
    countryLower: "",
    countries: [],
    countriesLower: [],
    primaryCounty: "",
    primaryCountyLower: "",
    neighboringCounties: [],
    neighboringCountiesLower: [],
    counties: [],
    countiesLower: [],
    assignedBranchId: "",
    assignedBranchIds: [],
    assignedBranches: [],
    coverageSource: "legacy_manual",
    derivedCoverage: {
      source: "legacy_manual",
      primaryCounty: "",
      primaryCountyLower: "",
      neighboringCounties: [],
      neighboringCountiesLower: [],
      counties: [],
      countiesLower: [],
      countries: [],
      countriesLower: [],
    },
    town: "",
    availability: "active",
    active: true,
    maxActiveRequests: 12,
  };
}

function buildCoverageCountySet(primaryCounty = "", neighboringCounties = []) {
  return normalizeCountyList([primaryCounty, ...(neighboringCounties || [])]);
}

function normalizeCountryList(values = []) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const clean = safeStr(value).slice(0, 120);
    const key = clean.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function normalizeBranchIdList(values) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const id = safeStr(value);
    const key = id.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(id);
  });
  return out.slice(0, 50);
}

function resolveBranchCoverageSelection(partner, branchIds = []) {
  const safePartner = partner && typeof partner === "object" ? partner : null;
  const requestedBranchIds = normalizeSingleAssignedBranchIds(
    normalizeBranchIdList(branchIds)
  );
  const allBranches = deriveOperationalBranchCoverage(safePartner, { activeOnly: false }).branches || [];
  const branchMap = new Map(
    allBranches.map((branch) => [safeStr(branch?.branchId || branch?.id).toLowerCase(), branch])
  );

  const selectedBranches = requestedBranchIds
    .map((branchId) => branchMap.get(branchId.toLowerCase()) || null)
    .filter(Boolean)
    .filter((branch) => branch?.active !== false && branch?.isActive !== false);

  if (requestedBranchIds.length && selectedBranches.length === 0) {
    throw new Error("Selected branches are inactive or unavailable for this partner.");
  }

  const selectedCoverage = deriveOperationalBranchCoverage(selectedBranches, { activeOnly: true });
  const firstPrimary =
    selectedBranches.find((branch) => safeStr(branch?.primaryCounty || branch?.county))?.primaryCounty ||
    selectedBranches.find((branch) => safeStr(branch?.primaryCounty || branch?.county))?.county ||
    "";
  const coverageCounties = normalizeCountyList(selectedCoverage?.coverageCounties || []);
  const primaryCounty = normalizeCountyList([firstPrimary || coverageCounties[0] || ""])[0] || "";
  const neighboringCounties = normalizeCountyList(coverageCounties).filter(
    (county) => county !== primaryCounty
  );

  return {
    requestedBranchIds,
    selectedBranches,
    selectedBranchIds: selectedBranches.map((branch) => safeStr(branch?.branchId || branch?.id)).filter(Boolean),
    countries: normalizeCountryList(selectedBranches.map((branch) => branch?.country)),
    hasSelection: selectedBranches.length > 0,
    primaryCounty,
    neighboringCounties,
    coverageCounties: buildCoverageCountySet(primaryCounty, neighboringCounties),
  };
}

function assertPartnerSupportsAdminCountries(partner, countries = []) {
  const safePartner = partner && typeof partner === "object" ? partner : null;
  if (!safePartner?.id) {
    throw new Error("Select a valid partner.");
  }

  const cleanCountries = normalizeCountryList(countries);
  if (!cleanCountries.length) {
    throw new Error("Select at least one operational branch or stationed country.");
  }

  const supportedHomeCountries = new Set(
    (Array.isArray(safePartner?.homeCountries) ? safePartner.homeCountries : [])
      .map((value) => safeStr(value).toLowerCase())
      .filter(Boolean)
  );
  const invalidCountry = cleanCountries.find(
    (countryName) => !supportedHomeCountries.has(countryName.toLowerCase())
  );
  if (invalidCountry) {
    throw new Error(`${invalidCountry} is outside the selected partner's home-country coverage.`);
  }
}

function assertPartnerCoversAdminCounties(partner, counties = []) {
  const safePartner = partner && typeof partner === "object" ? partner : null;
  if (!safePartner?.id) {
    throw new Error("Select a valid partner.");
  }
  if (safePartner.isActive === false) {
    throw new Error("Selected partner is inactive.");
  }

  const coverageSet = new Set(
    (Array.isArray(safePartner?.supportedCountiesLower)
      ? safePartner.supportedCountiesLower
      : Array.isArray(safePartner?.coverageCountiesLower)
      ? safePartner.coverageCountiesLower
      : []
    ).map((value) => safeStr(value).toLowerCase())
  );

  const invalidCounty = normalizeCountyList(counties).find(
    (county) => !coverageSet.has(safeStr(county).toLowerCase())
  );
  if (invalidCounty) {
    throw new Error(
      `${invalidCounty} is outside the selected partner's county coverage.`
    );
  }
}

async function resolvePartnerAssignment(partnerId, { allowInactive = false } = {}) {
  const safePartnerId = safeStr(partnerId);
  if (!safePartnerId) {
    throw new Error("Select a partner.");
  }

  const partner = await fetchPartnerById(safePartnerId);
  if (!partner) {
    throw new Error("Selected partner was not found.");
  }
  if (!allowInactive && partner.isActive === false) {
    throw new Error("Selected partner is inactive.");
  }
  return partner;
}

async function requireSuperAdmin() {
  const actorUid = safeStr(auth.currentUser?.uid);
  if (!actorUid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(actorUid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only super admin can manage assigned admins.");
  }
  return roleCtx;
}

async function findUserDocsByEmail(email) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !safeEmail.includes("@")) {
    throw new Error("Enter a valid email.");
  }

  const snap = await getDocs(
    query(collection(db, "users"), where("email", "==", safeEmail), limit(20))
  );
  if (snap.empty) {
    throw new Error("No user found with that email. They must sign up first.");
  }

  const rows = snap.docs.map((d) => ({ uid: d.id, ...(d.data() || {}) }));
  const primary = pickPrimaryDoc(rows);
  if (!primary?.uid) {
    throw new Error("Found user docs, but failed to resolve target account.");
  }
  return {
    email: safeEmail,
    rows,
    primaryUid: primary.uid,
  };
}

export async function listAssignedAdmins({ max = 100, dedupeEmail = true } = {}) {
  await requireSuperAdmin();
  const maxRows = Math.max(1, Math.min(300, Number(max) || 100));
  const snap = await getDocs(
    query(
      collection(db, "users"),
      where("role", "in", ASSIGNED_ADMIN_ROLE_VARIANTS),
      limit(maxRows)
    )
  );
  const rows = snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      uid: d.id,
      ...data,
      adminScope: normalizeAdminScope(data?.adminScope),
    };
  });
  const scoped = dedupeEmail === false ?rows : dedupeByEmail(rows);
  return scoped.sort((a, b) => {
    const emailCmp = normalizeEmail(a?.email).localeCompare(normalizeEmail(b?.email));
    if (emailCmp !== 0) return emailCmp;
    return safeStr(a?.uid).localeCompare(safeStr(b?.uid));
  });
}

export async function setAssignedAdminByEmail({
  email,
  action = "upsert",
  partnerId = "",
  stationedCountry = "",
  country = "",
  selectedBranchIds = [],
  assignedBranchIds = [],
  town = "",
  availability = "active",
  active = true,
  maxActiveRequests = 12,
} = {}) {
  const superAdmin = await requireSuperAdmin();
  const match = await findUserDocsByEmail(email);
  const targetRows = Array.isArray(match?.rows) ? match.rows : [];
  const targetUids = targetRows.map((row) => safeStr(row?.uid)).filter(Boolean);

  if (!targetUids.length) {
    throw new Error("No user uid found for this email.");
  }
  if (targetUids.length > 1) {
    console.warn(
      "[assignedadminservice] duplicate users docs for email, applying update to all matches:",
      normalizeEmail(email),
      targetUids
    );
  }

  const mode = safeStr(action).toLowerCase();
  if (mode !== "upsert" && mode !== "remove") {
    throw new Error("Invalid action. Use 'upsert' or 'remove'.");
  }

  if (mode === "remove") {
    await Promise.all(
      targetUids.map((uid) =>
        setDoc(
          doc(db, "users", uid),
          {
            role: "user",
            adminScope: defaultAdminScopePayload(),
            adminUpdatedBy: superAdmin.uid,
            adminUpdatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      )
    );
    return {
      uid: match.primaryUid,
      uids: targetUids,
      email: normalizeEmail(email),
      action: "removed",
    };
  }

  const resolvedPartner = await resolvePartnerAssignment(partnerId);
  const explicitCountry = safeStr(stationedCountry || country).slice(0, 120);
  const branchCoverage = resolveBranchCoverageSelection(
    resolvedPartner,
    selectedBranchIds?.length ? selectedBranchIds : assignedBranchIds
  );
  if (!branchCoverage.hasSelection) {
    throw new Error("Select a branch for this assigned admin.");
  }
  const branchCountries = normalizeCountryList(branchCoverage.countries || []);
  const partnerHomeCountries = normalizeCountryList(resolvedPartner?.homeCountries || []);
  let resolvedCountries = branchCountries.length
    ? branchCountries
    : explicitCountry
    ? [explicitCountry]
    : [];
  if (!resolvedCountries.length && partnerHomeCountries.length === 1) {
    resolvedCountries = [partnerHomeCountries[0]];
  }
  assertPartnerSupportsAdminCountries(resolvedPartner, resolvedCountries);

  const resolvedCountriesLower = resolvedCountries.map((value) => value.toLowerCase());
  const cleanStationedCountry = explicitCountry
    ? resolvedCountriesLower.includes(explicitCountry.toLowerCase())
      ? explicitCountry
      : resolvedCountries[0] || ""
    : resolvedCountries[0] || "";

  const requiresCountyCoverage = resolvedCountriesLower.includes("kenya");
  let cleanPrimaryCounty = "";
  let cleanNeighboringCounties = [];
  let cleanCounties = [];
  const coverageSource = "branches";
  if (requiresCountyCoverage) {
    cleanPrimaryCounty = branchCoverage.primaryCounty;
    cleanNeighboringCounties = normalizeCountyList(branchCoverage.neighboringCounties).filter(
      (county) => county !== cleanPrimaryCounty
    );
    cleanCounties = buildCoverageCountySet(cleanPrimaryCounty, cleanNeighboringCounties);
    if (!cleanPrimaryCounty) {
      throw new Error("Selected branches do not provide Kenya county coverage.");
    }
  }
  if (requiresCountyCoverage) {
    assertPartnerCoversAdminCounties(resolvedPartner, cleanCounties);
  }

  const normalizedAssignedBranchIds = normalizeSingleAssignedBranchIds(
    normalizeBranchIdList(branchCoverage.selectedBranchIds)
  );
  const assignedBranches = branchCoverage.selectedBranches.map((branch) => ({
    branchId: safeStr(branch?.branchId || branch?.id),
    branchName: safeStr(branch?.branchName || branch?.name),
    country: safeStr(branch?.country, 120),
    primaryCounty: safeStr(branch?.primaryCounty || branch?.county),
    neighboringCounties: normalizeCountyList(branch?.neighboringCounties || []),
    coverageCounties: normalizeCountyList(branch?.coverageCounties || []),
  }));

  const scopePayload = {
    partnerId: safeStr(resolvedPartner.id),
    partnerName: safeStr(resolvedPartner.displayName),
    partnerStatus: resolvedPartner.isActive === false ? "inactive" : "active",
    stationedCountry: cleanStationedCountry,
    stationedCountryLower: cleanStationedCountry.toLowerCase(),
    country: cleanStationedCountry,
    countryLower: cleanStationedCountry.toLowerCase(),
    countries: resolvedCountries,
    countriesLower: resolvedCountriesLower,
    primaryCounty: cleanPrimaryCounty,
    primaryCountyLower: safeStr(cleanPrimaryCounty).toLowerCase(),
    neighboringCounties: cleanNeighboringCounties,
    neighboringCountiesLower: normalizeCountyLowerList(cleanNeighboringCounties),
    counties: cleanCounties,
    countiesLower: normalizeCountyLowerList(cleanCounties),
    assignedBranchId: getSingleAssignedBranchId(normalizedAssignedBranchIds),
    assignedBranchIds: normalizedAssignedBranchIds,
    assignedBranches,
    coverageSource,
    derivedCoverage: {
      source: coverageSource,
      primaryCounty: cleanPrimaryCounty,
      primaryCountyLower: safeStr(cleanPrimaryCounty).toLowerCase(),
      neighboringCounties: cleanNeighboringCounties,
      neighboringCountiesLower: normalizeCountyLowerList(cleanNeighboringCounties),
      counties: cleanCounties,
      countiesLower: normalizeCountyLowerList(cleanCounties),
      countries: resolvedCountries,
      countriesLower: resolvedCountriesLower,
    },
    town: safeStr(town).slice(0, 80),
    availability: normalizeAdminAvailability(availability),
    active: active !== false,
    maxActiveRequests: toBoundedInt(maxActiveRequests, 12, 1, 120),
  };

  await Promise.all(
    targetUids.map((uid) =>
      setDoc(
        doc(db, "users", uid),
        {
          role: "assignedAdmin",
          adminScope: scopePayload,
          adminUpdatedBy: superAdmin.uid,
          adminUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
    )
  );

  return {
    uid: match.primaryUid,
    uids: targetUids,
    email: normalizeEmail(email),
    action: "upserted",
    partnerId: scopePayload.partnerId,
    partnerName: scopePayload.partnerName,
    stationedCountry: scopePayload.stationedCountry,
    country: scopePayload.country,
    countries: scopePayload.countries,
    primaryCounty: scopePayload.primaryCounty,
    neighboringCounties: scopePayload.neighboringCounties,
    counties: scopePayload.counties,
    assignedBranchIds: scopePayload.assignedBranchIds,
    coverageSource: scopePayload.coverageSource,
    town: scopePayload.town,
    availability: scopePayload.availability,
  };
}

export async function getAssignedAdminByUid(uid) {
  await requireSuperAdmin();
  const safeUid = safeStr(uid);
  if (!safeUid) throw new Error("Missing assigned admin uid.");

  const snap = await getDoc(doc(db, "users", safeUid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...(snap.data() || {}) };
}

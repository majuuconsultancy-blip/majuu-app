const functions = require("firebase-functions");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const buildFinanceFoundation = require("./finance-foundation");

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
const HARDCODED_SUPER_ADMIN_EMAIL = "brioneroo@gmail.com";
const ASSIGNED_ADMIN_ROLE_VARIANTS = [
  "assignedAdmin",
  "assignedadmin",
  "assigned_admin",
  "admin",
];
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

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
  if (role === "superadmin" || role === "super_admin") return "assignedAdmin";
  if (role === "assignedadmin" || role === "assigned_admin") return "assignedAdmin";
  if (role === "admin") return "assignedAdmin"; // legacy role fallback
  if (role === "staff") return "staff";
  return "user";
}

function isHardcodedSuperAdminEmail(email) {
  const safeEmail = lower(email);
  return !!safeEmail && safeEmail === lower(HARDCODED_SUPER_ADMIN_EMAIL);
}

function normalizeCountyLower(value) {
  return lower(value);
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
  const neighboringCountiesLower = [];
  const coverageCountiesLower = mergeUniqueLowerLists(
    coverageData?.coverageCountiesLower,
    coverageData?.coverageCounties,
    partnerData?.coverageCounties,
    supportedCountiesLower
  );

  return {
    id: safeStr(partnerId),
    displayName,
    status,
    isActive: status === "active",
    supportedTracks,
    supportedCountriesLower,
    supportedCountiesLower,
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

function evaluatePartnerRequestCompatibility(partner, { trackType = "", country = "", county = "" } = {}) {
  const safePartner = partner && typeof partner === "object" ? partner : {};
  const safeTrack = lower(trackType);
  const safeCountry = lower(country);
  const safeCounty = normalizeCountyLower(county);
  const trackOk = Boolean(safeTrack) && safePartner.supportedTracks?.includes(safeTrack);
  const countryOk =
    Boolean(safeCountry) && safePartner.supportedCountriesLower?.includes(safeCountry);
  const countyDirect =
    Boolean(safeCounty) && safePartner.supportedCountiesLower?.includes(safeCounty);
  const countyNeighbor = false;
  const countyOk = Boolean(safeCounty) && safePartner.supportedCountiesLower?.includes(safeCounty);

  const reasons = [];
  if (safePartner.isActive === false) reasons.push("partner_inactive");
  if (!trackOk) reasons.push("track_not_supported");
  if (!countryOk) reasons.push("country_not_supported");
  if (!countyOk) reasons.push("county_not_supported");

  return {
    partnerId: safeStr(safePartner?.id),
    partnerName: safeStr(safePartner?.displayName),
    eligible: reasons.length === 0,
    reasons,
    countyMatchType: countyDirect ? "direct" : "",
  };
}

function preferredAgentReasonLabel(reason) {
  const safeReason = lower(reason);
  if (safeReason === "partner_inactive") return "Selected agent is inactive.";
  if (safeReason === "track_not_supported") return "Selected agent does not support this track.";
  if (safeReason === "country_not_supported") return "Selected agent does not support this country.";
  if (safeReason === "county_not_supported") return "Selected agent does not support this county.";
  if (safeReason === "partner_not_found") return "Selected agent was not found.";
  if (safeReason === "admin_unavailable") return "Assigned admin is unavailable.";
  if (safeReason === "admin_at_capacity") return "Assigned admin is at max capacity.";
  return "Selected agent is not valid for this request.";
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
  const type = lower(msg?.type || "text");
  const text = safeStr(msg?.text);
  if (type === "text" && text) return text.slice(0, 120);
  if (type === "bundle" && text) return text.slice(0, 120);
  return "Sent a document";
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
  const callerEmail = lower(userDoc?.email || context?.auth?.token?.email);
  if (isHardcodedSuperAdminEmail(callerEmail)) {
    return "superAdmin";
  }
  const role = normalizeRole(userDoc?.role);
  if (role !== "user") return role;
  return role;
}

async function requireAdminCallerContext(context, { superOnly = false } = {}) {
  const callerUid = safeStr(context?.auth?.uid);
  if (!callerUid) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  const callerDoc = await getUserDocByUid(callerUid);
  const normalizedRole = normalizeRole(callerDoc?.role);
  const callerEmail = lower(callerDoc?.email || context?.auth?.token?.email);
  const isSuperAdmin = isHardcodedSuperAdminEmail(callerEmail);
  const isAssignedAdmin = normalizedRole === "assignedAdmin";

  if (superOnly && !isSuperAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Super admin only");
  }

  if (!superOnly && !(isSuperAdmin || isAssignedAdmin)) {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  return {
    callerUid,
    callerDoc: callerDoc || {},
    callerRole: isSuperAdmin ? "superAdmin" : "assignedAdmin",
    isSuperAdmin,
    isAssignedAdmin,
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
    town: safeStr(scope?.town),
  };
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
    .sort((a, b) => {
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

async function listAssignedAdminCandidatesForRequest(
  requestData,
  { partnerId = "", excludeUids = [] } = {}
) {
  const safeCountyLower = normalizeCountyLower(requestData?.countyLower || requestData?.county);
  const safePartnerId = safeStr(partnerId);
  if (!safeCountyLower || !safePartnerId) return [];

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
    if (!scope.countiesLower.includes(safeCountyLower)) return;
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
      countyMatchType:
        safeStr(scope?.primaryCountyLower) === safeCountyLower ? "direct" : "neighboring",
    });
  });

  return rows;
}

async function listSuperAdminCandidates({ excludeUids = [] } = {}) {
  const excluded = new Set((excludeUids || []).map((x) => safeStr(x)).filter(Boolean));
  const rows = [];

  let hardcodedUid = "";
  try {
    const hardcodedAuthUser = await admin.auth().getUserByEmail(HARDCODED_SUPER_ADMIN_EMAIL);
    hardcodedUid = safeStr(hardcodedAuthUser?.uid);
  } catch {
    hardcodedUid = "";
  }

  if (!hardcodedUid || excluded.has(hardcodedUid)) {
    return rows;
  }

  const hardcodedUserDoc = await getUserDocByUid(hardcodedUid);
  const scope = normalizeAdminScope(hardcodedUserDoc?.adminScope);
  rows.push({
    uid: hardcodedUid,
    email: safeStr(hardcodedUserDoc?.email || HARDCODED_SUPER_ADMIN_EMAIL),
    role: "superAdmin",
    availability: scope.availability,
    maxActiveRequests: scope.maxActiveRequests,
    responseTimeoutMinutes: scope.responseTimeoutMinutes,
    town: scope.town,
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

async function buildRoutingSnapshot(
  requestData,
  { excludeAdminUids = [], includeAdminOptions = false } = {}
) {
  const trackType = lower(requestData?.track);
  const country = safeStr(requestData?.country);
  const county = safeStr(requestData?.county);
  const preferredAgentId = safeStr(requestData?.preferredAgentId);
  const partnerRows = await listPartners({ activeOnly: false, max: 250 });
  const evaluations = partnerRows.map((partner) => ({
    partner,
    compatibility: evaluatePartnerRequestCompatibility(partner, {
      trackType,
      country,
      county,
    }),
  }));

  const eligiblePartners = evaluations.filter((row) => row.compatibility?.eligible);
  const preferredRow = preferredAgentId
    ? evaluations.find((row) => safeStr(row?.partner?.id) === preferredAgentId)
    : null;

  let preferredAgentValid = false;
  let preferredAgentReason = safeStr(requestData?.preferredAgentInvalidReason);
  let partnerDecisionSource = "auto";
  let candidatePartners = eligiblePartners;

  if (preferredAgentId) {
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
  const partnerSourceRows = includeAdminOptions ? eligiblePartners : candidatePartners;
  const partnerOptions = [];
  for (const row of partnerSourceRows) {
    const adminCandidates = await listAssignedAdminCandidatesForRequest(requestData, {
      partnerId: row.partner.id,
      excludeUids: excludeAdminUids,
    });
    const eligibleAdminOptions = buildEligibleAdminOptions(adminCandidates, activeLoadMap);
    const bestAdmin = pickAdminCandidate(adminCandidates, activeLoadMap);
    const countyWeight = row.compatibility?.countyMatchType === "direct" ? 1.08 : 1;
    const preferredWeight = preferredAgentValid ? 1.12 : 1;

    partnerOptions.push({
      partner: row.partner,
      compatibility: row.compatibility,
      adminOptions: includeAdminOptions ? eligibleAdminOptions : [],
      bestAdmin,
      pairScore: bestAdmin ? Number(bestAdmin.score || 0) * countyWeight * preferredWeight : 0,
    });
  }

  const autoCandidatePartnerIds = new Set(candidatePartners.map((row) => safeStr(row?.partner?.id)));
  const viableOptions = partnerOptions
    .filter((row) => autoCandidatePartnerIds.has(safeStr(row?.partner?.id)))
    .filter((row) => row.bestAdmin)
    .sort((a, b) => Number(b.pairScore || 0) - Number(a.pairScore || 0));
  const bestOption = viableOptions[0] || null;

  let unresolvedReason = "";
  if (!eligiblePartners.length) {
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
    eligiblePartnerCount: eligiblePartners.length,
    eligibleAdminCount: viableOptions.length,
    eligiblePartners: partnerOptions.map((row) => ({
      id: safeStr(row?.partner?.id),
      displayName: safeStr(row?.partner?.displayName),
      countyMatchType: safeStr(row?.compatibility?.countyMatchType),
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
  const targetIsHardcodedSuper = isHardcodedSuperAdminEmail(email);
  const isAssigned = normalizedRole === "assignedAdmin";

  if (!(targetIsHardcodedSuper || isAssigned)) {
    throw new Error("Target user is not an assigned admin.");
  }

  const scope = normalizeAdminScope(data?.adminScope);
  if (isAssigned && !safeStr(scope?.partnerId)) {
    throw new Error("Target admin is missing a partner binding.");
  }

  const countyLower = normalizeCountyLower(requestData?.countyLower || requestData?.county);
  if (isAssigned && countyLower && !scope.countiesLower.includes(countyLower)) {
    throw new Error("Target admin does not cover this county.");
  }

  const candidateBase = {
    uid,
    email,
    role: targetIsHardcodedSuper ? "superAdmin" : "assignedAdmin",
    availability: scope.availability,
    maxActiveRequests: scope.maxActiveRequests,
    responseTimeoutMinutes: scope.responseTimeoutMinutes,
    town: scope.town,
    partnerId: safeStr(scope?.partnerId),
    partnerName: safeStr(scope?.partnerName),
    countyMatchType:
      safeStr(scope?.primaryCountyLower) === countyLower ? "direct" : countyLower ? "neighboring" : "",
  };

  if (!isAssigned) {
    return candidateBase;
  }

  const partner = await fetchPartnerById(scope.partnerId);
  if (!partner) {
    throw new Error("Target admin's partner no longer exists.");
  }

  const compatibility = evaluatePartnerRequestCompatibility(partner, {
    trackType: requestData?.track,
    country: requestData?.country,
    county: requestData?.county,
  });
  if (!compatibility?.eligible) {
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
        countyMatchType: safeStr(routingSnapshot.bestOption?.compatibility?.countyMatchType),
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
        route: `/app/admin/request/${encodeURIComponent(safeRid)}`,
      },
    }),
    writeUserNotificationDoc(safeAdminUid, `admin_route_${safeRid}_${Date.now()}`, {
      type: "admin_routed_request",
      title: "New routed request",
      body,
      requestId: safeRid,
      status: "new",
    }),
  ]);
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
  pushType = "request_status",
  eventId = "",
}) {
  const ownerUid = safeStr(reqAfter?.uid);
  if (!ownerUid) return;

  const text = buildStatusNotificationText(reqAfter, status);
  await Promise.all([
    sendPushToRecipient({
      uid: ownerUid,
      role: "user",
      title: text.title,
      body: text.body,
      data: {
        type: pushType,
        requestId,
        status: safeStr(status),
        targetRole: "user",
      },
    }),
    writeUserNotificationDoc(
      ownerUid,
      `status_${requestId}_${pushType}_${safeStr(status)}_${safeStr(eventId) || "evt"}`,
      {
      type: "request_status",
      title: text.title,
      body: text.body,
      requestId,
      status,
      }
    ),
  ]);
}

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
  const ownerIsHardcodedSuper = isHardcodedSuperAdminEmail(ownerAdminDoc?.email);
  if (!(ownerAdminRole === "assignedAdmin" || ownerIsHardcodedSuper)) {
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
      ownerAdminRole: ownerIsHardcodedSuper ? "superAdmin" : ownerAdminRole,
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
  const selectedIsHardcodedSuper = isHardcodedSuperAdminEmail(selectedTargetAdminDoc?.email);
  if (!(selectedIsHardcodedSuper || selectedTargetRole === "assignedAdmin")) {
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

    const fromRole = lower(msg.fromRole);
    const fromUid = safeStr(msg.fromUid);

    let recipientUid = "";
    let targetRole = "";

    if (fromRole === "admin" || fromRole === "staff") {
      recipientUid = safeStr(req.uid);
      targetRole = "user";
    } else if (fromRole === "user") {
      recipientUid = safeStr(req.assignedTo);
      targetRole = "staff";
    }

    if (!recipientUid) {
      logger.info("Published message push skipped (no recipient)", { requestId, mid, fromRole });
      return;
    }
    if (recipientUid === fromUid) return;

    const body = chatPreview(msg);

    await sendPushToRecipient({
      uid: recipientUid,
      role: targetRole,
      title: "New message",
      body,
      data: {
        type: "chat",
        requestId,
        mid,
        fromRole: fromRole || "unknown",
        targetRole,
      },
    });

    // In-app notification is written to users/{uid}/notifications for both user and staff recipients.
    await writeUserNotificationDoc(recipientUid, `chat_${requestId}_${mid}`, {
      type: "chat_message",
      title: "New message",
      body,
      requestId,
      messageId: mid,
      actorRole: fromRole,
      actorUid: fromUid,
    });
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
        pushType: "request_status",
        eventId: event.id,
      });
    }

    if (shouldSendStartedWorkPush) {
      const ownerUid = safeStr(after.uid);
      if (!ownerUid) return;

      const label = requestLabel(after);
      const body = label
        ? `We've started working on your request (${label}).`
        : "We've started working on your request.";

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
          type: "request_status",
          title: "Update on your request",
          body,
          requestId,
          status: "in_progress",
        }),
      ]);
    }
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
  buildFinanceFoundation({
    functions,
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
  })
);

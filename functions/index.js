const functions = require("firebase-functions");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

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
  const countiesLower = Array.isArray(scope?.countiesLower)
    ? scope.countiesLower.map((x) => lower(x)).filter(Boolean)
    : [];
  const countiesFallback = Array.isArray(scope?.counties)
    ? scope.counties.map((x) => lower(x)).filter(Boolean)
    : [];
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
    countiesLower: countiesLower.length ? countiesLower : countiesFallback,
    town: safeStr(scope?.town),
  };
}

async function listAssignedAdminCandidatesForCounty(countyLower, { excludeUids = [] } = {}) {
  const safeCountyLower = normalizeCountyLower(countyLower);
  if (!safeCountyLower) return [];

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
    if (!scope.countiesLower.includes(safeCountyLower)) return;
    rows.push({
      uid,
      email: safeStr(data?.email),
      role: "assignedAdmin",
      availability: scope.availability,
      maxActiveRequests: scope.maxActiveRequests,
      responseTimeoutMinutes: scope.responseTimeoutMinutes,
      town: scope.town,
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

function pickAdminCandidate(candidates, loadMap = {}) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return null;

  let best = null;
  rows.forEach((candidate) => {
    const uid = safeStr(candidate?.uid);
    if (!uid) return;

    const availability = normalizeAvailability(candidate?.availability);
    const availabilityWeight = ADMIN_AVAILABILITY_WEIGHTS[availability] || 0;
    if (availabilityWeight <= 0) return;

    const activeLoad = Math.max(0, toNum(loadMap?.[uid], 0));
    const maxActive = clamp(toNum(candidate?.maxActiveRequests, DEFAULT_MAX_ACTIVE_REQUESTS), 1, 120);
    const capacityRatio = activeLoad / maxActive;
    if (capacityRatio >= 1.35) return;

    const capacityWeight = capacityRatio >= 1 ? 0.08 : clamp(1 - capacityRatio, 0.1, 1);
    const fairnessWeight = 1 / (1 + activeLoad);
    const randomWeight = 0.9 + Math.random() * 0.2;
    const score = availabilityWeight * capacityWeight * fairnessWeight * randomWeight;

    if (!best || score > best.score) {
      best = {
        ...candidate,
        availability,
        activeLoad,
        maxActiveRequests: maxActive,
        score,
      };
    }
  });

  return best;
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
}) {
  const safeRid = safeStr(requestId);
  const targetUid = safeStr(candidate?.uid);
  if (!safeRid || !targetUid) return { ok: false, reason: "missing_target" };

  const nowMs = Date.now();
  const timeoutMin = clamp(
    toNum(candidate?.responseTimeoutMinutes, DEFAULT_ADMIN_RESPONSE_TIMEOUT_MINUTES),
    5,
    240
  );
  const deadlineMs = nowMs + timeoutMin * 60 * 1000;
  const previousUid = safeStr(previousAdminUid || requestData?.currentAdminUid);
  const historyEntry = {
    fromAdminUid: previousUid || null,
    toAdminUid: targetUid,
    reason: safeStr(reason),
    escalationReason: safeStr(escalationReason),
    routedAtMs: nowMs,
    availabilityAtRouting: normalizeAvailability(candidate?.availability),
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
          currentAdminUid: targetUid,
          currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
          currentAdminEmail: safeStr(candidate?.email),
          routedAt: FieldValue.serverTimestamp(),
          routedAtMs: nowMs,
          routingReason: safeStr(reason) || "auto_route",
          adminAvailabilityAtRouting: normalizeAvailability(candidate?.availability),
          escalationReason: safeStr(escalationReason),
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

  const countyLower = normalizeCountyLower(data?.countyLower || data?.county);
  const excluded = Array.from(
    new Set(
      [safeStr(data?.currentAdminUid), ...excludeAdminUids]
        .map((x) => safeStr(x))
        .filter(Boolean)
    )
  );

  const [assignedAdmins, activeLoadMap] = await Promise.all([
    listAssignedAdminCandidatesForCounty(countyLower, { excludeUids: excluded }),
    buildActiveLoadMap(),
  ]);

  const pickedAssigned = pickAdminCandidate(assignedAdmins, activeLoadMap);
  if (pickedAssigned) {
    return routeRequestToAdmin({
      requestId: safeRid,
      requestData: data,
      candidate: pickedAssigned,
      reason,
      escalationReason: "",
    });
  }

  const superAdmins = await listSuperAdminCandidates({ excludeUids: excluded });
  const pickedSuper = pickAdminCandidate(superAdmins, activeLoadMap);
  if (pickedSuper) {
    return routeRequestToAdmin({
      requestId: safeRid,
      requestData: data,
      candidate: pickedSuper,
      reason,
      escalationReason: "no_eligible_assigned_admin",
    });
  }

  await db.collection("serviceRequests").doc(safeRid).set(
    {
      escalationReason: "no_valid_admin_available",
      escalationCount: toNum(data?.escalationCount, 0) + 1,
      routingReason: safeStr(reason) || "auto_route",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: false, reason: "no_valid_admin_available" };
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

  const targetRole = normalizeRole(targetAdminDoc?.role);
  const targetIsHardcodedSuper = isHardcodedSuperAdminEmail(
    targetAdminDoc?.email || selectedTargetAdminDoc?.email
  );
  if (!(targetIsHardcodedSuper || targetRole === "assignedAdmin")) {
    throw new functions.https.HttpsError("invalid-argument", "Target admin account is not active.");
  }

  const targetScope = normalizeAdminScope(
    targetAdminDoc?.adminScope && typeof targetAdminDoc.adminScope === "object"
      ? targetAdminDoc.adminScope
      : selectedTargetAdminDoc?.adminScope
  );
  const candidate = {
    uid: effectiveTargetAdminUid || safeStr(targetAdminUid),
    email: safeStr(targetAdminDoc?.email || selectedTargetAdminDoc?.email),
    role: targetIsHardcodedSuper ? "superAdmin" : "assignedAdmin",
    availability: targetScope.availability,
    maxActiveRequests: targetScope.maxActiveRequests,
    responseTimeoutMinutes: targetScope.responseTimeoutMinutes,
    town: targetScope.town,
  };

  const result = await routeRequestToAdmin({
    requestId,
    requestData: reqData,
    candidate,
    reason,
    escalationReason: "super_admin_override",
    previousAdminUid: safeStr(reqData?.currentAdminUid),
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

import { getFunctions, httpsCallable } from "firebase/functions";
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
  HARDCODED_SUPER_ADMIN_EMAIL,
  getCurrentUserRoleContext,
  normalizeAdminScope,
  normalizeUserRole,
} from "./adminroleservice";

const functions = getFunctions(undefined, "us-central1");
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

function normalizeAvailability(value) {
  const v = lower(value);
  return Object.prototype.hasOwnProperty.call(ADMIN_AVAILABILITY_WEIGHTS, v) ? v : "active";
}

function isHardcodedSuperAdminEmail(email) {
  return lower(email) === lower(HARDCODED_SUPER_ADMIN_EMAIL);
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
    const maxActive = clamp(toNum(candidate?.maxActiveRequests, 12), 1, 120);
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

async function listAssignedAdminCandidatesForCounty(countyLower, { excludeUids = [] } = {}) {
  const safeCountyLower = normalizeCountyLower(countyLower);
  if (!safeCountyLower) return [];

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
    if (!scope.active) return;
    if (!scope.countiesLower.includes(safeCountyLower)) return;

    rows.push({
      uid,
      email: safeStr(data?.email),
      role: "assignedAdmin",
      availability: normalizeAvailability(scope.availability),
      maxActiveRequests: scope.maxActiveRequests,
      responseTimeoutMinutes: scope.responseTimeoutMinutes,
      town: scope.town,
    });
  });

  return rows;
}

async function resolveExplicitAdminCandidate(targetAdminUid) {
  const uid = safeStr(targetAdminUid);
  if (!uid) throw new Error("Target admin is required.");

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("Target admin user does not exist.");

  const data = snap.data() || {};
  const email = safeStr(data?.email);
  const normalizedRole = normalizeUserRole(data?.role);
  const targetIsHardcodedSuper = isHardcodedSuperAdminEmail(email);
  const isAssigned = normalizedRole === "assignedAdmin";

  if (!(targetIsHardcodedSuper || isAssigned)) {
    throw new Error("Target user is not an assigned admin.");
  }

  const scope = normalizeAdminScope(data?.adminScope);
  return {
    uid,
    email,
    role: targetIsHardcodedSuper ? "superAdmin" : "assignedAdmin",
    availability: normalizeAvailability(scope.availability),
    maxActiveRequests: scope.maxActiveRequests,
    responseTimeoutMinutes: scope.responseTimeoutMinutes,
    town: scope.town,
  };
}

async function pickAutoCandidate({ requestData, excludeAdminUids = [], actorRoleCtx }) {
  const countyLower = normalizeCountyLower(requestData?.countyLower || requestData?.county);
  const excluded = Array.from(
    new Set(
      [safeStr(requestData?.currentAdminUid), ...excludeAdminUids]
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
    return { candidate: pickedAssigned, escalationReason: "" };
  }

  const fallbackUid = safeStr(actorRoleCtx?.uid);
  if (fallbackUid && !excluded.includes(fallbackUid)) {
    const scope = normalizeAdminScope(actorRoleCtx?.adminScope);
    return {
      candidate: {
        uid: fallbackUid,
        email: safeStr(actorRoleCtx?.email),
        role: "superAdmin",
        availability: normalizeAvailability(scope.availability || "active"),
        maxActiveRequests: scope.maxActiveRequests,
        responseTimeoutMinutes: scope.responseTimeoutMinutes,
        town: scope.town,
      },
      escalationReason: "no_eligible_assigned_admin",
    };
  }

  return { candidate: null, escalationReason: "no_valid_admin_available" };
}

async function applyRouteToRequest({
  requestRef,
  requestData,
  candidate,
  reason,
  escalationReason = "",
  previousAdminUid = "",
}) {
  const targetUid = safeStr(candidate?.uid);
  if (!targetUid) {
    throw new Error("Unable to route request: missing target admin.");
  }

  const nowMs = Date.now();
  const timeoutMin = clamp(toNum(candidate?.responseTimeoutMinutes, 20), 5, 240);
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

  await setDoc(
    requestRef,
    {
      county,
      town,
      city: town,
      countyLower: normalizeCountyLower(requestData?.countyLower || county),
      currentAdminUid: targetUid,
      currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
      currentAdminEmail: safeStr(candidate?.email),
      currentAdminAvailability: normalizeAvailability(candidate?.availability),
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
        currentAdminUid: targetUid,
        currentAdminRole: safeStr(candidate?.role || "assignedAdmin"),
        currentAdminEmail: safeStr(candidate?.email),
        routedAt: serverTimestamp(),
        routedAtMs: nowMs,
        routingReason: safeStr(reason) || "manual_override_local",
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

  return {
    ok: true,
    uid: targetUid,
    reason: safeStr(reason),
    escalationReason: safeStr(escalationReason),
  };
}

function shouldUseLocalFallback(error) {
  const code = safeStr(error?.code).toLowerCase();
  const msg = safeStr(error?.message).toLowerCase();
  return (
    code.includes("functions/internal") ||
    code.includes("functions/unavailable") ||
    code.includes("functions/not-found") ||
    code.includes("internal") ||
    msg.includes("internal") ||
    msg.includes("unavailable") ||
    msg.includes("not found")
  );
}

async function superAdminOverrideRouteRequestLocal({
  requestId,
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
  const safeTarget = safeStr(targetAdminUid);

  if (!safeTarget && safeStr(reqData?.ownerLockedAdminUid)) {
    throw new Error("Locked requests require selecting a specific admin.");
  }

  let candidate = null;
  let escalationReason = "";

  if (safeTarget) {
    candidate = await resolveExplicitAdminCandidate(safeTarget);
    escalationReason = "super_admin_override";
  } else {
    const auto = await pickAutoCandidate({
      requestData: reqData,
      actorRoleCtx: roleCtx,
    });
    candidate = auto.candidate;
    escalationReason = auto.escalationReason;
  }

  if (!candidate) {
    await setDoc(
      reqRef,
      {
        escalationReason: "no_valid_admin_available",
        escalationCount: toNum(reqData?.escalationCount, 0) + 1,
        routingReason: safeStr(reason) || "super_admin_manual_override",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: false, mode: safeTarget ? "manual_local" : "auto_local", reason: "no_valid_admin_available" };
  }

  const result = await applyRouteToRequest({
    requestRef: reqRef,
    requestData: reqData,
    candidate,
    reason: safeStr(reason) || "super_admin_manual_override",
    escalationReason,
    previousAdminUid: safeStr(reqData?.currentAdminUid),
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
  targetAdminUid = "",
  reason = "super_admin_manual_override",
} = {}) {
  const rid = safeStr(requestId);
  if (!rid) {
    throw new Error("requestId is required");
  }

  const payload = {
    requestId: rid,
    targetAdminUid: safeStr(targetAdminUid),
    reason: safeStr(reason) || "super_admin_manual_override",
  };

  try {
    const callable = httpsCallable(functions, "superAdminOverrideRouteRequest");
    const resp = await callable(payload);
    return resp?.data || { ok: true };
  } catch (error) {
    if (!shouldUseLocalFallback(error)) {
      throw error;
    }
    return superAdminOverrideRouteRequestLocal(payload);
  }
}

export async function routeUnroutedNewRequests({
  max = 120,
  reason = "super_admin_manual_bulk_route",
} = {}) {
  const roleCtx = await getCurrentUserRoleContext();
  if (!roleCtx?.isSuperAdmin) {
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

    if (ownerLockedAdminUid) {
      try {
        candidate = await resolveExplicitAdminCandidate(ownerLockedAdminUid);
        escalationReason = "locked_owner_backfill";
      } catch (error) {
        skippedInvalidLockedOwner += 1;
        if (failureSamples.length < 5) {
          failureSamples.push(`${requestId}: ${safeStr(error?.message || "invalid_locked_owner")}`);
        }
        continue;
      }
    } else {
      const auto = await pickAutoCandidate({
        requestData,
        actorRoleCtx: roleCtx,
      });
      candidate = auto?.candidate || null;
      escalationReason = safeStr(auto?.escalationReason);
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

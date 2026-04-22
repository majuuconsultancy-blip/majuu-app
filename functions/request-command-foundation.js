function safeObj(value) {
  return value && typeof value === "object" ? value : {};
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  return 0;
}

const REQUEST_STAGES = Object.freeze({
  SUBMITTED: "Submitted",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "InProgress",
  COMPLETED: "Completed",
});

function stageFromRequest(request = {}, { lower, safeStr }) {
  const explicit = safeStr(request?.lifecycle?.stage);
  if (explicit === REQUEST_STAGES.SUBMITTED) return explicit;
  if (explicit === REQUEST_STAGES.ASSIGNED) return explicit;
  if (explicit === REQUEST_STAGES.IN_PROGRESS) return explicit;
  if (explicit === REQUEST_STAGES.COMPLETED) return explicit;

  const status = lower(request?.status);
  if (status === "closed" || status === "rejected" || status === "accepted") {
    return REQUEST_STAGES.COMPLETED;
  }
  if (status === "contacted" || status === "active" || status === "in_progress") {
    return REQUEST_STAGES.IN_PROGRESS;
  }
  if (safeStr(request?.assignedTo) || lower(request?.backendStatus) === "assigned") {
    return REQUEST_STAGES.ASSIGNED;
  }
  return REQUEST_STAGES.SUBMITTED;
}

function stageToBackendStatus(stage) {
  if (stage === REQUEST_STAGES.ASSIGNED) return "assigned";
  if (stage === REQUEST_STAGES.IN_PROGRESS) return "in_progress";
  if (stage === REQUEST_STAGES.COMPLETED) return "completed";
  return "new";
}

function stageToUserStatus(stage) {
  if (stage === REQUEST_STAGES.COMPLETED) return "completed";
  if (stage === REQUEST_STAGES.ASSIGNED || stage === REQUEST_STAGES.IN_PROGRESS) return "in_progress";
  return "";
}

function normalizeActorRole(input, { lower }) {
  const role = lower(input);
  if (role === "super_admin" || role === "superadmin" || role === "super-admin") return "super_admin";
  if (role === "admin" || role === "assignedadmin" || role === "assigned_admin") return "admin";
  if (role === "staff") return "staff";
  if (role === "user") return "user";
  return "";
}

function normalizeDecision(value, { lower }) {
  const v = lower(value);
  if (v === "accept" || v === "accepted") return "accepted";
  if (v === "reject" || v === "rejected") return "rejected";
  return "";
}

function normalizeCommandName(input, { lower }) {
  const raw = lower(input);
  const map = {
    createrequest: "createRequest",
    routerequest: "routeRequest",
    assignadmin: "assignAdmin",
    assignstaff: "assignStaff",
    unassignstaff: "unassignStaff",
    rerouterequest: "rerouteRequest",
    startwork: "startWork",
    updateprogress: "updateProgress",
    recommenddecision: "recommendDecision",
    finalizedecision: "finalizeDecision",
    markcompleted: "markCompleted",
    addinternalnote: "addInternalNote",
    sendmessage: "sendMessage",
    userhiderequest: "userHideRequest",
    staffhidetask: "staffHideTask",
    adminarchiverequest: "adminArchiveRequest",
  };
  return map[raw] || "";
}

function assertOk(condition, message, { functions, code = "failed-precondition" }) {
  if (condition) return;
  throw new functions.https.HttpsError(code, message);
}

function lifecyclePatch({ request, nextStage, actor, actionType, nowMs, FieldValue, finalDecision = "" }) {
  const lifecycle = safeObj(request?.lifecycle);
  const patch = {
    lifecycle: {
      ...lifecycle,
      stage: nextStage,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      version: Number(lifecycle?.version || 0) + 1,
    },
    backendStatus: stageToBackendStatus(nextStage),
    userStatus: stageToUserStatus(nextStage),
    everAssigned:
      request?.everAssigned === true || nextStage !== REQUEST_STAGES.SUBMITTED,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    actionType,
    updatedBy: {
      uid: actor.uid,
      role: actor.role,
    },
  };
  if (nextStage === REQUEST_STAGES.IN_PROGRESS) {
    const oldStatus = String(request?.status || "").trim().toLowerCase();
    patch.status = oldStatus === "new" ? "contacted" : (oldStatus || "contacted");
  }
  if (nextStage === REQUEST_STAGES.COMPLETED) {
    patch.status = finalDecision === "rejected" ? "rejected" : "closed";
  }
  return patch;
}

module.exports = function buildRequestCommandFoundation({
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
}) {
  async function resolveActorContext(data, context) {
    const authUid = safeStr(context?.auth?.uid);
    assertOk(Boolean(authUid), "Authentication required.", {
      functions,
      code: "unauthenticated",
    });

    const actorUid = safeStr(data?.actorUid);
    if (actorUid) {
      assertOk(actorUid === authUid, "actorUid mismatch.", {
        functions,
        code: "permission-denied",
      });
    }

    const userDoc = (await getUserDocByUid(authUid)) || {};
    const userRole = normalizeRole(userDoc?.role);
    let role =
      userRole === "superAdmin"
        ? "super_admin"
        : userRole === "assignedAdmin"
        ? "admin"
        : userRole === "staff"
        ? "staff"
        : "user";

    if (role === "user") {
      const staffSnap = await db.collection("staff").doc(authUid).get();
      if (staffSnap.exists) role = "staff";
    }

    const declaredRole = normalizeActorRole(data?.actorRole, { lower });
    if (declaredRole) {
      assertOk(declaredRole === role, "actorRole mismatch.", {
        functions,
        code: "permission-denied",
      });
    }
    return { uid: authUid, role, userDoc };
  }

  function ensureScopedAccess(request, actor) {
    if (actor.role === "super_admin") return;
    if (actor.role === "user") {
      assertOk(safeStr(request?.uid) === actor.uid, "Request does not belong to user.", {
        functions,
        code: "permission-denied",
      });
      return;
    }
    if (actor.role === "staff") {
      assertOk(safeStr(request?.assignedTo) === actor.uid, "Request is not assigned to staff.", {
        functions,
        code: "permission-denied",
      });
      return;
    }
    const scoped = new Set(
      [
        safeStr(request?.currentAdminUid),
        safeStr(request?.ownerLockedAdminUid),
        safeStr(request?.assignedAdminId),
      ].filter(Boolean)
    );
    assertOk(scoped.size === 0 || scoped.has(actor.uid), "Request outside admin scope.", {
      functions,
      code: "permission-denied",
    });
  }

  function ensureNotStale(request, payload) {
    const expected = toNum(payload?.expectedUpdatedAtMs, 0);
    if (!expected) return;
    const current = Math.max(toNum(request?.updatedAtMs, 0), toMillis(request?.updatedAt));
    assertOk(!current || current <= expected, "Request changed. Refresh and retry.", {
      functions,
      code: "aborted",
    });
  }

  const handlers = {};

  handlers.createRequest = async ({ actor, payload }) => {
    assertOk(actor.role === "user", "Only users can create requests.", {
      functions,
      code: "permission-denied",
    });
    const requestInput = safeObj(payload?.request);
    const county = safeStr(requestInput?.county, 120);
    assertOk(Boolean(county), "County is required.", {
      functions,
      code: "invalid-argument",
    });
    const status =
      lower(requestInput?.status) === "payment_pending" ? "payment_pending" : "new";
    const idemKey = safeStr(payload?.idempotencyKey, 120).toLowerCase();
    return db.runTransaction(async (tx) => {
      const nowMs = Date.now();
      const dedupRef = idemKey
        ? db.collection("requestCommandDedup").doc(`${actor.uid}_createRequest_${idemKey}`)
        : null;

      if (dedupRef) {
        const dedupSnap = await tx.get(dedupRef);
        if (dedupSnap.exists) {
          return { ...(safeObj(dedupSnap.data()?.result)), deduplicated: true };
        }
      }

      const requestRef = db.collection("serviceRequests").doc();
      const requestId = requestRef.id;
      const routingStatus =
        status === "payment_pending" ? "awaiting_payment" : "awaiting_route";

      const docPayload = {
        ...requestInput,
        uid: actor.uid,
        county,
        countyLower: lower(requestInput?.countyLower || county),
        status,
        routingStatus,
        assignedTo: "",
        assignedAt: null,
        assignedBy: "",
        staffStatus: "",
        staffDecision: "none",
        currentAdminUid: "",
        currentAdminRole: "",
        currentAdminEmail: "",
        currentAdminAvailability: "",
        assignedAdminId: "",
        ownerLockedAdminUid: "",
        assignedPartnerId: "",
        assignedPartnerName: "",
        backendStatus: "new",
        userStatus: "",
        everAssigned: false,
        lifecycle: {
          stage: REQUEST_STAGES.SUBMITTED,
          decisionFinalized: false,
          finalDecision: "",
          version: 1,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        },
        ownership: {
          ownerUid: actor.uid,
          adminUid: "",
          staffUid: "",
        },
        actionType: "createRequest",
        updatedBy: { uid: actor.uid, role: actor.role },
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        routingMeta: {
          ...(safeObj(requestInput?.routingMeta)),
          routingStatus,
          assignedAdminId: "",
          assignedPartnerId: "",
          assignedPartnerName: "",
          currentAdminUid: "",
          currentAdminEmail: "",
          routedAtMs: 0,
          reassignmentHistory: [],
          escalationCount: 0,
        },
      };

      tx.set(requestRef, docPayload, { merge: true });
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "createRequest",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage: "",
        afterStage: REQUEST_STAGES.SUBMITTED,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });

      const result = {
        ok: true,
        command: "createRequest",
        requestId,
        stage: REQUEST_STAGES.SUBMITTED,
      };
      if (dedupRef) {
        tx.set(
          dedupRef,
          {
            command: "createRequest",
            actorUid: actor.uid,
            actorRole: actor.role,
            idempotencyKey: idemKey,
            result,
            createdAt: FieldValue.serverTimestamp(),
            createdAtMs: nowMs,
          },
          { merge: true }
        );
      }
      return result;
    });
  };

  handlers.routeRequest = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "admin" || actor.role === "super_admin", "Admin role required.", {
      functions,
      code: "permission-denied",
    });
    const requestRef = db.collection("serviceRequests").doc(requestId);
    const snap = await requestRef.get();
    assertOk(snap.exists, "Request not found.", { functions, code: "not-found" });
    const request = snap.data() || {};
    ensureScopedAccess(request, actor);
    const stage = stageFromRequest(request, { lower, safeStr });
    assertOk(stage !== REQUEST_STAGES.COMPLETED, "Completed requests cannot be routed.", {
      functions,
      code: "failed-precondition",
    });

    const result = await autoRouteRequest({
      requestId,
      requestData: request,
      reason: safeStr(payload?.reason) || "command_route_request",
      selectedPartnerId: safeStr(payload?.selectedPartnerId),
      excludeAdminUids: Array.isArray(payload?.excludeAdminUids)
        ? payload.excludeAdminUids.map((v) => safeStr(v)).filter(Boolean)
        : [],
    });

    const fallbackAdminUid = safeStr(payload?.fallbackAdminUid);
    if (!result?.ok && fallbackAdminUid) {
      const fallbackDoc = (await getUserDocByUid(fallbackAdminUid)) || null;
      const fallbackRole = normalizeRole(fallbackDoc?.role);
      if (fallbackDoc && (fallbackRole === "assignedAdmin" || fallbackRole === "superAdmin")) {
        await requestRef.set(
          {
            currentAdminUid: fallbackAdminUid,
            currentAdminRole: fallbackRole === "superAdmin" ? "superAdmin" : "assignedAdmin",
            currentAdminEmail: safeStr(fallbackDoc?.email),
            assignedAdminId: fallbackRole === "assignedAdmin" ? fallbackAdminUid : "",
            routingStatus: "assigned",
            routingReason: "command_route_fallback_owner",
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: Date.now(),
          },
          { merge: true }
        );
      }
    }

    await requestRef.set(
      {
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
        actionType: "routeRequest",
        updatedBy: { uid: actor.uid, role: actor.role },
      },
      { merge: true }
    );
    return {
      ok: true,
      command: "routeRequest",
      requestId,
      stage,
      routed: Boolean(result?.ok),
      reason: safeStr(result?.reason),
    };
  };

  handlers.assignAdmin = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "super_admin", "Only super admins can assign admins.", {
      functions,
      code: "permission-denied",
    });
    const targetAdminUid = safeStr(payload?.targetAdminUid);
    assertOk(Boolean(targetAdminUid), "targetAdminUid is required.", {
      functions,
      code: "invalid-argument",
    });

    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const snap = await tx.get(requestRef);
      assertOk(snap.exists, "Request not found.", { functions, code: "not-found" });
      const request = snap.data() || {};
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage !== REQUEST_STAGES.COMPLETED, "Completed requests cannot be reassigned.", {
        functions,
        code: "failed-precondition",
      });

      const targetDoc = (await getUserDocByUid(targetAdminUid)) || null;
      assertOk(Boolean(targetDoc), "Target admin user not found.", { functions, code: "not-found" });
      const targetRole = normalizeRole(targetDoc?.role);
      assertOk(
        targetRole === "assignedAdmin" || targetRole === "superAdmin",
        "Target account is not an admin.",
        { functions, code: "failed-precondition" }
      );

      const nowMs = Date.now();
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: beforeStage,
            actor,
            actionType: "assignAdmin",
            nowMs,
            FieldValue,
          }),
          currentAdminUid: targetAdminUid,
          currentAdminRole: targetRole === "superAdmin" ? "superAdmin" : "assignedAdmin",
          currentAdminEmail: safeStr(targetDoc?.email),
          assignedAdminId: targetRole === "assignedAdmin" ? targetAdminUid : "",
          ownerLockedAdminUid: payload?.lockOwner ? targetAdminUid : safeStr(request?.ownerLockedAdminUid),
          ownerLockedAt: payload?.lockOwner ? FieldValue.serverTimestamp() : request?.ownerLockedAt || null,
          routingStatus: "assigned",
          routingReason: safeStr(payload?.reason) || "command_assign_admin",
          routingMeta: {
            ...(safeObj(request?.routingMeta)),
            currentAdminUid: targetAdminUid,
            currentAdminRole: targetRole === "superAdmin" ? "superAdmin" : "assignedAdmin",
            currentAdminEmail: safeStr(targetDoc?.email),
            assignedAdminId: targetRole === "assignedAdmin" ? targetAdminUid : "",
            routingStatus: "assigned",
            routingReason: safeStr(payload?.reason) || "command_assign_admin",
            routedAt: FieldValue.serverTimestamp(),
            routedAtMs: nowMs,
          },
          ownership: {
            ...(safeObj(request?.ownership)),
            ownerUid: safeStr(request?.uid),
            adminUid: targetAdminUid,
            staffUid: safeStr(request?.assignedTo),
          },
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "assignAdmin",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: beforeStage,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });

      return {
        ok: true,
        command: "assignAdmin",
        requestId,
        stage: beforeStage,
        targetAdminUid,
      };
    });
  };

  handlers.rerouteRequest = async ({ actor, requestId, payload }) => {
    const targetAdminUid = safeStr(payload?.targetAdminUid);
    if (targetAdminUid) {
      return handlers.assignAdmin({ actor, requestId, payload });
    }
    return handlers.routeRequest({
      actor,
      requestId,
      payload: {
        ...payload,
        reason: safeStr(payload?.reason) || "command_reroute_request",
      },
    });
  };

  handlers.assignStaff = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "admin" || actor.role === "super_admin", "Admin role required.", {
      functions,
      code: "permission-denied",
    });
    const staffUid = safeStr(payload?.staffUid);
    assertOk(Boolean(staffUid), "staffUid is required.", {
      functions,
      code: "invalid-argument",
    });

    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);

      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage !== REQUEST_STAGES.COMPLETED, "Cannot assign completed request.", {
        functions,
      });
      const forceOverride = payload?.forceOverride === true;
      assertOk(
        beforeStage === REQUEST_STAGES.SUBMITTED ||
          beforeStage === REQUEST_STAGES.ASSIGNED ||
          (beforeStage === REQUEST_STAGES.IN_PROGRESS && forceOverride),
        forceOverride
          ? "Invalid stage for forced reassign."
          : "assignStaff is only allowed from Submitted or Assigned.",
        { functions }
      );

      const staffRef = db.collection("staff").doc(staffUid);
      const staffSnap = await tx.get(staffRef);
      assertOk(staffSnap.exists, "Staff account not found.", { functions, code: "not-found" });
      const staff = staffSnap.data() || {};
      if (actor.role === "admin" && safeStr(staff?.ownerAdminUid)) {
        assertOk(safeStr(staff?.ownerAdminUid) === actor.uid, "Staff belongs to another admin.", {
          functions,
          code: "permission-denied",
        });
      }

      const previousAssignee = safeStr(request?.assignedTo);
      if (previousAssignee && previousAssignee !== staffUid) {
        tx.delete(db.collection("staff").doc(previousAssignee).collection("tasks").doc(requestId));
      }

      const nowMs = Date.now();
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: REQUEST_STAGES.ASSIGNED,
            actor,
            actionType: "assignStaff",
            nowMs,
            FieldValue,
          }),
          assignedTo: staffUid,
          assignedAt: FieldValue.serverTimestamp(),
          assignedAtMs: nowMs,
          assignedBy: actor.uid,
          staffStatus: "assigned",
          staffDecision: "none",
          staffUpdatedAt: FieldValue.serverTimestamp(),
          staffStartedAt: FieldValue.delete(),
          staffStartedAtMs: FieldValue.delete(),
          staffStartedBy: FieldValue.delete(),
          staffCompletedAt: FieldValue.delete(),
          staffCompletedAtMs: FieldValue.delete(),
          staffCompletedBy: FieldValue.delete(),
          staffWorkMinutes: FieldValue.delete(),
          ownership: {
            ...(safeObj(request?.ownership)),
            ownerUid: safeStr(request?.uid),
            adminUid: safeStr(request?.currentAdminUid || request?.ownerLockedAdminUid),
            staffUid,
          },
        },
        { merge: true }
      );
      tx.set(
        db.collection("staff").doc(staffUid).collection("tasks").doc(requestId),
        {
          requestId,
          status: "assigned",
          assignedAt: FieldValue.serverTimestamp(),
          assignedAtMs: nowMs,
          assignedBy: actor.uid,
          track: safeStr(payload?.track || request?.track).toLowerCase(),
          country: safeStr(payload?.country || request?.country),
          requestType: safeStr(payload?.requestType || request?.requestType).toLowerCase(),
          serviceName: safeStr(payload?.serviceName || request?.serviceName),
          applicantName: safeStr(payload?.applicantName || request?.name),
          speciality: safeStr(payload?.speciality || ""),
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "assignStaff",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: REQUEST_STAGES.ASSIGNED,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });

      return {
        ok: true,
        command: "assignStaff",
        requestId,
        stage: REQUEST_STAGES.ASSIGNED,
        staffUid,
        previousAssignee,
        forced: forceOverride,
      };
    });
  };

  handlers.unassignStaff = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "admin" || actor.role === "super_admin", "Admin role required.", {
      functions,
      code: "permission-denied",
    });

    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);

      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage !== REQUEST_STAGES.COMPLETED, "Cannot unassign completed request.", {
        functions,
      });
      if (beforeStage === REQUEST_STAGES.IN_PROGRESS) {
        assertOk(payload?.forceOverride === true, "Cannot unassign in-progress request without forceOverride.", {
          functions,
        });
      }

      const targetStaffUid = safeStr(payload?.staffUid || request?.assignedTo);
      assertOk(Boolean(targetStaffUid), "No assigned staff found.", { functions });

      const nowMs = Date.now();
      tx.delete(db.collection("staff").doc(targetStaffUid).collection("tasks").doc(requestId));
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: REQUEST_STAGES.SUBMITTED,
            actor,
            actionType: "unassignStaff",
            nowMs,
            FieldValue,
          }),
          status: lower(request?.status) === "contacted" ? "new" : safeStr(request?.status || "new"),
          assignedTo: FieldValue.delete(),
          assignedAt: FieldValue.delete(),
          assignedAtMs: FieldValue.delete(),
          assignedBy: FieldValue.delete(),
          staffStatus: FieldValue.delete(),
          staffDecision: FieldValue.delete(),
          staffUpdatedAt: FieldValue.serverTimestamp(),
          staffStartedAt: FieldValue.delete(),
          staffStartedAtMs: FieldValue.delete(),
          staffStartedBy: FieldValue.delete(),
          staffCompletedAt: FieldValue.delete(),
          staffCompletedAtMs: FieldValue.delete(),
          staffCompletedBy: FieldValue.delete(),
          staffWorkMinutes: FieldValue.delete(),
          ownership: {
            ...(safeObj(request?.ownership)),
            ownerUid: safeStr(request?.uid),
            adminUid: safeStr(request?.currentAdminUid || request?.ownerLockedAdminUid),
            staffUid: "",
          },
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "unassignStaff",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: REQUEST_STAGES.SUBMITTED,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      return {
        ok: true,
        command: "unassignStaff",
        requestId,
        stage: REQUEST_STAGES.SUBMITTED,
        staffUid: targetStaffUid,
      };
    });
  };

  handlers.startWork = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "staff", "Only staff can start work.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage === REQUEST_STAGES.ASSIGNED, "startWork is only allowed from Assigned stage.", {
        functions,
      });

      const nowMs = Date.now();
      const startedMs = Math.max(toNum(request?.staffStartedAtMs, 0), toMillis(request?.staffStartedAt));
      const alreadyStarted = startedMs > 0;
      const patch = {
        ...lifecyclePatch({
          request,
          nextStage: REQUEST_STAGES.IN_PROGRESS,
          actor,
          actionType: "startWork",
          nowMs,
          FieldValue,
        }),
        staffStatus: "in_progress",
        staffUpdatedAt: FieldValue.serverTimestamp(),
        markedInProgressAt: FieldValue.serverTimestamp(),
        markedInProgressAtMs: nowMs,
      };
      if (!alreadyStarted) {
        patch.staffStartedAt = FieldValue.serverTimestamp();
        patch.staffStartedAtMs = nowMs;
        patch.staffStartedBy = actor.uid;
      }
      tx.set(requestRef, patch, { merge: true });
      tx.set(
        db.collection("staff").doc(actor.uid).collection("tasks").doc(requestId),
        {
          requestId,
          status: "active",
          startedAt: FieldValue.serverTimestamp(),
          startedAtMs: nowMs,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "startWork",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: REQUEST_STAGES.IN_PROGRESS,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      return {
        ok: true,
        command: "startWork",
        requestId,
        stage: REQUEST_STAGES.IN_PROGRESS,
        alreadyStarted,
        taskUpdated: true,
      };
    });
  };

  handlers.updateProgress = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "staff" || actor.role === "admin" || actor.role === "super_admin", "Role not allowed.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage === REQUEST_STAGES.IN_PROGRESS, "updateProgress is only allowed in InProgress stage.", {
        functions,
      });

      const percent = Math.round(Number(payload?.progressPercent));
      assertOk(Number.isFinite(percent) && percent >= 0 && percent <= 100, "progressPercent must be 0-100.", {
        functions,
        code: "invalid-argument",
      });
      const content = safeStr(payload?.content, 2000) || `Progress updated to ${percent}%`;
      const nowMs = Date.now();
      const visibleToUser = payload?.visibleToUser !== false;
      const progressRef = requestRef.collection("progressUpdates").doc();

      tx.set(progressRef, {
        requestId,
        staffId: actor.uid,
        createdBy: actor.uid,
        content,
        visibleToUser,
        progressPercent: percent,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: REQUEST_STAGES.IN_PROGRESS,
            actor,
            actionType: "updateProgress",
            nowMs,
            FieldValue,
          }),
          staffProgressPercent: percent,
          staffProgressUpdatedAt: FieldValue.serverTimestamp(),
          staffProgressUpdatedAtMs: nowMs,
          staffUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "updateProgress",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: REQUEST_STAGES.IN_PROGRESS,
        progressPercent: percent,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      return {
        ok: true,
        command: "updateProgress",
        requestId,
        stage: REQUEST_STAGES.IN_PROGRESS,
        progressPercent: percent,
        updateId: progressRef.id,
      };
    });
  };

  handlers.recommendDecision = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "staff", "Only staff can recommend decisions.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage === REQUEST_STAGES.IN_PROGRESS, "recommendDecision is only allowed in InProgress stage.", {
        functions,
      });

      const decision = normalizeDecision(payload?.decision || payload?.staffDecision, { lower });
      assertOk(Boolean(decision), "decision must be accept or reject.", {
        functions,
        code: "invalid-argument",
      });
      const recommendation = decision === "accepted" ? "recommend_accept" : "recommend_reject";
      const nowMs = Date.now();
      const markDone = payload?.markDone === true || payload?.legacyMarkDone === true;
      const startedMs = Math.max(toNum(request?.staffStartedAtMs, 0), toMillis(request?.staffStartedAt));
      const workMinutes = startedMs > 0 ? Math.max(0, Math.round((nowMs - startedMs) / 60000)) : null;

      const patch = {
        ...lifecyclePatch({
          request,
          nextStage: REQUEST_STAGES.IN_PROGRESS,
          actor,
          actionType: "recommendDecision",
          nowMs,
          FieldValue,
        }),
        staffDecision: recommendation,
        staffStatus: markDone ? "done" : safeStr(request?.staffStatus || "in_progress"),
        staffUpdatedAt: FieldValue.serverTimestamp(),
        staffNote: safeStr(payload?.staffNote, 2000) || safeStr(request?.staffNote, 2000),
      };
      if (markDone) {
        patch.staffCompletedAt = FieldValue.serverTimestamp();
        patch.staffCompletedAtMs = nowMs;
        patch.staffCompletedBy = actor.uid;
        patch.staffWorkMinutes = workMinutes;
      }

      tx.set(requestRef, patch, { merge: true });
      tx.set(
        db.collection("staff").doc(actor.uid).collection("tasks").doc(requestId),
        {
          requestId,
          status: markDone ? "done" : "active",
          recommendation,
          recommendationAt: FieldValue.serverTimestamp(),
          recommendationAtMs: nowMs,
          updatedAt: FieldValue.serverTimestamp(),
          ...(markDone
            ? {
                doneAt: FieldValue.serverTimestamp(),
                doneAtMs: nowMs,
                completedAt: FieldValue.serverTimestamp(),
              }
            : {}),
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "recommendDecision",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: REQUEST_STAGES.IN_PROGRESS,
        recommendation,
        markDone,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });

      return {
        ok: true,
        command: "recommendDecision",
        requestId,
        stage: REQUEST_STAGES.IN_PROGRESS,
        recommendation,
        markedDone: markDone,
      };
    });
  };

  handlers.finalizeDecision = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "admin" || actor.role === "super_admin", "Admin role required.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage !== REQUEST_STAGES.COMPLETED, "Cannot finalize a completed request.", {
        functions,
      });

      const decision = normalizeDecision(payload?.decision || payload?.finalDecision, { lower });
      assertOk(Boolean(decision), "decision must be accept or reject.", {
        functions,
        code: "invalid-argument",
      });
      const nowMs = Date.now();
      const lifecycle = safeObj(request?.lifecycle);
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: beforeStage,
            actor,
            actionType: "finalizeDecision",
            nowMs,
            FieldValue,
          }),
          lifecycle: {
            ...lifecycle,
            stage: beforeStage,
            decisionFinalized: true,
            finalDecision: decision,
            finalDecisionAt: FieldValue.serverTimestamp(),
            finalDecisionAtMs: nowMs,
            finalizedBy: actor.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs,
            version: Number(lifecycle?.version || 0) + 1,
          },
          adminDecisionNote: safeStr(payload?.note || payload?.adminDecisionNote, 2000),
          adminRespondedAt: FieldValue.serverTimestamp(),
          adminRespondedAtMs: nowMs,
          adminRespondedBy: actor.uid,
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "finalizeDecision",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: beforeStage,
        finalDecision: decision,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      return {
        ok: true,
        command: "finalizeDecision",
        requestId,
        stage: beforeStage,
        finalDecision: decision,
      };
    });
  };

  handlers.markCompleted = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "admin" || actor.role === "super_admin", "Admin role required.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage !== REQUEST_STAGES.COMPLETED, "Request is already completed.", {
        functions,
      });
      assertOk(
        beforeStage === REQUEST_STAGES.IN_PROGRESS,
        "markCompleted is only allowed from InProgress stage.",
        { functions }
      );

      const lifecycle = safeObj(request?.lifecycle);
      const decision = normalizeDecision(
        payload?.decision || payload?.finalDecision || lifecycle?.finalDecision,
        { lower }
      );
      assertOk(Boolean(decision), "markCompleted requires final decision.", { functions });
      assertOk(
        lifecycle?.decisionFinalized === true || payload?.forceComplete === true,
        "markCompleted is only allowed after finalizeDecision.",
        { functions }
      );

      const nowMs = Date.now();
      const recommendationExpected = decision === "accepted" ? "recommend_accept" : "recommend_reject";
      const staffDecision = lower(request?.staffDecision);
      const matched = Boolean(staffDecision) && staffDecision === recommendationExpected;

      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: REQUEST_STAGES.COMPLETED,
            actor,
            actionType: "markCompleted",
            nowMs,
            FieldValue,
            finalDecision: decision,
          }),
          lifecycle: {
            ...lifecycle,
            stage: REQUEST_STAGES.COMPLETED,
            decisionFinalized: true,
            finalDecision: decision,
            completedAt: FieldValue.serverTimestamp(),
            completedAtMs: nowMs,
            completedBy: actor.uid,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs,
            version: Number(lifecycle?.version || 0) + 1,
          },
          decidedAt: FieldValue.serverTimestamp(),
          adminFinal: decision,
          adminFinalAt: FieldValue.serverTimestamp(),
          adminFinalDecisionRecorded: true,
          adminFinalDecisionRecordedAt: FieldValue.serverTimestamp(),
          adminFinalRewarded: matched,
          adminFinalRecommendationMatched: matched,
          adminFinalStaffRecommendation: safeStr(staffDecision || "none"),
          staffStatus: "done",
          ...(safeStr(request?.staffStatus).toLowerCase() === "done"
            ? {}
            : {
                staffCompletedAt: FieldValue.serverTimestamp(),
                staffCompletedAtMs: nowMs,
                staffCompletedBy: "admin",
              }),
        },
        { merge: true }
      );

      const staffUid = safeStr(request?.assignedTo);
      if (staffUid) {
        tx.set(
          db.collection("staff").doc(staffUid),
          {
            "stats.totalReviewed": admin.firestore.FieldValue.increment(1),
            "stats.matchedDecisionCount": admin.firestore.FieldValue.increment(matched ? 1 : 0),
            "stats.unmatchedDecisionCount": admin.firestore.FieldValue.increment(matched ? 0 : 1),
            "stats.totalDone": admin.firestore.FieldValue.increment(matched ? 1 : 0),
            "stats.lastUpdatedAt": FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        tx.set(
          db.collection("staff").doc(staffUid).collection("tasks").doc(requestId),
          {
            requestId,
            status: "done",
            adminFinal: decision,
            adminFinalAt: FieldValue.serverTimestamp(),
            recommendationMatched: matched,
            recommendationMatchedAt: FieldValue.serverTimestamp(),
            doneAt: FieldValue.serverTimestamp(),
            doneAtMs: nowMs,
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "markCompleted",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: REQUEST_STAGES.COMPLETED,
        finalDecision: decision,
        recommendationMatched: matched,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      return {
        ok: true,
        command: "markCompleted",
        requestId,
        stage: REQUEST_STAGES.COMPLETED,
        finalDecision: decision,
        recommendationMatched: matched,
      };
    });
  };

  handlers.addInternalNote = async ({ actor, requestId, payload }) => {
    assertOk(
      actor.role === "staff" || actor.role === "admin" || actor.role === "super_admin",
      "Role not allowed.",
      { functions, code: "permission-denied" }
    );
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      const note = safeStr(payload?.note || payload?.staffNote, 3000);
      assertOk(Boolean(note), "Note is required.", { functions, code: "invalid-argument" });
      const nowMs = Date.now();

      const noteRef = requestRef.collection("internalNotes").doc();
      tx.set(noteRef, {
        requestId,
        note,
        actorUid: actor.uid,
        actorRole: actor.role,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: beforeStage,
            actor,
            actionType: "addInternalNote",
            nowMs,
            FieldValue,
          }),
          internalNoteLatest: note,
          internalNoteUpdatedAt: FieldValue.serverTimestamp(),
          internalNoteUpdatedAtMs: nowMs,
          ...(actor.role === "staff" ? { staffNote: note } : {}),
        },
        { merge: true }
      );
      tx.set(requestRef.collection("commandAudit").doc(), {
        requestId,
        command: "addInternalNote",
        actorUid: actor.uid,
        actorRole: actor.role,
        beforeStage,
        afterStage: beforeStage,
        noteId: noteRef.id,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      });

      return {
        ok: true,
        command: "addInternalNote",
        requestId,
        stage: beforeStage,
        noteId: noteRef.id,
      };
    });
  };

  handlers.sendMessage = async ({ actor, requestId, payload }) => {
    const requestRef = db.collection("serviceRequests").doc(requestId);
    const requestSnap = await requestRef.get();
    assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
    const request = requestSnap.data() || {};
    ensureScopedAccess(request, actor);
    const stage = stageFromRequest(request, { lower, safeStr });

    const toRole = normalizeActorRole(payload?.toRole, { lower });
    const rawType = lower(payload?.type || "text");
    const text = safeStr(payload?.text, 4000);
    const rawAttachment =
      payload?.attachmentMeta && typeof payload.attachmentMeta === "object"
        ? payload.attachmentMeta
        : payload?.pdfMeta && typeof payload.pdfMeta === "object"
        ? payload.pdfMeta
        : null;

    const normalizeAttachmentMeta = (value) => {
      if (!value || typeof value !== "object") return null;
      const name = safeStr(value?.name || value?.fileName || value?.filename, 220);
      if (!name) return null;
      const mime = safeStr(value?.mime || value?.type || value?.contentType, 120).toLowerCase();
      const attachmentKindRaw = lower(value?.attachmentKind || value?.kind);
      let attachmentKind = "document";
      if (attachmentKindRaw === "photo") attachmentKind = "photo";
      else if (attachmentKindRaw === "image") attachmentKind = "image";
      else if (mime.startsWith("image/")) attachmentKind = "image";
      const resolveExternalUrl = (input) => {
        const candidates = [
          input?.externalUrl,
          input?.url,
          input?.downloadUrl,
          input?.fileUrl,
        ];
        for (const candidate of candidates) {
          const clean = safeStr(candidate, 1200);
          if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
        }
        return "";
      };
      const externalUrl = resolveExternalUrl(value);
      const storageBucket = safeStr(value?.storageBucket || value?.bucket || value?.storage?.bucket, 220);
      const storagePath = safeStr(value?.storagePath || value?.path || value?.storage?.path, 520);
      const rawStorageKind = safeStr(value?.storageKind || value?.storage?.kind, 30).toLowerCase();
      const storageKind =
        rawStorageKind === "bucket" || rawStorageKind === "external" || rawStorageKind === "meta"
          ? rawStorageKind
          : storagePath || storageBucket
          ? "bucket"
          : externalUrl
          ? "external"
          : "";
      return {
        name,
        mime: mime || (attachmentKind === "document" ? "application/octet-stream" : "image/jpeg"),
        size: Math.max(0, toNum(value?.size || value?.sizeBytes, 0)),
        note: safeStr(value?.note, 1400),
        attachmentKind,
        source: safeStr(value?.source, 40).toLowerCase(),
        optimizedBytes: Math.max(0, toNum(value?.optimizedBytes, 0)),
        originalBytes: Math.max(0, toNum(value?.originalBytes, 0)),
        externalUrl,
        url: externalUrl,
        downloadUrl: externalUrl,
        fileUrl: externalUrl,
        storageKind,
        storageBucket,
        storagePath,
        storageGeneration: safeStr(
          value?.storageGeneration || value?.generation || value?.storage?.generation,
          120
        ),
        storageChecksum: safeStr(
          value?.storageChecksum || value?.checksum || value?.storage?.checksum,
          120
        ),
      };
    };

    const attachmentMeta = normalizeAttachmentMeta(rawAttachment);
    const normalizeMessageType = (inputType, meta) => {
      const clean = lower(inputType);
      if (clean === "text") return "text";
      if (clean === "bundle") return "bundle";
      if (clean === "pdf" || clean === "document") return "document";
      if (clean === "image") return "image";
      if (clean === "photo" || clean === "camera_photo") return "photo";
      const attachmentKind = lower(meta?.attachmentKind);
      if (attachmentKind === "photo") return "photo";
      if (attachmentKind === "image") return "image";
      if (meta) return "document";
      return "text";
    };
    const type = normalizeMessageType(rawType, attachmentMeta);

    assertOk(toRole === "user" || toRole === "staff", "toRole must be user or staff.", {
      functions,
      code: "invalid-argument",
    });
    assertOk(
      type === "text" || type === "document" || type === "image" || type === "photo" || type === "bundle",
      "type must be text, document, image, photo, or bundle.",
      {
        functions,
        code: "invalid-argument",
      }
    );
    assertOk(type !== "text" || Boolean(text), "Text cannot be empty.", {
      functions,
      code: "invalid-argument",
    });
    assertOk(
      (type !== "document" && type !== "image" && type !== "photo") || Boolean(attachmentMeta),
      "attachmentMeta is required for document/image/photo.",
      {
        functions,
        code: "invalid-argument",
      }
    );
    assertOk(type !== "bundle" || Boolean(text || attachmentMeta), "Bundle cannot be empty.", {
      functions,
      code: "invalid-argument",
    });

    const toMessageKind = (messageType, meta) => {
      if (messageType === "text") return "message";
      const attachmentKind = lower(meta?.attachmentKind);
      if (messageType === "photo" || messageType === "image" || attachmentKind === "photo" || attachmentKind === "image") {
        return "photo";
      }
      return "document";
    };

    const buildMessagePayload = ({ fromRole, fromUid, toUid, messageType, sourcePendingId = null, approvedBy = null }) => ({
      requestId,
      fromRole,
      fromUid,
      toRole,
      toUid: toUid || null,
      type: messageType,
      messageKind: toMessageKind(messageType, attachmentMeta),
      text: messageType === "text" ? text : messageType === "bundle" ? text : "",
      attachmentMeta: messageType === "text" ? null : attachmentMeta,
      // Backward compatibility for existing clients still expecting pdfMeta.
      pdfMeta:
        messageType === "document" ||
        (messageType === "bundle" && lower(attachmentMeta?.attachmentKind || "document") === "document")
          ? attachmentMeta
          : null,
      sourcePendingId,
      approvedBy: approvedBy || null,
      approvedAt: approvedBy ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      needsAssignment: toRole === "staff" && !toUid,
    });

    const nowMs = Date.now();
    if (actor.role === "admin" || actor.role === "super_admin") {
      const toUid = toRole === "user" ? safeStr(request?.uid) : safeStr(request?.assignedTo);
      const msgRef = requestRef.collection("messages").doc();
      await msgRef.set(
        buildMessagePayload({
          fromRole: "admin",
          fromUid: actor.uid,
          toUid,
          messageType: type,
          approvedBy: actor.uid,
        })
      );
      return {
        ok: true,
        command: "sendMessage",
        requestId,
        stage,
        messageId: msgRef.id,
        status: "published",
      };
    }

    if (actor.role === "user") {
      assertOk(toRole === "staff", "User can only send to staff.", {
        functions,
        code: "invalid-argument",
      });
    }
    if (actor.role === "staff") {
      assertOk(toRole === "user", "Staff can only send to user.", {
        functions,
        code: "invalid-argument",
      });
    }

    // Per-staff moderation gate. Applies only to chat.
    let autoApproveStaffUid = "";
    if (actor.role === "staff") autoApproveStaffUid = actor.uid;
    if (actor.role === "user") autoApproveStaffUid = safeStr(request?.assignedTo);
    let autoApproveEnabled = false;
    if (autoApproveStaffUid) {
      try {
        const staffSnap = await db.collection("staff").doc(autoApproveStaffUid).get();
        const staffData = staffSnap.exists ? staffSnap.data() || {} : {};
        autoApproveEnabled =
          staffData?.autoApproveChatMessages === true || staffData?.chatModeration?.autoApproveMessages === true;
      } catch {
        autoApproveEnabled = false;
      }
    }

    if (autoApproveEnabled) {
      const toUid = toRole === "user" ? safeStr(request?.uid) : safeStr(request?.assignedTo);
      const publishedRef = requestRef.collection("messages").doc();
      await publishedRef.set(
        {
          ...buildMessagePayload({
            fromRole: actor.role === "staff" ? "staff" : "user",
            fromUid: actor.uid,
            toUid,
            messageType: type,
          }),
          moderationBypassed: true,
          moderationMode: "staff_auto_approve",
          autoApprovedByStaffUid: autoApproveStaffUid || null,
        },
        { merge: true }
      );
      return {
        ok: true,
        command: "sendMessage",
        requestId,
        stage,
        messageId: publishedRef.id,
        status: "published",
        moderationMode: "staff_auto_approve",
      };
    }

    const pendingRef = requestRef.collection("pendingMessages").doc();
    await pendingRef.set({
      fromRole: actor.role === "user" ? "user" : "staff",
      fromUid: actor.uid,
      toRole,
      type,
      messageKind: toMessageKind(type, attachmentMeta),
      text: type === "text" ? text : type === "bundle" ? text : "",
      attachmentMeta: type === "text" ? null : attachmentMeta,
      pdfMeta:
        type === "document" || (type === "bundle" && lower(attachmentMeta?.attachmentKind || "document") === "document")
          ? attachmentMeta
          : null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
    });
    return {
      ok: true,
      command: "sendMessage",
      requestId,
      stage,
      messageId: pendingRef.id,
      status: "pending",
    };
  };

  handlers.userHideRequest = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "user", "Only users can hide requests.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage === REQUEST_STAGES.COMPLETED, "Only completed requests can be hidden.", {
        functions,
      });
      const nowMs = Date.now();
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: beforeStage,
            actor,
            actionType: "userHideRequest",
            nowMs,
            FieldValue,
          }),
          deletedByOwner: true,
          ownerDeletedAt: FieldValue.serverTimestamp(),
          ownerDeletedAtMs: nowMs,
          ownerDeletedBy: actor.uid,
          visibility: {
            ...(safeObj(request?.visibility)),
            userHiddenBy: actor.uid,
            userHiddenAt: FieldValue.serverTimestamp(),
            userHiddenAtMs: nowMs,
          },
        },
        { merge: true }
      );
      return {
        ok: true,
        command: "userHideRequest",
        requestId,
        stage: beforeStage,
      };
    });
  };

  handlers.staffHideTask = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "staff", "Only staff can hide tasks.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage === REQUEST_STAGES.COMPLETED, "Only completed tasks can be hidden.", {
        functions,
      });
      const nowMs = Date.now();
      tx.delete(db.collection("staff").doc(actor.uid).collection("tasks").doc(requestId));
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: beforeStage,
            actor,
            actionType: "staffHideTask",
            nowMs,
            FieldValue,
          }),
          visibility: {
            ...(safeObj(request?.visibility)),
            staffHiddenByUids: admin.firestore.FieldValue.arrayUnion(actor.uid),
            staffHiddenAt: FieldValue.serverTimestamp(),
            staffHiddenAtMs: nowMs,
          },
        },
        { merge: true }
      );
      return {
        ok: true,
        command: "staffHideTask",
        requestId,
        stage: beforeStage,
      };
    });
  };

  handlers.adminArchiveRequest = async ({ actor, requestId, payload }) => {
    assertOk(actor.role === "admin" || actor.role === "super_admin", "Admin role required.", {
      functions,
      code: "permission-denied",
    });
    return db.runTransaction(async (tx) => {
      const requestRef = db.collection("serviceRequests").doc(requestId);
      const requestSnap = await tx.get(requestRef);
      assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
      const request = requestSnap.data() || {};
      ensureScopedAccess(request, actor);
      ensureNotStale(request, payload);
      const beforeStage = stageFromRequest(request, { lower, safeStr });
      assertOk(beforeStage === REQUEST_STAGES.COMPLETED, "Only completed requests can be archived.", {
        functions,
      });
      const nowMs = Date.now();
      tx.set(
        requestRef,
        {
          ...lifecyclePatch({
            request,
            nextStage: beforeStage,
            actor,
            actionType: "adminArchiveRequest",
            nowMs,
            FieldValue,
          }),
          deletedByAdmin: true,
          adminDeletedAt: FieldValue.serverTimestamp(),
          adminDeletedAtMs: nowMs,
          adminDeletedBy: actor.uid,
          visibility: {
            ...(safeObj(request?.visibility)),
            adminArchivedBy: actor.uid,
            adminArchivedAt: FieldValue.serverTimestamp(),
            adminArchivedAtMs: nowMs,
          },
        },
        { merge: true }
      );
      return {
        ok: true,
        command: "adminArchiveRequest",
        requestId,
        stage: beforeStage,
      };
    });
  };

  async function executeInternal(data, context, explicitCommand = "") {
    const actor = await resolveActorContext(data, context);
    const command =
      explicitCommand || normalizeCommandName(data?.command, { lower });
    assertOk(Boolean(command), "Unsupported command.", {
      functions,
      code: "invalid-argument",
    });
    const handler = handlers[command];
    assertOk(typeof handler === "function", `Command ${command} is not implemented.`, {
      functions,
      code: "invalid-argument",
    });
    const requestId = safeStr(data?.requestId);
    const payload = safeObj(data?.payload);
    const result = await handler({ actor, requestId, payload });
    return {
      ...(safeObj(result)),
      actorUid: actor.uid,
      actorRole: actor.role,
      updatedAt: Date.now(),
      updatedBy: {
        uid: actor.uid,
        role: actor.role,
      },
      actionType: command,
    };
  }

  const executeRequestCommand = functions.https.onCall(async (data, context) => {
    return executeInternal(data || {}, context);
  });

  const staffStartWork = functions.https.onCall(async (data, context) => {
    return executeInternal(
      {
        actorUid: safeStr(data?.actorUid),
        actorRole: safeStr(data?.actorRole) || "staff",
        requestId: safeStr(data?.requestId),
        payload: safeObj(data?.payload),
      },
      context,
      "startWork"
    );
  });

  const staffMarkRequestDone = functions.https.onCall(async (data, context) => {
    return executeInternal(
      {
        actorUid: safeStr(data?.actorUid),
        actorRole: safeStr(data?.actorRole) || "staff",
        requestId: safeStr(data?.requestId),
        payload: {
          decision: normalizeDecision(data?.staffDecision, { lower }) || "accepted",
          staffNote: safeStr(data?.staffNote, 2000),
          markDone: true,
          legacyMarkDone: true,
        },
      },
      context,
      "recommendDecision"
    );
  });

  const staffUpdateRequestNote = functions.https.onCall(async (data, context) => {
    return executeInternal(
      {
        actorUid: safeStr(data?.actorUid),
        actorRole: safeStr(data?.actorRole) || "staff",
        requestId: safeStr(data?.requestId),
        payload: { note: safeStr(data?.staffNote, 3000), staffNote: safeStr(data?.staffNote, 3000) },
      },
      context,
      "addInternalNote"
    );
  });

  const staffDeleteDoneTask = functions.https.onCall(async (data, context) => {
    return executeInternal(
      {
        actorUid: safeStr(data?.actorUid),
        actorRole: safeStr(data?.actorRole) || "staff",
        requestId: safeStr(data?.requestId),
        payload: safeObj(data?.payload),
      },
      context,
      "staffHideTask"
    );
  });

  const deleteOwnRequestDeep = functions.https.onCall(async (data, context) => {
    return executeInternal(
      {
        actorUid: safeStr(data?.actorUid),
        actorRole: safeStr(data?.actorRole) || "user",
        requestId: safeStr(data?.requestId),
        payload: safeObj(data?.payload),
      },
      context,
      "userHideRequest"
    );
  });

  const staffClaimAssignedOrphanMessages = functions.https.onCall(async (data, context) => {
    const actor = await resolveActorContext(data || {}, context);
    assertOk(actor.role === "staff", "Staff role required.", {
      functions,
      code: "permission-denied",
    });
    const requestId = safeStr(data?.requestId);
    assertOk(Boolean(requestId), "requestId is required.", {
      functions,
      code: "invalid-argument",
    });
    const requestSnap = await db.collection("serviceRequests").doc(requestId).get();
    assertOk(requestSnap.exists, "Request not found.", { functions, code: "not-found" });
    const request = requestSnap.data() || {};
    assertOk(safeStr(request?.assignedTo) === actor.uid, "Request is not assigned to this staff account.", {
      functions,
      code: "permission-denied",
    });

    const max = Math.max(1, Math.min(400, Number(data?.max || 200) || 200));
    const msgSnap = await db
      .collection("serviceRequests")
      .doc(requestId)
      .collection("messages")
      .where("toRole", "==", "staff")
      .limit(500)
      .get();

    let claimed = 0;
    const batch = db.batch();
    msgSnap.docs.forEach((docSnap) => {
      if (claimed >= max) return;
      const row = docSnap.data() || {};
      const hasUid = Boolean(safeStr(row?.toUid));
      const needsAssignment = row?.needsAssignment === true;
      if (!needsAssignment && hasUid) return;
      batch.set(
        docSnap.ref,
        {
          toUid: actor.uid,
          needsAssignment: false,
          assignedAt: FieldValue.serverTimestamp(),
          assignedAtMs: Date.now(),
        },
        { merge: true }
      );
      claimed += 1;
    });

    if (claimed > 0) await batch.commit();
    return { ok: true, requestId, claimed };
  });

  const staffAcceptOnboarding = functions.https.onCall(async (data, context) => {
    const actor = await resolveActorContext(data || {}, context);
    assertOk(actor.role === "staff", "Staff role required.", {
      functions,
      code: "permission-denied",
    });
    const onboardingVersion = Math.max(1, Math.min(20, Number(data?.onboardingVersion || 3) || 3));
    const nowMs = Date.now();
    await db.collection("staff").doc(actor.uid).set(
      {
        onboarded: true,
        onboardingVersion,
        onboardingAcceptedAt: FieldValue.serverTimestamp(),
        onboardingAcceptedAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      },
      { merge: true }
    );
    await db.collection("users").doc(actor.uid).set(
      {
        role: "staff",
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      },
      { merge: true }
    );
    return { ok: true, onboardingVersion };
  });

  const createScopedNotification = functions.https.onCall(async (data, context) => {
    const actor = await resolveActorContext(data || {}, context);
    const targetUid = safeStr(data?.uid || actor.uid);
    const scope = lower(data?.scope || "user");
    const type = safeStr(data?.type).toUpperCase();
    assertOk(Boolean(type), "type is required.", {
      functions,
      code: "invalid-argument",
    });
    if (targetUid !== actor.uid) {
      assertOk(actor.role === "admin" || actor.role === "super_admin", "Not allowed to notify another user.", {
        functions,
        code: "permission-denied",
      });
    }
    const notificationId =
      safeStr(data?.notificationId) ||
      `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const extras = safeObj(data?.extras);
    const payload = {
      type,
      title: safeStr(extras?.title || "Notification"),
      body: safeStr(extras?.body || "You have an update."),
      requestId: safeStr(data?.requestId),
      status: safeStr(extras?.status || "new"),
      route: safeStr(extras?.route || ""),
      paymentId: safeStr(extras?.paymentId),
      refundId: safeStr(extras?.refundId),
      pendingId: safeStr(extras?.pendingId),
      messageId: safeStr(extras?.messageId),
      actorRole: safeStr(extras?.actorRole),
      actorUid: safeStr(extras?.actorUid),
    };

    if (scope === "staff") {
      await db.collection("staff").doc(targetUid).collection("notifications").doc(notificationId).set(
        {
          ...payload,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: Date.now(),
          readAt: null,
        },
        { merge: true }
      );
    } else {
      await writeUserNotificationDoc(targetUid, notificationId, payload);
    }
    return { ok: true, uid: targetUid, type, notificationId };
  });

  return {
    executeRequestCommand,
    staffStartWork,
    staffMarkRequestDone,
    staffUpdateRequestNote,
    staffDeleteDoneTask,
    deleteOwnRequestDeep,
    staffClaimAssignedOrphanMessages,
    staffAcceptOnboarding,
    createScopedNotification,
  };
};

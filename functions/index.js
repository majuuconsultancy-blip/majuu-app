const functions = require("firebase-functions");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
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
  if (!context.auth?.token?.email) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  if (context.auth.token.email !== "brioneroo@gmail.com") {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const email = String(data.email || "").toLowerCase().trim();
  const specialties = Array.isArray(data.specialties) ? data.specialties : [];

  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "Email required");
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

  await db.collection("staff").doc(user.uid).set(
    {
      email,
      active: true,
      onboarded: false,
      specialties,
      maxActive: 2,
      activeCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, uid: user.uid };
});

exports.revokeStaffAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.email) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }

  if (context.auth.token.email !== "brioneroo@gmail.com") {
    throw new functions.https.HttpsError("permission-denied", "Admin only");
  }

  const uid = String(data.uid || "");
  if (!uid) {
    throw new functions.https.HttpsError("invalid-argument", "UID required");
  }

  await db.collection("staff").doc(uid).update({
    active: false,
  });

  return { ok: true };
});

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

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

function safeStr(value) {
  return String(value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function shortErr(error, max = 1200) {
  if (!error) return "";

  const parts = [];
  if (error.code != null) parts.push(`code=${safeStr(error.code)}`);
  if (error.message != null) parts.push(`message=${safeStr(error.message)}`);

  if (error.details != null) {
    let detailsStr = "";
    if (typeof error.details === "string") {
      detailsStr = error.details;
    } else {
      try {
        detailsStr = JSON.stringify(error.details);
      } catch {
        detailsStr = safeStr(error.details);
      }
    }
    if (safeStr(detailsStr)) parts.push(`details=${detailsStr}`);
  }

  if (!parts.length) {
    parts.push(safeStr(error));
  }

  return parts.join(" | ").slice(0, max);
}

function safeJsonStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        if (typeof val === "bigint") return String(val);
        if (typeof val === "function") return `[Function ${val.name || "anonymous"}]`;
        return val;
      },
      2
    );
  } catch (error) {
    return `<<stringify_failed: ${safeStr(error && error.message)}>>`;
  }
}

function asBool(value, fallback = false) {
  const v = safeStr(value).toLowerCase();
  if (!v) return fallback;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function parsePrivateKey(raw) {
  return safeStr(raw).replace(/\\n/g, "\n");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!safeStr(value)) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseAllowedOrigins(raw) {
  const list = safeStr(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(list);
}

function isValidRole(role) {
  return ["user", "staff", "admin"].includes(safeStr(role).toLowerCase());
}

function isValidPlatform(platform) {
  return ["android", "web", "ios"].includes(safeStr(platform).toLowerCase());
}

function validateToken(token) {
  const t = safeStr(token);
  if (!t) return "token is required";
  if (t.length < 20) return "token looks invalid";
  if (t.includes("/")) return "token must not contain '/' for Firestore doc id";
  return "";
}

const FIREBASE_PROJECT_ID = requireEnv("FIREBASE_PROJECT_ID");
const FIREBASE_CLIENT_EMAIL = requireEnv("FIREBASE_CLIENT_EMAIL");
const FIREBASE_PRIVATE_KEY = parsePrivateKey(requireEnv("FIREBASE_PRIVATE_KEY"));

const PORT = Number(process.env.PORT || 10000);
const POLL_INTERVAL_MS = Math.max(1000, Number(process.env.POLL_INTERVAL_MS || 5000));
const POLL_LIMIT = Math.max(1, Math.min(200, Number(process.env.POLL_LIMIT || 100)));
const CORS_ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || ""
);
const LOG_VERBOSE = asBool(process.env.LOG_VERBOSE, true);

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY,
  }),
});

const firestore = admin.firestore();
const messaging = admin.messaging();
const { FieldValue } = admin.firestore;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl/native/no-origin
      if (CORS_ALLOWED_ORIGINS.size === 0) return callback(null, true);
      if (CORS_ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      return callback(new Error("CORS origin not allowed"));
    },
  })
);

function tokenCollectionRef({ uid, role }) {
  const safeUid = safeStr(uid);
  const safeRole = safeStr(role).toLowerCase();
  if (!safeUid) return null;
  if (safeRole === "staff") {
    return firestore.collection("staff").doc(safeUid).collection("pushTokens");
  }
  return firestore.collection("users").doc(safeUid).collection("pushTokens"); // user + admin
}

function makeTokenDocId(token) {
  const t = safeStr(token);
  if (!t || t.includes("/")) return "";
  return t;
}

function notificationDocMetaFromPath(docSnap) {
  const segments = docSnap.ref.path.split("/");
  // users/{uid}/notifications/{nid} OR staff/{uid}/notifications/{nid}
  if (segments.length !== 4) return null;
  const root = safeStr(segments[0]).toLowerCase();
  const uid = safeStr(segments[1]);
  const nid = safeStr(segments[3]);
  if (!uid || !nid) return null;
  if (root !== "users" && root !== "staff") return null;
  return {
    root,
    uid,
    notificationId: nid,
  };
}

function isPushWorthyNotification(data) {
  const type = safeStr(data?.type).toUpperCase();
  if (["NEW_MESSAGE", "NEW_REQUEST", "STATUS_UPDATE"].includes(type)) return true;
  return Boolean(safeStr(data?.title) && safeStr(data?.body));
}

function toFcmDataMap(input = {}) {
  const out = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    if (!safeStr(key)) return;
    if (value == null) return;
    if (typeof value === "string") {
      out[key] = value;
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
      return;
    }
    try {
      out[key] = JSON.stringify(value);
    } catch {
      // skip
    }
  });
  return out;
}

async function listPushTokens({ uid, role }) {
  const colRef = tokenCollectionRef({ uid, role });
  if (!colRef) return [];
  const snap = await colRef.get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .map((row) => ({
      id: safeStr(row.id),
      token: safeStr(row.token || row.id),
      platform: safeStr(row.platform).toLowerCase() || "android",
      role: safeStr(row.role).toLowerCase() || safeStr(role).toLowerCase(),
    }))
    .filter((row) => row.token);
}

function isTokenErrorRemovable(code) {
  const c = safeStr(code);
  return (
    c === "messaging/registration-token-not-registered" ||
    c === "messaging/invalid-registration-token"
  );
}

async function removeInvalidTokenDocs({ uid, role, tokenIds = [] }) {
  const ids = (tokenIds || []).map((x) => safeStr(x)).filter(Boolean);
  if (!ids.length) return;
  const colRef = tokenCollectionRef({ uid, role });
  if (!colRef) return;

  const batch = firestore.batch();
  ids.forEach((id) => batch.delete(colRef.doc(id)));
  await batch.commit();
}

async function sendPushToTokens({ uid, role, title, body, data }) {
  const tokens = await listPushTokens({ uid, role });
  if (!tokens.length) {
    return { ok: true, pushStatus: "skipped_no_tokens", sentCount: 0, failedCount: 0 };
  }

  const tokenValues = tokens.map((t) => t.token);
  const tokenByValue = new Map(tokens.map((t) => [t.token, t]));

  const message = {
    tokens: tokenValues,
    notification: {
      title: safeStr(title) || "MAJUU",
      body: safeStr(body) || "You have an update.",
    },
    data: toFcmDataMap(data),
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "default",
      },
    },
  };

  const response = await messaging.sendEachForMulticast(message);

  let sentCount = 0;
  let failedCount = 0;
  let firstError = "";
  const invalidTokenDocIds = [];

  response.responses.forEach((r, index) => {
    if (r.success) {
      sentCount += 1;
      return;
    }
    failedCount += 1;
    const code = safeStr(r.error && r.error.code);
    if (!firstError) firstError = safeStr(code || (r.error && r.error.message));
    if (isTokenErrorRemovable(code)) {
      const tokenValue = tokenValues[index];
      const tokenRow = tokenByValue.get(tokenValue);
      if (tokenRow?.id) invalidTokenDocIds.push(tokenRow.id);
    }
  });

  if (invalidTokenDocIds.length) {
    try {
      await removeInvalidTokenDocs({ uid, role, tokenIds: invalidTokenDocIds });
    } catch (error) {
      console.warn(`[${nowIso()}] failed to remove invalid token docs`, shortErr(error));
    }
  }

  if (sentCount > 0) {
    return {
      ok: true,
      pushStatus: "sent",
      sentCount,
      failedCount,
      pushError: failedCount > 0 ? shortErr(firstError) : "",
    };
  }

  return {
    ok: false,
    pushStatus: "failed",
    sentCount,
    failedCount,
    pushError: shortErr(firstError || "FCM send failed"),
  };
}

async function markNotificationPushResult(docRef, result) {
  const patch = {
    pushedAt: FieldValue.serverTimestamp(),
    pushStatus: safeStr(result?.pushStatus || "failed"),
  };

  if (patch.pushStatus === "failed" && safeStr(result?.pushError)) {
    patch.pushError = shortErr(result.pushError);
  } else {
    patch.pushError = FieldValue.delete();
  }

  patch.pushMeta = {
    sentCount: Number(result?.sentCount || 0) || 0,
    failedCount: Number(result?.failedCount || 0) || 0,
    processedBy: "render-push-server",
  };

  await docRef.set(patch, { merge: true });
}

async function processNotificationDoc(docSnap) {
  const meta = notificationDocMetaFromPath(docSnap);
  if (!meta) return { skipped: true, reason: "unsupported_path" };

  const data = docSnap.data() || {};
  if (data?.pushedAt) return { skipped: true, reason: "already_pushed" };
  if (!isPushWorthyNotification(data)) {
    await markNotificationPushResult(docSnap.ref, {
      pushStatus: "skipped_no_tokens", // still mark processed to avoid repeat for non-push docs
      sentCount: 0,
      failedCount: 0,
      pushError: "",
    });
    return { skipped: true, reason: "not_push_worthy" };
  }

  const title = safeStr(data?.title) || "MAJUU";
  const body = safeStr(data?.body) || "You have an update.";
  const roleField = safeStr(data?.role).toLowerCase();
  const tokenRole = meta.root === "staff" ? "staff" : roleField === "admin" ? "admin" : "user";
  const route = safeStr(data?.route);

  try {
    const sendResult = await sendPushToTokens({
      uid: meta.uid,
      role: tokenRole,
      title,
      body,
      data: {
        route,
        type: safeStr(data?.type),
        requestId: safeStr(data?.requestId),
        notificationId: meta.notificationId,
        role: tokenRole,
      },
    });

    await markNotificationPushResult(docSnap.ref, sendResult);
    return { ok: true, ...sendResult, path: docSnap.ref.path };
  } catch (error) {
    const result = {
      pushStatus: "failed",
      sentCount: 0,
      failedCount: 0,
      pushError: shortErr(error),
    };
    try {
      await markNotificationPushResult(docSnap.ref, result);
    } catch (markErr) {
      console.warn(
        `[${nowIso()}] failed to mark push result for ${docSnap.ref.path}`,
        shortErr(markErr)
      );
    }
    return { ok: false, ...result, path: docSnap.ref.path };
  }
}

let pollInFlight = false;

async function pollNotificationsOnce() {
  if (pollInFlight) return;
  pollInFlight = true;

  try {
    console.log(`[${nowIso()}] poll query`, {
      collectionGroup: "notifications",
      orderBy: [{ field: "createdAt", direction: "desc" }],
      limit: POLL_LIMIT,
      filters: [],
      indexMatch: {
        collectionId: "notifications",
        queryScope: "COLLECTION_GROUP",
        fields: [{ field: "createdAt", order: "DESCENDING" }],
      },
    });

    const { FieldPath } = admin.firestore;

const snap = await firestore
  .collectionGroup("notifications")
  .orderBy("createdAt", "desc")
  .orderBy(FieldPath.documentId(), "asc") // must match your index (__name__ asc)
  .limit(POLL_LIMIT)
  .get();

    const candidates = snap.docs
      .filter((d) => {
        const meta = notificationDocMetaFromPath(d);
        if (!meta) return false;
        const data = d.data() || {};
        return !data?.pushedAt;
      })
      .sort((a, b) => {
        const aTs = a.data()?.createdAt?.toMillis ? a.data().createdAt.toMillis() : 0;
        const bTs = b.data()?.createdAt?.toMillis ? b.data().createdAt.toMillis() : 0;
        return aTs - bTs;
      });

    if (!candidates.length) return;

    if (LOG_VERBOSE) {
      console.log(`[${nowIso()}] polling ${candidates.length} notification(s)`);
    }

    for (const docSnap of candidates) {
      const result = await processNotificationDoc(docSnap);
      if (LOG_VERBOSE && !result?.skipped) {
        console.log(
          `[${nowIso()}] push ${result?.pushStatus || "unknown"} ${docSnap.ref.path} sent=${result?.sentCount || 0} failed=${result?.failedCount || 0}`
        );
      }
    }
  } catch (error) {
    const metaDump =
      error && error.metadata && typeof error.metadata.getMap === "function"
        ? error.metadata.getMap()
        : error && error.metadata;

    console.error(`[${nowIso()}] poll loop error code`, error && error.code);
    console.error(`[${nowIso()}] poll loop error message`, error && error.message);
    console.error(`[${nowIso()}] poll loop error details`, error && error.details);
    console.error(`[${nowIso()}] poll loop error metadata`, metaDump);
    console.error(
      `[${nowIso()}] poll loop error full json`,
      safeJsonStringify({
        code: error && error.code,
        message: error && error.message,
        details: error && error.details,
        metadata: metaDump,
        rawError: error,
      })
    );
    console.error(`[${nowIso()}] poll loop raw error object`, error);
  } finally {
    pollInFlight = false;
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "majuu-push-server",
    pollIntervalMs: POLL_INTERVAL_MS,
    time: nowIso(),
  });
});

app.post("/registerToken", async (req, res) => {
  try {
    const uid = safeStr(req.body && req.body.uid);
    const role = safeStr(req.body && req.body.role).toLowerCase();
    const token = safeStr(req.body && req.body.token);
    const platform = safeStr(req.body && req.body.platform).toLowerCase();

    if (!uid) return res.status(400).json({ ok: false, error: "uid is required" });
    if (!isValidRole(role)) {
      return res.status(400).json({ ok: false, error: "role must be user|staff|admin" });
    }
    if (!isValidPlatform(platform)) {
      return res.status(400).json({ ok: false, error: "platform must be android|ios|web" });
    }

    const tokenErr = validateToken(token);
    if (tokenErr) return res.status(400).json({ ok: false, error: tokenErr });

    const colRef = tokenCollectionRef({ uid, role });
    if (!colRef) return res.status(400).json({ ok: false, error: "invalid uid/role" });

    const docId = makeTokenDocId(token);
    if (!docId) return res.status(400).json({ ok: false, error: "invalid token doc id" });

    await colRef.doc(docId).set(
      {
        token,
        platform,
        role,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.json({ ok: true, storedAt: `${colRef.path}/${docId}` });
  } catch (error) {
    console.error(`[${nowIso()}] /registerToken error`, shortErr(error));
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

app.post("/sendTest", async (req, res) => {
  try {
    const uid = safeStr(req.body && req.body.uid);
    const role = safeStr(req.body && req.body.role).toLowerCase();
    const title = safeStr(req.body && req.body.title) || "MAJUU Test";
    const body = safeStr(req.body && req.body.body) || "Test push from Render server";
    const data = req.body && typeof req.body.data === "object" ? req.body.data : {};

    if (!uid) return res.status(400).json({ ok: false, error: "uid is required" });
    if (!isValidRole(role)) {
      return res.status(400).json({ ok: false, error: "role must be user|staff|admin" });
    }

    const result = await sendPushToTokens({ uid, role, title, body, data });
    return res.json({ ok: true, result });
  } catch (error) {
    console.error(`[${nowIso()}] /sendTest error`, shortErr(error));
    return res.status(500).json({ ok: false, error: shortErr(error) || "internal_error" });
  }
});

app.listen(PORT, () => {
  console.log(`[${nowIso()}] MAJUU push server listening on port ${PORT}`);
  console.log(
    `[${nowIso()}] firebase admin project=${FIREBASE_PROJECT_ID} clientEmail=${FIREBASE_CLIENT_EMAIL}`
  );
  console.log(`[${nowIso()}] poll interval ${POLL_INTERVAL_MS}ms, poll limit ${POLL_LIMIT}`);
  setInterval(() => {
    pollNotificationsOnce().catch((error) => {
      console.error(`[${nowIso()}] unhandled poll error`, shortErr(error));
    });
  }, POLL_INTERVAL_MS);
  // Run once on boot so first sends aren't delayed by the interval.
  pollNotificationsOnce().catch((error) => {
    console.error(`[${nowIso()}] boot poll error`, shortErr(error));
  });
});

/*
 * MAJUU Render Push Server (client-triggered only; no Firestore polling/scanning)
 *
 * Required env vars:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY
 * - PUSH_SERVER_API_KEY (required in production; shared secret for POST endpoints)
 *
 * Optional env vars:
 * - PORT
 * - CORS_ALLOWED_ORIGINS (comma-separated)
 * - CORS_ORIGIN (legacy single-origin fallback)
 * - LOG_VERBOSE (true|false, default true)
 * - FALLBACK_POLL_MS / POLL_INTERVAL_MS (legacy; only used to keep /health response shape)
 *
 * Testing notes:
 * curl -X POST https://<render>/sendPush \
 *   -H "content-type: application/json" \
 *   -H "x-api-key: <key>" \
 *   -d '{"toRole":"user","toUid":"UID","title":"Test","body":"Hello","data":{"type":"NEW_MESSAGE"}}'
 */

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

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const FIREBASE_PROJECT_ID = requireEnv("FIREBASE_PROJECT_ID");
const FIREBASE_CLIENT_EMAIL = requireEnv("FIREBASE_CLIENT_EMAIL");
const FIREBASE_PRIVATE_KEY = parsePrivateKey(requireEnv("FIREBASE_PRIVATE_KEY"));

const NODE_ENV = safeStr(process.env.NODE_ENV).toLowerCase() || "development";
const PUSH_SERVER_API_KEY = safeStr(process.env.PUSH_SERVER_API_KEY);
if (NODE_ENV === "production" && !PUSH_SERVER_API_KEY) {
  throw new Error("Missing required env var in production: PUSH_SERVER_API_KEY");
}

const PORT = Number(process.env.PORT || 10000);
const LEGACY_POLL_INTERVAL_MS = Math.max(
  60000,
  Number(process.env.FALLBACK_POLL_MS || process.env.POLL_INTERVAL_MS || 180000)
);
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

function requireApiKey(req, res, next) {
  if (req.method === "OPTIONS") return next();
  if (req.path === "/health") return next();
  if (!PUSH_SERVER_API_KEY) return next(); // local/dev fallback when key is intentionally unset

  const provided = safeStr(req.get("x-api-key"));
  if (!provided || provided !== PUSH_SERVER_API_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  return next();
}

app.use(requireApiKey);

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
      // skip non-serializable values
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
  if (LOG_VERBOSE) {
    console.log(`[${nowIso()}] sendPushToTokens tokens`, {
      uid: safeStr(uid),
      role: safeStr(role),
      tokenCount: tokens.length,
    });
  }
  if (!tokens.length) {
    if (LOG_VERBOSE) {
      console.log(`[${nowIso()}] sendPushToTokens skipped_no_tokens`, {
        uid: safeStr(uid),
        role: safeStr(role),
      });
    }
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

  const summary = {
    ok: sentCount > 0,
    pushStatus: sentCount > 0 ? "sent" : "failed",
    sentCount,
    failedCount,
    pushError: sentCount > 0 ? (failedCount > 0 ? shortErr(firstError) : "") : shortErr(firstError || "FCM send failed"),
  };

  if (LOG_VERBOSE) {
    console.log(`[${nowIso()}] sendPushToTokens result`, {
      uid: safeStr(uid),
      role: safeStr(role),
      pushStatus: summary.pushStatus,
      sentCount: summary.sentCount,
      failedCount: summary.failedCount,
      pushError: summary.pushError || "",
    });
  }

  return summary;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "majuu-push-server",
    pollIntervalMs: LEGACY_POLL_INTERVAL_MS,
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

app.post("/sendPush", async (req, res) => {
  try {
    const toUid = safeStr(req.body && req.body.toUid);
    const toRole = safeStr(req.body && req.body.toRole).toLowerCase();
    const title = safeStr(req.body && req.body.title) || "MAJUU";
    const body = safeStr(req.body && req.body.body) || "You have an update.";
    const data = asPlainObject(req.body && req.body.data);

    if (!toUid) return res.status(400).json({ ok: false, error: "toUid is required" });
    if (!isValidRole(toRole)) {
      return res.status(400).json({ ok: false, error: "toRole must be user|staff|admin" });
    }

    if (LOG_VERBOSE) {
      console.log(`[${nowIso()}] /sendPush request`, {
        toRole,
        toUid,
        type: safeStr(data?.type),
        requestId: safeStr(data?.requestId),
      });
    }

    const result = await sendPushToTokens({
      uid: toUid,
      role: toRole,
      title,
      body,
      data,
    });

    if (LOG_VERBOSE) {
      console.log(`[${nowIso()}] /sendPush result`, {
        toRole,
        toUid,
        pushStatus: result?.pushStatus,
        sentCount: result?.sentCount,
        failedCount: result?.failedCount,
        pushError: result?.pushError || "",
      });
    }

    return res.json({ ok: true, result });
  } catch (error) {
    console.error(`[${nowIso()}] /sendPush error`, shortErr(error));
    return res.status(500).json({ ok: false, error: shortErr(error) || "internal_error" });
  }
});

app.post("/sendTest", async (req, res) => {
  try {
    const uid = safeStr(req.body && req.body.uid);
    const role = safeStr(req.body && req.body.role).toLowerCase();
    const title = safeStr(req.body && req.body.title) || "MAJUU Test";
    const body = safeStr(req.body && req.body.body) || "Test push from Render server";
    const data = asPlainObject(req.body && req.body.data);

    if (!uid) return res.status(400).json({ ok: false, error: "uid is required" });
    if (!isValidRole(role)) {
      return res.status(400).json({ ok: false, error: "role must be user|staff|admin" });
    }

    if (LOG_VERBOSE) {
      console.log(`[${nowIso()}] /sendTest request`, {
        role,
        uid,
        type: safeStr(data?.type),
        requestId: safeStr(data?.requestId),
      });
    }

    const result = await sendPushToTokens({ uid, role, title, body, data });
    return res.json({ ok: true, result });
  } catch (error) {
    console.error(`[${nowIso()}] /sendTest error`, shortErr(error));
    return res.status(500).json({ ok: false, error: shortErr(error) || "internal_error" });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[${nowIso()}] MAJUU push server listening on port ${PORT}`);
  console.log(
    `[${nowIso()}] firebase admin project=${FIREBASE_PROJECT_ID} clientEmail=${FIREBASE_CLIENT_EMAIL}`
  );
  console.log(
    `[${nowIso()}] client-triggered push mode enabled (no polling/scanning). auth=${
      PUSH_SERVER_API_KEY ? "api-key" : "disabled-dev"
    }`
  );
});

function shutdown(signal) {
  try {
    console.log(`[${nowIso()}] ${safeStr(signal) || "signal"} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref?.();
  } catch {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));


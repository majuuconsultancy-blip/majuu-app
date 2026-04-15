const path = require("path");
const os = require("os");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const APP_NAME = "majuu-local-payment-backend";
const NODE_ENV = safeStr(process.env.NODE_ENV).toLowerCase() || "development";
const HOST = safeStr(process.env.HOST) || "0.0.0.0";
const PORT = toPositiveInt(process.env.PORT, 5000);
const REQUEST_TIMEOUT_MS = Math.max(3000, toPositiveInt(process.env.REQUEST_TIMEOUT_MS, 15000));
const FRONTEND_BASE_URL = trimTrailingSlash(
  process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL
);
const MPESA_SECRET = safeStr(
  process.env.MPESA_SECRET || process.env.MPESA_SECRET_KEY || process.env.MPESA_SECRET_KEY_TEST
);
const PAYSTACK_SECRET = safeStr(
  process.env.PAYSTACK_SECRET || process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY_TEST
);
const PAYMENT_PROVIDER_KEYS = new Set(["mpesa", "paystack"]);
const DEFAULT_PAYMENT_PROVIDER = normalizeProviderKey(
  process.env.PAYMENT_PROVIDER_DEFAULT || "mpesa",
  "mpesa"
);
const PAYMENT_DEBUG =
  safeStr(process.env.PAYMENT_DEBUG).toLowerCase() === "true" || NODE_ENV !== "production";
const CORS_ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || ""
);

function safeStr(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function trimTrailingSlash(value) {
  return safeStr(value, 1000).replace(/\/+$/, "");
}

function toPositiveInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : fallback;
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseAllowedOrigins(raw) {
  return new Set(
    safeStr(raw)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function normalizeEmail(value) {
  return safeStr(value, 160).toLowerCase();
}

function normalizeReference(value) {
  return safeStr(value, 120);
}

function normalizeAmount(value) {
  const source = typeof value === "string" ? value.replace(/[^0-9.]+/g, "") : value;
  const num = Number(source || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

function normalizeCurrency(value) {
  return safeStr(value || "KES", 8).toUpperCase() || "KES";
}

function normalizeProviderKey(value, fallback = "mpesa") {
  const raw = safeStr(value, 40).toLowerCase();
  if (PAYMENT_PROVIDER_KEYS.has(raw)) return raw;
  const safeFallback = safeStr(fallback, 40).toLowerCase();
  return PAYMENT_PROVIDER_KEYS.has(safeFallback) ? safeFallback : "mpesa";
}

function resolveProviderTransport(providerKey = "") {
  const provider = normalizeProviderKey(providerKey, DEFAULT_PAYMENT_PROVIDER);
  const envKey = `PAYMENT_PROVIDER_TRANSPORT_${provider.toUpperCase()}`;
  const configured = safeStr(process.env?.[envKey], 40).toLowerCase();
  if (configured) return configured;
  if (provider === "paystack") return "paystack";
  // MPESA default can proxy to paystack transport until dedicated adapter is enabled.
  return "paystack";
}

function getProviderSecret(providerKey = "") {
  const provider = normalizeProviderKey(providerKey, DEFAULT_PAYMENT_PROVIDER);
  if (provider === "paystack") {
    return PAYSTACK_SECRET;
  }
  return MPESA_SECRET || PAYSTACK_SECRET;
}

function toAmountMinor(value) {
  return normalizeAmount(value) * 100;
}

function normalizeMetadata(input = {}) {
  const source = asPlainObject(input);
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const cleanKey = safeStr(key, 80);
    if (!cleanKey) continue;
    if (Array.isArray(value)) {
      const next = value
        .map((item) => safeStr(item, 160))
        .filter(Boolean)
        .slice(0, 60);
      if (next.length) out[cleanKey] = next;
      continue;
    }
    if (typeof value === "boolean") {
      out[cleanKey] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[cleanKey] = value;
      continue;
    }
    const next = safeStr(value, 600);
    if (next) out[cleanKey] = next;
  }
  return out;
}

function appendQueryParam(url, key, value) {
  const next = safeStr(value, 600);
  if (next) {
    url.searchParams.set(key, next);
  }
}

function buildCallbackUrl({ metadata, reference }) {
  const data = normalizeMetadata(metadata);
  const baseUrl = trimTrailingSlash(data.appBaseUrl || FRONTEND_BASE_URL);
  const callbackPath = safeStr(data.callbackPath || "/payment/callback", 240) || "/payment/callback";
  if (!baseUrl) return "";

  let url = null;
  try {
    url = /^https?:\/\//i.test(callbackPath)
      ? new URL(callbackPath)
      : new URL(`${baseUrl}${callbackPath.startsWith("/") ? "" : "/"}${callbackPath}`);
  } catch {
    return "";
  }

  appendQueryParam(url, "reference", reference);
  appendQueryParam(url, "requestId", data.requestId);
  appendQueryParam(url, "paymentId", data.paymentId);
  appendQueryParam(url, "returnTo", data.returnTo);
  appendQueryParam(url, "draft", data.draftId);
  appendQueryParam(url, "share", data.shareToken);
  appendQueryParam(url, "fullPackageId", data.fullPackageId);

  return url.toString();
}

function getLanHealthUrls() {
  const urls = new Set([
    `http://127.0.0.1:${PORT}/health`,
    `http://localhost:${PORT}/health`,
  ]);

  const networks = os.networkInterfaces();
  for (const rows of Object.values(networks)) {
    for (const row of rows || []) {
      if (!row || row.family !== "IPv4" || row.internal) continue;
      urls.add(`http://${row.address}:${PORT}/health`);
    }
  }

  return Array.from(urls);
}

function shortError(error) {
  if (!error) return "unknown error";
  const message =
    safeStr(error?.response?.data?.message, 600) ||
    safeStr(error?.message, 600) ||
    safeStr(error, 600);
  return message || "unknown error";
}

function paymentDebugLog(label, payload) {
  if (!PAYMENT_DEBUG) return;
  if (payload === undefined) {
    console.log(`[payment-debug] ${label}`);
    return;
  }
  console.log(`[payment-debug] ${label}`, payload);
}

async function paystackRequest({ method = "GET", endpointPath, data, secretKey = "" } = {}) {
  const resolvedSecret = safeStr(secretKey);
  if (!resolvedSecret) {
    const error = new Error("Paystack provider secret is missing. Add it to backend/.env.");
    error.statusCode = 500;
    throw error;
  }

  try {
    paymentDebugLog("paystack_request", {
      method,
      endpointPath,
      data: data || null,
    });
    const response = await axios({
      method,
      url: `https://api.paystack.co${endpointPath}`,
      data,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${resolvedSecret}`,
        "Content-Type": "application/json",
      },
    });
    paymentDebugLog("paystack_response", {
      method,
      endpointPath,
      data: response.data,
    });
    return response.data;
  } catch (error) {
    paymentDebugLog("paystack_error", {
      method,
      endpointPath,
      status: error?.response?.status || null,
      data: error?.response?.data || null,
      message: error?.message || String(error),
    });
    const nextError = new Error(shortError(error));
    nextError.statusCode = Number(error?.response?.status || 502) || 502;
    nextError.details = error?.response?.data || null;
    throw nextError;
  }
}

async function callProviderRequest({
  provider = DEFAULT_PAYMENT_PROVIDER,
  transport = "",
  method = "GET",
  operation = "verify",
  reference = "",
  data = null,
} = {}) {
  const providerKey = normalizeProviderKey(provider, DEFAULT_PAYMENT_PROVIDER);
  const adapter = safeStr(transport, 40).toLowerCase() || resolveProviderTransport(providerKey);
  const secretKey = getProviderSecret(providerKey);

  if (adapter === "paystack") {
    if (operation === "initialize") {
      return paystackRequest({
        method,
        endpointPath: "/transaction/initialize",
        data,
        secretKey,
      });
    }
    if (operation === "verify") {
      return paystackRequest({
        method,
        endpointPath: `/transaction/verify/${encodeURIComponent(reference)}`,
        secretKey,
      });
    }
  }

  const error = new Error(`Provider adapter '${adapter || "unknown"}' is not supported yet.`);
  error.statusCode = 501;
  throw error;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (NODE_ENV !== "production") return callback(null, true);
      if (!CORS_ALLOWED_ORIGINS.size || CORS_ALLOWED_ORIGINS.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin not allowed"));
    },
  })
);

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

async function handleInitializeProvider(req, res, next, { forcedProvider = "" } = {}) {
  try {
    paymentDebugLog("initialize_req_body", req.body || null);
    const provider = normalizeProviderKey(
      forcedProvider ||
        req.body?.provider ||
        req.query?.provider ||
        req.headers?.["x-payment-provider"] ||
        DEFAULT_PAYMENT_PROVIDER,
      DEFAULT_PAYMENT_PROVIDER
    );
    const adapter = resolveProviderTransport(provider);
    const email = normalizeEmail(req.body?.email);
    const amount = normalizeAmount(req.body?.amount);
    const currency = normalizeCurrency(req.body?.currency || req.body?.metadata?.currency || "KES");
    const reference = normalizeReference(req.body?.reference);
    const metadata = normalizeMetadata(req.body?.metadata);

    if (!email || !email.includes("@")) {
      return res.status(400).json({ ok: false, message: "A valid email is required." });
    }
    if (amount <= 0) {
      return res.status(400).json({ ok: false, message: "A valid amount is required." });
    }
    if (!reference) {
      return res.status(400).json({ ok: false, message: "A payment reference is required." });
    }

    const callbackUrl = buildCallbackUrl({ metadata, reference });
    const payload = {
      email,
      amount: toAmountMinor(amount),
      currency,
      reference,
      metadata: {
        ...metadata,
        provider,
      },
    };
    if (callbackUrl) {
      payload.callback_url = callbackUrl;
    }
    paymentDebugLog("initialize_provider_payload", {
      provider,
      adapter,
      callbackUrl,
      payload,
    });

    const result = await callProviderRequest({
      provider,
      transport: adapter,
      method: "POST",
      operation: "initialize",
      data: payload,
    });

    return res.json({
      ok: result?.status === true,
      provider,
      adapter,
      message: safeStr(result?.message, 200) || "Checkout initialized.",
      callbackUrl: callbackUrl || null,
      data: asPlainObject(result?.data),
    });
  } catch (error) {
    return next(error);
  }
}

async function handleVerifyProvider(req, res, next, { forcedProvider = "" } = {}) {
  try {
    const provider = normalizeProviderKey(
      forcedProvider ||
        req.query?.provider ||
        req.headers?.["x-payment-provider"] ||
        DEFAULT_PAYMENT_PROVIDER,
      DEFAULT_PAYMENT_PROVIDER
    );
    const adapter = resolveProviderTransport(provider);
    const reference = normalizeReference(req.params?.reference);
    if (!reference) {
      return res.status(400).json({ ok: false, message: "A payment reference is required." });
    }

    const result = await callProviderRequest({
      provider,
      transport: adapter,
      method: "GET",
      operation: "verify",
      reference,
    });
    const data = asPlainObject(result?.data);
    const status = safeStr(data?.status, 80).toLowerCase();

    return res.json({
      ok: status === "success",
      provider,
      adapter,
      message: safeStr(result?.message, 200) || "Verification complete.",
      status,
      reference: safeStr(data?.reference || reference, 120),
      data,
    });
  } catch (error) {
    return next(error);
  }
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: APP_NAME,
    env: NODE_ENV,
    host: HOST,
    port: PORT,
    providerDefaults: {
      activeProvider: DEFAULT_PAYMENT_PROVIDER,
      activeAdapter: resolveProviderTransport(DEFAULT_PAYMENT_PROVIDER),
    },
    providers: {
      mpesa: {
        configured: Boolean(getProviderSecret("mpesa")),
        adapter: resolveProviderTransport("mpesa"),
      },
      paystack: {
        configured: Boolean(getProviderSecret("paystack")),
        adapter: resolveProviderTransport("paystack"),
      },
    },
    frontendBaseUrl: FRONTEND_BASE_URL || null,
    healthUrls: getLanHealthUrls(),
    now: new Date().toISOString(),
  });
});

app.post("/payments/initialize", async (req, res, next) => {
  await handleInitializeProvider(req, res, next);
});

app.get("/payments/verify/:reference", async (req, res, next) => {
  await handleVerifyProvider(req, res, next);
});

// Backward-compatible aliases for older Paystack-only clients.
app.post("/paystack/initialize", async (req, res, next) => {
  await handleInitializeProvider(req, res, next, { forcedProvider: "paystack" });
});

app.get("/paystack/verify/:reference", async (req, res, next) => {
  await handleVerifyProvider(req, res, next, { forcedProvider: "paystack" });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found." });
});

app.use((error, _req, res, _next) => {
  const statusCode = Number(error?.statusCode || 500) || 500;
  console.error(`[${new Date().toISOString()}] backend_error`, shortError(error));
  paymentDebugLog("backend_error_details", {
    statusCode,
    message: error?.message || null,
    details: error?.details || null,
  });
  res.status(statusCode).json({
    ok: false,
    message: safeStr(error?.message, 400) || "Backend request failed.",
    details: error?.details || null,
  });
});

process.on("unhandledRejection", (error) => {
  console.error(`[${new Date().toISOString()}] unhandled_rejection`, shortError(error));
});

process.on("uncaughtException", (error) => {
  console.error(`[${new Date().toISOString()}] uncaught_exception`, shortError(error));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] ${APP_NAME} listening`);
  console.log(`Host: ${HOST}`);
  console.log(`Port: ${PORT}`);
  console.log(
    `Default provider: ${DEFAULT_PAYMENT_PROVIDER} (adapter: ${resolveProviderTransport(DEFAULT_PAYMENT_PROVIDER)})`
  );
  console.log(`M-Pesa secret configured: ${getProviderSecret("mpesa") ? "yes" : "no"}`);
  console.log(`Paystack secret configured: ${getProviderSecret("paystack") ? "yes" : "no"}`);
  console.log(`Frontend base URL: ${FRONTEND_BASE_URL || "not set"}`);
  console.log("Health URLs:");
  for (const url of getLanHealthUrls()) {
    console.log(`- ${url}`);
  }
});

server.on("error", (error) => {
  console.error(`[${new Date().toISOString()}] listen_error`, shortError(error));
});

module.exports = { app, server };

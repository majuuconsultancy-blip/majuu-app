/* global Buffer, process */

import crypto from "node:crypto";

import { FieldValue, Timestamp, admin, db } from "./firebaseAdmin.js";
import { buildAbsoluteUrl, getBearerToken } from "./http.js";
import {
  MPESA_REFUND_CAPABILITIES,
  buildRefundPlaceholder,
} from "./mpesaRefundService.js";

const FINANCE_SETTINGS_COLLECTION = "financeSettings";
const FINANCE_SETTINGS_DOC = "global";
const PAYMENT_PROVIDER_CONFIG_COLLECTION = "paymentProviderConfigs";
const PAYMENT_PROVIDER_CONFIG_DOC = "global";
const PAYMENT_PROVIDER_REFS_COLLECTION = "paymentProviderReferences";
const PAYMENT_PROVIDER_EVENTS_COLLECTION = "paymentProviderEvents";
const PAYMENT_SHARE_LINKS_COLLECTION = "paymentShareLinks";
const PAYOUT_QUEUE_COLLECTION = "payoutQueue";
const SETTLEMENT_HISTORY_COLLECTION = "settlementHistory";
const FINANCIAL_AUDIT_LOG_COLLECTION = "financialAuditLogs";
const ACTIVE_REQUEST_STATUSES = new Set(["new", "contacted"]);
const ACTIVE_ADMIN_ROLE_KEYS = new Set(["superAdmin", "assignedAdmin"]);
const FINANCE_MANAGER_ROLE_KEYS = new Set(["superAdmin", "assignedAdmin", "manager"]);
const PROVIDER_ENVIRONMENTS = new Set(["test", "live"]);
const PROVIDER_SECRET_FIELDS = ["consumerKey", "consumerSecret", "passkey"];
const PAYMENT_READY_STATUSES = new Set([
  "payable",
  "payment_session_created",
  "awaiting_payment",
  "failed",
]);
const PAYMENT_SUCCESS_STATUSES = new Set(["paid", "held", "payout_ready", "settled"]);

export const PAYMENT_TYPES = Object.freeze({
  UNLOCK_REQUEST: "unlock_request",
  IN_PROGRESS: "in_progress",
});

export const PAYMENT_STATUSES = Object.freeze({
  DRAFT: "draft",
  PROMPTED: "prompted",
  ADMIN_REVIEW: "admin_review",
  APPROVED: "approved",
  PAYABLE: "payable",
  PAYMENT_SESSION_CREATED: "payment_session_created",
  AWAITING_PAYMENT: "awaiting_payment",
  PAID: "paid",
  HELD: "held",
  PAYOUT_READY: "payout_ready",
  SETTLED: "settled",
  REFUND_REQUESTED: "refund_requested",
  REFUND_UNDER_REVIEW: "refund_under_review",
  REFUNDED: "refunded",
  REVOKED: "revoked",
  EXPIRED: "expired",
  FAILED: "failed",
  AUTO_REFUNDED: "auto_refunded",
});

export const REFUND_STATUSES = Object.freeze({
  REQUESTED: "requested",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  REFUNDED: "refunded",
  FAILED: "failed",
  AUTO_REFUNDED: "auto_refunded",
});

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return safeString(value, max).toLowerCase();
}

function cleanParagraph(value, max = 2000) {
  return safeString(value, max).replace(/\s+/g, " ").trim();
}

function roundMoney(value) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.round(next));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function nowMs() {
  return Date.now();
}

function timestampToMs(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrency(value, fallback = "KES") {
  return safeString(value || fallback, 8).toUpperCase() || fallback;
}

function _normalizeTrack(value) {
  const next = lower(value, 24);
  return next === "work" || next === "travel" ? next : "study";
}

function normalizeProviderEnvironment(value, fallback = "test") {
  const next = lower(value, 20);
  if (next === "live" || next === "production") return "live";
  if (next === "sandbox") return "test";
  return PROVIDER_ENVIRONMENTS.has(next) ? next : fallback === "live" ? "live" : "test";
}

function normalizePhoneNumber(value = "") {
  const digits = safeString(value, 40).replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("254") && digits.length >= 12) {
    const local = digits.slice(3).slice(-9);
    return /^(7|1)\d{8}$/.test(local) ? `254${local}` : "";
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    const local = digits.slice(1).slice(-9);
    return /^(7|1)\d{8}$/.test(local) ? `254${local}` : "";
  }
  if (/^(7|1)\d{8}$/.test(digits.slice(-9))) {
    return `254${digits.slice(-9)}`;
  }
  return "";
}

function cleanStringList(values, { maxItems = 60, maxLen = 160 } = {}) {
  const input = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  for (const row of input) {
    const next = safeString(row, maxLen);
    const key = lower(next, maxLen);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(next);
    if (out.length >= maxItems) break;
  }
  return out;
}

function dedupeLowercaseStrings(values = [], maxItems = 80) {
  return cleanStringList(values, { maxItems, maxLen: 140 }).map((value) => lower(value, 140));
}

function safeJsonClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function readEnvValue(keys = [], max = 4000) {
  for (const key of Array.isArray(keys) ? keys : []) {
    const value = safeString(process.env?.[key], max);
    if (value) return value;
  }
  return "";
}

function buildEnvironmentScopedEnvKeys(baseKey, environment = "test") {
  const envKey = normalizeProviderEnvironment(environment);
  const out =
    envKey === "live"
      ? [`${baseKey}_LIVE`, `${baseKey}_PRODUCTION`, baseKey]
      : [`${baseKey}_TEST`, `${baseKey}_SANDBOX`, baseKey];
  return Array.from(new Set(out.filter(Boolean)));
}

function buildRuntimeUrl(baseUrl = "", input = "") {
  const safeInput = safeString(input, 1000);
  if (!safeInput) return "";
  try {
    if (/^https?:\/\//i.test(safeInput)) {
      return new URL(safeInput).toString();
    }
    const normalizedBase = safeString(baseUrl, 1000).replace(/\/+$/, "");
    if (!normalizedBase) return safeInput;
    return new URL(safeInput, `${normalizedBase}/`).toString();
  } catch {
    return safeInput;
  }
}

function isHttpUrl(value = "") {
  try {
    const url = new URL(safeString(value, 1000));
    return /^https?:$/i.test(url.protocol);
  } catch {
    return false;
  }
}

function maskPhoneNumber(value = "") {
  const phone = normalizePhoneNumber(value);
  if (!phone) return "";
  return `${phone.slice(0, 6)}***${phone.slice(-3)}`;
}

function logPaymentLifecycle(eventType = "", details = {}, level = "info") {
  const logger =
    level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger(`[mpesa] ${safeString(eventType, 120) || "event"}`, safeJsonClone(details) || {});
}

function buildReference(prefix = "MJM") {
  const datePart = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${safeString(prefix, 6).toUpperCase()}-${datePart}-${rand}`;
}

function buildAttemptId(prefix = "ATT") {
  return `${safeString(prefix, 8).toUpperCase()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

function buildShareToken() {
  return crypto.randomBytes(20).toString("hex");
}

function buildDarajaTimestamp(date = new Date()) {
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

function parseDarajaMetadata(callback = {}) {
  const rows = Array.isArray(callback?.CallbackMetadata?.Item)
    ? callback.CallbackMetadata.Item
    : [];
  return rows.reduce((acc, item) => {
    const key = safeString(item?.Name, 120);
    if (!key) return acc;
    acc[key] = item?.Value;
    return acc;
  }, {});
}

function parseDarajaTransactionDate(value) {
  const raw = safeString(value, 32);
  if (!/^\d{14}$/.test(raw)) return 0;
  const yyyy = Number(raw.slice(0, 4));
  const mm = Number(raw.slice(4, 6)) - 1;
  const dd = Number(raw.slice(6, 8));
  const hh = Number(raw.slice(8, 10));
  const min = Number(raw.slice(10, 12));
  const ss = Number(raw.slice(12, 14));
  const parsed = new Date(yyyy, mm, dd, hh, min, ss).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundRate(value) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.round(next * 100) / 100);
}

function normalizeRole(value) {
  const role = lower(value, 40);
  if (
    role === "superadmin" ||
    role === "super_admin" ||
    role === "super-admin" ||
    role === "super admin"
  ) {
    return "superAdmin";
  }
  if (
    role === "assignedadmin" ||
    role === "assigned_admin" ||
    role === "assigned-admin" ||
    role === "assigned admin" ||
    role === "admin"
  ) {
    return "assignedAdmin";
  }
  if (
    role === "manager" ||
    role === "assignedmanager" ||
    role === "assigned_manager" ||
    role === "assigned-manager" ||
    role === "assigned manager"
  ) {
    return "manager";
  }
  if (role === "staff") return "staff";
  return "user";
}

function normalizeAdminScope(scope = {}) {
  const safeScope = scope && typeof scope === "object" ? scope : {};
  const stationedCountry = safeString(
    safeScope?.stationedCountry || safeScope?.country,
    120
  );
  const countries = cleanStringList(
    [
      ...(Array.isArray(safeScope?.countries) ? safeScope.countries : []),
      ...(Array.isArray(safeScope?.derivedCoverage?.countries)
        ? safeScope.derivedCoverage.countries
        : []),
      stationedCountry,
    ],
    { maxItems: 80, maxLen: 120 }
  );
  const counties = cleanStringList(
    [
      ...(Array.isArray(safeScope?.counties) ? safeScope.counties : []),
      ...(Array.isArray(safeScope?.neighboringCounties)
        ? safeScope.neighboringCounties
        : []),
      safeScope?.primaryCounty,
      safeScope?.county,
    ],
    { maxItems: 120, maxLen: 120 }
  );
  return {
    partnerId: safeString(safeScope?.partnerId, 140),
    partnerName: safeString(safeScope?.partnerName, 140),
    stationedCountryLower: lower(
      safeScope?.stationedCountryLower || safeScope?.countryLower || stationedCountry,
      120
    ),
    countriesLower: dedupeLowercaseStrings(countries),
    countiesLower: dedupeLowercaseStrings(counties, 120),
    availability:
      lower(safeScope?.availability, 20) === "busy"
        ? "busy"
        : lower(safeScope?.availability, 20) === "offline"
        ? "offline"
        : "active",
    active: safeScope?.active !== false,
  };
}

function normalizeFeeType(value, fallback = "percentage") {
  return lower(value, 20) === "flat" ? "flat" : fallback === "flat" ? "flat" : "percentage";
}

function defaultFinanceSettings() {
  return {
    paymentProvider: {
      activeProvider: "mpesa",
      providerEnvironment: "test",
      providerCallbackUrl: "",
      paymentLinkBaseUrl: "",
      providers: {
        mpesa: {
          enabled: true,
          label: "M-Pesa",
        },
      },
    },
    pricingControls: {
      globalDiscountEnabled: false,
      globalDiscountPercentage: 0,
    },
    provider: {
      name: "mpesa",
      active: "mpesa",
      environment: "test",
      callbackBaseUrl: "",
      paymentLinkBaseUrl: "",
      providers: {
        mpesa: {
          enabled: true,
          label: "M-Pesa",
        },
      },
    },
    defaultCurrency: "KES",
    refundControls: {
      unlockAutoRefundHours: 48,
      autoRefundEnabled: true,
      sharedLinkExpiryHours: 72,
    },
    payoutControls: {
      manualReleaseOnly: true,
      requireDestination: true,
      deductProcessorFeeFromPartner: false,
    },
    inProgressPricing: {
      defaultCurrency: "KES",
      allowServiceFeeInput: true,
      allowAdminAdjustAmounts: true,
      platformCutEnabledGlobal: true,
    },
    platformFee: {
      defaultCutType: "percentage",
      defaultCutValue: 10,
      cutBase: "official_plus_service_fee",
    },
  };
}

function defaultProviderConfig() {
  return {
    providers: {
      mpesa: {
        test: {
          active: false,
          callbackUrl: "",
          settings: {
            shortcode: "",
            paybill: "",
            shortcodeType: "paybill",
            initiatorName: "",
          },
          secrets: {
            consumerKey: "",
            consumerSecret: "",
            passkey: "",
          },
        },
        live: {
          active: false,
          callbackUrl: "",
          settings: {
            shortcode: "",
            paybill: "",
            shortcodeType: "paybill",
            initiatorName: "",
          },
          secrets: {
            consumerKey: "",
            consumerSecret: "",
            passkey: "",
          },
        },
      },
    },
  };
}

async function verifyCaller(req, { allowAnonymous = false } = {}) {
  const token = getBearerToken(req);
  if (!token) {
    if (allowAnonymous) {
      return {
        uid: "",
        email: "",
        role: "anonymous",
        token: null,
        userDoc: null,
      };
    }
    const error = new Error("You must be signed in to continue.");
    error.statusCode = 401;
    throw error;
  }

  let decoded = null;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    const error = new Error("Your session has expired. Please sign in again.");
    error.statusCode = 401;
    throw error;
  }

  const uid = safeString(decoded?.uid, 160);
  const email = safeString(decoded?.email, 180);
  const userSnap = uid ? await db.collection("users").doc(uid).get().catch(() => null) : null;
  const userDoc = userSnap?.exists ? userSnap.data() || {} : {};
  return {
    uid,
    email: safeString(userDoc?.email || email, 180),
    role: normalizeRole(userDoc?.role),
    token: decoded,
    userDoc,
  };
}

function ensureRole(caller, allowedRoles = []) {
  const safeAllowed = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!safeAllowed.includes(caller?.role)) {
    const error = new Error("You do not have permission to perform this action.");
    error.statusCode = 403;
    throw error;
  }
}

function ensureRequestOwner(requestData = {}, caller = {}) {
  const ownerUid = safeString(requestData?.uid, 160);
  if (!ownerUid || ownerUid !== safeString(caller?.uid, 160)) {
    const error = new Error("This request is outside your account.");
    error.statusCode = 403;
    throw error;
  }
}

function ensureFullPackageOwner(fullPackageData = {}, caller = {}) {
  const ownerUid = safeString(fullPackageData?.uid, 160);
  if (!ownerUid || ownerUid !== safeString(caller?.uid, 160)) {
    const error = new Error("This full package is outside your account.");
    error.statusCode = 403;
    throw error;
  }
}

function resolveBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function resolvePositiveHours(value, fallback) {
  const next = roundMoney(value);
  return next > 0 ? next : fallback;
}

function resolveShortcodeType(value) {
  return lower(value, 20) === "till" ? "till" : "paybill";
}

function resolvePublicBaseUrl(req, configured = "") {
  const cleanConfigured = safeString(configured, 1000).replace(/\/+$/, "");
  if (cleanConfigured) return cleanConfigured;
  const guessed = buildAbsoluteUrl(req, "/");
  return safeString(guessed, 1000).replace(/\/$/, "");
}

function normalizeFinanceSettingsDoc(source = {}) {
  const raw = source && typeof source === "object" ? source : {};
  const defaults = defaultFinanceSettings();
  const activeProvider = "mpesa";
  const providerEnvironment = normalizeProviderEnvironment(
    raw?.paymentProvider?.providerEnvironment ||
      raw?.provider?.environment ||
      defaults?.paymentProvider?.providerEnvironment,
    defaults?.paymentProvider?.providerEnvironment
  );
  const providerCallbackUrl = safeString(
    raw?.paymentProvider?.providerCallbackUrl ||
      raw?.paymentProvider?.callbackBaseUrl ||
      raw?.provider?.callbackBaseUrl ||
      defaults?.paymentProvider?.providerCallbackUrl,
    600
  );
  const paymentLinkBaseUrl = safeString(
    raw?.paymentProvider?.paymentLinkBaseUrl ||
      raw?.provider?.paymentLinkBaseUrl ||
      defaults?.paymentProvider?.paymentLinkBaseUrl,
    600
  );
  return {
    paymentProvider: {
      activeProvider,
      providerEnvironment,
      providerCallbackUrl,
      paymentLinkBaseUrl,
      providers: {
        mpesa: {
          enabled: true,
          label: "M-Pesa",
        },
      },
    },
    pricingControls: {
      globalDiscountEnabled: resolveBoolean(
        raw?.pricingControls?.globalDiscountEnabled,
        false
      ),
      globalDiscountPercentage: roundRate(
        raw?.pricingControls?.globalDiscountPercentage
      ),
    },
    provider: {
      name: "mpesa",
      active: "mpesa",
      environment: providerEnvironment,
      callbackBaseUrl: providerCallbackUrl,
      paymentLinkBaseUrl,
      providers: {
        mpesa: {
          enabled: true,
          label: "M-Pesa",
        },
      },
    },
    defaultCurrency: normalizeCurrency(
      raw?.defaultCurrency || raw?.inProgressPricing?.defaultCurrency || "KES"
    ),
    refundControls: {
      unlockAutoRefundHours: resolvePositiveHours(
        raw?.refundControls?.unlockAutoRefundHours,
        defaults.refundControls.unlockAutoRefundHours
      ),
      autoRefundEnabled: resolveBoolean(
        raw?.refundControls?.autoRefundEnabled,
        true
      ),
      sharedLinkExpiryHours: resolvePositiveHours(
        raw?.refundControls?.sharedLinkExpiryHours,
        defaults.refundControls.sharedLinkExpiryHours
      ),
    },
    payoutControls: {
      manualReleaseOnly: resolveBoolean(
        raw?.payoutControls?.manualReleaseOnly,
        true
      ),
      requireDestination: resolveBoolean(
        raw?.payoutControls?.requireDestination,
        true
      ),
      deductProcessorFeeFromPartner: resolveBoolean(
        raw?.payoutControls?.deductProcessorFeeFromPartner,
        false
      ),
    },
    inProgressPricing: {
      defaultCurrency: normalizeCurrency(
        raw?.inProgressPricing?.defaultCurrency || raw?.defaultCurrency || "KES"
      ),
      allowServiceFeeInput: resolveBoolean(
        raw?.inProgressPricing?.allowServiceFeeInput,
        true
      ),
      allowAdminAdjustAmounts: resolveBoolean(
        raw?.inProgressPricing?.allowAdminAdjustAmounts,
        true
      ),
      platformCutEnabledGlobal: resolveBoolean(
        raw?.inProgressPricing?.platformCutEnabledGlobal,
        true
      ),
    },
    platformFee: {
      defaultCutType: normalizeFeeType(raw?.platformFee?.defaultCutType),
      defaultCutValue: roundRate(raw?.platformFee?.defaultCutValue || 10),
      cutBase:
        lower(raw?.platformFee?.cutBase, 40) === "official_amount"
          ? "official_amount"
          : "official_plus_service_fee",
    },
  };
}

function mergeSecretValue(existingValue, nextValue) {
  const safeNext = safeString(nextValue, 4000);
  if (!safeNext) return safeString(existingValue, 4000);
  return safeNext;
}

function normalizeProviderEnvironmentConfig(source = {}, existing = {}) {
  const raw = source && typeof source === "object" ? source : {};
  const prev = existing && typeof existing === "object" ? existing : {};
  return {
    active: resolveBoolean(raw?.active, resolveBoolean(prev?.active, false)),
    callbackUrl: safeString(raw?.callbackUrl || prev?.callbackUrl, 1000),
    settings: {
      shortcode: safeString(
        raw?.settings?.shortcode || raw?.settings?.shortCode || prev?.settings?.shortcode,
        120
      ),
      paybill: safeString(raw?.settings?.paybill || prev?.settings?.paybill, 120),
      shortcodeType: resolveShortcodeType(
        raw?.settings?.shortcodeType || prev?.settings?.shortcodeType
      ),
      initiatorName: safeString(
        raw?.settings?.initiatorName || prev?.settings?.initiatorName,
        120
      ),
    },
    secrets: {
      consumerKey: mergeSecretValue(
        prev?.secrets?.consumerKey,
        raw?.secrets?.consumerKey
      ),
      consumerSecret: mergeSecretValue(
        prev?.secrets?.consumerSecret,
        raw?.secrets?.consumerSecret
      ),
      passkey: mergeSecretValue(prev?.secrets?.passkey, raw?.secrets?.passkey),
    },
  };
}

function normalizeProviderConfigForStorage(source = {}, existing = {}) {
  const raw = source && typeof source === "object" ? source : {};
  const prev = existing && typeof existing === "object" ? existing : defaultProviderConfig();
  return {
    providers: {
      mpesa: {
        test: normalizeProviderEnvironmentConfig(
          raw?.providers?.mpesa?.test,
          prev?.providers?.mpesa?.test
        ),
        live: normalizeProviderEnvironmentConfig(
          raw?.providers?.mpesa?.live,
          prev?.providers?.mpesa?.live
        ),
      },
    },
  };
}

function sanitizeProviderConfigForClient(source = {}) {
  const raw = normalizeProviderConfigForStorage(source, source);
  const shape = { providers: { mpesa: {} } };
  for (const envKey of ["test", "live"]) {
    const row = raw?.providers?.mpesa?.[envKey] || {};
    shape.providers.mpesa[envKey] = {
      active: row?.active === true,
      callbackUrl: safeString(row?.callbackUrl, 1000),
      settings: {
        shortcode: safeString(row?.settings?.shortcode, 120),
        paybill: safeString(row?.settings?.paybill, 120),
        shortcodeType: resolveShortcodeType(row?.settings?.shortcodeType),
        initiatorName: safeString(row?.settings?.initiatorName, 120),
      },
      secrets: {
        consumerKey: "",
        consumerSecret: "",
        passkey: "",
      },
      secretConfigured: {
        consumerKey: Boolean(safeString(row?.secrets?.consumerKey, 4000)),
        consumerSecret: Boolean(safeString(row?.secrets?.consumerSecret, 4000)),
        passkey: Boolean(safeString(row?.secrets?.passkey, 4000)),
      },
    };
  }
  return shape;
}

async function getFinanceSettings() {
  const snap = await db
    .collection(FINANCE_SETTINGS_COLLECTION)
    .doc(FINANCE_SETTINGS_DOC)
    .get();
  return normalizeFinanceSettingsDoc(snap.exists ? snap.data() || {} : {});
}

async function getProviderConfig() {
  const snap = await db
    .collection(PAYMENT_PROVIDER_CONFIG_COLLECTION)
    .doc(PAYMENT_PROVIDER_CONFIG_DOC)
    .get();
  return normalizeProviderConfigForStorage(
    snap.exists ? snap.data() || {} : defaultProviderConfig(),
    defaultProviderConfig()
  );
}

function resolveMpesaCallbackUrl(req, configuredValue = "") {
  const runtimeBase = resolvePublicBaseUrl(
    req,
    readEnvValue(
      [
        "PUBLIC_API_BASE_URL",
        "API_BASE_URL",
        "FRONTEND_APP_BASE_URL",
        "PUBLIC_APP_BASE_URL",
        "APP_BASE_URL",
        "VITE_API_BASE_URL",
        "VITE_APP_BASE_URL",
      ],
      1000
    )
  );
  const explicit = safeString(configuredValue, 1000);
  if (explicit) {
    return safeString(buildRuntimeUrl(runtimeBase, explicit), 1000);
  }
  return safeString(buildAbsoluteUrl(req, "/api/mpesa-callback"), 1000);
}

function resolveMpesaRuntimeConfig({ settings, config, req }) {
  const normalizedSettings = normalizeFinanceSettingsDoc(settings);
  const normalizedConfig = normalizeProviderConfigForStorage(config, config);
  const environment = normalizeProviderEnvironment(
    readEnvValue(["MPESA_ENVIRONMENT", "MPESA_PROVIDER_ENVIRONMENT"], 40) ||
      normalizedSettings?.paymentProvider?.providerEnvironment,
    normalizedSettings?.paymentProvider?.providerEnvironment || "test"
  );
  const envRow = normalizedConfig?.providers?.mpesa?.[environment] || {};
  const consumerKey = readEnvValue(
    buildEnvironmentScopedEnvKeys("MPESA_CONSUMER_KEY", environment),
    4000
  ) || safeString(envRow?.secrets?.consumerKey, 4000);
  const consumerSecret = readEnvValue(
    buildEnvironmentScopedEnvKeys("MPESA_CONSUMER_SECRET", environment),
    4000
  ) || safeString(envRow?.secrets?.consumerSecret, 4000);
  const passkey = readEnvValue(
    buildEnvironmentScopedEnvKeys("MPESA_PASSKEY", environment),
    4000
  ) || safeString(envRow?.secrets?.passkey, 4000);
  const shortcode = readEnvValue(
    buildEnvironmentScopedEnvKeys("MPESA_SHORTCODE", environment),
    120
  ) ||
    readEnvValue(buildEnvironmentScopedEnvKeys("MPESA_PAYBILL", environment), 120) ||
    safeString(envRow?.settings?.shortcode || envRow?.settings?.paybill, 120);
  const paybill = readEnvValue(
    buildEnvironmentScopedEnvKeys("MPESA_PAYBILL", environment),
    120
  ) || safeString(envRow?.settings?.paybill, 120);
  const shortcodeType = resolveShortcodeType(
    readEnvValue(buildEnvironmentScopedEnvKeys("MPESA_SHORTCODE_TYPE", environment), 40) ||
      envRow?.settings?.shortcodeType
  );
  const initiatorName = readEnvValue(
    buildEnvironmentScopedEnvKeys("MPESA_INITIATOR_NAME", environment),
    120
  ) || safeString(envRow?.settings?.initiatorName, 120);
  const callbackUrl = resolveMpesaCallbackUrl(
    req,
    readEnvValue(buildEnvironmentScopedEnvKeys("MPESA_CALLBACK_URL", environment), 1000) ||
      safeString(envRow?.callbackUrl, 1000) ||
      safeString(normalizedSettings?.paymentProvider?.providerCallbackUrl, 1000)
  );
  const paymentLinkBaseUrl = resolvePublicBaseUrl(
    req,
    safeString(normalizedSettings?.paymentProvider?.paymentLinkBaseUrl, 1000) ||
      readEnvValue(
        [
          "FRONTEND_APP_BASE_URL",
          "PUBLIC_APP_BASE_URL",
          "APP_BASE_URL",
          "VITE_APP_BASE_URL",
        ],
        1000
      )
  );
  const envSecretsConfigured = Boolean(consumerKey && consumerSecret && passkey);
  const firestoreSecretsConfigured = Boolean(
    safeString(envRow?.secrets?.consumerKey, 4000) &&
      safeString(envRow?.secrets?.consumerSecret, 4000) &&
      safeString(envRow?.secrets?.passkey, 4000)
  );
  const configSource =
    envSecretsConfigured && firestoreSecretsConfigured
      ? "hybrid"
      : envSecretsConfigured
        ? "env"
        : "firestore";
  return {
    normalizedSettings,
    normalizedConfig,
    environment,
    callbackUrl,
    paymentLinkBaseUrl,
    shortcode,
    shortcodeType,
    initiatorName,
    paybill,
    consumerKey,
    consumerSecret,
    passkey,
    active: envRow?.active === true || envSecretsConfigured,
    configSource,
  };
}

function buildProviderStatus({ settings, config, req }) {
  const runtimeConfig = resolveMpesaRuntimeConfig({ settings, config, req });
  const ready =
    runtimeConfig.active === true &&
    Boolean(runtimeConfig.shortcode) &&
    Boolean(runtimeConfig.consumerKey) &&
    Boolean(runtimeConfig.consumerSecret) &&
    Boolean(runtimeConfig.passkey) &&
    isHttpUrl(runtimeConfig.callbackUrl);
  return {
    provider: "mpesa",
    environment: runtimeConfig.environment,
    ready,
    callbackUrl: runtimeConfig.callbackUrl,
    paymentLinkBaseUrl: runtimeConfig.paymentLinkBaseUrl,
    configSource: runtimeConfig.configSource,
    mode: "stk_push",
    supports: {
      stkPush: true,
      callback: true,
      b2c: true,
      b2b: true,
      reversal: true,
    },
  };
}

async function getActiveMpesaConfig(req) {
  const settings = await getFinanceSettings();
  const config = await getProviderConfig();
  const runtimeConfig = resolveMpesaRuntimeConfig({ settings, config, req });
  const providerStatus = buildProviderStatus({ settings, config, req });
  if (!providerStatus.ready) {
    const error = new Error("M-Pesa provider configuration is incomplete.");
    error.statusCode = 503;
    error.details = { providerStatus };
    throw error;
  }
  return {
    settings,
    config,
    providerStatus,
    environment: runtimeConfig.environment,
    callbackUrl: runtimeConfig.callbackUrl,
    shortcode: runtimeConfig.shortcode,
    shortcodeType: runtimeConfig.shortcodeType,
    initiatorName: runtimeConfig.initiatorName,
    paybill: runtimeConfig.paybill,
    consumerKey: runtimeConfig.consumerKey,
    consumerSecret: runtimeConfig.consumerSecret,
    passkey: runtimeConfig.passkey,
  };
}

function ensureFinanceManager(caller) {
  if (!FINANCE_MANAGER_ROLE_KEYS.has(caller?.role)) {
    const error = new Error("Finance manager access is required.");
    error.statusCode = 403;
    throw error;
  }
}

function buildDocPath(collectionName, docId, subcollectionName = "", subDocId = "") {
  const segments = [collectionName, docId, subcollectionName, subDocId].filter(Boolean);
  return segments.join("/");
}

async function loadRequestRow(requestId = "") {
  const id = safeString(requestId, 180);
  if (!id) {
    const error = new Error("requestId is required.");
    error.statusCode = 400;
    throw error;
  }
  const ref = db.collection("serviceRequests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error("Request not found.");
    error.statusCode = 404;
    throw error;
  }
  return { id, ref, data: snap.data() || {} };
}

async function loadFullPackageRow(fullPackageId = "") {
  const id = safeString(fullPackageId, 180);
  if (!id) {
    const error = new Error("fullPackageId is required.");
    error.statusCode = 400;
    throw error;
  }
  const ref = db.collection("fullPackages").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error("Full package not found.");
    error.statusCode = 404;
    throw error;
  }
  return { id, ref, data: snap.data() || {} };
}

async function loadRequestPaymentRow(requestId = "", paymentId = "") {
  const requestRow = await loadRequestRow(requestId);
  const id = safeString(paymentId, 180);
  if (!id) {
    const error = new Error("paymentId is required.");
    error.statusCode = 400;
    throw error;
  }
  const ref = requestRow.ref.collection("payments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error("Payment not found.");
    error.statusCode = 404;
    throw error;
  }
  return {
    id,
    ref,
    data: snap.data() || {},
    requestRow,
    paymentPath: buildDocPath("serviceRequests", requestRow.id, "payments", id),
  };
}

async function _loadFullPackagePaymentRow(fullPackageId = "", paymentId = "") {
  const fullPackageRow = await loadFullPackageRow(fullPackageId);
  const id = safeString(paymentId, 180);
  if (!id) {
    const error = new Error("paymentId is required.");
    error.statusCode = 400;
    throw error;
  }
  const ref = fullPackageRow.ref.collection("payments").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const error = new Error("Payment not found.");
    error.statusCode = 404;
    throw error;
  }
  return {
    id,
    ref,
    data: snap.data() || {},
    fullPackageRow,
    paymentPath: buildDocPath("fullPackages", fullPackageRow.id, "payments", id),
  };
}

function resolveRequestPricingAmount(requestData = {}) {
  return roundMoney(
    requestData?.pricingSnapshot?.amount ||
      requestData?.pricingSnapshot?.finalAmount ||
      requestData?.pricingSnapshot?.defaultAmount ||
      requestData?.pricingSnapshot?.price ||
      0
  );
}

function resolveRequestPricingCurrency(requestData = {}) {
  return normalizeCurrency(
    requestData?.pricingSnapshot?.currency || requestData?.currency || "KES"
  );
}

function resolveFullPackageCoverage(fullPackageData = {}, selectedItems = []) {
  const normalizedSelected = cleanStringList(
    selectedItems?.length ? selectedItems : fullPackageData?.selectedItems,
    { maxItems: 80, maxLen: 120 }
  );
  const coveredItems = cleanStringList(
    fullPackageData?.unlockCoverage?.coveredItems ||
      fullPackageData?.coveredItems ||
      [],
    { maxItems: 80, maxLen: 120 }
  );
  const coveredSet = new Set(coveredItems.map((item) => lower(item, 120)));
  const outstandingItems = normalizedSelected.filter(
    (item) => !coveredSet.has(lower(item, 120))
  );
  return {
    selectedItems: normalizedSelected,
    coveredItems,
    outstandingItems,
    isCovered: normalizedSelected.length === 0 || outstandingItems.length === 0,
  };
}

function resolveUserPhone(caller = {}, ...candidates) {
  for (const candidate of candidates) {
    const phone = normalizePhoneNumber(candidate);
    if (phone) return phone;
  }
  return normalizePhoneNumber(
    caller?.userDoc?.phone ||
      caller?.userDoc?.phoneNumber ||
      caller?.userDoc?.mobile ||
      caller?.token?.phone_number ||
      ""
  );
}

function resolveUserEmail(caller = {}, ...candidates) {
  for (const candidate of candidates) {
    const email = safeString(candidate, 180).toLowerCase();
    if (email && email.includes("@")) return email;
  }
  return safeString(caller?.email, 180).toLowerCase();
}

async function logFinancialAudit({
  action,
  actorUid = "",
  actorRole = "",
  requestId = "",
  paymentId = "",
  refundId = "",
  payoutQueueId = "",
  reason = "",
  details = null,
} = {}) {
  const ref = db.collection(FINANCIAL_AUDIT_LOG_COLLECTION).doc();
  const createdAtMs = nowMs();
  await ref.set({
    auditId: ref.id,
    action: safeString(action, 120),
    actorUid: safeString(actorUid, 160),
    actorRole: safeString(actorRole, 80),
    requestId: safeString(requestId, 180),
    paymentId: safeString(paymentId, 180),
    refundId: safeString(refundId, 180),
    payoutQueueId: safeString(payoutQueueId, 180),
    reason: cleanParagraph(reason, 2000),
    details: safeJsonClone(details),
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs,
  });
}

async function logProviderEvent({
  provider = "mpesa",
  eventType = "",
  lookupKey = "",
  reference = "",
  paymentPath = "",
  requestId = "",
  paymentId = "",
  fullPackageId = "",
  payload = null,
} = {}) {
  const ref = db.collection(PAYMENT_PROVIDER_EVENTS_COLLECTION).doc();
  await ref.set({
    eventId: ref.id,
    provider: safeString(provider, 80),
    eventType: safeString(eventType, 120),
    lookupKey: safeString(lookupKey, 180),
    reference: safeString(reference, 180),
    paymentPath: safeString(paymentPath, 400),
    requestId: safeString(requestId, 180),
    paymentId: safeString(paymentId, 180),
    fullPackageId: safeString(fullPackageId, 180),
    payload: safeJsonClone(payload),
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs(),
  });
}

async function upsertProviderReferenceAlias(
  lookupKey,
  {
    canonicalReference = "",
    paymentPath = "",
    requestId = "",
    paymentId = "",
    fullPackageId = "",
    flowType = "",
    paymentType = "",
    provider = "mpesa",
    metadata = null,
  } = {}
) {
  const key = safeString(lookupKey, 180);
  if (!key) return;
  const createdAtMs = nowMs();
  await db
    .collection(PAYMENT_PROVIDER_REFS_COLLECTION)
    .doc(key)
    .set(
      {
        lookupKey: key,
        canonicalReference: safeString(canonicalReference, 180) || key,
        paymentPath: safeString(paymentPath, 400),
        requestId: safeString(requestId, 180),
        paymentId: safeString(paymentId, 180),
        fullPackageId: safeString(fullPackageId, 180),
        flowType: safeString(flowType, 80),
        paymentType: safeString(paymentType, 80),
        provider: safeString(provider, 80) || "mpesa",
        metadata: safeJsonClone(metadata),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: createdAtMs,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs,
      },
      { merge: true }
    );
}

async function loadPaymentByLookupKey(lookupKey = "") {
  const key = safeString(lookupKey, 180);
  if (!key) return null;
  const aliasSnap = await db
    .collection(PAYMENT_PROVIDER_REFS_COLLECTION)
    .doc(key)
    .get();
  if (!aliasSnap.exists) return null;
  const aliasData = aliasSnap.data() || {};
  const canonicalReference = safeString(aliasData?.canonicalReference, 180) || key;
  const paymentPath = safeString(aliasData?.paymentPath, 400);
  if (!paymentPath) {
    return {
      aliasKey: key,
      canonicalReference,
      aliasData,
      paymentData: null,
      paymentRef: null,
      requestData: null,
      requestRef: null,
      fullPackageData: null,
      fullPackageRef: null,
    };
  }
  const paymentRef = db.doc(paymentPath);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    return {
      aliasKey: key,
      canonicalReference,
      aliasData,
      paymentData: null,
      paymentRef,
      requestData: null,
      requestRef: null,
      fullPackageData: null,
      fullPackageRef: null,
    };
  }
  const paymentData = paymentSnap.data() || {};
  const requestId = safeString(
    paymentData?.requestId || aliasData?.requestId || "",
    180
  );
  const fullPackageId = safeString(
    paymentData?.fullPackageId || aliasData?.fullPackageId || "",
    180
  );
  const requestRef = requestId ? db.collection("serviceRequests").doc(requestId) : null;
  const fullPackageRef = fullPackageId ? db.collection("fullPackages").doc(fullPackageId) : null;
  const [requestSnap, fullPackageSnap] = await Promise.all([
    requestRef ? requestRef.get().catch(() => null) : Promise.resolve(null),
    fullPackageRef ? fullPackageRef.get().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    aliasKey: key,
    canonicalReference,
    aliasData,
    paymentData,
    paymentRef,
    paymentPath,
    requestData: requestSnap?.exists ? requestSnap.data() || {} : null,
    requestRef,
    requestId,
    fullPackageData: fullPackageSnap?.exists ? fullPackageSnap.data() || {} : null,
    fullPackageRef,
    fullPackageId,
    paymentId: safeString(paymentData?.paymentId || aliasData?.paymentId || paymentSnap.id, 180),
  };
}

function calculatePaymentBreakdown({
  officialAmount,
  serviceFee,
  currency = "KES",
  requestDiscountPercentage = 0,
  platformCutEnabled = true,
  settings = {},
} = {}) {
  const official = roundMoney(officialAmount);
  const fee = roundMoney(serviceFee);
  const discountPct = clamp(requestDiscountPercentage, 0, 100);
  const subtotal = official + fee;
  const discountAmount = roundMoney((subtotal * discountPct) / 100);
  const finalUserPayable = Math.max(0, subtotal - discountAmount);
  const feeType = normalizeFeeType(settings?.platformFee?.defaultCutType, "percentage");
  const cutValue = roundRate(settings?.platformFee?.defaultCutValue || 10);
  const cutBase =
    lower(settings?.platformFee?.cutBase, 40) === "official_amount"
      ? "official_amount"
      : "official_plus_service_fee";
  const baseForCut = cutBase === "official_amount" ? official : subtotal;
  let platformCutAmount = 0;
  if (platformCutEnabled) {
    platformCutAmount =
      feeType === "flat"
        ? roundMoney(cutValue)
        : roundMoney((baseForCut * cutValue) / 100);
  }
  const partnerNetAmount = Math.max(0, finalUserPayable - platformCutAmount);
  return {
    officialAmount: official,
    serviceFee: fee,
    currency: normalizeCurrency(currency),
    requestDiscountPercentage: discountPct,
    discountAmount,
    discountAppliedPercentage: discountPct,
    subtotal,
    finalUserPayable,
    platformCutEnabled,
    platformCutAmount,
    partnerNetAmount,
    cutBase,
    defaultCutType: feeType,
    defaultCutValue: cutValue,
  };
}

function createPaymentSummary(paymentData = {}, extra = {}) {
  const status = lower(paymentData?.status, 80);
  const reference =
    safeString(
      paymentData?.transactionReference ||
        paymentData?.paymentReference ||
        paymentData?.currentReference,
      180
    ) || safeString(extra?.reference, 180);
  return {
    ok: PAYMENT_SUCCESS_STATUSES.has(status),
    success: PAYMENT_SUCCESS_STATUSES.has(status),
    status,
    requestId: safeString(paymentData?.requestId || extra?.requestId, 180),
    paymentId: safeString(paymentData?.paymentId || extra?.paymentId, 180),
    fullPackageId: safeString(paymentData?.fullPackageId || extra?.fullPackageId, 180),
    flowType: safeString(paymentData?.flowType || extra?.flowType, 80),
    paymentType: safeString(paymentData?.paymentType || extra?.paymentType, 80),
    amount: roundMoney(paymentData?.amount || extra?.amount),
    currency: normalizeCurrency(paymentData?.currency || extra?.currency || "KES"),
    reference,
    transactionReference: reference,
    paymentReference: reference,
    provider: "mpesa",
    paymentMethod: "mpesa",
    payerMode: safeString(paymentData?.payerMode || extra?.payerMode, 80),
    returnTo: safeString(paymentData?.returnTo || extra?.returnTo, 1200),
    draftId: safeString(paymentData?.draftId || extra?.draftId, 180),
    shareToken: safeString(paymentData?.shareToken || extra?.shareToken, 400),
    message:
      safeString(paymentData?.statusMessage || extra?.message, 500) ||
      (PAYMENT_SUCCESS_STATUSES.has(status)
        ? "Payment confirmed."
        : status === PAYMENT_STATUSES.FAILED
          ? "The payment did not complete."
          : status === PAYMENT_STATUSES.AWAITING_PAYMENT ||
              status === PAYMENT_STATUSES.PAYMENT_SESSION_CREATED ||
              status === PAYMENT_STATUSES.PROMPTED
            ? "The M-Pesa prompt was sent. Complete the payment on your phone."
            : "Payment status updated."),
    verificationSummary: {
      source: "webhook_state",
      provider: "mpesa",
      updatedAtMs: timestampToMs(paymentData?.updatedAt) || Number(paymentData?.updatedAtMs || 0),
    },
    breakdown: safeJsonClone(paymentData?.breakdown),
    financialSnapshot: safeJsonClone(paymentData?.financialSnapshot),
    fullPackage: extra?.fullPackage ? safeJsonClone(extra.fullPackage) : null,
  };
}

function buildFrontendCallbackUrl(
  req,
  {
    appBaseUrl = "",
    reference = "",
    requestId = "",
    paymentId = "",
    fullPackageId = "",
    draftId = "",
    returnTo = "",
    shareToken = "",
  } = {}
) {
  const baseUrl =
    resolvePublicBaseUrl(
      req,
      appBaseUrl ||
        safeString(process.env.FRONTEND_APP_BASE_URL || process.env.VITE_APP_BASE_URL, 1000)
    ) || "";
  const callbackPath =
    safeString(process.env.PAYMENT_FRONTEND_CALLBACK_PATH, 240) || "/payment/callback";
  const base = baseUrl || "https://majuu.app";
  const url = /^https?:\/\//i.test(callbackPath)
    ? new URL(callbackPath)
    : new URL(callbackPath, `${base}/`);
  if (reference) url.searchParams.set("reference", reference);
  if (requestId) url.searchParams.set("requestId", requestId);
  if (paymentId) url.searchParams.set("paymentId", paymentId);
  if (fullPackageId) url.searchParams.set("fullPackageId", fullPackageId);
  if (draftId) url.searchParams.set("draft", draftId);
  if (returnTo) url.searchParams.set("returnTo", returnTo);
  if (shareToken) url.searchParams.set("share", shareToken);
  return url.toString();
}

async function getMpesaAccessToken(mpesaConfig) {
  logPaymentLifecycle("initiate.auth.start", {
    environment: mpesaConfig?.environment || "test",
    shortcode: safeString(mpesaConfig?.shortcode, 120),
  });
  const authValue = Buffer.from(
    `${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`
  ).toString("base64");
  const baseUrl =
    mpesaConfig.environment === "live"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  const response = await fetch(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${authValue}`,
      },
    }
  );
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !safeString(payload?.access_token, 2000)) {
    const error = new Error("Failed to authenticate with M-Pesa.");
    error.statusCode = 502;
    error.details = payload;
    logPaymentLifecycle(
      "initiate.auth.failed",
      {
        environment: mpesaConfig?.environment || "test",
        shortcode: safeString(mpesaConfig?.shortcode, 120),
        status: Number(response?.status || 0) || 0,
        details: payload,
      },
      "error"
    );
    throw error;
  }
  logPaymentLifecycle("initiate.auth.accepted", {
    environment: mpesaConfig?.environment || "test",
    shortcode: safeString(mpesaConfig?.shortcode, 120),
    status: Number(response?.status || 0) || 0,
  });
  return safeString(payload.access_token, 2000);
}

async function sendMpesaStkPush({
  mpesaConfig,
  amount,
  phoneNumber,
  reference,
  description,
  callbackUrl,
} = {}) {
  const accessToken = await getMpesaAccessToken(mpesaConfig);
  const timestamp = buildDarajaTimestamp();
  const shortcode = safeString(mpesaConfig.shortcode, 120);
  const password = Buffer.from(`${shortcode}${mpesaConfig.passkey}${timestamp}`).toString(
    "base64"
  );
  const transactionType =
    mpesaConfig.shortcodeType === "till"
      ? "CustomerBuyGoodsOnline"
      : "CustomerPayBillOnline";
  const baseUrl =
    mpesaConfig.environment === "live"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  const requestBody = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: transactionType,
    Amount: roundMoney(amount),
    PartyA: phoneNumber,
    PartyB: shortcode,
    PhoneNumber: phoneNumber,
    CallBackURL: callbackUrl,
    AccountReference: safeString(reference, 20) || "MAJUU",
    TransactionDesc: cleanParagraph(description, 160) || "MAJUU payment",
  };
  const response = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || safeString(payload?.ResponseCode, 20) !== "0") {
    const error = new Error(
      safeString(payload?.errorMessage || payload?.ResponseDescription, 400) ||
        "M-Pesa STK push could not be started."
    );
    error.statusCode = 502;
    error.details = payload;
    throw error;
  }
  return {
    merchantRequestId: safeString(payload?.MerchantRequestID, 180),
    checkoutRequestId: safeString(payload?.CheckoutRequestID, 180),
    responseCode: safeString(payload?.ResponseCode, 40),
    responseDescription: safeString(payload?.ResponseDescription, 400),
    customerMessage: safeString(payload?.CustomerMessage, 400),
    raw: safeJsonClone(payload),
  };
}

async function sendStkAndPersist({
  req,
  paymentRef,
  paymentPath,
  paymentData,
  reference,
  payerPhone,
  description,
} = {}) {
  const mpesaConfig = await getActiveMpesaConfig(req);
  const callbackUrl = mpesaConfig.callbackUrl;
  const attemptId = buildAttemptId("STK");
  const initiatedAtMs = nowMs();

  logPaymentLifecycle("initiate.prepared", {
    reference,
    attemptId,
    requestId: paymentData?.requestId || "",
    paymentId: paymentData?.paymentId || "",
    fullPackageId: paymentData?.fullPackageId || "",
    flowType: paymentData?.flowType || "",
    paymentType: paymentData?.paymentType || "",
    amount: roundMoney(paymentData?.amount),
    environment: mpesaConfig.environment,
    shortcode: mpesaConfig.shortcode,
    callbackUrl,
    phoneNumber: maskPhoneNumber(payerPhone),
  });

  await paymentRef.set(
    {
      provider: "mpesa",
      paymentMethod: "mpesa",
      currentReference: reference,
      paymentReference: reference,
      transactionReference: reference,
      status: PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
      lastAttemptId: attemptId,
      lastInitiatedAtMs: initiatedAtMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: initiatedAtMs,
      mpesa: {
        ...(paymentData?.mpesa && typeof paymentData.mpesa === "object" ? paymentData.mpesa : {}),
        customerPhone: payerPhone,
        callbackUrl,
        lastAttemptId: attemptId,
      },
    },
    { merge: true }
  );

  await upsertProviderReferenceAlias(reference, {
    canonicalReference: reference,
    paymentPath,
    requestId: paymentData?.requestId,
    paymentId: paymentData?.paymentId,
    fullPackageId: paymentData?.fullPackageId,
    flowType: paymentData?.flowType,
    paymentType: paymentData?.paymentType,
    metadata: {
      source: "stk_push",
      attemptId,
    },
  });

  try {
    const result = await sendMpesaStkPush({
      mpesaConfig,
      amount: paymentData?.amount,
      phoneNumber: payerPhone,
      reference,
      description,
      callbackUrl,
    });

    await paymentRef.set(
      {
        status: PAYMENT_STATUSES.AWAITING_PAYMENT,
        statusMessage:
          safeString(result?.customerMessage || result?.responseDescription, 400) ||
          "Complete the M-Pesa prompt on your phone.",
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
        mpesa: {
          ...(paymentData?.mpesa && typeof paymentData.mpesa === "object"
            ? paymentData.mpesa
            : {}),
          customerPhone: payerPhone,
          callbackUrl,
          merchantRequestId: result.merchantRequestId,
          checkoutRequestId: result.checkoutRequestId,
          responseCode: result.responseCode,
          responseDescription: result.responseDescription,
          customerMessage: result.customerMessage,
          lastAttemptId: attemptId,
          lastInitiatedAtMs: initiatedAtMs,
          lastInitiateResponse: result.raw,
        },
      },
      { merge: true }
    );

    if (result.merchantRequestId) {
      await upsertProviderReferenceAlias(result.merchantRequestId, {
        canonicalReference: reference,
        paymentPath,
        requestId: paymentData?.requestId,
        paymentId: paymentData?.paymentId,
        fullPackageId: paymentData?.fullPackageId,
        flowType: paymentData?.flowType,
        paymentType: paymentData?.paymentType,
      });
    }
    if (result.checkoutRequestId) {
      await upsertProviderReferenceAlias(result.checkoutRequestId, {
        canonicalReference: reference,
        paymentPath,
        requestId: paymentData?.requestId,
        paymentId: paymentData?.paymentId,
        fullPackageId: paymentData?.fullPackageId,
        flowType: paymentData?.flowType,
        paymentType: paymentData?.paymentType,
      });
    }

    await logProviderEvent({
      provider: "mpesa",
      eventType: "stk_push_started",
      lookupKey: reference,
      reference,
      paymentPath,
      requestId: paymentData?.requestId,
      paymentId: paymentData?.paymentId,
      fullPackageId: paymentData?.fullPackageId,
      payload: result.raw,
    });

    logPaymentLifecycle("initiate.accepted", {
      reference,
      attemptId,
      requestId: paymentData?.requestId || "",
      paymentId: paymentData?.paymentId || "",
      fullPackageId: paymentData?.fullPackageId || "",
      checkoutRequestId: result.checkoutRequestId,
      merchantRequestId: result.merchantRequestId,
      responseCode: result.responseCode,
      environment: mpesaConfig.environment,
    });

    return {
      reference,
      attemptId,
      checkoutRequestId: result.checkoutRequestId,
      merchantRequestId: result.merchantRequestId,
      message:
        safeString(result?.customerMessage || result?.responseDescription, 400) ||
        "Complete the M-Pesa prompt on your phone.",
    };
  } catch (error) {
    const failureMessage =
      safeString(error?.message, 400) || "M-Pesa STK push could not be started.";
    await paymentRef.set(
      {
        status: PAYMENT_STATUSES.FAILED,
        statusMessage: failureMessage,
        failedAt: FieldValue.serverTimestamp(),
        failedAtMs: nowMs(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
        mpesa: {
          ...(paymentData?.mpesa && typeof paymentData.mpesa === "object"
            ? paymentData.mpesa
            : {}),
          customerPhone: payerPhone,
          callbackUrl,
          lastAttemptId: attemptId,
          lastInitiatedAtMs: initiatedAtMs,
          lastInitiateError: {
            message: failureMessage,
            details: safeJsonClone(error?.details),
          },
        },
      },
      { merge: true }
    );

    await logProviderEvent({
      provider: "mpesa",
      eventType: "stk_push_failed",
      lookupKey: reference,
      reference,
      paymentPath,
      requestId: paymentData?.requestId,
      paymentId: paymentData?.paymentId,
      fullPackageId: paymentData?.fullPackageId,
      payload: {
        attemptId,
        message: failureMessage,
        details: safeJsonClone(error?.details),
      },
    });

    logPaymentLifecycle(
      "initiate.failed",
      {
        reference,
        attemptId,
        requestId: paymentData?.requestId || "",
        paymentId: paymentData?.paymentId || "",
        fullPackageId: paymentData?.fullPackageId || "",
        environment: mpesaConfig.environment,
        message: failureMessage,
        details: safeJsonClone(error?.details),
      },
      "error"
    );
    throw error;
  }
}

async function resolveRoutingCandidateForRequest(requestData = {}) {
  const preferredAgentId = safeString(requestData?.preferredAgentId, 140);
  const requestCountryLower = lower(
    requestData?.country || requestData?.routingMeta?.country,
    120
  );
  const requestCountyLower = lower(
    requestData?.county || requestData?.routingMeta?.county,
    120
  );
  const userSnap = await db
    .collection("users")
    .where("role", "in", Array.from(ACTIVE_ADMIN_ROLE_KEYS))
    .limit(120)
    .get();

  const candidates = [];
  userSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const role = normalizeRole(data?.role);
    const scope = normalizeAdminScope(data?.adminScope);
    if (!ACTIVE_ADMIN_ROLE_KEYS.has(role)) return;
    if (!scope.active || scope.availability === "offline" || scope.availability === "busy") {
      return;
    }
    const matchesPartner = !preferredAgentId || scope.partnerId === preferredAgentId;
    const matchesCountry =
      !requestCountryLower ||
      scope.countriesLower.includes(requestCountryLower) ||
      scope.stationedCountryLower === requestCountryLower ||
      scope.countriesLower.length === 0;
    const matchesCounty =
      !requestCountyLower ||
      scope.countiesLower.length === 0 ||
      scope.countiesLower.includes(requestCountyLower);
    if (!matchesPartner || !matchesCountry || !matchesCounty) return;
    const priority =
      (scope.partnerId === preferredAgentId && preferredAgentId ? -100 : 0) +
      (role === "assignedAdmin" ? -20 : 0);
    candidates.push({
      uid: docSnap.id,
      email: safeString(data?.email, 180),
      role,
      partnerId: scope.partnerId,
      partnerName: scope.partnerName,
      priority,
    });
  });

  candidates.sort((left, right) => left.priority - right.priority);
  return candidates[0] || null;
}

async function autoRouteActivatedRequest(requestRow, paymentSummary = {}) {
  const candidate = await resolveRoutingCandidateForRequest(requestRow?.data || {});
  const updatedAtMs = nowMs();
  if (!candidate) {
    await requestRow.ref.set(
      {
        currentAdminUid: "",
        currentAdminRole: "",
        currentAdminEmail: "",
        assignedAdminId: "",
        routingStatus: "unresolved",
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs,
        routingMeta: {
          ...(requestRow?.data?.routingMeta && typeof requestRow.data.routingMeta === "object"
            ? requestRow.data.routingMeta
            : {}),
          currentAdminUid: "",
          currentAdminEmail: "",
          assignedAdminId: "",
          assignedPartnerId: safeString(requestRow?.data?.assignedPartnerId, 140),
          assignedPartnerName: safeString(requestRow?.data?.assignedPartnerName, 160),
          routedAtMs: 0,
          routingReason: "unlock_payment_activated_no_candidate",
          routingStatus: "unresolved",
          unresolvedReason: "no_valid_admin_available",
          eligibleAdminCount: 0,
        },
        unlockPaymentMeta: safeJsonClone(paymentSummary),
      },
      { merge: true }
    );
    return { ok: false, reason: "no_valid_admin_available" };
  }

  await requestRow.ref.set(
    {
      currentAdminUid: candidate.uid,
      currentAdminRole: candidate.role,
      currentAdminEmail: candidate.email,
      assignedAdminId: candidate.uid,
      assignedPartnerId:
        safeString(requestRow?.data?.assignedPartnerId, 140) || candidate.partnerId,
      assignedPartnerName:
        safeString(requestRow?.data?.assignedPartnerName, 160) || candidate.partnerName,
      routingStatus: "assigned",
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs,
      routingMeta: {
        ...(requestRow?.data?.routingMeta && typeof requestRow.data.routingMeta === "object"
          ? requestRow.data.routingMeta
          : {}),
        currentAdminUid: candidate.uid,
        currentAdminEmail: candidate.email,
        assignedAdminId: candidate.uid,
        assignedPartnerId:
          safeString(requestRow?.data?.assignedPartnerId, 140) || candidate.partnerId,
        assignedPartnerName:
          safeString(requestRow?.data?.assignedPartnerName, 160) || candidate.partnerName,
        routedAtMs: updatedAtMs,
        routingReason: "unlock_payment_activated",
        routingStatus: "assigned",
        unresolvedReason: "",
        eligibleAdminCount: 1,
      },
      unlockPaymentMeta: safeJsonClone(paymentSummary),
    },
    { merge: true }
  );
  return {
    ok: true,
    currentAdminUid: candidate.uid,
    assignedPartnerId:
      safeString(requestRow?.data?.assignedPartnerId, 140) || candidate.partnerId,
  };
}

async function createUnlockCheckoutSession(payload = {}, req) {
  const caller = await verifyCaller(req);
  const requestRow = await loadRequestRow(payload?.requestId);
  ensureRequestOwner(requestRow.data, caller);

  const amount = resolveRequestPricingAmount(requestRow.data);
  const currency = resolveRequestPricingCurrency(requestRow.data);
  if (amount <= 0) {
    const error = new Error("Unlock payment amount is not configured.");
    error.statusCode = 400;
    throw error;
  }

  const paymentId =
    safeString(requestRow.data?.unlockPaymentId, 180) || "unlock_request_payment";
  const paymentRef = requestRow.ref.collection("payments").doc(paymentId);
  const paymentPath = buildDocPath("serviceRequests", requestRow.id, "payments", paymentId);
  const existingSnap = await paymentRef.get();
  const existingData = existingSnap.exists ? existingSnap.data() || {} : {};
  const existingStatus = lower(existingData?.status, 80);
  if (PAYMENT_SUCCESS_STATUSES.has(existingStatus)) {
    const reference = safeString(
      existingData?.transactionReference || existingData?.paymentReference,
      180
    );
    const authorizationUrl = buildFrontendCallbackUrl(req, {
      appBaseUrl: payload?.appBaseUrl,
      reference,
      requestId: requestRow.id,
      paymentId,
      draftId: payload?.draftId,
      returnTo: payload?.returnTo,
    });
    return {
      ...createPaymentSummary(existingData, {
        requestId: requestRow.id,
        paymentId,
        flowType: "unlock_request",
        returnTo: payload?.returnTo || existingData?.returnTo,
        draftId: payload?.draftId || existingData?.draftId,
      }),
      authorizationUrl,
      redirectUrl: authorizationUrl,
      alreadyPaid: true,
    };
  }

  const payerPhone = resolveUserPhone(
    caller,
    payload?.phoneNumber,
    payload?.phone,
    requestRow.data?.phone
  );
  if (!payerPhone) {
    const error = new Error("A valid M-Pesa phone number is required.");
    error.statusCode = 400;
    throw error;
  }

  const reference = buildReference("MUR");
  const paymentData = {
    paymentId,
    requestId: requestRow.id,
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    flowType: "unlock_request",
    payerMode: "request_owner",
    amount,
    currency,
    provider: "mpesa",
    paymentMethod: "mpesa",
    status: PAYMENT_STATUSES.PROMPTED,
    paymentLabel:
      safeString(requestRow.data?.serviceName, 180) || "Request unlock payment",
    note: cleanParagraph(requestRow.data?.note, 2000),
    draftId: safeString(payload?.draftId, 180),
    returnTo: safeString(payload?.returnTo, 1200),
    requestUid: safeString(requestRow.data?.uid, 160),
    transactionReference: reference,
    paymentReference: reference,
    currentReference: reference,
    createdAt: existingSnap.exists
      ? existingData?.createdAt || Timestamp.now()
      : FieldValue.serverTimestamp(),
    createdAtMs: Number(existingData?.createdAtMs || 0) || nowMs(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: nowMs(),
    paymentState: "pending",
  };

  await paymentRef.set(paymentData, { merge: true });
  await requestRow.ref.set(
    {
      unlockPaymentId: paymentId,
      unlockPaymentRequestId: requestRow.id,
      paid: false,
      paymentMeta: null,
      paymentFlowType: "unlock_request",
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );

  let stkResult = null;
  try {
    stkResult = await sendStkAndPersist({
      req,
      paymentRef,
      paymentPath,
      paymentData: {
        ...paymentData,
        requestId: requestRow.id,
        paymentId,
      },
      reference,
      payerPhone,
      description: paymentData.paymentLabel,
    });
  } catch (error) {
    await paymentRef.set(
      {
        status: PAYMENT_STATUSES.FAILED,
        statusMessage: safeString(error?.message, 400),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
    throw error;
  }

  const authorizationUrl = buildFrontendCallbackUrl(req, {
    appBaseUrl: payload?.appBaseUrl,
    reference,
    requestId: requestRow.id,
    paymentId,
    draftId: payload?.draftId,
    returnTo: payload?.returnTo,
  });
  return {
    ok: true,
    requestId: requestRow.id,
    paymentId,
    flowType: "unlock_request",
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    amount,
    currency,
    reference,
    status: PAYMENT_STATUSES.AWAITING_PAYMENT,
    message: stkResult.message,
    authorizationUrl,
    redirectUrl: authorizationUrl,
  };
}

async function createFullPackageUnlockCheckoutSession(payload = {}, req) {
  const caller = await verifyCaller(req);
  const fullPackageRow = await loadFullPackageRow(payload?.fullPackageId);
  ensureFullPackageOwner(fullPackageRow.data, caller);

  const coverage = resolveFullPackageCoverage(
    fullPackageRow.data,
    cleanStringList(payload?.selectedItems, { maxItems: 80, maxLen: 120 })
  );
  if (coverage.isCovered || fullPackageRow.data?.unlockPaid === true) {
    return {
      ok: true,
      alreadyCovered: true,
      flowType: "full_package_unlock",
      fullPackageId: fullPackageRow.id,
      selectedItems: coverage.selectedItems,
      coveredItems: coverage.coveredItems,
      payableItems: [],
      amount: 0,
      currency: normalizeCurrency(fullPackageRow.data?.unlockCurrency || "KES"),
    };
  }

  const amount = roundMoney(payload?.amount || fullPackageRow.data?.unlockAmount || 0);
  if (amount <= 0) {
    const error = new Error("Full package unlock amount is not configured.");
    error.statusCode = 400;
    throw error;
  }
  const currency = normalizeCurrency(
    payload?.currency || fullPackageRow.data?.unlockCurrency || "KES"
  );
  const payerPhone = resolveUserPhone(caller, payload?.phoneNumber, payload?.phone);
  if (!payerPhone) {
    const error = new Error("A valid M-Pesa phone number is required.");
    error.statusCode = 400;
    throw error;
  }

  const paymentRef = fullPackageRow.ref.collection("payments").doc();
  const paymentId = paymentRef.id;
  const paymentPath = buildDocPath("fullPackages", fullPackageRow.id, "payments", paymentId);
  const reference = buildReference("MFP");
  const paymentLabel =
    safeString(payload?.paymentLabel, 180) || "Full package unlock payment";
  const paymentData = {
    paymentId,
    requestId: "",
    fullPackageId: fullPackageRow.id,
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    flowType: "full_package_unlock",
    payerMode: "package_owner",
    amount,
    currency,
    provider: "mpesa",
    paymentMethod: "mpesa",
    status: PAYMENT_STATUSES.PROMPTED,
    paymentLabel,
    note: cleanParagraph(payload?.note || "", 2000),
    draftId: safeString(payload?.draftId, 180),
    returnTo: safeString(payload?.returnTo, 1200),
    selectedItems: coverage.selectedItems,
    coveredItemsBeforePayment: coverage.coveredItems,
    transactionReference: reference,
    paymentReference: reference,
    currentReference: reference,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: nowMs(),
    paymentState: "pending",
  };

  await paymentRef.set(paymentData, { merge: true });
  await fullPackageRow.ref.set(
    {
      selectedItems: coverage.selectedItems,
      unlockAmount: amount,
      unlockCurrency: currency,
      unlockPaid: false,
      unlockPaymentMeta: null,
      lastUnlockPaymentId: paymentId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  let stkResult = null;
  try {
    stkResult = await sendStkAndPersist({
      req,
      paymentRef,
      paymentPath,
      paymentData,
      reference,
      payerPhone,
      description: paymentLabel,
    });
  } catch (error) {
    await paymentRef.set(
      {
        status: PAYMENT_STATUSES.FAILED,
        statusMessage: safeString(error?.message, 400),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
    throw error;
  }

  const authorizationUrl = buildFrontendCallbackUrl(req, {
    appBaseUrl: payload?.appBaseUrl,
    reference,
    paymentId,
    fullPackageId: fullPackageRow.id,
    draftId: payload?.draftId,
    returnTo: payload?.returnTo,
  });
  return {
    ok: true,
    flowType: "full_package_unlock",
    fullPackageId: fullPackageRow.id,
    paymentId,
    amount,
    currency,
    selectedItems: coverage.selectedItems,
    coveredItems: coverage.coveredItems,
    payableItems: coverage.outstandingItems,
    reference,
    status: PAYMENT_STATUSES.AWAITING_PAYMENT,
    message: stkResult.message,
    authorizationUrl,
    redirectUrl: authorizationUrl,
  };
}

async function createInProgressPaymentProposal(payload = {}, req) {
  const caller = await verifyCaller(req);
  ensureRole(caller, ["staff", "assignedAdmin", "superAdmin"]);

  const requestRow = await loadRequestRow(payload?.requestId);
  const paymentLabel = safeString(payload?.paymentLabel, 180);
  const officialAmount = roundMoney(payload?.officialAmount);
  if (!paymentLabel) {
    const error = new Error("paymentLabel is required.");
    error.statusCode = 400;
    throw error;
  }
  if (officialAmount <= 0) {
    const error = new Error("officialAmount must be greater than zero.");
    error.statusCode = 400;
    throw error;
  }
  const settings = await getFinanceSettings();
  const breakdown = calculatePaymentBreakdown({
    officialAmount,
    serviceFee:
      settings?.inProgressPricing?.allowServiceFeeInput === false
        ? 0
        : payload?.serviceFee,
    currency:
      payload?.currency ||
      settings?.inProgressPricing?.defaultCurrency ||
      settings?.defaultCurrency ||
      "KES",
    requestDiscountPercentage: payload?.requestDiscountPercentage,
    platformCutEnabled:
      settings?.inProgressPricing?.platformCutEnabledGlobal !== false,
    settings,
  });
  if (breakdown.finalUserPayable <= 0) {
    const error = new Error("The final payable amount must be greater than zero.");
    error.statusCode = 400;
    throw error;
  }

  const paymentRef = requestRow.ref.collection("payments").doc();
  const paymentId = paymentRef.id;
  const createdAtMs = nowMs();
  await paymentRef.set({
    paymentId,
    requestId: requestRow.id,
    requestUid: safeString(requestRow.data?.uid, 160),
    partnerId: safeString(requestRow.data?.assignedPartnerId, 140),
    partnerName: safeString(requestRow.data?.assignedPartnerName, 160),
    assignedAdminId:
      safeString(requestRow.data?.assignedAdminId, 160) ||
      safeString(requestRow.data?.currentAdminUid, 160),
    paymentType: PAYMENT_TYPES.IN_PROGRESS,
    flowType: "in_progress_payment",
    payerMode: "request_owner_or_shared_link",
    paymentLabel,
    note: cleanParagraph(payload?.note, 2000),
    status: PAYMENT_STATUSES.ADMIN_REVIEW,
    amount: breakdown.finalUserPayable,
    currency: breakdown.currency,
    breakdown,
    financialSnapshot: breakdown,
    provider: "mpesa",
    paymentMethod: "mpesa",
    createdByUid: safeString(caller?.uid, 160),
    createdByRole: safeString(caller?.role, 80),
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: createdAtMs,
  });

  await logFinancialAudit({
    action: "in_progress_payment_proposed",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: requestRow.id,
    paymentId,
    details: {
      breakdown,
      paymentLabel,
    },
  });

  return {
    ok: true,
    requestId: requestRow.id,
    paymentId,
    payment: createPaymentSummary(
      {
        paymentId,
        requestId: requestRow.id,
        paymentType: PAYMENT_TYPES.IN_PROGRESS,
        flowType: "in_progress_payment",
        amount: breakdown.finalUserPayable,
        currency: breakdown.currency,
        status: PAYMENT_STATUSES.ADMIN_REVIEW,
        paymentLabel,
        breakdown,
        financialSnapshot: breakdown,
      },
      {}
    ),
  };
}

async function adminApprovePaymentRequest(payload = {}, req) {
  const caller = await verifyCaller(req);
  ensureFinanceManager(caller);

  const paymentRow = await loadRequestPaymentRow(payload?.requestId, payload?.paymentId);
  const settings = await getFinanceSettings();
  const paymentData = paymentRow.data || {};
  const paymentLabel =
    safeString(payload?.paymentLabel, 180) ||
    safeString(paymentData?.paymentLabel, 180);
  const officialAmount = roundMoney(
    payload?.officialAmount ||
      paymentData?.breakdown?.officialAmount ||
      paymentData?.financialSnapshot?.officialAmount
  );
  const serviceFee = roundMoney(
    payload?.serviceFee ??
      paymentData?.breakdown?.serviceFee ??
      paymentData?.financialSnapshot?.serviceFee
  );
  if (!paymentLabel || officialAmount <= 0) {
    const error = new Error("Payment label and official amount are required.");
    error.statusCode = 400;
    throw error;
  }

  const breakdown = calculatePaymentBreakdown({
    officialAmount,
    serviceFee,
    currency:
      payload?.currency ||
      paymentData?.currency ||
      settings?.inProgressPricing?.defaultCurrency ||
      "KES",
    requestDiscountPercentage: payload?.requestDiscountPercentage,
    platformCutEnabled:
      payload?.platformCutEnabled !== false &&
      settings?.inProgressPricing?.platformCutEnabledGlobal !== false,
    settings,
  });
  if (breakdown.finalUserPayable <= 0) {
    const error = new Error("The approved payable amount must be greater than zero.");
    error.statusCode = 400;
    throw error;
  }

  await paymentRow.ref.set(
    {
      paymentLabel,
      note: cleanParagraph(payload?.note || paymentData?.note, 2000),
      amount: breakdown.finalUserPayable,
      currency: breakdown.currency,
      breakdown,
      financialSnapshot: breakdown,
      status: PAYMENT_STATUSES.PAYABLE,
      approvedAt: FieldValue.serverTimestamp(),
      approvedAtMs: nowMs(),
      approvedByUid: caller.uid,
      approvedByRole: caller.role,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );

  await logFinancialAudit({
    action: "in_progress_payment_approved",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    details: { breakdown, paymentLabel },
  });

  return {
    ok: true,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    payment: createPaymentSummary(
      {
        ...paymentData,
        paymentId: paymentRow.id,
        requestId: paymentRow.requestRow.id,
        paymentType: PAYMENT_TYPES.IN_PROGRESS,
        flowType: "in_progress_payment",
        amount: breakdown.finalUserPayable,
        currency: breakdown.currency,
        status: PAYMENT_STATUSES.PAYABLE,
        paymentLabel,
        breakdown,
        financialSnapshot: breakdown,
      },
      {}
    ),
  };
}

async function adminRevokePaymentRequest(payload = {}, req) {
  const caller = await verifyCaller(req);
  ensureFinanceManager(caller);

  const paymentRow = await loadRequestPaymentRow(payload?.requestId, payload?.paymentId);
  await paymentRow.ref.set(
    {
      status: PAYMENT_STATUSES.REVOKED,
      revokedAt: FieldValue.serverTimestamp(),
      revokedAtMs: nowMs(),
      revokedByUid: caller.uid,
      revokedByRole: caller.role,
      revokeReason: cleanParagraph(payload?.reason, 1000),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );

  await logFinancialAudit({
    action: "in_progress_payment_revoked",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    reason: payload?.reason,
  });

  return {
    ok: true,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    status: PAYMENT_STATUSES.REVOKED,
  };
}

async function resolveSharedPaymentLinkInternal(shareToken = "") {
  const token = safeString(shareToken, 400);
  if (!token) {
    const error = new Error("shareToken is required.");
    error.statusCode = 400;
    throw error;
  }
  const shareRef = db.collection(PAYMENT_SHARE_LINKS_COLLECTION).doc(token);
  const shareSnap = await shareRef.get();
  if (!shareSnap.exists) {
    return {
      ok: true,
      valid: false,
      reason: "not_found",
      message: "This payment link could not be found.",
    };
  }
  const shareData = shareSnap.data() || {};
  const expiresAtMs = Number(shareData?.expiresAtMs || 0) || 0;
  if (expiresAtMs > 0 && expiresAtMs < nowMs()) {
    return {
      ok: true,
      valid: false,
      reason: "expired",
      message: "This payment link has expired.",
    };
  }

  let paymentRow = null;
  try {
    paymentRow = await loadRequestPaymentRow(shareData?.requestId, shareData?.paymentId);
  } catch {
    return {
      ok: true,
      valid: false,
      reason: "payment_missing",
      message: "This payment is no longer available.",
    };
  }
  const status = lower(paymentRow.data?.status, 80);
  if (PAYMENT_SUCCESS_STATUSES.has(status)) {
    return {
      ok: true,
      valid: false,
      alreadyPaid: true,
      reason: "already_paid",
      message: "This payment link has already been paid.",
      payment: createPaymentSummary(paymentRow.data, {
        requestId: paymentRow.requestRow.id,
        paymentId: paymentRow.id,
      }),
    };
  }
  if (!PAYMENT_READY_STATUSES.has(status)) {
    return {
      ok: true,
      valid: false,
      reason: "not_payable",
      message: "This payment is not ready for checkout.",
      payment: createPaymentSummary(paymentRow.data, {
        requestId: paymentRow.requestRow.id,
        paymentId: paymentRow.id,
      }),
    };
  }
  return {
    ok: true,
    valid: true,
    shareToken: token,
    shareUrl: safeString(shareData?.shareUrl, 1200),
    expiresAtMs,
    payment: createPaymentSummary(paymentRow.data, {
      requestId: paymentRow.requestRow.id,
      paymentId: paymentRow.id,
    }),
  };
}

async function createPaymentCheckoutSession(payload = {}, req) {
  const shareToken = safeString(payload?.shareToken, 400);
  let requestRow = null;
  let paymentRow = null;
  let payerEmail = "";
  let payerPhone = "";
  let caller = null;

  if (shareToken) {
    const shareLinkData = await resolveSharedPaymentLinkInternal(shareToken);
    if (shareLinkData?.valid !== true) {
      const error = new Error(
        shareLinkData?.message || "This payment link is not available."
      );
      error.statusCode = 400;
      throw error;
    }
    paymentRow = await loadRequestPaymentRow(
      shareLinkData?.payment?.requestId,
      shareLinkData?.payment?.paymentId
    );
    requestRow = paymentRow.requestRow;
    payerEmail = resolveUserEmail(null, payload?.email, requestRow.data?.email);
    payerPhone = normalizePhoneNumber(payload?.phoneNumber || payload?.phone);
  } else {
    caller = await verifyCaller(req);
    paymentRow = await loadRequestPaymentRow(payload?.requestId, payload?.paymentId);
    requestRow = paymentRow.requestRow;
    ensureRequestOwner(requestRow.data, caller);
    payerEmail = resolveUserEmail(caller, payload?.email, requestRow.data?.email);
    payerPhone = resolveUserPhone(
      caller,
      payload?.phoneNumber,
      payload?.phone,
      requestRow.data?.phone
    );
  }

  if (!payerPhone) {
    const error = new Error("A valid M-Pesa phone number is required.");
    error.statusCode = 400;
    throw error;
  }

  const status = lower(paymentRow.data?.status, 80);
  if (!PAYMENT_READY_STATUSES.has(status)) {
    const error = new Error("This payment is not ready for checkout.");
    error.statusCode = 400;
    throw error;
  }

  const amount = roundMoney(
    paymentRow.data?.breakdown?.finalUserPayable || paymentRow.data?.amount
  );
  const currency = normalizeCurrency(paymentRow.data?.currency || "KES");
  const reference = buildReference("MIP");
  const paymentPath = paymentRow.paymentPath;
  const nextPaymentData = {
    ...paymentRow.data,
    paymentId: paymentRow.id,
    requestId: requestRow.id,
    paymentType:
      safeString(paymentRow.data?.paymentType, 80) || PAYMENT_TYPES.IN_PROGRESS,
    flowType: "in_progress_payment",
    amount,
    currency,
    provider: "mpesa",
    paymentMethod: "mpesa",
    currentReference: reference,
    paymentReference: reference,
    transactionReference: reference,
    payerEmail,
    payerMode: shareToken ? "shared_link" : "request_owner",
    shareToken,
    returnTo: safeString(payload?.returnTo, 1200),
    status: PAYMENT_STATUSES.PROMPTED,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: nowMs(),
  };

  await paymentRow.ref.set(nextPaymentData, { merge: true });
  let stkResult = null;
  try {
    stkResult = await sendStkAndPersist({
      req,
      paymentRef: paymentRow.ref,
      paymentPath,
      paymentData: nextPaymentData,
      reference,
      payerPhone,
      description:
        safeString(paymentRow.data?.paymentLabel, 180) || "MAJUU payment",
    });
  } catch (error) {
    await paymentRow.ref.set(
      {
        status: PAYMENT_STATUSES.FAILED,
        statusMessage: safeString(error?.message, 400),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
    throw error;
  }

  const authorizationUrl = buildFrontendCallbackUrl(req, {
    appBaseUrl: payload?.appBaseUrl,
    reference,
    requestId: requestRow.id,
    paymentId: paymentRow.id,
    returnTo: payload?.returnTo,
    shareToken,
  });
  return {
    ok: true,
    requestId: requestRow.id,
    paymentId: paymentRow.id,
    paymentType: safeString(paymentRow.data?.paymentType, 80),
    flowType: "in_progress_payment",
    amount,
    currency,
    reference,
    payerMode: shareToken ? "shared_link" : "request_owner",
    message: stkResult.message,
    authorizationUrl,
    redirectUrl: authorizationUrl,
  };
}

async function getOrCreateSharedPaymentLink(payload = {}, req) {
  const caller = await verifyCaller(req);
  const paymentRow = await loadRequestPaymentRow(payload?.requestId, payload?.paymentId);
  ensureRequestOwner(paymentRow.requestRow.data, caller);

  const status = lower(paymentRow.data?.status, 80);
  if (!PAYMENT_READY_STATUSES.has(status)) {
    const error = new Error("This payment cannot be shared right now.");
    error.statusCode = 400;
    throw error;
  }

  const existingToken = safeString(paymentRow.data?.shareLinkToken, 400);
  if (existingToken) {
    const existing = await resolveSharedPaymentLinkInternal(existingToken).catch(() => null);
    if (existing?.valid === true && existing?.shareUrl) {
      return existing;
    }
  }

  const settings = await getFinanceSettings();
  const shareToken = buildShareToken();
  const expiresAtMs =
    nowMs() +
    resolvePositiveHours(
      settings?.refundControls?.sharedLinkExpiryHours,
      72
    ) *
      60 *
      60 *
      1000;
  const baseUrl = resolvePublicBaseUrl(
    req,
    settings?.paymentProvider?.paymentLinkBaseUrl
  );
  const shareUrl = `${baseUrl}/pay/shared/${encodeURIComponent(shareToken)}`;

  await db
    .collection(PAYMENT_SHARE_LINKS_COLLECTION)
    .doc(shareToken)
    .set({
      shareToken,
      requestId: paymentRow.requestRow.id,
      paymentId: paymentRow.id,
      paymentPath: paymentRow.paymentPath,
      shareUrl,
      createdByUid: caller.uid,
      createdByRole: caller.role,
      expiresAtMs,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    });

  await paymentRow.ref.set(
    {
      shareLinkToken: shareToken,
      shareLinkUrl: shareUrl,
      shareLinkExpiresAtMs: expiresAtMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );

  await logFinancialAudit({
    action: "payment_share_link_created",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    details: { shareToken, expiresAtMs },
  });

  return {
    ok: true,
    valid: true,
    shareToken,
    shareUrl,
    expiresAtMs,
    payment: createPaymentSummary(paymentRow.data, {
      requestId: paymentRow.requestRow.id,
      paymentId: paymentRow.id,
    }),
  };
}

async function activatePreparedUnlockRequest(payload = {}, req) {
  const caller = await verifyCaller(req);
  const requestRow = await loadRequestRow(payload?.requestId);
  ensureRequestOwner(requestRow.data, caller);

  const currentStatus = lower(requestRow.data?.status, 80);
  const paymentId =
    safeString(requestRow.data?.unlockPaymentId, 180) || "unlock_request_payment";
  const paymentRow = await loadRequestPaymentRow(requestRow.id, paymentId);
  const paymentStatus = lower(paymentRow.data?.status, 80);
  if (currentStatus !== "payment_pending") {
    if (
      requestRow.data?.paid === true &&
      (currentStatus === "new" ||
        currentStatus === "contacted" ||
        currentStatus === "closed" ||
        currentStatus === "rejected")
    ) {
      return {
        ok: true,
        requestId: requestRow.id,
        paymentId,
        status: currentStatus,
        alreadyActivated: true,
      };
    }
    const error = new Error("This request is not waiting for unlock activation.");
    error.statusCode = 400;
    throw error;
  }
  if (paymentStatus !== PAYMENT_STATUSES.PAID) {
    const error = new Error("Unlock payment is not confirmed yet.");
    error.statusCode = 400;
    throw error;
  }

  const paymentMeta = {
    status: "paid",
    method: "mpesa",
    paidAt: Number(paymentRow.data?.paidAtMs || 0) || nowMs(),
    ref: safeString(paymentRow.data?.transactionReference, 180),
    requestId: requestRow.id,
    paymentId,
    amount: roundMoney(paymentRow.data?.amount),
    currency: normalizeCurrency(paymentRow.data?.currency || "KES"),
  };

  await requestRow.ref.set(
    {
      paid: true,
      paymentState: "paid",
      paymentMeta,
      unlockPaymentMeta: paymentMeta,
      unlockPaymentId: paymentId,
      unlockPaymentRequestId: requestRow.id,
      status: "new",
      routingStatus: "awaiting_route",
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
      routingMeta: {
        ...(requestRow.data?.routingMeta && typeof requestRow.data.routingMeta === "object"
          ? requestRow.data.routingMeta
          : {}),
        routingReason: "unlock_payment_activated",
        routingStatus: "awaiting_route",
        unresolvedReason: "",
      },
    },
    { merge: true }
  );

  const routeResult = await autoRouteActivatedRequest(requestRow, paymentMeta);
  await logFinancialAudit({
    action: "unlock_request_activated",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: requestRow.id,
    paymentId,
    details: { routeResult },
  });
  return {
    ok: true,
    requestId: requestRow.id,
    paymentId,
    routeResult,
  };
}

async function requestPaymentRefund(payload = {}, req) {
  const caller = await verifyCaller(req);
  const paymentRow = await loadRequestPaymentRow(payload?.requestId, payload?.paymentId);
  ensureRequestOwner(paymentRow.requestRow.data, caller);

  const paymentStatus = lower(paymentRow.data?.status, 80);
  if (
    paymentStatus !== PAYMENT_STATUSES.HELD &&
    paymentStatus !== PAYMENT_STATUSES.PAYOUT_READY &&
    paymentStatus !== PAYMENT_STATUSES.SETTLED
  ) {
    const error = new Error("This payment is not eligible for a refund request.");
    error.statusCode = 400;
    throw error;
  }

  const refundRef = paymentRow.requestRow.ref.collection("refundRequests").doc();
  const refundId = refundRef.id;
  const createdAtMs = nowMs();
  await refundRef.set({
    refundId,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    paymentType: safeString(paymentRow.data?.paymentType, 80),
    status: REFUND_STATUSES.REQUESTED,
    provider: "mpesa",
    service: "b2c",
    amount: roundMoney(paymentRow.data?.amount),
    currency: normalizeCurrency(paymentRow.data?.currency || "KES"),
    userReason: cleanParagraph(payload?.userReason, 2000),
    requesterUid: caller.uid,
    requesterEmail: caller.email,
    previousPaymentStatus: paymentStatus,
    capabilities: MPESA_REFUND_CAPABILITIES,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: createdAtMs,
  });

  await paymentRow.ref.set(
    {
      status: PAYMENT_STATUSES.REFUND_REQUESTED,
      refundRequestId: refundId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );

  await logFinancialAudit({
    action: "payment_refund_requested",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: paymentRow.requestRow.id,
    paymentId: paymentRow.id,
    refundId,
    reason: payload?.userReason,
  });

  return { ok: true, requestId: paymentRow.requestRow.id, refundId };
}

async function adminDecidePaymentRefund(payload = {}, req) {
  const caller = await verifyCaller(req);
  ensureFinanceManager(caller);

  const requestRow = await loadRequestRow(payload?.requestId);
  const refundId = safeString(payload?.refundId, 180);
  if (!refundId) {
    const error = new Error("refundId is required.");
    error.statusCode = 400;
    throw error;
  }
  const refundRef = requestRow.ref.collection("refundRequests").doc(refundId);
  const refundSnap = await refundRef.get();
  if (!refundSnap.exists) {
    const error = new Error("Refund request not found.");
    error.statusCode = 404;
    throw error;
  }
  const refundData = refundSnap.data() || {};
  const paymentRow = await loadRequestPaymentRow(requestRow.id, refundData?.paymentId);
  const decision = lower(payload?.decision, 40);
  if (decision !== "approve" && decision !== "reject") {
    const error = new Error("decision must be approve or reject.");
    error.statusCode = 400;
    throw error;
  }

  if (decision === "approve") {
    const refundExecution = buildRefundPlaceholder({
      requestId: requestRow.id,
      paymentId: paymentRow.id,
      amount: paymentRow.data?.amount,
      currency: paymentRow.data?.currency,
      actorUid: caller.uid,
      reason: payload?.note || refundData?.userReason,
    });
    await refundRef.set(
      {
        status: REFUND_STATUSES.APPROVED,
        adminExplanation: cleanParagraph(payload?.note, 2000),
        expectedRefundPeriodText: safeString(payload?.expectedRefundPeriodText, 240),
        approvedByUid: caller.uid,
        approvedByRole: caller.role,
        refundExecution,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
    await paymentRow.ref.set(
      {
        status: PAYMENT_STATUSES.REFUND_UNDER_REVIEW,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
    await logFinancialAudit({
      action: "payment_refund_approved",
      actorUid: caller.uid,
      actorRole: caller.role,
      requestId: requestRow.id,
      paymentId: paymentRow.id,
      refundId,
      reason: payload?.note,
    });
    return { ok: true, requestId: requestRow.id, refundId, status: REFUND_STATUSES.APPROVED };
  }

  await refundRef.set(
    {
      status: REFUND_STATUSES.REJECTED,
      rejectionReason: cleanParagraph(payload?.note, 2000),
      rejectedByUid: caller.uid,
      rejectedByRole: caller.role,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );
  await paymentRow.ref.set(
    {
      status:
        safeString(refundData?.previousPaymentStatus, 80) || PAYMENT_STATUSES.HELD,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );
  await logFinancialAudit({
    action: "payment_refund_rejected",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: requestRow.id,
    paymentId: paymentRow.id,
    refundId,
    reason: payload?.note,
  });
  return { ok: true, requestId: requestRow.id, refundId, status: REFUND_STATUSES.REJECTED };
}

async function releasePartnerPayout(payload = {}, req) {
  const caller = await verifyCaller(req);
  ensureFinanceManager(caller);

  const queueId = safeString(payload?.queueId, 180);
  if (!queueId) {
    const error = new Error("queueId is required.");
    error.statusCode = 400;
    throw error;
  }
  const queueRef = db.collection(PAYOUT_QUEUE_COLLECTION).doc(queueId);
  const queueSnap = await queueRef.get();
  if (!queueSnap.exists) {
    const error = new Error("Payout queue entry not found.");
    error.statusCode = 404;
    throw error;
  }
  const queueData = queueSnap.data() || {};
  const settlementReference =
    safeString(payload?.settlementReference, 180) || buildReference("SET");
  const releasedAtMs = nowMs();

  await queueRef.set(
    {
      status: "paid_out",
      settlementReference,
      releaseNotes: cleanParagraph(payload?.releaseNotes, 2000),
      releasedByUid: caller.uid,
      releasedByRole: caller.role,
      releasedAt: FieldValue.serverTimestamp(),
      releasedAtMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: releasedAtMs,
    },
    { merge: true }
  );

  const settlementRef = db.collection(SETTLEMENT_HISTORY_COLLECTION).doc();
  await settlementRef.set({
    settlementId: settlementRef.id,
    queueId,
    requestId: safeString(queueData?.requestId, 180),
    paymentId: safeString(queueData?.paymentId, 180),
    partnerId: safeString(queueData?.partnerId, 160),
    partnerName: safeString(queueData?.partnerName, 160),
    amount: roundMoney(queueData?.amount),
    currency: normalizeCurrency(queueData?.currency || "KES"),
    settlementReference,
    releaseNotes: cleanParagraph(payload?.releaseNotes, 2000),
    releasedByUid: caller.uid,
    releasedByRole: caller.role,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: releasedAtMs,
    releasedAt: FieldValue.serverTimestamp(),
    releasedAtMs,
  });

  const paymentPath = safeString(queueData?.paymentPath, 400);
  if (paymentPath) {
    await db.doc(paymentPath).set(
      {
        status: PAYMENT_STATUSES.SETTLED,
        settledAt: FieldValue.serverTimestamp(),
        settledAtMs: releasedAtMs,
        settlementReference,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: releasedAtMs,
      },
      { merge: true }
    );
  }

  await logFinancialAudit({
    action: "partner_payout_released",
    actorUid: caller.uid,
    actorRole: caller.role,
    requestId: safeString(queueData?.requestId, 180),
    paymentId: safeString(queueData?.paymentId, 180),
    payoutQueueId: queueId,
    reason: payload?.releaseNotes,
  });

  return { ok: true, queueId, settlementReference };
}

async function listUnlockAutoRefundCandidates(payload = {}, req) {
  const caller = await verifyCaller(req);
  ensureFinanceManager(caller);

  const settings = await getFinanceSettings();
  const refundHours = resolvePositiveHours(
    settings?.refundControls?.unlockAutoRefundHours,
    48
  );
  const eligibleThresholdMs = nowMs() - refundHours * 60 * 60 * 1000;
  const filterIds = new Set(
    cleanStringList(payload?.requestIds, { maxItems: 80, maxLen: 180 })
  );
  const requestSnap = await db
    .collection("serviceRequests")
    .where("status", "==", "payment_pending")
    .limit(240)
    .get();
  const rows = [];
  for (const docSnap of requestSnap.docs) {
    if (filterIds.size && !filterIds.has(docSnap.id)) continue;
    const requestData = docSnap.data() || {};
    const paymentId =
      safeString(requestData?.unlockPaymentId, 180) || "unlock_request_payment";
    const paymentSnap = await docSnap.ref.collection("payments").doc(paymentId).get();
    if (!paymentSnap.exists) continue;
    const paymentData = paymentSnap.data() || {};
    if (lower(paymentData?.status, 80) !== PAYMENT_STATUSES.PAID) continue;
    const paidAtMs = Number(paymentData?.paidAtMs || 0);
    if (!paidAtMs || paidAtMs > eligibleThresholdMs) continue;
    rows.push({
      requestId: docSnap.id,
      paymentId,
      amount: roundMoney(paymentData?.amount),
      currency: normalizeCurrency(paymentData?.currency || "KES"),
      reference: safeString(paymentData?.transactionReference, 180),
      paidAtMs,
      eligibleAtMs: paidAtMs + refundHours * 60 * 60 * 1000,
    });
  }
  return { ok: true, rows };
}

async function runUnlockAutoRefundSweep(payload = {}, req) {
  const candidates = await listUnlockAutoRefundCandidates(payload, req);
  let applied = 0;
  for (const row of Array.isArray(candidates?.rows) ? candidates.rows : []) {
    const requestRow = await loadRequestRow(row.requestId);
    const refundRef = requestRow.ref.collection("refundRequests").doc();
    await refundRef.set({
      refundId: refundRef.id,
      requestId: row.requestId,
      paymentId: row.paymentId,
      paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
      status: REFUND_STATUSES.APPROVED,
      provider: "mpesa",
      service: "b2c",
      amount: row.amount,
      currency: row.currency,
      autoRequested: true,
      autoReason: "unlock_auto_refund_window_elapsed",
      refundExecution: buildRefundPlaceholder({
        requestId: row.requestId,
        paymentId: row.paymentId,
        amount: row.amount,
        currency: row.currency,
        reason: "Unlock auto-refund placeholder created after payment pending timeout.",
      }),
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    });
    await requestRow.ref.collection("payments").doc(row.paymentId).set(
      {
        status: PAYMENT_STATUSES.REFUND_UNDER_REVIEW,
        autoRefundRequestId: refundRef.id,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
    applied += 1;
  }
  return { ok: true, applied };
}

export async function lookupPaymentByReference({ reference = "" } = {}) {
  const key = safeString(reference, 180);
  if (!key) {
    const error = new Error("Payment reference is missing.");
    error.statusCode = 400;
    throw error;
  }
  logPaymentLifecycle("verify.lookup.start", {
    reference: key,
  });
  const loaded = await loadPaymentByLookupKey(key);
  if (!loaded?.paymentData) {
    logPaymentLifecycle("verify.lookup.missing", {
      reference: key,
    }, "warn");
    const error = new Error("Payment reference was not found.");
    error.statusCode = 404;
    throw error;
  }
  const summary = createPaymentSummary(loaded.paymentData, {
    requestId: loaded.requestId,
    paymentId: loaded.paymentId,
    fullPackageId: loaded.fullPackageId,
    flowType: loaded.paymentData?.flowType,
    paymentType: loaded.paymentData?.paymentType,
    fullPackage:
      loaded.fullPackageId && loaded.fullPackageData
        ? { fullPackageId: loaded.fullPackageId }
        : null,
  });
  if (loaded.fullPackageId) {
    summary.fullPackage = { fullPackageId: loaded.fullPackageId };
  }
  logPaymentLifecycle("verify.lookup.resolved", {
    reference: key,
    requestId: loaded.requestId || "",
    paymentId: loaded.paymentId || "",
    fullPackageId: loaded.fullPackageId || "",
    status: summary?.status || "",
    paymentType: summary?.paymentType || "",
    flowType: summary?.flowType || "",
  });
  return summary;
}

function parseMpesaCallbackPayload(payload = {}) {
  const callback =
    payload?.Body?.stkCallback && typeof payload.Body.stkCallback === "object"
      ? payload.Body.stkCallback
      : payload?.stkCallback && typeof payload.stkCallback === "object"
        ? payload.stkCallback
        : {};
  const metadata = parseDarajaMetadata(callback);
  return {
    callback,
    resultCode: Number(callback?.ResultCode ?? payload?.ResultCode ?? -1),
    resultDesc: safeString(callback?.ResultDesc || payload?.ResultDesc, 400),
    merchantRequestId: safeString(callback?.MerchantRequestID, 180),
    checkoutRequestId: safeString(callback?.CheckoutRequestID, 180),
    receiptNumber: safeString(metadata?.MpesaReceiptNumber, 160),
    amount: roundMoney(metadata?.Amount),
    phoneNumber: normalizePhoneNumber(metadata?.PhoneNumber),
    transactionDateMs: parseDarajaTransactionDate(metadata?.TransactionDate),
    metadata,
    raw: safeJsonClone(payload),
  };
}

async function ensurePayoutQueueForPayment({
  paymentData,
  requestData,
  paymentPath,
  requestId,
  paymentId,
} = {}) {
  const queueId = safeString(paymentData?.payoutQueueId, 180) || paymentId;
  const queueRef = db.collection(PAYOUT_QUEUE_COLLECTION).doc(queueId);
  const amount =
    roundMoney(paymentData?.breakdown?.partnerNetAmount) || roundMoney(paymentData?.amount);
  const partnerId = safeString(
    paymentData?.partnerId || requestData?.assignedPartnerId,
    160
  );
  const partnerName = safeString(
    paymentData?.partnerName || requestData?.assignedPartnerName,
    160
  );
  const payoutDestinationReady = Boolean(partnerId);
  await queueRef.set(
    {
      queueId,
      requestId,
      paymentId,
      paymentPath,
      partnerId,
      partnerName,
      amount,
      currency: normalizeCurrency(paymentData?.currency || "KES"),
      status: payoutDestinationReady ? "ready" : "on_hold",
      payoutDestinationReady,
      holdReason: payoutDestinationReady ? "" : "missing_partner_destination",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
    },
    { merge: true }
  );
  return queueId;
}

export async function processMpesaCallback(payload = {}) {
  const parsed = parseMpesaCallbackPayload(payload);
  const lookupKey =
    parsed.checkoutRequestId || parsed.merchantRequestId || safeString(payload?.reference, 180);
  logPaymentLifecycle("callback.received", {
    lookupKey,
    checkoutRequestId: parsed.checkoutRequestId,
    merchantRequestId: parsed.merchantRequestId,
    resultCode: parsed.resultCode,
    resultDesc: parsed.resultDesc,
    receiptNumber: parsed.receiptNumber,
    phoneNumber: maskPhoneNumber(parsed.phoneNumber),
  });
  const loaded = await loadPaymentByLookupKey(lookupKey);
  await logProviderEvent({
    provider: "mpesa",
    eventType: "stk_callback_received",
    lookupKey,
    reference: loaded?.canonicalReference || "",
    paymentPath: loaded?.paymentPath || "",
    requestId: loaded?.requestId || "",
    paymentId: loaded?.paymentId || "",
    fullPackageId: loaded?.fullPackageId || "",
    payload,
  });

  if (!loaded?.paymentData || !loaded?.paymentRef) {
    logPaymentLifecycle("callback.unmatched", {
      lookupKey,
      checkoutRequestId: parsed.checkoutRequestId,
      merchantRequestId: parsed.merchantRequestId,
      resultCode: parsed.resultCode,
    }, "warn");
    return {
      ok: true,
      matched: false,
      lookupKey,
      message: "Callback recorded without a matching payment.",
    };
  }

  const paymentData = loaded.paymentData || {};
  const paymentId = loaded.paymentId;
  const paymentPath = loaded.paymentPath;
  const requestId = loaded.requestId;
  const fullPackageId = loaded.fullPackageId;
  const reference =
    safeString(paymentData?.transactionReference, 180) || loaded.canonicalReference;
  const isSuccess = parsed.resultCode === 0;
  const settledAtMs = parsed.transactionDateMs || nowMs();

  const commonPatch = {
    provider: "mpesa",
    paymentMethod: "mpesa",
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: nowMs(),
    currentReference: reference,
    paymentReference: reference,
    transactionReference: reference,
    mpesa: {
      ...(paymentData?.mpesa && typeof paymentData.mpesa === "object" ? paymentData.mpesa : {}),
      merchantRequestId:
        parsed.merchantRequestId ||
        safeString(paymentData?.mpesa?.merchantRequestId, 180),
      checkoutRequestId:
        parsed.checkoutRequestId ||
        safeString(paymentData?.mpesa?.checkoutRequestId, 180),
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
      receiptNumber: parsed.receiptNumber,
      callbackPhoneNumber: parsed.phoneNumber,
      transactionDateMs: settledAtMs,
      lastCallbackPayload: parsed.raw,
    },
  };

  if (parsed.receiptNumber) {
    await upsertProviderReferenceAlias(parsed.receiptNumber, {
      canonicalReference: reference,
      paymentPath,
      requestId,
      paymentId,
      fullPackageId,
      flowType: paymentData?.flowType,
      paymentType: paymentData?.paymentType,
    });
  }

  if (!isSuccess) {
    await loaded.paymentRef.set(
      {
        ...commonPatch,
        status: PAYMENT_STATUSES.FAILED,
        statusMessage: parsed.resultDesc || "M-Pesa payment failed.",
        failedAt: FieldValue.serverTimestamp(),
        failedAtMs: nowMs(),
      },
      { merge: true }
    );

    if (requestId && loaded.requestRef) {
      await loaded.requestRef.set(
        {
          paymentState: "failed",
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      );
    }

    if (fullPackageId && loaded.fullPackageRef) {
      await loaded.fullPackageRef.set(
        {
          unlockPaid: false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    logPaymentLifecycle("callback.applied", {
      lookupKey,
      reference,
      requestId,
      paymentId,
      fullPackageId,
      status: PAYMENT_STATUSES.FAILED,
      resultCode: parsed.resultCode,
      resultDesc: parsed.resultDesc,
    }, "warn");

    return {
      ok: true,
      matched: true,
      status: PAYMENT_STATUSES.FAILED,
      requestId,
      paymentId,
      fullPackageId,
      reference,
    };
  }

  const paymentType = lower(paymentData?.paymentType, 80);
  const flowType = lower(paymentData?.flowType, 80);
  let nextStatus = PAYMENT_STATUSES.PAID;
  if (paymentType === PAYMENT_TYPES.IN_PROGRESS) {
    nextStatus = PAYMENT_STATUSES.HELD;
  }

  await loaded.paymentRef.set(
    {
      ...commonPatch,
      amount: parsed.amount > 0 ? parsed.amount : roundMoney(paymentData?.amount),
      status: nextStatus,
      statusMessage: "Payment confirmed by M-Pesa callback.",
      paidAt: FieldValue.serverTimestamp(),
      paidAtMs: settledAtMs,
      callbackReceivedAt: FieldValue.serverTimestamp(),
      callbackReceivedAtMs: nowMs(),
    },
    { merge: true }
  );

  if (flowType === "full_package_unlock" && fullPackageId && loaded.fullPackageRef) {
    const coveredItems = cleanStringList(paymentData?.selectedItems, {
      maxItems: 80,
      maxLen: 120,
    });
    const unlockPaymentMeta = {
      status: "paid",
      method: "mpesa",
      paidAt: settledAtMs,
      ref: reference,
      paymentId,
      amount: parsed.amount > 0 ? parsed.amount : roundMoney(paymentData?.amount),
      currency: normalizeCurrency(paymentData?.currency || "KES"),
      receiptNumber: parsed.receiptNumber,
    };
    await loaded.fullPackageRef.set(
      {
        unlockPaid: true,
        depositPaid: true,
        unlockAmount:
          parsed.amount > 0 ? parsed.amount : roundMoney(paymentData?.amount),
        unlockCurrency: normalizeCurrency(paymentData?.currency || "KES"),
        unlockPaymentMeta,
        depositPaymentMeta: unlockPaymentMeta,
        unlockCoverage: {
          coveredItems,
          lastUpdatedAtMs: nowMs(),
          lastPaymentId: paymentId,
        },
        coveredItems,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else if (paymentType === PAYMENT_TYPES.UNLOCK_REQUEST && requestId && loaded.requestRef) {
    const unlockPaymentMeta = {
      status: "paid",
      method: "mpesa",
      paidAt: settledAtMs,
      ref: reference,
      paymentId,
      amount: parsed.amount > 0 ? parsed.amount : roundMoney(paymentData?.amount),
      currency: normalizeCurrency(paymentData?.currency || "KES"),
      receiptNumber: parsed.receiptNumber,
    };
    await loaded.requestRef.set(
      {
        paid: true,
        paymentState: "paid",
        paymentMeta: unlockPaymentMeta,
        unlockPaymentMeta,
        unlockPaymentId: paymentId,
        unlockPaymentRequestId: requestId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
  } else if (paymentType === PAYMENT_TYPES.IN_PROGRESS && requestId) {
    const queueId = await ensurePayoutQueueForPayment({
      paymentData: {
        ...paymentData,
        amount: parsed.amount > 0 ? parsed.amount : roundMoney(paymentData?.amount),
      },
      requestData: loaded.requestData || {},
      paymentPath,
      requestId,
      paymentId,
    });
    await loaded.paymentRef.set(
      {
        payoutQueueId: queueId,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );
  }

  logPaymentLifecycle("callback.applied", {
    lookupKey,
    reference,
    requestId,
    paymentId,
    fullPackageId,
    status: nextStatus,
    resultCode: parsed.resultCode,
    resultDesc: parsed.resultDesc,
    receiptNumber: parsed.receiptNumber,
  });

  return {
    ok: true,
    matched: true,
    status: nextStatus,
    requestId,
    paymentId,
    fullPackageId,
    reference,
  };
}

export async function initiatePaymentFlow(payload = {}, req) {
  const flowType = lower(payload?.flowType, 80);
  if (flowType === "unlock_request") {
    return createUnlockCheckoutSession(payload, req);
  }
  if (flowType === "full_package_unlock") {
    return createFullPackageUnlockCheckoutSession(payload, req);
  }
  if (flowType === "in_progress_payment" || flowType === "shared_in_progress_payment") {
    return createPaymentCheckoutSession(payload, req);
  }
  const error = new Error("Unsupported payment flow.");
  error.statusCode = 400;
  throw error;
}

export async function dispatchFinanceAction({ action = "", payload = {}, req } = {}) {
  const safeAction = safeString(action, 120);
  switch (safeAction) {
    case "createUnlockCheckoutSession":
      return createUnlockCheckoutSession(payload, req);
    case "createFullPackageUnlockCheckoutSession":
      return createFullPackageUnlockCheckoutSession(payload, req);
    case "createPaymentCheckoutSession":
      return createPaymentCheckoutSession(payload, req);
    case "reconcilePaymentReference":
      return lookupPaymentByReference({ reference: payload?.reference });
    case "activatePreparedUnlockRequest":
      return activatePreparedUnlockRequest(payload, req);
    case "createInProgressPaymentProposal":
      return createInProgressPaymentProposal(payload, req);
    case "adminApprovePaymentRequest":
      return adminApprovePaymentRequest(payload, req);
    case "adminRevokePaymentRequest":
      return adminRevokePaymentRequest(payload, req);
    case "getOrCreateSharedPaymentLink":
      return getOrCreateSharedPaymentLink(payload, req);
    case "resolveSharedPaymentLink":
      return resolveSharedPaymentLinkInternal(payload?.shareToken);
    case "requestPaymentRefund":
      return requestPaymentRefund(payload, req);
    case "adminDecidePaymentRefund":
      return adminDecidePaymentRefund(payload, req);
    case "releasePartnerPayout":
      return releasePartnerPayout(payload, req);
    case "getFinanceEnvironmentStatus": {
      const caller = await verifyCaller(req);
      ensureFinanceManager(caller);
      const settings = await getFinanceSettings();
      const config = await getProviderConfig();
      return {
        ok: true,
        providerStatus: buildProviderStatus({ settings, config, req }),
      };
    }
    case "saveFinanceSettings": {
      const caller = await verifyCaller(req);
      ensureFinanceManager(caller);
      const normalized = normalizeFinanceSettingsDoc(payload?.settings || {});
      await db
        .collection(FINANCE_SETTINGS_COLLECTION)
        .doc(FINANCE_SETTINGS_DOC)
        .set(
          {
            ...normalized,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
            updatedByUid: caller.uid,
            updatedByEmail: caller.email,
          },
          { merge: true }
        );
      const config = await getProviderConfig();
      return {
        ok: true,
        settings: normalized,
        providerStatus: buildProviderStatus({ settings: normalized, config, req }),
      };
    }
    case "getPaymentProviderConfigStatus": {
      const caller = await verifyCaller(req);
      ensureFinanceManager(caller);
      const settings = await getFinanceSettings();
      const config = await getProviderConfig();
      return {
        ok: true,
        config: sanitizeProviderConfigForClient(config),
        encryptionReady: true,
        providerStatus: buildProviderStatus({ settings, config, req }),
      };
    }
    case "savePaymentProviderConfig": {
      const caller = await verifyCaller(req);
      ensureFinanceManager(caller);
      const existing = await getProviderConfig();
      const normalized = normalizeProviderConfigForStorage(payload?.config || {}, existing);
      await db
        .collection(PAYMENT_PROVIDER_CONFIG_COLLECTION)
        .doc(PAYMENT_PROVIDER_CONFIG_DOC)
        .set(
          {
            ...normalized,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
            updatedByUid: caller.uid,
            updatedByEmail: caller.email,
          },
          { merge: true }
        );
      const settings = await getFinanceSettings();
      return {
        ok: true,
        changed: true,
        config: sanitizeProviderConfigForClient(normalized),
        encryptionReady: true,
        providerStatus: buildProviderStatus({ settings, config: normalized, req }),
      };
    }
    case "listUnlockAutoRefundCandidates":
      return listUnlockAutoRefundCandidates(payload, req);
    case "runUnlockAutoRefundSweep":
      return runUnlockAutoRefundSweep(payload, req);
    default: {
      const error = new Error(`Unsupported finance action: ${safeAction || "unknown"}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

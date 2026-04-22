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
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { auth, db } from "../firebase";
import DemoProviderCheckoutModal from "../components/DemoPaystackCheckoutModal";
import {
  initiatePayment,
  invokeFinanceAction,
  verifyPayment,
} from "./apiService";
import { resolveFullPackageCoverageState } from "./fullpackageservice";
import { getRequestStartedAtMs } from "../utils/requestWorkProgress";
const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();
const IS_NATIVE_ANDROID =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
const LOCAL_PAYMENT_BACKEND_BASE_URL = resolvePaymentBackendBaseUrl();
const PAYMENT_MODE = lower(import.meta.env.VITE_PAYMENT_MODE || "", 40);
const PAYMENT_CHECKOUT_START_ERROR = "payment checkout could not start right now";
const PAYMENT_VERIFY_ERROR = "We could not confirm this payment yet.";
const PAYMENT_DEBUG = String(import.meta.env.VITE_PAYMENT_DEBUG || "").trim().toLowerCase() === "true";
const ACTIVE_PAYMENT_PROVIDER = normalizeProviderKey(
  import.meta.env.VITE_PAYMENT_PROVIDER || "mpesa"
);
const DEMO_PROVIDER_KEY = `demo_${ACTIVE_PAYMENT_PROVIDER}`;
const VERIFIED_PAYMENT_STATUSES = new Set([
  "success",
  "paid",
  "held",
  "payout_ready",
  "settled",
]);

export const PAYMENT_TYPES = {
  UNLOCK_REQUEST: "unlock_request",
  IN_PROGRESS: "in_progress",
};

export const PAYMENT_STATUSES = {
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
};

export const REFUND_STATUSES = {
  REQUESTED: "requested",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  REFUNDED: "refunded",
  FAILED: "failed",
  AUTO_REFUNDED: "auto_refunded",
};

export const UNLOCK_AUTO_REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;

function cleanStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return cleanStr(value, max).toLowerCase();
}

function normalizeProviderKey(value, fallback = "mpesa") {
  const raw = lower(value, 40);
  if (raw === "mpesa" || raw === "paystack") return raw;
  const safeFallback = lower(fallback, 40);
  return safeFallback === "paystack" ? "paystack" : "mpesa";
}

function trimTrailingSlash(value) {
  return cleanStr(value, 1000).replace(/\/+$/, "");
}

function paymentDebugLog(label, payload) {
  if (!PAYMENT_DEBUG) return;
  if (payload === undefined) {
    console.log(`[payment-debug] ${label}`);
    return;
  }
  console.log(`[payment-debug] ${label}`, payload);
}

function resolvePaymentBackendBaseUrl() {
  const configured = trimTrailingSlash(import.meta.env.VITE_PAYMENT_API_BASE_URL);
  if (configured) return configured;

  const host =
    typeof window !== "undefined" ? cleanStr(window.location.hostname, 200) : "";
  if (host) {
    return `http://${host}:5000`;
  }

  return "http://127.0.0.1:5000";
}

function resolveFrontendAppBaseUrl(value) {
  const configured = trimTrailingSlash(import.meta.env.VITE_APP_BASE_URL);
  if (configured) return configured;
  return trimTrailingSlash(value);
}

function resolvePaymentCallbackApiPath() {
  const configured = cleanStr(import.meta.env.VITE_PAYMENT_CALLBACK_API_PATH, 240);
  return configured || "/api/mpesa-callback";
}

function resolveFrontendPaymentCallbackPath() {
  const configured = cleanStr(import.meta.env.VITE_PAYMENT_FRONTEND_CALLBACK_PATH, 240);
  return configured || "/payment/callback";
}

function cleanAmount(value) {
  const source = typeof value === "string" ? value.replace(/[^0-9.]+/g, "") : value;
  const num = Number(source || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

function cleanCurrency(value) {
  return cleanStr(value || "KES", 8).toUpperCase() || "KES";
}

function cleanStringList(values, maxItems = 60, maxLen = 160) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const next = cleanStr(value, maxLen);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    if (out.length >= maxItems) break;
  }
  return out;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCheckoutPayableStatus(status = "") {
  const safeStatus = lower(status, 80);
  return new Set([
    PAYMENT_STATUSES.PAYABLE,
    PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
    PAYMENT_STATUSES.AWAITING_PAYMENT,
    PAYMENT_STATUSES.FAILED,
    "pending_payment",
  ]).has(safeStatus);
}

function ensureCheckoutPayable(paymentData = {}, { source = "payment" } = {}) {
  const status = lower(paymentData?.status, 80);
  if (!isCheckoutPayableStatus(status)) {
    const label = cleanStr(source, 60) || "payment";
    throw new Error(`This ${label} is not ready for payment.`);
  }
}

function resolveCheckoutEmail(...candidates) {
  for (const candidate of candidates) {
    const email = lower(candidate, 160);
    if (email && email.includes("@")) return email;
  }
  return "";
}

function compactMetadata(source = {}) {
  const data = source && typeof source === "object" ? source : {};
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      const next = cleanStringList(value, 60, 160);
      if (next.length) out[key] = next;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value) && value !== 0) out[key] = value;
      continue;
    }
    const next = cleanStr(value, 600);
    if (next) out[key] = next;
  }
  return out;
}

function buildHostedPaymentMetadata({
  flowType,
  paymentType,
  requestId,
  paymentId,
  draftId,
  returnTo,
  shareToken,
  appBaseUrl,
  fullPackageId,
  track,
  country,
  requestType,
  serviceName,
  paymentLabel,
  payerMode,
  currency,
  selectedItems,
  discountAmount,
  discountAppliedPercentage,
  note,
  metadata,
} = {}) {
  const extra = metadata && typeof metadata === "object" ? metadata : {};
  return compactMetadata({
    source: "majuu_web",
    callbackPath: resolvePaymentCallbackApiPath(),
    frontendCallbackPath: resolveFrontendPaymentCallbackPath(),
    flowType,
    paymentType,
    requestId,
    paymentId,
    draftId,
    returnTo,
    shareToken,
    appBaseUrl,
    fullPackageId,
    track,
    country,
    requestType,
    serviceName,
    paymentLabel,
    payerMode,
    currency,
    selectedItems: cleanStringList(selectedItems, 60, 120),
    discountAmount: cleanAmount(discountAmount),
    discountAppliedPercentage: Number(discountAppliedPercentage || 0),
    note,
    ...extra,
  });
}

function appendDemoQueryParam(params, key, value) {
  const next = cleanStr(value, 600);
  if (next) params.set(key, next);
}

function isDemoPaymentMode() {
  return PAYMENT_MODE === "demo";
}

function isDemoPaymentReference(reference = "") {
  return cleanStr(reference, 160).toUpperCase().startsWith("DEMO-");
}

function buildDemoCallbackUrl({ reference, metadata } = {}) {
  const data = compactMetadata(metadata);
  const baseUrl = resolveFrontendAppBaseUrl(
    data.appBaseUrl || (typeof window !== "undefined" ? window.location.origin : "")
  );
  const callbackPath =
    cleanStr(
      data.frontendCallbackPath || data.callbackPath || resolveFrontendPaymentCallbackPath(),
      240
    ) || resolveFrontendPaymentCallbackPath();
  if (!baseUrl) return "";

  const params = new URLSearchParams();
  appendDemoQueryParam(params, "reference", reference);
  appendDemoQueryParam(params, "requestId", data.requestId);
  appendDemoQueryParam(params, "paymentId", data.paymentId);
  appendDemoQueryParam(params, "returnTo", data.returnTo);
  appendDemoQueryParam(params, "draft", data.draftId);
  appendDemoQueryParam(params, "share", data.shareToken);
  appendDemoQueryParam(params, "fullPackageId", data.fullPackageId);

  if (IS_NATIVE_PLATFORM && !/^https?:\/\//i.test(callbackPath)) {
    const routePath = callbackPath.startsWith("/") ? callbackPath : `/${callbackPath}`;
    const query = params.toString();
    return `${trimTrailingSlash(baseUrl)}/#${routePath}${query ? `?${query}` : ""}`;
  }

  try {
    const url = /^https?:\/\//i.test(callbackPath)
      ? new URL(callbackPath)
      : new URL(`${trimTrailingSlash(baseUrl)}${callbackPath.startsWith("/") ? "" : "/"}${callbackPath}`);
    params.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
  } catch {
    return "";
  }
}

function buildDemoInlinePaymentReceipt({
  reference,
  amount,
  currency,
  requestId,
  paymentId,
  demoResult,
} = {}) {
  const method = lower(demoResult?.method, 80);
  const provider = lower(demoResult?.provider, 80);
  const phone = cleanStr(demoResult?.phone, 40);
  const receiptMethod = cleanStr(
    [method, provider].filter(Boolean).join("_") || "demo",
    80
  );

  return {
    status: "paid",
    method: receiptMethod,
    amount: cleanAmount(amount),
    currency: cleanCurrency(currency),
    paidAtMs: Date.now(),
    transactionReference: cleanStr(reference, 120),
    requestId: cleanStr(requestId, 180),
    paymentId: cleanStr(paymentId, 180),
    provider: cleanStr(provider, 80),
    phone,
  };
}

function openDemoProviderCheckoutModal(options = {}) {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Demo checkout is unavailable right now."));
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.setTimeout(() => {
        root.unmount();
        host.remove();
      }, 20);
    };

    const handleResolve = (payload) => {
      cleanup();
      resolve(payload);
    };

    const handleReject = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("Demo checkout cancelled."));
    };

    root.render(
      createElement(DemoProviderCheckoutModal, {
        email: options?.email,
        amount: options?.amount,
        currency: options?.currency,
        reference: options?.reference,
        metadata: options?.metadata,
        onResolve: handleResolve,
        onReject: handleReject,
      })
    );
  });
}

async function initializeDemoHostedCheckout({
  email,
  amount,
  reference,
  currency,
  metadata,
} = {}) {
  const result = await openDemoProviderCheckoutModal({
    email,
    amount,
    currency,
    reference,
    metadata,
  });
  const demoReference = cleanStr(result?.reference, 120) || `DEMO-${Date.now()}`;
  const authorizationUrl = buildDemoCallbackUrl({
    reference: demoReference,
    metadata,
  });

  paymentDebugLog("demo_checkout_success", {
    status: cleanStr(result?.status, 80) || "success",
    reference: demoReference,
    authorizationUrl,
  });

  if (!authorizationUrl) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  return {
    payload: {
      ok: true,
      success: true,
      demo: true,
      provider: DEMO_PROVIDER_KEY,
      status: "success",
      reference: demoReference,
      data: {
        authorization_url: authorizationUrl,
        reference: demoReference,
      },
    },
    authorizationUrl,
    reference: demoReference,
    demoResult: result && typeof result === "object" ? result : null,
  };
}

async function readBackendPayload(response) {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text ? { message: cleanStr(text, 400) } : null;
    } catch {
      return null;
    }
  }
}

function normalizeBackendPayload(payload) {
  if (payload == null) return null;
  if (typeof payload === "string") {
    const text = cleanStr(payload, 4000);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { message: cleanStr(text, 400) };
    }
  }
  return payload;
}

function extractBackendMessage(payload, fallback) {
  return (
    cleanStr(
      payload?.message ||
        payload?.error ||
        payload?.data?.message ||
        payload?.data?.error ||
        payload?.details?.message,
      400
    ) || fallback
  );
}

function shouldUseNativeAndroidHttp(url) {
  const target = cleanStr(url, 2000);
  if (!IS_NATIVE_ANDROID || !target) return false;
  return /^http:\/\//i.test(target);
}

function finalizeBackendResponse({
  path,
  method,
  transport,
  status,
  payload,
  fallbackMessage,
} = {}) {
  const ok = Number(status) >= 200 && Number(status) < 300;
  paymentDebugLog("backend_response", {
    path,
    method,
    transport,
    ok,
    status: Number.isFinite(Number(status)) ? Number(status) : null,
    payload,
  });

  if (!ok) {
    const nextError = new Error(extractBackendMessage(payload, fallbackMessage));
    nextError.details = payload;
    nextError.status = Number.isFinite(Number(status)) ? Number(status) : null;
    throw nextError;
  }

  return payload;
}

async function callLocalPaymentBackend(path, { method = "GET", body } = {}, fallbackMessage) {
  const url = `${LOCAL_PAYMENT_BACKEND_BASE_URL}${path}`;
  const transport = shouldUseNativeAndroidHttp(url) ? "capacitor_http" : "fetch";
  paymentDebugLog("backend_request", {
    baseUrl: LOCAL_PAYMENT_BACKEND_BASE_URL,
    url,
    path,
    method,
    transport,
    body: body || null,
  });

  if (transport === "capacitor_http") {
    let response = null;
    try {
      response = await CapacitorHttp.request({
        url,
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        data: body,
        responseType: "json",
      });
    } catch (error) {
      const details = normalizeBackendPayload(
        error?.response?.data || error?.data || error?.result || null
      );
      paymentDebugLog("backend_native_http_error", {
        path,
        method,
        url,
        message: error?.message || String(error),
        status: Number(error?.response?.status || error?.status || 0) || null,
        details,
      });
      console.error(`Local payment backend native HTTP request failed: ${path}`, error);
      const nextError = new Error(extractBackendMessage(details, fallbackMessage));
      nextError.cause = error;
      nextError.details = details;
      nextError.status = Number(error?.response?.status || error?.status || 0) || null;
      throw nextError;
    }

    const payload = normalizeBackendPayload(response?.data);
    return finalizeBackendResponse({
      path,
      method,
      transport,
      status: response?.status,
      payload,
      fallbackMessage,
    });
  }

  let response = null;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error(`Local payment backend request failed: ${path}`, error);
    const nextError = new Error(fallbackMessage);
    nextError.cause = error;
    throw nextError;
  }

  const payload = normalizeBackendPayload(await readBackendPayload(response));
  return finalizeBackendResponse({
    path,
    method,
    status: response.status,
    payload,
    transport,
    fallbackMessage,
  });
}

async function callLocalPaymentBackendWithFallback(
  paths,
  { method = "GET", body } = {},
  fallbackMessage
) {
  const candidates = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!candidates.length) {
    throw new Error(fallbackMessage);
  }

  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const path = candidates[index];
    try {
      return await callLocalPaymentBackend(path, { method, body }, fallbackMessage);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.cause?.status || 0) || 0;
      const isNotFound = status === 404;
      const hasFallback = index < candidates.length - 1;
      if (isNotFound && hasFallback) {
        paymentDebugLog("backend_path_fallback", {
          failedPath: path,
          nextPath: candidates[index + 1],
          status,
        });
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error(fallbackMessage);
}

function extractAuthorizationUrl(payload) {
  return cleanStr(
    payload?.data?.authorization_url ||
      payload?.data?.authorizationUrl ||
      payload?.authorization_url ||
      payload?.authorizationUrl ||
      payload?.redirectUrl ||
      payload?.data?.redirectUrl,
    1000
  );
}

function isVerifiedPaymentStatus(status) {
  return VERIFIED_PAYMENT_STATUSES.has(lower(status, 80));
}

function normalizeVerificationResponse(payload, fallbackReference = "") {
  const root = payload && typeof payload === "object" ? payload : {};
  const nested = root?.data && typeof root.data === "object" ? root.data : null;
  const merged = { ...root, ...(nested || {}) };
  const status = lower(
    merged?.status || merged?.paymentStatus || merged?.transactionStatus || "",
    80
  );
  return {
    ...merged,
    raw: root,
    ok:
      root?.ok === true ||
      root?.success === true ||
      nested?.ok === true ||
      nested?.success === true ||
      isVerifiedPaymentStatus(status),
    status,
    message: extractBackendMessage(root, ""),
    reference: cleanStr(merged?.reference || fallbackReference, 120),
  };
}

async function initializeHostedCheckout({
  email,
  amount,
  reference,
  currency,
  metadata,
} = {}) {
  const payerEmail = resolveCheckoutEmail(email);
  const payableAmount = cleanAmount(amount);
  const txReference = cleanStr(reference, 120) || buildDummyTransactionReference();
  const payCurrency = cleanCurrency(currency);
  if (!payerEmail || payableAmount <= 0 || !txReference) {
    paymentDebugLog("initialize_checkout_invalid_payload", {
      payerEmail,
      payableAmount,
      txReference,
      payCurrency,
    });
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  let payload = null;
  const safeMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const backendMetadata = {
    ...safeMetadata,
    callbackPath:
      cleanStr(
        safeMetadata.frontendCallbackPath ||
          safeMetadata.callbackPath ||
          resolveFrontendPaymentCallbackPath(),
        240
      ) || resolveFrontendPaymentCallbackPath(),
  };
  const initBody = {
    email: payerEmail,
    amount: payableAmount,
    currency: payCurrency,
    reference: txReference,
    provider: ACTIVE_PAYMENT_PROVIDER,
    metadata: backendMetadata,
  };
  paymentDebugLog("initialize_checkout_payload", initBody);
  if (isDemoPaymentMode()) {
    return initializeDemoHostedCheckout(initBody);
  }
  try {
    payload = await callLocalPaymentBackendWithFallback(
      ["/payments/initialize", "/paystack/initialize"],
      {
        method: "POST",
        body: initBody,
      },
      PAYMENT_CHECKOUT_START_ERROR
    );
  } catch (error) {
    paymentDebugLog("initialize_checkout_error", {
      message: error?.message || String(error),
      details: error?.details || null,
      causeMessage: error?.cause?.message || null,
      causeDetails: error?.cause?.details || null,
      stack: error?.stack || null,
    });
    if (PAYMENT_DEBUG) {
      throw error;
    }
    const nextError = new Error(
      extractBackendMessage(error?.details || error?.cause?.details || null, PAYMENT_CHECKOUT_START_ERROR)
    );
    nextError.details = error?.details || error?.cause?.details || null;
    nextError.cause = error;
    throw nextError;
  }

  paymentDebugLog("initialize_checkout_success", payload);
  const authorizationUrl = extractAuthorizationUrl(payload);
  if (!authorizationUrl) {
    paymentDebugLog("initialize_checkout_missing_authorization_url", payload);
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  return {
    payload,
    authorizationUrl,
    reference: cleanStr(
      payload?.data?.reference || payload?.reference || txReference,
      120
    ),
  };
}

async function activatePreparedUnlockRequestDemo({
  requestId,
  unlockPaymentReceipt,
} = {}) {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) {
    throw new Error("Request details are not ready yet.");
  }

  const requestRef = doc(db, "serviceRequests", safeRequestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) {
    throw new Error("This request could not be found.");
  }

  const requestData = requestSnap.data() || {};
  const currentStatus = lower(requestData?.status, 80);
  if (lower(requestData?.paymentFlowType, 80) === "full_package_unlock") {
    throw new Error("Full package unlocks are completed from the full package flow.");
  }

  const unlockPaymentId =
    cleanStr(requestData?.unlockPaymentId, 180) ||
    cleanStr(unlockPaymentReceipt?.paymentId, 180) ||
    "unlock_request_payment";
  const currentUnlockState = lower(requestData?.unlockState, 80);

  if (currentStatus !== "payment_pending") {
    if (
      new Set(["new", "contacted", "closed", "rejected"]).has(currentStatus) &&
      (requestData?.paid === true ||
        currentUnlockState === "paid_held" ||
        currentUnlockState === "consumed")
    ) {
      return {
        ok: true,
        requestId: safeRequestId,
        paymentId: unlockPaymentId,
        status: currentStatus,
        alreadyActivated: true,
        demo: true,
      };
    }
    throw new Error("This request is not waiting for unlock activation.");
  }

  const transactionReference = cleanStr(
    unlockPaymentReceipt?.transactionReference || unlockPaymentReceipt?.reference,
    180
  );
  if (!transactionReference) {
    throw new Error("Unlock payment is not verified yet.");
  }

  const paidAtMs =
    Number(unlockPaymentReceipt?.paidAtMs || unlockPaymentReceipt?.paidAt || 0) || Date.now();
  const paymentMethod =
    lower(unlockPaymentReceipt?.method, 80) || DEMO_PROVIDER_KEY;

  await syncDemoUnlockPaymentRecord({
    requestId: safeRequestId,
    paymentId: unlockPaymentId,
    requestData,
    amount: unlockPaymentReceipt?.amount,
    currency: unlockPaymentReceipt?.currency || requestData?.pricingSnapshot?.currency,
    status: PAYMENT_STATUSES.PAID,
    reference: transactionReference,
    method: paymentMethod,
    paidAtMs,
  });

  await setDoc(
    requestRef,
    {
      paid: false,
      status: "new",
      routingStatus: "awaiting_route",
      paymentMeta: {
        status: "paid_held",
        method: paymentMethod,
        paidAt: paidAtMs,
        ref: transactionReference,
        requestId: safeRequestId,
        paymentId: unlockPaymentId,
      },
      unlockPaymentId,
      unlockPaymentRequestId: safeRequestId,
      unlockState: "paid_held",
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    },
    { merge: true }
  );

  return {
    ok: true,
    requestId: safeRequestId,
    paymentId: unlockPaymentId,
    status: "new",
    demo: true,
  };
}

async function syncDemoUnlockPaymentRecord({
  requestId,
  paymentId,
  requestData,
  amount,
  currency,
  status = PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
  reference = "",
  method = "",
  paidAtMs = 0,
} = {}) {
  const safeRequestId = cleanStr(requestId, 180);
  const safePaymentId = cleanStr(paymentId, 180) || "unlock_request_payment";
  if (!safeRequestId) {
    throw new Error("Request details are not ready yet.");
  }

  const normalizedRequest = requestData && typeof requestData === "object" ? requestData : {};
  const normalizedStatus = lower(status, 80) || PAYMENT_STATUSES.PAYMENT_SESSION_CREATED;
  const nowMs = Date.now();
  const paymentRef = doc(db, "serviceRequests", safeRequestId, "payments", safePaymentId);
  const basePayload = {
    requestId: safeRequestId,
    requestUid:
      cleanStr(normalizedRequest?.uid, 160) || cleanStr(auth.currentUser?.uid, 160),
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    paymentLabel:
      cleanStr(
        normalizedRequest?.pricingSnapshot?.label ||
          normalizedRequest?.serviceName ||
          "Unlock payment",
        180
      ) || "Unlock payment",
    amount: cleanAmount(amount || normalizedRequest?.pricingSnapshot?.amount || 0),
    currency: cleanCurrency(currency || normalizedRequest?.pricingSnapshot?.currency || "KES"),
    updatedAt: serverTimestamp(),
    updatedAtMs: nowMs,
  };

  if (normalizedStatus === PAYMENT_STATUSES.PAID) {
    const existingSnap = await getDoc(paymentRef);
    if (!existingSnap.exists()) {
      await setDoc(
        paymentRef,
        {
          ...basePayload,
          status: PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
          createdAt: serverTimestamp(),
          createdAtMs: nowMs,
        },
        { merge: true }
      );
    }

    await setDoc(
      paymentRef,
      {
        ...basePayload,
        status: PAYMENT_STATUSES.PAID,
        transactionReference: cleanStr(reference, 160),
        providerReference: cleanStr(reference, 160),
        paymentMethod: cleanStr(method, 80) || DEMO_PROVIDER_KEY,
        paidAt: paidAtMs || nowMs,
        paidAtMs: paidAtMs || nowMs,
        latestReference: cleanStr(reference, 160),
      },
      { merge: true }
    );
    return safePaymentId;
  }

  await setDoc(
    paymentRef,
    {
      ...basePayload,
      status:
        normalizedStatus === PAYMENT_STATUSES.AWAITING_PAYMENT
          ? PAYMENT_STATUSES.AWAITING_PAYMENT
          : PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
      createdAt: serverTimestamp(),
      createdAtMs: nowMs,
    },
    { merge: true }
  );
  return safePaymentId;
}

async function loadRequestCheckoutContext(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) throw new Error(PAYMENT_CHECKOUT_START_ERROR);

  const requestSnap = await getDoc(doc(db, "serviceRequests", safeRequestId));
  if (!requestSnap.exists()) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const requestData = requestSnap.data() || {};
  const amount = cleanAmount(
    requestData?.pricingSnapshot?.amount || requestData?.paymentExpectedAmount || 0
  );
  const currency = cleanCurrency(
    requestData?.pricingSnapshot?.currency || requestData?.paymentExpectedCurrency || "KES"
  );
  const email = resolveCheckoutEmail(requestData?.email, auth.currentUser?.email);
  const paymentId = cleanStr(requestData?.unlockPaymentId, 180) || "unlock_request_payment";

  if (!email || amount <= 0) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  return {
    requestId: safeRequestId,
    requestData,
    amount,
    currency,
    email,
    paymentId,
  };
}

async function loadExistingPaymentCheckoutContext({
  requestId,
  paymentId,
} = {}) {
  const safeRequestId = cleanStr(requestId, 180);
  const safePaymentId = cleanStr(paymentId, 180);
  if (!safeRequestId || !safePaymentId) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const [requestSnap, paymentSnap] = await Promise.all([
    getDoc(doc(db, "serviceRequests", safeRequestId)),
    getDoc(doc(db, "serviceRequests", safeRequestId, "payments", safePaymentId)),
  ]);

  if (!requestSnap.exists() || !paymentSnap.exists()) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const requestData = requestSnap.data() || {};
  const paymentData = normalizePaymentDoc({
    id: paymentSnap.id,
    ...(paymentSnap.data() || {}),
  });
  ensureCheckoutPayable(paymentData, { source: "payment" });
  const email = resolveCheckoutEmail(requestData?.email, auth.currentUser?.email);
  if (!email || paymentData.amount <= 0) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  return {
    requestId: safeRequestId,
    paymentId: safePaymentId,
    requestData,
    paymentData,
    payerMode: "direct_user",
    email,
    amount: paymentData.amount,
    currency: cleanCurrency(paymentData.currency),
  };
}

async function loadSharedPaymentCheckoutContext({
  shareToken,
  email,
} = {}) {
  const safeShareToken = cleanStr(shareToken, 400);
  if (!safeShareToken) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const result = await resolveSharedPaymentLink({ shareToken: safeShareToken });
  if (result?.valid !== true || !result?.payment) {
    throw new Error("This payment link is no longer valid.");
  }

  const paymentData = normalizePaymentDoc({
    id: cleanStr(result?.paymentId || result?.payment?.id, 180),
    ...(result?.payment || {}),
  });
  ensureCheckoutPayable(paymentData, { source: "payment link" });
  const payerEmail = resolveCheckoutEmail(email);
  if (!payerEmail || paymentData.amount <= 0) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  return {
    requestId: cleanStr(result?.requestId, 180),
    paymentId: cleanStr(result?.paymentId || result?.payment?.id, 180),
    paymentData,
    payerMode: "shared_full_link",
    email: payerEmail,
    amount: paymentData.amount,
    currency: cleanCurrency(paymentData.currency),
    shareToken: safeShareToken,
  };
}

async function loadFullPackageCheckoutContext({
  fullPackageId,
  selectedItems,
} = {}) {
  const safeFullPackageId = cleanStr(fullPackageId, 180);
  if (!safeFullPackageId) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const fullPackageSnap = await getDoc(doc(db, "fullPackages", safeFullPackageId));
  if (!fullPackageSnap.exists()) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const fullPackage = fullPackageSnap.data() || {};
  const coverage = resolveFullPackageCoverageState(fullPackage, selectedItems);
  const amount = cleanAmount(fullPackage?.unlockAmount || fullPackage?.depositAmount || 0);
  const email = resolveCheckoutEmail(fullPackage?.email, auth.currentUser?.email);

  return {
    fullPackageId: safeFullPackageId,
    fullPackage,
    amount,
    email,
    currency: "KES",
    selectedItems: coverage.selectedItems,
    coveredItems: coverage.coveredItems,
    payableItems: coverage.outstandingItems,
    alreadyCovered:
      fullPackage?.unlockPaid === true || coverage.isCovered || coverage.outstandingItems.length === 0,
  };
}

function extractFinanceErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const code = cleanStr(error?.code, 120).toLowerCase();
  const message = cleanStr(error?.message, 400);
  const detailMessage = cleanStr(
    error?.details?.message || error?.details?.error || error?.details,
    400
  );

  if (detailMessage && detailMessage.toLowerCase() !== "internal") return detailMessage;
  if (message && message.toLowerCase() !== "internal") return message;

  if (code.includes("internal")) {
    return fallback;
  }
  if (code.includes("failed-precondition")) {
    return message || detailMessage || fallback;
  }

  return message || detailMessage || fallback;
}

function shouldUsePaymentApiFallback(error) {
  const code = cleanStr(error?.code, 120).toLowerCase();
  const message = cleanStr(error?.message, 500).toLowerCase();
  const status = Number(error?.status || 0) || 0;
  return (
    Boolean(error?.isInfrastructureUnavailable) ||
    code.startsWith("api/") ||
    status === 0 ||
    status === 404 ||
    status === 429 ||
    status === 500 ||
    status === 501 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("backend is not available")
  );
}

async function callFinance(name, payload = {}) {
  const action = cleanStr(name, 120);
  const safePayload = payload && typeof payload === "object" ? payload : {};
  try {
    if (
      action === "createUnlockCheckoutSession" ||
      action === "createFullPackageUnlockCheckoutSession" ||
      action === "createPaymentCheckoutSession"
    ) {
      return await initiatePayment({
        action,
        provider: ACTIVE_PAYMENT_PROVIDER,
        ...safePayload,
        callbackPath:
          cleanStr(safePayload?.callbackPath, 240) || resolvePaymentCallbackApiPath(),
        frontendCallbackPath:
          cleanStr(safePayload?.frontendCallbackPath, 240) ||
          resolveFrontendPaymentCallbackPath(),
      });
    }

    if (action === "reconcilePaymentReference") {
      return await verifyPayment({
        action,
        provider: ACTIVE_PAYMENT_PROVIDER,
        ...safePayload,
      });
    }

    return await invokeFinanceAction(action, safePayload);
  } catch (error) {
    console.error(`Finance API request failed: ${action}`, error);
    const nextError = new Error(
      extractFinanceErrorMessage(error, "Payment checkout could not start right now. Please try again.")
    );
    nextError.code = cleanStr(error?.code, 120) || "api/request-failed";
    nextError.status = Number(error?.status || 0) || null;
    nextError.details = error?.details ?? null;
    nextError.isInfrastructureUnavailable = Boolean(error?.isInfrastructureUnavailable);
    nextError.cause = error;
    throw nextError;
  }
}

export function buildDummyTransactionReference(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MJ-PAY-${yyyy}${mm}${dd}-${rand}`;
}

export function buildIdempotencyKey(prefix = "MJ") {
  const now = Date.now().toString(36).toUpperCase();
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .toUpperCase()
    .padStart(5, "0");
  return `${cleanStr(prefix, 12).toUpperCase()}-${now}-${rand}`;
}

export function normalizePaymentDoc(row) {
  const data = row && typeof row === "object" ? row : {};
  return {
    ...data,
    id: cleanStr(data.id, 180),
    requestId: cleanStr(data.requestId, 180),
    requestUid: cleanStr(data.requestUid, 160),
    paymentType: lower(data.paymentType, 80),
    paymentLabel: cleanStr(data.paymentLabel, 180) || "Payment",
    amount: cleanAmount(data.amount),
    currency: cleanCurrency(data.currency),
    status: lower(data.status, 80),
    note: cleanStr(data.note, 2000),
    rejectionReason: cleanStr(
      data.rejectionReason || data?.revocationMeta?.reason || "",
      2000
    ),
    transactionReference: cleanStr(
      data.transactionReference || data.providerReference || data.reference || "",
      160
    ),
    createdByStaffUid: cleanStr(data.createdByStaffUid, 160),
    approvedByAdminUid: cleanStr(
      data?.approvalMeta?.approvedByUid || data.approvedByAdminUid || "",
      160
    ),
    createdAtMs: Number(data.createdAtMs || 0) || toMillis(data.createdAt),
    approvedAtMs: Number(data.approvedAtMs || 0) || toMillis(data.approvedAt),
    paidAtMs: Number(data.paidAtMs || 0) || toMillis(data.paidAt),
    refundedAtMs: Number(data.refundedAtMs || 0) || toMillis(data.refundedAt),
    unlockAutoRefundEligibleAtMs: Number(data.unlockAutoRefundEligibleAtMs || 0),
    breakdown: data?.breakdown && typeof data.breakdown === "object" ? data.breakdown : null,
    financialSnapshot:
      data?.financialSnapshot && typeof data.financialSnapshot === "object"
        ? data.financialSnapshot
        : null,
    latestAttempt:
      data?.latestAttempt && typeof data.latestAttempt === "object" ? data.latestAttempt : null,
    payoutState:
      data?.payoutState && typeof data.payoutState === "object" ? data.payoutState : null,
    refundState:
      data?.refundState && typeof data.refundState === "object" ? data.refundState : null,
    shareLink:
      data?.shareLink && typeof data.shareLink === "object" ? data.shareLink : null,
  };
}

export function normalizeRefundDoc(row) {
  const data = row && typeof row === "object" ? row : {};
  return {
    ...data,
    id: cleanStr(data.id, 180),
    refundId: cleanStr(data.refundId || data.id, 180),
    requestId: cleanStr(data.requestId, 180),
    paymentId: cleanStr(data.paymentId, 180),
    paymentType: lower(data.paymentType, 80),
    paymentLabel: cleanStr(data.paymentLabel, 180),
    amount: cleanAmount(data.amount),
    currency: cleanCurrency(data.currency),
    status: lower(data.status, 80),
    userReason: cleanStr(data.userReason, 2000),
    adminExplanation: cleanStr(data.adminExplanation, 2000),
    expectedRefundPeriodText: cleanStr(data.expectedRefundPeriodText, 300),
    rejectionReason: cleanStr(data.rejectionReason, 2000),
    createdAtMs: Number(data.createdAtMs || 0) || toMillis(data.createdAt),
    decisionAtMs: Number(data.decisionAtMs || 0) || toMillis(data.decisionAt),
  };
}

export function paymentStatusUi(status) {
  const s = lower(status, 80);
  const map = {
    admin_review: ["Awaiting admin review", "border border-amber-200 bg-amber-50 text-amber-900"],
    payable: ["Payable", "border border-emerald-200 bg-emerald-50 text-emerald-900"],
    payment_session_created: ["Checkout created", "border border-blue-200 bg-blue-50 text-blue-900"],
    awaiting_payment: ["Awaiting payment", "border border-blue-200 bg-blue-50 text-blue-900"],
    paid: ["Paid", "border border-emerald-200 bg-emerald-50 text-emerald-900"],
    held: ["Held by MAJUU", "border border-sky-200 bg-sky-50 text-sky-900"],
    payout_ready: ["Payout ready", "border border-indigo-200 bg-indigo-50 text-indigo-900"],
    settled: ["Settled", "border border-zinc-200 bg-zinc-100 text-zinc-800"],
    refund_requested: ["Refund requested", "border border-amber-200 bg-amber-50 text-amber-900"],
    refund_under_review: ["Refund under review", "border border-blue-200 bg-blue-50 text-blue-900"],
    refunded: ["Refunded", "border border-zinc-200 bg-zinc-100 text-zinc-800"],
    auto_refunded: ["Auto refunded", "border border-purple-200 bg-purple-50 text-purple-900"],
    revoked: ["Revoked", "border border-rose-200 bg-rose-50 text-rose-800"],
    failed: ["Failed", "border border-rose-200 bg-rose-50 text-rose-800"],
    expired: ["Expired", "border border-zinc-200 bg-zinc-100 text-zinc-700"],
    rejected: ["Rejected", "border border-rose-200 bg-rose-50 text-rose-800"],
  };
  const [label, cls] = map[s] || [s || "Unknown", "border border-zinc-200 bg-zinc-100 text-zinc-700"];
  return { label, cls };
}

export function refundStatusUi(status) {
  const s = lower(status, 80);
  const map = {
    requested: ["Requested", "border border-amber-200 bg-amber-50 text-amber-900"],
    under_review: ["Under review", "border border-blue-200 bg-blue-50 text-blue-900"],
    approved: ["Approved", "border border-blue-200 bg-blue-50 text-blue-900"],
    rejected: ["Rejected", "border border-rose-200 bg-rose-50 text-rose-800"],
    refunded: ["Refunded", "border border-zinc-200 bg-zinc-100 text-zinc-800"],
    auto_refunded: ["Auto refunded", "border border-purple-200 bg-purple-50 text-purple-900"],
    failed: ["Failed", "border border-rose-200 bg-rose-50 text-rose-800"],
  };
  const [label, cls] = map[s] || [s || "Unknown", "border border-zinc-200 bg-zinc-100 text-zinc-700"];
  return { label, cls };
}

export function isUnlockPaymentAutoRefundEligible({
  payment,
  requestData,
  nowMs = Date.now(),
}) {
  const p = normalizePaymentDoc(payment);
  if (p.paymentType !== PAYMENT_TYPES.UNLOCK_REQUEST) return false;
  if (p.status !== PAYMENT_STATUSES.PAID) return false;
  const paidAtMs = Number(p.paidAtMs || 0);
  if (paidAtMs <= 0) return false;
  if (getRequestStartedAtMs(requestData) > 0) return false;
  const eligibleAtMs =
    Number(p.unlockAutoRefundEligibleAtMs || 0) || paidAtMs + UNLOCK_AUTO_REFUND_WINDOW_MS;
  return nowMs >= eligibleAtMs;
}

export async function createUnlockCheckoutSession(payload = {}) {
  if (!isDemoPaymentMode()) {
    try {
      const result = await callFinance("createUnlockCheckoutSession", {
        ...payload,
        appBaseUrl: resolveFrontendAppBaseUrl(payload?.appBaseUrl),
        idempotencyKey:
          cleanStr(payload?.idempotencyKey, 180) || buildIdempotencyKey("UNLOCK"),
        phoneNumber: cleanStr(payload?.phoneNumber || payload?.phone, 40),
      });
      const authorizationUrl = cleanStr(
        result?.authorizationUrl || result?.redirectUrl,
        1000
      );
      return {
        ...(result || {}),
        authorizationUrl,
        redirectUrl: authorizationUrl,
      };
    } catch (error) {
      if (!shouldUsePaymentApiFallback(error)) {
        throw error;
      }
      paymentDebugLog("unlock_checkout_api_fallback", {
        message: error?.message || String(error),
        status: Number(error?.status || 0) || null,
      });
    }
  }

  const context = await loadRequestCheckoutContext(payload?.requestId);
  const metadata = buildHostedPaymentMetadata({
    flowType: cleanStr(context.requestData?.paymentFlowType || "unlock_request", 80),
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    requestId: context.requestId,
    paymentId: context.paymentId,
    draftId: cleanStr(payload?.draftId, 160),
    returnTo: cleanStr(payload?.returnTo, 600),
    appBaseUrl: resolveFrontendAppBaseUrl(payload?.appBaseUrl),
    track: cleanStr(context.requestData?.track, 24),
    country: cleanStr(context.requestData?.country, 120),
    requestType: cleanStr(context.requestData?.requestType, 80),
    serviceName: cleanStr(context.requestData?.serviceName, 120),
    currency: context.currency,
    metadata: payload?.metadata,
  });
  const session = await initializeHostedCheckout({
    email: context.email,
    amount: context.amount,
    currency: context.currency,
    reference: cleanStr(payload?.reference, 120) || buildDummyTransactionReference(),
    metadata,
  });
  const inlinePaymentReceipt = session.demoResult
    ? buildDemoInlinePaymentReceipt({
        reference: session.reference,
        amount: context.amount,
        currency: context.currency,
        requestId: context.requestId,
        paymentId: context.paymentId,
        demoResult: session.demoResult,
      })
    : null;

  if (session.demoResult) {
    try {
      await syncDemoUnlockPaymentRecord({
        requestId: context.requestId,
        paymentId: context.paymentId,
        requestData: context.requestData,
        amount: context.amount,
        currency: context.currency,
        status: PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
      });
      await syncDemoUnlockPaymentRecord({
        requestId: context.requestId,
        paymentId: context.paymentId,
        requestData: context.requestData,
        amount: context.amount,
        currency: context.currency,
        status: PAYMENT_STATUSES.PAID,
        reference: session.reference,
        method: inlinePaymentReceipt?.method || DEMO_PROVIDER_KEY,
        paidAtMs: inlinePaymentReceipt?.paidAtMs || Date.now(),
      });
    } catch (error) {
      console.error("Failed to sync demo unlock payment record:", error);
      throw new Error("Payment could not be prepared right now. Please try again.");
    }
  }

  return {
    ok: true,
    requestId: context.requestId,
    paymentId: context.paymentId,
    amount: context.amount,
    currency: context.currency,
    reference: session.reference,
    inlinePaymentReceipt,
    authorizationUrl: session.authorizationUrl,
    redirectUrl: session.authorizationUrl,
  };
}

export async function createFullPackageUnlockCheckoutSession(payload = {}) {
  if (!isDemoPaymentMode()) {
    try {
      return await callFinance("createFullPackageUnlockCheckoutSession", {
        ...payload,
        appBaseUrl: resolveFrontendAppBaseUrl(payload?.appBaseUrl),
        idempotencyKey:
          cleanStr(payload?.idempotencyKey, 180) || buildIdempotencyKey("FULLPKG"),
        phoneNumber: cleanStr(payload?.phoneNumber || payload?.phone, 40),
      });
    } catch (error) {
      if (!shouldUsePaymentApiFallback(error)) {
        throw error;
      }
      paymentDebugLog("full_package_checkout_api_fallback", {
        message: error?.message || String(error),
        status: Number(error?.status || 0) || null,
      });
    }
  }

  const context = await loadFullPackageCheckoutContext({
    fullPackageId: payload?.fullPackageId,
    selectedItems: payload?.selectedItems,
  });

  if (context.alreadyCovered || context.amount <= 0) {
    return {
      ok: true,
      alreadyCovered: true,
      flowType: "full_package_unlock",
      fullPackageId: context.fullPackageId,
      coveredItems: context.coveredItems,
      payableItems: [],
      selectedItems: context.selectedItems,
      amount: 0,
      currency: context.currency,
    };
  }

  if (!context.email) {
    throw new Error(PAYMENT_CHECKOUT_START_ERROR);
  }

  const metadata = buildHostedPaymentMetadata({
    flowType: "full_package_unlock",
    paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
    draftId: cleanStr(payload?.draftId, 160),
    returnTo: cleanStr(payload?.returnTo, 600),
    appBaseUrl: resolveFrontendAppBaseUrl(payload?.appBaseUrl),
    fullPackageId: context.fullPackageId,
    track: cleanStr(payload?.track || context.fullPackage?.track, 24),
    country: cleanStr(payload?.country || context.fullPackage?.country, 120),
    selectedItems: context.selectedItems,
    currency: context.currency,
    metadata: payload?.metadata,
  });
  const session = await initializeHostedCheckout({
    email: context.email,
    amount: context.amount,
    currency: context.currency,
    reference: cleanStr(payload?.reference, 120) || buildDummyTransactionReference(),
    metadata,
  });
  const inlinePaymentReceipt = session.demoResult
    ? buildDemoInlinePaymentReceipt({
        reference: session.reference,
        amount: context.amount,
        currency: context.currency,
        requestId: "",
        paymentId: "",
        demoResult: session.demoResult,
      })
    : null;

  return {
    ok: true,
    flowType: "full_package_unlock",
    fullPackageId: context.fullPackageId,
    requestId: "",
    paymentId: "",
    amount: context.amount,
    currency: context.currency,
    coveredItems: context.coveredItems,
    payableItems: context.payableItems,
    selectedItems: context.selectedItems,
    reference: session.reference,
    inlinePaymentReceipt,
    demoResult: session.demoResult || null,
    authorizationUrl: session.authorizationUrl,
    redirectUrl: session.authorizationUrl,
  };
}

export async function activatePreparedUnlockRequest(payload = {}) {
  const paymentReceipt =
    payload?.unlockPaymentReceipt && typeof payload.unlockPaymentReceipt === "object"
      ? payload.unlockPaymentReceipt
      : null;
  const receiptReference = cleanStr(
    paymentReceipt?.transactionReference || paymentReceipt?.reference,
    180
  );

  if (isDemoPaymentMode() || isDemoPaymentReference(receiptReference)) {
    return activatePreparedUnlockRequestDemo({
      requestId: payload?.requestId,
      unlockPaymentReceipt: paymentReceipt,
    });
  }

  return callFinance("activatePreparedUnlockRequest", payload);
}

export async function createInProgressPaymentProposal(payload = {}) {
  return callFinance("createInProgressPaymentProposal", payload);
}

export async function adminApproveInProgressPayment(payload = {}) {
  return callFinance("adminApprovePaymentRequest", payload);
}

export async function adminRejectInProgressPayment({
  requestId,
  paymentId,
  rejectionReason,
} = {}) {
  return callFinance("adminRevokePaymentRequest", {
    requestId,
    paymentId,
    reason: rejectionReason,
  });
}

export async function createPaymentCheckoutSession(payload = {}) {
  if (!isDemoPaymentMode()) {
    try {
      const result = await callFinance("createPaymentCheckoutSession", {
        ...payload,
        appBaseUrl: resolveFrontendAppBaseUrl(payload?.appBaseUrl),
        idempotencyKey:
          cleanStr(payload?.idempotencyKey, 180) || buildIdempotencyKey("INPROGRESS"),
        phoneNumber: cleanStr(payload?.phoneNumber || payload?.phone, 40),
      });
      const authorizationUrl = cleanStr(
        result?.authorizationUrl || result?.redirectUrl,
        1000
      );
      return {
        ...(result || {}),
        authorizationUrl,
        redirectUrl: authorizationUrl,
      };
    } catch (error) {
      if (!shouldUsePaymentApiFallback(error)) {
        throw error;
      }
      paymentDebugLog("payment_checkout_api_fallback", {
        message: error?.message || String(error),
        status: Number(error?.status || 0) || null,
      });
    }
  }

  const shareToken = cleanStr(payload?.shareToken, 400);
  const context = shareToken
    ? await loadSharedPaymentCheckoutContext({
        shareToken,
        email: payload?.email,
      })
    : await loadExistingPaymentCheckoutContext({
        requestId: payload?.requestId,
        paymentId: payload?.paymentId,
      });

  const metadata = buildHostedPaymentMetadata({
    flowType: cleanStr(payload?.flowType || "payment_checkout", 80),
    paymentType: cleanStr(context.paymentData?.paymentType, 80) || PAYMENT_TYPES.IN_PROGRESS,
    requestId: context.requestId,
    paymentId: context.paymentId,
    returnTo: cleanStr(payload?.returnTo, 600),
    shareToken,
    appBaseUrl: resolveFrontendAppBaseUrl(payload?.appBaseUrl),
    paymentLabel: cleanStr(context.paymentData?.paymentLabel, 180),
    payerMode: cleanStr(context.payerMode, 80),
    currency: context.currency,
    discountAmount: cleanAmount(context.paymentData?.breakdown?.discountAmount || 0),
    discountAppliedPercentage: Number(
      context.paymentData?.breakdown?.discountAppliedPercentage || 0
    ),
    note: cleanStr(context.paymentData?.note, 600),
    metadata: payload?.metadata,
  });
  const session = await initializeHostedCheckout({
    email: context.email,
    amount: context.amount,
    currency: context.currency,
    reference: cleanStr(payload?.reference, 120) || buildDummyTransactionReference(),
    metadata,
  });

  return {
    ok: true,
    requestId: context.requestId,
    paymentId: context.paymentId,
    payerMode: context.payerMode,
    amount: context.amount,
    currency: context.currency,
    reference: session.reference,
    authorizationUrl: session.authorizationUrl,
    redirectUrl: session.authorizationUrl,
  };
}

export async function getOrCreateSharedPaymentLink(payload = {}) {
  return callFinance("getOrCreateSharedPaymentLink", payload);
}

export async function resolveSharedPaymentLink(payload = {}) {
  return callFinance("resolveSharedPaymentLink", payload);
}

export async function reconcilePaymentReference(payload = {}) {
  const reference = cleanStr(
    typeof payload === "string" ? payload : payload?.reference,
    120
  );
  if (!reference) {
    throw new Error("Payment reference is missing.");
  }

  if (isDemoPaymentMode() || isDemoPaymentReference(reference)) {
    return normalizeVerificationResponse(
      {
        ok: true,
        success: true,
        demo: true,
        provider: DEMO_PROVIDER_KEY,
        status: "success",
        message: "Demo payment verified successfully.",
        data: {
          reference,
          status: "success",
        },
      },
      reference
    );
  }

  try {
    const result = await callFinance("reconcilePaymentReference", { reference });
    return normalizeVerificationResponse(result, reference);
  } catch (apiError) {
    const code = cleanStr(apiError?.code, 120).toLowerCase();
    const message = cleanStr(apiError?.message, 500).toLowerCase();
    const status = Number(apiError?.status || 0) || 0;
    const shouldFallback =
      Boolean(apiError?.isInfrastructureUnavailable) ||
      code.startsWith("api/") ||
      status === 404 ||
      status === 429 ||
      status === 500 ||
      status === 501 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      message.includes("backend is not available");
    if (!shouldFallback) {
      throw apiError;
    }
  }

  const result = await callLocalPaymentBackendWithFallback(
    [
      `/payments/verify/${encodeURIComponent(reference)}?provider=${encodeURIComponent(
        ACTIVE_PAYMENT_PROVIDER
      )}`,
      `/paystack/verify/${encodeURIComponent(reference)}`,
    ],
    { method: "GET" },
    PAYMENT_VERIFY_ERROR
  );
  return normalizeVerificationResponse(result, reference);
}

export async function createRefundRequest({ requestId, paymentId, userReason } = {}) {
  return callFinance("requestPaymentRefund", { requestId, paymentId, userReason });
}

export async function adminApproveRefund({
  requestId,
  refundId,
  adminExplanation,
  expectedRefundPeriodText,
} = {}) {
  return callFinance("adminDecidePaymentRefund", {
    requestId,
    refundId,
    decision: "approve",
    note: adminExplanation,
    expectedRefundPeriodText,
  });
}

export async function adminRejectRefund({ requestId, refundId, rejectionReason } = {}) {
  return callFinance("adminDecidePaymentRefund", {
    requestId,
    refundId,
    decision: "reject",
    note: rejectionReason,
  });
}

export async function getFinanceEnvironmentStatus() {
  return callFinance("getFinanceEnvironmentStatus", {});
}

export async function applyUnlockAutoRefundSweep({ requestIds = [] } = {}) {
  const result = await callFinance("runUnlockAutoRefundSweep", { requestIds });
  return Number(result?.applied || 0);
}

export async function listUnlockAutoRefundEligibleRequests({ requestIds = [] } = {}) {
  const result = await callFinance("listUnlockAutoRefundCandidates", { requestIds });
  return Array.isArray(result?.rows) ? result.rows : [];
}

export async function releasePartnerPayout(payload = {}) {
  return callFinance("releasePartnerPayout", payload);
}

export async function userPayAwaitingPayment() {
  throw new Error("Dummy payment is retired. Use hosted checkout.");
}

export async function ensureUnlockAutoRefundForRequest(requestId) {
  const ids = cleanStr(requestId, 180) ? [cleanStr(requestId, 180)] : [];
  if (!ids.length) return 0;
  return applyUnlockAutoRefundSweep({ requestIds: ids });
}

export async function createUnlockPaymentForRequest({
  requestId,
} = {}) {
  void requestId;
  throw new Error("Legacy direct unlock payment writes are retired. Use backend checkout verification.");
}

export async function userCanOpenSharedLink(shareToken = "") {
  const result = await resolveSharedPaymentLink({ shareToken });
  return result?.valid === true;
}

export async function getUnlockPaymentForRequest(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return null;
  const snap = await getDocs(
    query(
      collection(db, "serviceRequests", safeRequestId, "payments"),
      where("paymentType", "==", PAYMENT_TYPES.UNLOCK_REQUEST),
      limit(10)
    )
  );
  const row = snap.docs
    .map((docSnap) => normalizePaymentDoc({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .find(Boolean);
  return row || null;
}

export async function listRequestRefunds(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return [];
  const snap = await getDocs(collection(db, "serviceRequests", safeRequestId, "refundRequests"));
  return snap.docs.map((docSnap) => normalizeRefundDoc({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

export async function listRequestPayments(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return [];
  const snap = await getDocs(collection(db, "serviceRequests", safeRequestId, "payments"));
  return snap.docs.map((docSnap) => normalizePaymentDoc({ id: docSnap.id, ...(docSnap.data() || {}) }));
}

export async function getRequestOwnerUid(requestId = "") {
  const safeRequestId = cleanStr(requestId, 180);
  if (!safeRequestId) return "";
  const snap = await getDoc(doc(db, "serviceRequests", safeRequestId));
  return snap.exists() ? cleanStr(snap.data()?.uid, 160) : "";
}

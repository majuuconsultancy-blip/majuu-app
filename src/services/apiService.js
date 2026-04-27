import { auth } from "../firebase";

function cleanStr(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function trimTrailingSlash(value) {
  return cleanStr(value, 2000).replace(/\/+$/, "");
}

function resolveApiBaseUrl() {
  const configured = trimTrailingSlash(
    import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_PAYMENT_API_BASE_URL
  );
  if (configured) return configured;

  if (
    typeof window !== "undefined" &&
    /^https?:$/i.test(cleanStr(window.location?.protocol, 20))
  ) {
    return trimTrailingSlash(window.location.origin);
  }

  return "";
}

function buildApiUrl(path = "") {
  const safePath = cleanStr(path, 400);
  const normalizedPath = safePath.startsWith("/") ? safePath : `/${safePath}`;
  const baseUrl = resolveApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function looksLikeHtmlDocument(value = "") {
  const text = cleanStr(value, 4000).toLowerCase();
  if (!text) return false;
  return (
    text.startsWith("<!doctype html") ||
    text.startsWith("<html") ||
    text.includes("<head") ||
    text.includes("<body")
  );
}

function isLikelySpaFallbackResponse(path = "", response, payload) {
  const safePath = cleanStr(path, 400);
  if (!safePath.startsWith("/api")) return false;

  const contentType = cleanStr(response?.headers?.get?.("content-type"), 200).toLowerCase();
  if (contentType.includes("text/html")) return true;

  const message = cleanStr(payload?.message, 4000);
  return looksLikeHtmlDocument(message);
}

async function readApiPayload(response) {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text ? { message: cleanStr(text, 2000) } : null;
    } catch {
      return null;
    }
  }
}

function extractApiMessage(payload, fallback) {
  return (
    cleanStr(
      payload?.message ||
        payload?.error ||
        payload?.details?.message ||
        payload?.details?.error ||
        payload?.data?.message ||
        payload?.data?.error,
      400
    ) || fallback
  );
}

function buildApiError({
  fallbackMessage,
  message = "",
  status = 0,
  details = null,
  cause = null,
} = {}) {
  const httpStatus = Number(status || 0) || 0;
  const error = new Error(cleanStr(message, 400) || fallbackMessage);
  error.status = httpStatus || null;
  error.code = httpStatus ? `api/${httpStatus}` : "api/request-failed";
  error.details = details;
  error.cause = cause;
  error.isInfrastructureUnavailable =
    httpStatus === 0 ||
    httpStatus === 404 ||
    httpStatus === 429 ||
    httpStatus === 500 ||
    httpStatus === 501 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    httpStatus === 504;
  return error;
}

export async function apiRequest(
  path,
  { method = "POST", body, headers = {}, signal } = {},
  fallbackMessage = "Request failed."
) {
  const url = buildApiUrl(path);
  const upperMethod = cleanStr(method, 12).toUpperCase() || "POST";
  const hasJsonBody = body !== undefined;
  let authHeaders = {};

  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      if (cleanStr(token, 4000)) {
        authHeaders = { Authorization: `Bearer ${token}` };
      }
    }
  } catch {
    authHeaders = {};
  }

  let response = null;
  try {
    response = await fetch(url, {
      method: upperMethod,
      headers: {
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...authHeaders,
        ...headers,
      },
      body: hasJsonBody ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    throw buildApiError({
      fallbackMessage,
      message: fallbackMessage,
      cause: error,
    });
  }

  const payload = await readApiPayload(response);
  const isSpaFallback = isLikelySpaFallbackResponse(path, response, payload);
  if (!response.ok) {
    throw buildApiError({
      fallbackMessage,
      message: isSpaFallback ? fallbackMessage : extractApiMessage(payload, fallbackMessage),
      status: isSpaFallback ? 404 : response.status,
      details: payload,
    });
  }

  if (isSpaFallback) {
    throw buildApiError({
      fallbackMessage,
      message: fallbackMessage,
      status: 404,
      details: {
        path: cleanStr(path, 400),
        message: "The API route resolved to the app shell instead of a JSON handler.",
      },
    });
  }

  return payload;
}

function buildActionPayload(action, payload = {}) {
  return {
    action: cleanStr(action, 120),
    payload: payload && typeof payload === "object" ? payload : {},
  };
}

export async function initiatePayment(payload = {}) {
  return apiRequest(
    "/api/initiate-payment",
    {
      method: "POST",
      body: payload && typeof payload === "object" ? payload : {},
    },
    "Payment checkout could not start right now."
  );
}

export async function verifyPayment({ reference = "", ...rest } = {}) {
  const safeReference = cleanStr(reference, 160);
  const extra = rest && typeof rest === "object" ? rest : {};
  const extraKeys = Object.keys(extra).filter((key) => extra[key] !== undefined);

  if (safeReference && extraKeys.length === 0) {
    return apiRequest(
      `/api/verify-payment?reference=${encodeURIComponent(safeReference)}`,
      { method: "GET" },
      "We could not confirm this payment yet."
    );
  }

  return apiRequest(
    "/api/verify-payment",
    {
      method: "POST",
      body: {
        reference: safeReference,
        ...extra,
      },
    },
    "We could not confirm this payment yet."
  );
}

export async function trackPaymentDropoff(payload = {}) {
  return apiRequest(
    "/api/analytics/payment-dropoff",
    {
      method: "POST",
      body: payload && typeof payload === "object" ? payload : {},
    },
    "Payment analytics could not be saved right now."
  );
}

export async function fetchPaymentDropoffAnalytics({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 0) || 50));
  return apiRequest(
    `/api/analytics/payment-dropoff?limit=${encodeURIComponent(String(safeLimit))}`,
    { method: "GET" },
    "Payment drop-off analytics could not be loaded right now."
  );
}

export async function invokeFinanceAction(action, payload = {}) {
  return apiRequest(
    "/api/finance",
    {
      method: "POST",
      body: buildActionPayload(action, payload),
    },
    "Finance service is not available right now."
  );
}

export async function invokeRequestCommand(payload = {}) {
  return apiRequest(
    "/api/request-command",
    {
      method: "POST",
      body: payload && typeof payload === "object" ? payload : {},
    },
    "Request backend is not available right now."
  );
}

export async function invokeRequestMessage(payload = {}) {
  return apiRequest(
    "/api/request-message",
    {
      method: "POST",
      body: payload && typeof payload === "object" ? payload : {},
    },
    "Chat backend is not available right now."
  );
}

export async function triggerNotificationPush(payload = {}) {
  return apiRequest(
    "/api/notification-push",
    {
      method: "POST",
      body: payload && typeof payload === "object" ? payload : {},
    },
    "Notification push backend is not available right now."
  );
}

export async function invokeRequestAction(action, payload = {}) {
  return apiRequest(
    "/api/request-action",
    {
      method: "POST",
      body: buildActionPayload(action, payload),
    },
    "Request backend is not available right now."
  );
}

export async function invokeManagerAction(action, payload = {}) {
  return apiRequest(
    "/api/manager-action",
    {
      method: "POST",
      body: buildActionPayload(action, payload),
    },
    "Manager service is not available right now."
  );
}

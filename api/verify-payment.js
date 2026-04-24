import { handleCors, json, methodNotAllowed, readJsonBody } from "./_lib/http.js";
import { lookupPaymentByReference } from "./_lib/paymentSystem.js";

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function sendRouteError(res, error, fallbackMessage) {
  json(res, Number(error?.statusCode || 500) || 500, {
    ok: false,
    message: safeString(error?.message, 500) || fallbackMessage,
    details: error?.details || null,
  });
}

function readReferenceFromUrl(req) {
  try {
    const url = new URL(req.url || "", "http://127.0.0.1");
    return safeString(url.searchParams.get("reference"), 180);
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  if (handleCors(req, res, ["GET", "POST"])) {
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    methodNotAllowed(res, ["GET", "POST"]);
    return;
  }

  try {
    const body =
      req.method === "POST" ? await readJsonBody(req) : {};
    const reference =
      safeString(body?.reference, 180) || readReferenceFromUrl(req);
    console.info("[api/verify-payment] request", {
      method: req.method,
      reference,
    });
    const result = await lookupPaymentByReference({ reference });
    console.info("[api/verify-payment] success", {
      reference,
      status: safeString(result?.status, 80),
      requestId: safeString(result?.requestId, 180),
      paymentId: safeString(result?.paymentId, 180),
      fullPackageId: safeString(result?.fullPackageId, 180),
    });
    json(res, 200, result);
  } catch (error) {
    console.error("[api/verify-payment] failed", {
      method: req.method,
      message: safeString(error?.message, 500),
      details: error?.details || null,
    });
    sendRouteError(res, error, "We could not confirm this payment yet.");
  }
}

import { handleCors, json, methodNotAllowed, readJsonBody } from "./_lib/http.js";
import { initiatePaymentFlow } from "./_lib/paymentSystem.js";

function sendRouteError(res, error, fallbackMessage) {
  json(res, Number(error?.statusCode || 500) || 500, {
    ok: false,
    message: String(error?.message || "").trim() || fallbackMessage,
    details: error?.details || null,
  });
}

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) {
    return;
  }

  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  try {
    const payload = await readJsonBody(req);
    console.info("[api/initiate-payment] request", {
      flowType: String(payload?.flowType || "").trim(),
      requestId: String(payload?.requestId || "").trim(),
      paymentId: String(payload?.paymentId || "").trim(),
      fullPackageId: String(payload?.fullPackageId || "").trim(),
      shareToken: String(payload?.shareToken || "").trim(),
    });
    const result = await initiatePaymentFlow(
      payload && typeof payload === "object" ? payload : {},
      req
    );
    console.info("[api/initiate-payment] success", {
      reference: String(result?.reference || "").trim(),
      attemptId: String(result?.attemptId || "").trim(),
      checkoutRequestId: String(result?.checkoutRequestId || "").trim(),
      merchantRequestId: String(result?.merchantRequestId || "").trim(),
    });
    json(res, 200, result);
  } catch (error) {
    console.error("[api/initiate-payment] failed", {
      message: String(error?.message || "").trim(),
      details: error?.details || null,
    });
    sendRouteError(res, error, "Payment could not be started right now.");
  }
}

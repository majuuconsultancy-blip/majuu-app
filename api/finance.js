import { handleCors, json, methodNotAllowed, readJsonBody } from "./_lib/http.js";
import { dispatchFinanceAction } from "./_lib/paymentSystem.js";

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

export default async function handler(req, res) {
  if (handleCors(req, res, ["POST"])) {
    return;
  }

  if (req.method !== "POST") {
    methodNotAllowed(res, ["POST"]);
    return;
  }

  try {
    const body = await readJsonBody(req);
    const action = safeString(body?.action, 120);
    const payload =
      body?.payload && typeof body.payload === "object" ? body.payload : {};
    const result = await dispatchFinanceAction({ action, payload, req });
    json(res, 200, result);
  } catch (error) {
    sendRouteError(res, error, "Finance service is not available right now.");
  }
}

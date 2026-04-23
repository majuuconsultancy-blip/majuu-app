import { json, methodNotAllowed, readJsonBody } from "./_lib/http.js";
import { processMpesaCallback } from "./_lib/paymentSystem.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    json(res, 200, {
      ok: true,
      message: "M-Pesa callback endpoint is ready.",
    });
    return;
  }

  if (req.method !== "POST") {
    methodNotAllowed(res, ["GET", "POST"]);
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const callback =
      payload?.Body?.stkCallback && typeof payload.Body.stkCallback === "object"
        ? payload.Body.stkCallback
        : payload?.stkCallback && typeof payload.stkCallback === "object"
          ? payload.stkCallback
          : {};
    console.info("[api/mpesa-callback] request", {
      merchantRequestId: String(callback?.MerchantRequestID || "").trim(),
      checkoutRequestId: String(callback?.CheckoutRequestID || "").trim(),
      resultCode: Number(callback?.ResultCode ?? payload?.ResultCode ?? -1),
      resultDesc: String(callback?.ResultDesc || payload?.ResultDesc || "").trim(),
    });
    const result = await processMpesaCallback(payload, req);
    console.info("[api/mpesa-callback] success", {
      matched: result?.matched === true,
      status: String(result?.status || "").trim(),
      reference: String(result?.reference || "").trim(),
      requestId: String(result?.requestId || "").trim(),
      paymentId: String(result?.paymentId || "").trim(),
      fullPackageId: String(result?.fullPackageId || "").trim(),
    });
    json(res, 200, {
      ResultCode: 0,
      ResultDesc: "Accepted",
      ok: true,
      result,
    });
  } catch (error) {
    console.error("[api/mpesa-callback] failed", {
      message: String(error?.message || "").trim(),
      details: error?.details || null,
    });
    json(res, 200, {
      ResultCode: 0,
      ResultDesc: "Accepted",
      ok: false,
      message: "Callback received.",
    });
  }
}

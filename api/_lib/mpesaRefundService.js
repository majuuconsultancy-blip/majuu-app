function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function roundMoney(value) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.round(next));
}

function nowMs() {
  return Date.now();
}

export const MPESA_REFUND_CAPABILITIES = Object.freeze({
  b2c: true,
  b2b: true,
  reversal: true,
  implemented: ["stk_push", "callback"],
  planned: ["b2c_refund", "b2b_disbursement", "transaction_reversal"],
});

export function buildRefundPlaceholder({
  requestId = "",
  paymentId = "",
  amount = 0,
  currency = "KES",
  actorUid = "",
  reason = "",
} = {}) {
  const createdAtMs = nowMs();
  return {
    provider: "mpesa",
    service: "b2c",
    status: "not_started",
    amount: roundMoney(amount),
    currency: safeString(currency || "KES", 8).toUpperCase() || "KES",
    actorUid: safeString(actorUid, 160),
    requestId: safeString(requestId, 180),
    paymentId: safeString(paymentId, 180),
    reason: safeString(reason, 1200),
    placeholder: true,
    supportsInstantRefunds: true,
    implementationStatus: "planned",
    nextAction: "Connect M-Pesa B2C credentials and command handling.",
    capabilities: MPESA_REFUND_CAPABILITIES,
    createdAtMs,
    updatedAtMs: createdAtMs,
  };
}

export async function triggerB2CRefund() {
  const error = new Error("M-Pesa B2C refunds are not implemented yet.");
  error.code = "refund/not-implemented";
  throw error;
}

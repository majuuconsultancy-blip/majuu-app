const BUSINESS_PENDING_STATUSES = new Set([
  "prompted",
  "payment_session_created",
  "awaiting_payment",
  "payable",
  "admin_review",
  "approved",
]);

const BUSINESS_SUCCESS_STATUSES = new Set(["paid", "held", "payout_ready", "settled"]);
const CHECKOUT_STATUS_VALUES = new Set([
  "pending",
  "success",
  "cancelled",
  "failed",
  "timeout",
]);

function cleanStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return cleanStr(value, max).toLowerCase();
}

function safeNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function isSafaricomLocalNumber(local = "") {
  return /^(?:70\d|71\d|72\d|74[0-689]|75[789]|76[89]|79\d|11[0-5])\d{6}$/.test(
    cleanStr(local, 20)
  );
}

export function normalizeSafaricomMpesaNumber(value = "") {
  const digits = cleanStr(value, 40).replace(/\D+/g, "");
  if (!digits) return "";

  let local = digits;
  if (local.startsWith("254") && local.length >= 12) {
    local = local.slice(3);
  } else if (local.startsWith("0") && local.length >= 10) {
    local = local.slice(1);
  }

  local = local.slice(-9);
  if (!/^\d{9}$/.test(local)) return "";
  if (!isSafaricomLocalNumber(local)) return "";
  return `254${local}`;
}

export function isValidSafaricomMpesaNumber(value = "") {
  return Boolean(normalizeSafaricomMpesaNumber(value));
}

export function normalizeStoredCheckoutStatus(value = "", fallback = "") {
  const next = lower(value, 40);
  return CHECKOUT_STATUS_VALUES.has(next) ? next : fallback;
}

export function resolveMpesaCheckoutOutcome(result = {}) {
  const source = result && typeof result === "object" ? result : {};
  const checkoutStatus = normalizeStoredCheckoutStatus(
    source?.checkoutStatus || source?.statusHint || source?.mpesa?.checkoutStatus
  );
  const failureReason = lower(
    source?.checkoutFailureReason || source?.failureReason || source?.mpesa?.checkoutFailureReason,
    80
  );
  const resultCode = safeNumber(
    source?.resultCode ?? source?.checkoutResultCode ?? source?.mpesa?.resultCode
  );
  const businessStatus = lower(source?.status, 80);

  let baseOutcome = checkoutStatus;
  if (!baseOutcome) {
    if (resultCode === 0) {
      baseOutcome = "success";
    } else if (resultCode === 1032) {
      baseOutcome = "cancelled";
    } else if (resultCode === 1037) {
      baseOutcome = "timeout";
    } else if (resultCode !== null) {
      baseOutcome = "failed";
    } else if (BUSINESS_SUCCESS_STATUSES.has(businessStatus)) {
      baseOutcome = "success";
    } else if (BUSINESS_PENDING_STATUSES.has(businessStatus)) {
      baseOutcome = "pending";
    } else if (businessStatus === "failed") {
      if (failureReason === "timeout") {
        baseOutcome = "timeout";
      } else if (failureReason === "user_cancelled") {
        baseOutcome = "cancelled";
      } else {
        baseOutcome = "failed";
      }
    } else {
      baseOutcome = "pending";
    }
  }

  if (baseOutcome === "failed" && (failureReason === "insufficient_balance" || resultCode === 1)) {
    return "insufficient";
  }

  return baseOutcome;
}

export function isPendingMpesaCheckout(result = {}) {
  return resolveMpesaCheckoutOutcome(result) === "pending";
}

export function isSuccessfulMpesaCheckout(result = {}) {
  return resolveMpesaCheckoutOutcome(result) === "success";
}

export function getMpesaCheckoutMessage(result = {}) {
  switch (resolveMpesaCheckoutOutcome(result)) {
    case "success":
      return "Payment successful 🎉";
    case "cancelled":
      return "You cancelled the payment on your phone";
    case "insufficient":
      return "Insufficient M-Pesa balance";
    case "timeout":
      return "You took too long. Please try again";
    case "failed":
      return "Payment failed. Please try again";
    case "pending":
    default:
      return (
        cleanStr(result?.message, 400) ||
        "We sent the M-Pesa prompt. Complete it on your phone and we will keep checking."
      );
  }
}

export function getMpesaCheckoutHeadline(result = {}) {
  switch (resolveMpesaCheckoutOutcome(result)) {
    case "success":
      return "Payment successful";
    case "pending":
      return "Complete payment on your phone";
    case "cancelled":
      return "Payment cancelled";
    case "insufficient":
      return "Payment needs attention";
    case "timeout":
      return "Payment timed out";
    case "failed":
    default:
      return "Payment failed";
  }
}

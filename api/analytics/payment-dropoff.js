import { FieldValue, admin, db } from "../_lib/firebaseAdmin.js";
import {
  getBearerToken,
  handleCors,
  json,
  methodNotAllowed,
  readJsonBody,
} from "../_lib/http.js";

const PAYMENT_DROPOFF_COLLECTION = "analytics_paymentDropoffs";
const PAYMENT_DROPOFF_STEPS = new Set([
  "initiated",
  "stk_sent",
  "cancelled",
  "insufficient_balance",
  "timeout",
]);

const STEP_PRIORITIES = {
  stk_sent: 5,
  insufficient_balance: 4,
  timeout: 3,
  cancelled: 2,
  initiated: 1,
};

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function safeNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeUserRole(role = "") {
  const safeRole = safeString(role, 80).toLowerCase();
  if (
    safeRole === "superadmin" ||
    safeRole === "super_admin" ||
    safeRole === "super-admin" ||
    safeRole === "super admin"
  ) {
    return "superAdmin";
  }
  if (
    safeRole === "assignedadmin" ||
    safeRole === "assigned_admin" ||
    safeRole === "assigned-admin" ||
    safeRole === "assigned admin" ||
    safeRole === "admin"
  ) {
    return "assignedAdmin";
  }
  return safeRole || "user";
}

function isSafaricomLocalPhoneNumber(value = "") {
  return /^7(?:0\d|1\d|2\d|4\d|5\d|6\d|7\d|8\d|9\d)\d{6}$/.test(safeString(value, 20));
}

function normalizePhoneNumber(value = "") {
  const digits = safeString(value, 40).replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("254") && digits.length >= 12) {
    const local = digits.slice(3).slice(-9);
    return isSafaricomLocalPhoneNumber(local) ? `254${local}` : "";
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    const local = digits.slice(1).slice(-9);
    return isSafaricomLocalPhoneNumber(local) ? `254${local}` : "";
  }
  const local = digits.slice(-9);
  return isSafaricomLocalPhoneNumber(local) ? `254${local}` : "";
}

function normalizeStep(value = "") {
  const safeStep = safeString(value, 80).toLowerCase();
  return PAYMENT_DROPOFF_STEPS.has(safeStep) ? safeStep : "";
}

function getStepPriority(step = "") {
  return STEP_PRIORITIES[normalizeStep(step)] || 0;
}

function normalizeAmount(value) {
  const amount = safeNumber(value);
  return amount > 0 ? Math.round(amount) : 0;
}

function sendRouteError(res, error, fallbackMessage) {
  json(res, Number(error?.statusCode || 500) || 500, {
    ok: false,
    message: safeString(error?.message, 500) || fallbackMessage,
    details: error?.details || null,
  });
}

async function requireAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error("You must be signed in to continue.");
    error.statusCode = 401;
    throw error;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const role = normalizeUserRole(userData?.role);
    return {
      uid: safeString(decoded?.uid, 180),
      email: safeString(decoded?.email || userData?.email, 240),
      role,
      isSuperAdmin: role === "superAdmin",
    };
  } catch (error) {
    const authError = new Error("Your session has expired. Please sign in again.");
    authError.statusCode = 401;
    authError.details = {
      code: safeString(error?.code, 120),
    };
    throw authError;
  }
}

function normalizeRow(row = {}, id = "") {
  const safeStep = normalizeStep(row?.step);
  return {
    id: safeString(id || row?.analyticsId, 180),
    userId: safeString(row?.userId, 180),
    phoneNumber: normalizePhoneNumber(row?.phoneNumber),
    amount: normalizeAmount(row?.amount),
    service: safeString(row?.service, 180),
    requestId: safeString(row?.requestId, 180),
    paymentId: safeString(row?.paymentId, 180),
    reference: safeString(row?.reference, 180),
    draftId: safeString(row?.draftId, 180),
    step: safeStep,
    priority: safeNumber(row?.priority) || getStepPriority(safeStep),
    createdAtMs: safeNumber(row?.createdAtMs),
  };
}

function sortRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).sort((left, right) => {
    const createdDiff = safeNumber(right?.createdAtMs) - safeNumber(left?.createdAtMs);
    if (createdDiff !== 0) return createdDiff;
    return safeNumber(right?.priority) - safeNumber(left?.priority);
  });
}

function readLimitFromUrl(req) {
  try {
    const url = new URL(req.url || "", "http://127.0.0.1");
    return Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50) || 50));
  } catch {
    return 50;
  }
}

async function handleCreate(req, res) {
  const actor = await requireAuthenticatedUser(req);
  const body = await readJsonBody(req);
  const step = normalizeStep(body?.step);
  if (!step) {
    const error = new Error("A valid payment drop-off step is required.");
    error.statusCode = 400;
    throw error;
  }

  const createdAtMs = Date.now();
  const payload = {
    analyticsId: "",
    userId: actor.uid,
    email: actor.email,
    phoneNumber: normalizePhoneNumber(body?.phoneNumber),
    amount: normalizeAmount(body?.amount),
    service: safeString(body?.service, 180),
    requestId: safeString(body?.requestId, 180),
    paymentId: safeString(body?.paymentId, 180),
    reference: safeString(body?.reference, 180),
    draftId: safeString(body?.draftId, 180),
    step,
    priority: getStepPriority(step),
    source: "mpesa_checkout",
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs,
  };

  const analyticsRef = db.collection(PAYMENT_DROPOFF_COLLECTION).doc();
  await analyticsRef.set({
    ...payload,
    analyticsId: analyticsRef.id,
  });

  console.info("[payment-dropoff] tracked", {
    analyticsId: analyticsRef.id,
    userId: actor.uid,
    requestId: payload.requestId,
    reference: payload.reference,
    step,
  });

  json(res, 200, {
    ok: true,
    analyticsId: analyticsRef.id,
    row: normalizeRow(payload, analyticsRef.id),
  });
}

async function handleList(req, res) {
  const actor = await requireAuthenticatedUser(req);
  if (!actor.isSuperAdmin) {
    const error = new Error("Only Super Admin can view payment drop-off analytics.");
    error.statusCode = 403;
    throw error;
  }

  const safeLimit = readLimitFromUrl(req);
  const snap = await db
    .collection(PAYMENT_DROPOFF_COLLECTION)
    .orderBy("createdAtMs", "desc")
    .limit(safeLimit)
    .get();

  const rows = sortRows(snap.docs.map((docSnap) => normalizeRow(docSnap.data() || {}, docSnap.id)));

  json(res, 200, {
    ok: true,
    rows,
  });
}

export default async function handler(req, res) {
  if (handleCors(req, res, ["GET", "POST"])) {
    return;
  }

  if (req.method === "POST") {
    try {
      await handleCreate(req, res);
    } catch (error) {
      console.error("[payment-dropoff] create failed", {
        message: safeString(error?.message, 500),
        details: error?.details || null,
      });
      sendRouteError(res, error, "Payment analytics could not be saved right now.");
    }
    return;
  }

  if (req.method === "GET") {
    try {
      await handleList(req, res);
    } catch (error) {
      console.error("[payment-dropoff] list failed", {
        message: safeString(error?.message, 500),
        details: error?.details || null,
      });
      sendRouteError(res, error, "Payment drop-off analytics could not be loaded right now.");
    }
    return;
  }

  methodNotAllowed(res, ["GET", "POST"]);
}

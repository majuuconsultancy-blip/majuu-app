import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { db } from "../firebase";

function safeStr(value) {
  return String(value || "").trim();
}

function trimTrailingSlash(value) {
  return safeStr(value).replace(/\/+$/, "");
}

const DEFAULT_ADMIN_EMAIL = "brioneroo@gmail.com";
const PUSH_SERVER_URL = trimTrailingSlash(import.meta.env.VITE_PUSH_SERVER_URL);
const PUSH_SERVER_API_KEY = safeStr(import.meta.env.VITE_PUSH_SERVER_API_KEY);
const PUSH_SERVER_ADMIN_UID = safeStr(import.meta.env.VITE_PUSH_SERVER_ADMIN_UID);
const PUSH_SERVER_ADMIN_EMAIL = safeStr(
  import.meta.env.VITE_PUSH_SERVER_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL
).toLowerCase();

let cachedAdminUid = "";
let adminUidLookupPromise = null;
let warnedMissingUrl = false;

function hasPushServerUrl() {
  return Boolean(PUSH_SERVER_URL);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function postPushServer(path, payload) {
  if (!hasPushServerUrl()) {
    if (!warnedMissingUrl) {
      warnedMissingUrl = true;
      console.warn("VITE_PUSH_SERVER_URL is missing; skipping client-triggered push.");
    }
    return { ok: false, skipped: true, reason: "missing_push_server_url" };
  }

  const url = `${PUSH_SERVER_URL}${safeStr(path).startsWith("/") ? path : `/${safeStr(path)}`}`;
  const headers = {
    "content-type": "application/json",
  };
  if (PUSH_SERVER_API_KEY) {
    headers["x-api-key"] = PUSH_SERVER_API_KEY;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(asObject(payload)),
  });

  let responseBody = null;
  const contentType = safeStr(response.headers.get("content-type")).toLowerCase();
  try {
    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    const detail =
      typeof responseBody === "string"
        ? responseBody
        : safeStr(responseBody?.error || responseBody?.message);
    throw new Error(`Push server ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return responseBody;
}

export async function sendClientTriggeredPush({
  toRole,
  toUid,
  title,
  body,
  data = {},
} = {}) {
  const inputRole = safeStr(toRole).toLowerCase();
  const role = inputRole === "assignedadmin" ? "admin" : inputRole;
  const uid = safeStr(toUid);
  if (!uid) return { ok: false, skipped: true, reason: "missing_to_uid" };
  if (!["user", "staff", "admin"].includes(role)) {
    return { ok: false, skipped: true, reason: "invalid_to_role" };
  }

  return postPushServer("/sendPush", {
    toRole: role,
    toUid: uid,
    title: safeStr(title) || "MAJUU",
    body: safeStr(body) || "You have an update.",
    data: asObject(data),
  });
}

async function lookupAdminUidByEmail(email) {
  const safeEmail = safeStr(email).toLowerCase();
  if (!safeEmail) return "";

  const snap = await getDocs(query(collection(db, "users"), where("email", "==", safeEmail), limit(1)));
  if (snap.empty) return "";
  return safeStr(snap.docs[0]?.id);
}

export async function resolveAdminPushUid() {
  if (PUSH_SERVER_ADMIN_UID) return PUSH_SERVER_ADMIN_UID;
  if (cachedAdminUid) return cachedAdminUid;
  if (adminUidLookupPromise) return adminUidLookupPromise;

  adminUidLookupPromise = (async () => {
    const uid = await lookupAdminUidByEmail(PUSH_SERVER_ADMIN_EMAIL);
    if (uid) cachedAdminUid = uid;
    return uid;
  })();

  try {
    return await adminUidLookupPromise;
  } finally {
    adminUidLookupPromise = null;
  }
}

export async function sendPushToAdmin({ title, body, data = {} } = {}) {
  const adminUid = await resolveAdminPushUid();
  if (!adminUid) {
    console.warn("Admin push target UID not found; skipping client-triggered admin push.");
    return { ok: false, skipped: true, reason: "missing_admin_uid" };
  }

  return sendClientTriggeredPush({
    toRole: "admin",
    toUid: adminUid,
    title,
    body,
    data,
  });
}

export async function sendPushForNotificationDoc({ scope, uid, notification } = {}) {
  const inputRole = safeStr(scope).toLowerCase();
  const role = inputRole === "assignedadmin" ? "admin" : inputRole;
  if (!["user", "staff", "admin"].includes(role)) {
    return { ok: false, skipped: true, reason: "unsupported_scope" };
  }

  const row = asObject(notification);
  const targetUid = safeStr(uid || row.uid);
  if (!targetUid) return { ok: false, skipped: true, reason: "missing_target_uid" };

  return sendClientTriggeredPush({
    toRole: role,
    toUid: targetUid,
    title: safeStr(row.title),
    body: safeStr(row.body),
    data: {
      type: safeStr(row.type),
      requestId: safeStr(row.requestId),
      paymentId: safeStr(row.paymentId),
      refundId: safeStr(row.refundId),
      route: safeStr(row.route),
      notificationId: safeStr(row.id),
      role,
    },
  });
}

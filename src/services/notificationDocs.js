import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { sendPushForNotificationDoc } from "./pushServerClient";

function safeStr(value) {
  return String(value || "").trim();
}

function buildNotificationCopy(type, requestId) {
  const rid = safeStr(requestId);
  const routeRequest = rid ? `/app/request/${encodeURIComponent(rid)}` : "/app/progress";
  const routeRequestChat = rid ? `${routeRequest}?openChat=1` : "/app/progress";
  const routeStaffRequest = rid ? `/staff/request/${encodeURIComponent(rid)}?openChat=1` : "/staff/tasks";
  const routeStaffStart = rid ? `/staff/request/${encodeURIComponent(rid)}/start` : "/staff/tasks";

  switch (safeStr(type).toUpperCase()) {
    case "REQUEST_ASSIGNED":
      return {
        title: "Request update",
        body: "Your request is being worked on.",
        route: routeRequest,
      };
    case "REQUEST_ACCEPTED":
      return {
        title: "Request accepted",
        body: "Your request has been accepted.",
        route: routeRequest,
      };
    case "REQUEST_REJECTED":
      return {
        title: "Request rejected",
        body: "Your request has been rejected.",
        route: routeRequest,
      };
    case "NEW_MESSAGE":
      return {
        title: "New message",
        body: "You have a new message.",
        route: routeRequestChat,
      };
    case "MESSAGE_REJECTED_USER":
      return {
        title: "Message rejected",
        body: "Your message was rejected by admin.",
        route: routeRequestChat,
      };
    case "STAFF_ASSIGNED_REQUEST":
      return {
        title: "New assignment",
        body: "You have been assigned a request.",
        route: "/staff/tasks",
      };
    case "STAFF_UNASSIGNED_REQUEST":
      return {
        title: "Assignment removed",
        body: "A request was unassigned from your queue.",
        route: "/staff/tasks",
      };
    case "STAFF_REQUEST_EXPIRING_SOON":
      return {
        title: "Action needed soon",
        body: "A new request is close to reassignment timeout.",
        route: routeStaffStart,
      };
    case "STAFF_REQUEST_ACCEPTED_BY_ADMIN":
      return {
        title: "Request finalized",
        body: "Admin accepted this request.",
        route: routeStaffRequest,
      };
    case "STAFF_REQUEST_REJECTED_BY_ADMIN":
      return {
        title: "Request finalized",
        body: "Admin rejected this request.",
        route: routeStaffRequest,
      };
    case "STAFF_NEW_MESSAGE":
      return {
        title: "New message",
        body: "You have a new message.",
        route: routeStaffRequest,
      };
    case "STAFF_MESSAGE_REJECTED":
      return {
        title: "Message rejected",
        body: "A message you sent was rejected by admin.",
        route: routeStaffRequest,
      };
    default:
      return {
        title: "Notification",
        body: "You have an update.",
        route: routeRequest,
      };
  }
}

async function createNotificationDoc({ scope, uid, type, requestId, extras = {} }) {
  const targetUid = safeStr(uid);
  const notifType = safeStr(type).toUpperCase();
  const rid = safeStr(requestId);
  if (!targetUid || !notifType) return null;

  const copy = buildNotificationCopy(notifType, rid);
  const actorUid = safeStr(auth.currentUser?.uid);

  let colRef = null;
  if (scope === "user") {
    colRef = collection(db, "users", targetUid, "notifications");
  } else if (scope === "staff") {
    colRef = collection(db, "staff", targetUid, "notifications");
  }
  if (!colRef) return null;

  const payload = {
    type: notifType,
    role: scope,
    uid: targetUid,
    requestId: rid || null,
    title: safeStr(copy.title),
    body: safeStr(copy.body),
    route: safeStr(copy.route),
    readAt: null,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    createdBy: actorUid || null,
    ...extras,
  };

  const ref = await addDoc(colRef, payload);
  const row = { id: ref.id, ...payload };

  try {
    await sendPushForNotificationDoc({
      scope,
      uid: targetUid,
      notification: row,
    });
  } catch (error) {
    console.warn("Failed to trigger push for notification doc:", error?.message || error);
  }

  return row;
}

export async function createUserNotification({ uid, type, requestId, extras } = {}) {
  return createNotificationDoc({ scope: "user", uid, type, requestId, extras });
}

export async function createStaffNotification({ uid, type, requestId, extras } = {}) {
  return createNotificationDoc({ scope: "staff", uid, type, requestId, extras });
}

export function notificationRouteForType(type, requestId) {
  return buildNotificationCopy(type, requestId)?.route || "";
}

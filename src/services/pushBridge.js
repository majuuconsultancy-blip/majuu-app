import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { LocalNotifications } from "@capacitor/local-notifications";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";

function safeStr(value) {
  return String(value || "").trim();
}

function safeJsonStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        if (typeof val === "function") return `[Function ${val.name || "anonymous"}]`;
        return val;
      },
      2
    );
  } catch (error) {
    return `<<stringify_failed:${safeStr(error?.message || error)}>>`;
  }
}

const ADMIN_EMAIL = "brioneroo@gmail.com";
const localDedupe = new Set();

let activeCleanup = null;
let activeNavigate = null;
let activeSession = { role: "", uid: "" };
let pushRegisterSessionKey = "";

function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function platformName() {
  try {
    const p = Capacitor.getPlatform?.();
    if (p === "android" || p === "ios") return p;
    return "web";
  } catch {
    return "web";
  }
}

function isVisibleForeground() {
  try {
    return typeof document !== "undefined" && document.visibilityState === "visible";
  } catch {
    return false;
  }
}

function isAndroidNative() {
  return isNative() && platformName() === "android";
}

function hashToInt(seed) {
  let h = 0;
  const s = safeStr(seed);
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h || Date.now()) % 2147483000;
}

function parsePayload(input) {
  if (!input) return {};
  if (input.notification?.data && typeof input.notification.data === "object") {
    return input.notification.data;
  }
  if (input.notification?.extra && typeof input.notification.extra === "object") {
    return input.notification.extra;
  }
  if (input.extra && typeof input.extra === "object") return input.extra;
  if (typeof input === "object") return input;
  return {};
}

export function resolveRouteFromPayload(rawPayload = {}) {
  const payload = parsePayload(rawPayload);
  const route = safeStr(payload?.route);
  if (route) return route;

  const type = safeStr(payload?.type).toUpperCase();
  const requestId = safeStr(payload?.requestId);
  const rid = requestId ? encodeURIComponent(requestId) : "";

  if (type === "NEW_MESSAGE" || type === "MESSAGE_REJECTED_USER") {
    return rid ? `/app/request/${rid}?openChat=1` : "/app/progress";
  }
  if (type === "REQUEST_ACCEPTED" || type === "REQUEST_REJECTED" || type === "REQUEST_ASSIGNED") {
    return rid ? `/app/request/${rid}` : "/app/progress";
  }
  if (type === "STAFF_ASSIGNED_REQUEST") return "/staff/tasks";
  if (type === "STAFF_NEW_MESSAGE" || type === "STAFF_MESSAGE_REJECTED") {
    return rid ? `/staff/request/${rid}?openChat=1` : "/staff/tasks";
  }
  if (type === "NEW_REQUEST") {
    return rid ? `/app/admin/request/${rid}` : "/app/admin";
  }
  if (type === "ADMIN_NEW_MESSAGE") {
    return rid ? `/app/admin/request/${rid}?openChat=1` : "/app/admin";
  }

  return "";
}

function setOpenChatSessionFlag(route) {
  const raw = safeStr(route);
  if (!raw) return raw;

  let url;
  try {
    url = new URL(raw, "https://majuu.local");
  } catch {
    return raw;
  }

  if (url.searchParams.get("openChat") !== "1") return raw;

  const parts = url.pathname.split("/").filter(Boolean);
  const requestId = safeStr(parts[parts.length - 1]);
  if (!requestId) {
    return `${url.pathname}${url.search}`;
  }

  try {
    if (url.pathname.startsWith("/app/request/")) {
      sessionStorage.setItem(`maj_open_chat:${requestId}`, "1");
    } else if (url.pathname.startsWith("/staff/request/")) {
      sessionStorage.setItem(`maj_open_staff_chat:${requestId}`, "1");
    } else if (url.pathname.startsWith("/app/admin/request/")) {
      sessionStorage.setItem(`maj_open_admin_chat:${requestId}`, "1");
    }
  } catch {
    // ignore
  }

  return `${url.pathname}${url.search}`;
}

export function navigateFromPayload({ navigate, payload }) {
  const route = resolveRouteFromPayload(payload);
  const finalRoute = setOpenChatSessionFlag(route);
  if (!finalRoute || typeof navigate !== "function") return false;
  navigate(finalRoute);
  return true;
}

export async function scheduleForegroundLocalNotification({
  dedupeKey,
  title,
  body,
  route,
  extra = {},
} = {}) {
  const key = safeStr(dedupeKey);
  if (!key) return false;
  if (localDedupe.has(key)) return false;
  if (!isNative()) return false;
  if (!isVisibleForeground()) return false;

  try {
    const perm = await LocalNotifications.checkPermissions();
    const status = safeStr(perm?.display);
    if (status !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (safeStr(req?.display) !== "granted") return false;
    }

    localDedupe.add(key);
    await LocalNotifications.schedule({
      notifications: [
        {
          id: hashToInt(`${key}:${Date.now()}`),
          title: safeStr(title) || "Notification",
          body: safeStr(body) || "You have an update.",
          channelId: "majuu_default",
          schedule: { at: new Date(Date.now() + 250) },
          extra: {
            route: safeStr(route),
            ...extra,
          },
        },
      ],
    });
    return true;
  } catch (error) {
    console.warn("scheduleForegroundLocalNotification failed:", error?.message || error);
    return false;
  }
}

export function clearPushBridgeDedupe() {
  localDedupe.clear();
}

async function ensureLocalNotificationsPermission() {
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (safeStr(perm?.display) === "granted") return true;
    const req = await LocalNotifications.requestPermissions();
    return safeStr(req?.display) === "granted";
  } catch (error) {
    console.warn("LocalNotifications permission check/request failed:", error?.message || error);
    return false;
  }
}

async function ensureAndroidDefaultNotificationChannel() {
  if (!isAndroidNative()) return;
  try {
    await LocalNotifications.createChannel({
      id: "majuu_default",
      name: "MAJUU",
      importance: 5,
    });
    console.log("LocalNotifications channel ready: majuu_default");
  } catch (error) {
    console.warn("LocalNotifications.createChannel failed:", error?.message || error);
  }
}

async function upsertPushToken({ uid, role, token }) {
  const safeUid = safeStr(uid);
  const safeRole = safeStr(role).toLowerCase();
  const safeToken = safeStr(token);
  if (!safeUid || !safeToken) return;

  const normalizedRole = safeRole === "assignedadmin" ? "admin" : safeRole;

  const roleValue =
    normalizedRole === "admin" || normalizedRole === "staff" || normalizedRole === "user"
      ? normalizedRole
      : "user";
  const tokenDocId = encodeURIComponent(safeToken);
  const rootCollection = roleValue === "staff" ? "staff" : "users";
  const pushTokenRef = doc(db, rootCollection, safeUid, "pushTokens", tokenDocId);
  const detectedPlatform = platformName();
  const platformValue = detectedPlatform === "android" ? "android" : detectedPlatform;

  await setDoc(
    pushTokenRef,
    {
      token: safeToken,
      platform: platformValue,
      role: roleValue,
      uid: safeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  console.log("Push token saved to Firestore", pushTokenRef.path);
}

export function cleanupPushBridge() {
  try {
    activeCleanup?.();
  } catch {}
  activeCleanup = null;
  activeNavigate = null;
  activeSession = { role: "", uid: "" };
}

export function initPushBridge({ navigate, role, uid }) {
  cleanupPushBridge();

  activeNavigate = typeof navigate === "function" ? navigate : null;
  activeSession = {
    role: safeStr(role).toLowerCase(),
    uid: safeStr(uid),
  };

  if (!isNative()) {
    activeCleanup = () => {};
    return activeCleanup;
  }

  let disposed = false;
  let pushActionHandle = null;
  let localActionHandle = null;
  let registrationHandle = null;
  let registrationErrorHandle = null;
  let pushReceivedHandle = null;

  const onTap = (payload) => {
    try {
      navigateFromPayload({ navigate: activeNavigate, payload });
    } catch (error) {
      console.warn("pushBridge tap navigation failed:", error?.message || error);
    }
  };

  PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
    console.log("pushNotificationActionPerformed payload", safeJsonStringify(event));
    const payload = parsePayload(event);
    const directRoute = safeStr(payload?.route);
    if (directRoute && typeof activeNavigate === "function") {
      try {
        const finalRoute = setOpenChatSessionFlag(directRoute);
        if (finalRoute) {
          activeNavigate(finalRoute);
          return;
        }
      } catch (error) {
        console.warn("pushBridge direct route navigation failed:", error?.message || error);
      }
    }
    onTap(event);
  }).then((handle) => {
    if (disposed) {
      handle.remove();
      return;
    }
    pushActionHandle = handle;
  });

  PushNotifications.addListener("pushNotificationReceived", (event) => {
    console.log("pushNotificationReceived payload", safeJsonStringify(event));
    if (!isVisibleForeground()) return;

    const payload = parsePayload(event);
    const title =
      safeStr(event?.title) ||
      safeStr(event?.notification?.title) ||
      "MAJUU";
    const body =
      safeStr(event?.body) ||
      safeStr(event?.notification?.body) ||
      "You have an update.";
    const route = safeStr(payload?.route) || resolveRouteFromPayload(event);
    const dedupeKey =
      safeStr(payload?.notificationId) ||
      safeStr(payload?.requestId) ||
      `push:${title}:${body}:${route}`;

    scheduleForegroundLocalNotification({
      dedupeKey,
      title,
      body,
      route,
      extra: payload,
    }).catch((error) => {
      console.warn("pushBridge foreground local notification failed:", error?.message || error);
    });
  }).then((handle) => {
    if (disposed) {
      handle.remove();
      return;
    }
    pushReceivedHandle = handle;
  });

  LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    onTap(event);
  }).then((handle) => {
    if (disposed) {
      handle.remove();
      return;
    }
    localActionHandle = handle;
  });

  PushNotifications.addListener("registration", (token) => {
    const value = safeStr(token?.value || token?.token || "");
    console.log("Push registered");
    console.log("FCM TOKEN:", value);
    upsertPushToken({ uid: activeSession.uid, role: activeSession.role, token: value }).catch((e) => {
      console.warn("pushBridge token sync failed:", e?.message || e);
    });
  }).then((handle) => {
    if (disposed) {
      handle.remove();
      return;
    }
    registrationHandle = handle;
  });

  PushNotifications.addListener("registrationError", (error) => {
    console.warn("Push registration error:", error);
    console.warn("Push registration error (full):", safeJsonStringify(error));
  }).then((handle) => {
    if (disposed) {
      handle.remove();
      return;
    }
    registrationErrorHandle = handle;
  });

  (async () => {
    try {
      if (isAndroidNative()) {
        await ensureLocalNotificationsPermission();
        await ensureAndroidDefaultNotificationChannel();
      }

      const sessionKey = `${safeStr(activeSession.role)}:${safeStr(activeSession.uid)}`;
      if (!safeStr(activeSession.uid)) return;
      if (pushRegisterSessionKey === sessionKey) return;
      pushRegisterSessionKey = sessionKey;

      const perm = await PushNotifications.checkPermissions();
      const receive = safeStr(perm?.receive);
      console.log("Push permission result", perm);
      let granted = receive === "granted";
      if (!granted && receive !== "denied") {
        const req = await PushNotifications.requestPermissions();
        console.log("Push permission result", req);
        granted = safeStr(req?.receive) === "granted";
      }
      if (!granted) return;
      await PushNotifications.register();
      console.log("Push registered");
    } catch (error) {
      pushRegisterSessionKey = "";
      console.warn("pushBridge init/register failed:", error?.message || error);
    }
  })();

  const cleanup = () => {
    disposed = true;
    try {
      pushActionHandle?.remove?.();
    } catch {}
    try {
      localActionHandle?.remove?.();
    } catch {}
    try {
      pushReceivedHandle?.remove?.();
    } catch {}
    try {
      registrationHandle?.remove?.();
    } catch {}
    try {
      registrationErrorHandle?.remove?.();
    } catch {}
  };

  activeCleanup = cleanup;
  return cleanup;
}

export { cleanupPushBridge as cleanup };
export const ADMIN_PUSH_EMAIL = ADMIN_EMAIL;

import { useSyncExternalStore } from "react";
import { collection, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { markChatRead as writeChatRead } from "../utils/unreadChat";

function safeStr(value) {
  return String(value || "").trim();
}

function tsToMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "number") return value || 0;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  return 0;
}

const initialState = {
  session: {
    role: "",
    uid: "",
  },
  notifications: [],
  unreadNotifCount: 0,
  unreadByRequest: {},
};

let state = initialState;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error("notifsV2Store listener error:", error);
    }
  });
}

function cloneState(prev) {
  return {
    ...prev,
    session: { ...(prev.session || {}) },
    notifications: Array.isArray(prev.notifications) ? [...prev.notifications] : [],
    unreadByRequest: { ...(prev.unreadByRequest || {}) },
  };
}

function recalc(next) {
  next.unreadNotifCount = (next.notifications || []).reduce((sum, row) => {
    return sum + (row?.readAt ? 0 : 1);
  }, 0);
  return next;
}

function setState(updater) {
  const base = cloneState(state);
  const next = typeof updater === "function" ? updater(base) : { ...base, ...(updater || {}) };
  state = recalc(next);
  emit();
  return state;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState() {
  return state;
}

function setSession({ role, uid }) {
  setState((next) => {
    next.session = {
      role: safeStr(role).toLowerCase(),
      uid: safeStr(uid),
    };
    return next;
  });
}

function resetNotifsV2Store() {
  state = initialState;
  emit();
}

function normalizeNotification(item) {
  const id = safeStr(item?.id);
  if (!id) return null;
  return {
    id,
    type: safeStr(item?.type),
    title: safeStr(item?.title),
    body: safeStr(item?.body),
    requestId: safeStr(item?.requestId),
    route: safeStr(item?.route),
    role: safeStr(item?.role).toLowerCase(),
    readAt: item?.readAt || null,
    createdAt: item?.createdAt || null,
    createdAtMs: tsToMs(item?.createdAt) || Number(item?.createdAtMs || 0) || 0,
    meta: item?.meta && typeof item.meta === "object" ? item.meta : null,
  };
}

function setNotifications(list = []) {
  const rows = Array.isArray(list) ? list : [];
  setState((next) => {
    next.notifications = rows
      .map(normalizeNotification)
      .filter(Boolean)
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return next;
  });
}

function setUnreadForRequest(requestId, payload = {}) {
  const rid = safeStr(requestId);
  if (!rid) return;

  setState((next) => {
    const prev = next.unreadByRequest[rid] || {};
    const count = Math.max(0, Number(payload.count ?? prev.count ?? 0) || 0);
    next.unreadByRequest[rid] = {
      unread: Boolean(payload.unread ?? (count > 0)),
      count,
      lastMessageAtMs: Math.max(0, Number(payload.lastMessageAtMs ?? prev.lastMessageAtMs ?? 0) || 0),
      lastMessageId: safeStr(payload.lastMessageId ?? prev.lastMessageId ?? ""),
    };
    return next;
  });
}

function pruneUnreadRequests(allowedRequestIds = []) {
  const allow = new Set((allowedRequestIds || []).map((x) => safeStr(x)).filter(Boolean));
  setState((next) => {
    Object.keys(next.unreadByRequest || {}).forEach((rid) => {
      if (!allow.has(rid)) delete next.unreadByRequest[rid];
    });
    return next;
  });
}

function notificationsCollectionRef({ role, uid }) {
  const safeUid = safeStr(uid);
  const safeRole = safeStr(role).toLowerCase();
  if (!safeUid) return null;
  if (safeRole === "user") return collection(db, "users", safeUid, "notifications");
  if (safeRole === "staff") return collection(db, "staff", safeUid, "notifications");
  return null;
}

function notificationDocRef({ role, uid, notificationId }) {
  const safeUid = safeStr(uid);
  const safeRole = safeStr(role).toLowerCase();
  const nid = safeStr(notificationId);
  if (!safeUid || !nid) return null;
  if (safeRole === "user") return doc(db, "users", safeUid, "notifications", nid);
  if (safeRole === "staff") return doc(db, "staff", safeUid, "notifications", nid);
  return null;
}

async function markChatRead(requestId) {
  const rid = safeStr(requestId);
  if (!rid) return { ok: false };

  const snapshot = getState();
  const role = safeStr(snapshot?.session?.role).toLowerCase();
  const uid = safeStr(snapshot?.session?.uid);
  if (!uid || (role !== "user" && role !== "staff")) return { ok: false };

  setUnreadForRequest(rid, { unread: false, count: 0 });

  try {
    await writeChatRead({ requestId: rid, role, uid });
    return { ok: true };
  } catch (error) {
    console.error("notifsV2Store.markChatRead failed:", error);
    return { ok: false, error };
  }
}

async function markNotificationRead(notificationOrId) {
  const snapshot = getState();
  const role = safeStr(snapshot?.session?.role).toLowerCase();
  const uid = safeStr(snapshot?.session?.uid);
  if (!uid || (role !== "user" && role !== "staff")) return { ok: false };

  const nid =
    typeof notificationOrId === "string"
      ? safeStr(notificationOrId)
      : safeStr(notificationOrId?.id);
  if (!nid) return { ok: false };

  const ref = notificationDocRef({ role, uid, notificationId: nid });
  if (!ref) return { ok: false };

  setState((next) => {
    next.notifications = (next.notifications || []).map((row) => {
      if (row.id !== nid || row.readAt) return row;
      return { ...row, readAt: { local: true }, readAtMs: Date.now() };
    });
    return next;
  });

  try {
    await updateDoc(ref, { readAt: serverTimestamp() });
    return { ok: true };
  } catch (error) {
    console.error("notifsV2Store.markNotificationRead failed:", error);
    return { ok: false, error };
  }
}

async function markAllNotificationsRead() {
  const snapshot = getState();
  const role = safeStr(snapshot?.session?.role).toLowerCase();
  const uid = safeStr(snapshot?.session?.uid);
  if (!uid || (role !== "user" && role !== "staff")) return { ok: false };

  const unreadRows = (snapshot.notifications || []).filter((row) => !row?.readAt && row?.id);
  if (unreadRows.length === 0) return { ok: true, count: 0 };

  const colRef = notificationsCollectionRef({ role, uid });
  if (!colRef) return { ok: false };

  setState((next) => {
    next.notifications = (next.notifications || []).map((row) =>
      row.readAt ? row : { ...row, readAt: { local: true }, readAtMs: Date.now() }
    );
    return next;
  });

  try {
    const batch = writeBatch(db);
    unreadRows.forEach((row) => {
      const ref = doc(colRef, row.id);
      batch.update(ref, { readAt: serverTimestamp() });
    });
    await batch.commit();
    return { ok: true, count: unreadRows.length };
  } catch (error) {
    console.error("notifsV2Store.markAllNotificationsRead failed:", error);
    return { ok: false, error };
  }
}

export const notifsV2Store = {
  subscribe,
  getState,
  setSession,
  reset: resetNotifsV2Store,
  setNotifications,
  setUnreadForRequest,
  pruneUnreadRequests,
  markChatRead,
  markNotificationRead,
  markAllNotificationsRead,
};

export function useNotifsV2Store(selector = (s) => s) {
  return useSyncExternalStore(
    notifsV2Store.subscribe,
    () => selector(notifsV2Store.getState()),
    () => selector(notifsV2Store.getState())
  );
}

export { resetNotifsV2Store };

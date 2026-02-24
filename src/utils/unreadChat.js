import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { db } from "../firebase";

function safeStr(value) {
  return String(value || "").trim();
}

function normalizeRole(role) {
  const r = safeStr(role).toLowerCase();
  if (r !== "user" && r !== "staff") {
    throw new Error("unreadChat: role must be 'user' or 'staff'");
  }
  return r;
}

function tsToMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "number") return value || 0;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

function resolveReadStateId({ role, uid, ownerUid, assignedUid }) {
  const r = normalizeRole(role);
  const fallbackUid = safeStr(uid);
  const targetUid =
    r === "user" ? safeStr(ownerUid) || fallbackUid : safeStr(assignedUid) || fallbackUid;

  if (!targetUid) {
    throw new Error("unreadChat: uid is required");
  }

  return `${r}_${targetUid}`;
}

function parseListenArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === "object") {
    return args[0];
  }

  const [requestId, role, uid, onChange, extra = {}] = args;
  return {
    requestId,
    role,
    uid,
    onChange,
    ownerUid: extra?.ownerUid,
    assignedUid: extra?.assignedUid,
  };
}

function parseMarkArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === "object") {
    return args[0];
  }

  const [requestId, role, uid, ownerUid, assignedUid] = args;
  return { requestId, role, uid, ownerUid, assignedUid };
}

function emitUnread(onChange, payload) {
  if (typeof onChange !== "function") return;
  try {
    onChange(payload);
  } catch (error) {
    console.error("unreadChat onChange error:", error);
  }
}

export function getReadStateDocRef({ requestId, role, uid, ownerUid, assignedUid }) {
  const rid = safeStr(requestId);
  if (!rid) throw new Error("unreadChat: requestId is required");
  const readStateId = resolveReadStateId({ role, uid, ownerUid, assignedUid });
  return doc(db, "serviceRequests", rid, "readState", readStateId);
}

export function listenUnreadForRequest(...rawArgs) {
  const { requestId, role, uid, ownerUid, assignedUid, onChange } = parseListenArgs(rawArgs);

  const rid = safeStr(requestId);
  const currentUid = safeStr(uid);
  const safeRole = safeStr(role).toLowerCase();
  if (!rid || !currentUid || (safeRole !== "user" && safeRole !== "staff")) {
    emitUnread(onChange, {
      requestId: rid,
      role: safeRole || "user",
      unread: false,
      latestMessage: null,
      lastReadAtMs: 0,
    });
    return () => {};
  }

  let latestMessage = null;
  let lastReadAtMs = 0;

  const recompute = () => {
    const latestAtMs = tsToMs(latestMessage?.createdAt);
    const latestFromUid = safeStr(latestMessage?.fromUid);
    const unread =
      Boolean(latestMessage) &&
      latestFromUid !== currentUid &&
      latestAtMs > 0 &&
      latestAtMs > lastReadAtMs;

    emitUnread(onChange, {
      requestId: rid,
      role: safeRole,
      unread,
      latestMessage,
      lastReadAtMs,
    });
  };

  const latestMessageQuery = query(
    collection(db, "serviceRequests", rid, "messages"),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  const unsubLatest = onSnapshot(
    latestMessageQuery,
    (snap) => {
      const first = snap.docs[0];
      latestMessage = first ? { id: first.id, ...first.data() } : null;
      recompute();
    },
    (error) => {
      console.error("listenUnreadForRequest latest message snapshot failed:", error);
      latestMessage = null;
      recompute();
    }
  );

  const unsubReadState = onSnapshot(
    getReadStateDocRef({ requestId: rid, role: safeRole, uid: currentUid, ownerUid, assignedUid }),
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      lastReadAtMs = tsToMs(data?.lastReadAt);
      recompute();
    },
    (error) => {
      console.error("listenUnreadForRequest readState snapshot failed:", error);
      lastReadAtMs = 0;
      recompute();
    }
  );

  return () => {
    try {
      unsubLatest?.();
    } catch {}
    try {
      unsubReadState?.();
    } catch {}
  };
}

export async function markChatRead(...rawArgs) {
  const { requestId, role, uid, ownerUid, assignedUid } = parseMarkArgs(rawArgs);

  const rid = safeStr(requestId);
  const r = normalizeRole(role);
  const actorUid = safeStr(uid);
  if (!rid) throw new Error("unreadChat: requestId is required");
  if (!actorUid) throw new Error("unreadChat: uid is required");

  const ref = getReadStateDocRef({
    requestId: rid,
    role: r,
    uid: actorUid,
    ownerUid,
    assignedUid,
  });

  await setDoc(
    ref,
    {
      role: r,
      uid: actorUid,
      lastReadAt: serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true };
}

// Backwards compatibility for older callers while screens are migrated.
export const markRead = markChatRead;


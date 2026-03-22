import {
  collection,
  collectionGroup,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { getReadStateDocRef } from "../utils/unreadChat";
import { normalizeTextDeep } from "../utils/textNormalizer";
import { isUnsubmittedGhostRequest } from "../utils/requestGhosts";
import { safeText } from "../utils/safeText";
import { notifsV2Store } from "./notifsV2Store";
import { clearPushBridgeDedupe, scheduleForegroundLocalNotification } from "./pushBridge";

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
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

function parseRequestIdFromPendingDoc(snap) {
  try {
    return safeStr(snap?.ref?.parent?.parent?.id);
  } catch {
    return "";
  }
}

function notificationCollectionForRole(role, uid) {
  const safeRole = safeStr(role).toLowerCase();
  const safeUid = safeStr(uid);
  if (!safeUid) return null;
  if (safeRole === "user") return collection(db, "users", safeUid, "notifications");
  if (safeRole === "staff") return collection(db, "staff", safeUid, "notifications");
  if (safeRole === "admin" || safeRole === "assignedadmin") {
    return collection(db, "users", safeUid, "notifications");
  }
  return null;
}

function normalizeNotificationDoc(docSnap) {
  const data = normalizeTextDeep(docSnap.data() || {});
  return {
    id: docSnap.id,
    ...data,
    title: safeText(data?.title),
    body: safeText(data?.body),
    createdAtMs: tsToMs(data?.createdAt) || Number(data?.createdAtMs || 0) || 0,
  };
}

function createChatUnreadTracker({ requestId, role, uid }) {
  const rid = safeStr(requestId);
  const actorUid = safeStr(uid);
  const safeRole = safeStr(role).toLowerCase();
  if (!rid || !actorUid || (safeRole !== "user" && safeRole !== "staff")) {
    return { cleanup: () => {} };
  }

  let messageRows = [];
  let lastReadAtMs = 0;
  let unsubMessages = null;
  let unsubReadState = null;

  const recompute = () => {
    const latest = messageRows[0] || null;
    const latestMessageId = safeStr(latest?.id);
    const latestMessageAtMs = tsToMs(latest?.createdAt);
    const unreadCount = messageRows.reduce((sum, row) => {
      const atMs = tsToMs(row?.createdAt);
      const fromUid = safeStr(row?.fromUid);
      if (!atMs || fromUid === actorUid) return sum;
      return sum + (atMs > lastReadAtMs ? 1 : 0);
    }, 0);

    notifsV2Store.setUnreadForRequest(rid, {
      unread: unreadCount > 0,
      count: unreadCount,
      lastMessageAtMs: latestMessageAtMs,
      lastMessageId: latestMessageId,
    });
  };

  unsubMessages = onSnapshot(
    query(collection(db, "serviceRequests", rid, "messages"), orderBy("createdAt", "desc"), limit(80)),
    (snap) => {
      messageRows = snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));
      recompute();
    },
    (error) => {
      console.error("notifsV2Engine messages snapshot failed:", rid, error);
      messageRows = [];
      recompute();
    }
  );

  unsubReadState = onSnapshot(
    getReadStateDocRef({ requestId: rid, role: safeRole, uid: actorUid }),
    (snap) => {
      const data = snap.exists() ? snap.data() : null;
      lastReadAtMs = tsToMs(data?.lastReadAt);
      recompute();
    },
    (error) => {
      console.error("notifsV2Engine readState snapshot failed:", rid, error);
      lastReadAtMs = 0;
      recompute();
    }
  );

  return {
    cleanup() {
      try {
        unsubMessages?.();
      } catch {
        // ignore listener cleanup issues
      }
      try {
        unsubReadState?.();
      } catch {
        // ignore listener cleanup issues
      }
    },
  };
}

function createNotificationsListener({ role, uid }) {
  const colRef = notificationCollectionForRole(role, uid);
  if (!colRef) {
    notifsV2Store.setNotifications([]);
    return () => {};
  }

  let initialized = false;
  return onSnapshot(
    query(colRef, orderBy("createdAt", "desc"), limit(250)),
    (snap) => {
      const rows = snap.docs.map(normalizeNotificationDoc);
      notifsV2Store.setNotifications(rows);

      if (initialized) {
        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          const item = normalizeNotificationDoc(change.doc);
          if (!item || item.readAt) return;
          scheduleForegroundLocalNotification({
            dedupeKey: `notif:${item.id}`,
            title: item.title || "Notification",
            body: item.body || "You have an update.",
            route: item.route || "",
            extra: {
              id: item.id,
              type: item.type || "",
              requestId: item.requestId || "",
              route: item.route || "",
            },
          }).catch(() => {
            // ignore foreground notification scheduling failures
          });
        });
      } else {
        initialized = true;
      }
    },
    (error) => {
      console.error("notifsV2Engine notifications snapshot failed:", error);
      notifsV2Store.setNotifications([]);
    }
  );
}

function createAdminForegroundPushWatchers({ role, uid }) {
  const safeRole = safeStr(role).toLowerCase();
  const safeUid = safeStr(uid);
  const unsubs = [];
  const requestStateByKey = new Map();
  let requestsInitialized = false;
  let pendingInitialized = false;

  const isForegroundNotifiableRequest = (requestData) => {
    const data = normalizeTextDeep(requestData || {});
    const status = safeStr(data?.status).toLowerCase();
    if (!status || status === "payment_pending") return false;
    if (isUnsubmittedGhostRequest(data)) return false;
    return true;
  };

  const requestQueries = [];
  if (safeRole === "assignedadmin") {
    requestQueries.push(
      query(
        collection(db, "serviceRequests"),
        where("currentAdminUid", "==", safeUid),
        orderBy("createdAt", "desc"),
        limit(60)
      )
    );
    requestQueries.push(
      query(
        collection(db, "serviceRequests"),
        where("ownerLockedAdminUid", "==", safeUid),
        orderBy("createdAt", "desc"),
        limit(60)
      )
    );
  } else {
    requestQueries.push(query(collection(db, "serviceRequests"), orderBy("createdAt", "desc"), limit(60)));
  }

  requestQueries.forEach((qy, index) => {
    unsubs.push(
      onSnapshot(
        qy,
        (snap) => {
          if (!requestsInitialized) {
            snap.docs.forEach((docSnap) => {
              const rid = safeStr(docSnap.id);
              if (!rid) return;
              requestStateByKey.set(`${index}:${rid}`, {
                requestId: rid,
                notifiable: isForegroundNotifiableRequest(docSnap.data() || {}),
              });
            });
            if (index === requestQueries.length - 1) requestsInitialized = true;
            return;
          }

          snap.docChanges().forEach((change) => {
            const rid = safeStr(change.doc.id);
            const dedupeKey = `${index}:${rid}`;
            if (!rid) return;

            if (change.type === "removed") {
              requestStateByKey.delete(dedupeKey);
              return;
            }

            const nextNotifiable = isForegroundNotifiableRequest(change.doc.data() || {});
            const previous = requestStateByKey.get(dedupeKey) || null;
            requestStateByKey.set(dedupeKey, { requestId: rid, notifiable: nextNotifiable });

            const shouldNotify =
              nextNotifiable &&
              (change.type === "added" || (change.type === "modified" && previous?.notifiable !== true));

            if (!shouldNotify) return;

            scheduleForegroundLocalNotification({
              dedupeKey: `admin:new_request:${rid}`,
              title: "New request",
              body: "A new service request was submitted.",
              route: `/app/admin/request/${encodeURIComponent(rid)}`,
              extra: { type: "NEW_REQUEST", requestId: rid },
            }).catch(() => {
              // ignore foreground notification scheduling failures
            });
          });
        },
        (error) => {
          console.error("notifsV2Engine admin request watcher failed:", error);
        }
      )
    );
  });

  if (safeRole === "admin") {
    unsubs.push(
      onSnapshot(
        query(collectionGroup(db, "pendingMessages"), where("status", "==", "pending")),
        (snap) => {
          if (pendingInitialized) {
            snap.docChanges().forEach((change) => {
              if (change.type !== "added") return;
              const rid = parseRequestIdFromPendingDoc(change.doc);
              const mid = safeStr(change.doc.id);
              if (!rid || !mid) return;
              scheduleForegroundLocalNotification({
                dedupeKey: `admin:pending:${rid}:${mid}`,
                title: "New message for moderation",
                body: "A user or staff message is waiting for admin review.",
                route: `/app/admin/request/${encodeURIComponent(rid)}?openChat=1`,
                extra: { type: "ADMIN_NEW_MESSAGE", requestId: rid, pendingId: mid },
              }).catch(() => {
                // ignore foreground notification scheduling failures
              });
            });
          } else {
            pendingInitialized = true;
          }
        },
        (error) => {
          console.error("notifsV2Engine admin pendingMessages watcher failed:", error);
        }
      )
    );
  }

  return () => {
    unsubs.forEach((fn) => {
      try {
        fn?.();
      } catch {
        // ignore watcher cleanup issues
      }
    });
  };
}

let activeEngineCleanup = null;

export function stopNotifsV2Engine() {
  try {
    activeEngineCleanup?.();
  } catch {
    // ignore engine cleanup issues
  }
  activeEngineCleanup = null;
  clearPushBridgeDedupe();
  notifsV2Store.reset();
}

export function startNotifsV2Engine({ role, uid }) {
  stopNotifsV2Engine();

  const safeRole = safeStr(role).toLowerCase();
  const safeUid = safeStr(uid);
  if (!safeUid || !["user", "staff", "admin", "assignedadmin"].includes(safeRole)) {
    return () => {};
  }

  notifsV2Store.setSession({ role: safeRole, uid: safeUid });

  let rootUnsub = null;
  let notificationsUnsub = null;
  let adminPushCleanup = null;
  const requestTrackers = new Map();

  const syncRequestTrackers = (requestIds) => {
    const ids = Array.from(new Set((requestIds || []).map((x) => safeStr(x)).filter(Boolean)));
    const allowed = new Set(ids);

    Array.from(requestTrackers.keys()).forEach((rid) => {
      if (allowed.has(rid)) return;
      try {
        requestTrackers.get(rid)?.cleanup?.();
      } catch {
        // ignore tracker cleanup issues
      }
      requestTrackers.delete(rid);
      notifsV2Store.setUnreadForRequest(rid, {
        unread: false,
        count: 0,
        lastMessageId: "",
        lastMessageAtMs: 0,
      });
    });

    ids.forEach((rid) => {
      if (requestTrackers.has(rid)) return;
      requestTrackers.set(rid, createChatUnreadTracker({ requestId: rid, role: safeRole, uid: safeUid }));
    });

    notifsV2Store.pruneUnreadRequests(ids);
  };

  notificationsUnsub = createNotificationsListener({ role: safeRole, uid: safeUid });

  if (safeRole === "user") {
    rootUnsub = onSnapshot(
      query(collection(db, "serviceRequests"), where("uid", "==", safeUid)),
      (snap) => {
        const ids = snap.docs.map((d) => safeStr(d.id)).filter(Boolean);
        syncRequestTrackers(ids);
      },
      (error) => {
        console.error("notifsV2Engine user requests snapshot failed:", error);
        syncRequestTrackers([]);
      }
    );
  } else if (safeRole === "staff") {
    rootUnsub = onSnapshot(
      query(collection(db, "staff", safeUid, "tasks"), orderBy("assignedAt", "desc")),
      (snap) => {
        const ids = snap.docs.map((d) => safeStr(d.data()?.requestId || d.id)).filter(Boolean);
        syncRequestTrackers(ids);
      },
      (error) => {
        console.error("notifsV2Engine staff tasks snapshot failed:", error);
        syncRequestTrackers([]);
      }
    );
  } else {
    adminPushCleanup = createAdminForegroundPushWatchers({ role: safeRole, uid: safeUid });
    notifsV2Store.pruneUnreadRequests(
      (notifsV2Store.getState().notifications || [])
        .map((row) => safeStr(row.requestId))
        .filter(Boolean)
    );
  }

  const cleanup = () => {
    try {
      rootUnsub?.();
    } catch {
      // ignore root listener cleanup issues
    }
    try {
      notificationsUnsub?.();
    } catch {
      // ignore notification listener cleanup issues
    }
    try {
      adminPushCleanup?.();
    } catch {
      // ignore admin watcher cleanup issues
    }
    Array.from(requestTrackers.values()).forEach((tracker) => {
      try {
        tracker?.cleanup?.();
      } catch {
        // ignore tracker cleanup issues
      }
    });
    requestTrackers.clear();
  };

  activeEngineCleanup = cleanup;
  return () => {
    if (activeEngineCleanup === cleanup) {
      stopNotifsV2Engine();
    } else {
      cleanup();
    }
  };
}

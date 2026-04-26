// src/components/AdminRequestChatPanel.jsx
// FIX:
// White screen was caused by missing Firestore import: `collection`
//    You call collection(...) but it wasn't imported, so runtime crashed.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  onSnapshot,
  orderBy,
  query,
  where,
  doc,
  collection, // required (was missing)
} from "firebase/firestore";
import { db } from "../firebase";
import {
  adminApprovePendingMessage,
  adminHidePendingMessage,
  adminSendBundleDirect,
  adminSendTextDirect,
  adminSendAttachmentDirect,
} from "../services/chatservice";
import { CHAT_ATTACHMENT_OPTIONS, prepareChatAttachmentFromFile } from "../services/chatAttachmentService";
import {
  getRequestChatAvailability,
  loadChatCollectionCache,
  saveChatCollectionCache,
} from "../services/chatUiService";
import { openFileReference } from "../services/fileOpenService";
import useKeyboardInset from "../hooks/useKeyboardInset";
import { normalizeTextDeep } from "../utils/textNormalizer";
import { getSystemChatMessageLabel, isSystemChatMessage } from "../utils/chatSystemMessages";
import { safeText } from "../utils/safeText";
import { buildParticipantSummary } from "../services/chatParticipantService";
import FileAccessImage from "./FileAccessImage";
import FileAccessLink from "./FileAccessLink";

/* ---------------- helpers ---------------- */
function safeStr(x) {
  return String(x || "").trim();
}

const CHAT_HANDOFF_DELAY_MS = 360;

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function messageCreatedAtMs(docu) {
  return (
    Number(docu?._localCreatedAtMs || 0) ||
    tsToMillis(pickCreatedAt(docu)) ||
    tsToMillis(docu?.createdAt)
  );
}

function formatTime(ts) {
  const ms = tsToMillis(ts);
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayKeyFromMs(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDayLabel(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startToday - startDay) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function pickCreatedAt(docu) {
  return docu?.createdAt || docu?.approvedAt || docu?.editedAt || docu?.rejectedAt || null;
}

function msgPreview(m) {
  const type = String(m?.type || "text").toLowerCase();
  const attachment = m?.attachmentMeta || m?.pdfMeta || null;
  const attachmentKind = String(attachment?.attachmentKind || "").toLowerCase();
  const attachmentLabel =
    type === "photo" || type === "image" || attachmentKind === "photo" || attachmentKind === "image"
      ? "Photo"
      : "Document";
  if (type === "document" || type === "pdf" || type === "image" || type === "photo") {
    return `${attachmentLabel}: ${safeText(attachment?.name) || "attachment"}`;
  }
  if (type === "bundle") {
    const text = safeText(m?.text);
    const fileName = safeText(attachment?.name);
    if (text && fileName) return `${text}\n${attachmentLabel}: ${fileName}`;
    if (fileName) return `${attachmentLabel}: ${fileName}`;
    return text;
  }
  return safeText(m?.text || "");
}

/* Autosize textarea like ChatGPT */
function useAutosizeTextArea(textareaRef, value, { maxRows = 6 } = {}) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight || "20") || 20;
    const paddingTop = parseFloat(computed.paddingTop || "0") || 0;
    const paddingBottom = parseFloat(computed.paddingBottom || "0") || 0;
    const maxHeight = maxRows * lineHeight + paddingTop + paddingBottom;

    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ?"auto" : "hidden";
  }, [textareaRef, value, maxRows]);
}

/* UI-only merge rule for adjacent pdf+text */
function shouldMergePair(a, b, WINDOW_MS) {
  if (!a || !b || !WINDOW_MS) return false;
  // Keep timeline stable and avoid UI jumps after sends.
  return false;
}

function makeBundleView(first, second) {
  const aType = String(first?.type || "text").toLowerCase();
  const textMsg = aType === "text" ?first : second;
  const pdfMsg = aType === "pdf" ?first : second;

  const st1 = String(first?.status || "").toLowerCase();
  const st2 = String(second?.status || "").toLowerCase();

  let status = "delivered";
  if (st1 === "pending" || st2 === "pending") status = "pending";
  if (st1 === "rejected" || st2 === "rejected") status = "rejected";

  return {
    type: "bundle_view",
    fromRole: first?.fromRole,
    fromUid: first?.fromUid,
    toRole: first?.toRole,
    text: safeStr(textMsg?.text),
    pdfMeta: pdfMsg?.pdfMeta || null,
    status,
    _createdAtMs: Math.min(first?._createdAtMs || 0, second?._createdAtMs || 0),
  };
}

/* ---------------- icons ---------------- */
function IconChat(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 18.2l-3 2V6.8A3 3 0 0 1 7 3.8h10A3 3 0 0 1 20 6.8v7.4a3 3 0 0 1-3 3H7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.8 8.7h8.4M7.8 12h5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSend(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 19V6.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6.8 12 12 6.8 17.2 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusTicks({ status }) {
  const s = String(status || "").toLowerCase();
  const delivered = s === "delivered";
  if (!delivered) {
    return (
      <span
        className="inline-flex min-w-[18px] items-center justify-end text-white/75"
        title="Sending"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-[18px] items-center justify-end text-emerald-300" title="Read">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="-mr-1 h-3.5 w-3.5">
        <path d="M2.5 8.5 5.7 11.3 13.2 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M2.5 8.5 5.7 11.3 13.2 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function IconPlus(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- component ---------------- */
export default function AdminRequestChatPanel({ requestId, onClose }) {
  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const pendingCacheScope = useMemo(() => "admin:pending", []);
  const publishedCacheScope = useMemo(() => "admin:published", []);
  const cachedPending = useMemo(
    () => loadChatCollectionCache({ requestId: rid, scope: pendingCacheScope, kind: "pending" }),
    [rid, pendingCacheScope]
  );
  const cachedPublished = useMemo(
    () => loadChatCollectionCache({ requestId: rid, scope: publishedCacheScope, kind: "published" }),
    [rid, publishedCacheScope]
  );

  const [pending, setPending] = useState(() => cachedPending);
  const [published, setPublished] = useState(() => cachedPublished);
  const [requestRow, setRequestRow] = useState(null);
  const [handoffNow, setHandoffNow] = useState(() => Date.now());

  const [busyKey, setBusyKey] = useState(""); // message id or bundle id
  const [err, setErr] = useState("");

  const [headerUser, setHeaderUser] = useState(() => ({
    uid: "",
    name: "User",
    online: false,
    statusLabel: "Offline",
    lastSeenAtMs: 0,
  }));
  const [headerStaff, setHeaderStaff] = useState(() => ({
    uid: "",
    name: "Staff pending assignment",
    online: false,
    statusLabel: "Offline",
    lastSeenAtMs: 0,
  }));

  // Hide removes message instantly (optimistic)
  const [optimisticHidden, setOptimisticHidden] = useState(() => new Set());

  // Accept removes buttons instantly and never rolls back
  const [optimisticNoActions, setOptimisticNoActions] = useState(() => new Set());

  // admin composer
  const [sendTo, setSendTo] = useState("user"); // user | staff
  const [text, setText] = useState("");
  const [pickedPdf, setPickedPdf] = useState(null); // attachment meta
  const [pickerMode, setPickerMode] = useState("document");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentPreparing, setAttachmentPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

  const fileInputRef = useRef(null);
  const attachMenuRef = useRef(null);
  const threadRef = useRef(null);
  const composerRef = useRef(null);
  const pendingObservedAtRef = useRef(new Map());
  const publishedObservedAtRef = useRef(new Map());
  const publishedByPendingSeenAtRef = useRef(new Map());
  const keyboardInset = useKeyboardInset(true);

  const taRef = useRef(null);
  useAutosizeTextArea(taRef, text, { maxRows: 6 });
  const chatAvailability = useMemo(
    () => getRequestChatAvailability(requestRow || {}, { role: "admin" }),
    [requestRow]
  );
  const chatEnabled = chatAvailability.enabled;

  /* ---------- persist no-actions so buttons never return on remount ---------- */
  const noActionsKey = useMemo(() => (rid ?`adminChat_noActions_${rid}` : ""), [rid]);

  useEffect(() => {
    if (!noActionsKey) return;
    try {
      const raw = sessionStorage.getItem(noActionsKey);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      setOptimisticNoActions(new Set(arr.map((x) => String(x))));
    } catch {
      // ignore session storage parse issues
    }
  }, [noActionsKey]);

  useEffect(() => {
    if (!noActionsKey) return;
    try {
      sessionStorage.setItem(noActionsKey, JSON.stringify([...optimisticNoActions]));
    } catch {
      // ignore session storage write issues
    }
  }, [noActionsKey, optimisticNoActions]);

  useEffect(() => {
    if (!rid) return;
    saveChatCollectionCache({
      requestId: rid,
      scope: pendingCacheScope,
      kind: "pending",
      rows: pending,
    });
  }, [rid, pendingCacheScope, pending]);

  useEffect(() => {
    if (!rid) return;
    saveChatCollectionCache({
      requestId: rid,
      scope: publishedCacheScope,
      kind: "published",
      rows: published,
    });
  }, [rid, publishedCacheScope, published]);

  /* ---------- scroll helper ---------- */
  const scrollToBottom = () => {
    const el = threadRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      });
    });
  };

  /* ---------- NEW: watch request assignment ---------- */
  useEffect(() => {
    if (!rid) return undefined;
    let unsubUser = () => {};
    let unsubStaff = () => {};

    const reqRef = doc(db, "serviceRequests", rid);
    const unsub = onSnapshot(
      reqRef,
      (snap) => {
        const d = snap.exists() ? snap.data() || {} : {};
        setRequestRow(d);
        const staffUid = String(
          d?.assignedTo ||
            d?.assignedStaffUid ||
            d?.assignedToUid ||
            d?.staffUid ||
            d?.staffAssignedUid ||
            ""
        ).trim();
        const ownerUid = String(d?.uid || "").trim();
        const ownerFallback = String(d?.applicantName || d?.name || "").trim();
        const staffFallback = String(d?.assignedStaffName || d?.assignedStaffEmail || "").trim();

        try {
          unsubUser?.();
        } catch {
          // ignore listener cleanup issues
        }
        unsubUser = () => {};
        if (ownerUid) {
          unsubUser = onSnapshot(
            doc(db, "users", ownerUid),
            (userSnap) => {
              setHeaderUser(
                buildParticipantSummary({
                  uid: ownerUid,
                  row: userSnap.exists() ? userSnap.data() || {} : {},
                  fallbackLabel: ownerFallback || `User ${ownerUid.slice(0, 6)}`,
                })
              );
            },
            () => {
              setHeaderUser({
                uid: ownerUid,
                name: ownerFallback || `User ${ownerUid.slice(0, 6)}`,
                online: false,
                statusLabel: "Offline",
                lastSeenAtMs: 0,
              });
            }
          );
        } else {
          setHeaderUser({
            uid: "",
            name: ownerFallback || "User",
            online: false,
            statusLabel: "Offline",
            lastSeenAtMs: 0,
          });
        }

        try {
          unsubStaff?.();
        } catch {
          // ignore listener cleanup issues
        }
        unsubStaff = () => {};
        if (staffUid) {
          unsubStaff = onSnapshot(
            doc(db, "staff", staffUid),
            (staffSnap) => {
              setHeaderStaff(
                buildParticipantSummary({
                  uid: staffUid,
                  row: staffSnap.exists() ? staffSnap.data() || {} : {},
                  fallbackLabel: staffFallback || `Staff ${staffUid.slice(0, 6)}`,
                })
              );
            },
            () => {
              setHeaderStaff({
                uid: staffUid,
                name: staffFallback || `Staff ${staffUid.slice(0, 6)}`,
                online: false,
                statusLabel: "Offline",
                lastSeenAtMs: 0,
              });
            }
          );
        } else {
          setHeaderStaff({
            uid: "",
            name: "Staff pending assignment",
            online: false,
            statusLabel: "Offline",
            lastSeenAtMs: 0,
          });
        }
      },
      () => {
        setRequestRow(null);
        setHeaderUser({
          uid: "",
          name: "User",
          online: false,
          statusLabel: "Offline",
          lastSeenAtMs: 0,
        });
        setHeaderStaff({
          uid: "",
          name: "Staff pending assignment",
          online: false,
          statusLabel: "Offline",
          lastSeenAtMs: 0,
        });
      }
    );

    return () => {
      try {
        unsub?.();
      } catch {
        // ignore listener cleanup issues
      }
      try {
        unsubUser?.();
      } catch {
        // ignore listener cleanup issues
      }
      try {
        unsubStaff?.();
      } catch {
        // ignore listener cleanup issues
      }
    };
  }, [rid]);

  /* ---------- listeners ---------- */
  useEffect(() => {
    if (!rid) return;

    const ref = collection(db, "serviceRequests", rid, "pendingMessages");
    const qy = query(ref, where("status", "==", "pending"), orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const liveIds = new Set();
        const rows = snap.docs.map((d) => {
          const row = normalizeTextDeep({ id: d.id, ...d.data() });
          const id = safeStr(row?.id || d.id);
          const fromServerMs = tsToMillis(pickCreatedAt(row));
          const knownMs = pendingObservedAtRef.current.get(id);
          const localObservedMs = knownMs || fromServerMs || Date.now();
          pendingObservedAtRef.current.set(id, localObservedMs);
          liveIds.add(id);
          return { ...row, _localCreatedAtMs: localObservedMs };
        });

        for (const id of pendingObservedAtRef.current.keys()) {
          if (!liveIds.has(id)) pendingObservedAtRef.current.delete(id);
        }

        rows.sort((a, b) => messageCreatedAtMs(a) - messageCreatedAtMs(b));
        setPending(rows);
        setErr("");
      },
      (e) => {
        console.error("pendingMessages snapshot:", e);
        setErr(e?.message || "Failed to load pending messages.");
      }
    );

    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;

    const ref = collection(db, "serviceRequests", rid, "messages");
    const qy = query(ref, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const liveIds = new Set();
        const rows = snap.docs.map((d) => {
          const row = normalizeTextDeep({ id: d.id, ...d.data() });
          const id = safeStr(row?.id || d.id);
          const fromServerMs = tsToMillis(pickCreatedAt(row));
          const knownMs = publishedObservedAtRef.current.get(id);
          const localObservedMs = knownMs || fromServerMs || Date.now();
          publishedObservedAtRef.current.set(id, localObservedMs);
          liveIds.add(id);
          return { ...row, _localCreatedAtMs: localObservedMs };
        });

        for (const id of publishedObservedAtRef.current.keys()) {
          if (!liveIds.has(id)) publishedObservedAtRef.current.delete(id);
        }

        rows.sort((a, b) => messageCreatedAtMs(a) - messageCreatedAtMs(b));
        setPublished(rows);
        setErr("");
      },
      (e) => {
        console.error("messages snapshot:", e);
        setErr(e?.message || "Failed to load messages.");
      }
    );

    return () => unsub();
  }, [rid]);

  useEffect(() => {
    const now = Date.now();
    const livePublishedPendingIds = new Set();
    const visiblePendingIds = new Set(
      pending
        .filter((p) => !optimisticHidden.has(p?.id))
        .map((p) => safeStr(p?.id))
        .filter(Boolean)
    );

    published.forEach((m) => {
      const pendingId = safeStr(m?.sourcePendingId);
      if (!pendingId) return;
      livePublishedPendingIds.add(pendingId);
      if (!publishedByPendingSeenAtRef.current.has(pendingId)) {
        publishedByPendingSeenAtRef.current.set(pendingId, now);
      }
    });

    for (const pendingId of publishedByPendingSeenAtRef.current.keys()) {
      if (!livePublishedPendingIds.has(pendingId)) {
        publishedByPendingSeenAtRef.current.delete(pendingId);
      }
    }

    const dueIn = [];
    livePublishedPendingIds.forEach((pendingId) => {
      if (!visiblePendingIds.has(pendingId)) return;
      const seenAt = publishedByPendingSeenAtRef.current.get(pendingId) || now;
      const leftMs = seenAt + CHAT_HANDOFF_DELAY_MS - now;
      if (leftMs > 0) dueIn.push(leftMs);
    });

    if (!dueIn.length) return undefined;

    const timer = window.setTimeout(() => {
      setHandoffNow(Date.now());
    }, Math.max(30, Math.min(...dueIn)));

    return () => window.clearTimeout(timer);
  }, [pending, published, optimisticHidden]);

  /* ---------- build timeline (UI merge) ---------- */
  const timeline = useMemo(() => {
    const hidden = optimisticHidden;
    const visiblePending = pending.filter((p) => !hidden.has(p.id));
    const pendingById = new Map(
      visiblePending.map((p) => [safeStr(p?.id), p]).filter((entry) => entry[0])
    );
    const publishedByPendingId = new Map();
    published.forEach((m) => {
      const pendingId = safeStr(m?.sourcePendingId);
      if (!pendingId) return;
      publishedByPendingId.set(pendingId, m);
    });

    const pendingItemsRaw = visiblePending
      .filter((p) => {
        const pendingId = safeStr(p?.id);
        if (!publishedByPendingId.has(pendingId)) return true;

        const seenAt = publishedByPendingSeenAtRef.current.get(pendingId) || 0;
        if (!seenAt) return true;
        return handoffNow - seenAt < CHAT_HANDOFF_DELAY_MS;
      })
      .map((p) => ({
        _kind: "pending",
        _uiId: publishedByPendingId.has(safeStr(p?.id)) ? `handoff_${p.id}` : `p_${p.id}`,
        _createdAtMs: messageCreatedAtMs(p),
        status: "pending",
        ...p,
      }));

    const publishedItemsRaw = published
      .filter((m) => {
        const pendingId = safeStr(m?.sourcePendingId);
        if (!pendingId) return true;
        if (!pendingById.has(pendingId)) return true;

        const seenAt = publishedByPendingSeenAtRef.current.get(pendingId) || 0;
        if (!seenAt) return false;
        return handoffNow - seenAt >= CHAT_HANDOFF_DELAY_MS;
      })
      .map((m) => {
        const pendingId = safeStr(m?.sourcePendingId);
        return {
          _kind: "published",
          _uiId: pendingId ? `handoff_${pendingId}` : `m_${m.id}`,
          _createdAtMs: messageCreatedAtMs(m),
          status: "delivered",
          ...m,
        };
      });

    const allRaw = [...publishedItemsRaw, ...pendingItemsRaw].sort(
      (a, b) => (a._createdAtMs || 0) - (b._createdAtMs || 0)
    );

    const WINDOW_MS = 1200;
    const out = [];

    for (let i = 0; i < allRaw.length; i++) {
      const cur = allRaw[i];
      const next = allRaw[i + 1];

      if (shouldMergePair(cur, next, WINDOW_MS)) {
        const bundle = makeBundleView(cur, next);
        const pendingChildren = [cur, next].filter((x) => x._kind === "pending");

        out.push({
          _kind: "bundle_view",
          id: `b_${cur._uiId}_${next._uiId}`,
          createdAtMs: bundle._createdAtMs,
          data: bundle,
          _pendingChildren: pendingChildren,
        });

        i++;
        continue;
      }

      out.push({
        _kind: cur._kind,
        id: cur._uiId,
        createdAtMs: cur._createdAtMs,
        data: cur,
      });
    }

    return out;
  }, [pending, published, optimisticHidden, handoffNow]);

  const timelineRows = useMemo(() => {
    const rows = [];
    let prevDay = "";
    timeline.forEach((item) => {
      const dayKey = dayKeyFromMs(item?.createdAtMs || 0);
      if (dayKey && dayKey !== prevDay) {
        rows.push({
          _kind: "day",
          id: `d_${dayKey}_${item.id}`,
          label: formatDayLabel(item?.createdAtMs || 0),
        });
        prevDay = dayKey;
      }
      rows.push({ _kind: "msg", id: item.id, item });
    });
    return rows;
  }, [timeline]);

  useEffect(() => {
    scrollToBottom();
  }, [timeline.length, err]);

  useEffect(() => {
    if (!attachmentMenuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!attachMenuRef.current) return;
      if (!attachMenuRef.current.contains(event.target)) {
        setAttachmentMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [attachmentMenuOpen]);

  useEffect(() => {
    if (!composerFocused && !keyboardInset) return;
    const timer = window.setTimeout(() => {
      scrollToBottom();
    }, 48);
    return () => window.clearTimeout(timer);
  }, [composerFocused, keyboardInset, timeline.length]);

  /* ---------- optimistic helpers ---------- */
  const hidePendingOptimistic = (pendingId) => {
    setOptimisticHidden((prev) => {
      const next = new Set(prev);
      next.add(pendingId);
      return next;
    });
  };

  const disableActionsOptimistic = (pendingId) => {
    setOptimisticNoActions((prev) => {
      const next = new Set(prev);
      next.add(pendingId);
      return next;
    });
  };

  /* ---------- actions ---------- */
  const approveBundle = async (bundleId, pendingChildren) => {
    setErr("");
    if (!pendingChildren?.length) return;

    setBusyKey(bundleId);

    // Accept: hide buttons immediately and permanently
    pendingChildren.forEach((c) => disableActionsOptimistic(c.id));

    try {
      for (const c of pendingChildren) {
        await adminApprovePendingMessage({ requestId: rid, pendingId: c.id });
      }
    } catch (e) {
      console.error(e);
      // Do not roll back button hide
      setErr(e?.message || "Approve failed (buttons will stay hidden).");
    } finally {
      setBusyKey("");
    }
  };

  const hideBundle = async (bundleId, pendingChildren) => {
    setErr("");
    if (!pendingChildren?.length) return;

    setBusyKey(bundleId);

    // Hide: remove bubble instantly
    pendingChildren.forEach((c) => hidePendingOptimistic(c.id));

    try {
      for (const c of pendingChildren) {
        await adminHidePendingMessage({ requestId: rid, pendingId: c.id });
      }
    } catch (e) {
      console.error(e);
      // rollback hide if failed
      setOptimisticHidden((prev) => {
        const next = new Set(prev);
        pendingChildren.forEach((c) => next.delete(c.id));
        return next;
      });
      setErr(e?.message || "Hide failed.");
    } finally {
      setBusyKey("");
    }
  };

  const approveSingle = async (p) => {
    setErr("");
    setBusyKey(p.id);

    // Accept: hide buttons immediately and permanently
    disableActionsOptimistic(p.id);

    try {
      await adminApprovePendingMessage({ requestId: rid, pendingId: p.id });
    } catch (e) {
      console.error(e);
      // Do not roll back button hide
      setErr(e?.message || "Approve failed (buttons will stay hidden).");
    } finally {
      setBusyKey("");
    }
  };

  const hideSingle = async (p) => {
    setErr("");
    setBusyKey(p.id);

    hidePendingOptimistic(p.id);

    try {
      await adminHidePendingMessage({ requestId: rid, pendingId: p.id });
    } catch (e) {
      console.error(e);
      // rollback hide if failed
      setOptimisticHidden((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      setErr(e?.message || "Hide failed.");
    } finally {
      setBusyKey("");
    }
  };

  /* ---------- admin direct send ---------- */
  const openPicker = (mode = "document") => {
    if (!chatEnabled) {
      setErr(chatAvailability.message || "Chat is not active yet.");
      return;
    }
    setPickerMode(mode);
    setAttachmentMenuOpen(false);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
  };
  const keepComposerFocusOnAction = (event) => {
    event.preventDefault();
  };

  const onPickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setAttachmentPreparing(true);
    try {
      const prepared = await prepareChatAttachmentFromFile({
        file: f,
        mode: pickerMode,
      });
      setPickedPdf(prepared);
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to prepare attachment.");
    } finally {
      setAttachmentPreparing(false);
    }
  };

  const canSend = chatEnabled && Boolean(safeStr(text) || pickedPdf) && !attachmentPreparing;

  const buildAttachmentCardProps = (attachment, isImageAttachment) => {
    if (!attachment?.name || isImageAttachment) return {};
    return {
      role: "button",
      tabIndex: 0,
      onClick: () => void openFileReference(attachment),
      onKeyDown: (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void openFileReference(attachment);
      },
    };
  };

  const sendNow = async () => {
    setErr("");
    const t = safeStr(text);
    const pdf = pickedPdf;
    if (!rid) return;
    if (!t && !pdf) return;
    if (!chatEnabled) {
      setErr(chatAvailability.message || "Chat is not active yet.");
      return;
    }

    setSending(true);
    try {
      if (pdf && t) {
        await adminSendBundleDirect({
          requestId: rid,
          toRole: sendTo,
          text: t,
          pdfMeta: pdf,
        });
      } else if (pdf) {
        await adminSendAttachmentDirect({
          requestId: rid,
          toRole: sendTo,
          attachmentMeta: pdf,
          typeHint: pdf?.attachmentKind || "document",
        });
      } else if (t) {
        await adminSendTextDirect({ requestId: rid, toRole: sendTo, text: t });
      }

      setText("");
      setPickedPdf(null);

      if (taRef.current) {
        taRef.current.style.height = "auto";
        taRef.current.style.overflowY = "hidden";
      }

      scrollToBottom();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Send failed.");
    } finally {
      setSending(false);
    }
  };

  /* ---------- UI ---------- */
  const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap";
  const bubbleLeft =
    "bg-white dark:bg-zinc-900/70 text-zinc-900 dark:text-zinc-100 border border-zinc-200/90 dark:border-zinc-800";
  const bubbleRight = "bg-emerald-600 text-white shadow-[0_10px_18px_rgba(5,150,105,0.2)]";

  const smallBtn =
    "inline-flex items-center justify-center rounded-xl border px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-60";
  const sendBtnTone = canSend
    ?"bg-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.22)] hover:bg-emerald-700"
    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  const activePicker = CHAT_ATTACHMENT_OPTIONS[pickerMode] || CHAT_ATTACHMENT_OPTIONS.document;

  return (
    <div
      className="fixed inset-0 z-[999999] flex flex-col bg-white dark:bg-zinc-950"
      style={{ paddingLeft: "var(--app-safe-left)", paddingRight: "var(--app-safe-right)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 pb-2.5 pt-[calc(var(--app-safe-top)+0.6rem)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70">
            <IconChat className="h-5 w-5 text-emerald-800" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Request Chat</div>
            <div className="text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                User: {safeText(headerUser?.name || "User")}
              </span>
              <span className={`ml-2 font-semibold ${headerUser?.online ? "text-emerald-600" : "text-zinc-500"}`}>
                {headerUser?.statusLabel || "Offline"}
              </span>
            </div>
            <div className="text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                Staff: {safeText(headerStaff?.name || "Staff pending assignment")}
              </span>
              <span className={`ml-2 font-semibold ${headerStaff?.online ? "text-emerald-600" : "text-zinc-500"}`}>
                {headerStaff?.statusLabel || "Offline"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
            Pending: {pending.length}
          </span>
          {onClose ?(
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300"
              title="Close"
            >
              x
            </button>
          ) : null}
        </div>
      </div>

      {err ?(
        <div className="px-3 pt-2">
          <div className="rounded-xl border border-rose-100 bg-rose-50/80 px-3 py-2 text-xs text-rose-700">
            {err}
          </div>
        </div>
      ) : null}
      {!chatEnabled ?(
        <div className="px-3 pt-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50/85 px-3 py-2 text-xs text-amber-900">
            {chatAvailability.message}
          </div>
        </div>
      ) : null}

      <div ref={threadRef} className="flex-1 overflow-y-auto px-3 py-2">
        {timelineRows.length === 0 ?(
          <div className="px-1 py-2 text-sm text-zinc-600 dark:text-zinc-300">No messages yet.</div>
        ) : (
          <div className="grid gap-2">
            {timelineRows.map((row) => {
              if (row._kind === "day") {
                return (
                  <div key={row.id} className="flex justify-center py-1">
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                      {row.label}
                    </span>
                  </div>
                );
              }

              const item = row.item;
              const m = item.data || {};
              if (isSystemChatMessage(m)) {
                return (
                  <div key={item.id} className="flex justify-center py-1.5">
                    <div className="flex w-full items-center gap-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                      <span>{getSystemChatMessageLabel(m, "admin")}</span>
                      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                    </div>
                  </div>
                );
              }

              const fromRole = String(m.fromRole || "").toLowerCase();
              const isLeft = fromRole === "user";
              const bubbleCls = isLeft ?bubbleLeft : bubbleRight;
              const time = formatTime(pickCreatedAt(m) || m?._localCreatedAtMs || item.createdAtMs || 0);

              const isBundleView =
                item._kind === "bundle_view" ||
                String(m.type || "").toLowerCase() === "bundle_view" ||
                String(m.type || "").toLowerCase() === "bundle";

              const pendingChildren = isBundleView ?item._pendingChildren || [] : [];
              const isPending = item._kind === "pending" || (isBundleView && pendingChildren.length > 0);

              const originOk = fromRole === "user" || fromRole === "staff";
              const bundleHasActionable =
                isBundleView && pendingChildren.some((c) => !optimisticNoActions.has(c.id));

              const showActions =
                originOk &&
                ((item._kind === "pending" && !optimisticNoActions.has(m.id)) ||
                  (isBundleView && bundleHasActionable));

              const busy = busyKey === m.id || busyKey === item.id;
              const status = item._kind === "published" ?"delivered" : String(m.status || "pending").toLowerCase();
              const attachment = m?.attachmentMeta || m?.pdfMeta || null;
              const attachmentKind = String(attachment?.attachmentKind || "").toLowerCase();
              const attachmentLabel =
                attachmentKind === "photo" || attachmentKind === "image" ? "Photo" : "Document";
              const isImageAttachment =
                attachmentKind === "photo" ||
                attachmentKind === "image" ||
                String(attachment?.mime || attachment?.contentType || "").toLowerCase().startsWith("image/");
              const isAttachmentOnly =
                String(m?.type || "").toLowerCase() === "document" ||
                String(m?.type || "").toLowerCase() === "pdf" ||
                String(m?.type || "").toLowerCase() === "image" ||
                String(m?.type || "").toLowerCase() === "photo";

              return (
                <div key={item.id} className={`chat-bubble-in flex ${isLeft ?"justify-start" : "justify-end"}`}>
                  <div className={`${bubbleBase} ${bubbleCls}`}>
                    {isBundleView ?(
                      <div className="mt-1 grid gap-2">
                        {safeStr(m.text) ?<div className="break-words">{safeText(m.text)}</div> : null}

                        {attachment?.name ?(
                          <div
                            className={`${
                              isLeft
                                ?"bg-zinc-50 dark:bg-zinc-950"
                                : "bg-white/10 dark:bg-zinc-900/60"
                            } rounded-xl p-2 ${!isImageAttachment ? "cursor-pointer" : ""}`}
                            {...buildAttachmentCardProps(attachment, isImageAttachment)}
                          >
                            <div className="text-xs font-semibold opacity-90">{attachmentLabel}</div>
                            {isImageAttachment ?(
                              <FileAccessImage
                                file={attachment}
                                alt={safeText(attachment?.name) || "attachment"}
                                className="mt-1.5 max-h-52 w-full rounded-lg object-cover"
                                openOnClick
                              />
                            ) : null}
                            <div className="text-xs opacity-90">
                              {safeText(attachment?.name) || "attachment"}
                              {attachment?.size ?` - ${attachment.size} bytes` : ""}
                            </div>
                            {attachment?.name ?(
                              <FileAccessLink
                                file={attachment}
                                className="mt-1 inline-flex text-[11px] font-semibold underline underline-offset-2"
                              >
                                Open attachment
                              </FileAccessLink>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : isAttachmentOnly ?(
                      <div
                        className={`mt-1 grid gap-1.5 ${!isImageAttachment ? "cursor-pointer" : ""}`}
                        {...buildAttachmentCardProps(attachment, isImageAttachment)}
                      >
                        <div className="text-xs font-semibold opacity-90">{attachmentLabel}</div>
                        {isImageAttachment ?(
                          <FileAccessImage
                            file={attachment}
                            alt={safeText(attachment?.name) || "attachment"}
                            className="max-h-56 w-full rounded-lg object-cover"
                            openOnClick
                          />
                        ) : null}
                        <div className="text-xs opacity-90">
                          {safeText(attachment?.name) || "attachment"}
                          {attachment?.size ?` - ${attachment.size} bytes` : ""}
                        </div>
                        {attachment?.name ?(
                          <FileAccessLink
                            file={attachment}
                            className="inline-flex text-[11px] font-semibold underline underline-offset-2"
                          >
                            Open attachment
                          </FileAccessLink>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 break-words">{msgPreview(m)}</div>
                    )}

                    <div
                      className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${
                        isLeft ?"text-zinc-500" : "text-white/80"
                      }`}
                    >
                      {!isLeft ?<StatusTicks status={status} /> : null}
                      <span>{time}</span>
                    </div>

                    {isPending ?(
                      <div className={`mt-1 text-[10px] font-semibold ${isLeft ?"text-amber-700" : "text-white/85"}`}>
                        Pending moderation
                      </div>
                    ) : null}

                    {showActions ?(
                      <div className={`mt-2 flex gap-2 ${isLeft ?"" : "justify-end"}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (isBundleView) return approveBundle(item.id, pendingChildren);
                            return approveSingle(m);
                          }}
                          disabled={busy}
                          className={`${smallBtn} border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700`}
                        >
                          {busy ? "..." : "Accept"}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isBundleView) return hideBundle(item.id, pendingChildren);
                            return hideSingle(m);
                          }}
                          disabled={busy}
                          className={`${smallBtn} border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-800 hover:bg-zinc-50`}
                        >
                          {busy ? "..." : "Hide"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        ref={composerRef}
        className="px-3 pt-2"
        style={{
          paddingBottom: `calc(var(--app-safe-bottom) + ${Math.max(0, keyboardInset - 8)}px + 0.75rem)`,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={activePicker.accept}
          capture={activePicker.capture || undefined}
          className="hidden"
          onChange={onPickFile}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-zinc-500">Send as Admin</div>
          <select
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            disabled={!chatEnabled}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="user">To User</option>
            <option value="staff">To Staff</option>
          </select>
        </div>

        {pickedPdf ?(
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{safeText(pickedPdf.name)}</span>
            {pickedPdf?.originalBytes > pickedPdf?.size ?(
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200">
                Optimized
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setPickedPdf(null)}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Remove
            </button>
          </div>
        ) : null}
        {attachmentPreparing ?(
          <div className="mt-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            Preparing attachment...
          </div>
        ) : null}

        <div className="mt-2 flex items-end gap-2">
          <div ref={attachMenuRef} className="relative">
            <button
              type="button"
              onMouseDown={keepComposerFocusOnAction}
              onTouchStart={keepComposerFocusOnAction}
              onClick={() => setAttachmentMenuOpen((value) => !value)}
              disabled={!chatEnabled || sending}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300 disabled:opacity-60"
              title="Attach"
            >
              <IconPlus className="h-5 w-5" />
            </button>
            {attachmentMenuOpen ?(
              <div className="absolute bottom-12 left-0 z-20 w-56 rounded-2xl border border-zinc-200 bg-white/95 p-1.5 text-xs shadow-xl dark:border-zinc-800 dark:bg-zinc-900/95">
                {Object.values(CHAT_ATTACHMENT_OPTIONS).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => openPicker(option.key)}
                    className="mb-1 inline-flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2 text-left font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <span>{option.label}</span>
                    <span className="text-[10px] text-zinc-400">
                      {option.key === "scan" || option.key === "photo" ? "Camera" : "Files"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder={chatEnabled ? "Message" : "Chat unlocks when work starts"}
            rows={1}
            className="w-full resize-none rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            style={{ overflowY: "hidden" }}
            disabled={!chatEnabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sending && canSend) sendNow();
              }
            }}
          />

          <button
            type="button"
            onMouseDown={keepComposerFocusOnAction}
            onTouchStart={keepComposerFocusOnAction}
            onClick={sendNow}
            disabled={!chatEnabled || sending || !canSend || attachmentPreparing}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${sendBtnTone}`}
            title="Send"
          >
            <IconSend className="h-5.5 w-5.5" />
          </button>
        </div>
      </div>
    </div>
  );
}



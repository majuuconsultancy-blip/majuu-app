// src/components/RequestChatPanel.jsx
// CHANGE ONLY:
// Default back button (Android/browser) now returns to RequestStatusScreen for this request
// - Pushes one history state when chat opens (so Back closes chat instead of leaving the request)
// - Handles popstate to: close modal + navigate to /app/request/:id (replace)
// - Close (X) button does the same (so behavior is consistent)
//
// Everything else untouched.

import { useEffect, useMemo, useRef, useState } from "react";
import { onSnapshot, collection, query, orderBy, where, doc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { sendPendingText, sendPendingAttachment, sendPendingBundle } from "../services/chatservice";
import { CHAT_ATTACHMENT_OPTIONS, prepareChatAttachmentFromFile } from "../services/chatAttachmentService";
import { buildParticipantSummary } from "../services/chatParticipantService";
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
import FileAccessImage from "./FileAccessImage";
import FileAccessLink from "./FileAccessLink";

/* ---------------- helpers ---------------- */
function safeStr(x) {
  return String(x || "").trim();
}

const OPTIMISTIC_MAX_AGE_MS = 5 * 60 * 1000;
const OPTIMISTIC_MATCH_WINDOW_MS = 12_000;
const OPTIMISTIC_HANDOFF_DELAY_MS = 360;

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function messageCreatedAtMs(msg) {
  return (
    Number(msg?._createdAtMs || 0) ||
    Number(msg?.createdAtMs || 0) ||
    Number(msg?._localCreatedAtMs || 0) ||
    tsToMillis(msg?.createdAt)
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

function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        stroke="currentColor"
        strokeWidth="1.9"
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

function StatusDots({ status }) {
  const s = String(status || "").toLowerCase();

  if (s === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-200">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-200" />
        Rejected
      </span>
    );
  }

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
        <path
          d="M2.5 8.5 5.7 11.3 13.2 4.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
        <path
          d="M2.5 8.5 5.7 11.3 13.2 4.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// Autosize textarea like ChatGPT
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

/* ---------------- UI-only merge (adjacent pdf + text) ---------------- */
function shouldMergePair(a, b, WINDOW_MS) {
  if (!a || !b || !WINDOW_MS) return false;
  // Keep timeline stable and avoid UI jumps after sends.
  return false;
}

function makeBundleView(first, second) {
  const aType = String(first?.type || "text").toLowerCase();

  const textMsg = aType === "text" ?first : second;
  const pdfMsg = aType === "pdf" ?first : second;

  const st1 = String(first?.status || "pending").toLowerCase();
  const st2 = String(second?.status || "pending").toLowerCase();

  let status = "pending";
  if (st1 === "rejected" || st2 === "rejected") status = "rejected";
  else if (st1 === "delivered" || st2 === "delivered") status = "delivered";

  return {
    type: "bundle_view",
    fromRole: first?.fromRole,
    fromUid: first?.fromUid,
    toRole: first?.toRole,

    text: safeStr(textMsg?.text),
    pdfMeta: pdfMsg?.pdfMeta || null,

    status,
    _createdAtMs: Math.min(first?._createdAtMs || 0, second?._createdAtMs || 0),
    _bundleChildrenIds: [first?._uiId, second?._uiId].filter(Boolean),
  };
}

/* ---------------- optimistic persistence ---------------- */
function makeStorageKey({ requestId, uid, role }) {
  return `maj_chat_opt_v1:${safeStr(requestId)}:${safeStr(uid)}:${safeStr(role)}`;
}

function loadOptimisticFromStorage(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((x) => x && Number(x.createdAtMs || 0) > now - 5 * 60_000);
  } catch {
    return [];
  }
}

function saveOptimisticToStorage(key, arr) {
  try {
    sessionStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

/* ---------------- optimistic matching (stable handoff) ---------------- */
function normalizedPdfName(msg) {
  return safeStr(msg?.pdfMeta?.name).toLowerCase();
}

function messageMatchesOptimistic(oMsg, candidate) {
  const fromRole = safeStr(candidate?.fromRole).toLowerCase();
  const wantFromRole = safeStr(oMsg?.fromRole).toLowerCase();
  if (wantFromRole && fromRole && fromRole !== wantFromRole) return false;

  const fromUid = safeStr(candidate?.fromUid);
  const wantFromUid = safeStr(oMsg?.fromUid);
  if (wantFromUid && fromUid && fromUid !== wantFromUid) return false;

  const toRole = safeStr(candidate?.toRole).toLowerCase();
  const wantToRole = safeStr(oMsg?.toRole).toLowerCase();
  if (wantToRole && toRole && toRole !== wantToRole) return false;

  const wantText = safeStr(oMsg?.text);
  const gotText = safeStr(candidate?.text);
  const wantPdf = normalizedPdfName(oMsg);
  const gotPdf = normalizedPdfName(candidate);

  const hasText = Boolean(wantText);
  const hasPdf = Boolean(wantPdf);
  const type = String(candidate?.type || "text").toLowerCase();

  const textMatch = hasText && gotText === wantText;
  const pdfMatch = hasPdf && gotPdf === wantPdf;

  if (hasText && hasPdf) {
    if (type === "bundle") return textMatch || pdfMatch;
    if (type === "text") return textMatch;
    if (type === "pdf") return pdfMatch;
    return false;
  }

  if (hasText) {
    if (type === "text" || type === "bundle") return textMatch;
    return false;
  }

  if (hasPdf) {
    if (type === "pdf" || type === "bundle") return pdfMatch;
    return false;
  }

  return false;
}

function findBestMatchForOptimistic(oMsg, candidates, usedIds, windowMs) {
  const oMs = messageCreatedAtMs(oMsg);
  if (!oMs) return null;

  let best = null;
  for (const candidate of candidates) {
    const cid = safeStr(candidate?.id);
    if (!cid || usedIds.has(cid)) continue;

    const cMs = messageCreatedAtMs(candidate);
    if (!cMs) continue;

    const distance = Math.abs(cMs - oMs);
    if (distance > windowMs) continue;
    if (!messageMatchesOptimistic(oMsg, candidate)) continue;

    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }

  return best?.candidate || null;
}

/* ---------------- component ---------------- */
export default function RequestChatPanel({ requestId, role = "user", onClose }) {
  const navigate = useNavigate();

  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const myRole = useMemo(() => String(role || "user").toLowerCase(), [role]);
  const myUid = auth.currentUser?.uid || "";

  const backHref = useMemo(() => `/app/request/${encodeURIComponent(rid)}`, [rid]);
  const publishedCacheScope = useMemo(() => `${myRole}:published`, [myRole]);
  const pendingCacheScope = useMemo(() => `${myRole}:${myUid || "anon"}`, [myRole, myUid]);
  const cachedPublished = useMemo(
    () => loadChatCollectionCache({ requestId: rid, scope: publishedCacheScope, kind: "published" }),
    [rid, publishedCacheScope]
  );
  const cachedPendingMine = useMemo(
    () => loadChatCollectionCache({ requestId: rid, scope: pendingCacheScope, kind: "pending" }),
    [rid, pendingCacheScope]
  );

  // Add a "chat layer" history entry and intercept Back.
  useEffect(() => {
    if (!rid) return;

    // Push one extra history entry so the first Back closes the chat,
    // instead of navigating to ProgressScreen or elsewhere.
    try {
      window.history.pushState(
        { ...(window.history.state || {}), __majuu_chat_layer: true, requestId: rid },
        ""
      );
    } catch {
      // ignore history state issues
    }

    const goBackToRequest = () => {
      try {
        onClose?.();
      } catch {
        // ignore close callback issues
      }
      navigate(backHref, { replace: true });
    };

    const onPopState = () => {
      goBackToRequest();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [rid, backHref, navigate, onClose]);

  const [published, setPublished] = useState(() => cachedPublished);
  const [pendingMine, setPendingMine] = useState(() => cachedPendingMine);
  const [requestRow, setRequestRow] = useState(null);

  const storageKey = useMemo(
    () => makeStorageKey({ requestId: rid, uid: myUid, role: myRole }),
    [rid, myUid, myRole]
  );
  const [optimistic, setOptimistic] = useState(() => loadOptimisticFromStorage(storageKey));
  const [reconcileNow, setReconcileNow] = useState(() => Date.now());
  const pendingObservedAtRef = useRef(new Map());

  const [loading, setLoading] = useState(
    () => cachedPublished.length === 0 && cachedPendingMine.length === 0
  );
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);

  const [text, setText] = useState("");

  const fileInputRef = useRef(null);
  const attachMenuRef = useRef(null);
  const [pickedPdf, setPickedPdf] = useState(null); // attachment meta
  const [pickerMode, setPickerMode] = useState("document");
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentPreparing, setAttachmentPreparing] = useState(false);
  const [headerAgent, setHeaderAgent] = useState(() => ({
    uid: "",
    name: "Agent pending assignment",
    online: false,
    statusLabel: "Offline",
    lastSeenAtMs: 0,
  }));
  const scrollRef = useRef(null);
  const keyboardInset = useKeyboardInset(true);

  const sendLockRef = useRef(false);

  const taRef = useRef(null);
  useAutosizeTextArea(taRef, text, { maxRows: 6 });

  const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap";
  const chatAvailability = useMemo(
    () => getRequestChatAvailability(requestRow || {}, { role: myRole }),
    [requestRow, myRole]
  );
  const chatEnabled = chatAvailability.enabled;

  useEffect(() => {
    saveOptimisticToStorage(storageKey, optimistic);
  }, [storageKey, optimistic]);

  useEffect(() => {
    if (!rid) return;
    saveChatCollectionCache({
      requestId: rid,
      scope: publishedCacheScope,
      kind: "published",
      rows: published,
    });
  }, [rid, publishedCacheScope, published]);

  useEffect(() => {
    if (!rid || !myUid) return;
    saveChatCollectionCache({
      requestId: rid,
      scope: pendingCacheScope,
      kind: "pending",
      rows: pendingMine,
    });
  }, [rid, myUid, pendingCacheScope, pendingMine]);

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
    if (!rid) return undefined;
    let unsubStaff = () => {};

    const unsubRequest = onSnapshot(
      doc(db, "serviceRequests", rid),
      (snap) => {
        const requestRow = snap.exists() ? snap.data() || {} : {};
        setRequestRow(requestRow);
        const staffUid = safeStr(requestRow?.assignedTo);
        const fallbackPartnerName = safeStr(requestRow?.assignedPartnerName);
        try {
          unsubStaff?.();
        } catch {
          // ignore listener cleanup issues
        }
        unsubStaff = () => {};

        if (!staffUid) {
          setHeaderAgent({
            uid: "",
            name: fallbackPartnerName ? `${fallbackPartnerName} agent` : "Agent pending assignment",
            online: false,
            statusLabel: "Offline",
            lastSeenAtMs: 0,
          });
          return;
        }

        unsubStaff = onSnapshot(
          doc(db, "staff", staffUid),
          (staffSnap) => {
            const staffRow = staffSnap.exists() ? staffSnap.data() || {} : {};
            setHeaderAgent(
              buildParticipantSummary({
                uid: staffUid,
                row: staffRow,
                fallbackLabel: fallbackPartnerName || `Agent ${staffUid.slice(0, 6)}`,
              })
            );
          },
          () => {
            setHeaderAgent({
              uid: staffUid,
              name: fallbackPartnerName || `Agent ${staffUid.slice(0, 6)}`,
              online: false,
              statusLabel: "Offline",
              lastSeenAtMs: 0,
            });
          }
        );
      },
      () => {
        setRequestRow(null);
        setHeaderAgent({
          uid: "",
          name: "Agent pending assignment",
          online: false,
          statusLabel: "Offline",
          lastSeenAtMs: 0,
        });
      }
    );

    return () => {
      try {
        unsubRequest?.();
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

  useEffect(() => {
    if (!rid) return;

    const qy = query(collection(db, "serviceRequests", rid, "messages"), orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setPublished(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (e) => {
        console.error("published snapshot:", e);
        setErr(e?.message || "Failed to load chat.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    if (!myUid) return;

    const qy = query(
      collection(db, "serviceRequests", rid, "pendingMessages"),
      where("fromUid", "==", myUid)
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const liveIds = new Set();
        const rows = snap.docs.map((d) => {
          const row = normalizeTextDeep({ id: d.id, ...d.data() });
          const id = safeStr(row?.id || d.id);
          const fromServerMs = tsToMillis(row?.createdAt);
          const knownMs = pendingObservedAtRef.current.get(id);
          const localObservedMs = knownMs || fromServerMs || Date.now();
          pendingObservedAtRef.current.set(id, localObservedMs);
          liveIds.add(id);
          return {
            ...row,
            _localCreatedAtMs: localObservedMs,
          };
        });

        for (const id of pendingObservedAtRef.current.keys()) {
          if (!liveIds.has(id)) pendingObservedAtRef.current.delete(id);
        }

        rows.sort((a, b) => messageCreatedAtMs(a) - messageCreatedAtMs(b));
        setPendingMine(rows);
      },
      (e) => {
        console.error("pending snapshot:", e);
        setErr((prev) => prev || e?.message || "Failed to load pending messages.");
      }
    );

    return () => unsub();
  }, [rid, myUid]);

  useEffect(() => {
    if (!optimistic.length) return undefined;

    const now = Date.now();
    const nextDueMs = optimistic
      .map((o) => Number(o?.createdAtMs || 0))
      .filter((ms) => ms > 0)
      .flatMap((ms) => [
        ms + OPTIMISTIC_HANDOFF_DELAY_MS - now,
        ms + OPTIMISTIC_MAX_AGE_MS - now,
      ])
      .filter((delta) => delta > 0);

    if (!nextDueMs.length) return undefined;

    const waitMs = Math.max(40, Math.min(...nextDueMs));
    const timer = window.setTimeout(() => {
      setReconcileNow(Date.now());
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [optimistic, pendingMine.length, published.length]);

  const optimisticActive = useMemo(() => {
    const now = reconcileNow;
    return optimistic.filter((o) => {
      const oMs = Number(o?.createdAtMs || 0) || 0;
      if (!oMs) return false;
      return now - oMs <= OPTIMISTIC_MAX_AGE_MS;
    });
  }, [optimistic, reconcileNow]);

  useEffect(() => {
    if (optimisticActive.length !== optimistic.length) {
      setOptimistic(optimisticActive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticActive.length, optimistic.length]);

  const publishedByPendingId = useMemo(() => {
    const map = new Map();
    published.forEach((m) => {
      const pid = safeStr(m.sourcePendingId);
      if (pid) map.set(pid, true);
    });
    return map;
  }, [published]);

  const timeline = useMemo(() => {
    const pendingBase = pendingMine
      .filter((p) => {
        const st = String(p.status || "pending").toLowerCase();
        if (st === "rejected") return true;
        if (publishedByPendingId.get(p.id)) return false;
        return true;
      })
      .map((p) => ({
        _kind: "pending",
        _uiId: `p_${p.id}`,
        _createdAtMs: messageCreatedAtMs(p),
        ...p,
      }));

    const publishedBase = published.map((m) => ({
      _kind: "published",
      _uiId: `m_${m.id}`,
      _createdAtMs: messageCreatedAtMs(m),
      status: "delivered",
      ...m,
    }));

    const usedPendingIds = new Set();
    const usedPublishedIds = new Set();

    const optimisticAnchored = [...optimisticActive]
      .sort((a, b) => (Number(a?.createdAtMs || 0) || 0) - (Number(b?.createdAtMs || 0) || 0))
      .map((o) => {
        const oCreatedAtMs = Number(o?.createdAtMs || 0) || 0;
        const oData = o?.data || {};
        const optimisticMsg = {
          ...oData,
          fromRole: oData.fromRole || myRole,
          fromUid: oData.fromUid || myUid,
          _createdAtMs: oCreatedAtMs,
          status: "pending",
        };

        const matchedPublished = findBestMatchForOptimistic(
          optimisticMsg,
          publishedBase,
          usedPublishedIds,
          OPTIMISTIC_MATCH_WINDOW_MS
        );
        const matchedPending = matchedPublished
          ? null
          : findBestMatchForOptimistic(
              optimisticMsg,
              pendingBase,
              usedPendingIds,
              OPTIMISTIC_MATCH_WINDOW_MS
            );

        const matched = matchedPublished || matchedPending;

        if (matchedPublished) {
          usedPublishedIds.add(matchedPublished.id);
          const sourcePendingId = safeStr(matchedPublished.sourcePendingId);
          if (sourcePendingId) usedPendingIds.add(sourcePendingId);
        } else if (matchedPending) {
          usedPendingIds.add(matchedPending.id);
        }

        const holdOptimistic =
          Boolean(matched) && reconcileNow - oCreatedAtMs < OPTIMISTIC_HANDOFF_DELAY_MS;

        if (matched && !holdOptimistic) {
          const mergedData = {
            ...optimisticMsg,
            ...matched,
            text: safeStr(matched?.text) || safeStr(optimisticMsg?.text),
            pdfMeta: matched?.pdfMeta || optimisticMsg?.pdfMeta || null,
            status:
              matched?._kind === "published"
                ? "delivered"
                : String(matched?.status || "pending").toLowerCase(),
          };
          return {
            _kind: matched._kind,
            _uiId: o.id,
            _createdAtMs: oCreatedAtMs || matched._createdAtMs || 0,
            ...mergedData,
          };
        }

        if (matched && String(matched?.status || "").toLowerCase() === "rejected") {
          return {
            _kind: "optimistic",
            _uiId: o.id,
            _createdAtMs: oCreatedAtMs,
            ...optimisticMsg,
            status: "rejected",
          };
        }

        return {
          _kind: "optimistic",
          _uiId: o.id,
          _createdAtMs: oCreatedAtMs,
          ...optimisticMsg,
        };
      });

    const pendingVisible = pendingBase.filter((p) => !usedPendingIds.has(p.id));
    const publishedItems = publishedBase.filter((m) => !usedPublishedIds.has(m.id));

    const allRaw = [...publishedItems, ...pendingVisible, ...optimisticAnchored].sort(
      (a, b) => (a._createdAtMs || 0) - (b._createdAtMs || 0)
    );

    const WINDOW_MS = 1200;
    const out = [];
    for (let i = 0; i < allRaw.length; i++) {
      const cur = allRaw[i];
      const next = allRaw[i + 1];

      const curType = String(cur?.type || "text").toLowerCase();
      const nextType = String(next?.type || "text").toLowerCase();
      if (curType === "bundle" || nextType === "bundle") {
        out.push({ _kind: cur._kind, id: cur._uiId, createdAtMs: cur._createdAtMs, data: cur });
        continue;
      }

      if (shouldMergePair(cur, next, WINDOW_MS)) {
        const bundle = makeBundleView(cur, next);
        out.push({
          _kind: "bundle_view",
          id: `b_${cur._uiId}_${next._uiId}`,
          createdAtMs: bundle._createdAtMs,
          data: bundle,
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
  }, [published, pendingMine, optimisticActive, publishedByPendingId, reconcileNow, myRole, myUid]);

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
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  useEffect(() => {
    if (!composerFocused && !keyboardInset) return;
    const el = scrollRef.current;
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 48);
    return () => window.clearTimeout(timer);
  }, [composerFocused, keyboardInset, timeline.length]);

  const toRole = myRole === "user" ?"staff" : "user";

  const openPicker = (mode = "document") => {
    if (!chatEnabled) {
      setErr(chatAvailability.message || "Chat is not active yet.");
      return;
    }
    setPickerMode(mode);
    setAttachmentMenuOpen(false);
    window.setTimeout(() => fileInputRef.current?.click(), 0);
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

  const pushOptimistic = (data) => {
    const createdAtMs = Date.now();
    setOptimistic((prev) => [
      ...prev,
      {
        id: `o_${createdAtMs}_${Math.random().toString(16).slice(2)}`,
        createdAtMs,
        data,
      },
    ]);
  };

  const sendNow = async () => {
    setErr("");
    const t = safeStr(text);
    const pdf = pickedPdf;

    if (!rid || !myUid) return;
    if (!t && !pdf) return;
    if (!chatEnabled) {
      setErr(chatAvailability.message || "Chat is not active yet.");
      return;
    }

    if (sendLockRef.current) return;
    sendLockRef.current = true;
    setSending(true);

    try {
      if (pdf && t) {
        pushOptimistic({
          type: "bundle",
          fromRole: myRole,
          fromUid: myUid,
          toRole,
          text: t,
          attachmentMeta: pdf,
          pdfMeta: pdf,
          status: "pending",
        });

        await sendPendingBundle({
          requestId: rid,
          fromRole: myRole,
          toRole,
          text: t,
          attachmentMeta: pdf,
          pdfMeta: pdf,
        });
      } else if (pdf) {
        pushOptimistic({
          fromRole: myRole,
          fromUid: myUid,
          toRole,
          type: pdf?.attachmentKind || "document",
          text: "",
          attachmentMeta: pdf,
          pdfMeta: pdf,
          status: "pending",
        });

        await sendPendingAttachment({
          requestId: rid,
          fromRole: myRole,
          toRole,
          attachmentMeta: pdf,
          typeHint: pdf?.attachmentKind || "document",
        });
      } else {
        pushOptimistic({
          fromRole: myRole,
          fromUid: myUid,
          toRole,
          type: "text",
          text: t,
          pdfMeta: null,
          status: "pending",
        });

        await sendPendingText({
          requestId: rid,
          fromRole: myRole,
          toRole,
          text: t,
        });
      }

      setText("");
      setPickedPdf(null);

      if (taRef.current) {
        taRef.current.style.height = "auto";
        taRef.current.style.overflowY = "hidden";
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to send.");
    } finally {
      setSending(false);
      sendLockRef.current = false;
    }
  };

  const onComposerKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sending && canSend) sendNow();
    }
  };

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

  const renderBubble = (item) => {
    const m = item.data || {};
    if (isSystemChatMessage(m)) {
      return (
        <div key={item.id} className="flex justify-center py-1.5">
          <div className="flex w-full items-center gap-3 text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            <span>{getSystemChatMessageLabel(m, myRole)}</span>
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      );
    }

    const fromRole = String(m.fromRole || "").toLowerCase();
    const mine = fromRole === myRole;
    const time = formatTime(m.createdAt || m._createdAtMs || null);

    const type = String(m.type || "text").toLowerCase();
    const attachment = m?.attachmentMeta || m?.pdfMeta || null;
    const attachmentKind = String(attachment?.attachmentKind || type || "document").toLowerCase();
    const attachmentLabel =
      attachmentKind === "photo" || attachmentKind === "image" ? "Photo" : "Document";
    const isImageAttachment =
      attachmentKind === "photo" ||
      attachmentKind === "image" ||
      String(attachment?.mime || attachment?.contentType || "").toLowerCase().startsWith("image/");
    const isAttachmentOnly =
      type === "pdf" || type === "document" || type === "image" || type === "photo";
    const isBundleView = type === "bundle_view" || type === "bundle" || item._kind === "bundle_view";
    const isComboOptimistic = type === "combo" && item._kind === "optimistic";

    const status =
      item._kind === "published" ?"delivered" : String(m.status || "pending").toLowerCase();

    return (
      <div key={item.id} className={`chat-bubble-in flex ${mine ?"justify-end" : "justify-start"}`}>
        <div
          className={`${bubbleBase} ${
            mine
              ?"bg-emerald-600 text-white shadow-[0_10px_18px_rgba(5,150,105,0.2)]"
              : "bg-white dark:bg-zinc-900/70 text-zinc-900 dark:text-zinc-100 border border-zinc-200/90 dark:border-zinc-800"
          }`}
        >
          {isBundleView ?(
            <div className="mt-1 grid gap-2">
              {safeStr(m.text) ?<div>{safeText(m.text)}</div> : null}
              

              {attachment?.name ?(
                <div
                  className={`${mine ?"bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2 ${!isImageAttachment ? "cursor-pointer" : ""}`}
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
          ) : isComboOptimistic ?(
            <div className="mt-1 grid gap-2">
              {safeStr(m.text) ?<div>{safeText(m.text)}</div> : null}
              {attachment?.name ?(
                <div
                  className={`${mine ?"bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2 ${!isImageAttachment ? "cursor-pointer" : ""}`}
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
              className={`mt-1 ${!isImageAttachment ? "cursor-pointer" : ""}`}
              {...buildAttachmentCardProps(attachment, isImageAttachment)}
            >
              <div className="font-semibold">{attachmentLabel}</div>
              {isImageAttachment ?(
                <FileAccessImage
                  file={attachment}
                  alt={safeText(attachment?.name) || "attachment"}
                  className="mt-1.5 max-h-56 w-full rounded-lg object-cover"
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
          ) : (
            <div className="mt-1">{safeText(m.text)}</div>
          )}

          <div
            className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${
              mine ?"text-white/80" : "text-zinc-500"
            }`}
          >
            {mine ?<StatusDots status={status} /> : null}
            <span>{time}</span>
          </div>

          {status === "rejected" ?(
            <div className="mt-2 rounded-xl bg-white/10 dark:bg-zinc-900/60 px-2 py-1 text-[11px] text-white/90">
              Rejected by admin.
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const closeAndGoBack = () => {
    try {
      onClose?.();
    } catch {
      // ignore close callback issues
    }
    navigate(backHref, { replace: true });
  };

  const sendBtnTone = canSend
    ?"bg-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.22)] hover:bg-emerald-700"
    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  const activePicker = CHAT_ATTACHMENT_OPTIONS[pickerMode] || CHAT_ATTACHMENT_OPTIONS.document;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-zinc-950"
      style={{ paddingLeft: "var(--app-safe-left)", paddingRight: "var(--app-safe-right)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 pb-2.5 pt-[calc(var(--app-safe-top)+0.6rem)]">
        <div>
          <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Request Chat</div>
          <div className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Assigned Agent:</span>{" "}
            {safeText(headerAgent?.name || "Assigned agent")}
            <span className={`ml-2 font-semibold ${headerAgent?.online ? "text-emerald-600" : "text-zinc-500"}`}>
              {headerAgent?.statusLabel || "Offline"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={closeAndGoBack}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300"
          title="Close"
        >
          <IconX className="h-4.5 w-4.5" />
        </button>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {loading ?(
          <div className="px-1 py-2 text-sm text-zinc-600 dark:text-zinc-300">Loading chat...</div>
        ) : timelineRows.length === 0 ?(
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
              return renderBubble(row.item);
            })}
          </div>
        )}
      </div>

      <div
        className="px-3 pt-2"
        style={{
          paddingBottom: `calc(var(--app-safe-bottom) + ${Math.max(0, keyboardInset - 8)}px + 0.65rem)`,
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

        {pickedPdf ?(
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {safeText(pickedPdf.name)}
            </span>
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
          <div className="mb-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            Preparing attachment...
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <div ref={attachMenuRef} className="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.preventDefault()}
              onClick={() => setAttachmentMenuOpen((value) => !value)}
              disabled={!chatEnabled || sending}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300"
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
            onKeyDown={onComposerKeyDown}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder={chatEnabled ? "Message" : "Chat unlocks when work starts"}
            rows={1}
            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            style={{ overflowY: "hidden" }}
            disabled={!chatEnabled}
          />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
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




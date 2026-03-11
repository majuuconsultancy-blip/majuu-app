// âœ… src/components/RequestChatPanel.jsx (FULL COPY-PASTE)
// CHANGE ONLY:
// âœ… Default back button (Android/browser) now returns to RequestStatusScreen for this request
// - Pushes one history state when chat opens (so Back closes chat instead of leaving the request)
// - Handles popstate to: close modal + navigate to /app/request/:id (replace)
// - Close (X) button does the same (so behavior is consistent)
//
// Everything else untouched.

import { useEffect, useMemo, useRef, useState } from "react";
import { onSnapshot, collection, query, orderBy, where } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { sendPendingText, sendPendingPdf, sendPendingBundle } from "../services/chatservice";
import useKeyboardInset from "../hooks/useKeyboardInset";
import { normalizeTextDeep } from "../utils/textNormalizer";
import { safeText } from "../utils/safeText";

/* ---------------- helpers ---------------- */
function safeStr(x) {
  return String(x || "").trim();
}

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
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

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "user") return "You";
  if (r === "staff") return "Staff";
  return "Admin";
}

function shouldFallbackToSplitSend(error) {
  const code = String(error?.code || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();
  return (
    code.includes("permission-denied") ||
    msg.includes("permission") ||
    msg.includes("invalid type") ||
    msg.includes("bundle")
  );
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

  const delivered = s === "approved" || s === "delivered";
  const tone = delivered ?"text-emerald-300" : "text-zinc-300";
  return (
    <span className={`inline-flex items-center ${tone}`} title={delivered ?"Read" : "Pending"}>
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

// âœ… autosize textarea like ChatGPT
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

/* ---------------- optimistic matching (dedupe) ---------------- */
function samePdfName(a, b) {
  return safeStr(a?.pdfMeta?.name) && safeStr(a?.pdfMeta?.name) === safeStr(b?.pdfMeta?.name);
}

function matchPendingForOptimistic(oMsg, pendingMine, WINDOW_MS) {
  const oType = String(oMsg?.type || "").toLowerCase();
  const oMs = Number(oMsg?._createdAtMs || 0) || 0;

  if (!oMs) return false;

  const wantText = safeStr(oMsg?.text);
  const wantPdf = safeStr(oMsg?.pdfMeta?.name);

  for (const p of pendingMine) {
    const pMs = tsToMillis(p?.createdAt);
    if (!pMs) continue;
    if (Math.abs(pMs - oMs) > WINDOW_MS) continue;

    const pt = String(p?.type || "text").toLowerCase();
    if (oType === "combo" || oType === "bundle") {
      if (pt === "text" && wantText && safeStr(p?.text) === wantText) return true;
      if (pt === "pdf" && wantPdf && safeStr(p?.pdfMeta?.name) === wantPdf) return true;
      if (pt === "bundle") {
        const okText = !wantText || safeStr(p?.text) === wantText;
        const okPdf = !wantPdf || safeStr(p?.pdfMeta?.name) === wantPdf;
        if (okText && okPdf) return true;
      }
    }

    if (oType === "text" && pt === "text" && wantText && safeStr(p?.text) === wantText) return true;

    if (oType === "pdf" && pt === "pdf" && wantPdf && safeStr(p?.pdfMeta?.name) === wantPdf) return true;
  }

  return false;
}

function matchPublishedForOptimistic(oMsg, published, WINDOW_MS) {
  const oType = String(oMsg?.type || "").toLowerCase();
  const oMs = Number(oMsg?._createdAtMs || 0) || 0;
  if (!oMs) return false;

  const wantText = safeStr(oMsg?.text);
  const wantPdf = safeStr(oMsg?.pdfMeta?.name);

  for (const m of published) {
    const mMs = tsToMillis(m?.createdAt);
    if (!mMs) continue;
    if (Math.abs(mMs - oMs) > WINDOW_MS) continue;

    const mt = String(m?.type || "text").toLowerCase();

    if (oType === "combo" || oType === "bundle") {
      if (mt === "text" && wantText && safeStr(m?.text) === wantText) return true;
      if (mt === "pdf" && wantPdf && safeStr(m?.pdfMeta?.name) === wantPdf) return true;
      if (mt === "bundle" && (safeStr(m?.text) === wantText || samePdfName(m, oMsg))) return true;
    }

    if (oType === "text" && mt === "text" && wantText && safeStr(m?.text) === wantText) return true;
    if (oType === "pdf" && mt === "pdf" && wantPdf && safeStr(m?.pdfMeta?.name) === wantPdf) return true;

    if (oType === "bundle" && mt === "bundle") {
      const okText = !wantText || safeStr(m?.text) === wantText;
      const okPdf = !wantPdf || samePdfName(m, oMsg);
      if (okText && okPdf) return true;
    }
  }

  return false;
}

/* ---------------- component ---------------- */
export default function RequestChatPanel({ requestId, role = "user", onClose }) {
  const navigate = useNavigate();

  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const myRole = useMemo(() => String(role || "user").toLowerCase(), [role]);
  const myUid = auth.currentUser?.uid || "";

  const backHref = useMemo(() => `/app/request/${encodeURIComponent(rid)}`, [rid]);

  // âœ… BACK FIX: add a "chat layer" history entry and intercept Back
  useEffect(() => {
    if (!rid) return;

    // Push one extra history entry so the first Back closes the chat,
    // instead of navigating to ProgressScreen or elsewhere.
    try {
      window.history.pushState(
        { ...(window.history.state || {}), __majuu_chat_layer: true, requestId: rid },
        ""
      );
    } catch {}

    const goBackToRequest = () => {
      try {
        onClose?.();
      } catch {}
      navigate(backHref, { replace: true });
    };

    const onPopState = () => {
      goBackToRequest();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [rid, backHref, navigate, onClose]);

  const [published, setPublished] = useState([]);
  const [pendingMine, setPendingMine] = useState([]);

  const storageKey = useMemo(
    () => makeStorageKey({ requestId: rid, uid: myUid, role: myRole }),
    [rid, myUid, myRole]
  );
  const [optimistic, setOptimistic] = useState(() => loadOptimisticFromStorage(storageKey));

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);

  const [text, setText] = useState("");

  const fileInputRef = useRef(null);
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const scrollRef = useRef(null);
  const keyboardInset = useKeyboardInset(true);

  const sendLockRef = useRef(false);

  const taRef = useRef(null);
  useAutosizeTextArea(taRef, text, { maxRows: 6 });

  const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap";

  useEffect(() => {
    saveOptimisticToStorage(storageKey, optimistic);
  }, [storageKey, optimistic]);

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
        const rows = snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));
        rows.sort((a, b) => tsToMillis(a.createdAt) - tsToMillis(b.createdAt));
        setPendingMine(rows);
      },
      (e) => {
        console.error("pending snapshot:", e);
        setErr((prev) => prev || e?.message || "Failed to load pending messages.");
      }
    );

    return () => unsub();
  }, [rid, myUid]);

  const publishedByPendingId = useMemo(() => {
    const map = new Map();
    published.forEach((m) => {
      const pid = safeStr(m.sourcePendingId);
      if (pid) map.set(pid, true);
    });
    return map;
  }, [published]);

  const optimisticDeduped = useMemo(() => {
    const WINDOW_MS = 12_000;
    const now = Date.now();

    return optimistic.filter((o) => {
      const oMs = Number(o?.createdAtMs || 0) || 0;
      if (!oMs) return false;
      if (now - oMs > 5 * 60_000) return false;

      const data = o.data || {};
      const oMsg = { ...data, _createdAtMs: oMs };

      if (matchPendingForOptimistic(oMsg, pendingMine, WINDOW_MS)) return false;
      if (matchPublishedForOptimistic(oMsg, published, WINDOW_MS)) return false;

      return true;
    });
  }, [optimistic, pendingMine, published]);

  useEffect(() => {
    if (optimisticDeduped.length !== optimistic.length) {
      setOptimistic(optimisticDeduped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticDeduped.length]);

  const timeline = useMemo(() => {
    const pendingVisible = pendingMine
      .filter((p) => {
        const st = String(p.status || "pending").toLowerCase();
        if (st === "rejected") return true;
        if (publishedByPendingId.get(p.id)) return false;
        return true;
      })
      .map((p) => ({
        _kind: "pending",
        _uiId: `p_${p.id}`,
        _createdAtMs: tsToMillis(p.createdAt),
        ...p,
      }));

    const publishedItems = published.map((m) => ({
      _kind: "published",
      _uiId: `m_${m.id}`,
      _createdAtMs: tsToMillis(m.createdAt),
      status: "delivered",
      ...m,
    }));

    const optimisticItems = optimisticDeduped.map((o) => ({
      _kind: "optimistic",
      _uiId: o.id,
      _createdAtMs: o.createdAtMs,
      ...o.data,
    }));

    const allRaw = [...publishedItems, ...pendingVisible, ...optimisticItems].sort(
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
  }, [published, pendingMine, optimisticDeduped, publishedByPendingId]);

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

  const openPicker = () => fileInputRef.current?.click();

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setPickedPdf({
      name: f.name || "document.pdf",
      size: Number(f.size || 0) || 0,
      mime: f.type || "application/pdf",
    });

    e.target.value = "";
  };

  const canSend = Boolean(safeStr(text) || pickedPdf);

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
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime },
          status: "pending",
        });

        try {
          await sendPendingBundle({
            requestId: rid,
            fromRole: myRole,
            toRole,
            text: t,
            pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
          });
        } catch (bundleErr) {
          if (!shouldFallbackToSplitSend(bundleErr)) throw bundleErr;

          await sendPendingText({
            requestId: rid,
            fromRole: myRole,
            toRole,
            text: t,
          });
          await sendPendingPdf({
            requestId: rid,
            fromRole: myRole,
            toRole,
            pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
          });
        }
      } else if (pdf) {
        pushOptimistic({
          fromRole: myRole,
          fromUid: myUid,
          toRole,
          type: "pdf",
          text: "",
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime },
          status: "pending",
        });

        await sendPendingPdf({
          requestId: rid,
          fromRole: myRole,
          toRole,
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
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

  const renderBubble = (item) => {
    const m = item.data || {};
    const fromRole = String(m.fromRole || "").toLowerCase();
    const mine = fromRole === myRole;
    const time = formatTime(m.createdAt || null);

    const type = String(m.type || "text").toLowerCase();
    const isPdf = type === "pdf";
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
              

              {m?.pdfMeta?.name ?(
                <div className={`${mine ?"bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2`}>
                  <div className="text-xs font-semibold opacity-90">PDF</div>
                  <div className="text-xs opacity-90">
                    {safeText(m?.pdfMeta?.name) || "document.pdf"}
                    {m?.pdfMeta?.size ?` • ${m.pdfMeta.size} bytes` : ""}
                  </div>
                </div>
              ) : null}
            </div>
          ) : isComboOptimistic ?(
            <div className="mt-1 grid gap-2">
              {safeStr(m.text) ?<div>{safeText(m.text)}</div> : null}
              {m?.pdfMeta?.name ?(
                <div className={`${mine ?"bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2`}>
                  <div className="text-xs font-semibold opacity-90">PDF</div>
                  <div className="text-xs opacity-90">
                    {safeText(m?.pdfMeta?.name) || "document.pdf"}
                    {m?.pdfMeta?.size ?` • ${m.pdfMeta.size} bytes` : ""}
                  </div>
                </div>
              ) : null}
            </div>
          ) : isPdf ?(
            <div className="mt-1">
              <div className="font-semibold">PDF</div>
              <div className="text-xs opacity-90">
                {safeText(m?.pdfMeta?.name) || "document.pdf"}
                {m?.pdfMeta?.size ?` • ${m.pdfMeta.size} bytes` : ""}
              </div>
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
    } catch {}
    navigate(backHref, { replace: true });
  };

  const sendBtnTone = canSend
    ?"bg-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.22)] hover:bg-emerald-700"
    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-zinc-950"
      style={{ paddingLeft: "var(--app-safe-left)", paddingRight: "var(--app-safe-right)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 pb-2.5 pt-[calc(var(--app-safe-top)+0.6rem)]">
        <div>
          <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Request Chat</div>
          <div className="text-xs text-zinc-500">{roleLabel(myRole)} support thread</div>
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {loading ?(
          <div className="px-1 py-2 text-sm text-zinc-600 dark:text-zinc-300">Loading chat…</div>
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
          accept="application/pdf"
          className="hidden"
          onChange={onPickFile}
        />

        {pickedPdf ?(
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{safeText(pickedPdf.name)}</span>
            <button
              type="button"
              onClick={() => setPickedPdf(null)}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Remove
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={openPicker}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300"
            title="Attach PDF"
          >
            <IconPlus className="h-5 w-5" />
          </button>

          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onComposerKeyDown}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder="Message"
            rows={1}
            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            style={{ overflowY: "hidden" }}
          />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={sendNow}
            disabled={sending || !canSend}
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


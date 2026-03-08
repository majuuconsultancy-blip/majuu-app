// âœ… src/components/AdminRequestChatPanel.jsx (FULL COPY-PASTE)
// FIX:
// âœ… White screen was caused by missing Firestore import: `collection`
//    You call collection(...) but it wasn't imported, so runtime crashed.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  onSnapshot,
  orderBy,
  query,
  where,
  doc,
  collection, // âœ… FIX: required (was missing)
} from "firebase/firestore";
import { db } from "../firebase";
import {
  adminApprovePendingMessage,
  adminHidePendingMessage,
  adminSendBundleDirect,
  adminSendTextDirect,
  adminSendPdfMetaDirect,
} from "../services/chatservice";
import useKeyboardInset from "../hooks/useKeyboardInset";

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

function pickCreatedAt(docu) {
  return docu?.createdAt || docu?.approvedAt || docu?.editedAt || docu?.rejectedAt || null;
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "user") return "User";
  if (r === "staff") return "Staff";
  return "Admin";
}

function msgPreview(m) {
  const type = String(m?.type || "text").toLowerCase();
  if (type === "pdf") return `PDF: ${m?.pdfMeta?.name || "document.pdf"}`;
  if (type === "bundle") {
    const text = safeStr(m?.text);
    const pdf = safeStr(m?.pdfMeta?.name);
    if (text && pdf) return `${text}\nPDF: ${pdf}`;
    if (pdf) return `PDF: ${pdf}`;
    return text;
  }
  return safeStr(m?.text || "");
}

/* âœ… autosize textarea like ChatGPT */
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
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [textareaRef, value, maxRows]);
}

/* âœ… UI-only merge rule for adjacent pdf+text */
function shouldMergePair(a, b, WINDOW_MS) {
  if (!a || !b || !WINDOW_MS) return false;
  // Keep timeline stable and avoid UI jumps after sends.
  return false;
}

function makeBundleView(first, second) {
  const aType = String(first?.type || "text").toLowerCase();
  const textMsg = aType === "text" ? first : second;
  const pdfMsg = aType === "pdf" ? first : second;

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
  const tone = s === "delivered" || s === "approved" ? "text-emerald-300" : "text-zinc-300";
  return (
    <span className={`inline-flex items-center ${tone}`} title={s}>
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

  const [pending, setPending] = useState([]);
  const [published, setPublished] = useState([]);

  const [busyKey, setBusyKey] = useState(""); // message id or bundle id
  const [err, setErr] = useState("");

  // âœ… NEW: track whether staff is assigned
  const [assignedStaffUid, setAssignedStaffUid] = useState("");

  // âœ… Hide removes message instantly (optimistic)
  const [optimisticHidden, setOptimisticHidden] = useState(() => new Set());

  // âœ… Accept removes buttons instantly and NEVER rolls back
  const [optimisticNoActions, setOptimisticNoActions] = useState(() => new Set());

  // admin composer
  const [sendTo, setSendTo] = useState("user"); // user | staff
  const [text, setText] = useState("");
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const [sending, setSending] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);

  const fileInputRef = useRef(null);
  const threadRef = useRef(null);
  const composerRef = useRef(null);
  const keyboardInset = useKeyboardInset(true);

  const taRef = useRef(null);
  useAutosizeTextArea(taRef, text, { maxRows: 6 });

  /* ---------- persist no-actions so buttons never return on remount ---------- */
  const noActionsKey = useMemo(() => (rid ? `adminChat_noActions_${rid}` : ""), [rid]);

  useEffect(() => {
    if (!noActionsKey) return;
    try {
      const raw = sessionStorage.getItem(noActionsKey);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      setOptimisticNoActions(new Set(arr.map((x) => String(x))));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noActionsKey]);

  useEffect(() => {
    if (!noActionsKey) return;
    try {
      sessionStorage.setItem(noActionsKey, JSON.stringify([...optimisticNoActions]));
    } catch {}
  }, [noActionsKey, optimisticNoActions]);

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
    if (!rid) return;

    const reqRef = doc(db, "serviceRequests", rid);
    const unsub = onSnapshot(
      reqRef,
      (snap) => {
        const d = snap.exists() ? snap.data() : null;

        // support a few possible field names (use whichever you have)
        const uid =
          d?.assignedStaffUid ||
          d?.assignedToUid ||
          d?.staffUid ||
          d?.staffAssignedUid ||
          "";

        setAssignedStaffUid(String(uid || "").trim());
      },
      () => {
        setAssignedStaffUid("");
      }
    );

    return () => unsub();
  }, [rid]);

  /* ---------- listeners ---------- */
  useEffect(() => {
    if (!rid) return;

    const ref = collection(db, "serviceRequests", rid, "pendingMessages");
    const qy = query(ref, where("status", "==", "pending"), orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setPending(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
        setPublished(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setErr("");
      },
      (e) => {
        console.error("messages snapshot:", e);
        setErr(e?.message || "Failed to load messages.");
      }
    );

    return () => unsub();
  }, [rid]);

  /* ---------- build timeline (UI merge) ---------- */
  const timeline = useMemo(() => {
    const hidden = optimisticHidden;

    const pendingItemsRaw = pending
      .filter((p) => !hidden.has(p.id))
      .map((p) => ({
        _kind: "pending",
        _uiId: `p_${p.id}`,
        _createdAtMs: tsToMillis(pickCreatedAt(p)) || 0,
        status: "pending",
        ...p,
      }));

    const publishedItemsRaw = published.map((m) => ({
      _kind: "published",
      _uiId: `m_${m.id}`,
      _createdAtMs: tsToMillis(pickCreatedAt(m)) || 0,
      status: "delivered",
      ...m,
    }));

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
  }, [pending, published, optimisticHidden]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.length, err]);

  useEffect(() => {
    if (!composerFocused && !keyboardInset) return;
    const timer = window.setTimeout(() => {
      scrollToBottom();
    }, 48);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // âœ… Accept: hide buttons immediately & permanently
    pendingChildren.forEach((c) => disableActionsOptimistic(c.id));

    try {
      for (const c of pendingChildren) {
        await adminApprovePendingMessage({ requestId: rid, pendingId: c.id });
      }
    } catch (e) {
      console.error(e);
      // âœ… DO NOT rollback button hide
      setErr(e?.message || "Approve failed (buttons will stay hidden).");
    } finally {
      setBusyKey("");
    }
  };

  const hideBundle = async (bundleId, pendingChildren) => {
    setErr("");
    if (!pendingChildren?.length) return;

    setBusyKey(bundleId);

    // âœ… Hide: remove bubble instantly
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

    // âœ… Accept: hide buttons immediately & permanently
    disableActionsOptimistic(p.id);

    try {
      await adminApprovePendingMessage({ requestId: rid, pendingId: p.id });
    } catch (e) {
      console.error(e);
      // âœ… DO NOT rollback button hide
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
  const openPicker = () => fileInputRef.current?.click();
  const keepComposerFocusOnAction = (event) => {
    event.preventDefault();
  };

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

  const sendNow = async () => {
    setErr("");
    const t = safeStr(text);
    const pdf = pickedPdf;
    if (!rid) return;
    if (!t && !pdf) return;

    setSending(true);
    try {
      if (pdf && t) {
        try {
          await adminSendBundleDirect({
            requestId: rid,
            toRole: sendTo,
            text: t,
            pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
          });
        } catch (bundleErr) {
          const code = String(bundleErr?.code || "").toLowerCase();
          const msg = String(bundleErr?.message || "").toLowerCase();
          const fallback =
            code.includes("permission-denied") ||
            msg.includes("permission") ||
            msg.includes("invalid type") ||
            msg.includes("bundle");
          if (!fallback) throw bundleErr;

          await adminSendTextDirect({ requestId: rid, toRole: sendTo, text: t });
          await adminSendPdfMetaDirect({
            requestId: rid,
            toRole: sendTo,
            pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
          });
        }
      } else if (pdf) {
        await adminSendPdfMetaDirect({
          requestId: rid,
          toRole: sendTo,
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
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
    ? "bg-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.22)] hover:bg-emerald-700"
    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  const navLiftPad = keyboardInset > 0 ? "0px" : "var(--app-bottom-nav-lift, 0px)";

  return (
    <div className="fixed inset-0 z-[999999] flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top,0px)+0.6rem)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70">
            <IconChat className="h-5 w-5 text-emerald-800" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Request Chat</div>
            <div className="text-xs text-zinc-500">
              Moderation thread
              {assignedStaffUid ? (
                <span className="ml-2 font-semibold text-emerald-700">• Staff assigned</span>
              ) : (
                <span className="ml-2 font-semibold text-amber-700">• No staff assigned</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
            Pending: {pending.length}
          </span>
          {onClose ? (
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

      {err ? (
        <div className="px-3 pt-2">
          <div className="rounded-xl border border-rose-100 bg-rose-50/80 px-3 py-2 text-xs text-rose-700">
            {err}
          </div>
        </div>
      ) : null}

      <div ref={threadRef} className="flex-1 overflow-y-auto px-3 py-2">
        {timelineRows.length === 0 ? (
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
              const fromRole = String(m.fromRole || "").toLowerCase();
              const isLeft = fromRole === "user";
              const bubbleCls = isLeft ? bubbleLeft : bubbleRight;
              const time = formatTime(pickCreatedAt(m));

              const isBundleView =
                item._kind === "bundle_view" ||
                String(m.type || "").toLowerCase() === "bundle_view" ||
                String(m.type || "").toLowerCase() === "bundle";

              const pendingChildren = isBundleView ? item._pendingChildren || [] : [];
              const isPending = item._kind === "pending" || (isBundleView && pendingChildren.length > 0);

              const originOk = fromRole === "user" || fromRole === "staff";
              const bundleHasActionable =
                isBundleView && pendingChildren.some((c) => !optimisticNoActions.has(c.id));

              const showActions =
                originOk &&
                ((item._kind === "pending" && !optimisticNoActions.has(m.id)) ||
                  (isBundleView && bundleHasActionable));

              const busy = busyKey === m.id || busyKey === item.id;
              const status = item._kind === "published" ? "delivered" : String(m.status || "pending").toLowerCase();

              return (
                <div key={item.id} className={`chat-bubble-in flex ${isLeft ? "justify-start" : "justify-end"}`}>
                  <div className={`${bubbleBase} ${bubbleCls}`}>
                    {isBundleView ? (
                      <div className="mt-1 grid gap-2">
                        {safeStr(m.text) ? <div className="break-words">{m.text}</div> : null}

                        {m?.pdfMeta?.name ? (
                          <div
                            className={`${
                              isLeft
                                ? "bg-zinc-50 dark:bg-zinc-950"
                                : "bg-white/10 dark:bg-zinc-900/60"
                            } rounded-xl p-2`}
                          >
                            <div className="text-xs font-semibold opacity-90">PDF</div>
                            <div className="text-xs opacity-90">
                              {m?.pdfMeta?.name || "document.pdf"}
                              {m?.pdfMeta?.size ? ` • ${m.pdfMeta.size} bytes` : ""}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 break-words">{msgPreview(m)}</div>
                    )}

                    <div
                      className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${
                        isLeft ? "text-zinc-500" : "text-white/80"
                      }`}
                    >
                      {!isLeft ? <StatusTicks status={status} /> : null}
                      <span>{time}</span>
                    </div>

                    {isPending ? (
                      <div className={`mt-1 text-[10px] font-semibold ${isLeft ? "text-amber-700" : "text-white/85"}`}>
                        Pending moderation
                      </div>
                    ) : null}

                    {showActions ? (
                      <div className={`mt-2 flex gap-2 ${isLeft ? "" : "justify-end"}`}>
                        <button
                          type="button"
                          onClick={() => {
                            if (isBundleView) return approveBundle(item.id, pendingChildren);
                            return approveSingle(m);
                          }}
                          disabled={busy}
                          className={`${smallBtn} border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700`}
                        >
                          {busy ? "…" : "Accept"}
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
                          {busy ? "…" : "Hide"}
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
          paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${navLiftPad} + ${Math.max(0, keyboardInset - 8)}px + 0.75rem)`,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onPickFile}
        />

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-zinc-500">Send as Admin</div>
          <select
            value={sendTo}
            onChange={(e) => setSendTo(e.target.value)}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm"
          >
            <option value="user">To User</option>
            <option value="staff">To Staff</option>
          </select>
        </div>

        {pickedPdf ? (
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pickedPdf.name}</span>
            <button
              type="button"
              onClick={() => setPickedPdf(null)}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Remove
            </button>
          </div>
        ) : null}

        <div className="mt-2 flex items-end gap-2">
          <button
            type="button"
            onMouseDown={keepComposerFocusOnAction}
            onTouchStart={keepComposerFocusOnAction}
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
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder="Message"
            rows={1}
            className="w-full resize-none rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
            style={{ overflowY: "hidden" }}
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

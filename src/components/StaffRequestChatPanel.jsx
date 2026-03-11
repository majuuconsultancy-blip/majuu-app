// âœ… src/components/StaffRequestChatPanel.jsx (FULL COPY-PASTE)
// Staff Chat (Portal modal, mobile-first, perfect overlay)
// âœ… FIXED: file manager picker (no prompt())
// âœ… FIXED: attach PDF meta like user panel (pickedPdf chip, not auto-send)
// âœ… FIXED: supports sending BOTH text + pdf as ONE pending "bundle" (sendPendingBundle)
// âœ… Supports rendering text/pdf/bundle for published + pending.
// âœ… Marks read when opened.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  sendPendingText,
  sendPendingPdf,
  sendPendingBundle,
} from "../services/chatservice";
import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
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

function StatusTicks({ status }) {
  const s = String(status || "").toLowerCase();
  const tone = s === "delivered" || s === "approved" ?"text-emerald-300" : "text-zinc-300";
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

function pickCreatedAt(doc) {
  return (
    doc?.createdAt ||
    doc?.approvedAt ||
    doc?.editedAt ||
    doc?.rejectedAt ||
    doc?.hiddenAt ||
    null
  );
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "user") return "User";
  if (r === "staff") return "Staff";
  return "Admin";
}

/* âœ… Render helper: supports text/pdf/bundle */
function RenderMessageBody({ m, mine }) {
  const type = String(m?.type || "text").toLowerCase();

  // pdf-only
  if (type === "pdf") {
    return (
      <div className="grid gap-1">
        <div className="text-xs font-semibold opacity-90">PDF</div>
        <div className="text-sm">
          {safeText(m?.pdfMeta?.name) || "document.pdf"}
          {m?.pdfMeta?.size ?(
            <span className="text-xs opacity-80"> • {m.pdfMeta.size} bytes</span>
          ) : null}
        </div>
      </div>
    );
  }

  // bundle: show text (if any) + pdf block (if any)
  if (type === "bundle") {
    const txt = safeStr(m?.text);
    const hasPdf = Boolean(m?.pdfMeta?.name);

    return (
      <div className="grid gap-2">
        {txt ?<div className="break-words whitespace-pre-wrap">{safeText(txt)}</div> : null}

        {hasPdf ?(
          <div className={`${mine ?"bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2`}>
            <div className="text-xs font-semibold opacity-90">PDF</div>
            <div className="text-xs opacity-90">
              {safeText(m?.pdfMeta?.name) || "document.pdf"}
              {m?.pdfMeta?.size ?` • ${m.pdfMeta.size} bytes` : ""}
            </div>
          </div>
        ) : null}

        {!txt && !hasPdf ?<div className="opacity-70">[Empty bundle]</div> : null}
      </div>
    );
  }

  // text default
  return <div className="break-words whitespace-pre-wrap">{safeText(m?.text || "")}</div>;
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

/* ---------------- component ---------------- */
export default function StaffRequestChatPanel({ requestId }) {
  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const location = useLocation();
  const navigate = useNavigate();

  const [uid, setUid] = useState("");
  const [open, setOpen] = useState(false);
  const hasUnreadChat = useNotifsV2Store((s) => Boolean(rid && s.unreadByRequest?.[rid]?.unread));

  const [published, setPublished] = useState([]); // /messages
  const [pendingMine, setPendingMine] = useState([]); // /pendingMessages (staff only)

  const [text, setText] = useState("");
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);

  const threadRef = useRef(null);
  const fileInputRef = useRef(null);
  const sendLockRef = useRef(false);
  const taRef = useRef(null);
  const keyboardInset = useKeyboardInset(open);
  useAutosizeTextArea(taRef, text, { maxRows: 6 });

  /* ---------- auth (needed to filter staff pending) ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || ""));
    return () => unsub();
  }, []);

  /* ---------- listeners ---------- */
  useEffect(() => {
    if (!rid) return;

    const ref = collection(db, "serviceRequests", rid, "messages");
    const qy = query(ref, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setPublished(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
        setErr("");
      },
      (e) => {
        console.error("staff chat messages snapshot:", e);
        setErr(e?.message || "Failed to load messages.");
      }
    );

    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid || !uid) return;

    // staff pending (mine)
    const ref = collection(db, "serviceRequests", rid, "pendingMessages");
    const qy = query(ref, where("fromUid", "==", uid), orderBy("createdAt", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setPendingMine(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
        setErr("");
      },
      (e) => {
        console.error("staff pending snapshot:", e);
        setErr(e?.message || "Failed to load pending messages.");
      }
    );

    return () => unsub();
  }, [rid, uid]);

  /* ---------- mark read when opened ---------- */
  useEffect(() => {
    if (!rid || open) return;
    try {
      const params = new URLSearchParams(location.search || "");
      if (params.get("openChat") === "1") return;
    } catch {}
    let shouldOpen = false;
    try {
      shouldOpen = sessionStorage.getItem(`maj_open_staff_chat:${rid}`) === "1";
      if (shouldOpen) sessionStorage.removeItem(`maj_open_staff_chat:${rid}`);
    } catch {}
    if (!shouldOpen) return;

    if (uid) notifsV2Store.markChatRead(rid).catch(() => {});
    setOpen(true);
  }, [rid, open, uid, location.search]);

  /* ---------- lock body scroll ---------- */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* ---------- visible published messages for staff ---------- */
  const visiblePublished = useMemo(() => {
    return published.filter((m) => {
      const toRole = String(m?.toRole || "").toLowerCase();
      const fromRole = String(m?.fromRole || "").toLowerCase();
      return toRole === "staff" || toRole === "all" || fromRole === "staff";
    });
  }, [published]);

  /* ---------- build a single timeline ---------- */
  const timeline = useMemo(() => {
    const approvedPendingIds = new Set(
      visiblePublished.map((m) => safeStr(m?.sourcePendingId)).filter(Boolean)
    );

    const pendingItems = pendingMine
      .filter((p) => {
        const st = String(p?.status || "pending").toLowerCase();
        const isRejectedLike = st === "rejected" || st === "hidden";
        const isApproved = approvedPendingIds.has(String(p.id));
        return isRejectedLike || !isApproved;
      })
      .map((p) => ({
        _kind: "pending",
        id: `p_${p.id}`,
        createdAtMs: tsToMillis(pickCreatedAt(p)),
        data: p,
      }));

    const publishedItems = visiblePublished.map((m) => ({
      _kind: "published",
      id: `m_${m.id}`,
      createdAtMs: tsToMillis(pickCreatedAt(m)),
      data: m,
    }));

    const all = [...publishedItems, ...pendingItems];
    all.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return all;
  }, [pendingMine, visiblePublished]);

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

  /* ---------- auto scroll ---------- */
  useEffect(() => {
    if (!open) return;
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, timeline.length]);

  useEffect(() => {
    if (!open) return;
    if (!composerFocused && !keyboardInset) return;
    const el = threadRef.current;
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 48);
    return () => window.clearTimeout(timer);
  }, [open, composerFocused, keyboardInset, timeline.length]);

  /* ---------- file picker ---------- */
  const openPicker = () => fileInputRef.current?.click();

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setPickedPdf({
      name: f.name || "document.pdf",
      size: Number(f.size || 0) || 0,
      mime: f.type || "application/pdf",
    });

    // allow picking same file again later
    e.target.value = "";
  };

  const canSend = Boolean(safeStr(text) || pickedPdf);
  const keepComposerFocusOnAction = (event) => {
    event.preventDefault();
  };

  /* ---------- actions ---------- */
  const sendNow = async () => {
    setErr("");
    if (!rid) return;

    const t = safeStr(text);
    const pdf = pickedPdf;

    if (!t && !pdf) return;

    // prevent double send
    if (sendLockRef.current) return;
    sendLockRef.current = true;

    setSending(true);
    try {
      // âœ… Best: use bundle when both exist (ONE pending doc)
      if (pdf && t) {
        try {
          await sendPendingBundle({
            requestId: rid,
            fromRole: "staff",
            toRole: "user",
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

          await sendPendingText({
            requestId: rid,
            fromRole: "staff",
            toRole: "user",
            text: t,
          });
          await sendPendingPdf({
            requestId: rid,
            fromRole: "staff",
            toRole: "user",
            pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
          });
        }
      } else if (pdf) {
        await sendPendingPdf({
          requestId: rid,
          fromRole: "staff",
          toRole: "user",
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
        });
      } else {
        await sendPendingText({
          requestId: rid,
          fromRole: "staff",
          toRole: "user",
          text: t,
        });
      }

      setText("");
      setPickedPdf(null);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Send failed.");
    } finally {
      setSending(false);
      sendLockRef.current = false;
    }
  };

  /* ---------- UI styles ---------- */
  const openBtn =
    "inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]";
  const badge =
    "rounded-full border border-white/30 bg-white/15 dark:bg-zinc-900/60 px-2 py-0.5 text-[11px] font-semibold text-white";
  const sendBtnTone = canSend
    ?"bg-emerald-600 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.22)] hover:bg-emerald-700"
    : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-white dark:bg-zinc-950"
      style={{ paddingLeft: "var(--app-safe-left)", paddingRight: "var(--app-safe-right)" }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200/80 dark:border-zinc-800/80 px-4 pb-2.5 pt-[calc(var(--app-safe-top)+0.6rem)]">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">Request Chat</div>
          <div className="text-xs text-zinc-500">Staff support thread</div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(false)}
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
              const kind = item._kind;

              const fromRole = String(m?.fromRole || "").toLowerCase();
              const mine = fromRole === "staff";
              const time = formatTime(pickCreatedAt(m));

              const pendingStatus = String(m?.status || "pending").toLowerCase();
              const isRejectedLike = pendingStatus === "rejected" || pendingStatus === "hidden";

              const bubbleBase = "chat-bubble-in max-w-[85%] rounded-2xl px-3 py-2 text-sm";
              const bubbleMine = "bg-emerald-600 text-white shadow-[0_10px_18px_rgba(5,150,105,0.2)]";
              const bubbleOther = "bg-white dark:bg-zinc-900/70 text-zinc-900 dark:text-zinc-100 border border-zinc-200/90 dark:border-zinc-800";
              const bubbleRejected = "bg-rose-50 text-rose-800 border border-rose-200";

              const bubbleCls =
                kind === "pending" && mine && isRejectedLike
                  ?bubbleRejected
                  : mine
                  ?bubbleMine
                  : bubbleOther;

              const msgType = String(m?.type || "text").toLowerCase();
              const status = kind === "published" ?"delivered" : pendingStatus;

              return (
                <div key={item.id} className={`flex ${mine ?"justify-end" : "justify-start"}`}>
                  <div className={`${bubbleBase} ${bubbleCls}`}>
                    <RenderMessageBody m={m} mine={mine} />

                    <div
                      className={[
                        "mt-1.5 flex items-center justify-end gap-2 text-[10px]",
                        mine ?"text-white/80" : "text-zinc-500",
                      ].join(" ")}
                    >
                      {mine && (msgType === "text" || msgType === "bundle" || msgType === "pdf") ?<StatusTicks status={status} /> : null}
                      <span>{time}</span>
                    </div>
                  </div>
                </div>
              );
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
            onMouseDown={keepComposerFocusOnAction}
            onTouchStart={keepComposerFocusOnAction}
            onClick={openPicker}
            disabled={sending}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 text-zinc-700 dark:text-zinc-300 disabled:opacity-60"
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
            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
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

  const openChat = () => {
    if (rid) notifsV2Store.markChatRead(rid).catch(() => {});
    setOpen(true);
  };

  useEffect(() => {
    if (!rid || open) return;
    let params = null;
    try {
      params = new URLSearchParams(location.search || "");
    } catch {
      return;
    }
    if (params.get("openChat") !== "1") return;

    openChat();

    params.delete("openChat");
    const qs = params.toString();
    const nextUrl = `${location.pathname}${qs ?`?${qs}` : ""}`;
    if (nextUrl !== `${location.pathname}${location.search || ""}`) {
      navigate(nextUrl, { replace: true });
    }
  }, [rid, open, location.pathname, location.search, navigate]);

  return (
    <>
      <button type="button" onClick={openChat} className={openBtn}>
        <IconChat className="h-5 w-5" />
        Chat {hasUnreadChat ?<span className={badge}>New</span> : null}
      </button>

      {open ?createPortal(modal, document.body) : null}
    </>
  );
}


// ✅ src/components/StaffRequestChatPanel.jsx (FULL COPY-PASTE)
// Staff Chat (Portal modal, mobile-first, perfect overlay)
// ✅ FIXED: file manager picker (no prompt())
// ✅ FIXED: attach PDF meta like user panel (pickedPdf chip, not auto-send)
// ✅ FIXED: supports sending BOTH text + pdf as ONE pending "bundle" (sendPendingBundle)
// ✅ Supports rendering text/pdf/bundle for published + pending.
// ✅ Marks read when opened.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import {
  sendPendingText,
  sendPendingPdf,
  sendPendingBundle,
  markRequestChatRead,
} from "../services/chatservice";

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

/* ✅ Render helper: supports text/pdf/bundle */
function RenderMessageBody({ m, mine }) {
  const type = String(m?.type || "text").toLowerCase();

  // pdf-only
  if (type === "pdf") {
    return (
      <div className="grid gap-1">
        <div className="text-xs font-semibold opacity-90">PDF</div>
        <div className="text-sm">
          📎 {m?.pdfMeta?.name || "document.pdf"}
          {m?.pdfMeta?.size ? (
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
        {txt ? <div className="break-words whitespace-pre-wrap">{txt}</div> : null}

        {hasPdf ? (
          <div className={`${mine ? "bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2`}>
            <div className="text-xs font-semibold opacity-90">PDF</div>
            <div className="text-xs opacity-90">
              📎 {m?.pdfMeta?.name || "document.pdf"}
              {m?.pdfMeta?.size ? ` • ${m.pdfMeta.size} bytes` : ""}
            </div>
          </div>
        ) : null}

        {!txt && !hasPdf ? <div className="opacity-70">[Empty bundle]</div> : null}
      </div>
    );
  }

  // text default
  return <div className="break-words whitespace-pre-wrap">{safeStr(m?.text || "")}</div>;
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
        d="M4.2 12l16.2-7-4.5 14-3.8-5.1L4.2 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M20.4 5L12.1 13.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- component ---------------- */
export default function StaffRequestChatPanel({ requestId }) {
  const rid = useMemo(() => safeStr(requestId), [requestId]);

  const [uid, setUid] = useState("");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [published, setPublished] = useState([]); // /messages
  const [pendingMine, setPendingMine] = useState([]); // /pendingMessages (staff only)

  const [text, setText] = useState("");
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  const threadRef = useRef(null);
  const fileInputRef = useRef(null);
  const sendLockRef = useRef(false);

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
        setPublished(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
        setPendingMine(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
    if (!rid || !open) return;
    markRequestChatRead({ requestId: rid, role: "staff" }).catch(() => {});
  }, [rid, open]);

  /* ---------- lock body scroll ---------- */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* ---------- smooth open animation ---------- */
  useEffect(() => {
    if (!open) {
      setMounted(false);
      return;
    }
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
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

  /* ---------- auto scroll ---------- */
  useEffect(() => {
    if (!open) return;
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, timeline.length]);

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
      // ✅ Best: use bundle when both exist (ONE pending doc)
      if (pdf && t) {
        await sendPendingBundle({
          requestId: rid,
          fromRole: "staff",
          toRole: "user",
          text: t,
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
        });
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

  const modal = (
    <div className="fixed inset-0 z-[9999]">
      {/* overlay */}
      <button
        type="button"
        className={[
          "absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity",
          mounted ? "opacity-100" : "opacity-0",
        ].join(" ")}
        onClick={() => setOpen(false)}
        aria-label="Close chat overlay"
      />

      {/* sheet */}
      <div
        className={[
          "absolute inset-x-0 bottom-0 top-0 bg-white dark:bg-zinc-900/60 flex flex-col",
          "sm:inset-y-6 sm:left-1/2 sm:h-auto sm:max-h-[85vh] sm:w-[min(520px,92vw)] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-zinc-200",
          "shadow-[0_20px_60px_rgba(0,0,0,0.20)]",
          "transition-transform transition-opacity duration-200",
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
        ].join(" ")}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 p-4">
          <div className="min-w-0">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">Request Chat</div>
            <div className="text-xs text-zinc-500">Staff → Admin → User moderation</div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 active:scale-[0.99]"
            title="Close"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* error */}
        {err ? (
          <div className="px-4 pt-3">
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {err}
            </div>
          </div>
        ) : null}

        {/* messages */}
        <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 bg-zinc-50 dark:bg-zinc-950">
          {timeline.length === 0 ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">No messages yet.</div>
          ) : (
            <div className="grid gap-2">
              {timeline.map((item) => {
                const m = item.data || {};
                const kind = item._kind;

                const fromRole = String(m?.fromRole || "").toLowerCase();
                const mine = fromRole === "staff";

                const time = formatTime(pickCreatedAt(m));

                const pendingStatus = String(m?.status || "pending").toLowerCase();
                const isRejectedLike =
                  pendingStatus === "rejected" || pendingStatus === "hidden";

                const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm";
                const bubbleMine = "bg-emerald-600 text-white";
                const bubbleOther = "bg-white dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800";
                const bubbleRejected = "bg-rose-50 text-rose-800 border border-rose-200";

                let statusChip = null;
                if (kind === "pending" && mine) {
                  statusChip = isRejectedLike ? (
                    <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                      Rejected
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      Pending
                    </span>
                  );
                }

                const bubbleCls =
                  kind === "pending" && mine && isRejectedLike
                    ? bubbleRejected
                    : mine
                    ? bubbleMine
                    : bubbleOther;

                return (
                  <div
                    key={item.id}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`${bubbleBase} ${bubbleCls}`}>
                      <RenderMessageBody m={m} mine={mine} />

                      <div
                        className={[
                          "mt-1 flex items-center justify-between gap-3 text-[10px]",
                          mine ? "text-white/70" : "text-zinc-400",
                        ].join(" ")}
                      >
                        <span className="font-semibold">
                          {roleLabel(m.fromRole)} → {roleLabel(m.toRole)}
                          {statusChip}
                        </span>
                        <span className="font-medium">{time}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="h-2" />
        </div>

        {/* composer */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={onPickFile}
          />

          {/* picked file chip */}
          {pickedPdf ? (
            <div className="mb-2 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-2 text-xs">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pickedPdf.name}</span>
              <span className="text-zinc-500">
                {pickedPdf.size ? `${pickedPdf.size} bytes` : ""}
              </span>
              <button
                type="button"
                onClick={() => setPickedPdf(null)}
                className="ml-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
              >
                Remove
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openPicker}
              disabled={sending}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
              title="Attach PDF"
            >
              <IconPlus className="h-5 w-5" />
            </button>

            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              className="h-11 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-4 text-sm outline-none focus:border-emerald-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending && canSend) sendNow();
                }
              }}
            />

            <button
              type="button"
              onClick={sendNow}
              disabled={sending || !canSend}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 active:scale-[0.99]"
              title="Send"
            >
              <IconSend className="h-5 w-5" />
              Send
            </button>
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">
            Your messages go to admin first for approval.
          </div>
        </div>
      </div>
    </div>
  );

  // Count to show on button: published visible + pending mine
  const buttonCount = useMemo(() => {
    const pendingCount = pendingMine.filter((p) => {
      const st = String(p?.status || "pending").toLowerCase();
      return st === "pending" || st === "rejected" || st === "hidden";
    }).length;
    return (visiblePublished?.length || 0) + pendingCount;
  }, [pendingMine, visiblePublished]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={openBtn}>
        <IconChat className="h-5 w-5" />
        Chat <span className={badge}>{buttonCount}</span>
      </button>

      {open ? createPortal(modal, document.body) : null}
    </>
  );
}


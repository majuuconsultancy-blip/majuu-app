// ✅ src/components/StaffRequestChatPanel.jsx
// Staff Chat (Portal modal, mobile-first, perfect overlay)
// - Single timeline: published + staff pending
// - Staff outgoing shows: Pending (amber) OR Rejected (red)
// - Delivered = when admin approves (message appears in /messages)
// - If admin hides OR rejects => we show "Rejected" on the pending bubble
// - Clean input bar: + | input | send
// - Blur overlay + smooth slide animation
// - Timestamps + auto-scroll
// - Marks read when opened

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { sendPendingPdf, sendPendingText, markRequestChatRead } from "../services/chatservice";

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
  return doc?.createdAt || doc?.approvedAt || doc?.editedAt || doc?.rejectedAt || doc?.hiddenAt || null;
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "user") return "User";
  if (r === "staff") return "Staff";
  return "Admin";
}

function msgPreview(m) {
  const type = String(m?.type || "text").toLowerCase();
  if (type === "pdf") return `📎 ${m?.pdfMeta?.name || "document.pdf"}`;
  return safeStr(m?.text || "");
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
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  const threadRef = useRef(null);

  /* ---------- auth (needed to filter staff pending) ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid || ""));
    return () => unsub();
  }, []);

  /* ---------- listeners ---------- */
  useEffect(() => {
    if (!rid) return;

    // ✅ approved/published
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

    // ✅ staff pending (mine) — shows instantly after send
    // Note: this query usually works without custom index (where + orderBy).
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
        // don’t hard-fail the whole chat if this index errors; still show published
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
    // Any published message that came from approving a pending message will have sourcePendingId
    const approvedPendingIds = new Set(
      visiblePublished.map((m) => safeStr(m?.sourcePendingId)).filter(Boolean)
    );

    // pending mine: show only those NOT approved yet, OR those rejected/hidden
    const pendingItems = pendingMine
      .filter((p) => {
        const st = String(p?.status || "pending").toLowerCase();
        const isRejectedLike = st === "rejected" || st === "hidden";
        const isApproved = approvedPendingIds.has(String(p.id));
        // If approved, we will show the delivered message from /messages instead (avoid duplicate).
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

  /* ---------- actions ---------- */
  const sendNow = async () => {
    setErr("");
    const t = safeStr(text);
    if (!t || !rid) return;

    setSending(true);
    try {
      await sendPendingText({
        requestId: rid,
        fromRole: "staff",
        toRole: "user",
        text: t,
      });
      setText("");
      // ✅ No need to manually push to UI — pending listener will show instantly
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const sendPdfMeta = async () => {
    setErr("");
    const name = safeStr(prompt("PDF name (example: passport.pdf)") || "");
    if (!name || !rid) return;

    setSending(true);
    try {
      await sendPendingPdf({
        requestId: rid,
        fromRole: "staff",
        toRole: "user",
        pdfMeta: { name, size: 0, mime: "application/pdf", note: "" },
      });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Send PDF failed.");
    } finally {
      setSending(false);
    }
  };

  /* ---------- UI styles ---------- */
  const openBtn =
    "inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]";
  const badge =
    "rounded-full border border-white/30 bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white";

  const modal = (
    <div className="fixed inset-0 z-[9999]">
      {/* overlay (blur + dim) */}
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
          "absolute inset-x-0 bottom-0 top-0 bg-white flex flex-col",
          "sm:inset-y-6 sm:left-1/2 sm:h-auto sm:max-h-[85vh] sm:w-[min(500px,92vw)] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-zinc-200",
          "shadow-[0_20px_60px_rgba(0,0,0,0.20)]",
          "transition-transform transition-opacity duration-200",
          mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3",
        ].join(" ")}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4">
          <div className="min-w-0">
            <div className="font-semibold text-zinc-900">Request Chat</div>
            <div className="text-xs text-zinc-500">Staff → Admin → User moderation</div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:scale-[0.99]"
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

        {/* messages (ONLY this scrolls) */}
        <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 bg-zinc-50">
          {timeline.length === 0 ? (
            <div className="text-sm text-zinc-600">No messages yet.</div>
          ) : (
            <div className="grid gap-2">
              {timeline.map((item) => {
                const m = item.data || {};
                const kind = item._kind;

                const fromRole = String(m?.fromRole || "").toLowerCase();
                const mine = fromRole === "staff"; // staff outgoing on right

                const time = formatTime(pickCreatedAt(m));

                // pending status for staff outgoing
                const pendingStatus = String(m?.status || "pending").toLowerCase();
                const isRejectedLike = pendingStatus === "rejected" || pendingStatus === "hidden";

                const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm";
                const bubbleMine = "bg-emerald-600 text-white";
                const bubbleOther = "bg-white text-zinc-900 border border-zinc-200";

                const bubbleRejected = "bg-rose-50 text-rose-800 border border-rose-200";

                // label row under text
                let statusChip = null;
                if (kind === "pending" && mine) {
                  if (isRejectedLike) {
                    statusChip = (
                      <span className="ml-2 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        Rejected
                      </span>
                    );
                  } else {
                    statusChip = (
                      <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        Pending
                      </span>
                    );
                  }
                }

                const bubbleCls =
                  kind === "pending" && mine && isRejectedLike
                    ? bubbleRejected
                    : mine
                    ? bubbleMine
                    : bubbleOther;

                return (
                  <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`${bubbleBase} ${bubbleCls}`}>
                      <div className="break-words whitespace-pre-wrap">{msgPreview(m)}</div>

                      <div className={`mt-1 flex items-center justify-between gap-3 text-[10px] ${mine ? "text-white/70" : "text-zinc-400"}`}>
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

        {/* input bar (pinned) */}
        <div className="border-t border-zinc-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={sendPdfMeta}
              disabled={sending}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
              title="Attach (PDF meta)"
            >
              <IconPlus className="h-5 w-5" />
            </button>

            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none focus:border-emerald-200"
            />

            <button
              type="button"
              onClick={sendNow}
              disabled={sending || !safeStr(text)}
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

  // Count to show on button: published visible + pending mine not approved yet
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
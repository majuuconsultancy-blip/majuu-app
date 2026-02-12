// ✅ src/components/AdminRequestChatPanel.jsx
// Admin real-chat view (FIXED bottom cut + perfect scroll):
// - Sticky header + sticky composer
// - Only the thread scrolls
// - Single timeline (published + pending)
// - Left = User, Right = Staff & Admin
// - Pending messages from BOTH user & staff have Accept/Hide
// - Hide makes message disappear instantly (optimistic UI)
// - Admin sends DIRECT only (text + optional pdf meta)
// ✅ Fixes included:
// - composerRef + spacer so last message never hides under composer
// - scrollToBottom uses rAF x2 to wait for layout paint (no “cuts one message”)

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import {
  adminApprovePendingMessage,
  adminHidePendingMessage,
  adminSendTextDirect,
  adminSendPdfMetaDirect,
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
  return doc?.createdAt || doc?.approvedAt || doc?.editedAt || doc?.rejectedAt || null;
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

  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");

  // ✅ Optimistic hide: disappear instantly
  const [optimisticHidden, setOptimisticHidden] = useState(() => new Set());

  // admin composer
  const [sendTo, setSendTo] = useState("user"); // user | staff
  const [text, setText] = useState("");
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef(null);
  const threadRef = useRef(null);
  const composerRef = useRef(null);

  /* ---------- scroll helper ---------- */
  const scrollToBottom = () => {
    const el = threadRef.current;
    if (!el) return;

    // wait for layout/paint to avoid “cuts last message”
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      });
    });
  };

  /* ---------- listeners ---------- */
  useEffect(() => {
    if (!rid) return;

    // ✅ ONLY status == pending, so approve/hide removes from list immediately
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

  /* ---------- build a single timeline ---------- */
  const timeline = useMemo(() => {
    const hidden = optimisticHidden;

    const pendingItems = pending
      .filter((p) => !hidden.has(p.id))
      .map((p) => ({
        _kind: "pending",
        _pid: p.id,
        id: `p_${p.id}`,
        createdAtMs: tsToMillis(pickCreatedAt(p)) || 0,
        data: p,
      }));

    const publishedItems = published.map((m) => ({
      _kind: "published",
      id: `m_${m.id}`,
      createdAtMs: tsToMillis(pickCreatedAt(m)) || 0,
      data: m,
    }));

    const all = [...publishedItems, ...pendingItems];
    all.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return all;
  }, [pending, published, optimisticHidden]);

  // ✅ Scroll whenever the timeline changes or errors show/hide
  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.length, err]);

  /* ---------- moderation actions ---------- */
  const optimisticRemovePending = (pendingId) => {
    setOptimisticHidden((prev) => {
      const next = new Set(prev);
      next.add(pendingId);
      return next;
    });
  };

  const approve = async (p) => {
    setErr("");
    setBusyId(p.id);
    optimisticRemovePending(p.id);
    try {
      await adminApprovePendingMessage({ requestId: rid, pendingId: p.id });
    } catch (e) {
      console.error(e);
      // rollback if failed
      setOptimisticHidden((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      setErr(e?.message || "Approve failed.");
    } finally {
      setBusyId("");
    }
  };

  const hideMsg = async (p) => {
    setErr("");
    setBusyId(p.id);
    optimisticRemovePending(p.id);
    try {
      await adminHidePendingMessage({ requestId: rid, pendingId: p.id });
    } catch (e) {
      console.error(e);
      // rollback if failed
      setOptimisticHidden((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      setErr(e?.message || "Hide failed.");
    } finally {
      setBusyId("");
    }
  };

  /* ---------- admin direct send ---------- */
  const openPicker = () => fileInputRef.current?.click();

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setPickedPdf({
      name: f.name || "document.pdf",
      size: Number(f.size || 0) || 0,
      mime: f.type || "application/pdf",
    });

    // allow picking the same file again later
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
      // ✅ Admin sends DIRECT only
      if (pdf) {
        await adminSendPdfMetaDirect({
          requestId: rid,
          toRole: sendTo,
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
        });
      }

      if (t) {
        await adminSendTextDirect({ requestId: rid, toRole: sendTo, text: t });
      }

      setText("");
      setPickedPdf(null);

      // ✅ scroll after send (even before snapshot arrives)
      scrollToBottom();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Send failed.");
    } finally {
      setSending(false);
    }
  };

  /* ---------- UI ---------- */
  const card = "rounded-2xl border border-zinc-200 bg-white shadow-xl";
  const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap";
  const bubbleLeft = "bg-white text-zinc-900 border border-zinc-200";
  const bubbleRight = "bg-emerald-600 text-white";

  const smallBtn =
    "inline-flex items-center justify-center rounded-xl border px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-60";

  const composerHeight = composerRef.current?.offsetHeight || 92;

  return (
    // ✅ Single, clean layout: header (sticky) + thread (scroll) + composer (sticky)
    <div className={`w-full ${card} h-[85vh] max-h-[85vh] overflow-hidden`}>
      {/* header */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70">
            <IconChat className="h-5 w-5 text-emerald-800" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-zinc-900">Request chat</div>
            <div className="text-xs text-zinc-500">
              Left = User • Right = Staff & Admin • Accept/Hide pending inline.
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
              className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>

      {/* body */}
      <div className="flex h-full flex-col">
        {/* error */}
        {err ? (
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {err}
            </div>
          </div>
        ) : null}

        {/* thread (ONLY SCROLL AREA) */}
        <div className="flex-1 px-4 pb-3 pt-4 overflow-hidden">
          <div
            ref={threadRef}
            className="h-full overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50/50 p-3"
          >
            {timeline.length === 0 ? (
              <div className="text-sm text-zinc-600">No messages yet.</div>
            ) : (
              <div className="grid gap-2">
                {timeline.map((item) => {
                  const m = item.data || {};
                  const fromRole = String(m.fromRole || "").toLowerCase();

                  // left=user, right=staff+admin
                  const isLeft = fromRole === "user";
                  const bubbleCls = isLeft ? bubbleLeft : bubbleRight;

                  const time = formatTime(pickCreatedAt(m));
                  const isPending = item._kind === "pending";

                  // ✅ Accept/Hide for BOTH user + staff pending messages (not admin)
                  const showActions = isPending && (fromRole === "user" || fromRole === "staff");

                  return (
                    <div key={item.id} className={`flex ${isLeft ? "justify-start" : "justify-end"}`}>
                      <div className={`${bubbleBase} ${bubbleCls}`}>
                        <div
                          className={`flex items-center justify-between gap-3 text-[11px] ${
                            isLeft ? "text-zinc-500" : "text-white/80"
                          }`}
                        >
                          <span className="font-semibold">
                            {roleLabel(fromRole)}
                            {isPending ? (
                              <span
                                className={`ml-2 font-semibold ${
                                  isLeft ? "text-amber-700" : "text-white/90"
                                }`}
                              >
                                • Pending
                              </span>
                            ) : null}
                          </span>
                          <span className="font-medium">{time}</span>
                        </div>

                        <div className="mt-1 break-words">{msgPreview(m)}</div>

                        {showActions ? (
                          <div className={`mt-2 flex gap-2 ${isLeft ? "" : "justify-end"}`}>
                            <button
                              type="button"
                              onClick={() => approve(m)}
                              disabled={busyId === m.id}
                              className={`${smallBtn} border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700`}
                            >
                              {busyId === m.id ? "…" : "Accept"}
                            </button>

                            <button
                              type="button"
                              onClick={() => hideMsg(m)}
                              disabled={busyId === m.id}
                              className={`${smallBtn} border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50`}
                            >
                              {busyId === m.id ? "…" : "Hide"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ✅ Spacer so last message never hides under sticky composer */}
            <div style={{ height: composerHeight }} />
          </div>
        </div>

        {/* composer (sticky bottom) */}
        <div
          ref={composerRef}
          className="sticky bottom-0 z-20 border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
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
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              <option value="user">To User</option>
              <option value="staff">To Staff</option>
            </select>
          </div>

          {pickedPdf ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs">
              <span className="font-semibold text-zinc-900">{pickedPdf.name}</span>
              <span className="text-zinc-500">{pickedPdf.size ? `${pickedPdf.size} bytes` : ""}</span>
              <button
                type="button"
                onClick={() => setPickedPdf(null)}
                className="ml-1 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Remove
              </button>
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:scale-[0.99]"
              title="Attach PDF meta (demo)"
            >
              <IconPlus className="h-5 w-5" />
            </button>

            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type admin message…"
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-200"
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60 active:scale-[0.99]"
            >
              <IconSend className="h-5 w-5" />
              Send
            </button>
          </div>

          <div className="mt-2 text-[11px] text-zinc-500">
            Demo: attaching a PDF sends meta only (no storage yet).
          </div>
        </div>
      </div>
    </div>
  );
}
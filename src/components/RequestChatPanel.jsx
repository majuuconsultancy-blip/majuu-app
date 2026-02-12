// ✅ src/components/RequestChatPanel.jsx
// ChatGPT-like:
// - Published messages: /messages
// - Pending instantly shown: optimistic + /pendingMessages(fromUid==me)
// - + button picks PDF (metadata-only demo)
// - Single send sends text, pdf, or both
// - Status dots: pending (•), delivered (••), rejected

import { useEffect, useMemo, useRef, useState } from "react";
import { onSnapshot, collection, query, orderBy, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import { sendPendingText, sendPendingPdf, markRequestChatRead } from "../services/chatservice";

function safeStr(x) {
  return String(x || "").trim();
}

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "user") return "You";
  if (r === "staff") return "Staff";
  return "Admin";
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

  if (s === "approved" || s === "delivered") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/80">
        <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/80">
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
    </span>
  );
}

// ✅ Match optimistic to real pending by content + time window
function samePending(a, b) {
  const at = String(a?.type || "text").toLowerCase();
  const bt = String(b?.type || "text").toLowerCase();
  if (at !== bt) return false;

  if (at === "text") {
    return safeStr(a?.text) !== "" && safeStr(a?.text) === safeStr(b?.text);
  }

  // pdf
  const an = safeStr(a?.pdfMeta?.name);
  const bn = safeStr(b?.pdfMeta?.name);
  const as = Number(a?.pdfMeta?.size || 0) || 0;
  const bs = Number(b?.pdfMeta?.size || 0) || 0;

  // name is the main thing in your demo
  if (!an || !bn) return false;
  if (an !== bn) return false;

  // size can be missing sometimes, so only compare if both exist
  if (as > 0 && bs > 0 && as !== bs) return false;

  return true;
}

export default function RequestChatPanel({ requestId, role = "user", onClose }) {
  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const myRole = useMemo(() => String(role || "user").toLowerCase(), [role]);

  const myUid = auth.currentUser?.uid || "";

  const [published, setPublished] = useState([]);
  const [pendingMine, setPendingMine] = useState([]);

  // ✅ optimistic pending (so UI updates instantly)
  const [optimistic, setOptimistic] = useState([]);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  const [text, setText] = useState("");

  const fileInputRef = useRef(null);
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const scrollRef = useRef(null);

  const card = "rounded-2xl border border-zinc-200 bg-white shadow-xl";
  const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap";

  // ✅ published listener
  useEffect(() => {
    if (!rid) return;

    const qy = query(
      collection(db, "serviceRequests", rid, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setPublished(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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

  // ✅ pending listener (NO orderBy -> avoids composite index requirement)
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
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // sort client-side by createdAt
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

  // ✅ mark read (don’t break UI if rules block it)
  useEffect(() => {
    if (!rid) return;
    if (!myUid) return;
    if (myRole !== "user" && myRole !== "staff") return;

    markRequestChatRead({ requestId: rid, role: myRole }).catch((e) => {
      console.warn("markRequestChatRead failed:", e?.message || e);
    });
  }, [rid, myUid, myRole, published.length]);

  // map delivered pending -> published
  const publishedByPendingId = useMemo(() => {
    const map = new Map();
    published.forEach((m) => {
      const pid = safeStr(m.sourcePendingId);
      if (pid) map.set(pid, true);
    });
    return map;
  }, [published]);

  // ✅ remove optimistic once real pending appears (prevents duplicates)
  const optimisticDeduped = useMemo(() => {
    const WINDOW_MS = 8000; // match optimistic to real pending within 8s

    return optimistic.filter((o) => {
      const oMs = Number(o.createdAtMs || 0) || 0;
      const oData = o.data || {};

      // if a real pending exists with same content & close timestamp, drop optimistic
      const matched = pendingMine.some((p) => {
        const pMs = tsToMillis(p.createdAt);
        if (!pMs || !oMs) return false;
        if (Math.abs(pMs - oMs) > WINDOW_MS) return false;
        return samePending(oData, p);
      });

      if (matched) return false;

      // also expire old optimistic after 60s
      return Date.now() - oMs < 60_000;
    });
  }, [optimistic, pendingMine]);

  // build timeline
  const timeline = useMemo(() => {
    const pendingVisible = pendingMine
      .filter((p) => {
        const st = String(p.status || "pending").toLowerCase();
        if (st === "rejected") return true;
        if (publishedByPendingId.get(p.id)) return false; // delivered
        return true;
      })
      .map((p) => ({
        _kind: "pending",
        id: `p_${p.id}`,
        createdAtMs: tsToMillis(p.createdAt),
        data: p,
      }));

    const publishedItems = published.map((m) => ({
      _kind: "published",
      id: `m_${m.id}`,
      createdAtMs: tsToMillis(m.createdAt),
      data: m,
    }));

    const optimisticItems = optimisticDeduped.map((o) => ({
      _kind: "optimistic",
      id: o.id,
      createdAtMs: o.createdAtMs,
      data: o.data,
    }));

    const all = [...publishedItems, ...pendingVisible, ...optimisticItems];
    all.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return all;
  }, [published, pendingMine, optimisticDeduped, publishedByPendingId]);

  // auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const toRole = myRole === "user" ? "staff" : "user";

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
    setOptimistic((prev) => [
      ...prev,
      {
        id: `o_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        createdAtMs: Date.now(),
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

    setSending(true);
    try {
      // show instantly
      if (pdf) {
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
      }

      if (t) {
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
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to send.");
    } finally {
      setSending(false);
    }
  };

  const renderBubble = (item) => {
    const m = item.data || {};
    const fromRole = String(m.fromRole || "").toLowerCase();
    const mine = fromRole === myRole;

    const type = String(m.type || "text").toLowerCase();
    const isPdf = type === "pdf";

    const status =
      item._kind === "published"
        ? "delivered"
        : String(m.status || "pending").toLowerCase();

    return (
      <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div
          className={`${bubbleBase} ${
            mine
              ? "bg-emerald-600 text-white"
              : "bg-white text-zinc-900 border border-zinc-200"
          }`}
        >
          <div
            className={`flex items-center justify-between gap-3 text-[11px] ${
              mine ? "text-white/80" : "text-zinc-500"
            }`}
          >
            <span>{roleLabel(fromRole)}</span>
            {mine ? <StatusDots status={status} /> : null}
          </div>

          {isPdf ? (
            <div className="mt-1">
              <div className="font-semibold">PDF</div>
              <div className="text-xs opacity-90">
                {m?.pdfMeta?.name || "document.pdf"}
                {m?.pdfMeta?.size ? ` • ${m.pdfMeta.size} bytes` : ""}
              </div>
            </div>
          ) : (
            <div className="mt-1">{m.text}</div>
          )}

          {status === "rejected" ? (
            <div className="mt-2 rounded-xl bg-white/10 px-2 py-1 text-[11px] text-white/90">
              Rejected by admin.
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className={`w-full max-w-xl ${card}`}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900">Chat</div>
            <div className="text-xs text-zinc-500">
              Messages are reviewed by Admin before delivery.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            title="Close"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* body */}
        <div className="p-4">
          {err ? (
            <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {err}
            </div>
          ) : null}

          <div
            ref={scrollRef}
            className="h-[50vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50/50 p-3"
          >
            {loading ? (
              <div className="text-sm text-zinc-600">Loading chat…</div>
            ) : timeline.length === 0 ? (
              <div className="text-sm text-zinc-600">No messages yet. Say hello 👋</div>
            ) : (
              <div className="grid gap-2">{timeline.map(renderBubble)}</div>
            )}
          </div>

          {/* composer */}
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={onPickFile}
            />

            {pickedPdf ? (
              <div className="mb-2 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs">
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:scale-[0.99]"
                title="Attach PDF (demo)"
              >
                <IconPlus className="h-5 w-5" />
              </button>

              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message…"
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-200"
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
              Demo: attaching a PDF sends META only (no upload yet).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
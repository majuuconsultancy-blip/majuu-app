// ✅ src/components/AdminRequestChatPanel.jsx (FULL COPY-PASTE)
// FIX (FINAL):
// - Accept: buttons disappear and NEVER come back (even if approve fails).
// - Hide: removes message instantly (optimistic).
// - Bundles: Accept/Hide applies to ALL pending children (pdf+text).
// - Persist "no actions" in sessionStorage so remounts don’t bring buttons back.
// Backend unchanged.

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

/* ✅ autosize textarea like ChatGPT */
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

/* ✅ UI-only merge rule for adjacent pdf+text */
function shouldMergePair(a, b, WINDOW_MS) {
  if (!a || !b) return false;

  const aFromRole = String(a?.fromRole || "").toLowerCase();
  const bFromRole = String(b?.fromRole || "").toLowerCase();
  if (aFromRole !== bFromRole) return false;

  const aFromUid = safeStr(a?.fromUid);
  const bFromUid = safeStr(b?.fromUid);
  if (aFromUid && bFromUid && aFromUid !== bFromUid) return false;

  const aType = String(a?.type || "text").toLowerCase();
  const bType = String(b?.type || "text").toLowerCase();
  const pairOk =
    (aType === "pdf" && bType === "text") || (aType === "text" && bType === "pdf");
  if (!pairOk) return false;

  const aMs = Number(a?._createdAtMs || 0) || 0;
  const bMs = Number(b?._createdAtMs || 0) || 0;
  if (!aMs || !bMs) return false;

  return Math.abs(bMs - aMs) <= WINDOW_MS;
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

  const [busyKey, setBusyKey] = useState(""); // message id or bundle id
  const [err, setErr] = useState("");

  // ✅ Hide removes message instantly (optimistic)
  const [optimisticHidden, setOptimisticHidden] = useState(() => new Set());

  // ✅ Accept removes buttons instantly and NEVER rolls back
  const [optimisticNoActions, setOptimisticNoActions] = useState(() => new Set());

  // admin composer
  const [sendTo, setSendTo] = useState("user"); // user | staff
  const [text, setText] = useState("");
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef(null);
  const threadRef = useRef(null);
  const composerRef = useRef(null);

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
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noActionsKey]);

  useEffect(() => {
    if (!noActionsKey) return;
    try {
      sessionStorage.setItem(noActionsKey, JSON.stringify([...optimisticNoActions]));
    } catch {
      // ignore
    }
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

  useEffect(() => {
    scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.length, err]);

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

    // ✅ Accept: hide buttons immediately & permanently
    pendingChildren.forEach((c) => disableActionsOptimistic(c.id));

    try {
      for (const c of pendingChildren) {
        await adminApprovePendingMessage({ requestId: rid, pendingId: c.id });
      }
    } catch (e) {
      console.error(e);
      // ✅ DO NOT rollback button hide (this is the “once and for all” fix)
      setErr(e?.message || "Approve failed (buttons will stay hidden).");
    } finally {
      setBusyKey("");
    }
  };

  const hideBundle = async (bundleId, pendingChildren) => {
    setErr("");
    if (!pendingChildren?.length) return;

    setBusyKey(bundleId);

    // ✅ Hide: remove bubble instantly
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

    // ✅ Accept: hide buttons immediately & permanently
    disableActionsOptimistic(p.id);

    try {
      await adminApprovePendingMessage({ requestId: rid, pendingId: p.id });
    } catch (e) {
      console.error(e);
      // ✅ DO NOT rollback button hide
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
  const card = "rounded-2xl border border-zinc-200 bg-white shadow-xl";
  const bubbleBase = "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap";
  const bubbleLeft = "bg-white text-zinc-900 border border-zinc-200";
  const bubbleRight = "bg-emerald-600 text-white";

  const smallBtn =
    "inline-flex items-center justify-center rounded-xl border px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-60";

  const composerHeight = composerRef.current?.offsetHeight || 92;

  return (
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
        {err ? (
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {err}
            </div>
          </div>
        ) : null}

        {/* thread */}
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

                  const isLeft = fromRole === "user";
                  const bubbleCls = isLeft ? bubbleLeft : bubbleRight;

                  const time = formatTime(pickCreatedAt(m));

                  const isBundleView =
                    item._kind === "bundle_view" ||
                    String(m.type || "").toLowerCase() === "bundle_view";

                  const pendingChildren = isBundleView ? item._pendingChildren || [] : [];

                  const isPending =
                    item._kind === "pending" || (isBundleView && pendingChildren.length > 0);

                  const originOk = fromRole === "user" || fromRole === "staff";

                  const bundleHasActionable =
                    isBundleView &&
                    pendingChildren.some((c) => !optimisticNoActions.has(c.id));

                  const showActions =
                    originOk &&
                    ((item._kind === "pending" && !optimisticNoActions.has(m.id)) ||
                      (isBundleView && bundleHasActionable));

                  const busy = busyKey === m.id || busyKey === item.id;

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

                        {isBundleView ? (
                          <div className="mt-1 grid gap-2">
                            {safeStr(m.text) ? <div className="break-words">{m.text}</div> : null}

                            {m?.pdfMeta?.name ? (
                              <div className={`${isLeft ? "bg-zinc-50" : "bg-white/10"} rounded-xl p-2`}>
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
                              className={`${smallBtn} border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50`}
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

            <div style={{ height: composerHeight }} />
          </div>
        </div>

        {/* composer */}
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

          <div className="mt-2 flex items-end gap-2">
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:scale-[0.99]"
              title="Attach PDF meta (demo)"
            >
              <IconPlus className="h-5 w-5" />
            </button>

            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type admin message…"
              rows={1}
              className="w-full resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-200"
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
            <span className="ml-2">Enter = send, Shift+Enter = new line.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
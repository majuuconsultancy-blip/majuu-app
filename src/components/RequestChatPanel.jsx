// ✅ src/components/RequestChatPanel.jsx (FULL COPY-PASTE)
// CHANGE ONLY:
// ✅ Default back button (Android/browser) now returns to RequestStatusScreen for this request
// - Pushes one history state when chat opens (so Back closes chat instead of leaving the request)
// - Handles popstate to: close modal + navigate to /app/request/:id (replace)
// - Close (X) button does the same (so behavior is consistent)
//
// Everything else untouched.

import { useEffect, useMemo, useRef, useState } from "react";
import { onSnapshot, collection, query, orderBy, where } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { sendPendingText, sendPendingPdf } from "../services/chatservice";

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
        <span className="h-1.5 w-1.5 rounded-full bg-white/80 dark:bg-zinc-900/60" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/80 dark:bg-zinc-900/60" />
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/80">
      <span className="h-1.5 w-1.5 rounded-full bg-white/80 dark:bg-zinc-900/60" />
    </span>
  );
}

// ✅ autosize textarea like ChatGPT
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

/* ---------------- UI-only merge (adjacent pdf + text) ---------------- */
function shouldMergePair(a, b, WINDOW_MS) {
  if (!a || !b) return false;

  const aFromRole = String(a?.fromRole || "").toLowerCase();
  const bFromRole = String(b?.fromRole || "").toLowerCase();
  const aFromUid = safeStr(a?.fromUid);
  const bFromUid = safeStr(b?.fromUid);

  if (aFromRole !== bFromRole) return false;
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
    if (oType === "combo") {
      if (pt === "text" && wantText && safeStr(p?.text) === wantText) return true;
      if (pt === "pdf" && wantPdf && safeStr(p?.pdfMeta?.name) === wantPdf) return true;
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

    if (oType === "combo") {
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

  // ✅ BACK FIX: add a "chat layer" history entry and intercept Back
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

  const [text, setText] = useState("");

  const fileInputRef = useRef(null);
  const [pickedPdf, setPickedPdf] = useState(null); // { name, size, mime }
  const scrollRef = useRef(null);

  const sendLockRef = useRef(false);

  const taRef = useRef(null);
  useAutosizeTextArea(taRef, text, { maxRows: 6 });

  const card = "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xl";
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
          type: "combo",
          fromRole: myRole,
          fromUid: myUid,
          toRole,
          text: t,
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime },
          status: "pending",
        });

        await sendPendingPdf({
          requestId: rid,
          fromRole: myRole,
          toRole,
          pdfMeta: { name: pdf.name, size: pdf.size, mime: pdf.mime, note: "" },
        });

        await sendPendingText({
          requestId: rid,
          fromRole: myRole,
          toRole,
          text: t,
        });
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

    const type = String(m.type || "text").toLowerCase();
    const isPdf = type === "pdf";
    const isBundleView = type === "bundle_view" || item._kind === "bundle_view";
    const isComboOptimistic = type === "combo" && item._kind === "optimistic";

    const status =
      item._kind === "published" ? "delivered" : String(m.status || "pending").toLowerCase();

    return (
      <div key={item.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div
          className={`${bubbleBase} ${
            mine
              ? "bg-emerald-600 text-white"
              : "bg-white dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800"
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

          {isBundleView ? (
            <div className="mt-1 grid gap-2">
              {safeStr(m.text) ? <div>{m.text}</div> : null}

              {m?.pdfMeta?.name ? (
                <div className={`${mine ? "bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2`}>
                  <div className="text-xs font-semibold opacity-90">PDF</div>
                  <div className="text-xs opacity-90">
                    {m?.pdfMeta?.name || "document.pdf"}
                    {m?.pdfMeta?.size ? ` • ${m.pdfMeta.size} bytes` : ""}
                  </div>
                </div>
              ) : null}
            </div>
          ) : isComboOptimistic ? (
            <div className="mt-1 grid gap-2">
              {safeStr(m.text) ? <div>{m.text}</div> : null}
              {m?.pdfMeta?.name ? (
                <div className={`${mine ? "bg-white/10 dark:bg-zinc-900/60" : "bg-zinc-50 dark:bg-zinc-950"} rounded-xl p-2`}>
                  <div className="text-xs font-semibold opacity-90">PDF</div>
                  <div className="text-xs opacity-90">
                    {m?.pdfMeta?.name || "document.pdf"}
                    {m?.pdfMeta?.size ? ` • ${m.pdfMeta.size} bytes` : ""}
                  </div>
                </div>
              ) : null}
            </div>
          ) : isPdf ? (
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

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className={`w-full max-w-xl ${card}`}>
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 p-4">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Chat</div>
            <div className="text-xs text-zinc-500">Messages are reviewed before delivery.</div>
          </div>

          <button
            type="button"
            onClick={closeAndGoBack}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
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
            className="h-[50vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 p-3"
          >
            {loading ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">Loading chat…</div>
            ) : timeline.length === 0 ? (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">No messages yet.</div>
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
              <div className="mb-2 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-2 text-xs">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pickedPdf.name}</span>
                <span className="text-zinc-500">{pickedPdf.size ? `${pickedPdf.size} bytes` : ""}</span>
                <button
                  type="button"
                  onClick={() => setPickedPdf(null)}
                  className="ml-1 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50"
                >
                  Remove
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 active:scale-[0.99]"
                title="Attach PDF (demo)"
              >
                <IconPlus className="h-5 w-5" />
              </button>

              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Type a message…"
                rows={1}
                className="w-full rounded-xl px-3 py-2 text-sm
                           bg-white dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100
                           dark:bg-zinc-900
                           placeholder:text-zinc-400 dark:placeholder:text-zinc-500
                           border border-zinc-200 dark:border-zinc-800 dark:border-zinc-700
                           focus:outline-none focus:ring-2 focus:ring-emerald-500"
                style={{ overflowY: "hidden" }}
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
              Demo: attaching a PDF sends META only.
              <span className="ml-2">Enter = send, Shift+Enter = new line.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


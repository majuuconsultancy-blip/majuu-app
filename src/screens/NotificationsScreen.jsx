// ✅ NotificationsScreen.jsx (FULL COPY-PASTE)
// Fixes:
// 1) ✅ No nested <button> (outer wrapper is <div>)
// 2) ✅ Open => mark as read => goes to History (NOT deleted)
// 3) ✅ Red trash icon deletes (Inbox + History) without triggering open
// 4) ✅ Clear all deletes current tab

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase";

/* ---------- Minimal icons (no emojis) --------- */
function IconChevronLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBell(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M18 16.8H6c.9-1 1.5-2 1.5-3.7V10a4.5 4.5 0 1 1 9 0v3.1c0 1.7.6 2.7 1.5 3.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 5.5 15.5 12 9 18.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 4.8h6M6.5 7.2h11M9.2 7.2l.6 13h4.4l.6-13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ✅ safe createdAt formatter */
function formatCreatedAt(createdAt) {
  if (!createdAt) return "";

  let d = null;

  if (typeof createdAt?.toDate === "function") d = createdAt.toDate();
  else if (typeof createdAt?.seconds === "number") d = new Date(createdAt.seconds * 1000);
  else if (createdAt instanceof Date) d = createdAt;
  else if (typeof createdAt === "number") d = new Date(createdAt);
  else if (typeof createdAt === "string") {
    const parsed = new Date(createdAt);
    if (!isNaN(parsed.getTime())) d = parsed;
  }

  if (!d || isNaN(d.getTime())) return "";

  const dateStr = d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return `${dateStr} • ${timeStr}`;
}

export default function NotificationsScreen() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [notifs, setNotifs] = useState([]);
  const [tab, setTab] = useState("inbox"); // inbox | history
  const [busyId, setBusyId] = useState(""); // "clear_inbox" | "clear_history" | notifId

  const cardBase =
    "rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60";
  const cardHover =
    "transition hover:border-emerald-200 hover:bg-white hover:shadow-md dark:hover:border-emerald-900/40 dark:hover:bg-zinc-900";

  const pillBase = "rounded-full border px-3 py-1.5 text-xs font-semibold transition";
  const pillOn =
    "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200";
  const pillOff =
    "border-zinc-200 bg-white/60 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200";

  useEffect(() => {
    let unsubNotifs = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubNotifs) {
        unsubNotifs();
        unsubNotifs = null;
      }

      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setLoading(true);
      setErr("");

      const nRef = collection(db, "users", user.uid, "notifications");
      const nQ = query(nRef, orderBy("createdAt", "desc"), limit(200));

      unsubNotifs = onSnapshot(
        nQ,
        (snap) => {
          const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setNotifs(data);
          setLoading(false);
        },
        (error) => {
          console.error("Notifications listen error:", error);
          setErr(error?.message || "Failed to load notifications");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubNotifs) unsubNotifs();
    };
  }, [navigate]);

  const inbox = useMemo(() => notifs.filter((n) => !n.readAt), [notifs]);
  const history = useMemo(() => notifs.filter((n) => n.readAt), [notifs]);
  const shown = tab === "inbox" ? inbox : history;

  const deleteOne = async (n) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      setErr("");
      setBusyId(n.id);
      await deleteDoc(doc(db, "users", user.uid, "notifications", n.id));
    } catch (e) {
      console.error("Delete notification failed:", e);
      setErr(e?.message || "Failed to delete notification.");
    } finally {
      setBusyId("");
    }
  };

  const openAndMarkRead = async (n) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      setErr("");

      // mark as read (move to History)
      if (!n.readAt) {
        await updateDoc(doc(db, "users", user.uid, "notifications", n.id), {
          readAt: serverTimestamp(),
        });
      }

      const link = String(n.link || "").trim();
      if (!link) return;

      if (link.startsWith("/")) navigate(link);
      else window.open(link, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("Open/read notification failed:", e);
      setErr(e?.message || "Failed to open notification.");
    }
  };

  const clearTab = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const list = shown;
    if (!list.length) return;

    const label = tab === "inbox" ? "Inbox" : "History";
    const ok = window.confirm(`Delete ${list.length} notifications from ${label}?`);
    if (!ok) return;

    try {
      setErr("");
      setBusyId(tab === "inbox" ? "clear_inbox" : "clear_history");
      for (const n of list) {
        await deleteDoc(doc(db, "users", user.uid, "notifications", n.id));
      }
    } catch (e) {
      console.error("Clear tab failed:", e);
      setErr(e?.message || "Failed to clear notifications.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]
                           dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                <IconChevronLeft className="h-4 w-4" />
                Back
              </button>

              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Notifications
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Tap an item to open it — it moves to History.
              </p>
            </div>

            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60">
              <IconBell className="h-5 w-5 text-emerald-700 dark:text-emerald-200" />
            </div>
          </div>

          {/* Error */}
          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {/* Tabs + actions */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab("inbox")}
                className={`${pillBase} ${tab === "inbox" ? pillOn : pillOff}`}
              >
                Inbox <span className="ml-1 opacity-70">({inbox.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setTab("history")}
                className={`${pillBase} ${tab === "history" ? pillOn : pillOff}`}
              >
                History <span className="ml-1 opacity-70">({history.length})</span>
              </button>
            </div>

            <button
              type="button"
              onClick={clearTab}
              disabled={
                shown.length === 0 || busyId === "clear_inbox" || busyId === "clear_history"
              }
              className="rounded-2xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60
                         dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/55"
            >
              {busyId === "clear_inbox" || busyId === "clear_history" ? "Clearing…" : "Clear all"}
            </button>
          </div>

          {/* Content */}
          {loading ? (
            <div className="mt-4">
              <div className={cardBase}>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Loading notifications…</p>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <div className="mt-4">
              <div className={cardBase}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {tab === "inbox" ? "Inbox is empty" : "No history yet"}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {tab === "inbox" ? "New updates will appear here." : "Opened notifications will appear here."}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {shown.map((n) => {
                const unread = !n.readAt;
                const title = String(n.title || n.type || "Update");
                const body = String(n.body || "");
                const when = formatCreatedAt(n.createdAt);
                const hasLink = Boolean(String(n.link || "").trim());

                return (
                  <div key={n.id} className={`${cardBase} ${cardHover}`}>
                    <div className="flex items-start justify-between gap-3">
                      {/* open area */}
                      <button
                        type="button"
                        onClick={() => openAndMarkRead(n)}
                        className="min-w-0 flex-1 text-left"
                        style={{ cursor: "pointer" }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              unread ? "bg-rose-500" : "bg-zinc-300 dark:bg-zinc-600"
                            }`}
                          />
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                            {title}
                          </div>
                        </div>

                        {body ? (
                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{body}</div>
                        ) : null}

                        {when ? (
                          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{when}</div>
                        ) : null}

                        {hasLink ? (
                          <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99]
                                       dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/55">
                            Open
                            <IconChevronRight className="h-4 w-4" />
                          </div>
                        ) : (
                          <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">No action needed.</div>
                        )}
                      </button>

                      {/* right controls */}
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs border ${
                            unread
                              ? "bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/40"
                              : "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-200 dark:border-zinc-700"
                          }`}
                        >
                          {unread ? "New" : "Read"}
                        </span>

                        <button
                          type="button"
                          onClick={() => deleteOne(n)}
                          disabled={busyId === n.id}
                          className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50/70 p-2 text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60
                                     dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/55"
                          aria-label="Delete notification"
                          title="Delete"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
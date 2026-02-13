// ✅ StaffStartWorkModalScreen.jsx (FULL COPY-PASTE)
// Mobile-first polish + subtle animations (no functionality changes)
// - Cleaner modal sheet on mobile, centered card on desktop
// - Smooth fade/slide + button micro-interactions
// - Better spacing + visual hierarchy
// - Safe-area padding for phones

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../firebase";

/* ---------- Icons ---------- */
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

function IconPlay(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M9 7.5v9l8-4.5-8-4.5Z" fill="currentColor" />
    </svg>
  );
}

function IconBolt(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M13 2 4 14h7l-1 8 10-14h-7l0-6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function safeStr(x) {
  return String(x || "").trim();
}

export default function StaffStartWorkModalScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId } = useParams();

  const rid = useMemo(() => safeStr(requestId), [requestId]);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [req, setReq] = useState(null);

  const card = "rounded-2xl border border-zinc-200 bg-white/80 shadow-sm backdrop-blur";
  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login", { replace: true, state: { from: location.pathname } });
        return;
      }
      setUid(user.uid);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, [navigate, location.pathname]);

  useEffect(() => {
    (async () => {
      if (!rid || !uid) return;

      setLoading(true);
      setErr("");

      try {
        const rSnap = await getDoc(doc(db, "serviceRequests", rid));
        if (!rSnap.exists()) throw new Error("Request not found");

        const r = { id: rSnap.id, ...rSnap.data() };

        const assignedTo = safeStr(r.assignedTo);
        if (!assignedTo || assignedTo !== uid) {
          throw new Error("You are not assigned to this request.");
        }

        setReq(r);

        const staffStatus = String(r.staffStatus || "assigned").toLowerCase();
        const statusLower = String(r.status || "new").toLowerCase();

        const finalized = statusLower === "closed" || statusLower === "rejected";
        if (finalized || staffStatus === "in_progress" || staffStatus === "done") {
          navigate(`/staff/request/${rid}`, { replace: true });
          return;
        }
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load request.");
        setReq(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [rid, uid, navigate]);

  const startWork = async () => {
    if (!rid || !uid || !req) return;

    setBusy(true);
    setErr("");

    const nowMs = Date.now();
    const currentStatus = String(req.status || "new").toLowerCase();

    // Only write status if new -> contacted
    const requestUpdate = {
      staffStatus: "in_progress",
      staffDecision: "none",
      staffCompletedAt: null,

      staffStartedAt: serverTimestamp(),
      staffStartedAtMs: nowMs,
      staffStartedBy: uid,

      staffUpdatedAt: serverTimestamp(),
    };

    if (currentStatus === "new") {
      requestUpdate.status = "contacted";
    }

    try {
      // 1) update request (this is the main thing)
      await updateDoc(doc(db, "serviceRequests", rid), requestUpdate);

      // 2) update task doc ONLY if it exists under THIS uid
      const taskRef = doc(db, "staff", uid, "tasks", rid);
      const taskSnap = await getDoc(taskRef);

      if (taskSnap.exists()) {
        await updateDoc(taskRef, {
          status: "active",
          startedAt: serverTimestamp(),
          startedAtMs: nowMs,
        });
      } else {
        // Don’t hard-fail UX; show a clear debug message
        console.warn("⚠️ Task doc missing at staff/" + uid + "/tasks/" + rid);
      }

      navigate(`/staff/request/${rid}`, { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Start work failed.");
    } finally {
      setBusy(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className={pageBg}>
        <div className="max-w-xl mx-auto px-5 py-6">
          <div className={`${card} p-4 text-sm text-zinc-600`}>Preparing…</div>
        </div>
      </div>
    );
  }

  const title =
    req ? `${String(req.track || "").toUpperCase()} • ${req.country || "-"}` : "";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        {err ? (
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className={`${card} p-5 text-sm text-zinc-600`}>Loading…</div>
        ) : !req ? (
          <div className={`${card} p-5 text-sm text-zinc-600`}>
            Request not available.
          </div>
        ) : (
          <div
            className="fixed inset-0 z-50"
            style={{
              // subtle fade-in
              animation: "ssw_fadeIn 160ms ease-out both",
            }}
          >
            {/* overlay */}
            <button
              type="button"
              className="absolute inset-0 bg-black/50"
              onClick={() => navigate("/staff/tasks", { replace: true })}
              aria-label="Close"
            />

            {/* sheet/card */}
            <div
              className="absolute inset-x-0 bottom-0 top-0 flex items-end justify-center p-3 sm:items-center sm:p-6"
              style={{
                // slide up on mobile / scale on desktop
                animation: "ssw_slideUp 220ms cubic-bezier(.2,.8,.2,1) both",
              }}
            >
              <div className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
                {/* header */}
                <div className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/80">
                          <IconBolt className="h-4 w-4 text-emerald-700" />
                        </span>
                        Start work
                      </div>

                      <div className="mt-3 text-xl font-semibold tracking-tight text-zinc-900">
                        Ready to begin?
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">
                        This will move the task to <span className="font-semibold">Ongoing</span>{" "}
                        and start the timer fields.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => navigate("/staff/tasks", { replace: true })}
                      className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
                      title="Close"
                    >
                      <IconX className="h-5 w-5" />
                    </button>
                  </div>

                  {/* request card */}
                  <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                    <div className="text-[11px] font-semibold text-zinc-500">
                      Request
                    </div>
                    <div className="mt-1 text-sm font-semibold text-zinc-900">
                      {title}
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      ID: <span className="font-mono">{rid}</span>
                    </div>
                  </div>

                  {/* actions */}
                  <div className="mt-5 grid gap-2">
                    <button
                      type="button"
                      onClick={startWork}
                      disabled={busy}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                    >
                      <span
                        className={[
                          "inline-flex h-9 w-9 items-center justify-center rounded-2xl",
                          "bg-white/15 border border-white/15",
                        ].join(" ")}
                      >
                        <IconPlay className="h-5 w-5 text-white" />
                      </span>
                      {busy ? "Starting…" : "Start work"}
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate("/staff/tasks", { replace: true })}
                      disabled={busy}
                      className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
                    >
                      Not now
                    </button>
                  </div>

                  <div className="mt-3 text-xs text-zinc-500">
                    If you choose “Not now”, the request stays in New.
                  </div>

                  {/* safe-area spacer for iOS bottom bars */}
                  <div className="h-[max(0px,env(safe-area-inset-bottom))]" />
                </div>
              </div>
            </div>

            {/* tiny scoped animations */}
            <style>{`
              @keyframes ssw_fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes ssw_slideUp {
                from { transform: translateY(14px) scale(0.995); opacity: 0; }
                to { transform: translateY(0) scale(1); opacity: 1; }
              }
              @media (prefers-reduced-motion: reduce) {
                * { animation: none !important; transition: none !important; }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}
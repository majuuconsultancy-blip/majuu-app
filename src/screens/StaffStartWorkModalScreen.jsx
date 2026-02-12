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
  const pageBg = "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white";

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
          <div className={`${card} p-5 text-sm text-zinc-600`}>Request not available.</div>
        ) : (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
            <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white shadow-xl">
              <div className="flex items-start justify-between gap-3 p-5">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Start work?</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    You’re about to start this request. Timer fields will be set and the task moves to Ongoing.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate("/staff/tasks", { replace: true })}
                  className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 text-zinc-700 hover:bg-zinc-50"
                  title="Close"
                >
                  <IconX className="h-5 w-5" />
                </button>
              </div>

              <div className="px-5 pb-5">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                  <div className="text-xs font-semibold text-zinc-500">Request</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900">
                    {String(req.track || "").toUpperCase()} • {req.country || "-"}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600">
                    ID: <span className="font-mono">{rid}</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  <button
                    type="button"
                    onClick={startWork}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                  >
                    <IconPlay className="h-5 w-5 text-white" />
                    {busy ? "Starting…" : "Start work"}
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate("/staff/tasks", { replace: true })}
                    disabled={busy}
                    className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
                  >
                    Not now
                  </button>
                </div>

                <div className="mt-3 text-xs text-zinc-500">
                  If you click “Not now”, the request stays in New.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
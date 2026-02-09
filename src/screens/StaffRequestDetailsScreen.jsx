import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { auth, db } from "../firebase";

/* ---------- Minimal icons ---------- */
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

function IconDoc(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 3.8h6.2L19.2 8.8V20a2.2 2.2 0 0 1-2.2 2.2H8A2.2 2.2 0 0 1 5.8 20V6A2.2 2.2 0 0 1 8 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.2 3.8V8a.9.9 0 0 0 .9.9h4.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8.6 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.6 15.6h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20 6.8 9.7 17.1 4 11.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
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

/* ---------- Utils ---------- */
function formatDT(createdAt) {
  const sec = createdAt?.seconds;
  if (!sec) return "";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new") return { label: "New", cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
  if (s === "contacted")
    return { label: "In Progress", cls: "bg-emerald-50 text-emerald-800 border border-emerald-100" };
  if (s === "closed")
    return { label: "Accepted", cls: "bg-emerald-100 text-emerald-800 border border-emerald-200" };
  if (s === "rejected")
    return { label: "Rejected", cls: "bg-rose-50 text-rose-700 border border-rose-100" };
  return { label: s, cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
}

function safeMinutesBetween(startTs, endMs) {
  // startTs may be Firestore Timestamp or ms number
  let startMs = 0;

  if (typeof startTs === "number") startMs = startTs;
  else if (startTs?.seconds) startMs = startTs.seconds * 1000;

  if (!startMs || !endMs) return null;

  const diff = endMs - startMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;

  const mins = Math.round(diff / 60000);
  return Math.max(1, mins); // minimum 1 minute
}

export default function StaffRequestDetailsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { requestId } = useParams();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [req, setReq] = useState(null);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState("recommend_accept"); // recommend_accept | recommend_reject
  const [busy, setBusy] = useState("");

  const card = "rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur";
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

  const title = useMemo(() => {
    if (!req) return "Request";
    return `${String(req.track || "").toUpperCase()} • ${req.country || "-"}`;
  }, [req]);

  const status = String(req?.status || "new").toLowerCase();
  const staffStatus = String(req?.staffStatus || "assigned").toLowerCase(); // assigned|in_progress|done
  const statusPill = useMemo(() => pill(status), [status]);

  const createdLabel = formatDT(req?.createdAt);

  const typeLabel =
    String(req?.requestType || "").toLowerCase() === "full"
      ? "Full package"
      : `Single: ${req?.serviceName || "-"}`;

  const canWork = status !== "closed" && status !== "rejected";
  const isDone = staffStatus === "done";

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const snap = await getDoc(doc(db, "serviceRequests", requestId));
      if (!snap.exists()) throw new Error("Request not found");
      const data = { id: snap.id, ...snap.data() };

      setReq(data);
      setNote(String(data.staffNote || ""));
      setDecision(String(data.staffDecision || "recommend_accept") || "recommend_accept");
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to load request.");
      setReq(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!requestId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const updateRequest = async (patch) => {
    if (!uid) throw new Error("Not signed in");
    await updateDoc(doc(db, "serviceRequests", requestId), {
      ...patch,
      staffUpdatedAt: serverTimestamp(),
    });
  };

  const updateTask = async (patch) => {
    if (!uid) throw new Error("Not signed in");
    await updateDoc(doc(db, "staff", uid, "tasks", requestId), patch);
  };

  const startWork = async () => {
    try {
      setBusy("start");
      setErr("");

      const nowMs = Date.now();

      await updateRequest({
        status: status === "new" ? "contacted" : status,
        staffStatus: "in_progress",
        staffDecision: "none",
        staffCompletedAt: null,

        staffStartedAt: serverTimestamp(), // admin will see (server)
        staffStartedAtMs: nowMs,          // fallback for duration calc
        staffStartedBy: uid,              // who started

        staffNote: String(note || "").trim(),
      });

      await updateTask({
        status: "active",
        startedAt: serverTimestamp(),
        startedAtMs: nowMs,
      });

      await load();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Start work failed (check rules).");
    } finally {
      setBusy("");
    }
  };

  const saveNote = async () => {
    try {
      setBusy("save");
      setErr("");

      await updateRequest({
        staffNote: String(note || "").trim(),
      });

      await load();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Save failed (check rules).");
    } finally {
      setBusy("");
    }
  };

  const markDone = async () => {
    try {
      setBusy("done");
      setErr("");

      const dec = String(decision || "").trim();
      if (dec !== "recommend_accept" && dec !== "recommend_reject") {
        setErr("Pick a recommendation.");
        return;
      }

      const nowMs = Date.now();

      // ✅ duration from staffStartedAt -> now (prefer server timestamp)
      const startTs = req?.staffStartedAt || req?.staffStartedAtMs;
      const workMinutes = safeMinutesBetween(startTs, nowMs);

      await updateRequest({
        status: status === "new" ? "contacted" : status,
        staffStatus: "done",
        staffDecision: dec,

        staffCompletedAt: serverTimestamp(),
        staffCompletedAtMs: nowMs,
        staffCompletedBy: uid,

        staffWorkMinutes: workMinutes, // ✅ used later by admin to update performance
        staffNote: String(note || "").trim(),
      });

      await updateTask({
        status: "done",
        doneAt: serverTimestamp(),
        doneAtMs: nowMs,
        completedAt: serverTimestamp(),
        workMinutes: workMinutes,
        staffDecision: dec,
      });

      navigate("/staff/tasks", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Mark done failed (check rules).");
    } finally {
      setBusy("");
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
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
        >
          <IconChevronLeft className="h-4 w-4" />
          Back
        </button>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className={`mt-4 ${card} p-4`}>
            <p className="text-sm text-zinc-600">Loading request…</p>
          </div>
        ) : !req ? (
          <div className={`mt-4 ${card} p-4`}>
            <p className="text-sm text-zinc-600">Request not found.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={`mt-4 ${card} p-5`}>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 border border-emerald-100">
                  <IconDoc className="h-4 w-4 text-emerald-700" />
                </span>
                Staff review
              </div>

              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</div>
                  <div className="mt-1 text-sm text-zinc-600">{typeLabel}</div>

                  {createdLabel ? (
                    <div className="mt-2 text-xs text-zinc-500">
                      Submitted: <span className="font-medium">{createdLabel}</span>
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs ${statusPill.cls}`}>
                    {statusPill.label}
                  </span>
                  <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold border border-zinc-200 bg-white/60 text-zinc-700">
                    Staff: {staffStatus.replace("_", " ")}
                  </span>
                </div>
              </div>

              {!canWork ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
                  Admin already finalized this request. You can view only.
                </div>
              ) : null}
            </div>

            {/* Applicant summary */}
            <div className={`mt-6 ${card} p-5`}>
              <div className="text-sm font-semibold text-zinc-900">Applicant</div>
              <div className="mt-1 text-sm text-zinc-600">Contact details are hidden in staff view.</div>

              <div className="mt-4 grid gap-3 text-sm">
                <div className="grid gap-1">
                  <div className="text-xs font-semibold text-zinc-500">Full name</div>
                  <div className="font-semibold text-zinc-900">{req?.name || "-"}</div>
                </div>

                {req?.note ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4">
                    <div className="text-xs font-semibold text-zinc-500">Applicant note</div>
                    <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap">{req.note}</div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
                    No note provided.
                  </div>
                )}
              </div>
            </div>

            {/* Staff note */}
            <div className={`mt-6 ${card} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Staff note</div>
                  <div className="mt-1 text-sm text-zinc-600">Internal note for admin. Save anytime.</div>
                </div>

                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!canWork || busy}
                  className="shrink-0 rounded-2xl border border-zinc-200 bg-white/60 px-3.5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
                >
                  {busy === "save" ? "Saving…" : "Save note"}
                </button>
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                placeholder="What did you find? What’s missing? Next steps?"
                disabled={!canWork || isDone}
                className="mt-4 w-full rounded-2xl border border-zinc-200 bg-white/60 p-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 min-h-[120px] disabled:opacity-70"
              />
            </div>

            {/* Staff actions */}
            <div className={`mt-6 ${card} p-5`}>
              <div className="text-sm font-semibold text-zinc-900">Staff actions</div>
              <div className="mt-1 text-sm text-zinc-600">
                Start work, then mark done with a recommendation (admin decides final).
              </div>

              <div className="mt-4 grid gap-3">
                <button
                  type="button"
                  onClick={startWork}
                  disabled={!canWork || isDone || busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <IconPlay className="h-5 w-5 text-white" />
                  {busy === "start"
                    ? "Starting…"
                    : staffStatus === "in_progress"
                    ? "Continue work"
                    : "Start work"}
                </button>

                <div className="grid gap-2 rounded-2xl border border-zinc-200 bg-white/60 p-4">
                  <div className="text-xs font-semibold text-zinc-500">
                    Recommendation (required to mark done)
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDecision("recommend_accept")}
                      disabled={!canWork || isDone || busy}
                      className={[
                        "rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60",
                        decision === "recommend_accept"
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                          : "border-zinc-200 bg-white/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60",
                      ].join(" ")}
                    >
                      <span className="inline-flex items-center gap-2">
                        <IconCheck className="h-5 w-5" />
                        Recommend accept
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDecision("recommend_reject")}
                      disabled={!canWork || isDone || busy}
                      className={[
                        "rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60",
                        decision === "recommend_reject"
                          ? "border-rose-200 bg-rose-50/70 text-rose-700"
                          : "border-zinc-200 bg-white/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60",
                      ].join(" ")}
                    >
                      <span className="inline-flex items-center gap-2">
                        <IconX className="h-5 w-5" />
                        Recommend reject
                      </span>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={markDone}
                  disabled={!canWork || isDone || busy}
                  className="w-full rounded-2xl border border-zinc-200 bg-white/60 px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
                >
                  {busy === "done" ? "Submitting…" : "Mark done (send to admin)"}
                </button>

                <div className="text-xs text-zinc-500">Final Accept/Reject is done by admin.</div>
              </div>
            </div>

            <div className="h-10" />
          </>
        )}
      </div>
    </div>
  );
}
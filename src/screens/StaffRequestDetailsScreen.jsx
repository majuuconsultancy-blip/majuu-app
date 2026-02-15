// ✅ StaffRequestDetailsScreen.jsx (FULL COPY-PASTE)
// UI POLISHES (backend untouched):
// - ✅ Apple-ish entrance animation (fade + lift)
// - ✅ Sticky header (Back + status pills stay visible while scrolling)
// - ✅ Floaty cards (softer shadow + hover lift)
// - ✅ Better spacing / typography (cleaner hierarchy)
// - ✅ “Chat” card styled as primary block
// - ✅ Buttons + inputs get smoother focus rings + disabled states
// - ✅ Keeps ALL your Firestore logic EXACTLY the same

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  onSnapshot,
  addDoc,
} from "firebase/firestore";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { auth, db } from "../firebase";

import StaffRequestChatPanel from "../components/StaffRequestChatPanel";

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

function IconLink(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10.6 13.4 9.2 14.8a3.6 3.6 0 0 1-5.1 0 3.6 3.6 0 0 1 0-5.1l1.8-1.8a3.6 3.6 0 0 1 5.1 0"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M13.4 10.6 14.8 9.2a3.6 3.6 0 0 1 5.1 0 3.6 3.6 0 0 1 0 5.1l-1.8 1.8a3.6 3.6 0 0 1-5.1 0"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M9.8 14.2 14.2 9.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTrash(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.8 7.5h10.4M10 7.5V6.2A1.5 1.5 0 0 1 11.5 4.7h1A1.5 1.5 0 0 1 14 6.2v1.3"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M8.2 7.5 9 19a1.8 1.8 0 0 0 1.8 1.6h2.4A1.8 1.8 0 0 0 15 19l.8-11.5"
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
  let startMs = 0;
  if (typeof startTs === "number") startMs = startTs;
  else if (startTs?.seconds) startMs = startTs.seconds * 1000;

  if (!startMs || !endMs) return null;

  const diff = endMs - startMs;
  if (!Number.isFinite(diff) || diff <= 0) return null;

  const mins = Math.round(diff / 60000);
  return Math.max(1, mins);
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
  const [decision, setDecision] = useState("recommend_accept");
  const [busy, setBusy] = useState("");

  const [drafts, setDrafts] = useState([]);
  const [draftErr, setDraftErr] = useState("");
  const [addingDraft, setAddingDraft] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");

  // ✅ polish tokens
  const softBg = "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60";

  const floatCard =
    "rounded-3xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60";

  const inputBase =
    "w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-emerald-300/20";

  // ✅ entrance animation
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);
  const enterWrap =
    "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2";

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
  const staffStatus = String(req?.staffStatus || "assigned").toLowerCase();
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

  useEffect(() => {
    if (!requestId) return;

    const ref = collection(db, "serviceRequests", requestId, "staffFileDrafts");
    const qy = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setDrafts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDraftErr("");
      },
      (e) => {
        console.error("staffFileDrafts snapshot error:", e);
        setDraftErr(e?.message || "Failed to load your attached links.");
      }
    );

    return () => unsub();
  }, [requestId]);

  const updateRequest = async (patch) => {
    if (!uid) throw new Error("Not signed in");
    await updateDoc(doc(db, "serviceRequests", requestId), {
      ...patch,
      staffUpdatedAt: serverTimestamp(),
    });
  };

  const addDraft = async () => {
    const name = String(draftName || "").trim();
    const url = String(draftUrl || "").trim();

    if (!name) return alert("Enter a file name.");
    if (!url) return alert("Paste a file link (URL).");

    try {
      setAddingDraft(true);
      setDraftErr("");

      const ref = collection(db, "serviceRequests", requestId, "staffFileDrafts");
      await addDoc(ref, { name, url, staffUid: uid, createdAt: serverTimestamp() });

      setDraftName("");
      setDraftUrl("");
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to add file link.");
    } finally {
      setAddingDraft(false);
    }
  };

  const removeDraft = async (d) => {
    if (!confirm("Remove this file link?")) return;
    try {
      await deleteDoc(doc(db, "serviceRequests", requestId, "staffFileDrafts", d.id));
    } catch (e) {
      alert(e?.message || "Failed to remove file.");
    }
  };

  const syncDraftsToAdmin = async () => {
    const staffRef = collection(db, "serviceRequests", requestId, "staffFileDrafts");
    const staffSnap = await getDocs(staffRef);
    if (staffSnap.empty) return;

    const batch = writeBatch(db);

    staffSnap.docs.forEach((sd) => {
      const data = sd.data() || {};
      const adminDocRef = doc(db, "serviceRequests", requestId, "adminFileDrafts", sd.id);

      batch.set(
        adminDocRef,
        {
          name: String(data?.name || "File").trim(),
          url: String(data?.url || "").trim(),
          fromStaff: true,
          staffUid: String(data?.staffUid || uid || "").trim(),
          createdAt: data?.createdAt || serverTimestamp(),
          syncedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
  };

  const saveNote = async () => {
    try {
      setBusy("save");
      setErr("");
      await updateRequest({ staffNote: String(note || "").trim() });
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

      await syncDraftsToAdmin();

      const startTs = req?.staffStartedAt || req?.staffStartedAtMs;
      const workMinutes = safeMinutesBetween(startTs, nowMs);

      await updateRequest({
        status: status === "new" ? "contacted" : status,
        staffStatus: "done",
        staffDecision: dec,

        staffCompletedAt: serverTimestamp(),
        staffCompletedAtMs: nowMs,
        staffCompletedBy: uid,

        staffWorkMinutes: workMinutes,
        staffNote: String(note || "").trim(),
      });

      // ✅ Task doc update (admin created it)
      await updateDoc(doc(db, "staff", uid, "tasks", requestId), {
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
      <div className={softBg}>
        <div className="max-w-xl mx-auto px-5 py-6">
          <div className={`${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Preparing…</div>
        </div>
      </div>
    );
  }

  const warnBox =
    "rounded-3xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300";
  const warnAmber =
    "rounded-3xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 shadow-sm";
  const btnGhost =
    "inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100";
  const btnPrimary =
    "inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60";
  const btnDanger =
    "inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60";

  return (
    <div className={softBg}>
      <div className={`max-w-xl mx-auto px-5 py-6 ${enterWrap} ${enterCls}`}>
        {/* Sticky top header */}
        <div className="sticky top-0 z-10 -mx-5 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-950/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button type="button" onClick={() => navigate(-1)} className={btnGhost}>
                <IconChevronLeft className="h-4 w-4" />
                Back
              </button>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 border border-emerald-100 dark:bg-zinc-900/60 dark:border-zinc-700">
                    <IconDoc className="h-4 w-4 text-emerald-700 dark:text-emerald-200" />
                  </span>
                  Staff review
                </span>

                {req ? (
                  <>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${statusPill.cls}`}>
                      {statusPill.label}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold border border-zinc-200 bg-white/60 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
                      Staff: {staffStatus.replace("_", " ")}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-zinc-700/70" />
        </div>

        {/* Chat first (primary block) */}
        <div className={`mt-4 ${floatCard} p-5`}>
          <StaffRequestChatPanel requestId={requestId} />
        </div>

        {err ? (
          <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {loading ? (
          <div className={`mt-4 ${card} p-4`}>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Loading request…</p>
          </div>
        ) : !req ? (
          <div className={`mt-4 ${card} p-4`}>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Request not found.</p>
          </div>
        ) : (
          <>
            {/* Overview */}
            <div className={`mt-4 ${floatCard} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {title}
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{typeLabel}</div>

                  {createdLabel ? (
                    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Submitted: <span className="font-medium">{createdLabel}</span>
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2">
                  <span className="rounded-full border border-zinc-200 bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
                    Staff: {staffStatus.replace("_", " ")}
                  </span>
                </div>
              </div>

              {!canWork ? (
                <div className="mt-4 rounded-3xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                  Admin already finalized this request. You can view only.
                </div>
              ) : staffStatus !== "in_progress" && staffStatus !== "done" ? (
                <div className={`mt-4 ${warnAmber}`}>
                  Work not started. Go back to tasks and tap the request to start.
                </div>
              ) : null}
            </div>

            {/* Applicant summary */}
            <div className={`mt-6 ${floatCard} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Applicant
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Contact details are hidden in staff view.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate(`/staff/request/${req?.id}/documents`)}
                  className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]
                             dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Applicant docs
                  <IconChevronRight className="h-5 w-5 text-emerald-700 dark:text-emerald-200" />
                </button>
              </div>

              <div className="mt-4 grid gap-3 text-sm">
                <div className="grid gap-1">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Full name
                  </div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {req?.name || "-"}
                  </div>
                </div>

                {req?.note ? (
                  <div className="rounded-3xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Applicant note
                    </div>
                    <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap dark:text-zinc-100">
                      {req.note}
                    </div>
                  </div>
                ) : (
                  <div className={warnBox}>No note provided.</div>
                )}
              </div>
            </div>

            {/* Staff attachments */}
            <div className={`mt-6 ${floatCard} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Attach files for applicant
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Add links (Google Drive / Dropbox). When you mark done, these auto-fill admin’s staged
                    files.
                  </p>
                </div>

                <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                  Auto-fills Admin
                </span>
              </div>

              {draftErr ? (
                <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
                  {draftErr}
                </div>
              ) : null}

              {!canWork || isDone ? (
                <div className="mt-4 rounded-3xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                  Attachments are locked after you submit.
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="File name (e.g. SOP Template)"
                    className={inputBase}
                    disabled={addingDraft || busy}
                  />

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                        <IconLink className="h-5 w-5" />
                      </span>
                      <input
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        placeholder="Paste file link (https://...)"
                        className={`${inputBase} pl-11`}
                        disabled={addingDraft || busy}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={addDraft}
                      disabled={addingDraft || busy}
                      className={btnPrimary}
                    >
                      {addingDraft ? "Adding…" : "Add"}
                    </button>
                  </div>

                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Tip: set access to “Anyone with the link can view”.
                  </div>
                </div>
              )}

              <div className="mt-4 grid gap-2">
                {drafts.length === 0 ? (
                  <div className={warnBox}>No files added yet.</div>
                ) : (
                  drafts.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-3xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-zinc-900 break-words dark:text-zinc-100">
                            {d.name || "File"}
                          </div>

                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100"
                            >
                              <IconLink className="h-4 w-4" />
                              Open link
                            </a>
                          ) : (
                            <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No link</div>
                          )}
                        </div>

                        {!canWork || isDone ? null : (
                          <button
                            type="button"
                            onClick={() => removeDraft(d)}
                            disabled={busy}
                            className={btnDanger}
                          >
                            <IconTrash className="h-5 w-5" />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Staff note */}
            <div className={`mt-6 ${floatCard} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Staff note</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Internal note for admin. Save anytime.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!canWork || busy}
                  className={btnGhost}
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
                className="mt-4 w-full rounded-2xl border border-zinc-200 bg-white/70 p-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 min-h-[120px] disabled:opacity-70
                           dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-emerald-300/20"
              />
            </div>

            {/* Staff actions */}
            <div className={`mt-6 ${floatCard} p-5`}>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Staff actions</div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Mark done with a recommendation (admin decides final).
              </div>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-2 rounded-3xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Recommendation
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDecision("recommend_accept")}
                      disabled={!canWork || isDone || busy}
                      className={[
                        "rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60",
                        decision === "recommend_accept"
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                          : "border-zinc-200 bg-white/70 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900",
                      ].join(" ")}
                    >
                      <span className="inline-flex items-center gap-2">
                        <IconCheck className="h-5 w-5" />
                        Accept
                      </span>
                      <div className="mt-0.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                        Recommend accept
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDecision("recommend_reject")}
                      disabled={!canWork || isDone || busy}
                      className={[
                        "rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60",
                        decision === "recommend_reject"
                          ? "border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                          : "border-zinc-200 bg-white/70 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900",
                      ].join(" ")}
                    >
                      <span className="inline-flex items-center gap-2">
                        <IconX className="h-5 w-5" />
                        Reject
                      </span>
                      <div className="mt-0.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                        Recommend reject
                      </div>
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={markDone}
                  disabled={!canWork || isDone || busy || staffStatus !== "in_progress"}
                  className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                  title={staffStatus !== "in_progress" ? "Start work from the modal first" : ""}
                >
                  {busy === "done" ? "Submitting…" : "Mark done (send to admin)"}
                </button>

                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Final Accept/Reject is done by admin.
                </div>
              </div>
            </div>

            <div className="h-10" />
          </>
        )}
      </div>
    </div>
  );
}
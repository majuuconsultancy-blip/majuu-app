import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  adminAcceptRequest,
  adminRejectRequest,
} from "../services/adminrequestservice";
import {
  stageAdminFile,
  deleteStagedAdminFile,
  publishStagedAdminFiles,
  markStaffDraftStaged,
} from "../services/adminfileservice";
import AssignStaffPanel from "../components/AssignStaffPanel";
import AdminRequestChatLauncher from "../components/AdminRequestChatLauncher";

/* ---------- Minimal icons ---------- */
function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15.5 5.5 9 12l6.5 6.5"
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
      <path
        d="M8.6 12h7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.6 15.6h7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
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

/* ---------- UI helpers ---------- */
function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new")
    return {
      label: "New",
      cls: "bg-zinc-100 text-zinc-700 border border-zinc-200",
    };
  if (s === "closed")
    return {
      label: "Accepted",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  if (s === "rejected")
    return {
      label: "Rejected",
      cls: "bg-rose-50 text-rose-700 border border-rose-100",
    };
  if (s === "contacted")
    return {
      label: "In Progress",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  return {
    label: s,
    cls: "bg-zinc-100 text-zinc-700 border border-zinc-200",
  };
}

function formatDT(createdAt) {
  const sec = createdAt?.seconds;
  if (!sec) return null;
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

function safeStr(x) {
  return String(x || "").trim();
}

function isHttp(url) {
  const u = safeStr(url);
  return u.startsWith("http://") || u.startsWith("https://");
}

export default function AdminRequestDetailsScreen() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const goBackToList = () => {
    const qs = String(location?.search || "");
    navigate(`/app/admin${qs}`, { replace: true });
  };

  const [loading, setLoading] = useState(true);
  const [req, setReq] = useState(null);
  const [err, setErr] = useState("");

  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // ✅ staged links (adminFileDrafts)
  const [drafts, setDrafts] = useState([]);
  const [draftErr, setDraftErr] = useState("");
  const [addingDraft, setAddingDraft] = useState(false);

  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");

  // ✅ staff proposed links (staffFileDrafts)
  const [staffDrafts, setStaffDrafts] = useState([]);
  const [staffDraftErr, setStaffDraftErr] = useState("");
  const [stagingStaffDrafts, setStagingStaffDrafts] = useState(false);

  // ✅ chat notification
  const [chatPendingCount, setChatPendingCount] = useState(0);

  const status = String(req?.status || "new").toLowerCase();
  const statusPill = useMemo(() => pill(status), [status]);

  const decisionLocked = status === "closed" || status === "rejected";
  const lockedLabel =
    status === "closed" ? "Accepted" : status === "rejected" ? "Rejected" : "";
  const lockedCls =
    status === "closed"
      ? "border-emerald-200 bg-emerald-600 text-white"
      : "border-rose-200 bg-rose-600 text-white";

  const card =
    "rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur";
  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white";

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const snap = await getDoc(doc(db, "serviceRequests", requestId));
      if (!snap.exists()) {
        setErr("Request not found.");
        setReq(null);
      } else {
        const data = { id: snap.id, ...snap.data() };
        setReq(data);

        const existing = safeStr(
          data?.adminDecisionNote || data?.decisionNote || data?.adminNote || ""
        );

        setNote((prev) => (prev.trim().length ? prev : existing));
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to load request.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (requestId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  /* ✅ FIX: pending chat count without orderBy (no index needed) */
  useEffect(() => {
    if (!requestId) return;

    const ref = collection(db, "serviceRequests", requestId, "pendingMessages");
    const qy = query(ref); // <-- NO orderBy

    const unsub = onSnapshot(
      qy,
      (snap) => {
        let n = 0;
        snap.docs.forEach((d) => {
          const m = d.data() || {};
          const st = String(m?.status || "pending").toLowerCase();
          const from = String(m?.fromRole || "").toLowerCase();

          // Count only items that admin must review
          // - pending status
          // - from user or staff
          if (st === "pending" && (from === "user" || from === "staff")) n += 1;
        });
        setChatPendingCount(n);
      },
      (e) => {
        console.warn("pendingMessages count snapshot error:", e?.message || e);
        setChatPendingCount(0);
      }
    );

    return () => unsub();
  }, [requestId]);

  // ✅ live drafts list (adminFileDrafts)
  useEffect(() => {
    if (!requestId) return;

    const ref = collection(db, "serviceRequests", requestId, "adminFileDrafts");
    const qy = query(ref);

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b?.createdAt?.seconds || 0) - (a?.createdAt?.seconds || 0));
        setDrafts(rows);
        setDraftErr("");
      },
      (e) => {
        console.error("adminFileDrafts snapshot error:", e);
        setDraftErr(e?.message || "Failed to load staged files.");
      }
    );

    return () => unsub();
  }, [requestId]);

  // ✅ live staff drafts list (staffFileDrafts)
  useEffect(() => {
    if (!requestId) return;

    const ref = collection(db, "serviceRequests", requestId, "staffFileDrafts");
    const qy = query(ref);

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b?.createdAt?.seconds || 0) - (a?.createdAt?.seconds || 0));
        setStaffDrafts(rows);
        setStaffDraftErr("");
      },
      (e) => {
        console.error("staffFileDrafts snapshot error:", e);
        setStaffDraftErr(e?.message || "Failed to load staff staged files.");
      }
    );

    return () => unsub();
  }, [requestId]);

  // ✅ AUTO-STAGE: when staff recommends accept and has links, auto-fill admin drafts
  useEffect(() => {
    if (!requestId) return;
    if (decisionLocked) return;

    const staffDecision = String(req?.staffDecision || "").toLowerCase();
    const staffStatus = String(req?.staffStatus || "").toLowerCase();

    const okToAutofill =
      staffStatus === "done" && staffDecision === "recommend_accept";

    if (!okToAutofill) return;
    if (!Array.isArray(staffDrafts) || staffDrafts.length === 0) return;

    const pending = staffDrafts.filter((d) => !d?.stagedAt && isHttp(d?.url));
    if (pending.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        setStagingStaffDrafts(true);

        for (const d of pending) {
          if (cancelled) break;

          await stageAdminFile({
            requestId,
            name: safeStr(d?.name || "Staff file"),
            url: safeStr(d?.url),
          });

          await markStaffDraftStaged({ requestId, draftId: d.id });
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setStagingStaffDrafts(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestId, decisionLocked, req?.staffDecision, req?.staffStatus, staffDrafts]);

  const addDraft = async () => {
    const name = safeStr(draftName);
    const url = safeStr(draftUrl);

    if (!name) return alert("Enter a file name.");
    if (!url) return alert("Paste a file link (URL).");
    if (!isHttp(url)) return alert("Link must start with http:// or https://");

    setAddingDraft(true);
    try {
      await stageAdminFile({ requestId, name, url });
      setDraftName("");
      setDraftUrl("");
    } catch (e) {
      alert(e?.message || "Failed to add file.");
    } finally {
      setAddingDraft(false);
    }
  };

  const removeDraft = async (d) => {
    if (!confirm("Remove this staged file?")) return;
    try {
      await deleteStagedAdminFile({ requestId, draftId: d.id });
    } catch (e) {
      alert(e?.message || "Failed to remove file.");
    }
  };

  const stageOneStaffDraftNow = async (d) => {
    try {
      if (decisionLocked) return;
      const name = safeStr(d?.name || "Staff file");
      const url = safeStr(d?.url);
      if (!isHttp(url)) return alert("This staff link is invalid.");

      await stageAdminFile({ requestId, name, url });
      await markStaffDraftStaged({ requestId, draftId: d.id });
    } catch (e) {
      alert(e?.message || "Failed to stage staff file.");
    }
  };

  const accept = async () => {
    if (!req) return;

    setSaving(true);
    try {
      await adminAcceptRequest({
        requestId: req.id,
        note: safeStr(note),
      });

      await publishStagedAdminFiles({ requestId: req.id });

      await load();
    } catch (e) {
      alert(e?.message || "Accept failed");
    } finally {
      setSaving(false);
    }
  };

  const reject = async () => {
    if (!req) return;
    if (!note.trim()) return alert("Write a note (required for rejection).");

    setSaving(true);
    try {
      await adminRejectRequest({
        requestId: req.id,
        note: safeStr(note),
      });
      await load();
    } catch (e) {
      alert(e?.message || "Reject failed");
    } finally {
      setSaving(false);
    }
  };

  const setContacted = async () => {
    try {
      await updateDoc(doc(db, "serviceRequests", requestId), {
        status: "contacted",
        updatedAt: serverTimestamp(),
      });
      await load();
    } catch (e) {
      alert(e?.message || "Failed to update status.");
    }
  };

  if (loading) {
    return (
      <div className={pageBg}>
        <div className="max-w-xl mx-auto px-5 py-6">
          <div className={`${card} p-4 text-sm text-zinc-600`}>Loading…</div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={pageBg}>
        <div className="max-w-xl mx-auto px-5 py-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">Request</h1>
              <p className="text-sm text-zinc-600">Admin view</p>
            </div>
            <button
              onClick={goBackToList}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
              type="button"
            >
              <IconBack className="h-5 w-5 text-emerald-700" />
              Back
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700">
            {err}
          </div>
        </div>
      </div>
    );
  }

  const headerLeft = `${String(req?.track || "").toUpperCase()} • ${req?.country || "-"}`;
  const headerRight =
    req?.requestType === "full"
      ? "Full Package"
      : `Single Service • ${req?.serviceName || "-"}`;

  const createdLabel = formatDT(req?.createdAt);

  const actionHint =
    status === "closed"
      ? "Decision complete. This request was accepted."
      : status === "rejected"
      ? "Decision complete. This request was rejected."
      : "Review the applicant details and documents, then make a decision.";

  const badgeText = chatPendingCount > 99 ? "99+" : String(chatPendingCount);

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 border border-emerald-100">
                <IconDoc className="h-4 w-4 text-emerald-700" />
              </span>
              Review request
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              {headerLeft}
            </h1>
            <p className="mt-1 text-sm text-zinc-600">{headerRight}</p>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {/* ✅ Chat launcher with badge */}
            <span className="relative inline-flex">
              <AdminRequestChatLauncher requestId={requestId} />
              {chatPendingCount > 0 ? (
                <span
                  className={[
                    "absolute -top-1 -right-1 z-10",
                    "min-w-[18px] h-[18px] px-1",
                    "rounded-full bg-rose-600 text-white",
                    "text-[10px] font-extrabold leading-none",
                    "flex items-center justify-center",
                    "shadow-[0_0_0_3px_rgba(244,63,94,0.18),0_0_14px_rgba(244,63,94,0.45)]",
                  ].join(" ")}
                  title="New messages pending review"
                >
                  {badgeText}
                </span>
              ) : null}
            </span>

            <button
              onClick={goBackToList}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
              type="button"
            >
              <IconBack className="h-5 w-5 text-emerald-700" />
              Back
            </button>
          </div>
        </div>

        {/* Meta */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className={`${card} p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-500">
                  Request ID
                </div>
                <div className="mt-1 font-mono text-sm text-zinc-900 break-words">
                  {req?.id}
                </div>
                {createdLabel ? (
                  <div className="mt-2 text-xs text-zinc-500">
                    Submitted:{" "}
                    <span className="font-medium text-zinc-700">
                      {createdLabel}
                    </span>
                  </div>
                ) : null}
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${statusPill.cls}`}
              >
                {statusPill.label}
              </span>
            </div>
          </div>

          <div className={`${card} p-4`}>
            <div className="text-sm font-semibold text-zinc-900">
              Review status
            </div>
            <div className="mt-1 text-sm text-zinc-600">{actionHint}</div>

            {!decisionLocked && status === "new" ? (
              <button
                type="button"
                onClick={setContacted}
                className="mt-3 inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
              >
                Mark In Progress
              </button>
            ) : null}
          </div>
        </div>

        {/* ✅ STAFF ASSIGNMENT */}
        {req && !decisionLocked ? (
          <AssignStaffPanel request={req} />
        ) : (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
            Staff assignment is disabled because this request is already
            finalized.
          </div>
        )}

        {/* Applicant */}
        <div className={`mt-6 ${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Applicant</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Basic details and uploaded files.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate(`/app/admin/request/${requestId}/documents`)}
              className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
            >
              Applicant docs
              <IconChevronRight className="h-5 w-5 text-emerald-700" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 text-sm">
            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">Full name</div>
              <div className="font-semibold text-zinc-900">{req?.name || "-"}</div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">
                Phone / WhatsApp
              </div>
              <div className="font-semibold text-zinc-900">{req?.phone || "-"}</div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">Email</div>
              <div className="font-semibold text-zinc-900 break-words">
                {req?.email || "-"}
              </div>
            </div>

            {req?.note ? (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4">
                <div className="text-xs font-semibold text-zinc-500">
                  Applicant note
                </div>
                <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap">
                  {req.note}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
                No note provided.
              </div>
            )}
          </div>
        </div>

        {/* Note */}
        <div className={`mt-6 ${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Message to applicant
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                This shows on the applicant’s Request Details. Required if
                rejecting.
              </p>
            </div>

            <span className="rounded-full border border-rose-100 bg-rose-50/70 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
              Required for reject
            </span>
          </div>

          <textarea
            className="mt-4 w-full rounded-2xl border border-zinc-200 bg-white/60 p-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 min-h-[120px] disabled:opacity-70"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving || decisionLocked}
            placeholder="Example: Please upload a clear passport bio page, then re-submit. Processing starts 24–48 hours after upload."
          />
        </div>

        {/* ✅ Staff suggested files */}
        <div className={`mt-6 ${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Staff suggested files
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                These are links staff added. If staff recommended accept, they
                auto-fill your “Attach files” section.
              </p>
            </div>

            {stagingStaffDrafts ? (
              <span className="rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                Autofilling…
              </span>
            ) : (
              <span className="rounded-full border border-zinc-200 bg-white/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                {staffDrafts.length} items
              </span>
            )}
          </div>

          {staffDraftErr ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {staffDraftErr}
            </div>
          ) : null}

          {staffDrafts.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
              No staff file links yet.
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {staffDrafts.map((d) => {
                const url = safeStr(d?.url);
                const hasLink = isHttp(url);
                const staged = Boolean(d?.stagedAt);

                return (
                  <div
                    key={d.id}
                    className="rounded-2xl border border-zinc-200 bg-white/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-900 break-words">
                          {safeStr(d?.name) || "Staff file"}
                        </div>

                        {hasLink ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                          >
                            Open link
                          </a>
                        ) : (
                          <div className="mt-2 text-sm text-zinc-500">
                            No valid link
                          </div>
                        )}

                        {staged ? (
                          <div className="mt-2 text-xs font-semibold text-emerald-800">
                            ✅ Already staged to applicant
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-zinc-500">
                            Not staged yet
                          </div>
                        )}
                      </div>

                      {!decisionLocked && hasLink && !staged ? (
                        <button
                          type="button"
                          onClick={() => stageOneStaffDraftNow(d)}
                          className="shrink-0 inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                        >
                          Stage
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ✅ Attach files for applicant */}
        <div className={`mt-6 ${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">
                Attach files for applicant
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Add links (Google Drive / Dropbox). Files are sent only after
                you accept.
              </p>
            </div>

            <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
              Sends on Accept
            </span>
          </div>

          {draftErr ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {draftErr}
            </div>
          ) : null}

          {!decisionLocked ? (
            <div className="mt-4 grid gap-3">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="File name (e.g. SOP Template)"
                className="w-full rounded-2xl border border-zinc-200 bg-white/60 p-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                disabled={saving || addingDraft}
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
                    className="w-full rounded-2xl border border-zinc-200 bg-white/60 pl-11 pr-3 py-3 text-sm text-zinc-900 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                    disabled={saving || addingDraft}
                  />
                </div>

                <button
                  type="button"
                  onClick={addDraft}
                  disabled={saving || addingDraft}
                  className="shrink-0 inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {addingDraft ? "Adding…" : "Add"}
                </button>
              </div>

              <div className="text-xs text-zinc-500">
                Tip: Make sure the link access is set to “Anyone with the link can
                view”.
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
              Decision is locked — attachments can’t be changed.
            </div>
          )}

          <div className="mt-4 grid gap-2">
            {drafts.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
                No files staged yet.
              </div>
            ) : (
              drafts.map((d) => (
                <div
                  key={d.id}
                  className="rounded-2xl border border-zinc-200 bg-white/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-zinc-900 break-words">
                        {d.name || "File"}
                      </div>

                      {d.url ? (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                          title="Open in new tab"
                        >
                          Open link
                        </a>
                      ) : (
                        <div className="mt-2 text-sm text-zinc-500">No link</div>
                      )}
                    </div>

                    {!decisionLocked ? (
                      <button
                        type="button"
                        onClick={() => removeDraft(d)}
                        disabled={saving}
                        className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60"
                      >
                        <IconTrash className="h-5 w-5" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions LAST */}
        <div className={`mt-6 ${card} p-5`}>
          <h2 className="text-sm font-semibold text-zinc-900">Final decision</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Once you accept or reject, the decision is locked.
          </p>

          {decisionLocked ? (
            <button
              type="button"
              disabled
              className={`mt-4 w-full inline-flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm opacity-90 cursor-not-allowed ${lockedCls}`}
            >
              {lockedLabel}
            </button>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                onClick={reject}
                disabled={saving || !note.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60"
                type="button"
                title={!note.trim() ? "Note is required for rejection." : ""}
              >
                <IconX className="h-5 w-5" />
                {saving ? "Saving…" : "Reject"}
              </button>

              <button
                onClick={accept}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                type="button"
              >
                <IconCheck className="h-5 w-5 text-white" />
                {saving ? "Saving…" : "Accept"}
              </button>
            </div>
          )}

          <div className="mt-3 text-center text-xs text-zinc-500">
            Tip: Add files first, then accept to send them automatically.
          </div>
        </div>

        <div className="h-10" />
      </div>
    </div>
  );
}
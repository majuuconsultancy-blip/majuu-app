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
import { auth, db } from "../firebase";
import {
  adminAcceptRequest,
  adminRejectRequest,
} from "../services/adminrequestservice";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { listAssignedAdmins } from "../services/assignedadminservice";
import { superAdminOverrideRouteRequest } from "../services/adminroutingservice";
import {
  stageAdminFile,
  deleteStagedAdminFile,
  publishStagedAdminFiles,
  markStaffDraftStaged,
} from "../services/adminfileservice";
import { ArrowLeft, FileText, Check, X, ChevronRight, Link2, Trash2 } from "lucide-react";
import AssignStaffPanel from "../components/AssignStaffPanel";
import AdminRequestChatLauncher from "../components/AdminRequestChatLauncher";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { smartBack } from "../utils/navBack";
import { normalizeTextDeep } from "../utils/textNormalizer";

/* ---------- UI helpers ---------- */
function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new")
    return {
      label: "New",
      cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
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
    cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
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
    smartBack(navigate, `/app/admin${qs}`);
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
  const [roleCtx, setRoleCtx] = useState(null);
  const [assignedAdminRows, setAssignedAdminRows] = useState([]);
  const [overrideTargetAdminUid, setOverrideTargetAdminUid] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideErr, setOverrideErr] = useState("");
  const [overrideMsg, setOverrideMsg] = useState("");

  const status = String(req?.status || "new").toLowerCase();
  const statusPill = useMemo(() => pill(status), [status]);

  const decisionLocked = status === "closed" || status === "rejected";
  const lockedLabel =
    status === "closed" ?"Accepted" : status === "rejected" ?"Rejected" : "";
  const lockedCls =
    status === "closed"
      ?"border-emerald-200 bg-emerald-600 text-white"
      : "border-rose-200 bg-rose-600 text-white";

  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const snap = await getDoc(doc(db, "serviceRequests", requestId));
      if (!snap.exists()) {
        setErr("Request not found.");
        setReq(null);
      } else {
        const data = normalizeTextDeep({ id: snap.id, ...snap.data() });
        setReq(data);

        const existing = safeStr(
          data?.adminDecisionNote || data?.decisionNote || data?.adminNote || ""
        );

        setNote((prev) => (prev.trim().length ?prev : existing));
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (!cancelled) setRoleCtx(ctx || null);
      } catch (error) {
        if (!cancelled) setRoleCtx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roleCtx?.isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listAssignedAdmins({ max: 200 });
        if (cancelled) return;
        setAssignedAdminRows(Array.isArray(rows) ?rows : []);
      } catch (error) {
        if (!cancelled) {
          setAssignedAdminRows([]);
          console.warn("Failed to load assigned admins:", error?.message || error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleCtx?.isSuperAdmin]);

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
        const rows = snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));
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
        const rows = snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));
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

  const runSuperAdminOverride = async () => {
    if (!req?.id) return;
    setOverrideErr("");
    setOverrideMsg("");
    setOverrideBusy(true);
    try {
      const result = await superAdminOverrideRouteRequest({
        requestId: req.id,
        targetAdminUid: String(overrideTargetAdminUid || "").trim(),
        reason: "super_admin_manual_override_from_request_details",
      });
      if (result?.ok) {
        const mode = String(result?.mode || "manual");
        setOverrideMsg(
          mode === "auto"
            ?"Routing override applied (auto best route)."
            : "Routing override applied."
        );
      } else {
        setOverrideErr(
          String(result?.result?.reason || result?.reason || "Routing override failed.")
        );
      }
      await load();
    } catch (error) {
      console.error(error);
      const code = String(error?.code || "").trim();
      const details = String(error?.details || "").trim();
      const message = String(error?.message || "").trim();
      setOverrideErr(
        details ||
          message ||
          (code ?`Failed to override routing (${code}).` : "Failed to override routing.")
      );
    } finally {
      setOverrideBusy(false);
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
    if (roleCtx?.isAssignedAdmin) {
      const scopedAdminUid = String(
        req?.ownerLockedAdminUid || req?.currentAdminUid || ""
      ).trim();
      const actorUid = String(auth.currentUser?.uid || "").trim();
      if (scopedAdminUid && actorUid && scopedAdminUid !== actorUid) {
        return alert("This request is outside your assigned admin scope.");
      }
    }

    const actingAdminUid = String(auth.currentUser?.uid || "").trim();
    const lockAdminUid = String(
      req?.ownerLockedAdminUid || req?.currentAdminUid || actingAdminUid
    ).trim();
    const nowMs = Date.now();
    const existingRoutingMeta = req?.routingMeta && typeof req.routingMeta === "object"
      ?req.routingMeta
      : {};

    try {
      await updateDoc(doc(db, "serviceRequests", requestId), {
        status: "contacted",
        adminRespondedAt: serverTimestamp(),
        adminRespondedAtMs: nowMs,
        adminRespondedBy: actingAdminUid || null,
        ownerLockedAdminUid: lockAdminUid || "",
        ownerLockedAt: serverTimestamp(),
        routingMeta: {
          ...existingRoutingMeta,
          handledAt: serverTimestamp(),
          handledAtMs: nowMs,
          lockedOwnerAdminUid: lockAdminUid || "",
        },
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
          <div className={`${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Loading…</div>
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
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Request</h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">Admin view</p>
            </div>
            <button
              onClick={goBackToList}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
              type="button"
            >
              <AppIcon icon={ArrowLeft} size={ICON_MD} className="text-emerald-700" />
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
      ?"Full Package"
      : `Single Service • ${req?.serviceName || "-"}`;

  const createdLabel = formatDT(req?.createdAt);

  const actionHint =
    status === "closed"
      ?"Decision complete. This request was accepted."
      : status === "rejected"
      ?"Decision complete. This request was rejected."
      : "Review the applicant details and documents, then make a decision.";

  const badgeText = chatPendingCount > 99 ?"99+" : String(chatPendingCount);
  const reassignmentCount = Array.isArray(req?.routingMeta?.reassignmentHistory)
    ?req.routingMeta.reassignmentHistory.length
    : 0;

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-900/60 border border-emerald-100">
                <AppIcon icon={FileText} size={ICON_SM} className="text-emerald-700" />
              </span>
              Review request
            </div>

            <h1 className="mt-3 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {headerLeft}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{headerRight}</p>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {/* ✅ Chat launcher with badge */}
            <span className="relative inline-flex">
              <AdminRequestChatLauncher requestId={requestId} />
              {chatPendingCount > 0 ?(
                <span
                  className={[
                    "absolute -top-1 -right-1 z-10",
                    "min-w-[18px] h-[18px] px-1",
                    "rounded-full bg-rose-600 text-white",
                    "text-[10px] font-semibold leading-none",
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
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
              type="button"
            >
              <AppIcon icon={ArrowLeft} size={ICON_MD} className="text-emerald-700" />
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
                <div className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-100 break-words">
                  {req?.id}
                </div>
                {createdLabel ?(
                  <div className="mt-2 text-xs text-zinc-500">
                    Submitted:{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
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
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Review status
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{actionHint}</div>

            {!decisionLocked && status === "new" ?(
              <button
                type="button"
                onClick={setContacted}
                className="mt-3 inline-flex items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
              >
                Mark In Progress
              </button>
            ) : null}
          </div>
        </div>

        <div className={`mt-4 ${card} p-4`}>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Routing overview
          </div>
          <div className="mt-2 grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <div>
              Reassignments:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{reassignmentCount}</span>
            </div>
          </div>

          {roleCtx?.isSuperAdmin ?(
            <div className="mt-4 rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-3">
              <div className="text-xs font-semibold text-emerald-800">Super admin override</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={overrideTargetAdminUid}
                  onChange={(e) => setOverrideTargetAdminUid(e.target.value)}
                  disabled={overrideBusy}
                  className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Auto best route</option>
                  {assignedAdminRows.map((row) => (
                    <option key={row.uid} value={row.uid}>
                      {String(row?.email || row.uid)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={runSuperAdminOverride}
                  disabled={overrideBusy}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {overrideBusy ?"Applying..." : "Apply override"}
                </button>
              </div>
              {overrideErr ?(
                <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
                  {overrideErr}
                </div>
              ) : null}
              {overrideMsg ?(
                <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
                  {overrideMsg}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ✅ STAFF ASSIGNMENT */}
        {req && !decisionLocked ?(
          <AssignStaffPanel request={req} />
        ) : (
          <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
            Staff assignment is disabled because this request is already
            finalized.
          </div>
        )}

        {/* Applicant */}
        <div className={`mt-6 ${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Applicant</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Basic details and uploaded files.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate(`/app/admin/request/${requestId}/documents`)}
              className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
            >
              Applicant docs
              <AppIcon icon={ChevronRight} size={ICON_MD} className="text-emerald-700" />
            </button>
          </div>

          <div className="mt-4 grid gap-3 text-sm">
            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">Full name</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">{req?.name || "-"}</div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">
                Phone / WhatsApp
              </div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">{req?.phone || "-"}</div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">Email</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                {req?.email || "-"}
              </div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">County</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">{req?.county || "-"}</div>
            </div>

            <div className="grid gap-1">
              <div className="text-xs font-semibold text-zinc-500">Town / City</div>
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {req?.town || req?.city || "-"}
              </div>
            </div>

            {req?.note ?(
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4">
                <div className="text-xs font-semibold text-zinc-500">
                  Applicant note
                </div>
                <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap">
                  {req.note}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                No note provided.
              </div>
            )}
          </div>
        </div>

        {/* Note */}
        <div className={`mt-6 ${card} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Message to applicant
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                This shows on the applicant’s Request Details. Required if
                rejecting.
              </p>
            </div>

          </div>

          <textarea
            className="mt-4 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 min-h-[120px] disabled:opacity-70"
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
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Staff suggested files
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                These are links staff added. If staff recommended accept, they
                auto-fill your “Attach files” section.
              </p>
            </div>

            {stagingStaffDrafts ?(
              <span className="rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                Autofilling…
              </span>
            ) : (
              <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                {staffDrafts.length} items
              </span>
            )}
          </div>

          {staffDraftErr ?(
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {staffDraftErr}
            </div>
          ) : null}

          {staffDrafts.length === 0 ?(
            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
              No staff file links yet.
            </div>
          ) : (
            <div className="mt-4 grid gap-2">
              {staffDrafts.map((d) => {
                const url = safeStr(d?.url);
                const hasLink = isHttp(url);
                const staged = Boolean(d?.stagedAt);

                return (
                  <div key={d.id} className="py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words">
                          {safeStr(d?.name) || "Staff file"}
                        </div>

                        {hasLink ?(
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

                        {staged ?(
                          <div className="mt-2 text-xs font-semibold text-emerald-800">
                            ✅ Already staged to applicant
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-zinc-500">
                            Not staged yet
                          </div>
                        )}
                      </div>

                      {!decisionLocked && hasLink && !staged ?(
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
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Attach files for applicant
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Add links (Google Drive / Dropbox). Files are sent only after
                you accept.
              </p>
            </div>

            <span className="text-[11px] font-semibold text-emerald-800">
              Sends on Accept
            </span>
          </div>

          {draftErr ?(
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {draftErr}
            </div>
          ) : null}

          {!decisionLocked ?(
            <div className="mt-4 grid gap-3">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="File name (e.g. SOP Template)"
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                disabled={saving || addingDraft}
              />

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                    <AppIcon icon={Link2} size={ICON_MD} />
                  </span>
                  <input
                    value={draftUrl}
                    onChange={(e) => setDraftUrl(e.target.value)}
                    placeholder="Paste file link (https://...)"
                    className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 pl-11 pr-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                    disabled={saving || addingDraft}
                  />
                </div>

                <button
                  type="button"
                  onClick={addDraft}
                  disabled={saving || addingDraft}
                  className="shrink-0 inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {addingDraft ?"Adding…" : "Add"}
                </button>
              </div>

              <div className="text-xs text-zinc-500">
                Tip: Make sure the link access is set to “Anyone with the link can
                view”.
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
              Decision is locked — attachments can’t be changed.
            </div>
          )}

          <div className="mt-4 grid gap-2">
            {drafts.length === 0 ?(
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                No files staged yet.
              </div>
            ) : (
              drafts.map((d) => (
                <div
                  key={d.id}
                  className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words">
                        {d.name || "File"}
                      </div>

                      {d.url ?(
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

                    {!decisionLocked ?(
                      <button
                        type="button"
                        onClick={() => removeDraft(d)}
                        disabled={saving}
                        className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60"
                      >
                        <AppIcon icon={Trash2} size={ICON_MD} />
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
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Final decision</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Once you accept or reject, the decision is locked.
          </p>

          {decisionLocked ?(
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
                title={!note.trim() ?"Note is required for rejection." : ""}
              >
                <AppIcon icon={X} size={ICON_MD} />
                {saving ?"Saving…" : "Reject"}
              </button>

              <button
                onClick={accept}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                type="button"
              >
                <AppIcon icon={Check} size={ICON_MD} className="text-white" />
                {saving ?"Saving…" : "Accept"}
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



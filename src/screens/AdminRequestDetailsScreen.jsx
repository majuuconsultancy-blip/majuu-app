import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  adminAcceptRequest,
  adminRejectRequest,
} from "../services/adminrequestservice";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  getRoutingOptionsForRequest,
  superAdminOverrideRouteRequest,
} from "../services/adminroutingservice";
import {
  stageAdminFile,
  deleteStagedAdminFile,
  publishStagedAdminFiles,
  markStaffDraftStaged,
} from "../services/adminfileservice";
import { ArrowLeft, FileText, Check, X, ChevronRight, ChevronDown, Link2, Trash2 } from "lucide-react";
import AssignStaffPanel from "../components/AssignStaffPanel";
import AdminRequestChatLauncher from "../components/AdminRequestChatLauncher";
import AppIcon from "../components/AppIcon";
import RequestDocumentFieldsSection from "../components/RequestDocumentFieldsSection";
import RequestExtraDetailsSection from "../components/RequestExtraDetailsSection";
import RequestWorkProgressCard from "../components/RequestWorkProgressCard";
import RequestProgressUpdatesList from "../components/RequestProgressUpdatesList";
import FileAccessLink from "../components/FileAccessLink";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { smartBack } from "../utils/navBack";
import { normalizeTextDeep } from "../utils/textNormalizer";
import { getRequestWorkProgress } from "../utils/requestWorkProgress";
import { isUnsubmittedGhostRequest } from "../utils/requestGhosts";
import {
  adminApproveInProgressPayment,
  adminApproveRefund,
  adminRejectInProgressPayment,
  adminRejectRefund,
  normalizePaymentDoc,
  normalizeRefundDoc,
  PAYMENT_TYPES,
  PAYMENT_STATUSES,
  paymentStatusUi,
  REFUND_STATUSES,
  refundStatusUi,
} from "../services/paymentservice";
import { subscribeFinanceSettings } from "../services/financeservice";
import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
import { subscribeRequestProgressUpdates } from "../services/requestcontinuityservice";
import {
  splitRequestDocumentsForLegacyViews,
  subscribeRequestDocumentContext,
} from "../services/documentEngineService";

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

function permissionAwareMessage(error, fallback) {
  const message = safeStr(error?.message, 240).toLowerCase();
  if (message.includes("missing or insufficient permissions")) {
    return fallback;
  }
  return safeStr(error?.message, 240) || fallback;
}

function cleanMoneyInput(value, { allowZero = false } = {}) {
  const num = Number(String(value || "").replace(/[^0-9.]+/g, ""));
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num);
  if (allowZero) return Math.max(0, rounded);
  return rounded > 0 ? rounded : 0;
}

function cleanPercentInput(value, { allowZero = false } = {}) {
  const num = Number(String(value || "").replace(/[^0-9.]+/g, ""));
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num);
  if (allowZero) return Math.max(0, Math.min(100, rounded));
  if (rounded < 1) return 0;
  return Math.min(100, rounded);
}

function formatMoney(amount, currency = "KES") {
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const safeCurrency = safeStr(currency || "KES").toUpperCase() || "KES";
  return `${safeCurrency} ${safeAmount.toLocaleString()}`;
}

function isHttp(url) {
  const u = safeStr(url);
  return u.startsWith("http://") || u.startsWith("https://");
}

function createAdminSectionState() {
  return {
    workProgress: false,
    routing: false,
    payments: false,
    refunds: false,
    assignment: false,
    applicant: false,
    messageToApplicant: false,
    staffSuggestedFiles: false,
    attachments: false,
  };
}

function CollapsibleSectionCard({
  className,
  title,
  subtitle,
  open,
  onToggle,
  badge = null,
  meta = null,
  children,
}) {
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {meta}
          <AppIcon
            icon={ChevronDown}
            size={ICON_MD}
            className={`text-zinc-500 transition ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open ? children : null}
    </div>
  );
}

const EMPTY_REQUEST_UNREAD_STATE = Object.freeze({});

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
  const [routingOptions, setRoutingOptions] = useState(null);
  const [overridePartnerId, setOverridePartnerId] = useState("");
  const [overridePartnerSeeded, setOverridePartnerSeeded] = useState(false);
  const [overrideTargetAdminUid, setOverrideTargetAdminUid] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideErr, setOverrideErr] = useState("");
  const [overrideMsg, setOverrideMsg] = useState("");

  const [payments, setPayments] = useState([]);
  const [paymentsErr, setPaymentsErr] = useState("");
  const [paymentRejectReasonById, setPaymentRejectReasonById] = useState({});
  const [paymentApprovalDraftById, setPaymentApprovalDraftById] = useState({});
  const [paymentDecisionBusyId, setPaymentDecisionBusyId] = useState("");

  const [refunds, setRefunds] = useState([]);
  const [refundsErr, setRefundsErr] = useState("");
  const [refundApproveExplanationById, setRefundApproveExplanationById] = useState({});
  const [refundApproveEtaById, setRefundApproveEtaById] = useState({});
  const [refundRejectReasonById, setRefundRejectReasonById] = useState({});
  const [refundDecisionBusyId, setRefundDecisionBusyId] = useState("");
  const [globalDiscountEnabled, setGlobalDiscountEnabled] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [progressUpdatesErr, setProgressUpdatesErr] = useState("");
  const [canonicalDocRows, setCanonicalDocRows] = useState([]);
  const [canonicalDocErr, setCanonicalDocErr] = useState("");
  const [canonicalDocRequestId, setCanonicalDocRequestId] = useState("");
  const [openSections, setOpenSections] = useState(createAdminSectionState);
  const unreadRequestState = useNotifsV2Store(
    (s) => s.unreadByRequest?.[String(requestId || "").trim()] || EMPTY_REQUEST_UNREAD_STATE
  );
  const resolvedRequestId = safeStr(requestId);
  const hasCanonicalDocContext = canonicalDocRequestId === resolvedRequestId;
  const canonicalDocSplit = useMemo(
    () =>
      splitRequestDocumentsForLegacyViews(hasCanonicalDocContext ? canonicalDocRows : []),
    [canonicalDocRows, hasCanonicalDocContext]
  );
  const canonicalAttachments = canonicalDocSplit.attachments;
  const canonicalDocErrForRequest = hasCanonicalDocContext ? canonicalDocErr : "";
  const canonicalAttachmentsLoading =
    Boolean(resolvedRequestId) && !hasCanonicalDocContext && !canonicalDocErrForRequest;
  const canonicalAttachmentsError = canonicalDocErrForRequest;

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
        const requestStatus = safeStr(data?.status).toLowerCase();
        if (requestStatus === "payment_pending" || isUnsubmittedGhostRequest(data)) {
          setReq(null);
          setErr("This request is still unfinished and is not yet in the admin queue.");
          return;
        }
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
    setOverridePartnerSeeded(false);
    setOverridePartnerId("");
    setOverrideTargetAdminUid("");
    setOverrideErr("");
    setOverrideMsg("");
  }, [requestId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (!cancelled) setRoleCtx(ctx || null);
      } catch {
        if (!cancelled) setRoleCtx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!roleCtx?.isSuperAdmin || !req) return;
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await getRoutingOptionsForRequest(req);
        if (cancelled) return;
        setRoutingOptions(snapshot || null);
      } catch (error) {
        if (!cancelled) {
          setRoutingOptions(null);
          console.warn("Failed to load routing options:", error?.message || error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleCtx?.isSuperAdmin, req]);

  useEffect(() => {
    if (!roleCtx?.isSuperAdmin || !req || overridePartnerSeeded) return;
    const preferredPartnerId = safeStr(req?.preferredAgentId);
    if (preferredPartnerId) {
      setOverridePartnerId(preferredPartnerId);
    }
    setOverridePartnerSeeded(true);
  }, [overridePartnerSeeded, roleCtx?.isSuperAdmin, req]);

  useEffect(() => {
    if (!overridePartnerId) return;
    const partnerRows = Array.isArray(routingOptions?.eligiblePartners)
      ? routingOptions.eligiblePartners
      : [];
    const adminRows =
      partnerRows.find((partner) => partner.id === overridePartnerId)?.admins || [];
    const stillValid = adminRows.some(
      (row) => safeStr(row?.uid) === safeStr(overrideTargetAdminUid)
    );
    if (!stillValid) {
      setOverrideTargetAdminUid("");
    }
  }, [overridePartnerId, routingOptions, overrideTargetAdminUid]);

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

  useEffect(() => {
    const unsub = subscribeFinanceSettings({
      onData: (settings) => {
        setGlobalDiscountEnabled(settings?.pricingControls?.globalDiscountEnabled === true);
      },
      onError: () => {
        // Keep existing UI defaults if finance settings read fails.
      },
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  useEffect(() => {
    if (!requestId) return;
    const ref = collection(db, "serviceRequests", requestId, "payments");
    const qy = query(ref);

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs
          .map((d) => normalizePaymentDoc(normalizeTextDeep({ id: d.id, ...d.data() })))
          .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        setPayments(rows);
        setPaymentsErr("");
      },
      (error) => {
        console.error("admin payments snapshot error:", error);
        setPaymentsErr(error?.message || "Failed to load payments.");
      }
    );

    return () => unsub();
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;
    const ref = collection(db, "serviceRequests", requestId, "refundRequests");
    const qy = query(ref);

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs
          .map((d) => normalizeRefundDoc(normalizeTextDeep({ id: d.id, ...d.data() })))
          .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
        setRefunds(rows);
        setRefundsErr("");
      },
      (error) => {
        console.error("admin refunds snapshot error:", error);
        setRefundsErr(error?.message || "Failed to load refund requests.");
      }
    );

    return () => unsub();
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;
    notifsV2Store.markRequestNotificationsRead(requestId).catch(() => {});
  }, [requestId]);

  useEffect(() => {
    setOpenSections(createAdminSectionState());
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return undefined;

    const unsub = subscribeRequestProgressUpdates({
      requestId,
      viewerRole: "admin",
      onData: (rows) => {
        setProgressUpdates(rows);
        setProgressUpdatesErr("");
      },
      onError: (error) => {
        console.error("admin progress updates snapshot error:", error);
        setProgressUpdatesErr(
          permissionAwareMessage(error, "Progress updates are not available right now.")
        );
      },
    });

    return () => unsub?.();
  }, [requestId]);

  useEffect(() => {
    if (!resolvedRequestId) return undefined;

    const unsub = subscribeRequestDocumentContext({
      requestId: resolvedRequestId,
      viewerRole: "admin",
      onData: (rows) => {
        setCanonicalDocRequestId(resolvedRequestId);
        setCanonicalDocRows(Array.isArray(rows) ? rows : []);
        setCanonicalDocErr("");
      },
      onError: (error) => {
        console.error("admin request details canonical docs error:", error);
        setCanonicalDocRequestId(resolvedRequestId);
        setCanonicalDocErr(error?.message || "Failed to load unified request documents.");
      },
    });

    return () => unsub?.();
  }, [resolvedRequestId]);

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
    if (!safeStr(overridePartnerId)) {
      setOverrideErr("Select a partner first.");
      setOverrideMsg("");
      return;
    }
    setOverrideErr("");
    setOverrideMsg("");
    setOverrideBusy(true);
    try {
      const result = await superAdminOverrideRouteRequest({
        requestId: req.id,
        selectedPartnerId: String(overridePartnerId || "").trim(),
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

  const getPaymentApprovalDraft = (payment) => {
    const id = safeStr(payment?.id);
    const current = paymentApprovalDraftById?.[id] || {};
    const defaultRequestDiscount = cleanPercentInput(
      payment?.breakdown?.requestDiscountPercentage ??
        payment?.financialSnapshot?.requestDiscountPercentage ??
        0,
      { allowZero: true }
    );
    return {
      paymentLabel:
        current.paymentLabel != null ? String(current.paymentLabel) : safeStr(payment?.paymentLabel),
      officialAmount:
        current.officialAmount != null
          ? String(current.officialAmount)
          : String(
              Number(
                payment?.breakdown?.officialAmount || payment?.financialSnapshot?.officialAmount || 0
              ) || ""
            ),
      serviceFee:
        current.serviceFee != null
          ? String(current.serviceFee)
          : String(
              Number(payment?.breakdown?.serviceFee || payment?.financialSnapshot?.serviceFee || 0) ||
                ""
            ),
      platformCutEnabled:
        current.platformCutEnabled != null
          ? Boolean(current.platformCutEnabled)
          : payment?.breakdown?.platformCutEnabled !== false,
      requestDiscountEnabled:
        current.requestDiscountEnabled != null
          ? Boolean(current.requestDiscountEnabled)
          : defaultRequestDiscount > 0,
      requestDiscountPercentage:
        current.requestDiscountPercentage != null
          ? String(current.requestDiscountPercentage)
          : defaultRequestDiscount > 0
            ? String(defaultRequestDiscount)
            : "",
      note: current.note != null ? String(current.note) : safeStr(payment?.note),
    };
  };

  const updatePaymentApprovalDraft = (paymentId, patch = {}) => {
    const id = safeStr(paymentId);
    if (!id) return;
    setPaymentApprovalDraftById((prev) => ({
      ...prev,
      [id]: {
        ...(prev?.[id] || {}),
        ...patch,
      },
    }));
  };

  const approveInProgressPayment = async (payment) => {
    const id = safeStr(payment?.id);
    if (!id) return;
    const draft = getPaymentApprovalDraft(payment);
    const paymentLabel = safeStr(draft.paymentLabel, 180);
    const officialAmount = cleanMoneyInput(draft.officialAmount);
    const serviceFee = cleanMoneyInput(draft.serviceFee, { allowZero: true });
    const platformCutEnabled = Boolean(draft.platformCutEnabled);
    const requestDiscountEnabled = globalDiscountEnabled ? false : Boolean(draft.requestDiscountEnabled);
    const requestDiscountPercentage = requestDiscountEnabled
      ? cleanPercentInput(draft.requestDiscountPercentage, { allowZero: false })
      : 0;
    const note = safeStr(draft.note, 2000);

    if (!paymentLabel) {
      alert("Payment label is required.");
      return;
    }
    if (!officialAmount) {
      alert("Official amount is required.");
      return;
    }
    if (!note) {
      alert("Applicant note is required.");
      return;
    }
    if (requestDiscountEnabled && requestDiscountPercentage <= 0) {
      alert("Enter a valid discount percentage between 1 and 100.");
      return;
    }

    setPaymentDecisionBusyId(id);
    try {
      await adminApproveInProgressPayment({
        requestId,
        paymentId: id,
        paymentLabel,
        officialAmount,
        serviceFee,
        platformCutEnabled,
        requestDiscountPercentage,
        note,
      });
    } catch (error) {
      alert(error?.message || "Failed to approve payment.");
    } finally {
      setPaymentDecisionBusyId("");
    }
  };

  const rejectInProgressPayment = async (paymentId) => {
    const id = safeStr(paymentId);
    if (!id) return;
    const reason = safeStr(paymentRejectReasonById?.[id] || "");
    if (!reason) {
      alert("Rejection reason is required.");
      return;
    }

    setPaymentDecisionBusyId(id);
    try {
      await adminRejectInProgressPayment({
        requestId,
        paymentId: id,
        rejectionReason: reason,
      });
      setPaymentRejectReasonById((prev) => ({ ...prev, [id]: "" }));
    } catch (error) {
      alert(error?.message || "Failed to reject payment.");
    } finally {
      setPaymentDecisionBusyId("");
    }
  };

  const approveRefund = async (refundId) => {
    const id = safeStr(refundId);
    if (!id) return;
    const explanation = safeStr(refundApproveExplanationById?.[id] || "");
    const etaText = safeStr(refundApproveEtaById?.[id] || "");
    if (!explanation) {
      alert("Approval explanation is required.");
      return;
    }
    if (!etaText) {
      alert("Expected refund period text is required.");
      return;
    }

    setRefundDecisionBusyId(id);
    try {
      await adminApproveRefund({
        requestId,
        refundId: id,
        adminExplanation: explanation,
        expectedRefundPeriodText: etaText,
      });
      setRefundApproveExplanationById((prev) => ({ ...prev, [id]: "" }));
      setRefundApproveEtaById((prev) => ({ ...prev, [id]: "" }));
    } catch (error) {
      alert(error?.message || "Failed to approve refund.");
    } finally {
      setRefundDecisionBusyId("");
    }
  };

  const rejectRefund = async (refundId) => {
    const id = safeStr(refundId);
    if (!id) return;
    const reason = safeStr(refundRejectReasonById?.[id] || "");
    if (!reason) {
      alert("Rejection explanation is required.");
      return;
    }

    setRefundDecisionBusyId(id);
    try {
      await adminRejectRefund({
        requestId,
        refundId: id,
        rejectionReason: reason,
      });
      setRefundRejectReasonById((prev) => ({ ...prev, [id]: "" }));
    } catch (error) {
      alert(error?.message || "Failed to reject refund.");
    } finally {
      setRefundDecisionBusyId("");
    }
  };

  if (loading) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className={`${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Loading…</div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
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
      : String(req?.assignedTo || "").trim()
      ?"Assigned to staff."
      : "Review the applicant details and documents, then make a decision.";
  const workProgress = getRequestWorkProgress(req);
  const showWorkProgressCard = Boolean(
    String(req?.assignedTo || "").trim() ||
      workProgress.isStarted ||
      workProgress.progressPercent ||
      progressUpdates.length > 0 ||
      req?.everAssigned
  );
  const adminProgressHint = String(req?.assignedTo || "").trim()
    ?"Updates appear here when staff posts them."
    : req?.everAssigned
    ? "Earlier updates remain below."
    : "Assign staff first.";

  const badgeText = chatPendingCount > 99 ?"99+" : String(chatPendingCount);
  const reassignmentCount = Array.isArray(req?.routingMeta?.reassignmentHistory)
    ?req.routingMeta.reassignmentHistory.length
    : 0;
  const validPartners = Array.isArray(routingOptions?.eligiblePartners)
    ? routingOptions.eligiblePartners
    : [];
  const partnerSelected = Boolean(safeStr(overridePartnerId));
  const selectedPartnerInOptions = validPartners.some(
    (partner) => safeStr(partner?.id) === safeStr(overridePartnerId)
  );
  const validAdmins = (
    partnerSelected
      ? validPartners.find((partner) => partner.id === overridePartnerId)?.admins || []
      : []
  ).filter((row, index, arr) => {
    const uid = safeStr(row?.uid);
    if (!uid) return false;
    return arr.findIndex((item) => safeStr(item?.uid) === uid) === index;
  });
  const missingSelectedPartnerLabel = safeStr(
    req?.preferredAgentName || req?.preferredAgentId || overridePartnerId
  );
  const currentAssignedPartnerName = safeStr(req?.assignedPartnerName || req?.routingMeta?.assignedPartnerName);
  const currentRoutingStatus = safeStr(req?.routingStatus || req?.routingMeta?.routingStatus || "awaiting_route");
  const unresolvedRoutingReason = safeStr(
    req?.routingMeta?.unresolvedReason || routingOptions?.unresolvedReason || ""
  );
  const unlockPayment =
    payments.find((p) => String(p.paymentType || "").toLowerCase() === PAYMENT_TYPES.UNLOCK_REQUEST) ||
    null;
  const inProgressPayments = payments.filter(
    (p) => String(p.paymentType || "").toLowerCase() === PAYMENT_TYPES.IN_PROGRESS
  );
  const canFinalizeDecision = !decisionLocked && status !== "new";
  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className={pageBg}>
      <div className="app-page-shell app-page-shell--wide">
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
          </div>
        </div>

        {showWorkProgressCard ?(
          <CollapsibleSectionCard
            className={`mt-4 ${card} p-4`}
            title="Progress"
            subtitle=""
            open={openSections.workProgress}
            onToggle={() => toggleSection("workProgress")}
          >
            <div className="mt-4">
              <RequestWorkProgressCard
                request={req}
                title=""
                subtitle={adminProgressHint}
                showWhenIdle={Boolean(String(req?.assignedTo || "").trim() || req?.everAssigned)}
                inProgressTone="red"
                idleText={
                  String(req?.assignedTo || "").trim()
                    ? "Assigned to staff. No update yet."
                    : "Currently unassigned. Earlier updates remain attached to this request."
                }
                pendingText="Staff has started work. An update has not been posted yet."
              />

              {progressUpdatesErr ? (
                <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                  {progressUpdatesErr}
                </div>
              ) : null}

              <RequestProgressUpdatesList
                updates={progressUpdates}
                viewerRole="admin"
                emptyText="No progress updates posted yet."
              />
            </div>
          </CollapsibleSectionCard>
        ) : null}

        <CollapsibleSectionCard
          className={`mt-4 ${card} p-4`}
          title="Routing overview"
          subtitle="Assigned admin routing and override controls."
          open={openSections.routing}
          onToggle={() => toggleSection("routing")}
        >
          <div className="mt-2 grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <div>
              Reassignments:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{reassignmentCount}</span>
            </div>
            <div>
              Routing status:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {currentRoutingStatus || "-"}
              </span>
            </div>
            <div>
              Preferred agent:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {req?.preferredAgentName || req?.preferredAgentId || "None"}
              </span>
            </div>
            <div>
              Assigned partner:{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {currentAssignedPartnerName || "-"}
              </span>
            </div>
            {unresolvedRoutingReason ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                {unresolvedRoutingReason}
              </div>
            ) : null}
          </div>

          {roleCtx?.isSuperAdmin ?(
            <div className="mt-4 rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-3">
              <div className="text-xs font-semibold text-emerald-800">Super admin override</div>
              <div className="mt-2 grid gap-2">
                <select
                  value={overridePartnerId}
                  onChange={(e) => {
                    setOverridePartnerId(e.target.value);
                    setOverrideTargetAdminUid("");
                  }}
                  disabled={overrideBusy}
                  className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Select partner</option>
                  {partnerSelected && !selectedPartnerInOptions ? (
                    <option value={overridePartnerId}>
                      {missingSelectedPartnerLabel || "Previously selected partner"} (not currently eligible)
                    </option>
                  ) : null}
                  {validPartners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.displayName}
                      {partner.isPreferred ? " (preferred)" : ""}
                    </option>
                  ))}
                </select>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={overrideTargetAdminUid}
                  onChange={(e) => setOverrideTargetAdminUid(e.target.value)}
                  disabled={overrideBusy || !partnerSelected}
                  className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">
                    {partnerSelected ? "Auto best route" : "Select a partner first"}
                  </option>
                  {validAdmins.map((row) => (
                    <option key={row.uid} value={row.uid}>
                      {`${String(row?.email || "No email")} - ${String(
                        row?.partnerName || currentAssignedPartnerName || ""
                      )}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={runSuperAdminOverride}
                  disabled={overrideBusy || !partnerSelected}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {overrideBusy ?"Applying..." : "Apply override"}
                </button>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
                Select a partner first. Admin options and auto-routing are constrained to that partner only.
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
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          className={`mt-4 ${card} p-5`}
          title="Payments"
          subtitle="Unlock and in-progress payment records for this request."
          open={openSections.payments}
          onToggle={() => toggleSection("payments")}
          badge={
            unreadRequestState?.paymentUnread ?(
              <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                New
              </span>
            ) : null
          }
          meta={
            <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              {payments.length} records
            </span>
          }
        >
          {paymentsErr ?(
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {paymentsErr}
            </div>
          ) : null}

          {unlockPayment ?(
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-emerald-900">Unlock request payment</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {unlockPayment.currency} {Number(unlockPayment.amount || 0).toLocaleString()}
                  </div>
                  {unlockPayment.transactionReference ?(
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                      Ref: <span className="font-semibold">{unlockPayment.transactionReference}</span>
                    </div>
                  ) : null}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${paymentStatusUi(unlockPayment.status).cls}`}>
                  {paymentStatusUi(unlockPayment.status).label}
                </span>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            {inProgressPayments.length === 0 ?(
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                No in-progress payment proposals yet.
              </div>
            ) : (
              inProgressPayments.map((payment) => {
                const pStatus = String(payment.status || "").toLowerCase();
                const isPending =
                  pStatus === PAYMENT_STATUSES.ADMIN_REVIEW ||
                  pStatus === PAYMENT_STATUSES.PROMPTED ||
                  pStatus === PAYMENT_STATUSES.DRAFT;
                const isBusy = paymentDecisionBusyId === payment.id;
                const ui = paymentStatusUi(pStatus);
                const approvalDraft = getPaymentApprovalDraft(payment);
                return (
                  <div key={payment.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                          {payment.paymentLabel || "In-progress payment"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          User pays: {formatMoney(payment.amount, payment.currency)}
                        </div>
                        {payment.breakdown ?(
                          <div className="mt-2 grid gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                            <div>
                              Official amount:{" "}
                              {formatMoney(payment.breakdown.officialAmount, payment.currency)}
                            </div>
                            <div>
                              Service fee: {formatMoney(payment.breakdown.serviceFee, payment.currency)}
                            </div>
                            {Number(payment?.breakdown?.discountAmount || 0) > 0 ? (
                              <div>
                                Discount:{" "}
                                {formatMoney(payment.breakdown.discountAmount, payment.currency)}
                              </div>
                            ) : null}
                            <div>
                              Platform addition:{" "}
                              {formatMoney(payment.breakdown.platformCutAmount, payment.currency)}
                            </div>
                            <div>
                              Estimated partner payout:{" "}
                              {formatMoney(
                                payment.breakdown.estimatedNetPartnerPayable,
                                payment.currency
                              )}
                            </div>
                          </div>
                        ) : null}
                        {payment.note ?(
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                            {payment.note}
                          </div>
                        ) : null}
                        {payment.rejectionReason ?(
                          <div className="mt-1 text-xs text-rose-700 whitespace-pre-wrap">
                            Rejection reason: {payment.rejectionReason}
                          </div>
                        ) : null}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ui.cls}`}>
                        {ui.label}
                      </span>
                    </div>

                    {isPending ?(
                      <div className="mt-3 grid gap-2">
                        <input
                          value={approvalDraft.paymentLabel}
                          onChange={(e) =>
                            updatePaymentApprovalDraft(payment.id, { paymentLabel: e.target.value })
                          }
                          placeholder="Payment label"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={isBusy}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={approvalDraft.officialAmount}
                            onChange={(e) =>
                              updatePaymentApprovalDraft(payment.id, {
                                officialAmount: e.target.value,
                              })
                            }
                            placeholder="Official amount"
                            inputMode="decimal"
                            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                            disabled={isBusy}
                          />
                          <input
                            value={approvalDraft.serviceFee}
                            onChange={(e) =>
                              updatePaymentApprovalDraft(payment.id, {
                                serviceFee: e.target.value,
                              })
                            }
                            placeholder="Service fee"
                            inputMode="decimal"
                            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                            disabled={isBusy}
                          />
                        </div>
                        <label className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
                          <input
                            type="checkbox"
                            checked={approvalDraft.platformCutEnabled === true}
                            onChange={(e) =>
                              updatePaymentApprovalDraft(payment.id, {
                                platformCutEnabled: e.target.checked,
                              })
                            }
                            disabled={isBusy}
                            className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-400"
                          />
                          Apply platform cut for this request
                        </label>
                        <label className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
                          <input
                            type="checkbox"
                            checked={
                              globalDiscountEnabled
                                ? false
                                : approvalDraft.requestDiscountEnabled === true
                            }
                            onChange={(e) =>
                              updatePaymentApprovalDraft(payment.id, {
                                requestDiscountEnabled: e.target.checked,
                              })
                            }
                            disabled={isBusy || globalDiscountEnabled}
                            className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-400"
                          />
                          Apply per-request discount
                        </label>
                        <input
                          value={approvalDraft.requestDiscountPercentage}
                          onChange={(e) =>
                            updatePaymentApprovalDraft(payment.id, {
                              requestDiscountPercentage: e.target.value,
                            })
                          }
                          placeholder={
                            globalDiscountEnabled
                              ? "Global discount is active"
                              : "Discount % (1-100)"
                          }
                          inputMode="numeric"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={
                            isBusy ||
                            globalDiscountEnabled ||
                            approvalDraft.requestDiscountEnabled !== true
                          }
                        />
                        {globalDiscountEnabled ? (
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            Global discount is enabled, so per-request discount is ignored.
                          </div>
                        ) : null}
                        <textarea
                          value={approvalDraft.note}
                          onChange={(e) =>
                            updatePaymentApprovalDraft(payment.id, { note: e.target.value })
                          }
                          rows={3}
                          placeholder="Applicant note"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={isBusy}
                        />
                        <textarea
                          value={String(paymentRejectReasonById?.[payment.id] || "")}
                          onChange={(e) =>
                            setPaymentRejectReasonById((prev) => ({ ...prev, [payment.id]: e.target.value }))
                          }
                          rows={2}
                          placeholder="Rejection reason (required when rejecting)"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={isBusy}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => approveInProgressPayment(payment)}
                            disabled={isBusy}
                            className="rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {isBusy ? "Please wait..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectInProgressPayment(payment.id)}
                            disabled={isBusy}
                            className="rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          className={`mt-4 ${card} p-5`}
          title="Refund requests"
          subtitle="Each refund targets a specific payment ID."
          open={openSections.refunds}
          onToggle={() => toggleSection("refunds")}
          badge={
            unreadRequestState?.refundUnread ?(
              <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                New
              </span>
            ) : null
          }
          meta={
            <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              {refunds.length} requests
            </span>
          }
        >
          {refundsErr ?(
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {refundsErr}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            {refunds.length === 0 ?(
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                No refund requests yet.
              </div>
            ) : (
              refunds.map((refund) => {
                const rStatus = String(refund.status || "").toLowerCase();
                const pending = rStatus === REFUND_STATUSES.REQUESTED;
                const isBusy = refundDecisionBusyId === refund.id;
                const ui = refundStatusUi(rStatus);
                return (
                  <div key={refund.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                          {refund.paymentLabel || "Refund request"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          Payment ID: <span className="font-mono">{refund.paymentId}</span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          {refund.currency} {Number(refund.amount || 0).toLocaleString()}
                        </div>
                        {refund.userReason ?(
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                            User reason: {refund.userReason}
                          </div>
                        ) : null}
                        {refund.adminExplanation ?(
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                            Decision note: {refund.adminExplanation}
                          </div>
                        ) : null}
                        {refund.expectedRefundPeriodText ?(
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                            ETA: {refund.expectedRefundPeriodText}
                          </div>
                        ) : null}
                        {refund.rejectionReason ?(
                          <div className="mt-1 text-xs text-rose-700 whitespace-pre-wrap">
                            Rejection: {refund.rejectionReason}
                          </div>
                        ) : null}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ui.cls}`}>
                        {ui.label}
                      </span>
                    </div>

                    {pending ?(
                      <div className="mt-3 grid gap-2">
                        <textarea
                          value={String(refundApproveExplanationById?.[refund.id] || "")}
                          onChange={(e) =>
                            setRefundApproveExplanationById((prev) => ({ ...prev, [refund.id]: e.target.value }))
                          }
                          rows={2}
                          placeholder="Approval note to applicant"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={isBusy}
                        />
                        <input
                          value={String(refundApproveEtaById?.[refund.id] || "")}
                          onChange={(e) =>
                            setRefundApproveEtaById((prev) => ({ ...prev, [refund.id]: e.target.value }))
                          }
                          placeholder="Expected refund period (e.g. 3 to 7 business days)"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={isBusy}
                        />
                        <textarea
                          value={String(refundRejectReasonById?.[refund.id] || "")}
                          onChange={(e) =>
                            setRefundRejectReasonById((prev) => ({ ...prev, [refund.id]: e.target.value }))
                          }
                          rows={2}
                          placeholder="Rejection explanation (required when rejecting)"
                          className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100"
                          disabled={isBusy}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => approveRefund(refund.id)}
                            disabled={isBusy}
                            className="rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {isBusy ? "Please wait..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => rejectRefund(refund.id)}
                            disabled={isBusy}
                            className="rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleSectionCard>

        {!roleCtx?.isSuperAdmin ? (
          <CollapsibleSectionCard
            className={`mt-4 ${card} p-5`}
            title="Staff assignment"
            subtitle="Assign or reassign staff for this request."
            open={openSections.assignment}
            onToggle={() => toggleSection("assignment")}
          >
            <div className="mt-4">
              {req && !decisionLocked ?(
                <AssignStaffPanel request={req} />
              ) : (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                  Staff assignment is disabled because this request is already
                  finalized.
                </div>
              )}
            </div>
          </CollapsibleSectionCard>
        ) : null}

        <CollapsibleSectionCard
          className={`mt-6 ${card} p-5`}
          title="Applicant"
          subtitle="Basic details and document fields."
          open={openSections.applicant}
          onToggle={() => toggleSection("applicant")}
        >
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => navigate(`/app/admin/request/${requestId}/documents`)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60"
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

            <RequestDocumentFieldsSection
              request={req}
              requestId={requestId}
              title="Document fields"
              viewerRole="admin"
              attachments={canonicalAttachments}
              attachmentsLoading={canonicalAttachmentsLoading}
              attachmentsError={canonicalAttachmentsError}
            />
            <RequestExtraDetailsSection
              request={req}
              title="Extra details"
              includeDocumentFields={false}
            />
          </div>
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          className={`mt-6 ${card} p-5`}
          title="Message to applicant"
          subtitle="This shows on the applicant's Request Details. Required if rejecting."
          open={openSections.messageToApplicant}
          onToggle={() => toggleSection("messageToApplicant")}
        >
          <textarea
            className="mt-4 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 min-h-[120px] disabled:opacity-70"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving || decisionLocked}
            placeholder="Example: Please upload a clear passport bio page, then re-submit. Processing starts 24-48 hours after upload."
          />
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          className={`mt-6 ${card} p-5`}
          title="Staff suggested files"
          subtitle="These are links staff added. If staff recommended accept, they auto-fill your attach files section."
          open={openSections.staffSuggestedFiles}
          onToggle={() => toggleSection("staffSuggestedFiles")}
          meta={
            stagingStaffDrafts ?(
              <span className="rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                Autofilling...
              </span>
            ) : (
              <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                {staffDrafts.length} items
              </span>
            )
          }
        >
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
                          <FileAccessLink
                            file={{ externalUrl: url, name: safeStr(d?.name) || "Staff file" }}
                            className="mt-2 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                          >
                            Open link
                          </FileAccessLink>
                        ) : (
                          <div className="mt-2 text-sm text-zinc-500">
                            No valid link
                          </div>
                        )}

                        {staged ?(
                          <div className="mt-2 text-xs font-semibold text-emerald-800">
                            Already staged to applicant
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
        </CollapsibleSectionCard>

        <CollapsibleSectionCard
          className={`mt-6 ${card} p-5`}
          title="Attach Files"
          subtitle=""
          open={openSections.attachments}
          onToggle={() => toggleSection("attachments")}
          meta={
            <span className="text-[11px] font-semibold text-emerald-800">
              Sends on Accept
            </span>
          }
        >
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
                  {addingDraft ?"Adding..." : "Add"}
                </button>
              </div>

            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
              Decision is locked - attachments cannot be changed.
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
                        <FileAccessLink
                          file={{ externalUrl: d.url, name: d.name || "File" }}
                          className="mt-2 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                          title="Open file"
                        >
                          Open link
                        </FileAccessLink>
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
        </CollapsibleSectionCard>
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
          ) : !canFinalizeDecision ?(
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
              Final decision unlocks after staff taps Start Work. While the request is still in New,
              accept and reject stay disabled.
            </div>
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
      </div>
    </div>
  );
}






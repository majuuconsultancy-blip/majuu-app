// ✅ RequestStatusScreen.jsx (ORIGINAL LOGIC • POLISHED TILES • FLOATY INTERACTIONS • NO DOUBLE CHAT)
// What changed (UI only):
// - Adds framer-motion for smooth entrance + floaty hover/tap on tiles
// - Subtle background glow blobs (very light, not distracting)
// - Cards get a nicer shadow + border highlight on hover
// - Lists animate in gently
// - ✅ Chat row stays EXACTLY as your original (only card hover/press anim) -> no duplicate “Chat” label

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
} from "firebase/firestore";
import { motion } from "../utils/motionProxy";
import RequestChatLauncher from "../components/RequestChatLauncher";
import CollapsibleSection from "../components/CollapsibleSection";
import RequestDocumentFieldsSection from "../components/RequestDocumentFieldsSection";
import RequestWorkProgressCard from "../components/RequestWorkProgressCard";
import RequestProgressUpdatesList from "../components/RequestProgressUpdatesList";
import RequestExtraDetailsSection from "../components/RequestExtraDetailsSection";

import { auth, db } from "../firebase";
import { clearActiveProcess } from "../services/userservice";
import { smartBack } from "../utils/navBack";
import {
  buildFullPackageHubPath,
  normalizeFullPackageItems,
  toFullPackageItemKey,
} from "../services/fullpackageservice";
import { normalizeTextDeep } from "../utils/textNormalizer";
import { getRequestWorkProgress } from "../utils/requestWorkProgress";
import {
  createPaymentCheckoutSession,
  createRefundRequest,
  getOrCreateSharedPaymentLink,
  normalizePaymentDoc,
  normalizeRefundDoc,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  paymentStatusUi,
  refundStatusUi,
} from "../services/paymentservice";
import { subscribeRequestProgressUpdates } from "../services/requestcontinuityservice";
import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
import { buildLegalDocRoute, LEGAL_DOC_KEYS } from "../legal/legalRegistry";
import { isUnsubmittedGhostRequest } from "../utils/requestGhosts";
import { getUserRequestState } from "../utils/requestLifecycle";

/* ---------------- Minimal icons ---------------- */
function IconReceipt(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3.8h10A2.2 2.2 0 0 1 19.2 6v15.2l-2.2-1.2-2.2 1.2-2.2-1.2-2.2 1.2-2.2-1.2-2.2 1.2V6A2.2 2.2 0 0 1 7 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 8.4h7.6M8.2 12h7.6M8.2 15.6h5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconNote(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3.8h7.8L20.2 9v11.2A1.8 1.8 0 0 1 18.4 22H7A3.2 3.2 0 0 1 3.8 18.8V7A3.2 3.2 0 0 1 7 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 3.8V9h5.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.8 13h8M7.8 16.4h6.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconFile(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 3.8h6.6L19.2 8.4v12a1.8 1.8 0 0 1-1.8 1.8H8A3.2 3.2 0 0 1 4.8 18.8V7A3.2 3.2 0 0 1 8 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.6 3.8v4.6h4.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconArrowLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 18 8.5 12l6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevronDown(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 9.5 12 15l5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCopy(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2.1" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6.7 15H6A1.8 1.8 0 0 1 4.2 13.2V6A1.8 1.8 0 0 1 6 4.2h7.2A1.8 1.8 0 0 1 15 6v.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- Helpers ---------------- */
function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function startCase(value) {
  const text = safeStr(value, 120).toLowerCase();
  if (!text) return "";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncateMiddle(value, lead = 10, tail = 8) {
  const text = safeStr(value, 240);
  if (!text || text.length <= lead + tail + 3) return text;
  return `${text.slice(0, lead)}...${text.slice(-tail)}`;
}

function clampPercent(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, num));
}

function statusUI(request) {
  const s = getUserRequestState(request);

  if (s === "submitted")
    return {
      label: "Submitted",
      badge: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
    };

  if (s === "in_progress")
    return {
      label: "In progress",
      badge: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };

  if (s === "completed")
    return {
      label: "Completed",
      badge: "bg-emerald-100 text-emerald-900 border border-emerald-200",
    };

  if (s === "rejected")
    return {
      label: "Needs correction",
      badge: "bg-rose-50 text-rose-700 border border-rose-100",
    };

  return {
    label: s,
    badge: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
  };
}

function attachmentStatusLabel(status) {
  const s = String(status || "pending_upload").toLowerCase();
  if (s === "pending_upload") return "Received";
  if (s === "uploaded") return "Uploaded";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return s;
}

function bytesToLabel(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return "0 KB";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date ?d.getTime() : 0;
  }
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ?parsed : 0;
}

function normalizeRequestOutcome(req) {
  const status = String(req?.status || "").trim().toLowerCase();
  const finalDecision = String(req?.finalDecision || "").trim().toLowerCase();
  if (status === "rejected" || finalDecision === "rejected") return "rejected";
  if (status === "closed" || status === "accepted" || finalDecision === "accepted") return "accepted";
  return "submitted";
}

/** ✅ Fallback for old requests: parse "Missing items: ..." from note */
function parseMissingItemsFromNote(note) {
  const text = String(note || "");
  const match = text.match(/Missing items:\s*([^\n\r]+)/i);
  if (!match) return [];
  const raw = match[1].trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

function buildProgressSummary(request, progressUpdates, workProgress) {
  const updates = Array.isArray(progressUpdates)
    ? progressUpdates.filter((row) => row && row.visibleToUser !== false)
    : [];
  const latestUpdate = updates[0] || null;
  const updatesWithPercent = updates.filter((row) =>
    Number.isFinite(Number(row?.progressPercent))
  );
  const latestPercentUpdate = updatesWithPercent[0] || null;
  const previousPercentUpdate = updatesWithPercent[1] || null;
  const latestPercent = clampPercent(
    latestPercentUpdate?.progressPercent ?? workProgress?.progressPercent
  );
  const requestState = getUserRequestState(request);
  const status = safeStr(request?.status, 80).toLowerCase();
  const isFull =
    Boolean(request?.isFullPackage) || safeStr(request?.requestType, 40).toLowerCase() === "full";

  let percent = latestPercent;
  if (percent == null) {
    if (requestState === "completed" || status === "closed") percent = 100;
    else if (requestState === "rejected" || status === "rejected") percent = 35;
    else if (requestState === "in_progress" || workProgress?.isStarted) percent = 40;
    else percent = 10;
  }

  const previousPercent = clampPercent(previousPercentUpdate?.progressPercent);
  let helperText = "";
  if (latestPercent != null && previousPercent != null && latestPercent !== previousPercent) {
    helperText = `Updated from ${previousPercent}% to ${latestPercent}%`;
  } else {
    helperText = safeStr(latestUpdate?.content, 220);
  }

  if (!helperText) {
    if (percent >= 100) {
      helperText = isFull
        ? "Request completed and ready for the next step."
        : "Request completed successfully.";
    } else if (requestState === "rejected" || status === "rejected") {
      helperText = "Staff requested changes before the next step.";
    } else if (requestState === "in_progress" || workProgress?.isStarted) {
      helperText = "Documents received and under review.";
    } else {
      helperText = "Request received and waiting for staff review.";
    }
  }

  return {
    percent,
    badgeLabel: percent >= 100 ? "Complete" : `${percent}%`,
    helperText,
  };
}

/* ---------------- Motion ---------------- */
const pageIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.03 } },
};

const tileIn = {
  hidden: { opacity: 0, y: 10, scale: 0.995 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 520, damping: 42 },
  },
};

const floaty = {
  rest: { y: 0, scale: 1 },
  hover: { y: -2, scale: 1.01, transition: { duration: 0.16 } },
  tap: { scale: 0.99 },
};

const EMPTY_REQUEST_UNREAD_STATE = Object.freeze({});

export default function RequestStatusScreen() {
  const navigate = useNavigate();
  const { requestId } = useParams();
  const paymentPolicyBackTo = requestId ? `/app/request/${requestId}` : "/app/progress";

  const [loading, setLoading] = useState(true);
  const [req, setReq] = useState(null);
  const [err, setErr] = useState("");

  const [fileErr, setFileErr] = useState("");
  const [attachments, setAttachments] = useState([]);

  const [adminFilesErr, setAdminFilesErr] = useState("");
  const [adminFiles, setAdminFiles] = useState([]);
  const [fullPackageItems, setFullPackageItems] = useState([]);
  const [fullPackageLinkedRequests, setFullPackageLinkedRequests] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentsErr, setPaymentsErr] = useState("");
  const [paymentsMsg, setPaymentsMsg] = useState("");
  const [refunds, setRefunds] = useState([]);
  const [refundsErr, setRefundsErr] = useState("");
  const [selectedRefundPaymentId, setSelectedRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [paymentBusyId, setPaymentBusyId] = useState("");
  const [shareBusyId, setShareBusyId] = useState("");
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [refundsOpen, setRefundsOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(true);
  const [adminDocumentsOpen, setAdminDocumentsOpen] = useState(false);
  const [requestIdCopied, setRequestIdCopied] = useState(false);
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [progressUpdatesErr, setProgressUpdatesErr] = useState("");
  const unreadRequestState = useNotifsV2Store(
    (s) => s.unreadByRequest?.[String(requestId || "").trim()] || EMPTY_REQUEST_UNREAD_STATE
  );

  // subtle "apple-ish" entrance animation (CSS-only, no deps)
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);

  const validRequestId = useMemo(() => {
    const id = String(requestId || "").trim();
    return id.length > 0 ?id : null;
  }, [requestId]);

  const isFullRequest =
    Boolean(req?.isFullPackage) || String(req?.requestType || "").toLowerCase() === "full";
  const fullPackageIdValue = String(
    req?.fullPackageId || req?.fullPackage?.fullPackageId || req?.fullPackage?.id || ""
  ).trim();
  const fallbackFullPackageItems = useMemo(() => {
    return normalizeFullPackageItems(
      req?.fullPackageSelectedItems || req?.missingItems || parseMissingItemsFromNote(req?.note)
    );
  }, [req?.fullPackageSelectedItems, req?.missingItems, req?.note]);

  // ✅ IMPORTANT: ensure any modal/portal chat always sits on top
  const TOP_LAYER_CLS = "relative isolate z-0";

  useEffect(() => {
    let unsubDoc = null;
    let unsubAtt = null;
    let unsubAdminFiles = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubDoc) unsubDoc();
      if (unsubAtt) unsubAtt();
      if (unsubAdminFiles) unsubAdminFiles();

      unsubDoc = null;
      unsubAtt = null;
      unsubAdminFiles = null;

      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      if (!validRequestId) {
        setErr("Missing request ID in URL.");
        setReq(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr("");

      const ref = doc(db, "serviceRequests", validRequestId);
      unsubDoc = onSnapshot(
        ref,
        async (snap) => {
          if (!snap.exists()) {
            setErr("Request not found.");
            setReq(null);
            setLoading(false);
            return;
          }

          const data = normalizeTextDeep({ id: snap.id, ...snap.data() });
          if (isUnsubmittedGhostRequest(data)) {
            try {
              await clearActiveProcess(user.uid);
            } catch (e) {
              console.error("clearActiveProcess failed for ghost request:", e);
            }
            navigate("/app/progress", { replace: true });
            return;
          }

          setReq(data);
          setLoading(false);

          const st = String(data.status || "").toLowerCase();
          if (st === "closed" || st === "rejected") {
            try {
              await clearActiveProcess(user.uid);
            } catch (e) {
              console.error("clearActiveProcess failed:", e);
            }
          }
        },
        (e) => {
          console.error("Request doc snapshot error:", e);
          setErr(e?.message || "Failed to load request.");
          setLoading(false);
        }
      );

      const attRef = collection(db, "serviceRequests", validRequestId, "attachments");
      const attQ = query(attRef, orderBy("createdAt", "desc"));
      unsubAtt = onSnapshot(
        attQ,
        (snap) => {
          setAttachments(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
          setFileErr("");
        },
        (e) => {
          console.error("attachments snapshot error:", e);
          setFileErr(e?.message || "Failed to load submitted documents.");
        }
      );

      const afRef = collection(db, "serviceRequests", validRequestId, "adminFiles");
      const afQ = query(afRef, orderBy("createdAt", "desc"));
      unsubAdminFiles = onSnapshot(
        afQ,
        (snap) => {
          setAdminFiles(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
          setAdminFilesErr("");
        },
        (e) => {
          console.error("adminFiles snapshot error:", e);
          setAdminFilesErr(e?.message || "Failed to load documents from MAJUU.");
        }
      );
    });

    return () => {
      if (unsubDoc) unsubDoc();
      if (unsubAtt) unsubAtt();
      if (unsubAdminFiles) unsubAdminFiles();
      unsubAuth();
    };
  }, [navigate, validRequestId]);

  useEffect(() => {
    if (!validRequestId) return;

    const ref = collection(db, "serviceRequests", validRequestId, "payments");
    const qy = query(ref, orderBy("createdAtMs", "desc"));
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
        console.error("request payments snapshot error:", error);
        setPaymentsErr(error?.message || "Failed to load payments.");
      }
    );

    return () => unsub();
  }, [validRequestId]);

  useEffect(() => {
    if (!validRequestId) return;

    const ref = collection(db, "serviceRequests", validRequestId, "refundRequests");
    const qy = query(ref, orderBy("createdAtMs", "desc"));
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
        console.error("request refunds snapshot error:", error);
        setRefundsErr(error?.message || "Failed to load refunds.");
      }
    );

    return () => unsub();
  }, [validRequestId]);

  useEffect(() => {
    if (!validRequestId) return;
    notifsV2Store.markRequestNotificationsRead(validRequestId).catch(() => {});
  }, [validRequestId]);

  useEffect(() => {
    setPaymentsOpen(false);
    setRefundsOpen(false);
    setDocumentsOpen(true);
    setAdminDocumentsOpen(false);
    setRequestIdCopied(false);
  }, [validRequestId]);

  useEffect(() => {
    if (!requestIdCopied) return undefined;
    const timer = window.setTimeout(() => setRequestIdCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [requestIdCopied]);

  useEffect(() => {
    if (!validRequestId) return undefined;

    const unsub = subscribeRequestProgressUpdates({
      requestId: validRequestId,
      viewerRole: "user",
      onData: (rows) => {
        setProgressUpdates(rows);
        setProgressUpdatesErr("");
      },
      onError: (error) => {
        console.error("request progress updates snapshot error:", error);
        setProgressUpdatesErr(error?.message || "Failed to load progress updates.");
      },
    });

    return () => unsub?.();
  }, [validRequestId]);

  useEffect(() => {
    if (!isFullRequest || !fullPackageIdValue) return;

    const unsubs = [];
    const ownerUid = String(req?.uid || "").trim();

    const fpRef = doc(db, "fullPackages", fullPackageIdValue);
    unsubs.push(
      onSnapshot(fpRef, (snap) => {
        if (!snap.exists()) {
          setFullPackageItems(fallbackFullPackageItems);
          return;
        }
        const items = normalizeFullPackageItems(normalizeTextDeep(snap.data()?.selectedItems));
        setFullPackageItems(items.length ?items : fallbackFullPackageItems);
      })
    );

    const linkedQ = query(
      collection(db, "serviceRequests"),
      where("fullPackageId", "==", fullPackageIdValue)
    );
    unsubs.push(
      onSnapshot(
        linkedQ,
        (snap) => {
          const rows = snap.docs
            .map((d) => normalizeTextDeep({ id: d.id, ...d.data() }))
            .filter((row) => {
              const sameOwner = !ownerUid || String(row.uid || "") === ownerUid;
              const isFullRow =
                Boolean(row.isFullPackage) ||
                String(row.requestType || "").toLowerCase() === "full";
              return sameOwner && isFullRow;
            });
          setFullPackageLinkedRequests(rows);
        },
        (error) => {
          console.error("full package status list snapshot error:", error);
          setFullPackageLinkedRequests([]);
        }
      )
    );

    return () => {
      unsubs.forEach((fn) => {
        try {
          fn?.();
        } catch (error) {
          void error;
        }
      });
    };
  }, [isFullRequest, fullPackageIdValue, req?.uid, fallbackFullPackageItems]);

  const latestFullPackageByItemKey = useMemo(() => {
    const out = new Map();
    for (const row of fullPackageLinkedRequests) {
      const key = String(
        row.fullPackageItemKey ||
          toFullPackageItemKey(row.fullPackageItem || row.serviceName || "")
      ).trim();
      if (!key) continue;

      const ts = Math.max(
        toMillis(row.updatedAt),
        toMillis(row.decidedAt),
        toMillis(row.createdAt)
      );
      const existing = out.get(key);
      if (!existing || ts >= existing.__ts) {
        out.set(key, { ...row, __ts: ts });
      }
    }
    return out;
  }, [fullPackageLinkedRequests]);

  const fullPackageStatusRows = useMemo(() => {
    if (!isFullRequest) return [];
    const sourceItems = fullPackageItems.length ?fullPackageItems : fallbackFullPackageItems;
    return sourceItems.map((item) => {
      const key = toFullPackageItemKey(item);
      const latest = latestFullPackageByItemKey.get(key);
      const outcome = latest ?normalizeRequestOutcome(latest) : "not_started";

      let toneClass = "text-zinc-900";
      if (outcome === "accepted") toneClass = "text-emerald-700";
      else if (outcome === "rejected") toneClass = "text-rose-700";

      return { key, item, toneClass };
    });
  }, [
    isFullRequest,
    fullPackageItems,
    fallbackFullPackageItems,
    latestFullPackageByItemKey,
  ]);

  // ✅ keep your original base styles, just slightly upgraded
  const cardBase =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition duration-300 ease-out";
  const cardPolish =
    "hover:shadow-[0_14px_45px_rgba(0,0,0,0.08)] hover:border-emerald-200/80 active:shadow-sm";
  const softBg = "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const enterWrap =
    "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ?"opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  if (loading) {
    return (
      <div className={`min-h-screen ${softBg} ${TOP_LAYER_CLS}`}>
        <div className="max-w-xl mx-auto px-5 py-10">
          <div className={`${cardBase} p-5`}>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Loading request…</p>
          </div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={`min-h-screen ${softBg} ${TOP_LAYER_CLS}`}>
        <div className="max-w-xl mx-auto px-5 py-10">
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-5 text-sm text-rose-700">
            {err}
          </div>

          <button
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-white active:scale-[0.99]"
            onClick={() => navigate("/app/progress")}
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Progress
          </button>
        </div>
      </div>
    );
  }

  const ui = statusUI(req);
  const track = String(req?.track || "").toLowerCase();
  const safeTrack = track === "work" || track === "travel" ?track : "study";
  const st = String(req?.status || "new").toLowerCase();
  const country = String(req?.country || "Not selected");

  const adminNote = String(
    req?.adminDecisionNote || req?.decisionNote || req?.adminNote || ""
  ).trim();
  const isFull = isFullRequest;
  const fullPackageHubPath = buildFullPackageHubPath({
    fullPackageId: fullPackageIdValue,
    track: safeTrack,
  });
  const canBackToFullPackage = isFull && Boolean(fullPackageHubPath);
  const canStartNew = !isFull && st === "closed";
  const canTryAgain = st === "rejected";
  const showLegacySubmittedDocuments = Boolean(req?.legacySubmittedDocumentsVisible);

  const goToFullPackageHub = ({ autoOpen = false, retryItemKey = "", item = "" } = {}) => {
    if (!fullPackageHubPath) return;
    const qs = new URLSearchParams();
    if (country && country !== "Not selected") qs.set("country", country);
    qs.set("track", safeTrack);
    if (autoOpen) qs.set("autoOpen", "1");
    if (retryItemKey) qs.set("retryItemKey", retryItemKey);
    if (item) qs.set("item", item);

    const missingItems =
      fullPackageItems.length > 0 ?fullPackageItems : fallbackFullPackageItems;
    const suffix = qs.toString();

    navigate(suffix ?`${fullPackageHubPath}&${suffix}` : fullPackageHubPath, {
      state: {
        fullPackageId: fullPackageIdValue,
        missingItems,
      },
    });
  };

  const handleTryAgain = () => {
    const country = req?.country || "Not selected";
    const countryQS2 = encodeURIComponent(country);

    if (isFull) {
      const fallbackItem =
        String(req?.fullPackageItem || "").trim() ||
        String(fullPackageItems?.[0] || fallbackFullPackageItems?.[0] || "").trim() ||
        "Document checklist";
      const retryItemKey = String(
        req?.fullPackageItemKey || toFullPackageItemKey(fallbackItem)
      ).trim();

      if (fullPackageHubPath) {
        goToFullPackageHub({ autoOpen: true, retryItemKey, item: fallbackItem });
        return;
      }

      let missingItems = Array.isArray(req?.missingItems) ?req.missingItems : [];
      if (!missingItems.length) missingItems = parseMissingItemsFromNote(req?.note);
      navigate(
        `/app/full-package/${safeTrack}?country=${countryQS2}&autoOpen=1&item=${encodeURIComponent(
          fallbackItem
        )}`,
        { state: { missingItems } }
      );
      return;
    }

    const serviceName = String(req?.serviceName || "").trim();
    navigate(
      `/app/${safeTrack}/we-help?country=${countryQS2}&autoOpen=1&open=${encodeURIComponent(
        serviceName
      )}`
    );
  };

  const serviceTitle = `${String(req?.track || "").toUpperCase()} • ${req?.country || "-"}`;
  const requestTypeLabel = isFull
    ? "Full package"
    : startCase(req?.requestType || "single request") || "Single request";
  const serviceNameLabel =
    safeStr(req?.serviceName, 160) ||
    safeStr(req?.fullPackageItem, 160) ||
    (isFull ? "Bundled request journey" : "-");
  const workProgress = getRequestWorkProgress(req);
  const progressSummary = buildProgressSummary(req, progressUpdates, workProgress);
  const showWorkProgressCard = Boolean(req);
  const requestIdentifier = safeStr(req?.id || validRequestId, 240);
  const requestIdLabel = truncateMiddle(requestIdentifier);
  const unlockPayment =
    payments.find((p) => String(p.paymentType || "").toLowerCase() === PAYMENT_TYPES.UNLOCK_REQUEST) ||
    null;
  const pendingUserPayments = payments.filter((p) => {
    const status = String(p.status || "").toLowerCase();
    if (
      status !== PAYMENT_STATUSES.PAYABLE &&
      status !== PAYMENT_STATUSES.PAYMENT_SESSION_CREATED &&
      status !== PAYMENT_STATUSES.AWAITING_PAYMENT
    ) {
      return false;
    }
    const paymentType = String(p.paymentType || "").toLowerCase();
    return paymentType !== PAYMENT_TYPES.UNLOCK_REQUEST;
  });
  const visiblePayments = payments.filter((payment) => {
    const paymentType = String(payment.paymentType || "").toLowerCase();
    const status = String(payment.status || "").toLowerCase();
    if (paymentType === PAYMENT_TYPES.UNLOCK_REQUEST) {
      return (
        status === PAYMENT_STATUSES.PAID ||
        status === PAYMENT_STATUSES.AUTO_REFUNDED ||
        status === PAYMENT_STATUSES.REFUNDED
      );
    }
    if (paymentType === PAYMENT_TYPES.IN_PROGRESS) {
      return (
        status === PAYMENT_STATUSES.PAYABLE ||
        status === PAYMENT_STATUSES.PAYMENT_SESSION_CREATED ||
        status === PAYMENT_STATUSES.AWAITING_PAYMENT ||
        status === PAYMENT_STATUSES.FAILED ||
        status === PAYMENT_STATUSES.EXPIRED ||
        status === PAYMENT_STATUSES.REVOKED ||
        status === PAYMENT_STATUSES.HELD ||
        status === PAYMENT_STATUSES.PAYOUT_READY ||
        status === PAYMENT_STATUSES.SETTLED ||
        status === PAYMENT_STATUSES.REFUND_REQUESTED ||
        status === PAYMENT_STATUSES.REFUND_UNDER_REVIEW ||
        status === PAYMENT_STATUSES.REFUNDED ||
        status === PAYMENT_STATUSES.AUTO_REFUNDED
      );
    }
    return false;
  });
  const historyPayments = visiblePayments.filter((payment) => {
    const paymentId = String(payment?.id || "").trim();
    if (!paymentId) return false;
    if (paymentId === String(unlockPayment?.id || "").trim()) return false;
    return !pendingUserPayments.some((row) => String(row?.id || "").trim() === paymentId);
  });
  const refundStatusByPaymentId = new Map();
  for (const row of refunds) {
    const pid = String(row.paymentId || "").trim();
    const status = String(row.status || "").trim().toLowerCase();
    if (!pid || !status) continue;
    refundStatusByPaymentId.set(pid, status);
  }
  const refundablePayments = payments.filter((p) => {
    const status = String(p.status || "").toLowerCase();
    const paymentType = String(p.paymentType || "").toLowerCase();
    if (paymentType === PAYMENT_TYPES.UNLOCK_REQUEST) return false;
    if (
      status !== PAYMENT_STATUSES.HELD &&
      status !== PAYMENT_STATUSES.PAYOUT_READY &&
      status !== PAYMENT_STATUSES.SETTLED
    ) {
      return false;
    }
    const refundStatus = refundStatusByPaymentId.get(String(p.id || "").trim());
    if (!refundStatus) return true;
    return (
      refundStatus !== "requested" &&
      refundStatus !== "under_review" &&
      refundStatus !== "approved" &&
      refundStatus !== "refunded" &&
      refundStatus !== "auto_refunded"
    );
  });
  const selectedRefundTargetPaymentId = String(selectedRefundPaymentId || "").trim();
  const autoRefundTargetPaymentId =
    refundablePayments.length === 1 ?String(refundablePayments[0]?.id || "").trim() : "";
  const refundTargetPaymentId = selectedRefundTargetPaymentId || autoRefundTargetPaymentId;

  const openInProgressPayment = async (payment) => {
    const paymentId = String(payment?.id || "").trim();
    if (!paymentId || !validRequestId) return;
    setPaymentBusyId(paymentId);
    setPaymentsErr("");
    setPaymentsMsg("");
    try {
      const session = await createPaymentCheckoutSession({
        requestId: validRequestId,
        paymentId,
        appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
        returnTo: `/app/request/${encodeURIComponent(validRequestId)}`,
      });
      const redirectUrl = String(session?.authorizationUrl || session?.redirectUrl || "").trim();
      if (!redirectUrl) {
        throw new Error("Hosted checkout is unavailable right now.");
      }
      window.location.assign(redirectUrl);
    } catch (error) {
      setPaymentsErr(error?.message || "Failed to start payment.");
      setPaymentBusyId("");
    }
  };

  const sharePayablePayment = async (payment) => {
    const paymentId = String(payment?.id || "").trim();
    if (!paymentId || !validRequestId) return;
    setShareBusyId(paymentId);
    setPaymentsErr("");
    setPaymentsMsg("");
    try {
      const result = await getOrCreateSharedPaymentLink({
        requestId: validRequestId,
        paymentId,
        appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
      });
      const shareUrl = String(result?.shareUrl || "").trim();
      if (!shareUrl) {
        throw new Error("Payment link is unavailable right now.");
      }
      if (navigator.share) {
        await navigator.share({
          title: payment.paymentLabel || "MAJUU payment",
          text: "Complete the full payment with this secure MAJUU link.",
          url: shareUrl,
        });
        setPaymentsMsg("Full payment link shared.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setPaymentsMsg("Full payment link copied.");
      } else {
        window.prompt("Copy payment link", shareUrl);
        setPaymentsMsg("Full payment link ready to copy.");
      }
    } catch (error) {
      if (String(error?.name || "").toLowerCase() === "aborterror") {
        setPaymentsMsg("");
        return;
      }
      setPaymentsErr(error?.message || "Failed to create share link.");
    } finally {
      setShareBusyId("");
    }
  };

  const submitRefundRequestForSelectedPayment = async () => {
    if (!validRequestId) return;
    if (!refundTargetPaymentId) {
      setRefundsErr("Select the exact payment item to refund.");
      return;
    }
    const targetExists = refundablePayments.some(
      (row) => String(row?.id || "").trim() === refundTargetPaymentId
    );
    if (!targetExists) {
      setRefundsErr("Selected payment is no longer refundable. Choose another payment.");
      return;
    }
    const reason = String(refundReason || "").trim();
    if (!reason) {
      setRefundsErr("Enter your reason for this refund request.");
      return;
    }

    setRefundBusy(true);
    setRefundsErr("");
    try {
      await createRefundRequest({
        requestId: validRequestId,
        paymentId: refundTargetPaymentId,
        userReason: reason,
      });
      setRefundReason("");
      setSelectedRefundPaymentId("");
    } catch (error) {
      setRefundsErr(error?.message || "Failed to submit refund request.");
    } finally {
      setRefundBusy(false);
    }
  };

  const copyRequestId = async () => {
    if (!requestIdentifier) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(requestIdentifier);
      } else {
        const input = document.createElement("textarea");
        input.value = requestIdentifier;
        input.setAttribute("readonly", "true");
        input.style.position = "absolute";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setRequestIdCopied(true);
    } catch (error) {
      console.error("Failed to copy request ID:", error);
    }
  };

  const MotionDiv = motion.div;

  return (
    <div className={`min-h-screen ${softBg} ${TOP_LAYER_CLS}`}>
      {/* ✅ this fixed, high z-index layer guarantees chat modal can sit above */}
      <div className="relative z-[9999]">{/* portal safety */}</div>

      {/* soft background glows (very subtle) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute top-56 -right-28 h-72 w-72 rounded-full bg-sky-200/20 blur-3xl" />
      </div>

      <MotionDiv
        variants={pageIn}
        initial="hidden"
        animate="show"
        className={`max-w-xl mx-auto px-5 py-6 pb-24 relative ${enterWrap} ${enterCls}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <IconReceipt className="h-4 w-4" />
              Request details
            </div>
            <h1 className="mt-3 text-[2.1rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Application Request
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Details, chat, and documents
            </p>
          </div>

          <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${ui.badge}`}>
            {ui.label}
          </span>
        </div>

        {isFull && fullPackageStatusRows.length > 0 ?(
          <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Full package items
            </div>
            <div className="mt-2 grid gap-1">
              {fullPackageStatusRows.map((row) => (
                <div key={row.key} className={`text-sm font-medium ${row.toneClass}`}>
                  {row.item}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <motion.div variants={stagger} initial="hidden" animate="show" className="mt-5 grid gap-4">
          {/* Service + contact details */}
          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {serviceTitle}
                  </div>
                  <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {serviceNameLabel}
                  </div>
                </div>

                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ui.badge}`}>
                  {requestTypeLabel}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/35 dark:text-zinc-200">
                  Track: {startCase(req?.track) || "-"}
                </span>
                <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/35 dark:text-zinc-200">
                  Country: {req?.country || "-"}
                </span>
                <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/35 dark:text-zinc-200">
                  Service: {serviceNameLabel}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/75 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/35">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Request ID
                  </div>
                  <div className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                    {requestIdLabel || "-"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void copyRequestId()}
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  <IconCopy className="h-4 w-4" />
                  {requestIdCopied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/35">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Full Name
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                    {req?.name || "-"}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/35">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Phone Number
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                    {req?.phone || "-"}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3 sm:col-span-2 dark:border-zinc-800 dark:bg-zinc-950/35">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Email
                  </div>
                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                    {req?.email || "-"}
                  </div>
                </div>
              </div>

              {req?.note ?(
                <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/35">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    <IconNote className="h-4 w-4 text-zinc-500" />
                    Your note
                  </div>
                  <div className="mt-2 text-sm text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap">
                    {req.note}
                  </div>
                </div>
              ) : null}

              <RequestExtraDetailsSection
                request={req}
                title="Additional details"
                includeDocumentFields={false}
                className="mt-4 rounded-2xl border border-zinc-200/80 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/35"
              />

              {(st === "rejected" || st === "closed" || st === "contacted") && adminNote ?(
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-900">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-amber-200 bg-white/70 dark:bg-zinc-900/60">
                      <IconNote className="h-4 w-4 text-amber-800" />
                    </span>
                    Note from MAJUU
                  </div>
                  <div className="mt-2 text-sm text-amber-900 whitespace-pre-wrap">{adminNote}</div>
                </div>
              ) : null}

            </motion.div>
          </motion.div>

          {showWorkProgressCard ?(
            <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
              <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
                <RequestWorkProgressCard
                  request={req}
                  title="Request progress"
                  subtitle="A quick view of your application journey."
                  showWhenIdle
                  helperText={progressSummary.helperText}
                  progressPercentOverride={progressSummary.percent}
                  badgeLabelOverride={progressSummary.badgeLabel}
                  idleText="Request received and waiting for staff review."
                  pendingText="Work has started. A percentage update has not been posted yet."
                />

                {progressUpdatesErr ? (
                  <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                    {progressUpdatesErr}
                  </div>
                ) : null}

                <RequestProgressUpdatesList
                  updates={progressUpdates}
                  viewerRole="user"
                  emptyText="No visible progress notes yet."
                />
              </motion.div>
            </motion.div>
          ) : null}

          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <button
                type="button"
                onClick={() => setPaymentsOpen((prev) => !prev)}
                aria-expanded={paymentsOpen}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">Payments</div>
                  <div className="text-xs text-zinc-500">Request-linked payment activity.</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {unreadRequestState?.paymentUnread ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                      New
                    </span>
                  ) : null}
                  <span className="text-xs text-zinc-500">{visiblePayments.length} records</span>
                  <IconChevronDown className={`h-5 w-5 text-zinc-500 transition ${paymentsOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {paymentsOpen ?(
                <>
                  {paymentsErr ?(
                    <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                      {paymentsErr}
                    </div>
                  ) : null}

                  {paymentsMsg ?(
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-800">
                      {paymentsMsg}
                    </div>
                  ) : null}

                  {pendingUserPayments.length > 0 ?(
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                          In-Progress Payment
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {pendingUserPayments.length} pending
                        </div>
                      </div>

                      <div className="grid gap-2">
                        {pendingUserPayments.map((payment) => {
                          const uiPayment = paymentStatusUi(payment.status);
                          return (
                            <div
                              key={payment.id}
                              className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-amber-900">Payment required</div>
                                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {payment.paymentLabel || "In-progress payment"}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">
                                    {payment.currency} {Number(payment.amount || 0).toLocaleString()}
                                  </div>
                                  {payment.note ?(
                                    <div className="mt-1 text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                                      {payment.note}
                                    </div>
                                  ) : null}
                                </div>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${uiPayment.cls}`}>
                                  {uiPayment.label}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => openInProgressPayment(payment)}
                                disabled={paymentBusyId === payment.id || shareBusyId === payment.id}
                                className="mt-3 w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                              >
                                {paymentBusyId === payment.id ? "Opening checkout..." : "Pay now"}
                              </button>
                              <button
                                type="button"
                                onClick={() => sharePayablePayment(payment)}
                                disabled={paymentBusyId === payment.id || shareBusyId === payment.id}
                                className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-60"
                              >
                                {shareBusyId === payment.id
                                  ? "Preparing link..."
                                  : "Share full payment link"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {unlockPayment ?(
                    <div className="mt-4">
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                        Unlock Request Payment
                      </div>

                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-emerald-900">Payment status</div>
                            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {unlockPayment.currency} {Number(unlockPayment.amount || 0).toLocaleString()}
                            </div>
                            {unlockPayment.transactionReference ?(
                              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                Ref: <span className="font-semibold">{unlockPayment.transactionReference}</span>
                              </div>
                            ) : null}
                          </div>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              paymentStatusUi(unlockPayment.status).cls
                            }`}
                          >
                            {paymentStatusUi(unlockPayment.status).label}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                        Payment history
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {historyPayments.length} records
                      </div>
                    </div>

                    <div className="grid gap-2">
                      {historyPayments.length === 0 ?(
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                          No payment records yet.
                        </div>
                      ) : (
                        historyPayments.map((payment) => {
                          const uiPayment = paymentStatusUi(payment.status);
                          return (
                            <div
                              key={payment.id}
                              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                                    {payment.paymentLabel || "Payment"}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                    {payment.currency} {Number(payment.amount || 0).toLocaleString()}
                                  </div>
                                  {payment.note ?(
                                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                                      {payment.note}
                                    </div>
                                  ) : null}
                                  {payment.transactionReference ?(
                                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                      Ref: <span className="font-semibold">{payment.transactionReference}</span>
                                    </div>
                                  ) : null}
                                  {refundStatusByPaymentId.get(String(payment.id || "").trim()) ?(
                                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                      Refund:{" "}
                                      <span className="font-semibold">
                                        {
                                          refundStatusUi(
                                            refundStatusByPaymentId.get(String(payment.id || "").trim())
                                          ).label
                                        }
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${uiPayment.cls}`}>
                                  {uiPayment.label}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4">
                    <div className="text-xs text-zinc-600 dark:text-zinc-300">
                      Unlock payment is not manually refundable. It auto-refunds after 48 hours if work has not started.
                      In-progress payment refunds are reviewed manually.
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>Review</span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(buildLegalDocRoute(LEGAL_DOC_KEYS.ESCROW_POLICY, { scope: "app" }), {
                            state: { backTo: paymentPolicyBackTo },
                          })
                        }
                        className="font-semibold text-emerald-700 transition hover:text-emerald-800"
                      >
                        Escrow Policy
                      </button>
                      <span>and</span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(buildLegalDocRoute(LEGAL_DOC_KEYS.REFUND_POLICY, { scope: "app" }), {
                            state: { backTo: paymentPolicyBackTo },
                          })
                        }
                        className="font-semibold text-emerald-700 transition hover:text-emerald-800"
                      >
                        Refund Policy
                      </button>
                      <span>for full payment rules.</span>
                    </div>
                  </div>
                </>
              ) : null}
            </motion.div>
          </motion.div>

          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <button
                type="button"
                onClick={() => setRefundsOpen((prev) => !prev)}
                aria-expanded={refundsOpen}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">Request refund</div>
                  <div className="text-xs text-zinc-500">Select the exact payment item and review refund history.</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {unreadRequestState?.refundUnread ? (
                    <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                      New
                    </span>
                  ) : null}
                  <span className="text-xs text-zinc-500">{refunds.length} records</span>
                  <IconChevronDown className={`h-5 w-5 text-zinc-500 transition ${refundsOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              {refundsOpen ?(
                <>
                  {refundsErr ?(
                    <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                      {refundsErr}
                    </div>
                  ) : null}

                  {refundablePayments.length === 0 ?(
                    <div className="mt-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3 text-sm text-zinc-600 dark:text-zinc-300">
                      No manually refundable payment items right now.
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-2">
                      <select
                        value={selectedRefundPaymentId}
                        onChange={(e) => setSelectedRefundPaymentId(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                        disabled={refundBusy}
                      >
                        <option value="">Select payment item</option>
                        {refundablePayments.map((row) => (
                          <option key={row.id} value={row.id}>
                            {`${row.paymentLabel || "Payment"} - ${row.currency} ${Number(row.amount || 0).toLocaleString()}`}
                          </option>
                        ))}
                      </select>
                      <textarea
                        rows={3}
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        placeholder="Why are you requesting this refund?"
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                        disabled={refundBusy}
                      />
                      <button
                        type="button"
                        onClick={() => void submitRefundRequestForSelectedPayment()}
                        disabled={refundBusy}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {refundBusy ? "Submitting..." : "Submit refund request"}
                      </button>
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Refund history</div>
                    <div className="mt-2 grid gap-2">
                      {refunds.length === 0 ?(
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3 text-sm text-zinc-600 dark:text-zinc-300">
                          No refund records yet.
                        </div>
                      ) : (
                        refunds.map((refund) => {
                          const uiRefund = refundStatusUi(refund.status);
                          return (
                            <div
                              key={refund.id}
                              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                                    {refund.paymentLabel || "Refund"}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                    Payment ID: <span className="font-mono">{refund.paymentId || "-"}</span>
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                    {refund.currency} {Number(refund.amount || 0).toLocaleString()}
                                  </div>
                                  {refund.adminExplanation ?(
                                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                                      Note: {refund.adminExplanation}
                                    </div>
                                  ) : null}
                                  {refund.userReason ?(
                                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                                      Reason: {refund.userReason}
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
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${uiRefund.cls}`}>
                                  {uiRefund.label}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </motion.div>
          </motion.div>
          {/* Submitted documents by user */}
          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <CollapsibleSection
                title="Submitted documents"
                subtitle="Your uploads and document fields for this request."
                meta={`${attachments.length} files`}
                open={documentsOpen}
                onToggle={setDocumentsOpen}
                bodyClassName="mt-4 grid gap-4"
              >
                <RequestDocumentFieldsSection
                  request={req}
                  requestId={validRequestId}
                  title="Submitted document fields"
                  viewerRole="user"
                  attachments={attachments}
                  attachmentsLoading={false}
                  attachmentsError={fileErr}
                  showHeader={false}
                  className="p-0 border-0 bg-transparent shadow-none"
                />
                {showLegacySubmittedDocuments ? (
                  <>
                    {fileErr ?(
                      <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                        {fileErr}
                      </div>
                    ) : null}

                    <div className="grid gap-2">
                      {attachments.length === 0 ?(
                        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                          No documents submitted yet.
                        </div>
                      ) : (
                        attachments.map((a, idx) => (
                          <motion.div
                            key={a.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(0.2, idx * 0.03), duration: 0.18 }}
                            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 transition hover:border-emerald-200 hover:bg-white active:scale-[0.99]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words">
                                  {a.name || "PDF"}
                                </div>
                                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                  Status:{" "}
                                  <span className="font-semibold text-zinc-800">
                                    {attachmentStatusLabel(a.status)}
                                  </span>{" "}
                                  · {bytesToLabel(a.size)}
                                </div>
                              </div>

                              <span className="shrink-0 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                                {String(a.status || "pending_upload").toLowerCase()}
                              </span>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </>
                ) : null}
              </CollapsibleSection>
            </motion.div>
          </motion.div>

          {/* Documents from MAJUU */}
          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <CollapsibleSection
                title="Documents from My Google"
                subtitle="Shared templates and downloadable files."
                meta={`${adminFiles.length} files`}
                open={adminDocumentsOpen}
                onToggle={setAdminDocumentsOpen}
                bodyClassName="mt-4 grid gap-2"
              >
                {adminFilesErr ?(
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                    {adminFilesErr}
                  </div>
                ) : null}

                {adminFiles.length === 0 ?(
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                    No documents sent yet.
                  </div>
                ) : (
                  adminFiles.map((f, idx) => {
                    const name = String(f.name || "Document");
                    const url = String(f.url || "").trim();

                    return (
                      <motion.div
                        key={f.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(0.2, idx * 0.03), duration: 0.18 }}
                        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 transition hover:border-emerald-200 hover:bg-white active:scale-[0.99]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words">
                              {name}
                            </div>
                            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">Open to download</div>
                          </div>

                          <a
                            href={url || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className={`shrink-0 inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                              url
                                ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
                                : "border-zinc-200 dark:border-zinc-800 bg-zinc-100 text-zinc-400 cursor-not-allowed pointer-events-none"
                            }`}
                          >
                            Open
                          </a>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </CollapsibleSection>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Bottom action buttons */}
        {canBackToFullPackage || canStartNew || canTryAgain ?(
          <div className="mt-5 grid gap-2">
            {canBackToFullPackage ?(
              <button
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                onClick={() => goToFullPackageHub()}
              >
                Back to Full Package
              </button>
            ) : null}

            {canStartNew ?(
              <button
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                onClick={() => navigate("/dashboard", { replace: true })}
              >
                Start a new request
              </button>
            ) : null}

            {canTryAgain ?(
              <button
                className="w-full rounded-xl border border-rose-200 bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.99]"
                onClick={handleTryAgain}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Back button */}
        <div className="mt-3">
          <button
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-white active:scale-[0.99]"
            onClick={() => smartBack(navigate, "/app/progress")}
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Progress
          </button>
        </div>

        <div className="h-10" />
      </MotionDiv>

      <div
        className="fixed z-[10000]"
        style={{
          right: "calc(var(--app-safe-right) + 1rem)",
          bottom: "var(--app-floating-offset)",
        }}
      >
        <RequestChatLauncher requestId={validRequestId} variant="floating" />
      </div>
    </div>
  );
}




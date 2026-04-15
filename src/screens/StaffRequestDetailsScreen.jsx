// ✅ StaffRequestDetailsScreen.jsx (FULL COPY-PASTE)
// UI POLISHES (backend untouched):
// - ✅ Apple-ish entrance animation (fade + lift)
// - ✅ Sticky header (Back + status pills stay visible while scrolling)
// - ✅ Floaty cards (softer shadow + hover lift)
// - ✅ Better spacing / typography (cleaner hierarchy)
// - ✅ “Chat” card styled as primary block
// - ✅ Buttons + inputs get smoother focus rings + disabled states
// - ✅ Keeps ALL your Firestore logic EXACTLY the same
//
// ✅ FIX ADDED (minimal, staff-side only):
// - If admin approved staff chat BEFORE assignment, those messages may be in /messages with toUid missing.
// - When the assigned staff opens this screen, we "claim" those orphan staff messages:
//   - set toUid = current staff uid
//   - mark needsAssignment = false
//   - no chat notification docs are created (chat unread comes from readState + messages)

import { useEffect, useMemo, useState, useRef } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  orderBy,
  query,
  serverTimestamp,
  onSnapshot,
  addDoc,
} from "firebase/firestore";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { auth, db } from "../firebase";

import RequestWorkProgressCard from "../components/RequestWorkProgressCard";
import RequestProgressUpdatesList from "../components/RequestProgressUpdatesList";
import RequestExtraDetailsSection from "../components/RequestExtraDetailsSection";
import StaffRequestChatPanel from "../components/StaffRequestChatPanel";
import { smartBack } from "../utils/navBack";
import { normalizeTextDeep } from "../utils/textNormalizer";
import {
  normalizeStaffProgressPercent,
  STAFF_PROGRESS_OPTIONS,
} from "../utils/requestWorkProgress";
import {
  createInProgressPaymentProposal,
  normalizePaymentDoc,
  PAYMENT_TYPES,
  paymentStatusUi,
} from "../services/paymentservice";
import {
  postRequestProgressUpdate,
  subscribeRequestProgressUpdates,
} from "../services/requestcontinuityservice";
import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
import {
  staffClaimAssignedOrphanMessages,
  staffUpdateRequestNote,
  staffMarkRequestDone,
} from "../services/requestcommandservice";

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

function IconChevronDown(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 9.5 12 15l5.5-5.5"
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
  if (s === "new") return { label: "New", cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
  if (s === "contacted")
    return { label: "In Progress", cls: "bg-emerald-50 text-emerald-800 border border-emerald-100" };
  if (s === "closed")
    return { label: "Accepted", cls: "bg-emerald-100 text-emerald-800 border border-emerald-200" };
  if (s === "rejected")
    return { label: "Rejected", cls: "bg-rose-50 text-rose-700 border border-rose-100" };
  return { label: s, cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
}

function permissionAwareMessage(error, fallback) {
  const message = String(error?.message || "").trim().toLowerCase();
  if (message.includes("missing or insufficient permissions")) {
    return fallback;
  }
  return String(error?.message || "").trim() || fallback;
}

function cleanMoneyInput(value, { allowZero = false } = {}) {
  const num = Number(String(value || "").replace(/[^0-9.]+/g, ""));
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.round(num);
  if (allowZero) return Math.max(0, rounded);
  return rounded > 0 ? rounded : 0;
}

function formatMoney(amount, currency = "KES") {
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const safeCurrency = String(currency || "KES").trim().toUpperCase() || "KES";
  return `${safeCurrency} ${safeAmount.toLocaleString()}`;
}

function createStaffSectionState() {
  return {
    chat: false,
    workProgress: false,
    applicant: false,
    payments: false,
    attachments: false,
    note: false,
  };
}

function StaffCollapsibleSectionCard({
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
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {meta}
          <IconChevronDown
            className={`h-5 w-5 text-zinc-500 transition ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open ? children : null}
    </div>
  );
}

const EMPTY_REQUEST_UNREAD_STATE = Object.freeze({});

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
  const [progressDraft, setProgressDraft] = useState("");
  const [progressNote, setProgressNote] = useState("");
  const [progressVisibleToUser, setProgressVisibleToUser] = useState(true);
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [progressUpdatesErr, setProgressUpdatesErr] = useState("");
  const [decision, setDecision] = useState("recommend_accept");
  const [busy, setBusy] = useState("");

  const [drafts, setDrafts] = useState([]);
  const [draftErr, setDraftErr] = useState("");
  const [addingDraft, setAddingDraft] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");

  const [payments, setPayments] = useState([]);
  const [paymentsErr, setPaymentsErr] = useState("");
  const [paymentLabel, setPaymentLabel] = useState("");
  const [paymentOfficialAmount, setPaymentOfficialAmount] = useState("");
  const [paymentServiceFee, setPaymentServiceFee] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [openSections, setOpenSections] = useState(createStaffSectionState);
  const unreadRequestState = useNotifsV2Store(
    (s) => s.unreadByRequest?.[String(requestId || "").trim()] || EMPTY_REQUEST_UNREAD_STATE
  );

  // ✅ polish tokens
  const softBg = "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60";

  const floatCard =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60";

  const inputBase =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-emerald-300/20";

  // ✅ entrance animation
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);
  const enterWrap =
    "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ?"opacity-100 translate-y-0" : "opacity-0 translate-y-2";

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
      ?"Full package"
      : `Single: ${req?.serviceName || "-"}`;

  const canWork = status !== "closed" && status !== "rejected";
  const isDone = staffStatus === "done";
  const currentProgressPercent = normalizeStaffProgressPercent(req?.staffProgressPercent);
  const canUpdateProgress = canWork && staffStatus === "in_progress";
  const inProgressPayments = useMemo(
    () => payments.filter((p) => String(p.paymentType || "").toLowerCase() === PAYMENT_TYPES.IN_PROGRESS),
    [payments]
  );
  const unlockPayment = useMemo(
    () => payments.find((p) => String(p.paymentType || "").toLowerCase() === PAYMENT_TYPES.UNLOCK_REQUEST) || null,
    [payments]
  );
  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      const snap = await getDoc(doc(db, "serviceRequests", requestId));
      if (!snap.exists()) throw new Error("Request not found");
      const data = normalizeTextDeep({ id: snap.id, ...snap.data() });

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
    notifsV2Store.markRequestNotificationsRead(requestId).catch(() => {});
  }, [requestId]);

  useEffect(() => {
    setOpenSections(createStaffSectionState());
  }, [requestId]);

  useEffect(() => {
    setProgressDraft(currentProgressPercent ? String(currentProgressPercent) : "");
  }, [currentProgressPercent, requestId]);

  useEffect(() => {
    setProgressNote("");
    setProgressVisibleToUser(true);
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return undefined;

    const unsub = subscribeRequestProgressUpdates({
      requestId,
      viewerRole: "staff",
      onData: (rows) => {
        setProgressUpdates(rows);
        setProgressUpdatesErr("");
      },
      onError: (error) => {
        console.error("staff progress updates snapshot error:", error);
        setProgressUpdatesErr(
          permissionAwareMessage(error, "Progress updates are not available right now.")
        );
      },
    });

    return () => unsub?.();
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;

    const ref = collection(db, "serviceRequests", requestId, "staffFileDrafts");
    const qy = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setDrafts(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
        setDraftErr("");
      },
      (e) => {
        console.error("staffFileDrafts snapshot error:", e);
        setDraftErr(e?.message || "Failed to load your attached links.");
      }
    );

    return () => unsub();
  }, [requestId]);

  useEffect(() => {
    if (!requestId) return;

    const ref = collection(db, "serviceRequests", requestId, "payments");
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
      (e) => {
        console.error("staff payments snapshot error:", e);
        setPaymentsErr(e?.message || "Failed to load payment history.");
      }
    );

    return () => unsub();
  }, [requestId]);

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

  const submitInProgressPaymentProposal = async () => {
    const label = String(paymentLabel || "").trim();
    const officialAmount = cleanMoneyInput(paymentOfficialAmount);
    const serviceFee = cleanMoneyInput(paymentServiceFee, { allowZero: true });
    const noteText = String(paymentNote || "").trim();

    if (!label) return alert("Enter a payment label.");
    if (!officialAmount) return alert("Enter a valid official amount.");
    if (!noteText) return alert("Enter a reason for the applicant.");

    try {
      setPaymentBusy(true);
      await createInProgressPaymentProposal({
        requestId,
        paymentLabel: label,
        officialAmount,
        serviceFee,
        note: noteText,
      });
      setPaymentLabel("");
      setPaymentOfficialAmount("");
      setPaymentServiceFee("");
      setPaymentNote("");
    } catch (proposalErr) {
      alert(proposalErr?.message || "Failed to submit payment proposal.");
    } finally {
      setPaymentBusy(false);
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

  const saveNote = async () => {
    try {
      setBusy("save");
      setErr("");
      const result = await staffUpdateRequestNote({
        requestId,
        staffNote: String(note || "").trim(),
      });
      if (!result?.ok) {
        throw new Error("Save failed.");
      }
      setReq((prev) =>
        prev
          ? {
              ...prev,
              staffNote: String(note || "").trim(),
            }
          : prev
      );
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Save failed (check rules).");
    } finally {
      setBusy("");
    }
  };

  const saveProgress = async () => {
    const nextProgress = normalizeStaffProgressPercent(progressDraft);
    if (!canUpdateProgress) {
      setErr("Start work from the modal before updating live progress.");
      return;
    }
    if (!nextProgress) {
      setErr("Pick a valid progress percentage.");
      return;
    }

    try {
      setBusy("progress");
      setErr("");
      await postRequestProgressUpdate({
        requestId,
        requestData: req,
        progressPercent: nextProgress,
        content: progressNote,
        visibleToUser: progressVisibleToUser,
      });
      const nowMs = Date.now();
      setReq((prev) =>
        prev
          ? {
              ...prev,
              staffProgressPercent: nextProgress,
              staffProgressUpdatedAtMs: nowMs,
              backendStatus: "in_progress",
              userStatus: "in_progress",
              everAssigned: true,
            }
          : prev
      );
      setProgressNote("");
      setProgressVisibleToUser(true);
    } catch (e) {
      console.error(e);
      setErr(permissionAwareMessage(e, "Progress update failed. Please try again."));
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

      const result = await staffMarkRequestDone({
        requestId,
        staffDecision: dec,
        staffNote: String(note || "").trim(),
      });
      if (!result?.ok) {
        throw new Error("Mark done failed.");
      }

      navigate("/staff/tasks", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Mark done failed (check rules).");
    } finally {
      setBusy("");
    }
  };

  /* =========================================================
     ✅ FIX: Claim orphan "to staff" messages after assignment
     ========================================================= */
  const claimedRef = useRef(false);

  useEffect(() => {
    // Only run when:
    // - request loaded
    // - staff is signed in
    // - request is assigned to THIS staff
    if (!requestId) return;
    if (!uid) return;
    if (!req) return;

    const assignedTo = String(req?.assignedTo || "").trim();
    if (!assignedTo) return;
    if (assignedTo !== uid) return;

    if (claimedRef.current) return;
    claimedRef.current = true;

    const run = async () => {
      try {
        await staffClaimAssignedOrphanMessages({
          requestId,
          max: 250,
        });
      } catch (e) {
        // Don't block UI; just log
        console.warn("claim orphan staff messages failed:", e?.message || e);
      }
    };

    run();
  }, [requestId, uid, req]);

  if (checkingAuth) {
    return (
      <div className={softBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className={`${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Preparing…</div>
        </div>
      </div>
    );
  }

  const warnBox =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300";
  const warnAmber =
    "rounded-3xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 shadow-sm";
  const btnGhost =
    "inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100";
  const btnPrimary =
    "inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60";
  const btnDanger =
    "inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60";

  return (
    <div className={softBg}>
      <div className={`app-page-shell app-page-shell--wide ${enterWrap} ${enterCls}`}>
        {/* Sticky top header */}
        <div className="sticky top-0 z-10 -mx-[clamp(1rem,2.8vw,1.5rem)] px-[clamp(1rem,2.8vw,1.5rem)] pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-950/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button type="button" onClick={() => smartBack(navigate, "/staff/tasks")} className={btnGhost}>
                <IconChevronLeft className="h-4 w-4" />
                Back
              </button>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-900/60 border border-emerald-100 dark:bg-zinc-900/60 dark:border-zinc-700">
                    <IconDoc className="h-4 w-4 text-emerald-700 dark:text-emerald-200" />
                  </span>
                  Staff review
                </span>

                {req ?(
                  <>
                    <span className={`rounded-full px-2.5 py-1 text-xs ${statusPill.cls}`}>
                      {statusPill.label}
                    </span>
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
                      Staff: {staffStatus.replace("_", " ")}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-zinc-700/70" />
        </div>

        <StaffCollapsibleSectionCard
          className={`mt-4 ${floatCard} p-5`}
          title="Chat"
          subtitle="Open the request conversation and shared files."
          open={openSections.chat}
          onToggle={() => toggleSection("chat")}
          badge={
            unreadRequestState?.chatUnread ? (
              <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                New
              </span>
            ) : null
          }
        >
          <div className="mt-4">
            <StaffRequestChatPanel requestId={requestId} />
          </div>
        </StaffCollapsibleSectionCard>

        {err ?(
          <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {loading ?(
          <div className={`mt-4 ${card} p-4`}>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Loading request...</p>
          </div>
        ) : !req ?(
          <div className={`mt-4 ${card} p-4`}>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Request not found.</p>
          </div>
        ) : (
          <>
            {/* Overview */}
            <div className={`mt-4 ${floatCard} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {title}
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{typeLabel}</div>

                  {createdLabel ?(
                    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Submitted: <span className="font-medium">{createdLabel}</span>
                    </div>
                  ) : null}
                </div>

              </div>

              {!canWork ?(
                <div className="mt-4 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                  Admin already finalized this request. You can view only.
                </div>
              ) : staffStatus !== "in_progress" && staffStatus !== "done" ?(
                <div className={`mt-4 ${warnAmber}`}>
                  Work not started. Go back to tasks and tap the request to start.
                </div>
              ) : null}
            </div>

            <StaffCollapsibleSectionCard
              className={`mt-6 ${floatCard} p-5`}
              title="Work progress"
              subtitle=""
              open={openSections.workProgress}
              onToggle={() => toggleSection("workProgress")}
            >
              <div className="mt-4">
                <RequestWorkProgressCard
                  request={req}
                  title=""
                  subtitle=""
                  showWhenIdle={true}
                  idleText="Start work from the staff modal first."
                  pendingText="Work started. Add a progress update when you have one."
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="grid gap-2">
                      <span className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                        Progress percentage
                      </span>
                      <select
                        value={progressDraft}
                        onChange={(e) => setProgressDraft(e.target.value)}
                        disabled={!canUpdateProgress || busy === "progress"}
                        className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/40 dark:focus:ring-emerald-300/20"
                      >
                        <option value="">Select live progress</option>
                        {STAFF_PROGRESS_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value}%
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={saveProgress}
                      disabled={!canUpdateProgress || busy === "progress" || !progressDraft}
                      className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                    >
                      {busy === "progress" ? "Updating..." : "Update progress"}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-2">
                      <span className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                        Progress note
                      </span>
                      <textarea
                        value={progressNote}
                        onChange={(e) => setProgressNote(e.target.value)}
                        disabled={!canUpdateProgress || busy === "progress"}
                        rows={3}
                        placeholder="Example: Documents checked and corrections sent to the applicant."
                        className={`${inputBase} min-h-[92px] resize-y`}
                      />
                    </label>

                    <label className="inline-flex items-start gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/50 px-3 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={progressVisibleToUser}
                        onChange={(e) => setProgressVisibleToUser(e.target.checked)}
                        disabled={!canUpdateProgress || busy === "progress"}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>
                        <span className="block font-semibold text-zinc-900 dark:text-zinc-100">
                          Visible to user
                        </span>
                        <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                          Turn this off for internal-only notes that only staff and admin should see.
                        </span>
                      </span>
                    </label>
                  </div>

                  {progressUpdatesErr ? (
                    <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                      {progressUpdatesErr}
                    </div>
                  ) : null}

                  <RequestProgressUpdatesList
                    updates={progressUpdates}
                    viewerRole="staff"
                    emptyText="No progress updates posted yet."
                  />
                </RequestWorkProgressCard>
              </div>
            </StaffCollapsibleSectionCard>

            <StaffCollapsibleSectionCard
              className={`mt-6 ${floatCard} p-5`}
              title="Applicant"
              subtitle="Details and document fields."
              open={openSections.applicant}
              onToggle={() => toggleSection("applicant")}
            >
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => navigate(`/staff/request/${requestId}/documents`)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Applicant docs
                  <IconChevronRight className="h-5 w-5 text-emerald-700 dark:text-emerald-200" />
                </button>
              </div>

              <div className="mt-4 grid gap-3 text-sm">
                <div className="grid gap-1">
                  <div className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                    Full name
                  </div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {req?.name || "-"}
                  </div>
                </div>

                {req?.note ?(
                  <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <div className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                      Applicant note
                    </div>
                    <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap dark:text-zinc-100">
                      {req.note}
                    </div>
                  </div>
                ) : (
                  <div className={warnBox}>No note provided.</div>
                )}

                <RequestExtraDetailsSection
                  request={req}
                  title="Extra details"
                  includeDocumentFields={false}
                />
              </div>
            </StaffCollapsibleSectionCard>

            <StaffCollapsibleSectionCard
              className={`mt-6 ${floatCard} p-5`}
              title="In-progress payments"
              subtitle=""
              open={openSections.payments}
              onToggle={() => toggleSection("payments")}
              badge={
                unreadRequestState?.paymentUnread ? (
                  <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                    New
                  </span>
                ) : null
              }
              meta={
                <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                  {inProgressPayments.length} proposals
                </span>
              }
            >
              {unlockPayment ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                  Unlock payment:{" "}
                  <span className="font-semibold">
                    {unlockPayment.currency} {Number(unlockPayment.amount || 0).toLocaleString()}
                  </span>{" "}
                  ({paymentStatusUi(unlockPayment.status).label})
                </div>
              ) : null}

              {paymentsErr ? (
                <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                  {paymentsErr}
                </div>
              ) : null}

              {canWork && !isDone ? (
                <div className="mt-4 grid gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4">
                  <input
                    value={paymentLabel}
                    onChange={(e) => setPaymentLabel(e.target.value)}
                    placeholder="Payment label (e.g. Document verification fee)"
                    className={inputBase}
                    disabled={paymentBusy || busy}
                  />
                  <input
                    value={paymentOfficialAmount}
                    onChange={(e) => setPaymentOfficialAmount(e.target.value)}
                    placeholder="Official amount (e.g. 2500)"
                    inputMode="decimal"
                    className={inputBase}
                    disabled={paymentBusy || busy}
                  />
                  <input
                    value={paymentServiceFee}
                    onChange={(e) => setPaymentServiceFee(e.target.value)}
                    placeholder="Optional service fee (e.g. 300)"
                    inputMode="decimal"
                    className={inputBase}
                    disabled={paymentBusy || busy}
                  />
                  <textarea
                    value={paymentNote}
                    onChange={(e) => setPaymentNote(e.target.value)}
                    rows={3}
                    placeholder="Reason shown to applicant"
                    className={inputBase}
                    disabled={paymentBusy || busy}
                  />
                  <button
                    type="button"
                    onClick={submitInProgressPaymentProposal}
                    disabled={paymentBusy || busy}
                    className={btnPrimary}
                  >
                    {paymentBusy ? "Submitting..." : "Submit for admin approval"}
                  </button>
                </div>
              ) : null}

              <div className="mt-4 grid gap-2">
                {inProgressPayments.length === 0 ? (
                  <div className={warnBox}>No in-progress payment proposals yet.</div>
                ) : (
                  inProgressPayments.map((p) => {
                    const ui = paymentStatusUi(p.status);
                    return (
                      <div
                        key={p.id}
                        className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words">
                              {p.paymentLabel || "In-progress payment"}
                            </div>
                            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                              User pays: {formatMoney(p.amount, p.currency)}
                            </div>
                            {p.breakdown ? (
                              <div className="mt-2 grid gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                                <div>Official amount: {formatMoney(p.breakdown.officialAmount, p.currency)}</div>
                                <div>Service fee: {formatMoney(p.breakdown.serviceFee, p.currency)}</div>
                                {Number(p?.breakdown?.discountAmount || 0) > 0 ? (
                                  <div>Discount: {formatMoney(p.breakdown.discountAmount, p.currency)}</div>
                                ) : null}
                                <div>
                                  Estimated partner payout:{" "}
                                  {formatMoney(p.breakdown.estimatedNetPartnerPayable, p.currency)}
                                </div>
                              </div>
                            ) : null}
                            {p.note ? (
                              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                                {p.note}
                              </div>
                            ) : null}
                            {p.rejectionReason ? (
                              <div className="mt-1 text-xs text-rose-700 whitespace-pre-wrap">
                                Rejection reason: {p.rejectionReason}
                              </div>
                            ) : null}
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${ui.cls}`}>
                            {ui.label}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </StaffCollapsibleSectionCard>

            <StaffCollapsibleSectionCard
              className={`mt-6 ${floatCard} p-5`}
              title="Attach Files"
              subtitle=""
              open={openSections.attachments}
              onToggle={() => toggleSection("attachments")}
              meta={
                <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                  Auto-fills Admin
                </span>
              }
            >
              {draftErr ?(
                <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
                  {draftErr}
                </div>
              ) : null}

              {!canWork || isDone ?(
                <div className="mt-4 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
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
                      {addingDraft ?"Adding..." : "Add"}
                    </button>
                  </div>

                </div>
              )}

              <div className="mt-4 grid gap-2">
                {drafts.length === 0 ?(
                  <div className={warnBox}>No files added yet.</div>
                ) : (
                  drafts.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words dark:text-zinc-100">
                            {d.name || "File"}
                          </div>

                          {d.url ?(
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

                        {!canWork || isDone ?null : (
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
            </StaffCollapsibleSectionCard>

            <StaffCollapsibleSectionCard
              className={`mt-6 ${floatCard} p-5`}
              title="Staff note"
              subtitle="Internal note for admin. Save anytime."
              open={openSections.note}
              onToggle={() => toggleSection("note")}
            >
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!canWork || busy}
                  className={btnGhost}
                >
                  {busy === "save" ?"Saving..." : "Save note"}
                </button>
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                placeholder="What did you find? What's missing? Next steps?"
                disabled={!canWork || isDone}
                className="mt-4 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-3 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 min-h-[120px] disabled:opacity-70 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:ring-emerald-300/20"
              />
            </StaffCollapsibleSectionCard>
            {/* Staff actions */}
            <div className={`mt-6 ${floatCard} p-5`}>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Staff actions</div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Mark done with a recommendation (admin decides final).
              </div>

              <div className="mt-4 grid gap-3">
                <div className="grid gap-2 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
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
                          ?"border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                          : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900",
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
                          ?"border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                          : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900",
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
                  title={staffStatus !== "in_progress" ?"Start work from the modal first" : ""}
                >
                  {busy === "done" ?"Submitting…" : "Mark done (send to admin)"}
                </button>

                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Final Accept/Reject is done by admin.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}





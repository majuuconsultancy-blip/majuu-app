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
import { motion, AnimatePresence } from "../utils/motionProxy";
import RequestChatLauncher from "../components/RequestChatLauncher";

import { auth, db } from "../firebase";
import { clearActiveProcess } from "../services/userservice";
import { smartBack } from "../utils/navBack";
import {
  buildFullPackageHubPath,
  normalizeFullPackageItems,
  toFullPackageItemKey,
} from "../services/fullpackageservice";
import { normalizeTextDeep } from "../utils/textNormalizer";

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

/* ---------------- Helpers ---------------- */
function statusUI(status) {
  const s = String(status || "new").toLowerCase();

  if (s === "new")
    return {
      label: "Submitted",
      badge: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
    };

  if (s === "contacted")
    return {
      label: "In progress",
      badge: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };

  if (s === "closed")
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

export default function RequestStatusScreen() {
  const navigate = useNavigate();
  const { requestId } = useParams();

  const [loading, setLoading] = useState(true);
  const [req, setReq] = useState(null);
  const [err, setErr] = useState("");

  const [fileErr, setFileErr] = useState("");
  const [attachments, setAttachments] = useState([]);

  const [adminFilesErr, setAdminFilesErr] = useState("");
  const [adminFiles, setAdminFiles] = useState([]);
  const [fullPackageItems, setFullPackageItems] = useState([]);
  const [fullPackageLinkedRequests, setFullPackageLinkedRequests] = useState([]);

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

  const ui = statusUI(req?.status);
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
  const serviceSub = isFull ?"Full package" : `Single service: ${req?.serviceName || "-"}`;

  return (
    <div className={`min-h-screen ${softBg} ${TOP_LAYER_CLS}`}>
      {/* ✅ this fixed, high z-index layer guarantees chat modal can sit above */}
      <div className="relative z-[9999]">{/* portal safety */}</div>

      {/* soft background glows (very subtle) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute top-56 -right-28 h-72 w-72 rounded-full bg-sky-200/20 blur-3xl" />
      </div>

      <motion.div
        variants={pageIn}
        initial="hidden"
        animate="show"
        className={`max-w-xl mx-auto px-5 py-6 pb-24 relative ${enterWrap} ${enterCls}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60">
              <IconReceipt className="h-5 w-5 text-emerald-800" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Application Request</div>
              <div className="text-xs text-zinc-500">Details & documents</div>
            </div>
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
                  <div className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{serviceTitle}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{serviceSub}</div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-[11px] text-zinc-500">Request ID</div>
                  <div className="mt-1 font-mono text-[12px] text-zinc-800">{req?.id}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Full name</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{req?.name || "-"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Phone</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{req?.phone || "-"}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Email</span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{req?.email || "-"}</span>
                </div>

                {req?.note ?(
                  <div className="mt-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 transition hover:bg-white/70">
                    <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      <IconNote className="h-4 w-4 text-zinc-500" />
                      Your note
                    </div>
                    <div className="mt-2 text-sm text-zinc-800 whitespace-pre-wrap">{req.note}</div>
                  </div>
                ) : null}
              </div>

              {(st === "rejected" || st === "closed" || st === "contacted") && adminNote ?(
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 transition hover:bg-amber-50/80">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-amber-200 bg-white/70 dark:bg-zinc-900/60">
                      <IconNote className="h-4 w-4 text-amber-800" />
                    </span>
                    Note from MAJUU
                  </div>
                  <div className="mt-2 text-sm text-amber-900 whitespace-pre-wrap">{adminNote}</div>
                </div>
              ) : null}

              {st === "new" ?(
                <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-700 dark:text-zinc-300">
                  Received. We’ll review and update you here.
                </div>
              ) : null}

              {st === "contacted" ?(
                <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-900">
                  In progress. Please check back later.
                </div>
              ) : null}

              {st === "closed" ?(
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
                  {isFull ?"Approved. Continue with the next steps." : "Completed successfully."}
                </div>
              ) : null}

              {st === "rejected" ?(
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
                  Needs correction. Follow the note above.
                </div>
              ) : null}
            </motion.div>
          </motion.div>

          {/* Submitted documents by user */}
          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60">
                    <IconFile className="h-5 w-5 text-emerald-800" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">Submitted documents</div>
                    <div className="text-xs text-zinc-500">Your uploads for this request.</div>
                  </div>
                </div>
                <span className="text-xs text-zinc-500 shrink-0">{attachments.length} files</span>
              </div>

              {fileErr ?(
                <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                  {fileErr}
                </div>
              ) : null}

              <div className="mt-4 grid gap-2">
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
            </motion.div>
          </motion.div>

          {/* Documents from MAJUU */}
          <motion.div variants={tileIn} whileHover="hover" whileTap="tap" initial="rest" animate="rest">
            <motion.div variants={floaty} className={`${cardBase} ${cardPolish} p-5`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60">
                    <IconFile className="h-5 w-5 text-emerald-800" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">Documents from MAJUU</div>
                    <div className="text-xs text-zinc-500">Templates, SOPs, forms.</div>
                  </div>
                </div>
                <span className="text-xs text-zinc-500 shrink-0">{adminFiles.length} files</span>
              </div>

              {adminFilesErr ?(
                <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                  {adminFilesErr}
                </div>
              ) : null}

              <div className="mt-4 grid gap-2">
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
                                ?"border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
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
              </div>
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
      </motion.div>

      <div
        className="fixed z-[10000]"
        style={{
          right: "1.25rem",
          bottom: "calc(8rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <RequestChatLauncher requestId={validRequestId} variant="floating" />
      </div>
    </div>
  );
}



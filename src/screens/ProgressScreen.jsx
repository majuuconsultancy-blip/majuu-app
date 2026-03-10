// ✅ ProgressScreen.jsx (FULL COPY-PASTE)
// CHANGE ONLY (as requested):
// ✅ Back button from ProgressScreen goes to TrackScreen (activeTrack) instead of previous history.
//    - Android hardware back + browser back handled via popstate
//    - We "trap" this screen as a history anchor and redirect on back.
// ✅ Existing notification auto-clear behavior preserved.
// Everything else preserved.

import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { motion } from "../utils/motionProxy";
import {
  ChevronRight,
  Trash2,
  Bell,
  Pin,
  PinOff,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";

import { auth, db } from "../firebase";
import { useNotifsV2Store } from "../services/notifsV2Store";
import { getUserState } from "../services/userservice";
import { getMyApplications } from "../services/progressservice";
import { getResumeTarget } from "../resume/resumeEngine";
import { buildFullPackageHubPath, toFullPackageItemKey } from "../services/fullpackageservice";
import { normalizeTextDeep } from "../utils/textNormalizer";

const PERF_TAG = "[perf][ProgressScreen]";
const REQUESTS_INITIAL_RENDER = 5;
const PROGRESS_CACHE_PREFIX = "majuu_progress_cache_";

function startPerf(label) {
  try {
    console.time(label);
  } catch {}
}

function endPerf(label) {
  try {
    console.timeEnd(label);
  } catch {}
}

function logIndexHint(scope, error) {
  const raw = String(error?.message || "");
  const match = raw.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/i);
  if (match?.[0]) {
    console.warn(`${PERF_TAG} index hint (${scope}): ${match[0]}`);
  }
}

function progressCacheKey(uid) {
  return `${PROGRESS_CACHE_PREFIX}${String(uid || "")}`;
}

function readProgressCache(uid) {
  if (!uid || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(progressCacheKey(uid));
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      state: parsed?.state || null,
      requests: Array.isArray(parsed?.requests) ?parsed.requests : [],
      apps: Array.isArray(parsed?.apps) ?parsed.apps : [],
      updatedAt: Number(parsed?.updatedAt || 0) || 0,
    };
  } catch {
    return null;
  }
}

function writeProgressCache(uid, payload) {
  if (!uid || typeof window === "undefined") return;
  try {
    const safe = {
      state: payload?.state || null,
      requests: Array.isArray(payload?.requests) ?payload.requests : [],
      apps: Array.isArray(payload?.apps) ?payload.apps : [],
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(progressCacheKey(uid), JSON.stringify(safe));
  } catch {}
}

/* ---------- Status UI ---------- */
function statusUI(status) {
  const s = String(status || "new").toLowerCase();

  if (s === "new")
    return {
      label: "Submitted",
      badge:
        "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200 dark:border-zinc-700",
      dot: "bg-zinc-400 dark:bg-zinc-500",
    };

  if (s === "contacted")
    return {
      label: "Received",
      badge:
        "bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40",
      dot: "bg-emerald-500",
    };

  if (s === "closed")
    return {
      label: "Succeeded",
      badge:
        "bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/55 dark:text-emerald-200 dark:border-emerald-900/40",
      dot: "bg-emerald-700",
    };

  if (s === "rejected")
    return {
      label: "Rejected",
      badge:
        "bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/40",
      dot: "bg-rose-500",
    };

  return {
    label: s,
    badge:
      "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200 dark:border-zinc-700",
    dot: "bg-zinc-400 dark:bg-zinc-500",
  };
}

/* ✅ Fallback for old full-package requests: parse "Missing items: ..." from note */
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

/* ✅ safe createdAt formatter (Firestore Timestamp / Date / number / string) */
function formatCreatedAt(createdAt) {
  if (!createdAt) return "";

  let d = null;

  if (typeof createdAt?.toDate === "function") {
    d = createdAt.toDate();
  } else if (typeof createdAt?.seconds === "number") {
    d = new Date(createdAt.seconds * 1000);
  } else if (createdAt instanceof Date) {
    d = createdAt;
  } else if (typeof createdAt === "number") {
    d = new Date(createdAt);
  } else if (typeof createdAt === "string") {
    const parsed = new Date(createdAt);
    if (!isNaN(parsed.getTime())) d = parsed;
  }

  if (!d || isNaN(d.getTime())) return "";

  const dateStr = d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${dateStr} • ${timeStr}`;
}

/* ✅ pin persistence helpers (localStorage) */
function pinKey(uid) {
  return `pinned_requests_${String(uid || "")}`;
}
function readPins(uid) {
  try {
    const raw = localStorage.getItem(pinKey(uid));
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x)).filter(Boolean);
  } catch {
    return [];
  }
}
function writePins(uid, arr) {
  try {
    localStorage.setItem(pinKey(uid), JSON.stringify(arr));
  } catch {}
}

/* ---------- Motion ---------- */
const pageIn = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
  },
};

export default function ProgressScreen() {
  const navigate = useNavigate();
  const mountAtRef = useRef(typeof performance !== "undefined" ?performance.now() : 0);
  const firstReqSnapSeenRef = useRef(false);
  const firstPaintLoggedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [requests, setRequests] = useState([]);
  const [apps, setApps] = useState([]); // kept
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState("");

  const unreadNotifCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);

  /* ✅ pins state (max 2) */
  const [pinnedIds, setPinnedIds] = useState([]);
  const [visibleCount, setVisibleCount] = useState(REQUESTS_INITIAL_RENDER);
  const pinnedIdsRef = useRef([]);
  const stateRef = useRef(null);
  const appsRef = useRef([]);
  const requestsRef = useRef([]);
  useEffect(() => {
    pinnedIdsRef.current = pinnedIds;
  }, [pinnedIds]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    appsRef.current = apps;
  }, [apps]);
  useEffect(() => {
    requestsRef.current = requests;
  }, [requests]);

  useEffect(() => {
    if (firstPaintLoggedRef.current) return;
    firstPaintLoggedRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      const now = typeof performance !== "undefined" ?performance.now() : 0;
      const delta = Math.max(0, now - (mountAtRef.current || 0));
      console.log(`${PERF_TAG} mount->first-paint: ${delta.toFixed(1)}ms`);
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  // ✅ NEW: active track used as the "back target" for this screen
  const activeTrackForBack = useMemo(() => {
    const t = String(state?.activeTrack || "").toLowerCase();
    if (t === "work" || t === "travel" || t === "study") return t;
    // fallback if state is missing
    return "study";
  }, [state?.activeTrack]);

  const backHref = useMemo(
    () => `/app/${encodeURIComponent(activeTrackForBack)}`,
    [activeTrackForBack]
  );

  // ✅ NEW: Hardware/back button from Progress -> TrackScreen
  useEffect(() => {
    // mark this page as an anchor in history state
    try {
      window.history.replaceState(
        { ...(window.history.state || {}), __majuu_progress: true },
        ""
      );
    } catch {}

    const onPopState = (e) => {
      try {
        e.preventDefault?.();
      } catch {}
      navigate(backHref, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, backHref]);

  async function deleteRequestDeep(requestId) {
    const attRef = collection(db, "serviceRequests", requestId, "attachments");
    const attSnap = await getDocs(attRef);
    for (const d of attSnap.docs) {
      await deleteDoc(doc(db, "serviceRequests", requestId, "attachments", d.id));
    }
    await deleteDoc(doc(db, "serviceRequests", requestId));
  }

  useEffect(() => {
    let unsubReq = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      firstReqSnapSeenRef.current = false;
      setErr("");
      const cached = readProgressCache(user.uid);
      if (cached) {
        setState(cached.state || null);
        setRequests(Array.isArray(cached.requests) ?cached.requests : []);
        setApps(Array.isArray(cached.apps) ?cached.apps : []);
        setLoading(false);
      } else {
        setLoading(true);
      }

      /* ✅ load pins for this user (max 2) */
      const pins = readPins(user.uid).slice(0, 2);
      setPinnedIds(pins);

      try {
        const userStateTimer = `${PERF_TAG} firestore:getUserState`;
        startPerf(userStateTimer);
        const s = normalizeTextDeep(await getUserState(user.uid));
        endPerf(userStateTimer);
        setState(s);
        writeProgressCache(user.uid, {
          state: s,
          requests: cached?.requests || [],
          apps: cached?.apps || [],
        });

        const reqRef = collection(db, "serviceRequests");
        const reqQ = query(reqRef, where("uid", "==", user.uid));

        if (unsubReq) unsubReq();
        const listenerSetupTimer = `${PERF_TAG} firestore:onSnapshot setup`;
        const firstSnapTimer = `${PERF_TAG} firestore:wait first requests snapshot`;
        startPerf(listenerSetupTimer);
        startPerf(firstSnapTimer);

        unsubReq = onSnapshot(
          reqQ,
          (snap) => {
            if (!firstReqSnapSeenRef.current) {
              firstReqSnapSeenRef.current = true;
              endPerf(firstSnapTimer);
            }
            const mapSortTimer = `${PERF_TAG} transform:map+sort requests`;
            startPerf(mapSortTimer);
            const data = snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() }));
            data.sort(
              (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
            );
            endPerf(mapSortTimer);
            setRequests(data);
            writeProgressCache(user.uid, {
              state: stateRef.current,
              requests: data,
              apps: appsRef.current,
            });

            // ✅ keep pins valid (remove pins that no longer exist)
            const ids = new Set(data.map((x) => String(x.id)));
            const currentPins = pinnedIdsRef.current || [];
            const filtered = currentPins
              .filter((pid) => ids.has(String(pid)))
              .slice(0, 2);
            if (filtered.join("|") !== currentPins.join("|")) {
              setPinnedIds(filtered);
              writePins(user.uid, filtered);
            }
          },
          (error) => {
            endPerf(firstSnapTimer);
            console.error("Realtime requests error:", error);
            logIndexHint("serviceRequests(uid)", error);
            setErr(error?.message || "Failed to listen for requests");
          }
        );
        endPerf(listenerSetupTimer);

        const appsTimer = `${PERF_TAG} firestore:getMyApplications`;
        startPerf(appsTimer);
        const appls = await getMyApplications(user.uid, 25);
        endPerf(appsTimer);
        setApps(appls);
        writeProgressCache(user.uid, {
          state: stateRef.current,
          requests: requestsRef.current,
          apps: appls,
        });
      } catch (e) {
        console.error(e);
        logIndexHint("progress-load", e);
        setErr(e?.message || "Failed to load progress");
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubReq) unsubReq();
    };
  }, [navigate]);

  const goContinue = async () => {
    const resumeTarget = await getResumeTarget();
    if (resumeTarget?.path) {
      navigate(`${resumeTarget.path}${resumeTarget.search || ""}`, {
        replace: true,
        state: resumeTarget.state,
      });
      return;
    }

    const helpType = String(state?.activeHelpType || "").toLowerCase();
    const requestId = String(state?.activeRequestId || "").trim();
    const track = String(state?.activeTrack || "").toLowerCase();

    if (helpType === "we" && requestId) {
      navigate(`/app/request/${requestId}`, { replace: true });
      return;
    }
    if (track) {
      navigate(`/app/${track}`, { replace: true });
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  const hasActive = Boolean(state?.hasActiveProcess);
  const activeTrack = String(state?.activeTrack || "-");
  const activeCountry = String(state?.activeCountry || "-");
  const activeMode =
    String(state?.activeHelpType || "").toLowerCase() === "we"
      ?"We-Help"
      : "Self-Help";

  const cardBase =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60";
  const cardHover =
    "transition hover:border-emerald-200 hover:bg-white hover:shadow-md active:scale-[0.99] dark:hover:border-emerald-900/40 dark:hover:bg-zinc-900";
  const primaryBtn =
    "w-full rounded-3xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60";
  const ghostBtn =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900";
  const notifBannerBtn =
    "w-full text-left rounded-3xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white/45 dark:bg-zinc-900/35 backdrop-blur-md p-4 shadow-sm transition hover:bg-white/55 hover:border-emerald-200/70 active:scale-[0.99] dark:hover:bg-zinc-900/45 dark:hover:border-emerald-900/30";

  const requestsCountLabel = useMemo(() => {
    const n = requests.length;
    return n === 1 ?"1 request" : `${n} requests`;
  }, [requests.length]);

  /* ✅ reorder: pinned first (in pin order), then rest as-is */
  const requestsSorted = useMemo(() => {
    const label = `${PERF_TAG} transform:requestsSorted`;
    startPerf(label);
    const pins = (pinnedIds || []).map((x) => String(x));
    if (!pins.length) {
      endPerf(label);
      return requests;
    }

    const pinSet = new Set(pins);
    const byId = new Map(requests.map((r) => [String(r.id), r]));
    const pinned = pins.map((id) => byId.get(id)).filter(Boolean);
    const rest = requests.filter((r) => !pinSet.has(String(r.id)));
    const out = [...pinned, ...rest];
    endPerf(label);
    return out;
  }, [requests, pinnedIds]);

  useEffect(() => {
    setVisibleCount(REQUESTS_INITIAL_RENDER);
  }, [requestsSorted.length]);

  const visibleRequests = useMemo(() => {
    const label = `${PERF_TAG} render:list-window`;
    startPerf(label);
    const out = requestsSorted.slice(0, visibleCount);
    endPerf(label);
    return out;
  }, [requestsSorted, visibleCount]);

  const visibleRenderRows = useMemo(() => {
    const label = `${PERF_TAG} render:list-items map`;
    startPerf(label);
    const out = visibleRequests.map((r) => r);
    endPerf(label);
    return out;
  }, [visibleRequests]);

  /* ✅ toggle pin (max 2) */
  const togglePin = (rid) => {
    const user = auth.currentUser;
    if (!user) return;

    const id = String(rid || "");
    setPinnedIds((prev) => {
      const curr = Array.isArray(prev) ?prev.map(String) : [];
      const exists = curr.includes(id);

      let next = curr;
      if (exists) {
        next = curr.filter((x) => x !== id);
      } else {
        if (curr.length >= 2) {
          return curr; // max 2
        }
        next = [...curr, id];
      }

      writePins(user.uid, next);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="max-w-xl mx-auto px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading progress…
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-6">
        <motion.div
          className="max-w-xl mx-auto px-5 py-6"
          variants={pageIn}
          initial="hidden"
          animate="show"
        >
          {/* Thin header */}
          <div className="mb-3">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Progress
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Track your progress here.
            </p>
          </div>

          {/* Current process (moved up + compact) */}
          <div className={`mt-3 ${cardBase} ${cardHover} p-3`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Current process
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {Boolean(state?.hasActiveProcess) ?"Live" : "Idle"}
              </span>
            </div>

            {Boolean(state?.hasActiveProcess) ?(
              <div className="mt-3 grid gap-2">
                <div className="grid gap-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Track</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {String(state?.activeTrack || "-")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Country</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {String(state?.activeCountry || "-")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Mode</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {String(state?.activeHelpType || "").toLowerCase() === "we"
                        ?"We-Help"
                        : "Self-Help"}
                    </span>
                  </div>
                </div>

                <button onClick={goContinue} className={`${primaryBtn} py-2.5 rounded-2xl`}>
                  Continue
                </button>
              </div>
            ) : (
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                No active process yet. Choose a track to begin.
                <div className="mt-3">
                  <button
                    onClick={() => navigate("/dashboard")}
                    className={`${ghostBtn} px-3 py-2.5 rounded-2xl`}
                  >
                    Choose track
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ✅ Notifications (single banner, lighter glass) */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => navigate("/app/notifications")}
              className={notifBannerBtn}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/60 bg-white/45 text-emerald-700 dark:border-zinc-800/60 dark:bg-zinc-900/35 dark:text-emerald-200">
                    <AppIcon size={ICON_MD} icon={Bell} />
                  </span>

                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Notifications
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {unreadNotifCount ?"Tap to view new updates" : "Tap to view history"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {unreadNotifCount ?(
                    <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-rose-600 px-2 text-[11px] font-semibold text-white">
                      {unreadNotifCount > 99 ?"99+" : unreadNotifCount}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      All caught up
                    </span>
                  )}

                  <AppIcon size={ICON_SM} icon={ChevronRight} className="text-zinc-400 dark:text-zinc-500" />
                </div>
              </div>
            </button>
          </div>

          {/* Error */}
          {err ?(
            <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {/* Requests */}
          <div className="mt-6">
              <div className="flex items-end justify-between">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                  We-Help requests
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {requestsCountLabel}
                </span>
              </div>

              {requests.length === 0 ?(
                <div className={`mt-3 ${cardBase}`}>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    No requests yet
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    When you submit a We-Help request, it will show up here.
                  </div>
                  <div className="mt-4">
                    <button onClick={() => navigate("/dashboard")} className={ghostBtn}>
                      Start a request
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {visibleRenderRows.map((r) => {
                  const ui = statusUI(r.status);
                  const track = String(r.track || "").toLowerCase();
                  const safeTrack = track === "work" || track === "travel" ?track : "study";

                  const st = String(r.status || "new").toLowerCase();
                  const canDelete = st === "closed" || st === "rejected";
                  const isDeleting = deletingId === r.id;

                  const isFull =
                    Boolean(r.isFullPackage) ||
                    String(r.requestType || "").toLowerCase() === "full";
                  const fullPackageId = String(
                    r.fullPackageId || r.fullPackage?.fullPackageId || r.fullPackage?.id || ""
                  ).trim();
                  const isLinkedFullPackage = Boolean(r.isFullPackage) && Boolean(fullPackageId);

                  const titleLeft = `${String(r.track || "").toUpperCase()} • ${r.country || "-"}`;
                  const subtitle = isFull ?"Full package" : `Single: ${r.serviceName || "-"}`;
                  const createdLabel = formatCreatedAt(r.createdAt);
                  const fullAccentCard = isFull
                    ?"border-emerald-300/80 bg-emerald-50/45 dark:border-emerald-800/60 dark:bg-emerald-950/20"
                    : "";

                  const rid = String(r.id || "");
                  const isPinned = (pinnedIds || []).includes(rid);

                  const handleTryAgain = () => {
                    const country = r.country || "Not selected";
                    const countryQS2 = encodeURIComponent(country);

                    if (isLinkedFullPackage) {
                      const missingItems = Array.isArray(r.fullPackageSelectedItems)
                        ?r.fullPackageSelectedItems
                        : Array.isArray(r.missingItems)
                        ?r.missingItems
                        : parseMissingItemsFromNote(r.note);
                      const fallbackItem =
                        String(r.fullPackageItem || "").trim() ||
                        String(missingItems?.[0] || "").trim() ||
                        "Document checklist";
                      const retryItemKey = String(
                        r.fullPackageItemKey || toFullPackageItemKey(fallbackItem)
                      ).trim();
                      const hubPath = buildFullPackageHubPath({
                        fullPackageId,
                        track: safeTrack,
                      });
                      if (hubPath) {
                        const qs = new URLSearchParams();
                        if (country && country !== "Not selected") qs.set("country", country);
                        qs.set("track", safeTrack);
                        qs.set("autoOpen", "1");
                        if (retryItemKey) qs.set("retryItemKey", retryItemKey);
                        if (fallbackItem) qs.set("item", fallbackItem);
                        const suffix = qs.toString();

                        navigate(suffix ?`${hubPath}&${suffix}` : hubPath, {
                          state: { fullPackageId, missingItems },
                        });
                        return;
                      }
                    }

                    if (isFull) {
                      let missingItems = Array.isArray(r.missingItems) ?r.missingItems : [];
                      if (!missingItems.length) missingItems = parseMissingItemsFromNote(r.note);

                      try {
                        sessionStorage.setItem(`fp_missing_${safeTrack}`, JSON.stringify(missingItems));
                      } catch {}

                      const picked =
                        String(r.fullPackageItem || "").trim() ||
                        String(missingItems?.[0] || "").trim() ||
                        "Document checklist";

                      navigate(
                        `/app/full-package/${safeTrack}?country=${countryQS2}&parentRequestId=${encodeURIComponent(
                          String(r.id || "")
                        )}&autoOpen=1&item=${encodeURIComponent(picked)}`,
                        { state: { missingItems } }
                      );
                      return;
                    }

                    const serviceName = String(r.serviceName || "").trim();
                    navigate(
                      `/app/${safeTrack}/we-help?country=${countryQS2}&autoOpen=1&open=${encodeURIComponent(
                        serviceName
                      )}`
                    );
                  };

                  const openRequestAndClearChatPill = async () => {
                    navigate(`/app/request/${rid}`);
                  };

                    return (
                    <div
                      key={r.id}
                      className={`${cardBase} ${cardHover} ${fullAccentCard} relative overflow-hidden`}
                    >
                      {isFull ?(
                        <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-3xl bg-emerald-500/80 dark:bg-emerald-400/70" />
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${ui.dot}`} />
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {titleLeft}
                            </div>

                          </div>

                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                            {subtitle}
                          </div>
                          {isFull ?(
                            <div className="mt-2">
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/35 dark:text-emerald-200">
                                Full package
                              </span>
                            </div>
                          ) : null}

                          {createdLabel ?(
                            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                              Created: <span className="font-medium">{createdLabel}</span>
                            </div>
                          ) : null}
                        </div>

                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${ui.badge}`}>
                          {ui.label}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={openRequestAndClearChatPill}
                          className="inline-flex items-center gap-2 rounded-3xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/55"
                        >
                          View
                          <AppIcon size={ICON_SM} icon={ChevronRight} />
                        </button>

                        {st === "rejected" && (
                          <button
                            onClick={handleTryAgain}
                            className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
                          >
                            Try again
                          </button>
                        )}

                        {canDelete && (
                          <button
                            disabled={isDeleting}
                            onClick={async () => {
                              const ok = window.confirm("Delete this request?This cannot be undone.");
                              if (!ok) return;

                              setErr("");
                              setDeletingId(r.id);

                              try {
                                await deleteRequestDeep(r.id);

                                const user = auth.currentUser;
                                if (user) {
                                  setPinnedIds((prev) => {
                                    const next = (prev || [])
                                      .filter((x) => String(x) !== rid)
                                      .slice(0, 2);
                                    writePins(user.uid, next);
                                    return next;
                                  });
                                }
                              } catch (e) {
                                console.error("Delete request failed:", e);
                                setErr(e?.message || "Failed to delete request.");
                              } finally {
                                setDeletingId("");
                              }
                            }}
                            className="inline-flex items-center gap-2 rounded-3xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/55"
                          >
                            <AppIcon size={ICON_SM} icon={Trash2} />
                            {isDeleting ?"Deleting…" : "Delete"}
                          </button>
                        )}
                      </div>

                      {st === "new" ?(
                        <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                          Received — you’ll see updates here as we process it.
                        </div>
                      ) : null}

                      <button
                        onClick={() => togglePin(rid)}
                        type="button"
                        title={isPinned ?"Unpin" : pinnedIds.length >= 2 ?"Pin limit reached" : "Pin"}
                        aria-label={isPinned ?"Unpin request" : "Pin request"}
                        disabled={!isPinned && pinnedIds.length >= 2}
                        className={`absolute bottom-3 right-3 inline-flex items-center justify-center rounded-2xl border p-2 transition active:scale-[0.99] disabled:opacity-50
                          ${
                            isPinned
                              ?"border-emerald-200 bg-emerald-50/60 text-emerald-800 ring-2 ring-emerald-300/60 shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_10px_30px_rgba(16,185,129,0.18)] dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200 dark:ring-emerald-500/30 dark:shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_10px_30px_rgba(16,185,129,0.12)]"
                              : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:bg-zinc-900"
                          }`}
                      >
                        {isPinned ?<AppIcon size={ICON_SM} icon={PinOff} /> : <AppIcon size={ICON_SM} icon={Pin} />}
                      </button>
                    </div>
                  );
                })}

                  {visibleCount < requestsSorted.length ?(
                    <button
                      type="button"
                      onClick={() => setVisibleCount((prev) => prev + REQUESTS_INITIAL_RENDER)}
                      className="mx-auto text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition hover:opacity-80 active:scale-[0.99]"
                    >
                      See more...
                    </button>
                  ) : null}
                </div>
              )}
          </div>

          {/* apps kept but not rendered */}
        </motion.div>
      </div>
    </div>
  );
}




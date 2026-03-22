// ✅ StaffTasksScreen.jsx
// Staff task unread badges are derived only from published chat messages + readState.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import { useNotifsV2Store } from "../services/notifsV2Store";
import { smartBack } from "../utils/navBack";

const PERF_TAG = "[perf][StaffTasks]";
const SEARCH_DEBOUNCE_MS = 180;
const INITIAL_RENDER_COUNT = 5;
const LONG_PRESS_MS = 420;
const STAFF_SCORING_POLICY = Object.freeze({
  provisionalMaxDone: 4,
});
const DEFAULT_TIER_INFO = Object.freeze({
  key: "provisional",
  label: "Provisional",
  pct: 0,
});

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readStaffMetrics(staffDoc = {}) {
  const perf = staffDoc?.performance || {};
  const stats = staffDoc?.stats || staffDoc?.stats?.stats || {};

  const doneCount = toNum(perf?.doneCount ?? stats?.totalDone ?? stats?.doneCount, 0);
  const reviewedCount = toNum(perf?.reviewedCount ?? stats?.totalReviewed, 0);
  const matchedCount = toNum(
    perf?.matchCount ?? stats?.matchedDecisionCount ?? stats?.successCount,
    0
  );
  const successCountLegacy = toNum(perf?.successCount ?? stats?.successCount, 0);
  const totalMinutes = toNum(stats?.totalMinutes, 0);
  const avgMinutesRaw = perf?.avgMinutes ?? stats?.avgMinutes ?? null;
  let avgMinutes = toNum(avgMinutesRaw, 0);

  if ((!avgMinutes || avgMinutes <= 0) && doneCount > 0 && totalMinutes > 0) {
    avgMinutes = totalMinutes / doneCount;
  }

  let successRate = toNum(perf?.successRate ?? stats?.successRate ?? stats?.matchRate, Number.NaN);
  if (!Number.isFinite(successRate)) {
    if (reviewedCount > 0) successRate = matchedCount / reviewedCount;
    else if (doneCount > 0) successRate = successCountLegacy / doneCount;
    else successRate = 0;
  }
  successRate = clamp(successRate, 0, 1);
  const active = staffDoc?.active !== false;

  return { doneCount, reviewedCount, successRate, avgMinutes, active };
}

function computeStaffScore(metrics = {}) {
  const doneCount = toNum(metrics?.doneCount, 0);
  const successRate = clamp(toNum(metrics?.successRate, 0), 0, 1);
  const avgMinutes = toNum(metrics?.avgMinutes, 0);

  const minMinutes = 30;
  const maxMinutes = 72 * 60;
  const bounded = clamp(avgMinutes || maxMinutes, minMinutes, maxMinutes);
  const speedRatio = (bounded - minMinutes) / (maxMinutes - minMinutes);
  const speedScore = clamp(1 - speedRatio, 0, 1);

  const reliability = successRate * 70;
  const speed = speedScore * 20;
  const volume = (clamp(doneCount, 0, 40) / 40) * 10;
  const provisionalPenalty = doneCount <= STAFF_SCORING_POLICY.provisionalMaxDone ? 5 : 0;

  return clamp(Math.round(reliability + speed + volume - provisionalPenalty), 0, 100);
}

function resolveStaffTier({ doneCount, successRate, staffScore, active }) {
  if (!active) return { key: "paused", label: "Paused" };
  if (doneCount <= STAFF_SCORING_POLICY.provisionalMaxDone) {
    return { key: "provisional", label: "Provisional" };
  }
  if (staffScore >= 88 && successRate >= 0.8) return { key: "diamond", label: "Diamond" };
  if (staffScore >= 72 && successRate >= 0.65) return { key: "gold", label: "Gold" };
  return { key: "silver", label: "Silver" };
}

function computeTierProgressPct({ tierKey, doneCount, successRate, staffScore }) {
  const key = String(tierKey || "provisional").toLowerCase();
  const score = clamp(toNum(staffScore, 0), 0, 100);
  const rate = clamp(toNum(successRate, 0), 0, 1);
  const done = Math.max(0, toNum(doneCount, 0));

  if (key === "diamond") return 100;
  if (key === "paused") return 0;

  if (key === "provisional") {
    const requiredDone = Number(STAFF_SCORING_POLICY.provisionalMaxDone || 4) + 1;
    return Math.round(clamp((done / requiredDone) * 100, 0, 100));
  }

  if (key === "gold") {
    const scorePct = clamp((score / 88) * 100, 0, 100);
    const ratePct = clamp((rate / 0.8) * 100, 0, 100);
    return Math.round(scorePct * 0.75 + ratePct * 0.25);
  }

  const scorePct = clamp((score / 72) * 100, 0, 100);
  const ratePct = clamp((rate / 0.65) * 100, 0, 100);
  return Math.round(scorePct * 0.75 + ratePct * 0.25);
}

function startPerf(label) {
  try {
    console.time(label);
  } catch {
    // no-op
  }
}

function endPerf(label) {
  try {
    console.timeEnd(label);
  } catch {
    // no-op
  }
}

function logIndexHint(scope, error) {
  const raw = String(error?.message || "");
  const match = raw.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/i);
  if (match?.[0]) {
    console.warn(`${PERF_TAG} index hint (${scope}): ${match[0]}`);
  }
}

/* ---------- Icons ---------- */
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

function IconSearch(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10.8 18.2a7.4 7.4 0 1 1 0-14.8 7.4 7.4 0 0 1 0 14.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16.8 16.8 21 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLogout(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7V6.3A2.3 2.3 0 0 1 12.3 4h5.4A2.3 2.3 0 0 1 20 6.3v11.4A2.3 2.3 0 0 1 17.7 20h-5.4A2.3 2.3 0 0 1 10 17.7V17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 9l-3 3 3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBell(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15 17H5.5a1 1 0 0 1-.8-1.6l1.1-1.5a3 3 0 0 0 .6-1.8V10a5.5 5.5 0 1 1 11 0v2.1a3 3 0 0 0 .6 1.8l1.1 1.5a1 1 0 0 1-.8 1.6H15Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10.2 19a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Pills ---------- */
function taskPillByStaffStatus(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "done") {
    return {
      label: "Done",
      cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
    };
  }
  if (s === "in_progress") {
    return {
      label: "Ongoing",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }
  return {
    label: "New",
    cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
  };
}

function recPill(staffDecision) {
  const d = String(staffDecision || "").toLowerCase();
  if (d === "recommend_accept") {
    return {
      label: "Recommend accept",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  }
  if (d === "recommend_reject") {
    return {
      label: "Recommend reject",
      cls: "bg-rose-50 text-rose-700 border border-rose-100",
    };
  }
  return null;
}

const TABS = [
  { key: "new", label: "New" },
  { key: "ongoing", label: "Ongoing" },
  { key: "done", label: "Done" },
];

function isValidTabKey(k) {
  const key = String(k || "").toLowerCase();
  return TABS.some((t) => t.key === key);
}

function normalizeStaffTab(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "done") return "done";
  if (s === "in_progress") return "ongoing";
  return "new";
}

function normalizeTaskStatus(taskStatus) {
  const s = String(taskStatus || "assigned").toLowerCase();
  if (s === "done" || s === "completed" || s === "complete") return "done";
  if (s === "active" || s === "in_progress" || s === "in-progress") return "in_progress";
  return "assigned";
}

function resolveStaffStatus(requestStatus, requestStaffStatus, taskStatus) {
  const requestLifecycle = String(requestStatus || "").trim().toLowerCase();
  if (requestLifecycle === "closed" || requestLifecycle === "rejected") return "done";

  const requestNorm = String(requestStaffStatus || "").trim().toLowerCase();
  if (requestNorm === "done") return "done";
  if (requestNorm === "in_progress" || requestNorm === "in-progress") return "in_progress";
  if (requestNorm === "assigned" || requestNorm === "new") return "assigned";
  return normalizeTaskStatus(taskStatus);
}

export default function StaffTasksScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mountAtRef = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const firstPaintLoggedRef = useRef(false);
  const firstTasksSnapSeenRef = useRef(false);
  const requestsMapRef = useRef({});
  const requestsInFlightRef = useRef(new Set());
  const longPressTimerRef = useRef(null);
  const longPressStateRef = useRef({ rid: "", fired: false, x: 0, y: 0 });

  const tabFromUrl = searchParams.get("tab");
  const qFromUrl = searchParams.get("q") || "";

  const [tab, setTab] = useState(isValidTabKey(tabFromUrl) ? tabFromUrl : "new");
  const [search, setSearch] = useState(String(qFromUrl));
  const [debouncedSearch, setDebouncedSearch] = useState(String(qFromUrl));
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [tasks, setTasks] = useState([]);
  const [requestsMap, setRequestsMap] = useState({});
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState("");
  const [tierInfo, setTierInfo] = useState(DEFAULT_TIER_INFO);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Global unread source-of-truth (driven by notifsV2Engine)
  const unreadByRequest = useNotifsV2Store((s) => s.unreadByRequest);
  const unreadNotifCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);

  // ✅ entrance animation
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);

  // ✅ prevent setState after unmount during async request detail fetch
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    requestsMapRef.current = requestsMap || {};
  }, [requestsMap]);

  useEffect(() => {
    if (firstPaintLoggedRef.current) return;
    firstPaintLoggedRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      const delta = Math.max(0, now - (mountAtRef.current || 0));
      console.log(`${PERF_TAG} mount->first-paint: ${delta.toFixed(1)}ms`);
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(String(search || "")), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_COUNT);
  }, [tab, debouncedSearch]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  // keep URL state in sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);

    const trimmed = String(search || "").trim();
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");

    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [tab, search, searchParams, setSearchParams]);

  useEffect(() => {
    let unsubTasks = null;
    let unsubStaff = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubTasks) unsubTasks();
      if (unsubStaff) unsubStaff();
      requestsInFlightRef.current = new Set();
      firstTasksSnapSeenRef.current = false;

      if (!user) {
        setTierInfo(DEFAULT_TIER_INFO);
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setLoading(true);
      setErr("");

      unsubStaff = onSnapshot(
        doc(db, "staff", user.uid),
        (snap) => {
          const staffDoc = snap.exists() ? snap.data() || {} : {};
          const metrics = readStaffMetrics(staffDoc);
          const staffScore = computeStaffScore(metrics);
          const tier = resolveStaffTier({
            doneCount: metrics.doneCount,
            successRate: metrics.successRate,
            staffScore,
            active: metrics.active,
          });
          const pct = computeTierProgressPct({
            tierKey: tier.key,
            doneCount: metrics.doneCount,
            successRate: metrics.successRate,
            staffScore,
          });
          if (!aliveRef.current) return;
          setTierInfo({ key: tier.key, label: tier.label, pct });
        },
        () => {
          if (!aliveRef.current) return;
          setTierInfo(DEFAULT_TIER_INFO);
        }
      );

      const tRef = collection(db, "staff", user.uid, "tasks");
      const tQ = query(tRef, orderBy("assignedAt", "desc"));
      const setupTimer = `${PERF_TAG} firestore:onSnapshot setup staff tasks`;
      const firstSnapTimer = `${PERF_TAG} firestore:wait first tasks snapshot`;
      startPerf(setupTimer);
      startPerf(firstSnapTimer);

      unsubTasks = onSnapshot(
        tQ,
        (snap) => {
          if (!firstTasksSnapSeenRef.current) {
            firstTasksSnapSeenRef.current = true;
            endPerf(firstSnapTimer);
          }
          const mapTimer = `${PERF_TAG} transform:tasks snapshot map`;
          startPerf(mapTimer);
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          endPerf(mapTimer);
          if (!aliveRef.current) return;
          setTasks(list);
          setLoading(false);

          const requestIds = Array.from(
            new Set(
              list
                .map((t) => String(t.requestId || t.id || "").trim())
                .filter(Boolean)
            )
          );
          const activeIdSet = new Set(requestIds);

          if (!aliveRef.current) return;
          setRequestsMap((prev) => {
            const next = {};
            Object.keys(prev || {}).forEach((rid) => {
              if (activeIdSet.has(rid)) next[rid] = prev[rid];
            });
            return next;
          });

          const inflight = requestsInFlightRef.current;
          const missing = requestIds.filter((rid) => !requestsMapRef.current?.[rid] && !inflight.has(rid));
          if (missing.length === 0) return;

          const fetchTimer = `${PERF_TAG} firestore:getDoc request details (${missing.length})`;
          startPerf(fetchTimer);
          missing.forEach((rid) => inflight.add(rid));

          Promise.all(
            missing.map(async (rid) => {
              try {
                const rSnap = await getDoc(doc(db, "serviceRequests", rid));
                if (!rSnap.exists()) return [rid, null];
                return [rid, { id: rSnap.id, ...rSnap.data() }];
              } catch {
                return [rid, null];
              }
            })
          )
            .then((entries) => {
              if (!aliveRef.current) return;
              setRequestsMap((prev) => {
                const next = { ...(prev || {}) };
                entries.forEach(([rid, payload]) => {
                  if (!rid) return;
                  if (!payload) {
                    delete next[rid];
                    return;
                  }
                  next[rid] = payload;
                });
                return next;
              });
            })
            .finally(() => {
              missing.forEach((rid) => inflight.delete(rid));
              endPerf(fetchTimer);
            });
        },
        (e) => {
          endPerf(firstSnapTimer);
          console.error(e);
          logIndexHint("staff/{uid}/tasks orderBy(assignedAt)", e);
          if (!aliveRef.current) return;
          setErr(e?.message || "Failed to load tasks.");
          setLoading(false);
        }
      );
      endPerf(setupTimer);
    });

    return () => {
      unsubAuth();
      if (unsubTasks) unsubTasks();
      if (unsubStaff) unsubStaff();
      requestsInFlightRef.current = new Set();
    };
  }, [navigate]);

  const enriched = useMemo(() => {
    const label = `${PERF_TAG} transform:enriched`;
    startPerf(label);
    const out = tasks
      .map((t) => {
        const rid = String(t.requestId || t.id);
        const req = requestsMap[rid];
        const staffStatus = resolveStaffStatus(req?.status, req?.staffStatus, t?.status);
        const staffTab = normalizeStaffTab(staffStatus);

        return { task: t, rid, req, staffStatus, staffTab };
      })
      .filter((x) => x.rid);
    endPerf(label);
    return out;
  }, [tasks, requestsMap]);

  const filtered = useMemo(() => {
    const label = `${PERF_TAG} transform:filter`;
    startPerf(label);
    const q = String(debouncedSearch || "").trim().toLowerCase();

    const out = enriched
      .filter((x) => x.staffTab === tab)
      .filter((x) => {
        if (!q) return true;
        const r = x.req || {};
        const t = x.task || {};
        return [
          r.track || t.track,
          r.country || t.country,
          r.requestType || t.requestType,
          r.serviceName || t.serviceName,
          r.name || t.applicantName,
          r.note,
          r.staffDecision,
          x.staffStatus,
          x.rid,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
    endPerf(label);
    return out;
  }, [enriched, tab, debouncedSearch]);

  const visibleFiltered = useMemo(() => {
    const label = `${PERF_TAG} render:list-window`;
    startPerf(label);
    const out = filtered.slice(0, visibleCount);
    endPerf(label);
    return out;
  }, [filtered, visibleCount]);

  const tabHasDot = useMemo(() => {
    const out = { new: false, ongoing: false, done: false };
    if (!unreadByRequest || Object.keys(unreadByRequest).length === 0) return out;

    enriched.forEach((x) => {
      if (!unreadByRequest?.[x.rid]?.unread) return;
      if (out[x.staffTab] !== undefined) out[x.staffTab] = true;
    });

    return out;
  }, [enriched, unreadByRequest]);

  const doLogout = async () => {
    try {
      setBusy("logout");
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Logout failed.");
    } finally {
      setBusy("");
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const closeDeleteModal = () => {
    clearLongPressTimer();
    longPressStateRef.current = { rid: "", fired: false, x: 0, y: 0 };
    setDeleteTarget(null);
  };

  const openDeleteModal = ({ rid, title, staffStatus }) => {
    const normalizedStatus = String(staffStatus || "").toLowerCase();
    if (normalizedStatus !== "done") return;
    setDeleteTarget({
      rid: String(rid || ""),
      title: String(title || "Done request"),
      staffStatus: normalizedStatus,
    });
  };

  const beginLongPress = (event, { rid, title, staffStatus }) => {
    if (String(staffStatus || "").toLowerCase() !== "done") return;
    if (event?.button != null && event.button !== 0) return;

    clearLongPressTimer();
    longPressStateRef.current = {
      rid: String(rid || ""),
      fired: false,
      x: Number(event?.clientX ?? 0),
      y: Number(event?.clientY ?? 0),
    };

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStateRef.current = { ...longPressStateRef.current, fired: true };
      openDeleteModal({ rid, title, staffStatus });
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    }, LONG_PRESS_MS);
  };

  const cancelLongPressPending = () => {
    if (!longPressStateRef.current.fired) clearLongPressTimer();
  };

  const maybeCancelLongPressOnMove = (event) => {
    if (!longPressTimerRef.current) return;
    const { x, y } = longPressStateRef.current;
    const dx = Math.abs(Number(event?.clientX ?? 0) - x);
    const dy = Math.abs(Number(event?.clientY ?? 0) - y);
    if (dx > 10 || dy > 10) clearLongPressTimer();
  };

  const openDeleteFromContext = (event, { rid, title, staffStatus }) => {
    if (String(staffStatus || "").toLowerCase() !== "done") return;
    event.preventDefault();
    event.stopPropagation();
    clearLongPressTimer();
    longPressStateRef.current = {
      rid: String(rid || ""),
      fired: true,
      x: Number(event?.clientX ?? 0),
      y: Number(event?.clientY ?? 0),
    };
    openDeleteModal({ rid, title, staffStatus });
  };

  const handleTaskActivate = ({ rid, goTo }) => {
    if (longPressStateRef.current.fired && longPressStateRef.current.rid === String(rid || "")) {
      longPressStateRef.current = { rid: "", fired: false, x: 0, y: 0 };
      return;
    }
    longPressStateRef.current = { rid: "", fired: false, x: 0, y: 0 };
    navigate(goTo);
  };

  const deleteDoneTask = async () => {
    const rid = String(deleteTarget?.rid || "").trim();
    const targetStatus = String(deleteTarget?.staffStatus || "").toLowerCase();
    if (!rid) return;
    if (targetStatus !== "done") {
      setErr("Only done requests can be removed.");
      return;
    }
    if (!uid) {
      setErr("Not signed in.");
      return;
    }

    try {
      setBusy("delete");
      setErr("");
      await deleteDoc(doc(db, "staff", uid, "tasks", rid));
      setTasks((prev) =>
        (prev || []).filter((t) => {
          const id = String(t?.id || "");
          const reqId = String(t?.requestId || "");
          return id !== rid && reqId !== rid;
        })
      );
      setRequestsMap((prev) => {
        const next = { ...(prev || {}) };
        delete next[rid];
        return next;
      });
      closeDeleteModal();
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to delete done request.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (tab !== "done" && deleteTarget) {
      closeDeleteModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const tabBtnBase =
    "rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const tabBtnOn =
    "border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  const tabBtnOff =
    "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900";

  const activeLabel = useMemo(() => {
    return TABS.find((t) => t.key === tab)?.label || "New";
  }, [tab]);
  const tierTextTone = useMemo(() => {
    const key = String(tierInfo?.key || "").toLowerCase();
    if (key === "diamond") {
      return "text-cyan-800 dark:text-cyan-200";
    }
    if (key === "gold") {
      return "text-amber-800 dark:text-amber-200";
    }
    if (key === "silver") {
      return "text-zinc-700 dark:text-zinc-200";
    }
    if (key === "paused") {
      return "text-rose-700 dark:text-rose-200";
    }
    return "text-emerald-800 dark:text-emerald-200";
  }, [tierInfo]);
  const RedDot = ({ className = "" }) => (
    <span
      className={`inline-flex h-2.5 w-2.5 rounded-full bg-rose-600 shadow-[0_0_0_3px_rgba(244,63,94,0.12)] ${className}`}
      aria-hidden="true"
    />
  );

  const softBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const enterWrap =
    "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  const floatCard =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60";

  return (
    <div className={`min-h-screen ${softBg}`}>
      <div className={`max-w-xl mx-auto px-5 py-6 pb-10 ${enterWrap} ${enterCls}`}>
        {/* Sticky top bar */}
        <div className="sticky top-0 z-10 -mx-5 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-950/40">
          {/* Top row: Back + Logout */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <button
                type="button"
                onClick={() => smartBack(navigate, "/staff/tasks")}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
              >
                <IconChevronLeft className="h-4 w-4" />
                Back
              </button>

              <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Your tasks
              </h1>

              <button
                type="button"
                onClick={() => navigate("/staff/notifications")}
                className="relative mt-3 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                title="Notifications"
              >
                <span className="relative inline-flex items-center">
                  <IconBell className="h-[22px] w-[22px]" />
                  {unreadNotifCount > 0 ? (
                    <span className="absolute -top-2 -right-2 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white shadow-[0_0_0_3px_rgba(244,63,94,0.14)]">
                      {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
                    </span>
                  ) : null}
                </span>
                Notifications
              </button>
            </div>

            <div className="flex flex-col items-end gap-3 pt-0.5">
              <button
                type="button"
                onClick={doLogout}
                disabled={busy === "logout" || !uid}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-rose-200 hover:bg-rose-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                title="Logout"
              >
                <IconLogout className="h-5 w-5" />
                {busy === "logout" ? "Logging out…" : "Logout"}
              </button>

              <div className={`text-sm font-semibold ${tierTextTone}`}>
                {tierInfo.label}
              </div>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800/80">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out dark:bg-emerald-400"
                  style={{ width: `${Math.max(0, Math.min(100, Number(tierInfo?.pct || 0) || 0))}%` }}
                />
              </div>
            </div>
          </div>

          {/* subtle divider */}
          <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-zinc-700/70" />

          {/* Tabs */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`${tabBtnBase} ${tab === t.key ? tabBtnOn : tabBtnOff} ${
                  t.key === "new" ? "-translate-x-1" : t.key === "done" ? "translate-x-1" : ""
                }`}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  {t.label}
                  {tabHasDot[t.key] ? <RedDot className="translate-y-[1px]" /> : null}
                </span>
              </button>
            ))}
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {/* Search */}
        <div className="mt-5">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Search
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 shadow-sm backdrop-blur transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100/80 dark:border-zinc-800 dark:bg-zinc-900/60 dark:focus-within:ring-emerald-300/20">
            <IconSearch className="h-5 w-5 text-zinc-500" />
            <input
              className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              placeholder="Track, country, applicant, service, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Showing{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                {filtered.length}
              </span>{" "}
              in <span className="font-semibold">{activeLabel}</span>
            </span>

            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              Tab: {activeLabel}
            </span>
          </div>
        </div>

        {/* States */}
        {loading ? (
          <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
            Loading…
          </div>
        ) : tasks.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              No tasks assigned
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Wait for assignments from admin.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
            No requests found in this tab.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {visibleFiltered.map(({ task, rid, req, staffStatus }) => {
              const tp = taskPillByStaffStatus(staffStatus);
              const rp = recPill(req?.staffDecision);

              const displayTrack = String(req?.track || task?.track || "").toUpperCase();
              const displayCountry = req?.country || task?.country || "-";
              const displayRequestType = String(req?.requestType || task?.requestType || "").toLowerCase();
              const isFull = Boolean(req?.isFullPackage || task?.isFullPackage) || displayRequestType === "full";
              const displayServiceName = req?.serviceName || task?.serviceName || "-";
              const title = displayTrack ? `${displayTrack} • ${displayCountry}` : `Request • ${rid}`;
              const sub = isFull
                ? "Full Package"
                : `Single: ${displayServiceName || displayRequestType || "-"}`;
              const fullTaskAccent = isFull
                ? "border-emerald-300/80 bg-emerald-50/40 dark:border-emerald-800/60 dark:bg-emerald-950/20"
                : "";

              const sNorm = String(staffStatus || "assigned").toLowerCase();
              const goTo =
                sNorm === "in_progress" || sNorm === "done"
                  ? `/staff/request/${rid}`
                  : `/staff/request/${rid}/start`;

              const hasUnread = Boolean(unreadByRequest?.[rid]?.unread);
              const canDeleteDone = sNorm === "done";

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => handleTaskActivate({ rid, goTo })}
                  onPointerDown={(e) =>
                    beginLongPress(e, {
                      rid,
                      title,
                      staffStatus: sNorm,
                    })
                  }
                  onPointerUp={cancelLongPressPending}
                  onPointerCancel={cancelLongPressPending}
                  onPointerLeave={cancelLongPressPending}
                  onPointerMove={maybeCancelLongPressOnMove}
                  onContextMenu={(e) =>
                    openDeleteFromContext(e, {
                      rid,
                      title,
                      staffStatus: sNorm,
                    })
                  }
                  className={`${floatCard} ${fullTaskAccent} relative overflow-hidden`}
                >
                  {isFull ? (
                    <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-emerald-500/80 dark:bg-emerald-400/70" />
                  ) : null}
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {title}
                        </div>

                        {hasUnread ? (
                          <span
                            className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500"
                            aria-label="Unread chat"
                            title="Unread chat"
                          />
                        ) : null}
                        {isFull ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/35 dark:text-emerald-200">
                            Full package
                          </span>
                        ) : null}
                      </div>

                      <div
                        className={`mt-1 text-left text-sm ${
                          isFull ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-600 dark:text-zinc-300"
                        }`}
                      >
                        {sub}
                      </div>

                      {rp ? (
                        <div className="mt-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] leading-none font-semibold ${rp.cls}`}
                          >
                            {rp.label}
                          </span>
                        </div>
                      ) : null}

                      <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        ID: <span className="font-mono">{rid}</span>
                      </div>
                      {canDeleteDone ? (
                        <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                          Long press to delete from Done list
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs ${tp.cls}`}>
                        {tp.label}
                      </span>
                      {canDeleteDone ? (
                        <span
                          role="button"
                          tabIndex={0}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeleteModal({ rid, title, staffStatus: sNorm });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              openDeleteModal({ rid, title, staffStatus: sNorm });
                            }
                          }}
                          title="Delete from done list"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-rose-200 bg-rose-50/80 text-rose-700 shadow-sm transition hover:bg-rose-100 active:scale-[0.98] dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                        >
                          <IconTrash className="h-4 w-4" />
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}

            {visibleCount < filtered.length ? (
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + INITIAL_RENDER_COUNT)}
                className="mx-auto text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition hover:opacity-80 active:scale-[0.99]"
              >
                See more...
              </button>
            ) : null}
          </div>
        )}

        <div className="h-6" />

        {deleteTarget ? (
          <div className="fixed inset-0 z-50">
            <button
              type="button"
              onClick={closeDeleteModal}
              className="absolute inset-0 bg-black/45"
              aria-label="Close delete confirmation"
            />
            <div className="absolute inset-0 flex items-center justify-center app-overlay-safe">
              <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-4 shadow-xl dark:border-rose-900/40 dark:bg-zinc-900">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Delete done request?
                </div>
                <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                  Remove this task from your Done list only.
                </div>
                <div className="mt-2 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
                  {deleteTarget.title}
                  <div className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                    {deleteTarget.rid}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteModal}
                    disabled={busy === "delete"}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/70 px-3 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition hover:border-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={deleteDoneTask}
                    disabled={busy === "delete"}
                    className="rounded-2xl border border-rose-200 bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                  >
                    {busy === "delete" ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IconTrash(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 7h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 7l.8 11.1a2 2 0 0 0 2 1.9h3.4a2 2 0 0 0 2-1.9L16.5 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 10.5v6M14 10.5v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

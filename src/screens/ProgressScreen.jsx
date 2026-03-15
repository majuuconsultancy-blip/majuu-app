import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import {
  Bell,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Compass,
  ExternalLink,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import { motion as Motion } from "../utils/motionProxy";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { auth, db } from "../firebase";
import { useNotifsV2Store } from "../services/notifsV2Store";
import { clearActiveProcess, getUserState } from "../services/userservice";
import { getMyApplications } from "../services/progressservice";
import { getResumeTarget } from "../resume/resumeEngine";
import {
  buildFullPackageHubPath,
  toFullPackageItemKey,
} from "../services/fullpackageservice";
import { normalizeTextDeep } from "../utils/textNormalizer";
import {
  extractRequestIdFromAppPath,
  filterVisibleSubmittedRequests,
  isUnsubmittedGhostRequest,
} from "../utils/requestGhosts";
import {
  getNextVerifiedStep,
  getVerifiedPathForRoute,
  getVerifiedProgressSummary,
} from "../selfHelp/selfHelpPaths";
import {
  buildSelfHelpRouteTarget,
  getResourceDomain,
  getSelfHelpBadgeMeta,
} from "../selfHelp/selfHelpLinking";
import {
  reopenStoredSelfHelpGateway,
  resolveStoredSelfHelpUrl,
} from "../selfHelp/selfHelpGateway";
import {
  getSelfHelpProgress,
  getSelfHelpRouteState,
  toggleSelfHelpBookmark,
} from "../selfHelp/selfHelpProgressStore";

const REQUESTS_INITIAL_RENDER = 5;
const PROGRESS_CACHE_PREFIX = "majuu_progress_cache_";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function formatRelativeTime(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return "";

  const diffMs = Date.now() - value;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function buildCountrySearch(country) {
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  return params.toString() ? `?${params.toString()}` : "";
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
      state: parsed.state || null,
      requests: filterVisibleSubmittedRequests(
        Array.isArray(parsed.requests) ? parsed.requests : []
      ),
      apps: Array.isArray(parsed.apps) ? parsed.apps : [],
    };
  } catch {
    return null;
  }
}

function writeProgressCache(uid, payload) {
  if (!uid || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      progressCacheKey(uid),
      JSON.stringify({
        state: payload?.state || null,
        requests: filterVisibleSubmittedRequests(
          Array.isArray(payload?.requests) ? payload.requests : []
        ),
        apps: Array.isArray(payload?.apps) ? payload.apps : [],
        updatedAt: Date.now(),
      })
    );
  } catch {
    // ignore cache issues
  }
}

function statusUI(status) {
  const value = String(status || "new").toLowerCase();

  if (value === "contacted") {
    return {
      label: "Received",
      badge:
        "border border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200",
      dot: "bg-emerald-500",
    };
  }

  if (value === "closed") {
    return {
      label: "Succeeded",
      badge:
        "border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/45 dark:text-emerald-200",
      dot: "bg-emerald-700",
    };
  }

  if (value === "rejected") {
    return {
      label: "Rejected",
      badge:
        "border border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200",
      dot: "bg-rose-500",
    };
  }

  return {
    label: "Submitted",
    badge:
      "border border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200",
    dot: "bg-zinc-400 dark:bg-zinc-500",
  };
}

function parseMissingItemsFromNote(note) {
  const text = String(note || "");
  const match = text.match(/Missing items:\s*([^\n\r]+)/i);
  if (!match) return [];

  return Array.from(
    new Set(
      match[1]
        .split(/[,|]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function formatCreatedAt(createdAt) {
  if (!createdAt) return "";

  let date = null;
  if (typeof createdAt?.toDate === "function") {
    date = createdAt.toDate();
  } else if (typeof createdAt?.seconds === "number") {
    date = new Date(createdAt.seconds * 1000);
  } else if (createdAt instanceof Date) {
    date = createdAt;
  } else if (typeof createdAt === "number") {
    date = new Date(createdAt);
  } else if (typeof createdAt === "string") {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date || Number.isNaN(date.getTime())) return "";

  return `${date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })} · ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function pinKey(uid) {
  return `pinned_requests_${String(uid || "")}`;
}

function readPins(uid) {
  try {
    const raw = window.localStorage.getItem(pinKey(uid));
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writePins(uid, nextPins) {
  try {
    window.localStorage.setItem(pinKey(uid), JSON.stringify(nextPins));
  } catch {
    // ignore
  }
}

function normalizeSelfHelpKey(item) {
  return `${item.track}::${item.country}::${item.resourceId}`;
}

function buildSelfHelpBookmarkPayload(item, finalUrl) {
  return {
    id: normalizeSelfHelpKey(item),
    resourceId: item.resourceId,
    title: item.title,
    description: item.description,
    category: item.category,
    track: item.track,
    country: item.country,
    routePath: item.routePath || `/app/${item.track}/self-help`,
    routeSearch: item.routeSearch || buildCountrySearch(item.country),
    sectionId: item.sectionId || item.category,
    outboundUrl: item.outboundUrl || finalUrl,
    finalUrl,
    labels: item.labels || [],
    resourceType: item.resourceType,
    linkMode: item.linkMode,
    smartGenerated: Boolean(item.smartGenerated || item.linkMode === "smart"),
    smartParams: item.smartParams || null,
    lastOpenedAt: Number(item.openedAt || item.lastOpenedAt || 0) || 0,
    canOpenDirectly: Boolean(finalUrl),
    providerKey: item.providerKey || "",
    redirectEnabled: item.redirectEnabled !== false,
    affiliateTag: item.affiliateTag || "",
    gatewaySource: item.gatewaySource || "progress-save",
    verifiedStepId: item.verifiedStepId || "",
    verifiedStepTitle: item.verifiedStepTitle || "",
  };
}

function SelfHelpItemRow({
  item,
  isSaved,
  busy,
  showFallback,
  onOpen,
  onToggleSave,
}) {
  const badges = [...(item.labels || []), item.verifiedStepId ? "verified-step" : ""]
    .map((label) => getSelfHelpBadgeMeta(label))
    .filter(Boolean);
  const openUrl = resolveStoredSelfHelpUrl(item);
  const canOpenDirectly = Boolean(openUrl);
  const domain = getResourceDomain(openUrl || item.finalUrl || "");
  const timeLabel = formatRelativeTime(item.openedAt || item.savedAt || item.lastOpenedAt);

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white/75 p-4 dark:border-zinc-800 dark:bg-zinc-900/55">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
              <AppIcon
                size={ICON_SM}
                icon={canOpenDirectly ? ExternalLink : Compass}
              />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {item.title}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {item.track} · {item.country} · {item.category}
              </div>
            </div>
          </div>

          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{item.description}</p>

          {item.verifiedStepTitle ? (
            <div className="mt-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Verified Path: {item.verifiedStepTitle}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            {badges.map((badge) => (
              <span
                key={`${item.resourceId}-${badge.label}`}
                className={`rounded-full border px-2 py-1 font-semibold ${badge.className}`}
              >
                {badge.label}
              </span>
            ))}

            {domain ? <span className="text-zinc-500 dark:text-zinc-400">{domain}</span> : null}
            {timeLabel ? (
              <span className="text-zinc-500 dark:text-zinc-400">{timeLabel}</span>
            ) : null}
          </div>

          {!canOpenDirectly && showFallback ? (
            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              No saved outbound link yet. Continue SelfHelp to reopen this resource from its section.
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onToggleSave(item)}
          disabled={busy}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/75 text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200 dark:hover:border-emerald-900/40 dark:hover:text-emerald-200"
          aria-label={isSaved ? "Remove saved resource" : "Save resource"}
        >
          <AppIcon size={ICON_SM} icon={isSaved ? BookmarkCheck : Bookmark} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpen(item)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100 dark:hover:bg-emerald-950/40"
        >
          {canOpenDirectly ? "Open again" : "Continue"}
          <AppIcon size={ICON_SM} icon={ChevronRight} />
        </button>
      </div>
    </div>
  );
}

const pageIn = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
  },
};

export default function ProgressScreen() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [requests, setRequests] = useState([]);
  const [apps, setApps] = useState([]);
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [pinnedIds, setPinnedIds] = useState([]);
  const [visibleCount, setVisibleCount] = useState(REQUESTS_INITIAL_RENDER);
  const [activeTab, setActiveTab] = useState("wehelp");
  const [selfHelpProgress, setSelfHelpProgress] = useState(null);
  const [selfHelpBusyId, setSelfHelpBusyId] = useState("");
  const [selfHelpMessage, setSelfHelpMessage] = useState("");

  const pinnedIdsRef = useRef([]);
  const stateRef = useRef(null);
  const appsRef = useRef([]);
  const requestsRef = useRef([]);
  const manualTabSelectionRef = useRef(false);

  const unreadNotifCount = useNotifsV2Store((store) => Number(store.unreadNotifCount || 0) || 0);
  const unreadByRequest = useNotifsV2Store((store) => store.unreadByRequest || {});

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

  const activeTrackForBack = useMemo(() => {
    const track = String(state?.activeTrack || "").toLowerCase();
    return track === "study" || track === "work" || track === "travel" ? track : "study";
  }, [state?.activeTrack]);

  const backHref = useMemo(() => `/app/${activeTrackForBack}`, [activeTrackForBack]);

  useEffect(() => {
    try {
      window.history.replaceState({ ...(window.history.state || {}), __majuu_progress: true }, "");
    } catch {
      // ignore
    }

    const onPopState = () => {
      navigate(backHref, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [backHref, navigate]);

  useEffect(() => {
    let unsubRequests = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setErr("");
      const cached = readProgressCache(user.uid);
      if (cached) {
        setState(cached.state || null);
        setRequests(Array.isArray(cached.requests) ? cached.requests : []);
        setApps(Array.isArray(cached.apps) ? cached.apps : []);
        setLoading(false);
      } else {
        setLoading(true);
      }

      setPinnedIds(readPins(user.uid).slice(0, 2));
      setLoading(false);

      const requestQuery = query(collection(db, "serviceRequests"), where("uid", "==", user.uid));
      if (unsubRequests) unsubRequests();

      unsubRequests = onSnapshot(
        requestQuery,
        (snapshot) => {
          const allRows = snapshot.docs.map((docSnap) =>
            normalizeTextDeep({ id: docSnap.id, ...docSnap.data() })
          );
          const hiddenGhostIds = new Set(
            allRows
              .filter((row) => isUnsubmittedGhostRequest(row))
              .map((row) => String(row?.id || "").trim())
              .filter(Boolean)
          );
          const nextRequests = filterVisibleSubmittedRequests(allRows).sort(
            (left, right) => (right.createdAt?.seconds || 0) - (left.createdAt?.seconds || 0)
          );

          setRequests(nextRequests);
          writeProgressCache(user.uid, {
            state: stateRef.current,
            requests: nextRequests,
            apps: appsRef.current,
          });

          const validIds = new Set(nextRequests.map((row) => String(row.id)));
          const filteredPins = (pinnedIdsRef.current || [])
            .filter((id) => validIds.has(String(id)))
            .slice(0, 2);
          if (filteredPins.join("|") !== (pinnedIdsRef.current || []).join("|")) {
            setPinnedIds(filteredPins);
            writePins(user.uid, filteredPins);
          }

          const activeRequestId = String(stateRef.current?.activeRequestId || "").trim();
          if (activeRequestId && hiddenGhostIds.has(activeRequestId)) {
            const nextState = {
              ...(stateRef.current || {}),
              hasActiveProcess: false,
              activeTrack: null,
              activeCountry: null,
              activeHelpType: null,
              activeRequestId: null,
            };

            setState(nextState);
            writeProgressCache(user.uid, {
              state: nextState,
              requests: nextRequests,
              apps: appsRef.current,
            });
            void clearActiveProcess(user.uid);
          }
        },
        (error) => {
          console.error("Realtime requests error:", error);
          setErr(error?.message || "Failed to listen for requests");
        }
      );

      try {
        const [userState, selfHelpState] = await Promise.all([
          getUserState(user.uid),
          getSelfHelpProgress(user.uid),
        ]);

        const normalizedState = normalizeTextDeep(userState);
        setState(normalizedState);
        setSelfHelpProgress(selfHelpState);
        writeProgressCache(user.uid, {
          state: normalizedState,
          requests: cached?.requests || [],
          apps: cached?.apps || [],
        });
        setLoading(false);

        void getMyApplications(user.uid, 25)
          .then((latestApps) => {
            setApps(latestApps);
            writeProgressCache(user.uid, {
              state: stateRef.current,
              requests: requestsRef.current,
              apps: latestApps,
            });
          })
          .catch((appsError) => {
            console.error("Progress apps load failed:", appsError);
          });
      } catch (error) {
        console.error(error);
        setErr(error?.message || "Failed to load progress");
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubRequests) unsubRequests();
    };
  }, [navigate]);

  useEffect(() => {
    if (loading || manualTabSelectionRef.current) return;

    if (requests.length > 0) {
      setActiveTab("wehelp");
      return;
    }

    if (
      String(state?.activeHelpType || "").toLowerCase() === "self" ||
      selfHelpProgress?.history?.length ||
      selfHelpProgress?.bookmarks?.length
    ) {
      setActiveTab("selfhelp");
      return;
    }
    setActiveTab("wehelp");
  }, [
    loading,
    requests.length,
    selfHelpProgress?.bookmarks?.length,
    selfHelpProgress?.history?.length,
    state?.activeHelpType,
  ]);

  const hasActive = Boolean(state?.hasActiveProcess);
  const activeTrack = safeString(state?.activeTrack, 20).toLowerCase();
  const activeCountry = safeString(state?.activeCountry, 80);
  const activeHelpType = safeString(state?.activeHelpType, 20).toLowerCase();

  const requestsCountLabel = useMemo(() => {
    return requests.length === 1 ? "1 request" : `${requests.length} requests`;
  }, [requests.length]);

  const requestsSorted = useMemo(() => {
    const pinSet = new Set((pinnedIds || []).map((item) => String(item)));
    const byId = new Map(requests.map((row) => [String(row.id), row]));
    const pinned = (pinnedIds || []).map((id) => byId.get(String(id))).filter(Boolean);
    const rest = requests.filter((row) => !pinSet.has(String(row.id)));
    return [...pinned, ...rest];
  }, [pinnedIds, requests]);

  useEffect(() => {
    setVisibleCount(REQUESTS_INITIAL_RENDER);
  }, [requestsSorted.length]);

  const visibleRequests = useMemo(
    () => requestsSorted.slice(0, visibleCount),
    [requestsSorted, visibleCount]
  );

  const continueSelfHelpTarget = useMemo(() => {
    const lastContext = selfHelpProgress?.lastContext || {};
    if (lastContext.track && lastContext.country) {
      return buildSelfHelpRouteTarget({
        track: lastContext.track,
        country: lastContext.country,
        sectionId: lastContext.lastExpandedSection,
        stepId: lastContext.currentStepId,
      });
    }

    if (activeHelpType === "self" && activeTrack && activeCountry) {
      return buildSelfHelpRouteTarget({
        track: activeTrack,
        country: activeCountry,
        sectionId: lastContext.lastExpandedSection || "",
        stepId: lastContext.currentStepId || "",
      });
    }

    return null;
  }, [activeCountry, activeHelpType, activeTrack, selfHelpProgress?.lastContext]);

  const recentSelfHelp = useMemo(() => {
    return Array.isArray(selfHelpProgress?.history) ? selfHelpProgress.history.slice(0, 6) : [];
  }, [selfHelpProgress?.history]);

  const savedSelfHelp = useMemo(() => {
    return Array.isArray(selfHelpProgress?.bookmarks) ? selfHelpProgress.bookmarks.slice(0, 6) : [];
  }, [selfHelpProgress?.bookmarks]);

  const savedKeySet = useMemo(() => {
    return new Set(
      (Array.isArray(selfHelpProgress?.bookmarks) ? selfHelpProgress.bookmarks : []).map((item) =>
        normalizeSelfHelpKey(item)
      )
    );
  }, [selfHelpProgress?.bookmarks]);

  const lastContext = selfHelpProgress?.lastContext || null;
  const lastSelfHelpRouteState = useMemo(
    () =>
      getSelfHelpRouteState(
        selfHelpProgress,
        lastContext?.track || activeTrack,
        lastContext?.country || activeCountry
      ),
    [activeCountry, activeTrack, lastContext?.country, lastContext?.track, selfHelpProgress]
  );

  const lastVerifiedSteps = useMemo(
    () => {
      const routeTrack = lastContext?.track || activeTrack;
      const routeCountry = lastContext?.country || activeCountry;
      if (!routeTrack || !routeCountry) return [];
      return getVerifiedPathForRoute(routeTrack, routeCountry);
    },
    [activeCountry, activeTrack, lastContext?.country, lastContext?.track]
  );

  const verifiedSummary = useMemo(
    () =>
      getVerifiedProgressSummary(
        lastVerifiedSteps,
        lastSelfHelpRouteState?.completedStepIds || lastContext?.completedStepIds || []
      ),
    [lastContext?.completedStepIds, lastSelfHelpRouteState?.completedStepIds, lastVerifiedSteps]
  );

  const currentVerifiedStep = useMemo(
    () =>
      getNextVerifiedStep(
        lastVerifiedSteps,
        lastSelfHelpRouteState?.completedStepIds || lastContext?.completedStepIds || [],
        lastSelfHelpRouteState?.currentStepId || lastContext?.currentStepId || ""
      ),
    [
      lastContext?.completedStepIds,
      lastContext?.currentStepId,
      lastSelfHelpRouteState?.completedStepIds,
      lastSelfHelpRouteState?.currentStepId,
      lastVerifiedSteps,
    ]
  );

  const goToContinueSelfHelp = () => {
    if (!continueSelfHelpTarget) return;
    navigate(`${continueSelfHelpTarget.path}${continueSelfHelpTarget.search}`, {
      replace: true,
      state: continueSelfHelpTarget.state,
    });
  };

  const goContinue = async () => {
    if (activeHelpType === "self" && continueSelfHelpTarget) {
      goToContinueSelfHelp();
      return;
    }

    const resumeTarget = await getResumeTarget();
    if (resumeTarget?.path) {
      const resumedRequestId = extractRequestIdFromAppPath(resumeTarget.path);
      const isVisibleRequest =
        resumedRequestId &&
        requestsRef.current.some((row) => String(row?.id || "").trim() === resumedRequestId);

      if (!resumedRequestId || isVisibleRequest) {
        navigate(`${resumeTarget.path}${resumeTarget.search || ""}`, {
          replace: true,
          state: resumeTarget.state,
        });
        return;
      }
    }

    const requestId = safeString(state?.activeRequestId, 80);
    if (activeHelpType === "we" && requestId) {
      navigate(`/app/request/${requestId}`, { replace: true });
      return;
    }

    if (activeTrack) {
      navigate(`/app/${activeTrack}`, { replace: true });
      return;
    }

    navigate("/dashboard", { replace: true });
  };

  const togglePin = (requestId) => {
    const user = auth.currentUser;
    if (!user) return;

    const id = String(requestId || "");
    setPinnedIds((current) => {
      const nextCurrent = Array.isArray(current) ? current.map(String) : [];
      const exists = nextCurrent.includes(id);
      let next = nextCurrent;

      if (exists) {
        next = nextCurrent.filter((entry) => entry !== id);
      } else if (nextCurrent.length < 2) {
        next = [...nextCurrent, id];
      }

      writePins(user.uid, next);
      return next;
    });
  };

  const openStoredSelfHelpItem = async (item, allowContinueFallback) => {
    const finalUrl = resolveStoredSelfHelpUrl(item);
    if (!finalUrl) {
      if (allowContinueFallback) {
        const target = buildSelfHelpRouteTarget({
          track: item.track,
          country: item.country,
          sectionId: item.sectionId || item.category,
          stepId: item.verifiedStepId || "",
        });

        if (target) {
          navigate(`${target.path}${target.search}`, {
            replace: true,
            state: target.state,
          });
          return;
        }
      }

      setSelfHelpMessage("This resource needs fresh details before it can reopen directly.");
      return;
    }

    setSelfHelpMessage("");
    setSelfHelpBusyId(normalizeSelfHelpKey(item));
    try {
      const user = auth.currentUser;
      const result = await reopenStoredSelfHelpGateway({
        uid: user?.uid || "",
        item,
        gatewaySource: "progress-selfhelp",
      });

      if (!result.ok) {
        setSelfHelpMessage(result.errorMessage || "We could not reopen that resource right now.");
        return;
      }

      if (result.progress) {
        const next = result.progress;
        setSelfHelpProgress(next);
      }
    } catch (error) {
      console.error("SelfHelp reopen failed:", error);
      setSelfHelpMessage("We could not reopen that resource right now.");
    } finally {
      setSelfHelpBusyId("");
    }
  };

  const toggleSavedSelfHelpItem = async (item) => {
    const user = auth.currentUser;
    if (!user?.uid) return;

    setSelfHelpBusyId(`save:${normalizeSelfHelpKey(item)}`);
    try {
      const next = await toggleSelfHelpBookmark(
        user.uid,
        buildSelfHelpBookmarkPayload(item, resolveStoredSelfHelpUrl(item))
      );
      setSelfHelpProgress(next);
    } catch (error) {
      console.error("SelfHelp save toggle failed:", error);
      setSelfHelpMessage("We could not update that saved resource right now.");
    } finally {
      setSelfHelpBusyId("");
    }
  };

  async function deleteRequestDeep(requestId) {
    const attachmentRef = collection(db, "serviceRequests", requestId, "attachments");
    const attachmentSnap = await getDocs(attachmentRef);
    for (const attachment of attachmentSnap.docs) {
      await deleteDoc(doc(db, "serviceRequests", requestId, "attachments", attachment.id));
    }
    await deleteDoc(doc(db, "serviceRequests", requestId));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="mx-auto max-w-xl px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading progress...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const cardBase =
    "rounded-3xl border border-zinc-200/80 bg-white/75 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55";
  const primaryBtn =
    "rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700";
  const ghostBtn =
    "rounded-2xl border border-zinc-200 bg-white/70 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-800";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <Motion.div
          className="mx-auto max-w-3xl px-5 py-6"
          variants={pageIn}
          initial="hidden"
          animate="show"
        >
          <div className="mb-3">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Progress
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Track your active work and reopen what matters quickly.
            </p>
          </div>

          <div className={`${cardBase} mt-3`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Current process
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {hasActive ? "Live" : "Idle"}
              </span>
            </div>

            {hasActive ? (
              <div className="mt-3 grid gap-2">
                <div className="grid gap-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Track</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {activeTrack || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Country</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {activeCountry || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Mode</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {activeHelpType === "we" ? "We-Help" : "Self-Help"}
                    </span>
                  </div>
                </div>

                <button type="button" onClick={goContinue} className={primaryBtn}>
                  {activeHelpType === "self" ? "Continue SelfHelp" : "Continue"}
                </button>
              </div>
            ) : (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                No active process yet. Choose a track to begin.
                <div className="mt-3">
                  <button type="button" onClick={() => navigate("/dashboard")} className={ghostBtn}>
                    Choose track
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => navigate("/app/notifications")}
              className="flex w-full items-center justify-between gap-3 rounded-3xl border border-zinc-200/70 bg-white/70 p-4 text-left shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/45 dark:hover:bg-zinc-900/60"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-emerald-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <AppIcon size={ICON_MD} icon={Bell} />
                </span>

                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Notifications
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {unreadNotifCount ? "Tap to view new updates" : "Tap to view history"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {unreadNotifCount ? (
                  <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-rose-600 px-2 text-[11px] font-semibold text-white">
                    {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
                  </span>
                ) : (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    All caught up
                  </span>
                )}
                <AppIcon size={ICON_SM} icon={ChevronRight} className="text-zinc-400 dark:text-zinc-500" />
              </div>
            </button>
          </div>

          {err ? (
            <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          <div className="mt-6 flex justify-center">
            <div className="inline-flex rounded-full border border-zinc-200 bg-white/80 p-1 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
              <button
                type="button"
                onClick={() => {
                  manualTabSelectionRef.current = true;
                  setActiveTab("wehelp");
                }}
                className={`rounded-full px-4 py-2 font-semibold transition ${
                  activeTab === "wehelp"
                    ? "bg-emerald-600 text-white"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                WeHelp
              </button>
              <button
                type="button"
                onClick={() => {
                  manualTabSelectionRef.current = true;
                  setActiveTab("selfhelp");
                }}
                className={`rounded-full px-4 py-2 font-semibold transition ${
                  activeTab === "selfhelp"
                    ? "bg-emerald-600 text-white"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                SelfHelp
              </button>
            </div>
          </div>

          <Motion.div
            key={`progress-tab-${activeTab}`}
            className="mt-6"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {activeTab === "wehelp" ? (
              <div>
              <div className="flex items-end justify-between">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                  We-Help requests
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {requestsCountLabel}
                </span>
              </div>

              {requests.length === 0 ? (
                <div className={`${cardBase} mt-3`}>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    No requests yet
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    When you submit a We-Help request, it will show up here.
                  </div>
                  <div className="mt-4">
                    <button type="button" onClick={() => navigate("/dashboard")} className={ghostBtn}>
                      Start a request
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {visibleRequests.map((request) => {
                    const ui = statusUI(request.status);
                    const track = safeString(request.track, 20).toLowerCase();
                    const safeTrack = track === "work" || track === "travel" ? track : "study";
                    const status = safeString(request.status, 30).toLowerCase();
                    const canDelete = status === "closed" || status === "rejected";
                    const isDeleting = deletingId === request.id;
                    const isFull =
                      Boolean(request.isFullPackage) ||
                      safeString(request.requestType, 20).toLowerCase() === "full";
                    const fullPackageId = safeString(
                      request.fullPackageId || request.fullPackage?.fullPackageId || request.fullPackage?.id,
                      80
                    );
                    const isLinkedFullPackage = Boolean(request.isFullPackage) && Boolean(fullPackageId);
                    const createdLabel = formatCreatedAt(request.createdAt);
                    const requestId = String(request.id || "");
                    const hasUnread = Boolean(unreadByRequest?.[requestId]?.unread);
                    const isPinned = (pinnedIds || []).includes(requestId);

                    const handleTryAgain = () => {
                      const country = request.country || "Not selected";
                      const countryQS = encodeURIComponent(country);

                      if (isLinkedFullPackage) {
                        const missingItems = Array.isArray(request.fullPackageSelectedItems)
                          ? request.fullPackageSelectedItems
                          : Array.isArray(request.missingItems)
                            ? request.missingItems
                            : parseMissingItemsFromNote(request.note);
                        const fallbackItem =
                          safeString(request.fullPackageItem, 120) ||
                          safeString(missingItems?.[0], 120) ||
                          "Document checklist";
                        const retryItemKey = safeString(
                          request.fullPackageItemKey || toFullPackageItemKey(fallbackItem),
                          140
                        );
                        const hubPath = buildFullPackageHubPath({
                          fullPackageId,
                          track: safeTrack,
                        });

                        if (hubPath) {
                          const params = new URLSearchParams();
                          if (country && country !== "Not selected") params.set("country", country);
                          params.set("track", safeTrack);
                          params.set("autoOpen", "1");
                          if (retryItemKey) params.set("retryItemKey", retryItemKey);
                          if (fallbackItem) params.set("item", fallbackItem);
                          const suffix = params.toString();

                          navigate(suffix ? `${hubPath}&${suffix}` : hubPath, {
                            state: { fullPackageId, missingItems },
                          });
                          return;
                        }
                      }

                      if (isFull) {
                        let missingItems = Array.isArray(request.missingItems) ? request.missingItems : [];
                        if (!missingItems.length) missingItems = parseMissingItemsFromNote(request.note);

                        try {
                          window.sessionStorage.setItem(
                            `fp_missing_${safeTrack}`,
                            JSON.stringify(missingItems)
                          );
                        } catch {
                          // ignore
                        }

                        const picked =
                          safeString(request.fullPackageItem, 120) ||
                          safeString(missingItems?.[0], 120) ||
                          "Document checklist";

                        navigate(
                          `/app/full-package/${safeTrack}?country=${countryQS}&parentRequestId=${encodeURIComponent(
                            String(request.id || "")
                          )}&autoOpen=1&item=${encodeURIComponent(picked)}`,
                          { state: { missingItems } }
                        );
                        return;
                      }

                      navigate(
                        `/app/${safeTrack}/we-help?country=${countryQS}&autoOpen=1&open=${encodeURIComponent(
                          safeString(request.serviceName, 120)
                        )}`
                      );
                    };

                    return (
                      <div
                        key={request.id}
                        className={`${cardBase} relative overflow-hidden ${
                          isFull
                            ? "border-emerald-300/80 bg-emerald-50/45 dark:border-emerald-800/60 dark:bg-emerald-950/20"
                            : ""
                        }`}
                      >
                        {isFull || hasUnread ? (
                          <span
                            className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-3xl ${
                              isFull
                                ? "bg-emerald-500/80 dark:bg-emerald-400/70"
                                : "bg-rose-600/80"
                            }`}
                          />
                        ) : null}

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full ${ui.dot}`} />
                              <div className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                                {String(request.track || "").toUpperCase()} · {request.country || "-"}
                              </div>
                              {hasUnread ? (
                                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-600 shadow-[0_0_0_3px_rgba(244,63,94,0.12)]" />
                              ) : null}
                            </div>

                            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                              {isFull ? "Full package" : `Single: ${request.serviceName || "-"}`}
                            </div>

                            {isFull ? (
                              <div className="mt-2">
                                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/35 dark:text-emerald-200">
                                  Full package
                                </span>
                              </div>
                            ) : null}

                            {createdLabel ? (
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
                            type="button"
                            onClick={() => navigate(`/app/request/${requestId}`)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100 dark:hover:bg-emerald-950/40"
                          >
                            View
                            <AppIcon size={ICON_SM} icon={ChevronRight} />
                          </button>

                          {status === "rejected" ? (
                            <button type="button" onClick={handleTryAgain} className={ghostBtn}>
                              Try again
                            </button>
                          ) : null}

                          {canDelete ? (
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={async () => {
                                const confirmed = window.confirm("Delete this request? This cannot be undone.");
                                if (!confirmed) return;

                                setDeletingId(request.id);
                                setErr("");

                                try {
                                  await deleteRequestDeep(request.id);
                                  const user = auth.currentUser;
                                  if (user) {
                                    setPinnedIds((current) => {
                                      const next = (current || [])
                                        .filter((entry) => String(entry) !== requestId)
                                        .slice(0, 2);
                                      writePins(user.uid, next);
                                      return next;
                                    });
                                  }
                                } catch (error) {
                                  console.error("Delete request failed:", error);
                                  setErr(error?.message || "Failed to delete request.");
                                } finally {
                                  setDeletingId("");
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-950/45"
                            >
                              <AppIcon size={ICON_SM} icon={Trash2} />
                              {isDeleting ? "Deleting..." : "Delete"}
                            </button>
                          ) : null}
                        </div>

                        {status === "new" ? (
                          <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                            Received - you will see updates here as we process it.
                          </div>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => togglePin(requestId)}
                          title={isPinned ? "Unpin" : pinnedIds.length >= 2 ? "Pin limit reached" : "Pin"}
                          aria-label={isPinned ? "Unpin request" : "Pin request"}
                          disabled={!isPinned && pinnedIds.length >= 2}
                          className={`absolute bottom-3 right-3 inline-flex items-center justify-center rounded-2xl border p-2 transition disabled:opacity-50 ${
                            isPinned
                              ? "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                              : "border-zinc-200 bg-white/70 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200 dark:hover:border-emerald-900/40"
                          }`}
                        >
                          <AppIcon size={ICON_SM} icon={isPinned ? PinOff : Pin} />
                        </button>
                      </div>
                    );
                  })}

                  {visibleCount < requestsSorted.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleCount((current) => current + REQUESTS_INITIAL_RENDER)}
                      className="mx-auto text-sm font-semibold text-emerald-700 transition hover:opacity-80 dark:text-emerald-300"
                    >
                      See more...
                    </button>
                  ) : null}
                </div>
              )}
              </div>
            ) : (
              <div className="grid gap-4">
              <div className={cardBase}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      SelfHelp memory
                    </h2>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Recent resources reopen directly. Continue SelfHelp takes you back into browsing.
                    </p>
                  </div>

                  {continueSelfHelpTarget ? (
                    <button type="button" onClick={goToContinueSelfHelp} className={primaryBtn}>
                      Continue SelfHelp
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Last track</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {lastContext?.track || activeTrack || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Destination</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {lastContext?.country || activeCountry || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Last section</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {lastContext?.lastExpandedSection || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Current step</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {currentVerifiedStep?.title || lastContext?.currentStepTitle || "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Verified progress</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {verifiedSummary.totalCount
                        ? `${verifiedSummary.completedCount}/${verifiedSummary.totalCount}`
                        : "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">Last opened</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {formatCreatedAt(lastContext?.lastVisitedAt) || "-"}
                    </span>
                  </div>
                </div>
              </div>

              {selfHelpMessage ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                  {selfHelpMessage}
                </div>
              ) : null}

              {savedSelfHelp.length ? (
                <div>
                  <div className="flex items-end justify-between">
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Saved resources</h3>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {savedSelfHelp.length} saved
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3">
                    {savedSelfHelp.map((item) => (
                      <SelfHelpItemRow
                        key={`saved-${item.id}`}
                        item={item}
                        isSaved
                        busy={Boolean(selfHelpBusyId)}
                        showFallback
                        onOpen={(nextItem) => void openStoredSelfHelpItem(nextItem, true)}
                        onToggleSave={(nextItem) => void toggleSavedSelfHelpItem(nextItem)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {recentSelfHelp.length ? (
                <div>
                  <div className="flex items-end justify-between">
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Recent resources</h3>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {recentSelfHelp.length} recent
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3">
                    {recentSelfHelp.map((item) => (
                      <SelfHelpItemRow
                        key={`recent-${item.id}`}
                        item={item}
                        isSaved={savedKeySet.has(normalizeSelfHelpKey(item))}
                        busy={Boolean(selfHelpBusyId)}
                        showFallback={false}
                        onOpen={(nextItem) => void openStoredSelfHelpItem(nextItem, false)}
                        onToggleSave={(nextItem) => void toggleSavedSelfHelpItem(nextItem)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {!savedSelfHelp.length && !recentSelfHelp.length ? (
                <div className={cardBase}>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    No SelfHelp activity yet
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Open resources from a SelfHelp screen and they will appear here for quick direct reopen.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {continueSelfHelpTarget ? (
                      <button type="button" onClick={goToContinueSelfHelp} className={primaryBtn}>
                        Continue SelfHelp
                      </button>
                    ) : (
                      <button type="button" onClick={() => navigate("/dashboard")} className={ghostBtn}>
                        Choose track
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
              </div>
            )}
          </Motion.div>
        </Motion.div>
      </div>
    </div>
  );
}

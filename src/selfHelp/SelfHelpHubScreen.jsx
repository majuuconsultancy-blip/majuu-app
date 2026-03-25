import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Briefcase,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  DollarSign,
  ExternalLink,
  FileText,
  GraduationCap,
  ListChecks,
  Plane,
  ShieldCheck,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { auth } from "../firebase";
import {
  getSelfHelpSectionsFromList,
  SELF_HELP_TRACK_META,
} from "./selfHelpCatalog";
import SmartStayDialog from "./SmartStayDialog";
import { openSelfHelpResourceGateway } from "./selfHelpGateway";
import {
  buildMoneyToolsRouteTarget,
  buildSelfHelpDocumentsRouteTarget,
  buildSelfHelpRouteTarget,
  buildSmartPromptFields,
  getInitialSmartPromptValues,
  getResourceDomain,
  getSelfHelpBadges,
  requiresSmartPrompt,
  resolveSelfHelpResourceUrl,
  sanitizeSmartParams,
} from "./selfHelpLinking";
import {
  getNextVerifiedStep,
  getVerifiedPathForRoute,
  getVerifiedProgressSummary,
} from "./selfHelpPaths";
import JourneyChecklistSheet from "./JourneyChecklistSheet";
import JourneyBanner from "../components/JourneyBanner";
import { useUserJourney } from "../hooks/useUserJourney";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { logAnalyticsEvent } from "../services/analyticsService";
import {
  cacheSelfHelpProgress,
  getSelfHelpProgress,
  getSelfHelpRouteState,
  peekSelfHelpProgress,
  previewSelfHelpChecklistProgress,
  saveSelfHelpChecklist,
  toggleSelfHelpBookmark,
  toggleSelfHelpStepCompletion,
} from "./selfHelpProgressStore";
import {
  mergeSelfHelpRuntimeResources,
  subscribeRuntimeSelfHelpResources,
} from "../services/selfHelpResourceService";

const TRACK_ICONS = {
  study: GraduationCap,
  work: Briefcase,
  travel: Plane,
};
const CLOSED_SECTION_ID = "__collapsed__";

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

function buildRouteSearch(country) {
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  return params.toString() ? `?${params.toString()}` : "";
}

function buildSelfHelpUiStateKey({ uid, track, country }) {
  const safeUid = safeString(uid, 120);
  const safeTrack = safeString(track, 20).toLowerCase();
  const safeCountry = safeString(country, 80).toLowerCase();
  if (!safeUid || !safeTrack || !safeCountry) return "";
  return `majuu:selfhelp:ui:${safeUid}:${safeTrack}:${safeCountry}`;
}

function getLatestByResource(history) {
  const map = new Map();
  for (const item of history) {
    if (!map.has(item.resourceId)) {
      map.set(item.resourceId, item);
    }
  }
  return map;
}

function ResourceRow({
  resource,
  visitedEntry,
  isSaved,
  opening,
  saving,
  extraLabels,
  onOpen,
  onToggleSave,
}) {
  const badges = getSelfHelpBadges(resource, extraLabels);
  const visitedLabel = visitedEntry?.openedAt ? formatRelativeTime(visitedEntry.openedAt) : "";
  const domain = getResourceDomain(visitedEntry?.finalUrl || resource.baseUrl);
  const labels = Array.isArray(extraLabels) ? extraLabels : [];
  const accentClass = labels.includes("verified-step")
    ? "border-emerald-200/80 bg-emerald-50/55 dark:border-emerald-900/35 dark:bg-emerald-950/15"
    : resource.labels?.includes("featured")
      ? "border-amber-200/80 bg-amber-50/40 dark:border-amber-900/30 dark:bg-amber-950/10"
      : resource.labels?.includes("official")
        ? "border-emerald-200/70 bg-emerald-50/30 dark:border-emerald-900/30 dark:bg-emerald-950/10"
        : "border-zinc-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/55";

  return (
    <button
      type="button"
      onClick={() => onOpen(resource)}
      className={`group flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-[1px] hover:shadow-sm ${accentClass}`}
    >
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">
        <AppIcon size={ICON_MD} icon={resource.linkMode === "smart" ? ShieldCheck : ExternalLink} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {resource.title}
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {resource.description}
            </p>
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSave(resource);
            }}
            disabled={saving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/75 text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200 dark:hover:border-emerald-900/40 dark:hover:text-emerald-200"
            aria-label={isSaved ? "Remove bookmark" : "Save resource"}
          >
            <AppIcon size={ICON_SM} icon={isSaved ? BookmarkCheck : Bookmark} />
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {badges.map((badge) => (
            <span
              key={`${resource.id}-${badge.label}`}
              className={`rounded-full border px-2 py-1 font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
          ))}

          {visitedEntry ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon size={ICON_SM} icon={CircleCheck} />
              Opened {visitedLabel || "before"}
            </span>
          ) : null}

          {domain ? <span className="text-zinc-500 dark:text-zinc-400">{domain}</span> : null}
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>{opening ? "Opening..." : resource.linkMode === "smart" ? "Smart open" : "Open resource"}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-zinc-700 dark:text-zinc-200">
            Open
            <AppIcon size={ICON_SM} icon={ChevronRight} />
          </span>
        </div>
      </div>
    </button>
  );
}

function VerifiedStepRow({
  step,
  completed,
  active,
  onToggleComplete,
  onSelect,
}) {
  const containerClass = completed
    ? "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/35 dark:bg-emerald-950/18"
    : active
      ? "border-emerald-200/80 bg-emerald-50/45 dark:border-emerald-900/35 dark:bg-emerald-950/16"
      : "border-zinc-200/80 bg-white/80 dark:border-zinc-800 dark:bg-zinc-900/55";

  return (
    <div className={`rounded-2xl border px-4 py-3 transition ${containerClass}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggleComplete(step)}
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-sm font-semibold transition ${
            completed
              ? "border-emerald-200 bg-emerald-600 text-white dark:border-emerald-900/40"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200"
          }`}
          aria-label={completed ? `Mark ${step.title} incomplete` : `Mark ${step.title} complete`}
        >
          {completed ? <AppIcon size={ICON_SM} icon={CircleCheck} /> : step.stepNumber}
        </button>

        <button type="button" onClick={() => onSelect(step)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{step.title}</div>
            {active ? (
              <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                Next step
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {completed ? "Completed" : step.categoryId}
          </div>
        </button>

        <button
          type="button"
          onClick={() => onSelect(step)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/75 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-200 dark:hover:bg-zinc-900"
          aria-label={`Browse ${step.title}`}
        >
          <AppIcon size={ICON_SM} icon={ChevronRight} />
        </button>
      </div>
    </div>
  );
}

function ProgressStrip({ percent, completedCount, totalCount, nextStepTitle }) {
  return (
    <div className="mt-3 border-t border-zinc-200/70 pt-3 dark:border-zinc-800/70">
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>

      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
        Journey progress · {completedCount}/{totalCount} confirmed
      </div>
      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
        Next step: {totalCount > completedCount ? nextStepTitle || "Check your checklist" : "Checklist complete"}
      </div>
    </div>
  );
}

export default function SelfHelpHubScreen({ track }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { journey } = useUserJourney();
  const requestedCountry = safeString(new URLSearchParams(location.search).get("country"), 80);
  const trackMeta = SELF_HELP_TRACK_META[track] || SELF_HELP_TRACK_META.study;
  const HeaderIcon = TRACK_ICONS[track] || GraduationCap;
  const [uid, setUid] = useState("");
  const [progress, setProgress] = useState(null);
  const [resourceRecords, setResourceRecords] = useState([]);
  const [manualSectionId, setManualSectionId] = useState("");
  const [manualStepId, setManualStepId] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [savingId, setSavingId] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [promptState, setPromptState] = useState(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [verifiedPathOpen, setVerifiedPathOpen] = useState(false);

  const lastOpenedKeyRef = useRef("");
  const uiStateRestoredRef = useRef("");

  const fallbackCountry = useMemo(() => {
    const lastContextCountry =
      safeString(progress?.lastContext?.track, 20).toLowerCase() === track
        ? safeString(progress?.lastContext?.country, 80)
        : "";

    if (lastContextCountry) return lastContextCountry;

    return (
      (Array.isArray(progress?.routeStates) ? progress.routeStates : []).find(
        (item) =>
          safeString(item?.track, 20).toLowerCase() === track &&
          safeString(item?.country, 80)
      )?.country || ""
    );
  }, [progress?.lastContext?.country, progress?.lastContext?.track, progress?.routeStates, track]);

  const country = requestedCountry || fallbackCountry;
  const uiStateKey = useMemo(
    () => buildSelfHelpUiStateKey({ uid, track, country }),
    [country, track, uid]
  );

  useEffect(() => {
    if (!uid) return;
    const safeTrack = safeString(track, 20).toLowerCase();
    const safeCountry = safeString(country, 80);
    if (!safeTrack || !safeCountry) return;

    const key = `${safeTrack}:${safeCountry}`;
    if (lastOpenedKeyRef.current === key) return;
    lastOpenedKeyRef.current = key;

    void logAnalyticsEvent({
      uid,
      eventType: ANALYTICS_EVENT_TYPES.SELFHELP_OPENED,
      trackType: safeTrack,
      country: safeCountry,
      sourceScreen: "SelfHelpHubScreen",
    });
  }, [country, track, uid]);

  const runtimeResources = useMemo(
    () => mergeSelfHelpRuntimeResources(resourceRecords),
    [resourceRecords]
  );

  const sections = useMemo(
    () => getSelfHelpSectionsFromList(track, country, runtimeResources),
    [country, runtimeResources, track]
  );
  const routeState = useMemo(
    () => getSelfHelpRouteState(progress, track, country),
    [country, progress, track]
  );
  const verifiedSteps = useMemo(
    () => getVerifiedPathForRoute(track, country, { resources: runtimeResources }),
    [country, runtimeResources, track]
  );

  const history = Array.isArray(progress?.history) ? progress.history : [];
  const bookmarks = Array.isArray(progress?.bookmarks) ? progress.bookmarks : [];
  const contextHistory = history.filter((item) => item.track === track && item.country === country);
  const contextBookmarks = bookmarks.filter((item) => item.track === track && item.country === country);

  const latestByResource = useMemo(() => getLatestByResource(contextHistory), [contextHistory]);
  const savedByResource = useMemo(() => {
    const map = new Map();
    for (const bookmark of contextBookmarks) {
      map.set(bookmark.resourceId, bookmark);
    }
    return map;
  }, [contextBookmarks]);

  const completedStepIds = useMemo(
    () => routeState?.completedStepIds || [],
    [routeState?.completedStepIds]
  );
  const completedStepKey = completedStepIds.join("|");
  const nextActionStep = useMemo(
    () => getNextVerifiedStep(verifiedSteps, completedStepIds),
    [completedStepIds, verifiedSteps]
  );
  const restoredStepId = safeString(location.state?.restoreSelfHelp?.stepId, 60);
  const focusedStep = useMemo(
    () =>
      getNextVerifiedStep(
        verifiedSteps,
        completedStepIds,
        manualStepId || restoredStepId || routeState?.currentStepId || nextActionStep?.id || ""
      ),
    [
      completedStepIds,
      manualStepId,
      nextActionStep?.id,
      restoredStepId,
      routeState?.currentStepId,
      verifiedSteps,
    ]
  );

  const restoredSectionId = safeString(location.state?.restoreSelfHelp?.sectionId, 40);
  const expandedSectionId = useMemo(() => {
    if (manualSectionId === CLOSED_SECTION_ID) {
      return "";
    }

    if (manualSectionId && sections.some((section) => section.id === manualSectionId)) {
      return manualSectionId;
    }

    if (restoredSectionId && sections.some((section) => section.id === restoredSectionId)) {
      return restoredSectionId;
    }

    return "";
  }, [manualSectionId, restoredSectionId, sections]);

  const currentStepResourceIds = useMemo(
    () => new Set(Array.isArray(focusedStep?.resourceIds) ? focusedStep.resourceIds : []),
    [focusedStep?.resourceIds]
  );

  const verifiedSummary = useMemo(
    () => getVerifiedProgressSummary(verifiedSteps, completedStepIds),
    [completedStepIds, verifiedSteps]
  );

  const latestContextEntry = contextHistory[0] || null;
  const resourceCount = sections.reduce((total, section) => total + section.resources.length, 0);

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setProgress(peekSelfHelpProgress(user.uid));
      setChecklistSaving(false);

      try {
        const nextProgress = await getSelfHelpProgress(user.uid);
        if (!active) return;
        setProgress(nextProgress);
      } catch (error) {
        console.error("SelfHelp load failed:", error);
        if (active) setStatusMsg("We could not load your latest SelfHelp memory right now.");
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [navigate]);

  useEffect(() => {
    if (requestedCountry || !fallbackCountry) return;
    navigate(`/app/${track}/self-help?country=${encodeURIComponent(fallbackCountry)}`, {
      replace: true,
      state: location.state,
    });
  }, [fallbackCountry, location.state, navigate, requestedCountry, track]);

  useEffect(() => {
    if (!uiStateKey) return;
    if (uiStateRestoredRef.current === uiStateKey) return;
    if (typeof window === "undefined") return;

    uiStateRestoredRef.current = uiStateKey;
    try {
      const raw =
        window.sessionStorage.getItem(uiStateKey) ||
        window.localStorage.getItem(uiStateKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const restoredSection = safeString(parsed?.sectionId, 40);
      if (restoredSection === CLOSED_SECTION_ID) {
        setManualSectionId(CLOSED_SECTION_ID);
        return;
      }
      if (restoredSection) {
        setManualSectionId(restoredSection);
      }
    } catch (error) {
      console.warn("SelfHelp ui state restore skipped:", error);
    }
  }, [uiStateKey]);

  useEffect(() => {
    if (!uiStateKey) return;
    if (typeof window === "undefined") return;

    const payload = JSON.stringify({
      sectionId: safeString(manualSectionId, 40) || "",
    });
    try {
      window.sessionStorage.setItem(uiStateKey, payload);
    } catch (error) {
      console.warn("SelfHelp ui state cache skipped:", error);
    }
  }, [manualSectionId, uiStateKey]);

  useEffect(() => {
    if (!uid) return undefined;

    return subscribeRuntimeSelfHelpResources({
      onData: (rows) => {
        setResourceRecords(rows);
      },
      onError: (error) => {
        console.error("SelfHelp resources load failed:", error);
      },
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;

    let disposed = false;
    let wasBackground = false;
    let removeListener = null;

    const refreshAfterReturn = async () => {
      if (disposed || !wasBackground) return;
      wasBackground = false;
      setOpeningId("");
      setPromptState(null);
      setChecklistSaving(false);
      setChecklistOpen(false);
      setVerifiedPathOpen(false);

      try {
        const nextProgress = await getSelfHelpProgress(uid);
        if (!disposed) setProgress(nextProgress);
      } catch (error) {
        console.error("SelfHelp resume refresh failed:", error);
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        wasBackground = true;
        return;
      }
      void refreshAfterReturn();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) {
        wasBackground = true;
        return;
      }
      void refreshAfterReturn();
    }).then((listener) => {
      if (disposed) {
        listener.remove();
        return;
      }
      removeListener = () => listener.remove();
    });

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (removeListener) removeListener();
    };
  }, [uid]);

  const goBack = () => {
    const backTarget = country
      ? `/app/${track}?country=${encodeURIComponent(country)}&from=choice`
      : `/app/${track}`;
    navigate(backTarget, { replace: true });
  };

  const openMoneyTools = () => {
    const target = buildMoneyToolsRouteTarget({ track, country, tab: "currency" });
    if (!target?.path) return;
    navigate(`${target.path}${target.search || ""}`);
  };

  const openChecklist = () => {
    setChecklistSaving(false);
    setChecklistOpen(true);
  };

  const closeChecklist = () => {
    setChecklistOpen(false);
  };

  const openDocuments = (options = {}) => {
    const target = buildSelfHelpDocumentsRouteTarget({
      track,
      country,
      stepId: safeString(options.stepId, 80),
      categoryId: safeString(options.categoryId, 40),
      create: Boolean(options.create),
    });
    if (!target?.path) return;
    navigate(`${target.path}${target.search || ""}`);
  };

  const continueTarget = buildSelfHelpRouteTarget({
    track,
    country,
    sectionId: expandedSectionId,
    stepId: focusedStep?.id || nextActionStep?.id || "",
  });

  const openResource = async (resource, rawSmartParams = null, overrides = {}) => {
    const smartParams =
      resource.linkMode === "smart" ? sanitizeSmartParams(resource, rawSmartParams) : null;
    const matchedStep =
      verifiedSteps.find((step) => step.resourceIds.includes(resource.id)) || focusedStep || nextActionStep || null;

    setStatusMsg("");
    setOpeningId(resource.id);

    try {
      const result = await openSelfHelpResourceGateway({
        uid,
        resource,
        track,
        country,
        routePath: `/app/${track}/self-help`,
        routeSearch: buildRouteSearch(country),
        sectionId: overrides.sectionId || expandedSectionId || resource.category,
        smartParams,
        verifiedStepId: safeString(overrides.stepId, 80) || matchedStep?.id || "",
        verifiedStepTitle: safeString(overrides.stepTitle, 160) || matchedStep?.title || "",
        gatewaySource: "selfhelp-hub",
      });

      if (!result.ok) {
        setStatusMsg(result.errorMessage || "We could not open that resource right now.");
      } else if (result.progress) {
        setProgress(result.progress);
      }
    } catch (error) {
      console.error("SelfHelp resource open failed:", error);
      setStatusMsg("We could not open that resource right now.");
    } finally {
      setOpeningId("");
      setPromptState(null);
    }
  };

  const handleOpen = (resource) => {
    const matchedStep =
      verifiedSteps.find((step) => step.resourceIds.includes(resource.id)) || focusedStep || nextActionStep || null;

    if (requiresSmartPrompt(resource)) {
      setPromptState({
        resource,
        fields: buildSmartPromptFields(resource, track, country),
        initialValues: getInitialSmartPromptValues(
          resource,
          track,
          country,
          latestByResource.get(resource.id)
        ),
        sectionId: expandedSectionId || resource.category,
        stepId: matchedStep?.id || "",
        stepTitle: matchedStep?.title || "",
      });
      return;
    }

    void openResource(resource);
  };

  const handleToggleSave = async (resource) => {
    if (!uid) return;

    const latestEntry = latestByResource.get(resource.id);
    const savedEntry = savedByResource.get(resource.id);
    const matchedStep =
      verifiedSteps.find((step) => step.resourceIds.includes(resource.id)) || focusedStep || nextActionStep || null;
    const directUrl =
      latestEntry?.finalUrl ||
      (!requiresSmartPrompt(resource)
        ? resolveSelfHelpResourceUrl(resource, { track, country, smartParams: null })
        : "");

    setSavingId(resource.id);
    setStatusMsg("");

    try {
      const next = await toggleSelfHelpBookmark(uid, {
        id: `${track}::${country}::${resource.id}`,
        resourceId: resource.id,
        title: resource.title,
        description: resource.description,
        category: resource.category,
        track,
        country,
        routePath: `/app/${track}/self-help`,
        routeSearch: buildRouteSearch(country),
        sectionId: resource.category,
        outboundUrl: latestEntry?.outboundUrl || directUrl,
        finalUrl: directUrl,
        labels: resource.labels,
        resourceType: resource.resourceType,
        linkMode: resource.linkMode,
        smartGenerated: resource.linkMode === "smart",
        smartParams: latestEntry?.smartParams || savedEntry?.smartParams || null,
        lastOpenedAt: latestEntry?.openedAt || savedEntry?.lastOpenedAt || 0,
        canOpenDirectly: Boolean(directUrl),
        providerKey:
          latestEntry?.providerKey ||
          savedEntry?.providerKey ||
          resource.providerKey ||
          resource.smartBuilder ||
          "direct-web",
        redirectEnabled:
          typeof latestEntry?.redirectEnabled === "boolean"
            ? latestEntry.redirectEnabled
            : resource.redirectEnabled !== false,
        affiliateTag: latestEntry?.affiliateTag || savedEntry?.affiliateTag || "",
        gatewaySource: latestEntry?.gatewaySource || savedEntry?.gatewaySource || "selfhelp-save",
        verifiedStepId: latestEntry?.verifiedStepId || matchedStep?.id || "",
        verifiedStepTitle: latestEntry?.verifiedStepTitle || matchedStep?.title || "",
      });
      setProgress(next);
    } catch (error) {
      console.error("SelfHelp save failed:", error);
      setStatusMsg("We could not update that saved resource right now.");
    } finally {
      setSavingId("");
    }
  };

  const focusStep = (step) => {
    setManualStepId(step.id);
    setManualSectionId(step.categoryId);
  };

  const browseStepSection = (step) => {
    setVerifiedPathOpen(false);
    focusStep(step);
  };

  const toggleStep = async (step) => {
    if (!uid) return;

    try {
      const next = await toggleSelfHelpStepCompletion(uid, {
        track,
        country,
        routePath: `/app/${track}/self-help`,
        routeSearch: buildRouteSearch(country),
        stepId: step.id,
        stepTitle: step.title,
        sectionId: step.categoryId,
      });
      setProgress(next);
      setManualStepId(step.id);
    } catch (error) {
      console.error("SelfHelp step update failed:", error);
      setStatusMsg("We could not update that verified step right now.");
    }
  };

  const handleChecklistSave = async (selectedIds) => {
    if (!uid) return;

    const orderedIds = verifiedSteps
      .map((step) => step.id)
      .filter((stepId) => Array.isArray(selectedIds) && selectedIds.includes(stepId));
    const nextStep = getNextVerifiedStep(verifiedSteps, orderedIds);
    const payload = {
      track,
      country,
      routePath: `/app/${track}/self-help`,
      routeSearch: buildRouteSearch(country),
      sectionId: nextStep?.categoryId || "",
      currentStepId: nextStep?.id || "",
      currentStepTitle: nextStep?.title || "",
      completedStepIds: orderedIds,
    };
    const optimisticProgress = previewSelfHelpChecklistProgress(progress, payload);

    setChecklistSaving(true);
    setStatusMsg("");
    setProgress(optimisticProgress);
    cacheSelfHelpProgress(uid, optimisticProgress);
    setManualStepId(nextStep?.id || "");
    setManualSectionId(CLOSED_SECTION_ID);
    closeChecklist();
    setChecklistSaving(false);

    try {
      const next = await saveSelfHelpChecklist(uid, payload);
      setProgress(next);
    } catch (error) {
      console.error("SelfHelp checklist save failed:", error);
      setStatusMsg("Checklist updated here, but we could not persist it for next time right now.");
    }
  };

  const handleContinueBrowsing = () => {
    const targetSectionId =
      safeString(latestContextEntry?.sectionId, 40) ||
      safeString(routeState?.lastExpandedSection, 40) ||
      "";
    const targetStepId =
      safeString(latestContextEntry?.verifiedStepId, 80) ||
      safeString(routeState?.currentStepId, 80) ||
      "";

    if (targetStepId) {
      setManualStepId(targetStepId);
    }

    if (targetSectionId) {
      setManualSectionId(targetSectionId);
      setVerifiedPathOpen(false);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          window.document
            ?.getElementById(`selfhelp-section-${targetSectionId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/55 via-white to-white pb-8 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="mx-auto max-w-3xl px-5 py-6">
          <div className="sticky top-0 z-30 -mx-5 px-5 pb-3 pt-1.5 bg-white/72 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:bg-zinc-950/72 dark:supports-[backdrop-filter]:bg-zinc-950/40">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                <AppIcon size={ICON_SM} icon={ArrowLeft} />
                Back
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openMoneyTools}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100"
                  aria-label="Open money tools"
                >
                  <AppIcon size={ICON_SM} icon={DollarSign} />
                  Money Tools
                </button>

                <button
                  type="button"
                  onClick={openChecklist}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  aria-label="Open journey checklist"
                >
                  <AppIcon size={ICON_SM} icon={ListChecks} />
                  Jenny Checklist
                </button>
              </div>
            </div>

            <div className="mt-4 min-w-0">
              <h1 className="text-[1.45rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                {country || "Choose a destination"}
              </h1>
              <span className="mt-2 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/80 dark:border-emerald-900/40 dark:bg-zinc-950/50">
                  <AppIcon size={ICON_SM} icon={HeaderIcon} className="text-emerald-700 dark:text-emerald-200" />
                </span>
                {trackMeta.label} Self-Help
              </span>
            </div>

            <JourneyBanner journey={journey} track={track} country={country} />

            <ProgressStrip
              percent={verifiedSummary.percent}
              completedCount={verifiedSummary.completedCount}
              totalCount={verifiedSummary.totalCount}
              nextStepTitle={nextActionStep?.title || ""}
            />

            <div className="relative mt-3">
              <button
                type="button"
                onClick={() => setVerifiedPathOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/72 px-4 py-2.5 text-left transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/55 dark:hover:bg-zinc-900"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Verified Path
                  </div>
                </div>

                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-200">
                  <AppIcon
                    size={ICON_MD}
                    icon={ChevronDown}
                    className={verifiedPathOpen ? "rotate-180 transition-transform" : "transition-transform"}
                  />
                </span>
              </button>

              {verifiedPathOpen ? (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-[60vh] overflow-y-auto rounded-3xl border border-zinc-200/80 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                  <div className="grid gap-2">
                    {verifiedSteps.map((step) => (
                      <VerifiedStepRow
                        key={step.id}
                        step={step}
                        completed={completedStepIds.includes(step.id)}
                        active={nextActionStep?.id === step.id}
                        onToggleComplete={toggleStep}
                        onSelect={browseStepSection}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {resourceCount} verified resources
            </div>
          </div>

          {latestContextEntry ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/75 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/55">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Continue from here
                </div>
                <div className="mt-1 truncate font-semibold text-zinc-900 dark:text-zinc-100">
                  {latestContextEntry.title}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {focusedStep?.title || nextActionStep?.title || latestContextEntry.category}
                  {" - "}
                  {formatRelativeTime(latestContextEntry.openedAt)}
                </div>
              </div>

              {continueTarget ? (
                <button
                  type="button"
                  onClick={handleContinueBrowsing}
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 font-semibold text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100"
                >
                  Continue browsing
                  <AppIcon size={ICON_SM} icon={ChevronRight} />
                </button>
              ) : null}
            </div>
          ) : null}

          {statusMsg ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
              {statusMsg}
            </div>
          ) : null}

          <div className="mt-6 grid gap-3">
            {sections.map((section) => {
              const isOpen = section.id === expandedSectionId;
              const visitedCount = section.resources.filter((resource) =>
                latestByResource.has(resource.id)
              ).length;

              return (
                <div
                  key={section.id}
                  id={`selfhelp-section-${section.id}`}
                  className="rounded-3xl border border-zinc-200/80 bg-white/80 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setVerifiedPathOpen(false);
                      setManualSectionId((current) =>
                        current === section.id || isOpen ? CLOSED_SECTION_ID : section.id
                      );
                    }}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {section.title}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        {section.description}
                      </div>
                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {section.resources.length} resources - {visitedCount} opened
                      </div>
                    </div>

                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/75 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-200">
                      <AppIcon
                        size={ICON_MD}
                        icon={ChevronDown}
                        className={isOpen ? "rotate-180 transition-transform" : "transition-transform"}
                      />
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="grid gap-3 border-t border-zinc-100 px-4 pb-4 pt-3 dark:border-zinc-800/80">
                      {section.resources.map((resource) => (
                        <ResourceRow
                          key={resource.id}
                          resource={resource}
                          visitedEntry={latestByResource.get(resource.id) || null}
                          isSaved={savedByResource.has(resource.id)}
                          opening={openingId === resource.id}
                          saving={savingId === resource.id}
                          extraLabels={currentStepResourceIds.has(resource.id) ? ["verified-step"] : []}
                          onOpen={handleOpen}
                          onToggleSave={handleToggleSave}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-6 text-xs text-zinc-500 dark:text-zinc-400">
            Verified links here are safer than random links from other places. Stay in this guided flow for safer steps.
          </div>

          <div className="mt-4 text-[11px] text-zinc-400 dark:text-zinc-500">
            © 2026 All rights reserved
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          openDocuments({
            stepId: focusedStep?.id || nextActionStep?.id || routeState?.currentStepId || "",
            categoryId:
              focusedStep?.documentCategoryId ||
              nextActionStep?.documentCategoryId ||
              "",
            create: false,
          })
        }
        className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-700 dark:border-emerald-900/40"
        aria-label="Open Self-Help Documents"
      >
        <AppIcon size={ICON_MD} icon={FileText} />
        Self-Help Documents
      </button>

      <SmartStayDialog
        key={`${promptState?.resource?.id || "closed"}:${promptState?.initialValues?.city || ""}:${promptState?.initialValues?.stayType || ""}:${promptState?.initialValues?.checkIn || ""}`}
        open={Boolean(promptState?.resource)}
        title={promptState?.resource?.title || "Smart stay"}
        description={`Tune the search a little, then we will open the provider directly for ${country || "your destination"}.`}
        fields={promptState?.fields || []}
        initialValues={promptState?.initialValues || {}}
        submitting={Boolean(promptState?.resource && openingId === promptState.resource.id)}
        onClose={() => setPromptState(null)}
        onSubmit={(values) =>
          promptState?.resource &&
          void openResource(promptState.resource, values, {
            sectionId: promptState.sectionId,
            stepId: promptState.stepId,
            stepTitle: promptState.stepTitle,
          })
        }
      />

      <JourneyChecklistSheet
        key={`${track}:${country}:${completedStepKey}:${checklistOpen ? "open" : "closed"}`}
        open={checklistOpen}
        trackLabel={trackMeta.label}
        country={country}
        steps={verifiedSteps}
        completedStepIds={completedStepIds}
        saving={checklistSaving}
        onClose={closeChecklist}
        onSave={handleChecklistSave}
      />
    </div>
  );
}

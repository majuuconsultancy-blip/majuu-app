import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import {
  getResourceDomain,
  openExternalUrl,
  resolveSelfHelpResourceUrl,
} from "./selfHelpLinking";
import {
  deleteSelfHelpMemoryItem,
  recordSelfHelpActivity,
} from "./selfHelpProgressStore";
import {
  getSelfHelpRuntimeResourceById,
  incrementSelfHelpResourceClick,
} from "../services/selfHelpResourceService";

export const SELF_HELP_PROVIDER_META = {
  "direct-web": { label: "External web", supportsRedirect: true },
  airalo: { label: "Airalo", supportsRedirect: true },
  booking: { label: "Booking.com", supportsRedirect: true },
  "google-flights": { label: "Google Flights", supportsRedirect: true },
  "linkedin-jobs": { label: "LinkedIn Jobs", supportsRedirect: true },
  numbeo: { label: "Numbeo", supportsRedirect: true },
  rome2rio: { label: "Rome2Rio", supportsRedirect: true },
  skyscanner: { label: "Skyscanner", supportsRedirect: true },
  studyportals: { label: "Studyportals", supportsRedirect: true },
  wise: { label: "Wise", supportsRedirect: true },
  xe: { label: "XE Currency", supportsRedirect: true },
};

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeAffiliateMeta(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const next = {
    partnerKey: safeString(value.partnerKey, 80),
    tag: safeString(value.tag, 80),
    campaign: safeString(value.campaign, 80),
  };

  return next.partnerKey || next.tag || next.campaign ? next : null;
}

function resolveTemplateValue(value, context) {
  if (typeof value === "function") {
    return safeString(value(context), 200);
  }

  return safeString(
    String(value || "")
      .replace(/\{country\}/g, safeString(context.country, 80))
      .replace(/\{track\}/g, safeString(context.track, 20))
      .replace(/\{resourceId\}/g, safeString(context.resourceId, 120)),
    200
  );
}

function applyAffiliateMetadata(resource, outboundUrl, context) {
  const affiliateMeta = sanitizeAffiliateMeta(resource?.affiliateMeta);
  if (!affiliateMeta) {
    return {
      finalUrl: outboundUrl,
      affiliateMeta: null,
    };
  }

  try {
    const parsed = new URL(outboundUrl);
    const queryParams =
      resource?.affiliateMeta && typeof resource.affiliateMeta === "object"
        ? resource.affiliateMeta.queryParams
        : null;

    if (queryParams && typeof queryParams === "object" && !Array.isArray(queryParams)) {
      Object.entries(queryParams).forEach(([key, value]) => {
        const paramKey = safeString(key, 80);
        const paramValue = resolveTemplateValue(value, context);
        if (paramKey && paramValue) {
          parsed.searchParams.set(paramKey, paramValue);
        }
      });
    }

    return {
      finalUrl: parsed.toString(),
      affiliateMeta,
    };
  } catch {
    return {
      finalUrl: outboundUrl,
      affiliateMeta,
    };
  }
}

function buildAnalyticsPayload(activity, resource) {
  return {
    resourceId: safeString(activity.resourceId, 120),
    title: safeString(activity.title, 180),
    category: safeString(activity.category, 40),
    track: safeString(activity.track, 20),
    country: safeString(activity.country, 80),
    outboundUrl: safeString(activity.outboundUrl, 1000),
    finalUrl: safeString(activity.finalUrl, 1000),
    providerKey: safeString(activity.providerKey || resource?.providerKey, 80),
    redirectEnabled: activity.redirectEnabled !== false,
    gatewaySource: safeString(activity.gatewaySource, 60),
    linkMode: safeString(activity.linkMode, 20),
    smartGenerated: Boolean(activity.smartGenerated),
    verifiedStepId: safeString(activity.verifiedStepId, 80),
    verifiedStepTitle: safeString(activity.verifiedStepTitle, 120),
    affiliateTag: safeString(activity.affiliateTag, 80),
    uid: safeString(activity.uid, 120),
  };
}

async function logGatewayAnalytics(activity, resource) {
  const payload = buildAnalyticsPayload(activity, resource);

  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "selfhelp_outbound_open", {
        resource_id: payload.resourceId,
        provider_key: payload.providerKey,
        track: payload.track,
        country: payload.country,
        smart: payload.smartGenerated,
        source: payload.gatewaySource,
      });
    }
  } catch {
    // ignore client analytics issues
  }

  try {
    await addDoc(collection(db, "analytics_selfHelpOutbounds"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  } catch {
    // ignore if rules are not ready yet
  }
}

function buildActivityPayload(resource, context, resolved) {
  const providerKey =
    safeString(resource?.providerKey, 80) ||
    safeString(resource?.smartBuilder, 80) ||
    "direct-web";

  const affiliateMeta = sanitizeAffiliateMeta(resolved.affiliateMeta);

  return {
    resourceId: resource.id,
    title: resource.title,
    description: resource.description,
    category: resource.category,
    track: context.track,
    country: context.country,
    routePath: context.routePath,
    routeSearch: context.routeSearch,
    sectionId: context.sectionId || resource.category,
    outboundUrl: resolved.outboundUrl,
    finalUrl: resolved.finalUrl,
    labels: resource.labels,
    resourceType: resource.resourceType,
    linkMode: resource.linkMode,
    smartGenerated: resource.linkMode === "smart",
    smartParams: context.smartParams || null,
    domain: getResourceDomain(resolved.finalUrl),
    providerKey,
    redirectEnabled: resource.redirectEnabled !== false,
    affiliateTag: affiliateMeta?.tag || "",
    gatewaySource: safeString(context.gatewaySource, 60) || "selfhelp",
    verifiedStepId: safeString(context.verifiedStepId, 80),
    verifiedStepTitle: safeString(context.verifiedStepTitle, 120),
  };
}

function resolveOutboundUrls(resource, context) {
  const outboundUrl = resolveSelfHelpResourceUrl(resource, {
    track: context.track,
    country: context.country,
    smartParams: context.smartParams || null,
  });

  if (!outboundUrl) {
    return {
      outboundUrl: "",
      finalUrl: "",
      affiliateMeta: null,
    };
  }

  const affiliateResolved = applyAffiliateMetadata(resource, outboundUrl, {
    ...context,
    resourceId: resource.id,
  });

  return {
    outboundUrl,
    finalUrl: affiliateResolved.finalUrl,
    affiliateMeta: affiliateResolved.affiliateMeta,
  };
}

export function getSelfHelpProviderMeta(providerKey) {
  return SELF_HELP_PROVIDER_META[safeString(providerKey, 80)] || null;
}

export function resolveStoredSelfHelpUrl(item) {
  const resource = getSelfHelpRuntimeResourceById(item?.resourceId);
  if (resource) {
    const resolved = resolveOutboundUrls(resource, {
      track: safeString(item?.track, 20).toLowerCase(),
      country: safeString(item?.country, 80),
      smartParams: item?.smartParams || null,
    });

    const managedUrl = safeString(resolved.finalUrl, 1000);
    if (managedUrl) return managedUrl;
  }

  return safeString(item?.finalUrl, 1000);
}

export async function openSelfHelpResourceGateway({
  uid = "",
  resource,
  track,
  country,
  routePath,
  routeSearch,
  sectionId,
  smartParams,
  verifiedStepId = "",
  verifiedStepTitle = "",
  gatewaySource = "selfhelp-hub",
}) {
  if (!resource) {
    return {
      ok: false,
      errorMessage: "We could not find that resource.",
      progress: null,
      finalUrl: "",
    };
  }

  const resolved = resolveOutboundUrls(resource, {
    track: safeString(track, 20).toLowerCase(),
    country: safeString(country, 80),
    smartParams: smartParams || null,
  });

  if (!resolved.finalUrl) {
    return {
      ok: false,
      errorMessage: "We could not build that resource link yet.",
      progress: null,
      finalUrl: "",
    };
  }

  const activity = buildActivityPayload(
    resource,
    {
      track: safeString(track, 20).toLowerCase(),
      country: safeString(country, 80),
      routePath: safeString(routePath, 120),
      routeSearch: safeString(routeSearch, 200),
      sectionId: safeString(sectionId, 40),
      smartParams: smartParams || null,
      verifiedStepId,
      verifiedStepTitle,
      gatewaySource,
    },
    resolved
  );

  const progressPromise = uid
    ? Promise.resolve(recordSelfHelpActivity(uid, activity, { fastLocal: true })).catch(
        (error) => {
          console.error("SelfHelp activity write failed:", error);
          return null;
        }
      )
    : null;
  const opened = openExternalUrl(activity.finalUrl);

  if (!opened) {
    const persistedProgress = progressPromise ? await progressPromise : null;
    const revertedProgress =
      uid && persistedProgress
        ? await deleteSelfHelpMemoryItem(uid, activity).catch((error) => {
            console.error("SelfHelp activity rollback failed:", error);
            return persistedProgress;
          })
        : persistedProgress;
    return {
      ok: false,
      errorMessage: "We could not open that resource right now.",
      progress: revertedProgress,
      finalUrl: "",
    };
  }

  const progress = progressPromise ? await progressPromise : null;

  void incrementSelfHelpResourceClick(resource.id);
  void logGatewayAnalytics({ ...activity, uid: safeString(uid, 120) }, resource);

  return {
    ok: true,
    errorMessage: "",
    progress,
    finalUrl: activity.finalUrl,
    activity,
  };
}

export async function reopenStoredSelfHelpGateway({
  uid = "",
  item,
  gatewaySource = "progress-selfhelp",
}) {
  const finalUrl = resolveStoredSelfHelpUrl(item);
  if (!finalUrl) {
    return {
      ok: false,
      errorMessage: "This resource needs fresh details before it can reopen directly.",
      progress: null,
      finalUrl: "",
    };
  }

  const resource = getSelfHelpRuntimeResourceById(item?.resourceId);
  const activity = {
    resourceId: safeString(item?.resourceId, 120),
    title: safeString(item?.title, 180),
    description: safeString(item?.description, 320),
    category: safeString(item?.category, 40),
    track: safeString(item?.track, 20).toLowerCase(),
    country: safeString(item?.country, 80),
    routePath: safeString(item?.routePath, 120) || `/app/${safeString(item?.track, 20)}/self-help`,
    routeSearch: safeString(item?.routeSearch, 200),
    sectionId: safeString(item?.sectionId, 40) || safeString(item?.category, 40),
    outboundUrl: safeString(item?.outboundUrl, 1000) || finalUrl,
    finalUrl,
    labels: Array.isArray(item?.labels) ? item.labels : [],
    resourceType: safeString(item?.resourceType, 60),
    linkMode: safeString(item?.linkMode, 20),
    smartGenerated: Boolean(item?.smartGenerated || item?.linkMode === "smart"),
    smartParams: item?.smartParams || null,
    domain: getResourceDomain(finalUrl),
    providerKey:
      safeString(item?.providerKey, 80) ||
      safeString(resource?.providerKey, 80) ||
      "direct-web",
    redirectEnabled:
      typeof item?.redirectEnabled === "boolean"
        ? item.redirectEnabled
        : resource?.redirectEnabled !== false,
    affiliateTag: safeString(item?.affiliateTag, 80),
    gatewaySource: safeString(gatewaySource, 60),
    verifiedStepId: safeString(item?.verifiedStepId, 80),
    verifiedStepTitle: safeString(item?.verifiedStepTitle, 120),
  };

  const progressPromise = uid
    ? Promise.resolve(recordSelfHelpActivity(uid, activity, { fastLocal: true })).catch(
        (error) => {
          console.error("SelfHelp reopen write failed:", error);
          return null;
        }
      )
    : null;
  const opened = openExternalUrl(finalUrl);

  if (!opened) {
    const persistedProgress = progressPromise ? await progressPromise : null;
    const revertedProgress =
      uid && persistedProgress
        ? await deleteSelfHelpMemoryItem(uid, activity).catch((error) => {
            console.error("SelfHelp reopen rollback failed:", error);
            return persistedProgress;
          })
        : persistedProgress;
    return {
      ok: false,
      errorMessage: "We could not reopen that resource right now.",
      progress: revertedProgress,
      finalUrl: "",
    };
  }

  const progress = progressPromise ? await progressPromise : null;

  if (resource?.id) {
    void incrementSelfHelpResourceClick(resource.id);
  }
  void logGatewayAnalytics({ ...activity, uid: safeString(uid, 120) }, resource);

  return {
    ok: true,
    errorMessage: "",
    progress,
    finalUrl,
  };
}

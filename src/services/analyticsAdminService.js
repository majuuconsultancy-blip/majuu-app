import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { db } from "../firebase";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";

const EVENTS_COLLECTION = "analytics_events";

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function countQuery(qy) {
  const snap = await getCountFromServer(qy);
  return safeNumber(snap?.data?.().count);
}

export async function countAnalyticsEventsByType(eventType) {
  const safeType = String(eventType || "").trim();
  if (!safeType) return 0;
  return countQuery(query(collection(db, EVENTS_COLLECTION), where("eventType", "==", safeType)));
}

export async function countAnalyticsEventsByKey(eventKey) {
  const safeKey = String(eventKey || "").trim();
  if (!safeKey) return 0;
  return countQuery(query(collection(db, EVENTS_COLLECTION), where("eventKey", "==", safeKey)));
}

export async function listTopDocs({
  collectionName,
  orderField,
  take = 10,
} = {}) {
  const safeCol = String(collectionName || "").trim();
  const safeField = String(orderField || "").trim();
  if (!safeCol || !safeField) return [];

  const qy = query(
    collection(db, safeCol),
    orderBy(safeField, "desc"),
    limit(Math.max(1, Math.min(30, Number(take) || 10)))
  );

  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function getSelfHelpClickBuckets() {
  const [affiliateSnap, otherSnap] = await Promise.all([
    getDoc(doc(db, "analytics_selfHelpLinkClickCounts", "affiliate")).catch(() => null),
    getDoc(doc(db, "analytics_selfHelpLinkClickCounts", "other")).catch(() => null),
  ]);

  const affiliate = affiliateSnap?.exists?.() ? affiliateSnap.data() || {} : {};
  const other = otherSnap?.exists?.() ? otherSnap.data() || {} : {};

  return {
    affiliate: safeNumber(affiliate?.totalClicks),
    other: safeNumber(other?.totalClicks),
  };
}

export async function getRequestCounts() {
  const ref = collection(db, "serviceRequests");
  const [total, accepted, rejected] = await Promise.all([
    countQuery(ref),
    countQuery(query(ref, where("status", "==", "closed"))),
    countQuery(query(ref, where("status", "==", "rejected"))),
  ]);

  return { total, accepted, rejected };
}

export async function loadSaccAnalyticsSnapshot({ topLimit = 10 } = {}) {
  const take = Math.max(1, Math.min(30, Number(topLimit) || 10));

  const [
    totalSignups,
    totalProfileCompletions,
    journeySetupsCompleted,
    appLaunchWithSavedJourney,
    appLaunchWithoutSavedJourney,
    selfHelpOpens,
    weHelpOpens,
    trackStudy,
    trackWork,
    trackTravel,
    selfHelpBuckets,
    requestCounts,
    topTappedCountries,
    topUnsupportedCountries,
    topNewsRoutes,
    topNewsCountries,
  ] = await Promise.all([
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.SIGNUP_COMPLETED),
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.PROFILE_COMPLETED),
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.JOURNEY_SETUP_COMPLETED),
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.APP_LAUNCH_WITH_SAVED_JOURNEY),
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.APP_LAUNCH_WITHOUT_SAVED_JOURNEY),
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.SELFHELP_OPENED),
    countAnalyticsEventsByType(ANALYTICS_EVENT_TYPES.WEHELP_OPENED),
    countAnalyticsEventsByKey(`${ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED}:study`),
    countAnalyticsEventsByKey(`${ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED}:work`),
    countAnalyticsEventsByKey(`${ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED}:travel`),
    getSelfHelpClickBuckets(),
    getRequestCounts(),
    listTopDocs({
      collectionName: "analytics_countryDemandCounts",
      orderField: "totalTaps",
      take,
    }),
    listTopDocs({
      collectionName: "analytics_customCountryDemandCounts",
      orderField: "totalSubmissions",
      take,
    }),
    listTopDocs({
      collectionName: "analytics_newsRouteViewCounts",
      orderField: "totalViews",
      take,
    }),
    listTopDocs({
      collectionName: "analytics_newsCountryViewCounts",
      orderField: "totalViews",
      take,
    }),
  ]);

  return {
    counts: {
      totalSignups,
      totalProfileCompletions,
      journeySetupsCompleted,
      appLaunchWithSavedJourney,
      appLaunchWithoutSavedJourney,
      trackSelections: {
        study: trackStudy,
        work: trackWork,
        travel: trackTravel,
      },
      selfHelpOpens,
      weHelpOpens,
      affiliateLinkClicks: safeNumber(selfHelpBuckets?.affiliate),
      otherLinkClicks: safeNumber(selfHelpBuckets?.other),
      requests: requestCounts,
    },
    top: {
      tappedCountries: topTappedCountries,
      unsupportedCountries: topUnsupportedCountries,
      newsRoutes: topNewsRoutes,
      newsCountries: topNewsCountries,
    },
  };
}


import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import { getCurrentUserRoleContext } from "./adminroleservice";
import { listPartners } from "./partnershipService";

export const PUSH_SUBSCRIPTIONS_COLLECTION = "partnerPushSubscriptions";
export const PUSH_CAMPAIGNS_COLLECTION = "pushCampaigns";

const DESTINATION_TYPES = new Set(["track_flow", "external_link", "internal_screen"]);
const TARGETING_TYPES = new Set(["general", "track_only", "track_country"]);
const SCHEDULE_TYPES = new Set(["one_time", "scheduled", "recurring"]);
const CAMPAIGN_STATUSES = new Set(["draft", "scheduled", "sent"]);
const SUBSCRIPTION_STATUSES = new Set(["active", "expired", "suspended"]);

function safeStr(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeIsoDate(value) {
  const raw = safeStr(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  return raw;
}

function isoDateToMs(date) {
  const iso = normalizeIsoDate(date);
  if (!iso) return 0;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function assert(condition, message) {
  if (condition) return;
  throw new Error(message);
}

async function requireSuperAdmin() {
  const uid = safeStr(auth.currentUser?.uid, 180);
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  if (!roleCtx?.isSuperAdmin) {
    throw new Error("Only super admin can manage push subscriptions and campaigns.");
  }
  return { uid, roleCtx };
}

function normalizeSubscriptionStatus(value) {
  const clean = safeStr(value, 40).toLowerCase();
  return SUBSCRIPTION_STATUSES.has(clean) ? clean : "active";
}

function normalizeDestinationType(value) {
  const clean = safeStr(value, 40).toLowerCase();
  return DESTINATION_TYPES.has(clean) ? clean : "track_flow";
}

function normalizeTargetingType(value) {
  const clean = safeStr(value, 40).toLowerCase();
  return TARGETING_TYPES.has(clean) ? clean : "general";
}

function normalizeScheduleType(value) {
  const clean = safeStr(value, 40).toLowerCase();
  return SCHEDULE_TYPES.has(clean) ? clean : "one_time";
}

function normalizeCampaignStatus(value) {
  const clean = safeStr(value, 30).toLowerCase();
  return CAMPAIGN_STATUSES.has(clean) ? clean : "draft";
}

function normalizeDateTimeList(values = []) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  arr.forEach((value) => {
    const clean = safeStr(value, 40);
    const ms = Date.parse(clean);
    if (!clean || !Number.isFinite(ms)) return;
    if (seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  });
  return out;
}

function hasOwn(source = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function computeClickThroughRatePercent(clickCount = 0, sentCount = 0) {
  const safeSent = Math.max(0, Math.floor(safeNum(sentCount, 0)));
  if (!safeSent) return 0;
  const safeClicks = Math.max(0, Math.floor(safeNum(clickCount, 0)));
  return Number(((safeClicks / safeSent) * 100).toFixed(2));
}

function normalizeCampaignAnalytics(
  patch = {},
  existing = {},
  { defaultSentCount = 0, defaultDeliveredCount = 0 } = {}
) {
  const source = patch && typeof patch === "object" ? patch : {};
  const baseline = existing && typeof existing === "object" ? existing : {};

  const sentCount = Math.max(
    0,
    Math.floor(
      hasOwn(source, "sentCount")
        ? safeNum(source?.sentCount, 0)
        : safeNum(baseline?.sentCount, defaultSentCount)
    )
  );
  const deliveredCount = Math.max(
    0,
    Math.floor(
      hasOwn(source, "deliveredCount")
        ? safeNum(source?.deliveredCount, 0)
        : safeNum(baseline?.deliveredCount, defaultDeliveredCount)
    )
  );
  const openCount = Math.max(
    0,
    Math.floor(
      hasOwn(source, "openCount") ? safeNum(source?.openCount, 0) : safeNum(baseline?.openCount, 0)
    )
  );
  const clickCount = Math.max(
    0,
    Math.floor(
      hasOwn(source, "clickCount") ? safeNum(source?.clickCount, 0) : safeNum(baseline?.clickCount, 0)
    )
  );
  const deepLinkOpenCount = Math.max(
    0,
    Math.floor(
      hasOwn(source, "deepLinkOpenCount")
        ? safeNum(source?.deepLinkOpenCount, 0)
        : safeNum(baseline?.deepLinkOpenCount, 0)
    )
  );
  const clickThroughRate = computeClickThroughRatePercent(clickCount, sentCount);

  return {
    sentCount,
    deliveredCount,
    openCount,
    clickCount,
    deepLinkOpenCount,
    clickThroughRate,
  };
}

export function computeCampaignSendCount(campaign = {}) {
  const scheduleType = normalizeScheduleType(campaign?.scheduleType);
  if (scheduleType === "one_time" || scheduleType === "scheduled") return 1;
  const sendsFromDates = normalizeDateTimeList(campaign?.sendDateTimes || campaign?.scheduleDates || []);
  if (sendsFromDates.length) return sendsFromDates.length;
  const numberOfSends = Math.max(1, Math.floor(safeNum(campaign?.numberOfSends, 1)));
  return numberOfSends;
}

function normalizeCampaignPayload(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const destinationType = normalizeDestinationType(source?.destinationType);
  const targetingType = normalizeTargetingType(source?.targetingType);
  const scheduleType = normalizeScheduleType(source?.scheduleType);

  const payload = {
    partnerId: safeStr(source?.partnerId, 160),
    partnerName: safeStr(source?.partnerName, 180),
    title: safeStr(source?.title, 120),
    body: safeStr(source?.body, 300),
    imageUrl: safeStr(source?.imageUrl, 1400),
    ctaLabel: safeStr(source?.ctaLabel, 60),
    destinationType,
    externalUrl: safeStr(source?.externalUrl, 1400),
    internalScreen: safeStr(source?.internalScreen, 200),
    targetingType,
    track: safeStr(source?.track, 60),
    country: safeStr(source?.country, 120),
    scheduleType,
    sendAt: safeStr(source?.sendAt, 60),
    sendDateTimes: normalizeDateTimeList(source?.sendDateTimes),
    recurrencePattern: safeStr(source?.recurrencePattern, 120),
    numberOfSends: Math.max(1, Math.floor(safeNum(source?.numberOfSends, 1))),
    status: normalizeCampaignStatus(source?.status),
    metadata: source?.metadata && typeof source.metadata === "object" ? source.metadata : {},
  };

  assert(Boolean(payload.partnerId), "Partner selection is required.");
  assert(Boolean(payload.title), "Campaign title is required.");
  assert(Boolean(payload.body), "Notification body is required.");

  if (destinationType === "track_flow") {
    payload.externalUrl = "";
  } else if (destinationType === "external_link") {
    payload.targetingType = "general";
    payload.track = "";
    payload.country = "";
    assert(/^https?:\/\//i.test(payload.externalUrl), "External link must start with http:// or https://");
  }

  if (payload.targetingType === "general") {
    payload.track = "";
    payload.country = "";
  } else if (payload.targetingType === "track_only") {
    assert(Boolean(payload.track), "Track is required for track-only targeting.");
    payload.country = "";
  } else if (payload.targetingType === "track_country") {
    assert(Boolean(payload.track), "Track is required for track + country targeting.");
    assert(Boolean(payload.country), "Country is required for track + country targeting.");
  }

  if (scheduleType === "scheduled") {
    assert(Boolean(payload.sendAt), "Scheduled campaigns require send time.");
  }
  if (scheduleType === "recurring") {
    const withDates = payload.sendDateTimes.length > 0;
    const withPattern = Boolean(payload.recurrencePattern);
    assert(withDates || withPattern, "Recurring campaigns require send dates or recurrence pattern.");
  }

  payload.reservedPushes = computeCampaignSendCount(payload);
  return payload;
}

function normalizeSubscriptionPayload(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const partnerId = safeStr(source?.partnerId, 160);
  const planName = safeStr(source?.planName, 120);
  const monthlyPushQuota = Math.max(0, Math.floor(safeNum(source?.monthlyPushQuota, 0)));
  const startDate = normalizeIsoDate(source?.startDate);
  const endDate = normalizeIsoDate(source?.endDate);
  const status = normalizeSubscriptionStatus(source?.status);
  assert(Boolean(partnerId), "Partner id is required.");
  assert(Boolean(planName), "Plan name is required.");
  assert(monthlyPushQuota > 0, "Monthly push quota must be greater than zero.");
  assert(Boolean(startDate), "Subscription start date is required.");
  assert(Boolean(endDate), "Subscription end date is required.");

  const startAtMs = isoDateToMs(startDate);
  const endAtMs = isoDateToMs(endDate);
  assert(endAtMs >= startAtMs, "Subscription end date must be after start date.");

  return {
    partnerId,
    partnerName: safeStr(source?.partnerName, 180),
    planName,
    monthlyPushQuota,
    startDate,
    endDate,
    startAtMs,
    endAtMs,
    status,
  };
}

function isSubscriptionActive(sub = {}, nowMs = Date.now()) {
  const status = normalizeSubscriptionStatus(sub?.status);
  if (status !== "active") return false;
  const endAtMs = safeNum(sub?.endAtMs, 0);
  if (!endAtMs) return false;
  return nowMs <= endAtMs;
}

export async function listPushCampaignPartners({ max = 250 } = {}) {
  await requireSuperAdmin();
  return listPartners({ activeOnly: false, max: Math.max(1, Math.min(500, safeNum(max, 250))) });
}

export async function listPartnerPushSubscriptions({ max = 250 } = {}) {
  await requireSuperAdmin();
  const qy = query(
    collection(db, PUSH_SUBSCRIPTIONS_COLLECTION),
    orderBy("updatedAtMs", "desc"),
    limit(Math.max(1, Math.min(500, safeNum(max, 250))))
  );
  const snap = await getDocs(qy);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function activateOrUpdatePartnerPushSubscription(input = {}) {
  const caller = await requireSuperAdmin();
  const payload = normalizeSubscriptionPayload(input);
  const ref = doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, payload.partnerId);
  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? snap.data() || {} : {};
    const cycleChanged =
      !snap.exists() ||
      safeNum(existing?.startAtMs, 0) !== payload.startAtMs ||
      safeNum(existing?.endAtMs, 0) !== payload.endAtMs;
    const pushesUsedCycle = cycleChanged
      ? 0
      : Math.max(0, Math.floor(safeNum(existing?.pushesUsedCycle, 0)));
    const pushesReservedCycle = cycleChanged
      ? 0
      : Math.max(0, Math.floor(safeNum(existing?.pushesReservedCycle, 0)));
    const pushesRemainingCycle = Math.max(
      0,
      payload.monthlyPushQuota - pushesUsedCycle - pushesReservedCycle
    );
    const previousCycleVersion = Math.max(1, Math.floor(safeNum(existing?.cycleVersion, 0)) || 1);
    const cycleVersion = cycleChanged ? previousCycleVersion + 1 : previousCycleVersion;

    tx.set(
      ref,
      {
        partnerId: payload.partnerId,
        partnerName: payload.partnerName || safeStr(existing?.partnerName, 180),
        planName: payload.planName,
        monthlyPushQuota: payload.monthlyPushQuota,
        startDate: payload.startDate,
        endDate: payload.endDate,
        startAtMs: payload.startAtMs,
        endAtMs: payload.endAtMs,
        status: payload.status,
        pushesUsedCycle,
        pushesReservedCycle,
        pushesRemainingCycle,
        cycleVersion,
        cycleResetAt: cycleChanged ? serverTimestamp() : existing?.cycleResetAt || null,
        cycleResetAtMs: cycleChanged ? nowMs : safeNum(existing?.cycleResetAtMs, 0),
        cycleResetByUid: cycleChanged ? caller.uid : safeStr(existing?.cycleResetByUid, 180),
        manualActivation: true,
        activatedByUid: caller.uid,
        updatedAt: serverTimestamp(),
        updatedAtMs: nowMs,
        createdAt: snap.exists() ? existing?.createdAt || serverTimestamp() : serverTimestamp(),
        createdAtMs: snap.exists() ? safeNum(existing?.createdAtMs, nowMs) : nowMs,
      },
      { merge: true }
    );
  });

  return { ok: true, partnerId: payload.partnerId };
}

export async function createPushCampaignDraft(input = {}) {
  const caller = await requireSuperAdmin();
  const payload = normalizeCampaignPayload(input);
  const subscriptionRef = doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, payload.partnerId);
  const nowMs = Date.now();

  return runTransaction(db, async (tx) => {
    const subscriptionSnap = await tx.get(subscriptionRef);
    const subscription = subscriptionSnap.exists() ? subscriptionSnap.data() || {} : {};
    assert(subscriptionSnap.exists(), "Push subscription not found for selected partner.");
    assert(isSubscriptionActive(subscription, nowMs), "Partner subscription is not active.");

    const remaining = Math.max(0, Math.floor(safeNum(subscription?.pushesRemainingCycle, 0)));
    const reserved = Math.max(1, Math.floor(safeNum(payload.reservedPushes, 1)));
    assert(remaining >= reserved, "Campaign exceeds partner remaining push quota.");

    const campaignRef = doc(collection(db, PUSH_CAMPAIGNS_COLLECTION));
    const nextReserved = Math.max(0, Math.floor(safeNum(subscription?.pushesReservedCycle, 0))) + reserved;
    const nextRemaining = Math.max(0, remaining - reserved);

    tx.set(campaignRef, {
      ...payload,
      id: campaignRef.id,
      reservedPushes: reserved,
      subscriptionSnapshot: {
        planName: safeStr(subscription?.planName, 120),
        monthlyPushQuota: Math.floor(safeNum(subscription?.monthlyPushQuota, 0)),
        cycleVersion: Math.floor(safeNum(subscription?.cycleVersion, 1)) || 1,
      },
      analytics: normalizeCampaignAnalytics({}, {}, { defaultSentCount: 0, defaultDeliveredCount: 0 }),
      createdByUid: caller.uid,
      updatedByUid: caller.uid,
      createdAt: serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });

    tx.update(subscriptionRef, {
      pushesReservedCycle: nextReserved,
      pushesRemainingCycle: nextRemaining,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });

    return {
      ok: true,
      campaignId: campaignRef.id,
      reservedPushes: reserved,
      pushesRemainingCycle: nextRemaining,
    };
  });
}

export async function updatePushCampaignDraft(campaignId, input = {}) {
  const caller = await requireSuperAdmin();
  const id = safeStr(campaignId, 180);
  assert(Boolean(id), "campaignId is required.");
  const payload = normalizeCampaignPayload(input);
  const campaignRef = doc(db, PUSH_CAMPAIGNS_COLLECTION, id);
  const subscriptionRef = doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, payload.partnerId);
  const nowMs = Date.now();

  return runTransaction(db, async (tx) => {
    const [campaignSnap, subscriptionSnap] = await Promise.all([
      tx.get(campaignRef),
      tx.get(subscriptionRef),
    ]);
    assert(campaignSnap.exists(), "Campaign not found.");
    assert(subscriptionSnap.exists(), "Push subscription not found for selected partner.");

    const existingCampaign = campaignSnap.data() || {};
    assert(
      normalizeCampaignStatus(existingCampaign?.status) !== "sent",
      "Sent campaigns cannot be edited."
    );
    assert(
      safeStr(existingCampaign?.partnerId, 160) === payload.partnerId,
      "Campaign partner cannot be changed after creation."
    );

    const subscription = subscriptionSnap.data() || {};
    assert(isSubscriptionActive(subscription, nowMs), "Partner subscription is not active.");

    const oldReserved = Math.max(1, Math.floor(safeNum(existingCampaign?.reservedPushes, 1)));
    const nextReserved = Math.max(1, Math.floor(safeNum(payload?.reservedPushes, 1)));
    const delta = nextReserved - oldReserved;

    const remaining = Math.max(0, Math.floor(safeNum(subscription?.pushesRemainingCycle, 0)));
    assert(delta <= 0 || remaining >= delta, "Campaign update exceeds remaining quota.");

    const currentReserved = Math.max(0, Math.floor(safeNum(subscription?.pushesReservedCycle, 0)));
    const updatedReserved = Math.max(0, currentReserved + delta);
    const updatedRemaining = Math.max(0, remaining - Math.max(0, delta));

    tx.update(campaignRef, {
      ...payload,
      reservedPushes: nextReserved,
      updatedByUid: caller.uid,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });

    tx.update(subscriptionRef, {
      pushesReservedCycle: updatedReserved,
      pushesRemainingCycle: updatedRemaining,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });

    return {
      ok: true,
      campaignId: id,
      reservedPushes: nextReserved,
      pushesRemainingCycle: updatedRemaining,
    };
  });
}

export async function listPushCampaigns({ max = 120 } = {}) {
  await requireSuperAdmin();
  const qy = query(
    collection(db, PUSH_CAMPAIGNS_COLLECTION),
    orderBy("createdAtMs", "desc"),
    limit(Math.max(1, Math.min(500, safeNum(max, 120))))
  );
  const snap = await getDocs(qy);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

export async function markPushCampaignAsSent(campaignId, analyticsPatch = {}) {
  const caller = await requireSuperAdmin();
  const id = safeStr(campaignId, 180);
  assert(Boolean(id), "campaignId is required.");
  const patch = analyticsPatch && typeof analyticsPatch === "object" ? analyticsPatch : {};
  const nowMs = Date.now();
  const campaignRef = doc(db, PUSH_CAMPAIGNS_COLLECTION, id);

  return runTransaction(db, async (tx) => {
    const campaignSnap = await tx.get(campaignRef);
    assert(campaignSnap.exists(), "Campaign not found.");

    const campaign = campaignSnap.data() || {};
    const partnerId = safeStr(campaign?.partnerId, 160);
    assert(Boolean(partnerId), "Campaign partner is missing.");

    const subscriptionRef = doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, partnerId);
    const subscriptionSnap = await tx.get(subscriptionRef);
    assert(subscriptionSnap.exists(), "Push subscription not found for selected partner.");

    const subscription = subscriptionSnap.data() || {};
    const alreadySent = normalizeCampaignStatus(campaign?.status) === "sent";
    const reservedPushes = Math.max(0, Math.floor(safeNum(campaign?.reservedPushes, 0)));
    const existingAnalytics =
      campaign?.analytics && typeof campaign.analytics === "object" ? campaign.analytics : {};

    let pushesUsedCycle = Math.max(0, Math.floor(safeNum(subscription?.pushesUsedCycle, 0)));
    let pushesReservedCycle = Math.max(0, Math.floor(safeNum(subscription?.pushesReservedCycle, 0)));
    if (!alreadySent && reservedPushes > 0) {
      const transferable = Math.min(reservedPushes, pushesReservedCycle);
      pushesReservedCycle = Math.max(0, pushesReservedCycle - transferable);
      pushesUsedCycle += transferable;
    }

    const quota = Math.max(0, Math.floor(safeNum(subscription?.monthlyPushQuota, 0)));
    const pushesRemainingCycle = Math.max(0, quota - pushesUsedCycle - pushesReservedCycle);
    const analytics = normalizeCampaignAnalytics(
      patch,
      alreadySent ? existingAnalytics : {},
      {
        defaultSentCount: reservedPushes,
        defaultDeliveredCount: reservedPushes,
      }
    );

    tx.update(campaignRef, {
      status: "sent",
      analytics,
      sentAt: alreadySent ? campaign?.sentAt || serverTimestamp() : serverTimestamp(),
      sentAtMs: alreadySent ? safeNum(campaign?.sentAtMs, nowMs) : nowMs,
      updatedByUid: caller.uid,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });

    tx.update(subscriptionRef, {
      pushesUsedCycle,
      pushesReservedCycle,
      pushesRemainingCycle,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });

    return {
      ok: true,
      campaignId: id,
      pushesUsedCycle,
      pushesReservedCycle,
      pushesRemainingCycle,
    };
  });
}

export async function resetPartnerPushCycle({
  partnerId = "",
  monthlyPushQuota = null,
} = {}) {
  const caller = await requireSuperAdmin();
  const id = safeStr(partnerId, 180);
  assert(Boolean(id), "partnerId is required.");
  const ref = doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, id);
  const nowMs = Date.now();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    assert(snap.exists(), "Push subscription not found.");
    const existing = snap.data() || {};
    const quota = Math.max(
      0,
      Math.floor(
        monthlyPushQuota == null
          ? safeNum(existing?.monthlyPushQuota, 0)
          : safeNum(monthlyPushQuota, existing?.monthlyPushQuota)
      )
    );
    tx.update(ref, {
      monthlyPushQuota: quota,
      pushesUsedCycle: 0,
      pushesReservedCycle: 0,
      pushesRemainingCycle: quota,
      cycleVersion: Math.floor(safeNum(existing?.cycleVersion, 0)) + 1,
      cycleResetAt: serverTimestamp(),
      cycleResetAtMs: nowMs,
      cycleResetByUid: caller.uid,
      updatedAt: serverTimestamp(),
      updatedAtMs: nowMs,
    });
  });
  return { ok: true, partnerId: id };
}

function computeNewsPriorityScore(row = {}) {
  const priority = safeNum(row?.priorityScore, 0);
  const impact = safeNum(row?.impactScore, 0);
  const freshness = Math.max(0, Date.now() - safeNum(row?.updatedAtMs || row?.createdAtMs, 0));
  const freshnessPenalty = freshness > 0 ? Math.min(30, freshness / (1000 * 60 * 60 * 24)) : 0;
  return Math.max(0, Math.round((priority || impact || 50) - freshnessPenalty));
}

export async function listNewsPushSuggestions({ max = 20 } = {}) {
  await requireSuperAdmin();
  const rows = [];
  try {
    const snap = await getDocs(
      query(
        collection(db, "news"),
        orderBy("updatedAtMs", "desc"),
        limit(Math.max(1, Math.min(80, safeNum(max, 20) * 3)))
      )
    );
    snap.docs.forEach((docSnap) => rows.push({ id: docSnap.id, ...docSnap.data() }));
  } catch {
    const snap = await getDocs(
      query(collection(db, "news"), limit(Math.max(1, Math.min(80, safeNum(max, 20) * 3))))
    );
    snap.docs.forEach((docSnap) => rows.push({ id: docSnap.id, ...docSnap.data() }));
  }
  return rows
    .map((row) => ({
      ...row,
      priorityScore: computeNewsPriorityScore(row),
      title: safeStr(row?.title, 160),
      summary: safeStr(row?.summary || row?.content || row?.description, 260),
      trackType: safeStr(row?.trackType || row?.track, 40).toLowerCase(),
      country: safeStr(row?.country, 120),
      updatedAtMs: safeNum(row?.updatedAtMs || row?.createdAtMs, 0),
    }))
    .filter((row) => row.title)
    .sort((a, b) => safeNum(b.priorityScore, 0) - safeNum(a.priorityScore, 0))
    .slice(0, Math.max(1, Math.min(80, safeNum(max, 20))));
}

export async function getPartnerPushSubscription(partnerId = "") {
  await requireSuperAdmin();
  const id = safeStr(partnerId, 180);
  if (!id) return null;
  const snap = await getDoc(doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

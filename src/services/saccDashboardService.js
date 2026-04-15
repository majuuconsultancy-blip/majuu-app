import {
  collection,
  collectionGroup,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { db } from "../firebase";
import { loadSaccAnalyticsSnapshot } from "./analyticsAdminService";

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function monthKey(tsMs = 0) {
  const safeTs = safeNum(tsMs, 0);
  if (safeTs <= 0) return "";
  const dt = new Date(safeTs);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(key = "") {
  if (!/^\d{4}-\d{2}$/.test(String(key || ""))) return key;
  const [y, m] = String(key).split("-");
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return dt.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

async function safeCount(qyOrCollectionRef) {
  try {
    const snap = await getCountFromServer(qyOrCollectionRef);
    return safeNum(snap?.data?.().count, 0);
  } catch {
    return 0;
  }
}

async function safeRows(qyOrCollectionRef) {
  try {
    const snap = await getDocs(qyOrCollectionRef);
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  } catch {
    return [];
  }
}

function sumAmount(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => acc + Math.max(0, safeNum(row?.amount, 0)),
    0
  );
}

function buildRevenueTrend(rows = [], { months = 6 } = {}) {
  const monthCount = Math.max(3, Math.min(12, safeNum(months, 6)));
  const now = new Date();
  const keys = [];
  for (let i = monthCount - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const totals = Object.fromEntries(keys.map((key) => [key, 0]));
  rows.forEach((row) => {
    const ts =
      safeNum(row?.releasedAtMs, 0) ||
      safeNum(row?.createdAtMs, 0) ||
      safeNum(row?.updatedAtMs, 0);
    const key = monthKey(ts);
    if (!totals[key]) return;
    totals[key] += Math.max(0, safeNum(row?.amount, 0));
  });
  return keys.map((key) => ({
    key,
    label: monthLabel(key),
    amount: Math.round(totals[key] || 0),
  }));
}

function computeSla(requestRows = []) {
  const samples = [];
  (Array.isArray(requestRows) ? requestRows : []).forEach((row) => {
    const createdAtMs = safeNum(row?.createdAtMs, 0);
    const startedAtMs = safeNum(row?.staffStartedAtMs || row?.adminRespondedAtMs, 0);
    if (!createdAtMs || !startedAtMs || startedAtMs < createdAtMs) return;
    const minutes = Math.round((startedAtMs - createdAtMs) / 60000);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 * 24 * 30) return;
    samples.push(minutes);
  });
  if (!samples.length) {
    return {
      avgMinutesToInProgress: 0,
      sampleSize: 0,
      under24hRate: 0,
    };
  }
  const total = samples.reduce((acc, value) => acc + value, 0);
  const under24h = samples.filter((value) => value <= 24 * 60).length;
  return {
    avgMinutesToInProgress: Math.round(total / samples.length),
    sampleSize: samples.length,
    under24hRate: Math.round((under24h / samples.length) * 100),
  };
}

export async function loadSaccExecutiveDashboardSnapshot({
  partnerLimit = 8,
  countryLimit = 8,
  revenueMonths = 6,
} = {}) {
  const topPartnerLimit = Math.max(3, Math.min(20, safeNum(partnerLimit, 8)));
  const topCountryLimit = Math.max(3, Math.min(20, safeNum(countryLimit, 8)));
  const days30Ms = 30 * 24 * 60 * 60 * 1000;
  const since30d = Date.now() - days30Ms;

  const [
    analytics,
    totalUsers,
    requestsTotal,
    activeRequests,
    requestsInProgress,
    requestsCompleted,
    launchEvents30d,
    payoutQueueRows,
    settlementRows,
    refundedRows,
    autoRefundedRows,
    totalPaidCount,
    countryDemandRows,
    requestRowsForSla,
  ] = await Promise.all([
    loadSaccAnalyticsSnapshot({ topLimit: topCountryLimit }).catch(() => null),
    safeCount(collection(db, "users")),
    safeCount(collection(db, "serviceRequests")),
    safeCount(
      query(collection(db, "serviceRequests"), where("status", "in", ["new", "contacted", "in_progress"]))
    ),
    safeCount(
      query(collection(db, "serviceRequests"), where("status", "in", ["contacted", "in_progress"]))
    ),
    safeCount(query(collection(db, "serviceRequests"), where("status", "==", "closed"))),
    safeCount(
      query(
        collection(db, "analytics_events"),
        where("createdAtMs", ">=", since30d),
        where("eventType", "in", [
          ANALYTICS_EVENT_TYPES.APP_LAUNCH_WITH_SAVED_JOURNEY,
          ANALYTICS_EVENT_TYPES.APP_LAUNCH_WITHOUT_SAVED_JOURNEY,
        ])
      )
    ),
    safeRows(
      query(
        collection(db, "payoutQueue"),
        where("status", "in", ["pending", "on_hold", "ready", "processing"]),
        limit(1200)
      )
    ),
    safeRows(query(collection(db, "settlementHistory"), orderBy("createdAtMs", "desc"), limit(1200))),
    safeRows(query(collectionGroup(db, "payments"), where("status", "==", "refunded"), limit(1200))),
    safeRows(query(collectionGroup(db, "payments"), where("status", "==", "auto_refunded"), limit(1200))),
    safeCount(
      query(
        collectionGroup(db, "payments"),
        where("status", "in", ["paid", "paid_held", "refunded", "auto_refunded", "refund_under_review"])
      )
    ),
    safeRows(
      query(collection(db, "analytics_countryDemandCounts"), orderBy("totalTaps", "desc"), limit(topCountryLimit))
    ),
    safeRows(query(collection(db, "serviceRequests"), limit(1200))),
  ]);

  const trackSelections = analytics?.counts?.trackSelections || {};
  const requestsFromAnalytics = analytics?.counts?.requests || {};
  const requestSent = Math.max(safeNum(requestsFromAnalytics?.total, 0), requestsTotal);
  const inProgress = Math.max(
    safeNum(requestsInProgress, 0),
    safeNum(requestsFromAnalytics?.accepted, 0)
  );
  const completed = Math.max(
    safeNum(requestsCompleted, 0),
    safeNum(requestsFromAnalytics?.accepted, 0)
  );

  const releasedPayouts = sumAmount(settlementRows);
  const refundedAmount = sumAmount([...refundedRows, ...autoRefundedRows]);
  const escrowHeldBalance = sumAmount(payoutQueueRows);
  const totalRevenue = releasedPayouts;
  const autoRefundCount = autoRefundedRows.length;
  const refundCount = refundedRows.length + autoRefundCount;
  const refundRate = totalPaidCount > 0 ? Math.round((refundCount / totalPaidCount) * 100) : 0;
  const autoRefundRate = totalPaidCount > 0 ? Math.round((autoRefundCount / totalPaidCount) * 100) : 0;

  const partnerMap = new Map();
  settlementRows.forEach((row) => {
    const partnerId = String(row?.partnerId || "").trim();
    const partnerName = String(row?.partnerName || partnerId || "Partner").trim();
    if (!partnerId) return;
    const current = partnerMap.get(partnerId) || {
      partnerId,
      partnerName,
      totalReleased: 0,
      payoutCount: 0,
    };
    current.totalReleased += Math.max(0, safeNum(row?.amount, 0));
    current.payoutCount += 1;
    partnerMap.set(partnerId, current);
  });
  const partnerRanking = Array.from(partnerMap.values())
    .sort((a, b) => b.totalReleased - a.totalReleased)
    .slice(0, topPartnerLimit)
    .map((row, index) => ({
      rank: index + 1,
      partnerId: row.partnerId,
      partnerName: row.partnerName,
      totalReleased: Math.round(row.totalReleased),
      payoutCount: row.payoutCount,
    }));

  const sla = computeSla(requestRowsForSla);
  const revenueTrend = buildRevenueTrend(settlementRows, { months: revenueMonths });

  return {
    refreshedAtMs: Date.now(),
    kpis: {
      totalUsers,
      monthlyActiveUsers: launchEvents30d,
      totalRevenue,
      escrowHeldBalance,
      releasedPayouts,
      refundedAmount,
      activeRequests,
      requestsInProgress,
    },
    funnel: {
      signups: safeNum(analytics?.counts?.totalSignups, 0),
      profileComplete: safeNum(analytics?.counts?.totalProfileCompletions, 0),
      journeySetup: safeNum(analytics?.counts?.journeySetupsCompleted, 0),
      weHelpOpens: safeNum(analytics?.counts?.weHelpOpens, 0),
      requestSent,
      inProgress,
      completed,
    },
    revenueTrend,
    trackDistribution: [
      { track: "study", value: safeNum(trackSelections?.study, 0) },
      { track: "work", value: safeNum(trackSelections?.work, 0) },
      { track: "travel", value: safeNum(trackSelections?.travel, 0) },
    ],
    countryDemand: countryDemandRows.map((row) => ({
      country: String(row?.countryDisplay || row?.countryKey || row?.id || "Unknown"),
      totalTaps: safeNum(row?.totalTaps, 0),
    })),
    partnerRanking,
    refundMetrics: {
      refundRate,
      autoRefundRate,
      refundCount,
      autoRefundCount,
      totalPaidCount,
    },
    sla,
  };
}


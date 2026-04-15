const crypto = require("node:crypto");

module.exports = function buildFinanceFoundation(deps = {}) {
  const {
    functions,
    onSchedule,
    logger,
    db,
    FieldValue,
    REGION,
    safeStr,
    lower,
    toNum,
    clamp,
    getUserDocByUid,
    requireAdminCallerContext,
    normalizeAdminScope,
    fetchPartnerById,
    claimEventLock,
    autoRouteRequest,
    writeManagerAuditLog,
  } = deps;

  const PAYMENT_TYPES = {
    UNLOCK_REQUEST: "unlock_request",
    IN_PROGRESS: "in_progress",
  };

  const PAYMENT_STATUSES = {
    DRAFT: "draft",
    PROMPTED: "prompted",
    ADMIN_REVIEW: "admin_review",
    APPROVED: "approved",
    PAYABLE: "payable",
    PAYMENT_SESSION_CREATED: "payment_session_created",
    AWAITING_PAYMENT: "awaiting_payment",
    PAID: "paid",
    HELD: "held",
    PAYOUT_READY: "payout_ready",
    SETTLED: "settled",
    REFUND_REQUESTED: "refund_requested",
    REFUND_UNDER_REVIEW: "refund_under_review",
    REFUNDED: "refunded",
    REVOKED: "revoked",
    EXPIRED: "expired",
    FAILED: "failed",
    AUTO_REFUNDED: "auto_refunded",
  };

  const REFUND_STATUSES = {
    REQUESTED: "requested",
    UNDER_REVIEW: "under_review",
    APPROVED: "approved",
    REJECTED: "rejected",
    REFUNDED: "refunded",
    FAILED: "failed",
    AUTO_REFUNDED: "auto_refunded",
  };

  const PAYOUT_STATUSES = {
    PENDING: "pending",
    ON_HOLD: "on_hold",
    READY: "ready",
    PROCESSING: "processing",
    PAID_OUT: "paid_out",
    FAILED: "failed",
    REVERSED: "reversed",
  };

  const FINANCE_SETTINGS_COLLECTION = "financeSettings";
  const FINANCE_SETTINGS_DOC = "global";
  const PARTNER_FINANCIAL_PROFILES = "partnerFinancialProfiles";
  const PAYOUT_QUEUE_COLLECTION = "payoutQueue";
  const SETTLEMENT_HISTORY_COLLECTION = "settlementHistory";
  const FINANCIAL_AUDIT_COLLECTION = "financialAuditLogs";
  const PAYMENT_PROVIDER_REFS_COLLECTION = "paymentProviderReferences";
  const PAYMENT_SHARE_LINKS_COLLECTION = "paymentShareLinks";
  const PAYMENT_PROVIDER_EVENTS_COLLECTION = "paymentProviderEvents";
  const DEFAULT_UNLOCK_AUTO_REFUND_HOURS = 48;
  const DEFAULT_SHARED_LINK_EXPIRY_HOURS = 72;
  const DEFAULT_ATTEMPT_REUSE_WINDOW_MS = 20 * 60 * 1000;
  const DEFAULT_PAYMENT_PENDING_WINDOW_MS = 24 * 60 * 60 * 1000;
  const SUPPORTED_PAYMENT_CURRENCIES = new Set(["KES", "USD", "NGN", "GHS", "ZAR"]);
  const FULL_PACKAGE_DEFAULT_PRICING = Object.freeze({
    study: Object.freeze({
      passport: 1700,
      "sop / motivation letter": 1400,
      ielts: 2200,
      "cv / resume": 900,
      "offer letter": 1600,
      "proof of funds": 1400,
    }),
    work: Object.freeze({
      passport: 1700,
      "sop / motivation letter": 1400,
      ielts: 2200,
      "cv / resume": 900,
      "offer letter": 1600,
      "proof of funds": 1400,
    }),
    travel: Object.freeze({
      passport: 1700,
      "sop / motivation letter": 1400,
      ielts: 2200,
      "cv / resume": 900,
      "offer letter": 1600,
      "proof of funds": 1400,
    }),
  });

  function nowMs() {
    return Date.now();
  }

  function safeEmail(value) {
    return safeStr(value).toLowerCase();
  }

  function cleanParagraph(value, max = 2000) {
    return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
  }

  function normalizeCurrency(value, fallback = "KES") {
    const currency = safeStr(value || fallback).toUpperCase().slice(0, 8);
    if (!currency) return fallback;
    return SUPPORTED_PAYMENT_CURRENCIES.has(currency) ? currency : currency;
  }

  function roundMoney(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.round(num));
  }

  function roundRate(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.round(num * 100) / 100);
  }

  function normalizeRequestBackendStatus(requestData = {}) {
    const explicit = lower(requestData?.backendStatus);
    if (
      explicit === "new" ||
      explicit === "assigned" ||
      explicit === "in_progress" ||
      explicit === "completed"
    ) {
      return explicit;
    }

    const legacyStatus = lower(requestData?.status);
    const staffStatus = lower(requestData?.staffStatus);
    const startedAtMs = Math.max(
      toNum(requestData?.staffStartedAtMs, 0),
      toNum(requestData?.markedInProgressAtMs, 0)
    );

    if (legacyStatus === "closed" || legacyStatus === "accepted" || legacyStatus === "rejected") {
      return "completed";
    }
    if (
      staffStatus === "in_progress" ||
      legacyStatus === "contacted" ||
      legacyStatus === "active" ||
      legacyStatus === "in_progress" ||
      startedAtMs > 0
    ) {
      return "in_progress";
    }
    if (safeStr(requestData?.assignedTo) || staffStatus === "assigned") {
      return "assigned";
    }
    return "new";
  }

  function shouldBlockUnlockAutoRefund(requestData = {}) {
    const backendStatus = normalizeRequestBackendStatus(requestData);
    return backendStatus === "in_progress" || backendStatus === "completed";
  }

  function moneyToMinorUnits(amount, currency = "KES") {
    const safeAmount = roundMoney(amount);
    const safeCurrency = normalizeCurrency(currency);
    if (!safeCurrency) return 0;
    return safeAmount * 100;
  }

  function buildRoutePath(requestId, scope = "user") {
    const rid = safeStr(requestId);
    if (!rid) return "";
    if (scope === "staff") return `/staff/request/${encodeURIComponent(rid)}`;
    if (scope === "admin") return `/app/admin/request/${encodeURIComponent(rid)}`;
    return `/app/request/${encodeURIComponent(rid)}`;
  }

  function requestDocRef(requestId) {
    return db.collection("serviceRequests").doc(requestId);
  }

  function paymentDocRef(requestId, paymentId) {
    return requestDocRef(requestId).collection("payments").doc(paymentId);
  }

  function paymentAttemptsCol(requestId, paymentId) {
    return paymentDocRef(requestId, paymentId).collection("attempts");
  }

  function refundDocRef(requestId, refundId) {
    return requestDocRef(requestId).collection("refundRequests").doc(refundId);
  }

  function topLevelRef(collectionName, id) {
    return db.collection(collectionName).doc(id);
  }

  function fullPackageDocRef(fullPackageId) {
    return db.collection("fullPackages").doc(fullPackageId);
  }

  function normalizeTrack(value, fallback = "study") {
    const track = lower(value);
    return track === "work" || track === "travel" ? track : fallback;
  }

  function normalizeUniqueStrings(values = [], { max = 80, itemMax = 140 } = {}) {
    const input = Array.isArray(values) ? values : [];
    const seen = new Set();
    const out = [];
    for (const value of input) {
      const clean = safeStr(value, itemMax);
      const key = lower(clean, itemMax);
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
      if (out.length >= max) break;
    }
    return out;
  }

  function normalizeFullPackageItems(values = []) {
    return normalizeUniqueStrings(values, { max: 60, itemMax: 140 });
  }

  function fullPackageItemKey(value) {
    return lower(String(value || "").replace(/\s+/g, " ").trim(), 140);
  }

  function buildItemListKey(values = []) {
    return normalizeFullPackageItems(values)
      .map((value) => fullPackageItemKey(value))
      .filter(Boolean)
      .sort()
      .join("||");
  }

  async function requireAuthenticatedCaller(context) {
    const callerUid = safeStr(context?.auth?.uid);
    if (!callerUid) {
      throw new functions.https.HttpsError("unauthenticated", "Login required");
    }
    const callerDoc = (await getUserDocByUid(callerUid)) || {};
    return {
      callerUid,
      callerDoc,
      callerEmail: safeEmail(callerDoc?.email || context?.auth?.token?.email),
    };
  }

  async function requireRequestOwner(context, requestData = {}) {
    const caller = await requireAuthenticatedCaller(context);
    if (safeStr(requestData?.uid) !== caller.callerUid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "This request is not linked to your account"
      );
    }
    return caller;
  }

  async function requireRequestAdmin(context, requestData = {}) {
    const caller = await requireAdminCallerContext(context);
    if (caller.isSuperAdmin) return caller;

    const requestAdminUid =
      safeStr(requestData?.ownerLockedAdminUid) ||
      safeStr(requestData?.currentAdminUid) ||
      safeStr(requestData?.assignedAdminId);

    if (!requestAdminUid || requestAdminUid !== caller.callerUid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You can only act on requests under your assigned admin account"
      );
    }

    const scope = normalizeAdminScope(caller?.callerDoc?.adminScope);
    const requestPartnerId = safeStr(requestData?.assignedPartnerId);
    if (requestPartnerId && safeStr(scope?.partnerId) && safeStr(scope?.partnerId) !== requestPartnerId) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "This request belongs to a different partner binding"
      );
    }

    return caller;
  }

  async function logFinanceManagerActivity(caller, action, details = "", metadata = {}) {
    if (!caller?.isManager || typeof writeManagerAuditLog !== "function") return;
    await writeManagerAuditLog({
      managerUid: caller.callerUid,
      managerEmail: safeEmail(caller?.callerDoc?.email),
      action,
      moduleKey: "finances",
      details: cleanParagraph(details, 3000),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      actorUid: caller.callerUid,
      actorEmail: safeEmail(caller?.callerDoc?.email),
      actorRole: "manager",
    });
  }

  async function requireAssignedStaffForRequest(context, requestData = {}) {
    const caller = await requireAuthenticatedCaller(context);
    if (!caller.callerUid || safeStr(requestData?.assignedTo) !== caller.callerUid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Only the assigned staff member can prompt this payment"
      );
    }
    return caller;
  }

  async function loadRequestData(requestId) {
    const safeRequestId = safeStr(requestId);
    if (!safeRequestId) {
      throw new functions.https.HttpsError("invalid-argument", "requestId is required");
    }
    const snap = await requestDocRef(safeRequestId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Request not found");
    }
    return {
      requestId: safeRequestId,
      ref: snap.ref,
      data: snap.data() || {},
    };
  }

  async function loadFullPackageData(fullPackageId, { requiredOwnerUid = "" } = {}) {
    const safeFullPackageId = safeStr(fullPackageId);
    if (!safeFullPackageId) {
      throw new functions.https.HttpsError("invalid-argument", "fullPackageId is required");
    }
    const snap = await fullPackageDocRef(safeFullPackageId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Full package was not found");
    }
    const data = snap.data() || {};
    if (safeStr(requiredOwnerUid) && safeStr(data?.uid) !== safeStr(requiredOwnerUid)) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "This full package is not linked to your account"
      );
    }
    return {
      fullPackageId: safeFullPackageId,
      ref: snap.ref,
      data,
    };
  }

  async function loadPaymentData(requestId, paymentId) {
    const safePaymentId = safeStr(paymentId);
    if (!safePaymentId) {
      throw new functions.https.HttpsError("invalid-argument", "paymentId is required");
    }
    const snap = await paymentDocRef(requestId, safePaymentId).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Payment not found");
    }
    return {
      paymentId: safePaymentId,
      ref: snap.ref,
      data: normalizePaymentRow({ id: snap.id, ...(snap.data() || {}) }),
    };
  }

  async function listFullPackagePricingRows({ track = "", country = "" } = {}) {
    const safeTrack = normalizeTrack(track);
    const safeCountry = safeStr(country, 120);
    const snap = await db.collection("pricingRules").get();
    return snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((row) => {
        return (
          lower(row?.scope) === "full_package_item" &&
          lower(row?.requestType || "full") === "full" &&
          normalizeTrack(row?.track, "") === safeTrack &&
          (!safeCountry || safeStr(row?.country, 120) === safeCountry)
        );
      });
  }

  async function computeFullPackageQuote({
    track = "",
    country = "",
    selectedItems = [],
    coveredItems = [],
  } = {}) {
    const safeTrack = normalizeTrack(track);
    const selected = normalizeFullPackageItems(selectedItems);
    const covered = normalizeFullPackageItems(coveredItems);
    const coveredKeys = new Set(covered.map((value) => fullPackageItemKey(value)));
    const payableItems = selected.filter((value) => !coveredKeys.has(fullPackageItemKey(value)));
    const pricingRows = await listFullPackagePricingRows({ track: safeTrack, country });
    const overrideMap = new Map(
      pricingRows.map((row) => [fullPackageItemKey(row?.serviceName || row?.label), row])
    );
    const fallbackMap = FULL_PACKAGE_DEFAULT_PRICING[safeTrack] || FULL_PACKAGE_DEFAULT_PRICING.study;

    let currency = "";
    const lineItems = payableItems.map((item) => {
      const key = fullPackageItemKey(item);
      const override = overrideMap.get(key);
      const amount = roundMoney(
        override?.amount != null ? override.amount : fallbackMap[key]
      );
      const lineCurrency = normalizeCurrency(override?.currency || "KES");
      if (amount <= 0) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          `Full package pricing is missing for ${item}`
        );
      }
      if (currency && lineCurrency !== currency) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "Full package items must use one currency per payment"
        );
      }
      currency = lineCurrency;
      return {
        item,
        amount,
        currency: lineCurrency,
        pricingKey: safeStr(override?.pricingKey, 180),
      };
    });

    return {
      track: safeTrack,
      country: safeStr(country, 120),
      selectedItems: selected,
      coveredItems: covered,
      payableItems,
      amount: lineItems.reduce((sum, row) => sum + roundMoney(row.amount), 0),
      currency: currency || "KES",
      lineItems,
      itemListKey: buildItemListKey(payableItems),
    };
  }

  function normalizePaymentStatus(value) {
    const status = lower(value);
    return Object.values(PAYMENT_STATUSES).includes(status) ? status : PAYMENT_STATUSES.DRAFT;
  }

  function normalizeRefundStatus(value) {
    const status = lower(value);
    return Object.values(REFUND_STATUSES).includes(status) ? status : REFUND_STATUSES.REQUESTED;
  }

  function normalizePayoutStatus(value) {
    const status = lower(value);
    return Object.values(PAYOUT_STATUSES).includes(status) ? status : PAYOUT_STATUSES.PENDING;
  }

  function normalizePaymentRow(row = {}) {
    const data = row && typeof row === "object" ? row : {};
    return {
      ...data,
      id: safeStr(data?.id),
      requestId: safeStr(data?.requestId),
      requestUid: safeStr(data?.requestUid),
      paymentType: lower(data?.paymentType),
      paymentLabel: safeStr(data?.paymentLabel) || "Payment",
      status: normalizePaymentStatus(data?.status),
      amount: roundMoney(data?.amount),
      currency: normalizeCurrency(data?.currency),
      partnerId: safeStr(data?.partnerId),
      assignedAdminId: safeStr(data?.assignedAdminId),
      createdByStaffUid: safeStr(data?.createdByStaffUid),
      unlockAutoRefundEligibleAtMs: toNum(data?.unlockAutoRefundEligibleAtMs, 0),
      latestAttemptId: safeStr(data?.latestAttemptId),
      latestReference: safeStr(data?.latestReference),
      transactionReference: safeStr(data?.transactionReference || data?.providerReference),
      paidAtMs: toNum(data?.paidAtMs, 0),
      approvedAtMs: toNum(data?.approvedAtMs, 0),
      refundedAtMs: toNum(data?.refundedAtMs, 0),
      createdAtMs: toNum(data?.createdAtMs, 0),
      shareLink: data?.shareLink && typeof data.shareLink === "object" ? data.shareLink : null,
      breakdown: data?.breakdown && typeof data.breakdown === "object" ? data.breakdown : null,
      financialSnapshot:
        data?.financialSnapshot && typeof data.financialSnapshot === "object"
          ? data.financialSnapshot
          : null,
      latestAttempt:
        data?.latestAttempt && typeof data.latestAttempt === "object" ? data.latestAttempt : null,
      payoutState:
        data?.payoutState && typeof data.payoutState === "object" ? data.payoutState : null,
      refundState:
        data?.refundState && typeof data.refundState === "object" ? data.refundState : null,
    };
  }

  function isTerminalPaymentStatus(status) {
    const safeStatus = normalizePaymentStatus(status);
    return new Set([
      PAYMENT_STATUSES.REFUNDED,
      PAYMENT_STATUSES.AUTO_REFUNDED,
      PAYMENT_STATUSES.REVOKED,
      PAYMENT_STATUSES.SETTLED,
      PAYMENT_STATUSES.EXPIRED,
    ]).has(safeStatus);
  }

  function canCreateCheckoutForStatus(status) {
    const safeStatus = normalizePaymentStatus(status);
    return new Set([
      PAYMENT_STATUSES.PAYABLE,
      PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
      PAYMENT_STATUSES.AWAITING_PAYMENT,
      PAYMENT_STATUSES.FAILED,
    ]).has(safeStatus);
  }

  function makeNotificationId(prefix, ...parts) {
    return [prefix, ...parts.map((part) => safeStr(part).replace(/[^a-zA-Z0-9_-]+/g, "_"))]
      .filter(Boolean)
      .join("_")
      .slice(0, 220);
  }

  async function writeNotificationDoc(uid, notificationId, payload = {}) {
    const targetUid = safeStr(uid);
    const docId = safeStr(notificationId);
    if (!targetUid || !docId) return;

    await db
      .collection("users")
      .doc(targetUid)
      .collection("notifications")
      .doc(docId)
      .set(
        {
          type: safeStr(payload?.type || "PAYMENT_UPDATE"),
          title: safeStr(payload?.title || "Payment update"),
          body: safeStr(payload?.body || "You have a new finance update."),
          route: safeStr(payload?.route),
          requestId: safeStr(payload?.requestId) || null,
          paymentId: safeStr(payload?.paymentId) || null,
          refundId: safeStr(payload?.refundId) || null,
          amount: roundMoney(payload?.amount),
          currency: normalizeCurrency(payload?.currency || "KES"),
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs(),
          readAt: null,
          role: safeStr(payload?.role || "user"),
        },
        { merge: true }
      );
  }

  async function notifyPaymentParties({
    requestData = {},
    payment = {},
    type = "PAYMENT_UPDATE",
    title = "Payment update",
    body = "",
    refundId = "",
  } = {}) {
    const requestId = safeStr(requestData?.id || payment?.requestId);
    const userUid = safeStr(requestData?.uid || payment?.requestUid);
    const adminUid =
      safeStr(requestData?.ownerLockedAdminUid) ||
      safeStr(requestData?.currentAdminUid) ||
      safeStr(requestData?.assignedAdminId);
    const staffUid = safeStr(requestData?.assignedTo || payment?.createdByStaffUid);
    const paymentId = safeStr(payment?.id);
    const currency = normalizeCurrency(payment?.currency || "KES");
    const amount = roundMoney(payment?.amount);

    await Promise.allSettled(
      [
        userUid
          ? writeNotificationDoc(userUid, makeNotificationId("finance_user", type, requestId, paymentId), {
              type,
              title,
              body,
              route: buildRoutePath(requestId, "user"),
              requestId,
              paymentId,
              refundId,
              amount,
              currency,
              role: "user",
            })
          : null,
        adminUid
          ? writeNotificationDoc(adminUid, makeNotificationId("finance_admin", type, requestId, paymentId), {
              type,
              title,
              body,
              route: buildRoutePath(requestId, "admin"),
              requestId,
              paymentId,
              refundId,
              amount,
              currency,
              role: "admin",
            })
          : null,
        staffUid
          ? writeNotificationDoc(staffUid, makeNotificationId("finance_staff", type, requestId, paymentId), {
              type,
              title,
              body,
              route: buildRoutePath(requestId, "staff"),
              requestId,
              paymentId,
              refundId,
              amount,
              currency,
              role: "staff",
            })
          : null,
      ].filter(Boolean)
    );
  }

  async function logFinancialAudit({
    action = "",
    requestId = "",
    paymentId = "",
    payoutQueueId = "",
    refundId = "",
    actorUid = "",
    actorRole = "",
    reason = "",
    previous = null,
    next = null,
    metadata = null,
  } = {}) {
    const auditRef = db.collection(FINANCIAL_AUDIT_COLLECTION).doc();
    await auditRef.set({
      action: safeStr(action),
      requestId: safeStr(requestId),
      paymentId: safeStr(paymentId),
      payoutQueueId: safeStr(payoutQueueId),
      refundId: safeStr(refundId),
      actorUid: safeStr(actorUid) || "system",
      actorRole: safeStr(actorRole) || "system",
      reason: cleanParagraph(reason, 400),
      previous: previous && typeof previous === "object" ? previous : null,
      next: next && typeof next === "object" ? next : null,
      metadata: metadata && typeof metadata === "object" ? metadata : null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs(),
    });
  }

  function normalizeFeeType(value, fallback = "percentage") {
    const raw = lower(value);
    return raw === "flat" ? "flat" : fallback === "flat" ? "flat" : "percentage";
  }

  function normalizeTaxMode(value, fallback = "exclusive") {
    const raw = lower(value);
    if (raw === "inclusive") return "inclusive";
    return fallback === "inclusive" ? "inclusive" : "exclusive";
  }

  function defaultFinanceSettings() {
    return {
      provider: {
        name: "paystack",
        environment: "test",
        callbackBaseUrl: "",
      },
      inProgressPricing: {
        defaultCurrency: "KES",
        allowServiceFeeInput: true,
        allowAdminAdjustAmounts: true,
      },
      platformFee: {
        defaultCutType: "percentage",
        defaultCutValue: 10,
        cutBase: "official_plus_service_fee",
      },
      tax: {
        enabled: false,
        label: "Tax",
        type: "percentage",
        rate: 0,
        mode: "exclusive",
      },
      refundControls: {
        unlockAutoRefundHours: DEFAULT_UNLOCK_AUTO_REFUND_HOURS,
        autoRefundEnabled: true,
        sharedLinkExpiryHours: DEFAULT_SHARED_LINK_EXPIRY_HOURS,
      },
      payoutControls: {
        manualReleaseOnly: true,
        requireDestination: true,
        deductProcessorFeeFromPartner: false,
      },
    };
  }

  function normalizeFinanceSettings(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const defaults = defaultFinanceSettings();
    return {
      provider: {
        name: "paystack",
        environment: lower(source?.provider?.environment || defaults.provider.environment) === "live"
          ? "live"
          : "test",
        callbackBaseUrl: safeStr(
          source?.provider?.callbackBaseUrl || defaults.provider.callbackBaseUrl,
          400
        ),
      },
      inProgressPricing: {
        defaultCurrency: normalizeCurrency(
          source?.inProgressPricing?.defaultCurrency || defaults.inProgressPricing.defaultCurrency
        ),
        allowServiceFeeInput: source?.inProgressPricing?.allowServiceFeeInput !== false,
        allowAdminAdjustAmounts: source?.inProgressPricing?.allowAdminAdjustAmounts !== false,
      },
      platformFee: {
        defaultCutType: normalizeFeeType(
          source?.platformFee?.defaultCutType || defaults.platformFee.defaultCutType
        ),
        defaultCutValue: roundRate(
          source?.platformFee?.defaultCutValue ?? defaults.platformFee.defaultCutValue
        ),
        cutBase:
          lower(source?.platformFee?.cutBase) === "official_amount"
            ? "official_amount"
            : "official_plus_service_fee",
      },
      tax: {
        enabled: source?.tax?.enabled === true,
        label: safeStr(source?.tax?.label || defaults.tax.label, 80) || "Tax",
        type: normalizeFeeType(source?.tax?.type || defaults.tax.type),
        rate: roundRate(source?.tax?.rate ?? defaults.tax.rate),
        mode: normalizeTaxMode(source?.tax?.mode || defaults.tax.mode),
      },
      refundControls: {
        unlockAutoRefundHours: clamp(
          toNum(source?.refundControls?.unlockAutoRefundHours, DEFAULT_UNLOCK_AUTO_REFUND_HOURS),
          1,
          720
        ),
        autoRefundEnabled: source?.refundControls?.autoRefundEnabled !== false,
        sharedLinkExpiryHours: clamp(
          toNum(source?.refundControls?.sharedLinkExpiryHours, DEFAULT_SHARED_LINK_EXPIRY_HOURS),
          1,
          720
        ),
      },
      payoutControls: {
        manualReleaseOnly: source?.payoutControls?.manualReleaseOnly !== false,
        requireDestination: source?.payoutControls?.requireDestination !== false,
        deductProcessorFeeFromPartner:
          source?.payoutControls?.deductProcessorFeeFromPartner === true,
      },
    };
  }

  async function getFinanceSettings() {
    const snap = await topLevelRef(FINANCE_SETTINGS_COLLECTION, FINANCE_SETTINGS_DOC).get();
    return normalizeFinanceSettings(snap.exists ? snap.data() || {} : {});
  }

  function defaultPartnerFinancialProfile(partner = {}) {
    return {
      partnerId: safeStr(partner?.id),
      partnerName: safeStr(partner?.displayName),
      activeFinancialStatus: "active",
      defaultPlatformCutType: "percentage",
      defaultPlatformCutValue: 10,
      platformCutBase: "official_plus_service_fee",
      taxProfileReference: "",
      taxOverrides: null,
      payoutReleaseBehavior: "manual_review",
      payoutDestinationReady: false,
      payoutDestination: null,
      notes: "",
      effectiveAtMs: nowMs(),
    };
  }

  function normalizePayoutDestination(input = {}) {
    const source = input && typeof input === "object" ? input : {};
    const type = safeStr(source?.type || "bank_transfer", 40) || "bank_transfer";
    const last4 = safeStr(source?.accountNumberLast4, 8).slice(-4);
    const accountName = safeStr(source?.accountName, 120);
    const bankName = safeStr(source?.bankName, 120);
    const reference = safeStr(
      source?.reference || source?.transferRecipientCode || source?.subaccountCode,
      160
    );
    const hasAny = Boolean(last4 || accountName || bankName || reference);
    return hasAny
      ? {
          type,
          bankName,
          accountName,
          accountNumberLast4: last4,
          reference,
        }
      : null;
  }

  function normalizePartnerFinancialProfile(input = {}, partner = {}) {
    const source = input && typeof input === "object" ? input : {};
    const defaults = defaultPartnerFinancialProfile(partner);
    return {
      partnerId: safeStr(source?.partnerId || defaults.partnerId),
      partnerName: safeStr(source?.partnerName || defaults.partnerName),
      activeFinancialStatus:
        lower(source?.activeFinancialStatus || defaults.activeFinancialStatus) === "inactive"
          ? "inactive"
          : "active",
      defaultPlatformCutType: normalizeFeeType(
        source?.defaultPlatformCutType || defaults.defaultPlatformCutType
      ),
      defaultPlatformCutValue: roundRate(
        source?.defaultPlatformCutValue ?? defaults.defaultPlatformCutValue
      ),
      platformCutBase:
        lower(source?.platformCutBase || defaults.platformCutBase) === "official_amount"
          ? "official_amount"
          : "official_plus_service_fee",
      taxProfileReference: safeStr(
        source?.taxProfileReference || defaults.taxProfileReference,
        160
      ),
      taxOverrides:
        source?.taxOverrides && typeof source.taxOverrides === "object"
          ? {
              enabled: source.taxOverrides.enabled === true,
              label: safeStr(source.taxOverrides.label, 80),
              type: normalizeFeeType(source.taxOverrides.type || "percentage"),
              rate: roundRate(source.taxOverrides.rate),
              mode: normalizeTaxMode(source.taxOverrides.mode || "exclusive"),
            }
          : null,
      payoutReleaseBehavior:
        lower(source?.payoutReleaseBehavior || defaults.payoutReleaseBehavior) === "auto_release"
          ? "auto_release"
          : "manual_review",
      payoutDestinationReady: source?.payoutDestinationReady === true,
      payoutDestination: normalizePayoutDestination(
        source?.payoutDestination || defaults.payoutDestination
      ),
      notes: cleanParagraph(source?.notes || defaults.notes, 4000),
      effectiveAtMs: clamp(toNum(source?.effectiveAtMs, defaults.effectiveAtMs), 0, 9999999999999),
      updatedAtMs: nowMs(),
    };
  }

  async function getPartnerFinancialProfile(partnerId, partnerDoc = null) {
    const safePartnerId = safeStr(partnerId);
    if (!safePartnerId) {
      throw new functions.https.HttpsError("failed-precondition", "Partner binding is missing");
    }
    const partner = partnerDoc || (await fetchPartnerById(safePartnerId));
    if (!partner?.id) {
      throw new functions.https.HttpsError("failed-precondition", "Assigned partner was not found");
    }
    const snap = await topLevelRef(PARTNER_FINANCIAL_PROFILES, safePartnerId).get();
    return normalizePartnerFinancialProfile(snap.exists ? snap.data() || {} : {}, partner);
  }

  function resolveTaxConfig(settings, partnerProfile) {
    const overrides =
      partnerProfile?.taxOverrides && typeof partnerProfile.taxOverrides === "object"
        ? partnerProfile.taxOverrides
        : null;
    const base = overrides || settings.tax;
    return {
      enabled: base?.enabled === true,
      label: safeStr(base?.label || "Tax", 80) || "Tax",
      type: normalizeFeeType(base?.type || "percentage"),
      rate: roundRate(base?.rate),
      mode: normalizeTaxMode(base?.mode || "exclusive"),
    };
  }

  function calculateBreakdown({
    officialAmount = 0,
    serviceFee = 0,
    currency = "KES",
    requestId = "",
    partnerId = "",
    assignedAdminId = "",
    partnerProfile = {},
    settings = defaultFinanceSettings(),
  } = {}) {
    const safeOfficialAmount = roundMoney(officialAmount);
    const safeServiceFee = roundMoney(serviceFee);
    const safeCurrency = normalizeCurrency(
      currency,
      settings?.inProgressPricing?.defaultCurrency || "KES"
    );
    const subtotal = safeOfficialAmount + safeServiceFee;
    const cutType = normalizeFeeType(
      partnerProfile?.defaultPlatformCutType || settings?.platformFee?.defaultCutType
    );
    const cutValue = roundRate(
      partnerProfile?.defaultPlatformCutValue ?? settings?.platformFee?.defaultCutValue
    );
    const cutBase =
      lower(partnerProfile?.platformCutBase || settings?.platformFee?.cutBase) === "official_amount"
        ? safeOfficialAmount
        : subtotal;
    const platformCutAmount =
      cutType === "flat"
        ? roundMoney(cutValue)
        : roundMoney((cutBase * cutValue) / 100);

    const tax = resolveTaxConfig(settings, partnerProfile);
    let taxAmount = 0;
    let finalUserPayable = subtotal;
    if (tax.enabled) {
      if (tax.type === "flat") {
        taxAmount = roundMoney(tax.rate);
        finalUserPayable = tax.mode === "inclusive" ? subtotal : subtotal + taxAmount;
      } else if (tax.mode === "inclusive") {
        taxAmount = roundMoney((subtotal * tax.rate) / (100 + tax.rate));
        finalUserPayable = subtotal;
      } else {
        taxAmount = roundMoney((subtotal * tax.rate) / 100);
        finalUserPayable = subtotal + taxAmount;
      }
    }

    const estimatedProcessorFee = 0;
    const estimatedNetPartnerPayable = Math.max(
      0,
      subtotal -
        platformCutAmount -
        (settings?.payoutControls?.deductProcessorFeeFromPartner ? estimatedProcessorFee : 0)
    );

    return {
      officialAmount: safeOfficialAmount,
      serviceFee: safeServiceFee,
      platformCutType: cutType,
      platformCutValue: cutValue,
      platformCutAmount,
      platformCutBase:
        lower(partnerProfile?.platformCutBase || settings?.platformFee?.cutBase) === "official_amount"
          ? "official_amount"
          : "official_plus_service_fee",
      taxEnabled: tax.enabled,
      taxType: tax.type,
      taxRate: tax.rate,
      taxMode: tax.mode,
      taxLabel: tax.label,
      taxAmount,
      finalUserPayable,
      estimatedProcessorFee,
      estimatedNetPartnerPayable,
      currency: safeCurrency,
      partnerId: safeStr(partnerId),
      assignedAdminId: safeStr(assignedAdminId),
      requestId: safeStr(requestId),
    };
  }

  function buildFinancialSnapshot({
    requestId = "",
    paymentId = "",
    requestData = {},
    paymentLabel = "",
    note = "",
    breakdown = {},
    partnerProfile = {},
    settings = {},
    actorUid = "",
    actorRole = "",
    promptedByStaffUid = "",
    approvedAtMs = nowMs(),
  } = {}) {
    return {
      snapshotVersion: 1,
      requestId: safeStr(requestId),
      paymentId: safeStr(paymentId),
      partnerId: safeStr(requestData?.assignedPartnerId || breakdown?.partnerId),
      partnerName: safeStr(requestData?.assignedPartnerName),
      assignedAdminId: safeStr(requestData?.assignedAdminId || breakdown?.assignedAdminId),
      promptedByStaffUid: safeStr(promptedByStaffUid),
      approvedByUid: safeStr(actorUid),
      approvedByRole: safeStr(actorRole),
      paymentLabel: safeStr(paymentLabel, 180),
      note: cleanParagraph(note, 2000),
      officialAmount: roundMoney(breakdown?.officialAmount),
      serviceFee: roundMoney(breakdown?.serviceFee),
      platformCutType: safeStr(breakdown?.platformCutType),
      platformCutValue: roundRate(breakdown?.platformCutValue),
      platformCutAmount: roundMoney(breakdown?.platformCutAmount),
      platformCutBase: safeStr(breakdown?.platformCutBase),
      taxEnabled: breakdown?.taxEnabled === true,
      taxType: safeStr(breakdown?.taxType),
      taxRate: roundRate(breakdown?.taxRate),
      taxLabel: safeStr(breakdown?.taxLabel),
      taxMode: safeStr(breakdown?.taxMode),
      taxAmount: roundMoney(breakdown?.taxAmount),
      finalUserPayable: roundMoney(breakdown?.finalUserPayable),
      estimatedProcessorFee: roundMoney(breakdown?.estimatedProcessorFee),
      estimatedNetPartnerPayable: roundMoney(breakdown?.estimatedNetPartnerPayable),
      currency: normalizeCurrency(breakdown?.currency || "KES"),
      partnerFinancialStatus: safeStr(partnerProfile?.activeFinancialStatus),
      payoutReleaseBehavior: safeStr(partnerProfile?.payoutReleaseBehavior),
      provider: safeStr(settings?.provider?.name || "paystack"),
      environment: safeStr(settings?.provider?.environment || "test"),
      approvedAtMs: clamp(toNum(approvedAtMs, nowMs()), 0, 9999999999999),
      createdAtMs: nowMs(),
    };
  }

  function buildProviderStatus(settings = {}) {
    const environment =
      lower(settings?.provider?.environment || "test") === "live" ? "live" : "test";
    const secretKey =
      environment === "live"
        ? safeStr(process.env.PAYSTACK_SECRET_KEY_LIVE)
        : safeStr(process.env.PAYSTACK_SECRET_KEY_TEST);
    const callbackBaseUrl = safeStr(
      settings?.provider?.callbackBaseUrl || process.env.PAYSTACK_CALLBACK_BASE_URL,
      400
    );
    return {
      provider: "paystack",
      environment,
      callbackBaseUrl,
      callbackConfigured: Boolean(callbackBaseUrl),
      secretConfigured: Boolean(secretKey),
      ready: Boolean(secretKey && callbackBaseUrl),
      secretKey,
    };
  }

  function buildPublicProviderStatus(status = {}) {
    return {
      provider: safeStr(status?.provider || "paystack"),
      environment: safeStr(status?.environment || "test"),
      callbackBaseUrl: safeStr(status?.callbackBaseUrl),
      callbackConfigured: Boolean(status?.callbackConfigured),
      secretConfigured: Boolean(status?.secretConfigured),
      ready: Boolean(status?.ready),
    };
  }

  function buildCheckoutConfigError(status = {}) {
    const publicStatus = buildPublicProviderStatus(status);
    if (!status?.secretConfigured && !status?.callbackConfigured) {
      return new functions.https.HttpsError(
        "failed-precondition",
        "Paystack secret key and callback URL are not configured yet",
        {
          reason: "provider_config_missing",
          providerStatus: publicStatus,
        }
      );
    }
    if (!status?.secretConfigured) {
      return new functions.https.HttpsError(
        "failed-precondition",
        "Paystack secret key is not configured yet",
        {
          reason: "provider_secret_missing",
          providerStatus: publicStatus,
        }
      );
    }
    if (!status?.callbackConfigured) {
      return new functions.https.HttpsError(
        "failed-precondition",
        "Finance callback URL is not configured yet",
        {
          reason: "provider_callback_missing",
          providerStatus: publicStatus,
        }
      );
    }
    return new functions.https.HttpsError(
      "failed-precondition",
      "Finance provider is not configured yet",
      {
        reason: "provider_not_ready",
        providerStatus: publicStatus,
      }
    );
  }

  // checkout + payment mutation helpers
  function buildCallbackUrl({
    baseUrl = "",
    reference = "",
    requestId = "",
    paymentId = "",
    payerMode = "direct_user",
    returnTo = "",
    draftId = "",
    shareToken = "",
  } = {}) {
    const safeBaseUrl = safeStr(baseUrl, 400).replace(/\/+$/, "");
    if (!safeBaseUrl) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Finance callback URL is not configured"
      );
    }
    const url = new URL(`${safeBaseUrl}/payment/callback`);
    if (safeStr(reference)) url.searchParams.set("reference", safeStr(reference));
    if (safeStr(requestId)) url.searchParams.set("requestId", safeStr(requestId));
    if (safeStr(paymentId)) url.searchParams.set("paymentId", safeStr(paymentId));
    if (safeStr(payerMode)) url.searchParams.set("payerMode", safeStr(payerMode));
    if (safeStr(returnTo, 600)) url.searchParams.set("returnTo", safeStr(returnTo, 600));
    if (safeStr(draftId)) url.searchParams.set("draft", safeStr(draftId));
    if (safeStr(shareToken, 400)) url.searchParams.set("share", safeStr(shareToken, 400));
    return url.toString();
  }

  function buildInternalReference(prefix = "MJ") {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const rand = crypto.randomBytes(5).toString("hex").toUpperCase();
    return `${safeStr(prefix, 12).toUpperCase()}-${stamp}-${rand}`;
  }

  function hashShareToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
  }

  async function callPaystack({
    method = "GET",
    path = "/",
    body = null,
    secretKey = "",
  } = {}) {
    const safeSecretKey = safeStr(secretKey);
    if (!safeSecretKey) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Paystack secret key is not configured"
      );
    }

    const options = {
      method,
      headers: {
        Authorization: `Bearer ${safeSecretKey}`,
        "Content-Type": "application/json",
      },
    };

    if (body != null) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`https://api.paystack.co${path}`, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Paystack returned an unreadable response (${response.status})`);
    }

    if (!response.ok || payload?.status !== true) {
      throw new Error(
        safeStr(payload?.message || `Paystack request failed (${response.status})`, 300) ||
          "Paystack request failed"
      );
    }

    return payload;
  }

  async function initializePaystackTransaction({
    email = "",
    amountMinor = 0,
    currency = "KES",
    reference = "",
    callbackUrl = "",
    metadata = null,
    secretKey = "",
  } = {}) {
    return callPaystack({
      method: "POST",
      path: "/transaction/initialize",
      body: {
        email: safeEmail(email),
        amount: String(Math.max(0, roundMoney(amountMinor))),
        currency: normalizeCurrency(currency),
        reference: safeStr(reference, 120),
        callback_url: safeStr(callbackUrl, 400),
        metadata: metadata && typeof metadata === "object" ? metadata : {},
      },
      secretKey,
    });
  }

  async function verifyPaystackTransaction(reference, secretKey) {
    return callPaystack({
      method: "GET",
      path: `/transaction/verify/${encodeURIComponent(safeStr(reference, 120))}`,
      secretKey,
    });
  }

  async function createPaystackRefund({
    transaction = "",
    amountMinor = 0,
    merchantNote = "",
    customerNote = "",
    secretKey = "",
  } = {}) {
    return callPaystack({
      method: "POST",
      path: "/refund",
      body: {
        transaction: safeStr(transaction),
        amount: Math.max(0, roundMoney(amountMinor)),
        merchant_note: cleanParagraph(merchantNote, 300),
        customer_note: cleanParagraph(customerNote, 300),
      },
      secretKey,
    });
  }

  function summarizePaystackVerification(payload = {}) {
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    return {
      id: data?.id ?? null,
      domain: safeStr(data?.domain, 40),
      status: lower(data?.status),
      reference: safeStr(data?.reference, 120),
      amount: roundMoney(data?.amount),
      currency: normalizeCurrency(data?.currency || "KES"),
      paidAt: safeStr(data?.paid_at || data?.paidAt, 80),
      gatewayResponse: safeStr(data?.gateway_response, 160),
      channel: safeStr(data?.channel, 80),
      fees: roundMoney(data?.fees),
      customerEmail: safeEmail(data?.customer?.email),
      authorization:
        data?.authorization && typeof data.authorization === "object"
          ? {
              brand: safeStr(data.authorization.brand, 80),
              reusable: data.authorization.reusable === true,
              signature: safeStr(data.authorization.signature, 120),
            }
          : null,
    };
  }

  function summarizePaystackRefund(payload = {}) {
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    return {
      refundId: safeStr(data?.id, 120),
      transactionId: safeStr(data?.transaction, 120),
      status: lower(data?.status || data?.refund_status || "pending"),
      currency: normalizeCurrency(data?.currency || "KES"),
      amount: roundMoney(data?.amount),
    };
  }

  function buildPaymentShareToken() {
    return crypto.randomBytes(20).toString("hex");
  }

  async function getShareLinkData(token = "") {
    const safeToken = safeStr(token, 400);
    if (!safeToken) {
      throw new functions.https.HttpsError("invalid-argument", "shareToken is required");
    }
    const tokenHash = hashShareToken(safeToken);
    const snap = await topLevelRef(PAYMENT_SHARE_LINKS_COLLECTION, tokenHash).get();
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Payment link was not found");
    }
    return {
      token: safeToken,
      tokenHash,
      data: snap.data() || {},
    };
  }

  function buildUnlockPaymentPayload({
    requestId = "",
    requestData = {},
    amount = 0,
    currency = "KES",
    actorUid = "",
    draftId = "",
  } = {}) {
    const createdMs = nowMs();
    return {
      requestId: safeStr(requestId),
      requestUid: safeStr(requestData?.uid),
      paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
      paymentLabel: "Unlock request payment",
      status: PAYMENT_STATUSES.PAYABLE,
      amount: roundMoney(amount),
      currency: normalizeCurrency(currency),
      createdByUid: safeStr(actorUid),
      createdByRole: "user",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: createdMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: createdMs,
      draftId: safeStr(draftId, 160),
      partnerId: safeStr(requestData?.assignedPartnerId),
      assignedAdminId: safeStr(requestData?.assignedAdminId),
      financialSnapshot: {
        snapshotVersion: 1,
        requestId: safeStr(requestId),
        paymentLabel: "Unlock request payment",
        finalUserPayable: roundMoney(amount),
        currency: normalizeCurrency(currency),
        provider: "paystack",
        environment: "pending",
        createdAtMs: createdMs,
      },
      unlockAutoRefundEligibleAtMs: 0,
      unlockAutoRefundStatus: "pending",
      latestAttemptId: "",
      latestReference: "",
      latestAttempt: null,
      payoutState: null,
      refundState: null,
    };
  }

  async function ensureUnlockPaymentRecord({
    requestId = "",
    requestData = {},
    actorUid = "",
    draftId = "",
  } = {}) {
    const paymentId = safeStr(requestData?.unlockPaymentId) || "unlock_request_payment";
    const ref = paymentDocRef(requestId, paymentId);
    const snap = await ref.get();
    if (snap.exists) {
      return {
        paymentId,
        ref,
        data: normalizePaymentRow({ id: snap.id, ...(snap.data() || {}) }),
      };
    }

    const amount = roundMoney(
      requestData?.pricingSnapshot?.amount || requestData?.paymentExpectedAmount || 0
    );
    const currency = normalizeCurrency(
      requestData?.pricingSnapshot?.currency || requestData?.paymentExpectedCurrency || "KES"
    );
    if (amount <= 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Unlock request pricing is missing for this request"
      );
    }

    const payload = buildUnlockPaymentPayload({
      requestId,
      requestData,
      amount,
      currency,
      actorUid,
      draftId,
    });

    await ref.set(payload, { merge: true });
    await requestDocRef(requestId).set(
      {
        unlockPaymentId: paymentId,
        unlockPaymentRequestId: requestId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      paymentId,
      ref,
      data: normalizePaymentRow({ id: paymentId, ...payload }),
    };
  }

  async function createFullPackageUnlockRequest({
    caller = {},
    fullPackage = {},
    quote = {},
    draftId = "",
  } = {}) {
    const currentMs = nowMs();
    const requestRef = requestDocRef(db.collection("serviceRequests").doc().id);
    const track = normalizeTrack(fullPackage?.track || quote?.track);
    const country = safeStr(fullPackage?.country || quote?.country, 120);
    const payableItems = normalizeFullPackageItems(quote?.payableItems);
    const amount = roundMoney(quote?.amount);
    const currency = normalizeCurrency(quote?.currency || "KES");

    const payload = {
      uid: safeStr(fullPackage?.uid || caller?.callerUid),
      email: safeEmail(fullPackage?.email || caller?.callerEmail),
      track,
      country,
      requestType: "full",
      serviceName: "Full Package Unlock",
      name: "",
      phone: "",
      note: "Backend-managed full package unlock payment",
      county: "package_flow",
      countyLower: "package_flow",
      preferredAgentId: "",
      preferredAgentName: "",
      preferredAgentStatus: "none",
      preferredAgentInvalidReason: "",
      preferredAgentInvalidMessage: "",
      preferredAgentValidatedAtMs: currentMs,
      assignedPartnerId: "",
      assignedPartnerName: "",
      assignedAdminId: "",
      routingStatus: "awaiting_payment",
      missingItems: payableItems,
      parentRequestId: "",
      isFullPackage: false,
      fullPackageId: safeStr(fullPackage?.id),
      fullPackageItem: "",
      fullPackageItemKey: "",
      fullPackageSelectedItems: payableItems,
      paid: false,
      paymentMeta: null,
      pricingSnapshot: {
        pricingKey: "",
        scope: "full_package_item",
        requestType: "full",
        track,
        country,
        serviceName: "Full Package Unlock",
        label: "Full Package Unlock",
        amount,
        defaultAmount: amount,
        currency,
        updatedAtMs: currentMs,
      },
      unlockPaymentId: "",
      unlockPaymentRequestId: "",
      requestUploadMeta: null,
      extraFieldAnswers: null,
      status: "payment_pending",
      backendStatus: "new",
      userStatus: "",
      everAssigned: false,
      currentAdminUid: "",
      currentAdminRole: "",
      currentAdminEmail: "",
      currentAdminAvailability: "",
      ownerLockedAdminUid: "",
      markedInProgressAt: null,
      markedInProgressAtMs: 0,
      staffProgressPercent: null,
      staffProgressUpdatedAt: null,
      staffProgressUpdatedAtMs: 0,
      escalationCount: 0,
      responseDeadlineAtMs: 0,
      routingMeta: {
        track,
        country,
        county: "package_flow",
        town: "",
        currentAdminUid: "",
        currentAdminEmail: "",
        assignedAdminId: "",
        assignedPartnerId: "",
        assignedPartnerName: "",
        preferredAgentId: "",
        preferredAgentName: "",
        preferredAgentStatus: "none",
        preferredAgentInvalidReason: "",
        preferredAgentInvalidMessage: "",
        routedAtMs: 0,
        routingReason: "awaiting_full_package_unlock_payment",
        routingStatus: "awaiting_payment",
        adminAvailabilityAtRouting: "",
        escalationReason: "",
        unresolvedReason: "",
        partnerDecisionSource: "",
        countyMatchType: "",
        eligiblePartnerCount: 0,
        eligibleAdminCount: 0,
        escalationCount: 0,
        reassignmentHistory: [],
        acceptedAtMs: 0,
        lockedOwnerAdminUid: "",
      },
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: currentMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: currentMs,
      paymentFlowType: "full_package_unlock",
      fullPackageUnlockMeta: {
        fullPackageId: safeStr(fullPackage?.id),
        selectedItems: payableItems,
        coveredItemsBefore: normalizeFullPackageItems(
          fullPackage?.unlockCoverage?.coveredItems || []
        ),
        draftId: safeStr(draftId, 160),
      },
    };

    await requestRef.set(payload, { merge: true });
    await fullPackageDocRef(fullPackage?.id).set(
      {
        latestUnlockRequestId: requestRef.id,
        latestUnlockItemsKey: buildItemListKey(payableItems),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: currentMs,
      },
      { merge: true }
    );

    return {
      requestId: requestRef.id,
      ref: requestRef,
      data: payload,
    };
  }

  async function applyVerifiedFullPackageUnlock({
    requestId = "",
    paymentId = "",
    requestData = {},
    payment = {},
    transactionReference = "",
    paidAtMs = 0,
  } = {}) {
    if (lower(requestData?.paymentFlowType) !== "full_package_unlock") return null;

    const fullPackageId = safeStr(
      requestData?.fullPackageId || requestData?.fullPackageUnlockMeta?.fullPackageId
    );
    if (!fullPackageId) {
      throw new Error("Full package unlock request is missing linkage");
    }

    const fullPackage = await loadFullPackageData(fullPackageId, {
      requiredOwnerUid: safeStr(requestData?.uid),
    });

    const alreadyCovered = normalizeFullPackageItems(
      fullPackage.data?.unlockCoverage?.coveredItems || []
    );
    const coveredSet = new Set(alreadyCovered.map((item) => fullPackageItemKey(item)));
    const newlyPaidItems = normalizeFullPackageItems(
      requestData?.fullPackageSelectedItems ||
        requestData?.fullPackageUnlockMeta?.selectedItems ||
        []
    );
    const mergedCovered = normalizeFullPackageItems([...alreadyCovered, ...newlyPaidItems]);
    const mergedCoveredSet = new Set(mergedCovered.map((item) => fullPackageItemKey(item)));
    const currentSelected = normalizeFullPackageItems(fullPackage.data?.selectedItems || []);
    const outstandingItems = currentSelected.filter(
      (item) => !mergedCoveredSet.has(fullPackageItemKey(item))
    );
    const paymentsCount =
      Math.max(0, toNum(fullPackage.data?.unlockCoverage?.paymentsCount, 0)) +
      (newlyPaidItems.some((item) => !coveredSet.has(fullPackageItemKey(item))) ? 1 : 0);
    const unlockPaymentMeta = {
      status: "paid",
      method: "paystack",
      paidAt: paidAtMs || nowMs(),
      amount: roundMoney(payment?.amount),
      currency: normalizeCurrency(payment?.currency || "KES"),
      ref: safeStr(transactionReference, 160),
      requestId: safeStr(requestId),
      paymentId: safeStr(paymentId),
    };

    await fullPackage.ref.set(
      {
        track: normalizeTrack(fullPackage.data?.track || requestData?.track),
        country: safeStr(fullPackage.data?.country || requestData?.country, 120),
        unlockPaid: mergedCovered.length > 0,
        unlockPaymentMeta,
        depositPaid: mergedCovered.length > 0,
        depositPaymentMeta: unlockPaymentMeta,
        unlockCoverage: {
          coveredItems: mergedCovered,
          outstandingItems,
          paymentsCount,
          lastPaidRequestId: safeStr(requestId),
          lastPaymentId: safeStr(paymentId),
          lastPaymentReference: safeStr(transactionReference, 160),
          lastPaidAtMs: paidAtMs || nowMs(),
        },
        latestUnlockRequestId: safeStr(requestId),
        latestUnlockItemsKey: buildItemListKey(newlyPaidItems),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "full_package_unlock_verified",
      requestId,
      paymentId,
      actorUid: "system",
      actorRole: "payment_verify",
      next: {
        fullPackageId,
        coveredItems: mergedCovered,
        outstandingItems,
      },
    });

    return {
      fullPackageId,
      coveredItems: mergedCovered,
      outstandingItems,
      paymentsCount,
    };
  }

  async function createOrReuseCheckoutSession({
    requestData = {},
    requestId = "",
    payment = {},
    paymentRef = null,
    payerMode = "direct_user",
    payerEmail = "",
    callerUid = "",
    appBaseUrl = "",
    returnTo = "",
    draftId = "",
    shareToken = "",
  } = {}) {
    const settings = await getFinanceSettings();
    const providerStatus = buildProviderStatus(settings);
    if (!providerStatus.ready) {
      throw buildCheckoutConfigError(providerStatus);
    }

    const safeRequestId = safeStr(requestId);
    const safePaymentId = safeStr(payment?.id);
    if (!safeRequestId || !safePaymentId) {
      throw new functions.https.HttpsError("invalid-argument", "Payment linkage is missing", {
        reason: "payment_linkage_missing",
      });
    }
    if (roundMoney(payment?.amount) <= 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Payment amount is invalid for checkout",
        {
          reason: "invalid_expected_amount",
          requestId: safeRequestId,
          paymentId: safePaymentId,
        }
      );
    }

    const paymentStatus = normalizePaymentStatus(payment?.status);
    if (!canCreateCheckoutForStatus(paymentStatus)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This payment is not currently payable",
        {
          reason: "payment_not_payable",
          requestId: safeRequestId,
          paymentId: safePaymentId,
          paymentStatus,
        }
      );
    }

    const existingAttempt =
      payment?.latestAttempt && typeof payment.latestAttempt === "object"
        ? payment.latestAttempt
        : null;
    const currentMs = nowMs();
    const existingAttemptId = safeStr(existingAttempt?.attemptId);
    let existingAttemptRecord = null;
    if (existingAttemptId) {
      try {
        const snap = await paymentAttemptsCol(requestId, payment.id).doc(existingAttemptId).get();
        existingAttemptRecord = snap.exists ? snap.data() || {} : null;
      } catch (error) {
        logger.warn("existing checkout attempt lookup failed", {
          requestId: safeRequestId,
          paymentId: safePaymentId,
          attemptId: existingAttemptId,
          error: error?.message || String(error),
        });
      }
    }
    const sameResumeContext = existingAttemptRecord
      ? safeStr(existingAttemptRecord?.metadata?.returnTo || "", 600) === safeStr(returnTo, 600) &&
        safeStr(existingAttemptRecord?.metadata?.draftId || "", 160) === safeStr(draftId, 160) &&
        safeStr(existingAttemptRecord?.payerMode || existingAttempt?.payerMode || payerMode) ===
          safeStr(payerMode)
      : !safeStr(returnTo, 600) && !safeStr(draftId, 160);
    if (
      existingAttempt &&
      safeStr(existingAttempt?.authorizationUrl) &&
      currentMs < clamp(toNum(existingAttempt?.expiresAtMs, 0), 0, 9999999999999) &&
      safeStr(existingAttempt?.status) === PAYMENT_STATUSES.AWAITING_PAYMENT &&
      lower(requestData?.paymentFlowType) !== "full_package_unlock" &&
      sameResumeContext
    ) {
      return {
        authorizationUrl: safeStr(existingAttempt.authorizationUrl),
        reference: safeStr(existingAttempt.reference),
        attemptId: safeStr(existingAttempt.attemptId),
        reused: true,
        environment: providerStatus.environment,
        provider: providerStatus.provider,
      };
    }

    const attemptRef = paymentAttemptsCol(requestId, payment.id).doc();
    const attemptId = attemptRef.id;
    const reference = buildInternalReference(
      payment?.paymentType === PAYMENT_TYPES.UNLOCK_REQUEST ? "MJ-UNLOCK" : "MJ-PAY"
    );
    const amountMinor = moneyToMinorUnits(payment?.amount, payment?.currency);
    const callbackUrl = buildCallbackUrl({
      baseUrl: providerStatus.callbackBaseUrl || appBaseUrl,
      reference,
      requestId,
      paymentId: payment.id,
      payerMode,
      returnTo,
      draftId,
      shareToken,
    });
    const metadata = {
      requestId,
      paymentId: payment.id,
      paymentType: payment.paymentType,
      attemptId,
      payerMode,
      draftId: safeStr(draftId),
      returnTo: safeStr(returnTo, 600),
      requestOwnerUid: safeStr(requestData?.uid),
      partnerId: safeStr(requestData?.assignedPartnerId),
      assignedAdminId: safeStr(requestData?.assignedAdminId),
    };

    const baseAttempt = {
      attemptId,
      requestId,
      paymentId: payment.id,
      paymentType: payment.paymentType,
      provider: providerStatus.provider,
      environment: providerStatus.environment,
      payerMode,
      internalReference: reference,
      paystackReference: reference,
      expectedAmount: roundMoney(payment?.amount),
      expectedAmountMinor: amountMinor,
      expectedCurrency: normalizeCurrency(payment?.currency),
      status: "initializing",
      authorizationUrl: "",
      callbackUrl,
      verificationSummary: null,
      redirectResult: null,
      webhookReceipt: null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: currentMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: currentMs,
      metadata,
    };

    await Promise.all([
      attemptRef.set(baseAttempt),
      topLevelRef(PAYMENT_PROVIDER_REFS_COLLECTION, reference).create({
        provider: providerStatus.provider,
        environment: providerStatus.environment,
        requestId,
        paymentId: payment.id,
        attemptId,
        paymentType: payment.paymentType,
        payerMode,
        expectedAmount: roundMoney(payment?.amount),
        expectedAmountMinor: amountMinor,
        expectedCurrency: normalizeCurrency(payment?.currency),
        requestUid: safeStr(requestData?.uid),
        shareTokenHash: shareToken ? hashShareToken(shareToken) : "",
        status: "initializing",
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: currentMs,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: currentMs,
      }),
      paymentRef.set(
        {
          status: PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
          latestAttemptId: attemptId,
          latestReference: reference,
          latestAttempt: {
            attemptId,
            reference,
            status: PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
            expiresAtMs: currentMs + DEFAULT_ATTEMPT_REUSE_WINDOW_MS,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: currentMs,
        },
        { merge: true }
      ),
    ]);

    try {
      const initPayload = await initializePaystackTransaction({
        email: payerEmail,
        amountMinor,
        currency: payment?.currency,
        reference,
        callbackUrl,
        metadata,
        secretKey: providerStatus.secretKey,
      });
      const authorizationUrl = safeStr(initPayload?.data?.authorization_url, 1000);
      const accessCode = safeStr(initPayload?.data?.access_code, 200);
      const expiresAtMs = currentMs + DEFAULT_ATTEMPT_REUSE_WINDOW_MS;

      await Promise.all([
        attemptRef.set(
          {
            status: PAYMENT_STATUSES.AWAITING_PAYMENT,
            authorizationUrl,
            accessCode,
            providerInitializeResult: initPayload?.data || null,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
            expiresAtMs,
          },
          { merge: true }
        ),
        paymentRef.set(
          {
            status: PAYMENT_STATUSES.AWAITING_PAYMENT,
            latestAttemptId: attemptId,
            latestReference: reference,
            latestAttempt: {
              attemptId,
              reference,
              status: PAYMENT_STATUSES.AWAITING_PAYMENT,
              authorizationUrl,
              expiresAtMs,
            },
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
        topLevelRef(PAYMENT_PROVIDER_REFS_COLLECTION, reference).set(
          {
            authorizationUrl,
            accessCode,
            status: PAYMENT_STATUSES.AWAITING_PAYMENT,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
            expiresAtMs,
          },
          { merge: true }
        ),
      ]);

      await logFinancialAudit({
        action: "payment_session_created",
        requestId,
        paymentId: payment.id,
        actorUid: callerUid,
        actorRole: payerMode === "shared_full_link" ? "shared_link" : "user",
        next: {
          status: PAYMENT_STATUSES.AWAITING_PAYMENT,
          reference,
          attemptId,
          payerMode,
        },
      });

      return {
        authorizationUrl,
        reference,
        attemptId,
        reused: false,
        environment: providerStatus.environment,
        provider: providerStatus.provider,
      };
    } catch (error) {
      logger.error("payment checkout initialize failed", {
        requestId: safeRequestId,
        paymentId: safePaymentId,
        payerMode,
        environment: providerStatus.environment,
        provider: providerStatus.provider,
        error: error?.message || String(error),
      });
      await Promise.allSettled([
        attemptRef.set(
          {
            status: PAYMENT_STATUSES.FAILED,
            failureReason: safeStr(error?.message, 300),
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
        paymentRef.set(
          {
            status: PAYMENT_STATUSES.PAYABLE,
            latestAttempt: {
              attemptId,
              reference,
              status: PAYMENT_STATUSES.FAILED,
              expiresAtMs: currentMs,
            },
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
        topLevelRef(PAYMENT_PROVIDER_REFS_COLLECTION, reference).set(
          {
            status: PAYMENT_STATUSES.FAILED,
            failureReason: safeStr(error?.message, 300),
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
      ]);
      throw new functions.https.HttpsError(
        "internal",
        safeStr(error?.message || "Failed to initialize payment checkout"),
        {
          reason: "provider_initialize_failed",
          requestId: safeRequestId,
          paymentId: safePaymentId,
          provider: providerStatus.provider,
          environment: providerStatus.environment,
        }
      );
    }
  }

  async function createOrUpdatePayoutQueue({
    requestId = "",
    requestData = {},
    payment = {},
    paymentRef = null,
    actorUid = "system",
    actorRole = "system",
    partnerProfile = null,
    actualProcessorFee = 0,
  } = {}) {
    const profile =
      partnerProfile || (await getPartnerFinancialProfile(requestData?.assignedPartnerId));
    const queueId = safeStr(payment?.payoutState?.queueItemId) || `payout_${payment.id}`;
    const queueRef = topLevelRef(PAYOUT_QUEUE_COLLECTION, queueId);
    const snapshot = payment?.financialSnapshot || payment?.breakdown || {};
    const missingDestination =
      profile?.payoutDestinationReady !== true || !profile?.payoutDestination;
    const queueStatus = missingDestination ? PAYOUT_STATUSES.ON_HOLD : PAYOUT_STATUSES.READY;
    const holdReason = missingDestination ? "missing_partner_payout_destination" : "";
    const partnerPayable = Math.max(
      0,
      roundMoney(snapshot?.estimatedNetPartnerPayable || payment?.amount || 0) -
        roundMoney(
          actualProcessorFee && profile?.deductProcessorFeeFromPartner ? actualProcessorFee : 0
        )
    );

    const payload = {
      queueId,
      requestId: safeStr(requestId),
      paymentId: safeStr(payment?.id),
      partnerId: safeStr(requestData?.assignedPartnerId || payment?.partnerId),
      partnerName: safeStr(requestData?.assignedPartnerName),
      assignedAdminId:
        safeStr(requestData?.assignedAdminId) || safeStr(requestData?.currentAdminUid),
      requestUid: safeStr(requestData?.uid),
      amount: partnerPayable,
      currency: normalizeCurrency(payment?.currency || snapshot?.currency || "KES"),
      status: queueStatus,
      holdReason,
      releaseNotes: "",
      settlementReference: "",
      payoutDestinationReady: profile?.payoutDestinationReady === true,
      payoutDestination: profile?.payoutDestination || null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs(),
      releasedAt: null,
      releasedAtMs: 0,
      releasedByUid: "",
      releasedByRole: "",
      providerMetadata: {
        paymentReference: safeStr(payment?.transactionReference || payment?.latestReference),
        provider: "paystack",
      },
      financialSnapshot:
        payment?.financialSnapshot && typeof payment.financialSnapshot === "object"
          ? payment.financialSnapshot
          : null,
    };

    await queueRef.set(payload, { merge: true });
    await paymentRef.set(
      {
        status: PAYMENT_STATUSES.HELD,
        payoutState: {
          queueItemId: queueId,
          status: queueStatus,
          holdReason,
          amount: partnerPayable,
          releasedAtMs: 0,
          settledAtMs: 0,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "payout_queue_updated",
      requestId,
      paymentId: payment?.id,
      payoutQueueId: queueId,
      actorUid,
      actorRole,
      next: {
        queueStatus,
        holdReason,
        amount: partnerPayable,
      },
    });

    return {
      queueId,
      status: queueStatus,
      holdReason,
      amount: partnerPayable,
    };
  }

  async function finalizeSuccessfulPayment({
    reference = "",
    source = "verify",
    redirectParams = null,
    webhookPayload = null,
  } = {}) {
    const safeReference = safeStr(reference, 120);
    if (!safeReference) {
      throw new Error("reference is required");
    }

    const refSnap = await topLevelRef(PAYMENT_PROVIDER_REFS_COLLECTION, safeReference).get();
    if (!refSnap.exists) {
      throw new Error("Payment reference was not found");
    }

    const refData = refSnap.data() || {};
    const requestId = safeStr(refData?.requestId);
    const paymentId = safeStr(refData?.paymentId);
    const attemptId = safeStr(refData?.attemptId);
    if (!requestId || !paymentId || !attemptId) {
      throw new Error("Payment reference is missing request linkage");
    }

    const [requestSnap, paymentSnap, attemptSnap] = await Promise.all([
      requestDocRef(requestId).get(),
      paymentDocRef(requestId, paymentId).get(),
      paymentAttemptsCol(requestId, paymentId).doc(attemptId).get(),
    ]);
    if (!requestSnap.exists || !paymentSnap.exists || !attemptSnap.exists) {
      throw new Error("Payment attempt could not be resolved");
    }

    const requestData = { id: requestSnap.id, ...(requestSnap.data() || {}) };
    const payment = normalizePaymentRow({ id: paymentSnap.id, ...(paymentSnap.data() || {}) });
    const attemptData = attemptSnap.data() || {};
    const settings = await getFinanceSettings();
    const providerStatus = buildProviderStatus(settings);
    const verificationPayload = await verifyPaystackTransaction(safeReference, providerStatus.secretKey);
    const verificationSummary = summarizePaystackVerification(verificationPayload);

    const expectedAmountMinor = roundMoney(
      refData?.expectedAmountMinor || attemptData?.expectedAmountMinor
    );
    const expectedCurrency = normalizeCurrency(
      refData?.expectedCurrency || attemptData?.expectedCurrency || payment.currency
    );
    const amountMatches = verificationSummary.amount === expectedAmountMinor;
    const currencyMatches = verificationSummary.currency === expectedCurrency;
    const referenceMatches = safeStr(verificationSummary.reference) === safeReference;
    const statusMatches = lower(verificationSummary.status) === "success";
    const paidAtMs = verificationSummary.paidAt
      ? Date.parse(verificationSummary.paidAt) || nowMs()
      : nowMs();
    const attemptRef = attemptSnap.ref;
    const paymentRef = paymentSnap.ref;
    const referenceRef = refSnap.ref;

    await attemptRef.set(
      {
        verificationSummary,
        redirectResult:
          redirectParams && typeof redirectParams === "object"
            ? redirectParams
            : FieldValue.delete(),
        webhookReceipt:
          webhookPayload && typeof webhookPayload === "object"
            ? {
                event: safeStr(webhookPayload?.event, 120),
                reference: safeStr(webhookPayload?.data?.reference, 120),
                transactionId: webhookPayload?.data?.id ?? null,
                receivedAtMs: nowMs(),
              }
            : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );

    if (!referenceMatches || !statusMatches || !amountMatches || !currencyMatches) {
      await Promise.all([
        attemptRef.set(
          {
            status: "verification_failed",
            verificationFailureReason: JSON.stringify({
              referenceMatches,
              statusMatches,
              amountMatches,
              currencyMatches,
            }).slice(0, 500),
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
        paymentRef.set(
          {
            status: PAYMENT_STATUSES.FAILED,
            failureReason: "verification_failed",
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
        referenceRef.set(
          {
            status: PAYMENT_STATUSES.FAILED,
            verificationSummary,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
      ]);

      await logFinancialAudit({
        action: "payment_verification_failed",
        requestId,
        paymentId,
        actorUid: "system",
        actorRole: source,
        previous: { paymentStatus: payment.status },
        next: {
          paymentStatus: PAYMENT_STATUSES.FAILED,
          verificationSummary,
        },
      });

      return {
        ok: false,
        requestId,
        paymentId,
        status: PAYMENT_STATUSES.FAILED,
        verificationSummary,
      };
    }

    if (isTerminalPaymentStatus(payment.status) && payment.status !== PAYMENT_STATUSES.FAILED) {
      await attemptRef.set(
        {
          status: "verified_duplicate",
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      );
      return {
        ok: true,
        requestId,
        paymentId,
        status: payment.status,
        verificationSummary,
      };
    }

    const nextPaymentStatus =
      payment.paymentType === PAYMENT_TYPES.UNLOCK_REQUEST
        ? PAYMENT_STATUSES.PAID
        : PAYMENT_STATUSES.HELD;
    const transactionReference = safeReference;

    await paymentRef.set(
      {
        status: nextPaymentStatus,
        transactionReference,
        providerReference: safeReference,
        providerTransactionId: verificationSummary.id,
        paymentMethod: "paystack",
        paidAt: FieldValue.serverTimestamp(),
        paidAtMs,
        providerVerification: verificationSummary,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
        latestAttemptId: attemptId,
        latestReference: safeReference,
      },
      { merge: true }
    );

    await Promise.all([
      attemptRef.set(
        {
          status: "verified_paid",
          paidAtMs,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
      referenceRef.set(
        {
          status: "verified_paid",
          verificationSummary,
          paidAtMs,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
    ]);

    let flowContext = null;

    if (payment.paymentType === PAYMENT_TYPES.UNLOCK_REQUEST) {
      const unlockAutoRefundHours = clamp(
        toNum(settings?.refundControls?.unlockAutoRefundHours, DEFAULT_UNLOCK_AUTO_REFUND_HOURS),
        1,
        720
      );
      await requestDocRef(requestId).set(
        {
          paid: true,
          paymentMeta: {
            status: "paid",
            method: "paystack",
            paidAt: paidAtMs,
            ref: transactionReference,
            requestId,
            paymentId,
          },
          unlockPaymentId: paymentId,
          unlockPaymentRequestId: requestId,
          unlockAutoRefundEligibleAtMs: paidAtMs + unlockAutoRefundHours * 60 * 60 * 1000,
          unlockAutoRefundStatus: "pending",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      flowContext = await applyVerifiedFullPackageUnlock({
        requestId,
        paymentId,
        requestData,
        payment,
        transactionReference,
        paidAtMs,
      });
    } else {
      const payout = await createOrUpdatePayoutQueue({
        requestId,
        requestData,
        payment: {
          ...payment,
          id: paymentId,
          amount: roundMoney(payment.amount),
          currency: payment.currency,
          financialSnapshot:
            payment.financialSnapshot && typeof payment.financialSnapshot === "object"
              ? payment.financialSnapshot
              : null,
          transactionReference,
        },
        paymentRef,
        actorUid: "system",
        actorRole: source,
        actualProcessorFee: verificationSummary.fees,
      });

      await paymentRef.set(
        {
          payoutState: {
            queueItemId: payout.queueId,
            status: payout.status,
            holdReason: payout.holdReason,
            amount: payout.amount,
            heldAtMs: nowMs(),
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      );
    }

    await logFinancialAudit({
      action: "payment_verified",
      requestId,
      paymentId,
      actorUid: "system",
      actorRole: source,
      previous: {
        status: payment.status,
      },
      next: {
        status: nextPaymentStatus,
        reference: transactionReference,
        verificationSummary,
      },
      metadata: {
        payerMode: safeStr(refData?.payerMode || attemptData?.payerMode),
      },
    });

    await notifyPaymentParties({
      requestData,
      payment: {
        ...payment,
        id: paymentId,
        amount: payment.amount,
        currency: payment.currency,
        status: nextPaymentStatus,
      },
      type: "PAYMENT_RECEIVED",
      title: "Payment received",
      body:
        payment.paymentType === PAYMENT_TYPES.UNLOCK_REQUEST
          ? "Unlock payment was verified successfully."
          : "Payment was collected successfully and is now held by MAJUU.",
    });

    return {
      ok: true,
      requestId,
      paymentId,
      status: nextPaymentStatus,
      paymentType: payment.paymentType,
      verificationSummary,
      draftId: safeStr(attemptData?.metadata?.draftId || ""),
      returnTo: safeStr(attemptData?.metadata?.returnTo || ""),
      payerMode: safeStr(attemptData?.payerMode || refData?.payerMode),
      flowType: lower(requestData?.paymentFlowType),
      fullPackage: flowContext,
    };
  }

  async function maybeAutoRefundUnlockPayment({
    requestId = "",
    actorUid = "system",
    actorRole = "system",
  } = {}) {
    const requestSnap = await requestDocRef(requestId).get();
    if (!requestSnap.exists) return { applied: false };
    const requestData = { id: requestSnap.id, ...(requestSnap.data() || {}) };
    if (lower(requestData?.paymentFlowType) === "full_package_unlock") {
      return { applied: false, skipped: "full_package_unlock" };
    }
    const unlockPaymentId = safeStr(requestData?.unlockPaymentId) || "unlock_request_payment";
    const paymentSnap = await paymentDocRef(requestId, unlockPaymentId).get();
    if (!paymentSnap.exists) return { applied: false };
    const payment = normalizePaymentRow({ id: paymentSnap.id, ...(paymentSnap.data() || {}) });

    const currentMs = nowMs();
    const eligibleAtMs = toNum(
      payment?.unlockAutoRefundEligibleAtMs || requestData?.unlockAutoRefundEligibleAtMs,
      0
    );
    if (
      payment.paymentType !== PAYMENT_TYPES.UNLOCK_REQUEST ||
      payment.status !== PAYMENT_STATUSES.PAID ||
      eligibleAtMs <= 0 ||
      currentMs < eligibleAtMs ||
      shouldBlockUnlockAutoRefund(requestData)
    ) {
      return { applied: false };
    }

    const settings = await getFinanceSettings();
    const providerStatus = buildProviderStatus(settings);
    const refundRefId = `auto_${unlockPaymentId}`;
    const refundRef = refundDocRef(requestId, refundRefId);
    const refundSnap = await refundRef.get();
    if (refundSnap.exists) {
      const existingStatus = normalizeRefundStatus(refundSnap.data()?.status);
      if (
        existingStatus === REFUND_STATUSES.REFUNDED ||
        existingStatus === REFUND_STATUSES.AUTO_REFUNDED
      ) {
        return { applied: false, alreadyDone: true };
      }
    }

    let providerRefund = null;
    let refundStatus = REFUND_STATUSES.AUTO_REFUNDED;
    let paymentStatus = PAYMENT_STATUSES.AUTO_REFUNDED;
    let providerRefundState = "completed";

    if (providerStatus.secretConfigured && safeStr(payment?.providerTransactionId)) {
      try {
        const refundPayload = await createPaystackRefund({
          transaction: safeStr(payment?.providerTransactionId),
          amountMinor: moneyToMinorUnits(payment.amount, payment.currency),
          merchantNote: "Auto-refund after unlock request exceeded start-work timeline",
          customerNote: "Auto-refund processed by system rule",
          secretKey: providerStatus.secretKey,
        });
        providerRefund = summarizePaystackRefund(refundPayload);
        if (
          providerRefund?.status &&
          providerRefund.status !== "processed" &&
          providerRefund.status !== "success"
        ) {
          refundStatus = REFUND_STATUSES.APPROVED;
          paymentStatus = PAYMENT_STATUSES.REFUND_UNDER_REVIEW;
          providerRefundState = providerRefund.status;
        }
      } catch (error) {
        logger.error("unlock auto-refund provider call failed", {
          requestId,
          paymentId: unlockPaymentId,
          error: error?.message || String(error),
        });
        refundStatus = REFUND_STATUSES.APPROVED;
        paymentStatus = PAYMENT_STATUSES.REFUND_UNDER_REVIEW;
        providerRefundState = "provider_retry_needed";
      }
    }

    await Promise.all([
      refundRef.set(
        {
          refundId: refundRefId,
          requestId,
          paymentId: unlockPaymentId,
          paymentType: PAYMENT_TYPES.UNLOCK_REQUEST,
          paymentLabel: payment.paymentLabel,
          amount: payment.amount,
          currency: payment.currency,
          uid: safeStr(requestData?.uid),
          status: refundStatus,
          autoGenerated: true,
          userReason: "Auto-refund triggered because work was not started in time.",
          adminExplanation: "Automatic refund executed by system timeline rule.",
          rejectionReason: "",
          expectedRefundPeriodText:
            refundStatus === REFUND_STATUSES.AUTO_REFUNDED
              ? "Refund completed automatically."
              : "Refund approved and queued for provider completion.",
          providerRefund: providerRefund || null,
          providerRefundState,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: currentMs,
          decisionAt: FieldValue.serverTimestamp(),
          decisionAtMs: currentMs,
          decidedByAdminUid: "system",
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: currentMs,
        },
        { merge: true }
      ),
      paymentDocRef(requestId, unlockPaymentId).set(
        {
          status: paymentStatus,
          refundedAt: FieldValue.serverTimestamp(),
          refundedAtMs: currentMs,
          refundState: {
            refundId: refundRefId,
            status: refundStatus,
            requestedAtMs: currentMs,
            decidedAtMs: currentMs,
            mode: "auto_unlock_timeout",
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: currentMs,
        },
        { merge: true }
      ),
      requestDocRef(requestId).set(
        {
          unlockAutoRefundStatus:
            refundStatus === REFUND_STATUSES.AUTO_REFUNDED ? "completed" : "awaiting_provider",
          unlockPaymentRefundedAtMs:
            refundStatus === REFUND_STATUSES.AUTO_REFUNDED ? currentMs : 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

    await logFinancialAudit({
      action: "unlock_auto_refund",
      requestId,
      paymentId: unlockPaymentId,
      refundId: refundRefId,
      actorUid,
      actorRole,
      next: {
        paymentStatus,
        refundStatus,
        providerRefundState,
      },
    });

    await notifyPaymentParties({
      requestData,
      payment: {
        ...payment,
        id: unlockPaymentId,
        status: paymentStatus,
      },
      type: "REFUND_COMPLETED",
      title:
        refundStatus === REFUND_STATUSES.AUTO_REFUNDED
          ? "Refund completed"
          : "Refund approved",
      body:
        refundStatus === REFUND_STATUSES.AUTO_REFUNDED
          ? "Unlock payment was refunded automatically."
          : "Unlock payment refund was approved and is awaiting provider completion.",
      refundId: refundRefId,
    });

    return {
      applied: true,
      refundStatus,
      paymentStatus,
      requestId,
      paymentId: unlockPaymentId,
    };
  }
  // exports
  const saveFinanceSettings = functions.https.onCall(async (data, context) => {
    const caller = await requireAdminCallerContext(context, {
      allowManager: true,
      requiredManagerModule: "finances",
      allowAssignedAdmin: false,
    });
    const settings = normalizeFinanceSettings(data?.settings || {});
    await topLevelRef(FINANCE_SETTINGS_COLLECTION, FINANCE_SETTINGS_DOC).set(
      {
        ...settings,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
        updatedByUid: caller.callerUid,
        updatedByEmail: safeEmail(caller?.callerDoc?.email),
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "finance_settings_updated",
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      next: settings,
    });
    await logFinanceManagerActivity(
      caller,
      "finance_settings_updated",
      "Finance settings updated",
      {
        providerEnvironment: settings?.provider?.environment,
      }
    );

    return {
      ok: true,
      settings,
      providerStatus: buildPublicProviderStatus(buildProviderStatus(settings)),
    };
  });

  const savePartnerFinancialProfile = functions.https.onCall(async (data, context) => {
    const caller = await requireAdminCallerContext(context, {
      allowManager: true,
      requiredManagerModule: "finances",
      allowAssignedAdmin: false,
    });
    const partnerId = safeStr(data?.partnerId);
    if (!partnerId) {
      throw new functions.https.HttpsError("invalid-argument", "partnerId is required");
    }
    const partner = await fetchPartnerById(partnerId);
    if (!partner?.id) {
      throw new functions.https.HttpsError("not-found", "Partner was not found");
    }

    const profile = normalizePartnerFinancialProfile(data?.profile || {}, partner);
    await topLevelRef(PARTNER_FINANCIAL_PROFILES, partnerId).set(
      {
        ...profile,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
        updatedByUid: caller.callerUid,
        updatedByEmail: safeEmail(caller?.callerDoc?.email),
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "partner_financial_profile_updated",
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      reason: safeStr(partner?.displayName),
      next: profile,
      metadata: { partnerId },
    });
    await logFinanceManagerActivity(
      caller,
      "partner_financial_profile_updated",
      `Partner profile updated: ${safeStr(partner?.displayName)}`,
      { partnerId }
    );

    return { ok: true, profile };
  });

  const getFinanceEnvironmentStatus = functions.https.onCall(async (_, context) => {
    const caller = await requireAdminCallerContext(context, {
      allowManager: true,
      requiredManagerModule: "finances",
      allowAssignedAdmin: false,
    });
    const settings = await getFinanceSettings();
    return {
      ok: true,
      role: caller.callerRole,
      settings,
      providerStatus: buildPublicProviderStatus(buildProviderStatus(settings)),
    };
  });

  const createFullPackageUnlockCheckoutSession = functions.https.onCall(async (data, context) => {
    const caller = await requireAuthenticatedCaller(context);
    const fullPackageId = safeStr(data?.fullPackageId);
    const draftId = safeStr(data?.draftId, 160);
    const returnTo = safeStr(data?.returnTo, 600);
    const appBaseUrl = safeStr(data?.appBaseUrl, 400);
    const fullPackage = await loadFullPackageData(fullPackageId, {
      requiredOwnerUid: caller.callerUid,
    });

    const nextTrack = normalizeTrack(data?.track || fullPackage.data?.track);
    const nextCountry = safeStr(data?.country || fullPackage.data?.country, 120);
    const nextSelectedItems = normalizeFullPackageItems(
      data?.selectedItems?.length ? data.selectedItems : fullPackage.data?.selectedItems
    );
    if (!nextSelectedItems.length) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Select at least one missing item before paying"
      );
    }

    const quote = await computeFullPackageQuote({
      track: nextTrack,
      country: nextCountry,
      selectedItems: nextSelectedItems,
      coveredItems: fullPackage.data?.unlockCoverage?.coveredItems || [],
    });

    await fullPackage.ref.set(
      {
        track: nextTrack,
        country: nextCountry,
        selectedItems: quote.selectedItems,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );

    if (!quote.payableItems.length || quote.amount <= 0) {
      return {
        ok: true,
        alreadyCovered: true,
        fullPackageId,
        coveredItems: quote.coveredItems,
        payableItems: [],
        selectedItems: quote.selectedItems,
        amount: 0,
        currency: quote.currency || "KES",
      };
    }

    const latestUnlockRequestId = safeStr(fullPackage.data?.latestUnlockRequestId);
    const latestUnlockItemsKey = safeStr(fullPackage.data?.latestUnlockItemsKey);
    if (latestUnlockRequestId && latestUnlockItemsKey === quote.itemListKey) {
      try {
        const existingRequest = await loadRequestData(latestUnlockRequestId);
        if (
          safeStr(existingRequest.data?.uid) === caller.callerUid &&
          lower(existingRequest.data?.paymentFlowType) === "full_package_unlock"
        ) {
          const unlockPayment = await ensureUnlockPaymentRecord({
            requestId: existingRequest.requestId,
            requestData: existingRequest.data,
            actorUid: caller.callerUid,
            draftId,
          });
          const session = await createOrReuseCheckoutSession({
            requestData: existingRequest.data,
            requestId: existingRequest.requestId,
            payment: {
              ...unlockPayment.data,
              id: unlockPayment.paymentId,
            },
            paymentRef: unlockPayment.ref,
            payerMode: "direct_user",
            payerEmail: safeEmail(fullPackage.data?.email || caller.callerEmail),
            callerUid: caller.callerUid,
            appBaseUrl,
            returnTo,
            draftId,
          });
          return {
            ok: true,
            flowType: "full_package_unlock",
            fullPackageId,
            requestId: existingRequest.requestId,
            paymentId: unlockPayment.paymentId,
            amount: unlockPayment.data.amount,
            currency: unlockPayment.data.currency,
            coveredItems: quote.coveredItems,
            payableItems: quote.payableItems,
            selectedItems: quote.selectedItems,
            reusedUnlockRequest: true,
            ...session,
          };
        }
      } catch (error) {
        logger.warn("full package unlock reuse failed", {
          fullPackageId,
          latestUnlockRequestId,
          error: error?.message || String(error),
        });
      }
    }

    const createdRequest = await createFullPackageUnlockRequest({
      caller,
      fullPackage: {
        id: fullPackageId,
        ...fullPackage.data,
        track: nextTrack,
        country: nextCountry,
      },
      quote,
      draftId,
    });
    const unlockPayment = await ensureUnlockPaymentRecord({
      requestId: createdRequest.requestId,
      requestData: createdRequest.data,
      actorUid: caller.callerUid,
      draftId,
    });
    const session = await createOrReuseCheckoutSession({
      requestData: createdRequest.data,
      requestId: createdRequest.requestId,
      payment: {
        ...unlockPayment.data,
        id: unlockPayment.paymentId,
      },
      paymentRef: unlockPayment.ref,
      payerMode: "direct_user",
      payerEmail: safeEmail(fullPackage.data?.email || caller.callerEmail),
      callerUid: caller.callerUid,
      appBaseUrl,
      returnTo,
      draftId,
    });

    return {
      ok: true,
      flowType: "full_package_unlock",
      fullPackageId,
      requestId: createdRequest.requestId,
      paymentId: unlockPayment.paymentId,
      amount: unlockPayment.data.amount,
      currency: unlockPayment.data.currency,
      coveredItems: quote.coveredItems,
      payableItems: quote.payableItems,
      selectedItems: quote.selectedItems,
      ...session,
    };
  });

  const createUnlockCheckoutSession = functions.https.onCall(async (data, context) => {
    const caller = await requireAuthenticatedCaller(context);
    const requestId = safeStr(data?.requestId);
    const draftId = safeStr(data?.draftId);
    const returnTo = safeStr(data?.returnTo, 600);
    const appBaseUrl = safeStr(data?.appBaseUrl, 400);
    const requestRow = await loadRequestData(requestId);
    await requireRequestOwner(context, requestRow.data);

    const status = lower(requestRow.data?.status);
    if (status !== "payment_pending" && status !== "new") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Unlock checkout can only start from a pending request"
      );
    }
    if (requestRow.data?.paid === true && safeStr(requestRow.data?.unlockPaymentId)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Unlock payment is already recorded for this request"
      );
    }

    const unlockPayment = await ensureUnlockPaymentRecord({
      requestId,
      requestData: requestRow.data,
      actorUid: caller.callerUid,
      draftId,
    });

    const session = await createOrReuseCheckoutSession({
      requestData: requestRow.data,
      requestId,
      payment: {
        ...unlockPayment.data,
        id: unlockPayment.paymentId,
      },
      paymentRef: unlockPayment.ref,
      payerMode: "direct_user",
      payerEmail: safeEmail(requestRow.data?.email || caller?.callerDoc?.email),
      callerUid: caller.callerUid,
      appBaseUrl,
      returnTo,
      draftId,
    });

    return {
      ok: true,
      requestId,
      paymentId: unlockPayment.paymentId,
      amount: unlockPayment.data.amount,
      currency: unlockPayment.data.currency,
      ...session,
    };
  });

  const activatePreparedUnlockRequest = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const requestRow = await loadRequestData(requestId);
    const caller = await requireRequestOwner(context, requestRow.data);
    if (lower(requestRow.data?.paymentFlowType) === "full_package_unlock") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Full package unlocks are completed from the full package flow"
      );
    }
    const unlockPaymentId = safeStr(requestRow.data?.unlockPaymentId) || "unlock_request_payment";
    const paymentRow = await loadPaymentData(requestId, unlockPaymentId);

    const currentRequestStatus = lower(requestRow.data?.status);
    if (currentRequestStatus !== "payment_pending") {
      if (
        requestRow.data?.paid === true &&
        (currentRequestStatus === "new" ||
          currentRequestStatus === "contacted" ||
          currentRequestStatus === "closed" ||
          currentRequestStatus === "rejected")
      ) {
        return {
          ok: true,
          requestId,
          paymentId: unlockPaymentId,
          status: currentRequestStatus,
          alreadyActivated: true,
        };
      }
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This request is not waiting for unlock activation"
      );
    }
    if (paymentRow.data.status !== PAYMENT_STATUSES.PAID) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Unlock payment is not verified yet"
      );
    }

    await requestRow.ref.set(
      {
        paid: true,
        status: "new",
        routingStatus: "awaiting_route",
        paymentMeta: {
          status: "paid",
          method: "paystack",
          paidAt: paymentRow.data.paidAtMs,
          ref: paymentRow.data.transactionReference,
          requestId,
          paymentId: unlockPaymentId,
        },
        unlockPaymentId,
        unlockPaymentRequestId: requestId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "unlock_request_activated",
      requestId,
      paymentId: unlockPaymentId,
      actorUid: caller.callerUid,
      actorRole: "user",
      previous: { status: requestRow.data?.status },
      next: { status: "new" },
    });

    const refreshed = {
      ...requestRow.data,
      status: "new",
      paid: true,
      unlockPaymentId,
      paymentMeta: {
        status: "paid",
        method: "paystack",
        paidAt: paymentRow.data.paidAtMs,
        ref: paymentRow.data.transactionReference,
      },
    };

    const routeResult = await autoRouteRequest({
      requestId,
      requestData: refreshed,
      reason: "unlock_payment_activated",
    });

    return {
      ok: true,
      requestId,
      paymentId: unlockPaymentId,
      routeResult,
    };
  });

  const createInProgressPaymentProposal = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const requestRow = await loadRequestData(requestId);
    const caller = await requireAssignedStaffForRequest(context, requestRow.data);

    if (!safeStr(requestRow.data?.assignedPartnerId) || !safeStr(requestRow.data?.assignedAdminId)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Request must have an assigned partner and assigned admin before payment can be prompted"
      );
    }

    const settings = await getFinanceSettings();
    const partnerProfile = await getPartnerFinancialProfile(requestRow.data?.assignedPartnerId);
    if (lower(partnerProfile?.activeFinancialStatus) === "inactive") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Partner financial profile is inactive"
      );
    }

    const paymentLabel = safeStr(data?.paymentLabel, 180);
    if (!paymentLabel) {
      throw new functions.https.HttpsError("invalid-argument", "paymentLabel is required");
    }

    const officialAmount = roundMoney(data?.officialAmount);
    const serviceFee = roundMoney(
      settings?.inProgressPricing?.allowServiceFeeInput === false ? 0 : data?.serviceFee
    );
    if (officialAmount <= 0) {
      throw new functions.https.HttpsError("invalid-argument", "officialAmount must be greater than zero");
    }

    const breakdown = calculateBreakdown({
      officialAmount,
      serviceFee,
      currency: data?.currency || settings?.inProgressPricing?.defaultCurrency || "KES",
      requestId,
      partnerId: requestRow.data?.assignedPartnerId,
      assignedAdminId: requestRow.data?.assignedAdminId,
      partnerProfile,
      settings,
    });

    const paymentRef = requestRow.ref.collection("payments").doc();
    const paymentId = paymentRef.id;
    const createdMs = nowMs();
    const payload = {
      requestId,
      requestUid: safeStr(requestRow.data?.uid),
      paymentType: PAYMENT_TYPES.IN_PROGRESS,
      paymentLabel,
      note: cleanParagraph(data?.note, 2000),
      status: PAYMENT_STATUSES.ADMIN_REVIEW,
      amount: breakdown.finalUserPayable,
      currency: breakdown.currency,
      partnerId: safeStr(requestRow.data?.assignedPartnerId),
      partnerName: safeStr(requestRow.data?.assignedPartnerName),
      assignedAdminId: safeStr(requestRow.data?.assignedAdminId),
      createdByStaffUid: caller.callerUid,
      createdByStaffEmail: safeEmail(caller?.callerDoc?.email),
      breakdown,
      financialSnapshot: null,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: createdMs,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: createdMs,
      approvedAtMs: 0,
      paidAtMs: 0,
      transactionReference: "",
      latestAttemptId: "",
      latestReference: "",
      latestAttempt: null,
      payoutState: null,
      refundState: null,
      approvalMeta: null,
      revocationMeta: null,
    };

    await paymentRef.set(payload);

    await logFinancialAudit({
      action: "payment_prompted",
      requestId,
      paymentId,
      actorUid: caller.callerUid,
      actorRole: "staff",
      next: {
        status: PAYMENT_STATUSES.ADMIN_REVIEW,
        breakdown,
      },
    });

    await notifyPaymentParties({
      requestData: requestRow.data,
      payment: {
        ...payload,
        id: paymentId,
      },
      type: "PAYMENT_UPDATE",
      title: "Payment awaiting review",
      body: `${paymentLabel} is waiting for admin review.`,
    });

    return {
      ok: true,
      paymentId,
      payment: {
        id: paymentId,
        ...payload,
      },
    };
  });

  const adminApprovePaymentRequest = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const paymentId = safeStr(data?.paymentId);
    const requestRow = await loadRequestData(requestId);
    const caller = await requireRequestAdmin(context, requestRow.data);
    const paymentRow = await loadPaymentData(requestId, paymentId);
    const payment = paymentRow.data;

    if (payment.paymentType !== PAYMENT_TYPES.IN_PROGRESS) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Only in-progress payment requests require admin approval"
      );
    }
    if (
      !new Set([
        PAYMENT_STATUSES.ADMIN_REVIEW,
        PAYMENT_STATUSES.PROMPTED,
        PAYMENT_STATUSES.DRAFT,
      ]).has(payment.status)
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This payment is no longer awaiting admin review"
      );
    }

    const settings = await getFinanceSettings();
    const partnerProfile = await getPartnerFinancialProfile(requestRow.data?.assignedPartnerId);
    const officialAmount = roundMoney(
      data?.officialAmount ?? payment?.breakdown?.officialAmount ?? payment?.amount
    );
    const serviceFee = roundMoney(
      settings?.inProgressPricing?.allowAdminAdjustAmounts === false
        ? payment?.breakdown?.serviceFee
        : data?.serviceFee ?? payment?.breakdown?.serviceFee
    );
    const paymentLabel = safeStr(data?.paymentLabel || payment.paymentLabel, 180);
    const note = cleanParagraph(data?.note ?? payment?.note, 2000);

    if (!paymentLabel || officialAmount <= 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Payment label and official amount are required"
      );
    }

    const breakdown = calculateBreakdown({
      officialAmount,
      serviceFee,
      currency: payment.currency || settings?.inProgressPricing?.defaultCurrency || "KES",
      requestId,
      partnerId: requestRow.data?.assignedPartnerId,
      assignedAdminId: requestRow.data?.assignedAdminId,
      partnerProfile,
      settings,
    });
    const snapshot = buildFinancialSnapshot({
      requestId,
      paymentId,
      requestData: requestRow.data,
      paymentLabel,
      note,
      breakdown,
      partnerProfile,
      settings,
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      promptedByStaffUid: payment.createdByStaffUid,
      approvedAtMs: nowMs(),
    });

    await paymentRow.ref.set(
      {
        paymentLabel,
        note,
        amount: breakdown.finalUserPayable,
        currency: breakdown.currency,
        breakdown,
        financialSnapshot: snapshot,
        status: PAYMENT_STATUSES.PAYABLE,
        approvedAt: FieldValue.serverTimestamp(),
        approvedAtMs: nowMs(),
        approvalMeta: {
          approvedByUid: caller.callerUid,
          approvedByRole: caller.callerRole,
          approvedAtMs: nowMs(),
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
        revocationMeta: null,
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "payment_approved",
      requestId,
      paymentId,
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      previous: {
        status: payment.status,
        amount: payment.amount,
      },
      next: {
        status: PAYMENT_STATUSES.PAYABLE,
        amount: breakdown.finalUserPayable,
        breakdown,
      },
    });

    await notifyPaymentParties({
      requestData: requestRow.data,
      payment: {
        ...payment,
        id: paymentId,
        paymentLabel,
        amount: breakdown.finalUserPayable,
        currency: breakdown.currency,
        status: PAYMENT_STATUSES.PAYABLE,
      },
      type: "PAYMENT_REQUIRED",
      title: "Payment available",
      body: `${paymentLabel} is approved and ready for payment.`,
    });

    return {
      ok: true,
      paymentId,
      status: PAYMENT_STATUSES.PAYABLE,
      breakdown,
      snapshot,
    };
  });

  const adminRevokePaymentRequest = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const paymentId = safeStr(data?.paymentId);
    const reason = cleanParagraph(data?.reason, 1000);
    if (!reason) {
      throw new functions.https.HttpsError("invalid-argument", "reason is required");
    }
    const requestRow = await loadRequestData(requestId);
    const caller = await requireRequestAdmin(context, requestRow.data);
    const paymentRow = await loadPaymentData(requestId, paymentId);
    const payment = paymentRow.data;

    if (
      !new Set([
        PAYMENT_STATUSES.ADMIN_REVIEW,
        PAYMENT_STATUSES.PAYABLE,
        PAYMENT_STATUSES.PAYMENT_SESSION_CREATED,
        PAYMENT_STATUSES.AWAITING_PAYMENT,
        PAYMENT_STATUSES.FAILED,
      ]).has(payment.status)
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This payment can no longer be revoked"
      );
    }

    await paymentRow.ref.set(
      {
        status: PAYMENT_STATUSES.REVOKED,
        revocationMeta: {
          reason,
          revokedByUid: caller.callerUid,
          revokedByRole: caller.callerRole,
          revokedAtMs: nowMs(),
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      },
      { merge: true }
    );

    await logFinancialAudit({
      action: "payment_revoked",
      requestId,
      paymentId,
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      reason,
      previous: { status: payment.status },
      next: { status: PAYMENT_STATUSES.REVOKED },
    });

    await notifyPaymentParties({
      requestData: requestRow.data,
      payment: {
        ...payment,
        id: paymentId,
        status: PAYMENT_STATUSES.REVOKED,
      },
      type: "PAYMENT_UPDATE",
      title: "Payment revoked",
      body: `${payment.paymentLabel} was revoked by admin.`,
    });

    return { ok: true, paymentId, status: PAYMENT_STATUSES.REVOKED };
  });

  const createPaymentCheckoutSession = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const paymentId = safeStr(data?.paymentId);
    const shareToken = safeStr(data?.shareToken, 400);
    const appBaseUrl = safeStr(data?.appBaseUrl, 400);
    const returnTo = safeStr(data?.returnTo, 600);

    let requestRow = null;
    let paymentRow = null;
    let payerEmail = "";
    let payerMode = "direct_user";

    if (shareToken) {
      const share = await getShareLinkData(shareToken);
      requestRow = await loadRequestData(share.data?.requestId);
      paymentRow = await loadPaymentData(requestRow.requestId, share.data?.paymentId);
      payerMode = "shared_full_link";
      payerEmail = safeEmail(data?.email || "shared-link@majuu.app");

      const payment = paymentRow.data;
      const expiredAtMs = toNum(share.data?.expiresAtMs, 0);
      const amountMatches = roundMoney(share.data?.amount) === roundMoney(payment.amount);
      const currencyMatches =
        normalizeCurrency(share.data?.currency || payment.currency) ===
        normalizeCurrency(payment.currency);
      const tokenHashMatches =
        safeStr(payment?.shareLink?.tokenHash) === safeStr(share.tokenHash);
      if (
        lower(share.data?.status) !== "active" ||
        (expiredAtMs > 0 && nowMs() > expiredAtMs) ||
        payment.paymentType !== PAYMENT_TYPES.IN_PROGRESS ||
        isTerminalPaymentStatus(payment.status) ||
        payment.status === PAYMENT_STATUSES.HELD ||
        !amountMatches ||
        !currencyMatches ||
        !tokenHashMatches
      ) {
        throw new functions.https.HttpsError(
          "failed-precondition",
          "This shared payment link is no longer valid"
        );
      }
    } else {
      requestRow = await loadRequestData(requestId);
      const caller = await requireRequestOwner(context, requestRow.data);
      paymentRow = await loadPaymentData(requestId, paymentId);
      payerEmail = safeEmail(requestRow.data?.email || caller?.callerDoc?.email);
    }

    const session = await createOrReuseCheckoutSession({
      requestData: requestRow.data,
      requestId: requestRow.requestId,
      payment: {
        ...paymentRow.data,
        id: paymentRow.paymentId,
      },
      paymentRef: paymentRow.ref,
      payerMode,
      payerEmail,
      callerUid: shareToken ? "shared_link" : safeStr(context?.auth?.uid),
      appBaseUrl,
      returnTo,
      shareToken,
    });

    return {
      ok: true,
      requestId: requestRow.requestId,
      paymentId: paymentRow.paymentId,
      payerMode,
      ...session,
    };
  });

  const getOrCreateSharedPaymentLink = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const paymentId = safeStr(data?.paymentId);
    const appBaseUrl = safeStr(data?.appBaseUrl, 400);
    const requestRow = await loadRequestData(requestId);
    const caller = await requireAuthenticatedCaller(context);
    const isOwner = safeStr(requestRow.data?.uid) === caller.callerUid;

    if (!isOwner) {
      await requireRequestAdmin(context, requestRow.data);
    }

    const paymentRow = await loadPaymentData(requestId, paymentId);
    const payment = paymentRow.data;
    if (payment.paymentType !== PAYMENT_TYPES.IN_PROGRESS) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Only in-progress payments can be shared in v1"
      );
    }
    if (!canCreateCheckoutForStatus(payment.status)) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This payment is not in a shareable state"
      );
    }

    const settings = await getFinanceSettings();
    const expiryHours = clamp(
      toNum(settings?.refundControls?.sharedLinkExpiryHours, DEFAULT_SHARED_LINK_EXPIRY_HOURS),
      1,
      720
    );
    const shareToken = buildPaymentShareToken();
    const tokenHash = hashShareToken(shareToken);
    const expiresAtMs = nowMs() + expiryHours * 60 * 60 * 1000;

    const previousHash = safeStr(payment?.shareLink?.tokenHash);
    if (previousHash) {
      await topLevelRef(PAYMENT_SHARE_LINKS_COLLECTION, previousHash).set(
        {
          status: "replaced",
          replacedAt: FieldValue.serverTimestamp(),
          replacedAtMs: nowMs(),
        },
        { merge: true }
      );
    }

    await Promise.all([
      topLevelRef(PAYMENT_SHARE_LINKS_COLLECTION, tokenHash).set({
        requestId,
        paymentId,
        paymentType: payment.paymentType,
        amount: payment.amount,
        currency: payment.currency,
        status: "active",
        tokenHash,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs(),
        expiresAtMs,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      }),
      paymentRow.ref.set(
        {
          shareLink: {
            tokenHash,
            status: "active",
            issuedAtMs: nowMs(),
            expiresAtMs,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
    ]);

    const baseUrl = safeStr(appBaseUrl, 400).replace(/\/+$/, "");
    const shareUrl = baseUrl
      ? `${baseUrl}/pay/shared/${encodeURIComponent(shareToken)}`
      : `/pay/shared/${encodeURIComponent(shareToken)}`;

    await logFinancialAudit({
      action: "payment_share_link_issued",
      requestId,
      paymentId,
      actorUid: caller.callerUid,
      actorRole: isOwner ? "user" : "admin",
      next: {
        tokenHash,
        expiresAtMs,
      },
    });

    return {
      ok: true,
      shareUrl,
      expiresAtMs,
      paymentId,
      requestId,
    };
  });

  const resolveSharedPaymentLink = functions.https.onCall(async (data) => {
    const share = await getShareLinkData(data?.shareToken);
    const requestRow = await loadRequestData(share.data?.requestId);
    const paymentRow = await loadPaymentData(requestRow.requestId, share.data?.paymentId);
    const payment = paymentRow.data;
    const expiredAtMs = toNum(share.data?.expiresAtMs, 0);
    const isExpired = expiredAtMs > 0 && nowMs() > expiredAtMs;
    const amountMatches = roundMoney(share.data?.amount) === roundMoney(payment.amount);
    const currencyMatches =
      normalizeCurrency(share.data?.currency || payment.currency) ===
      normalizeCurrency(payment.currency);
    const tokenHashMatches = safeStr(payment?.shareLink?.tokenHash) === safeStr(share.tokenHash);
    const invalid =
      lower(share.data?.status) !== "active" ||
      isExpired ||
      payment.paymentType !== PAYMENT_TYPES.IN_PROGRESS ||
      isTerminalPaymentStatus(payment.status) ||
      payment.status === PAYMENT_STATUSES.HELD ||
      payment.status === PAYMENT_STATUSES.SETTLED ||
      payment.status === PAYMENT_STATUSES.REFUNDED ||
      payment.status === PAYMENT_STATUSES.AUTO_REFUNDED ||
      !amountMatches ||
      !currencyMatches ||
      !tokenHashMatches;

    return {
      ok: true,
      valid: !invalid,
      requestId: requestRow.requestId,
      paymentId: paymentRow.paymentId,
      expiresAtMs: expiredAtMs,
      payment: {
        id: paymentRow.paymentId,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        partnerName: safeStr(requestRow.data?.assignedPartnerName),
      },
    };
  });

  const requestPaymentRefund = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const paymentId = safeStr(data?.paymentId);
    const reason = cleanParagraph(data?.userReason, 2000);
    if (!reason) {
      throw new functions.https.HttpsError("invalid-argument", "userReason is required");
    }
    const requestRow = await loadRequestData(requestId);
    const caller = await requireRequestOwner(context, requestRow.data);
    const paymentRow = await loadPaymentData(requestId, paymentId);
    const payment = paymentRow.data;

    if (payment.paymentType !== PAYMENT_TYPES.IN_PROGRESS) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Unlock request payments are not manually refundable"
      );
    }

    if (
      !new Set([
        PAYMENT_STATUSES.HELD,
        PAYMENT_STATUSES.PAYOUT_READY,
        PAYMENT_STATUSES.SETTLED,
      ]).has(payment.status)
    ) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "This payment is not currently eligible for refund review"
      );
    }

    const existingRefunds = await requestRow.ref
      .collection("refundRequests")
      .where("paymentId", "==", paymentId)
      .limit(20)
      .get();
    const hasOpenRefund = existingRefunds.docs.some((docSnap) => {
      const status = normalizeRefundStatus(docSnap.data()?.status);
      return new Set([
        REFUND_STATUSES.REQUESTED,
        REFUND_STATUSES.UNDER_REVIEW,
        REFUND_STATUSES.APPROVED,
        REFUND_STATUSES.REFUNDED,
        REFUND_STATUSES.AUTO_REFUNDED,
      ]).has(status);
    });
    if (hasOpenRefund) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "A refund request already exists for this payment"
      );
    }

    const refundRef = requestRow.ref.collection("refundRequests").doc();
    const refundId = refundRef.id;
    const eligibility = {
      paymentStatus: payment.status,
      payoutStatus: normalizePayoutStatus(payment?.payoutState?.status),
      payoutAlreadySent:
        normalizePayoutStatus(payment?.payoutState?.status) === PAYOUT_STATUSES.PAID_OUT,
      providerTransactionPresent: Boolean(safeStr(payment?.providerTransactionId)),
      requestStatus: lower(requestRow.data?.status),
    };

    await Promise.all([
      refundRef.set({
        refundId,
        requestId,
        paymentId,
        paymentType: payment.paymentType,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        uid: caller.callerUid,
        status: REFUND_STATUSES.REQUESTED,
        userReason: reason,
        adminExplanation: "",
        rejectionReason: "",
        expectedRefundPeriodText: "",
        eligibility,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs(),
      }),
      paymentRow.ref.set(
        {
          status: PAYMENT_STATUSES.REFUND_REQUESTED,
          refundState: {
            refundId,
            status: REFUND_STATUSES.REQUESTED,
            previousStatus: payment.status,
            requestedAtMs: nowMs(),
            requestedByUid: caller.callerUid,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
    ]);

    await logFinancialAudit({
      action: "refund_requested",
      requestId,
      paymentId,
      refundId,
      actorUid: caller.callerUid,
      actorRole: "user",
      reason,
      next: eligibility,
    });

    await notifyPaymentParties({
      requestData: requestRow.data,
      payment: {
        ...payment,
        id: paymentId,
        status: PAYMENT_STATUSES.REFUND_REQUESTED,
      },
      type: "REFUND_REQUESTED",
      title: "Refund requested",
      body: `${payment.paymentLabel} refund request was submitted.`,
      refundId,
    });

    return { ok: true, refundId };
  });

  const adminDecidePaymentRefund = functions.https.onCall(async (data, context) => {
    const requestId = safeStr(data?.requestId);
    const refundId = safeStr(data?.refundId);
    const decision = lower(data?.decision);
    const note = cleanParagraph(data?.note, 2000);
    const expectedRefundPeriodText = cleanParagraph(data?.expectedRefundPeriodText, 300);
    if (decision !== "approve" && decision !== "reject") {
      throw new functions.https.HttpsError("invalid-argument", "decision must be approve or reject");
    }
    if (!note) {
      throw new functions.https.HttpsError("invalid-argument", "note is required");
    }

    const requestRow = await loadRequestData(requestId);
    const caller = await requireRequestAdmin(context, requestRow.data);
    const refundSnap = await refundDocRef(requestId, refundId).get();
    if (!refundSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Refund request not found");
    }
    const refundData = refundSnap.data() || {};
    const refundStatus = normalizeRefundStatus(refundData?.status);
    if (refundStatus !== REFUND_STATUSES.REQUESTED && refundStatus !== REFUND_STATUSES.UNDER_REVIEW) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Refund request has already been decided"
      );
    }

    const paymentRow = await loadPaymentData(requestId, refundData?.paymentId);
    const payment = paymentRow.data;
    const previousOperationalStatus =
      payment.status === PAYMENT_STATUSES.REFUND_REQUESTED
        ? normalizePaymentStatus(payment?.refundState?.previousStatus || PAYMENT_STATUSES.HELD)
        : normalizePaymentStatus(payment.status);

    if (decision === "reject") {
      await Promise.all([
        refundSnap.ref.set(
          {
            status: REFUND_STATUSES.REJECTED,
            rejectionReason: note,
            adminExplanation: "",
            decisionAt: FieldValue.serverTimestamp(),
            decisionAtMs: nowMs(),
            decidedByAdminUid: caller.callerUid,
            expectedRefundPeriodText: "",
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
        paymentRow.ref.set(
          {
            status: previousOperationalStatus,
            refundState: {
              refundId,
              status: REFUND_STATUSES.REJECTED,
              previousStatus: previousOperationalStatus,
              decidedAtMs: nowMs(),
              decidedByUid: caller.callerUid,
            },
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        ),
      ]);

      await logFinancialAudit({
        action: "refund_rejected",
        requestId,
        paymentId: payment.id,
        refundId,
        actorUid: caller.callerUid,
        actorRole: caller.callerRole,
        reason: note,
        next: { refundStatus: REFUND_STATUSES.REJECTED },
      });

      await notifyPaymentParties({
        requestData: requestRow.data,
        payment: {
          ...payment,
          id: payment.id,
          status: previousOperationalStatus,
        },
        type: "REFUND_REJECTED",
        title: "Refund rejected",
        body: `${payment.paymentLabel} refund request was rejected.`,
        refundId,
      });

      return { ok: true, refundId, status: REFUND_STATUSES.REJECTED };
    }

    const payoutStatus = normalizePayoutStatus(payment?.payoutState?.status);
    if (payoutStatus === PAYOUT_STATUSES.PAID_OUT) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Refund cannot be approved after payout has already been sent"
      );
    }

    await Promise.all([
      refundSnap.ref.set(
        {
          status: REFUND_STATUSES.UNDER_REVIEW,
          adminExplanation: note,
          expectedRefundPeriodText,
          decisionAt: FieldValue.serverTimestamp(),
          decisionAtMs: nowMs(),
          decidedByAdminUid: caller.callerUid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
      paymentRow.ref.set(
        {
          status: PAYMENT_STATUSES.REFUND_UNDER_REVIEW,
          refundState: {
            refundId,
            status: REFUND_STATUSES.UNDER_REVIEW,
            previousStatus: previousOperationalStatus,
            decidedAtMs: nowMs(),
            decidedByUid: caller.callerUid,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
    ]);

    const settings = await getFinanceSettings();
    const providerStatus = buildProviderStatus(settings);
    let providerRefund = null;
    let finalRefundStatus = REFUND_STATUSES.REFUNDED;
    let finalPaymentStatus = PAYMENT_STATUSES.REFUNDED;
    let payoutQueueStatus = payoutStatus;

    if (providerStatus.secretConfigured && safeStr(payment?.providerTransactionId)) {
      try {
        const refundPayload = await createPaystackRefund({
          transaction: safeStr(payment.providerTransactionId),
          amountMinor: moneyToMinorUnits(payment.amount, payment.currency),
          merchantNote: note,
          customerNote: note,
          secretKey: providerStatus.secretKey,
        });
        providerRefund = summarizePaystackRefund(refundPayload);
        if (
          providerRefund?.status &&
          providerRefund.status !== "processed" &&
          providerRefund.status !== "success"
        ) {
          finalRefundStatus = REFUND_STATUSES.APPROVED;
          finalPaymentStatus = PAYMENT_STATUSES.REFUND_UNDER_REVIEW;
        }
      } catch (error) {
        logger.error("provider refund approval failed", {
          requestId,
          paymentId: payment.id,
          refundId,
          error: error?.message || String(error),
        });
        finalRefundStatus = REFUND_STATUSES.APPROVED;
        finalPaymentStatus = PAYMENT_STATUSES.REFUND_UNDER_REVIEW;
      }
    } else {
      finalRefundStatus = REFUND_STATUSES.APPROVED;
      finalPaymentStatus = PAYMENT_STATUSES.REFUND_UNDER_REVIEW;
    }

    if (payoutStatus === PAYOUT_STATUSES.READY || payoutStatus === PAYOUT_STATUSES.ON_HOLD) {
      payoutQueueStatus = PAYOUT_STATUSES.REVERSED;
      const queueId = safeStr(payment?.payoutState?.queueItemId);
      if (queueId) {
        await topLevelRef(PAYOUT_QUEUE_COLLECTION, queueId).set(
          {
            status: payoutQueueStatus,
            holdReason: "refund_approved",
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: nowMs(),
          },
          { merge: true }
        );
      }
    }

    await Promise.all([
      refundSnap.ref.set(
        {
          status: finalRefundStatus,
          providerRefund: providerRefund || null,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
      paymentRow.ref.set(
        {
          status: finalPaymentStatus,
          refundedAt:
            finalPaymentStatus === PAYMENT_STATUSES.REFUNDED
              ? FieldValue.serverTimestamp()
              : null,
          refundedAtMs:
            finalPaymentStatus === PAYMENT_STATUSES.REFUNDED ? nowMs() : 0,
          refundState: {
            refundId,
            status: finalRefundStatus,
            previousStatus: previousOperationalStatus,
            decidedAtMs: nowMs(),
            decidedByUid: caller.callerUid,
          },
          payoutState: payment?.payoutState
            ? {
                ...(payment.payoutState || {}),
                status: payoutQueueStatus,
              }
            : payment?.payoutState,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
    ]);

    await logFinancialAudit({
      action:
        finalRefundStatus === REFUND_STATUSES.REFUNDED
          ? "refund_completed"
          : "refund_approved",
      requestId,
      paymentId: payment.id,
      refundId,
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      reason: note,
      next: {
        refundStatus: finalRefundStatus,
        paymentStatus: finalPaymentStatus,
        payoutQueueStatus,
      },
    });

    await notifyPaymentParties({
      requestData: requestRow.data,
      payment: {
        ...payment,
        id: payment.id,
        status: finalPaymentStatus,
      },
      type:
        finalRefundStatus === REFUND_STATUSES.REFUNDED
          ? "REFUND_COMPLETED"
          : "REFUND_APPROVED",
      title:
        finalRefundStatus === REFUND_STATUSES.REFUNDED
          ? "Refund completed"
          : "Refund approved",
      body:
        finalRefundStatus === REFUND_STATUSES.REFUNDED
          ? `${payment.paymentLabel} was refunded successfully.`
          : `${payment.paymentLabel} refund was approved and is awaiting provider completion.`,
      refundId,
    });

    return {
      ok: true,
      refundId,
      status: finalRefundStatus,
      paymentStatus: finalPaymentStatus,
    };
  });

  const releasePartnerPayout = functions.https.onCall(async (data, context) => {
    const caller = await requireAdminCallerContext(context, {
      allowManager: true,
      requiredManagerModule: "finances",
      allowAssignedAdmin: false,
    });
    const queueId = safeStr(data?.queueId);
    const releaseNotes = cleanParagraph(data?.releaseNotes, 2000);
    const settlementReference = safeStr(data?.settlementReference, 160);
    if (!queueId) {
      throw new functions.https.HttpsError("invalid-argument", "queueId is required");
    }

    const queueRef = topLevelRef(PAYOUT_QUEUE_COLLECTION, queueId);
    const queueSnap = await queueRef.get();
    if (!queueSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Payout queue item not found");
    }
    const queueData = queueSnap.data() || {};
    const queueStatus = normalizePayoutStatus(queueData?.status);
    if (queueStatus !== PAYOUT_STATUSES.READY) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Only ready payout items can be released"
      );
    }
    if (queueData?.payoutDestinationReady !== true) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Partner payout destination is not ready"
      );
    }

    const requestId = safeStr(queueData?.requestId);
    const paymentId = safeStr(queueData?.paymentId);
    const requestRow = await loadRequestData(requestId);
    const paymentRow = await loadPaymentData(requestId, paymentId);

    const settlementRef = topLevelRef(SETTLEMENT_HISTORY_COLLECTION, `settlement_${queueId}`);
    await Promise.all([
      queueRef.set(
        {
          status: PAYOUT_STATUSES.PAID_OUT,
          releaseNotes,
          settlementReference,
          releasedByUid: caller.callerUid,
          releasedByRole: caller.callerRole,
          releasedAt: FieldValue.serverTimestamp(),
          releasedAtMs: nowMs(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
      settlementRef.set({
        settlementId: `settlement_${queueId}`,
        queueId,
        requestId,
        paymentId,
        partnerId: safeStr(queueData?.partnerId),
        partnerName: safeStr(queueData?.partnerName),
        amount: roundMoney(queueData?.amount),
        currency: normalizeCurrency(queueData?.currency || "KES"),
        settlementReference,
        releaseNotes,
        releasedByUid: caller.callerUid,
        releasedByRole: caller.callerRole,
        releasedAt: FieldValue.serverTimestamp(),
        releasedAtMs: nowMs(),
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs(),
      }),
      paymentRow.ref.set(
        {
          status: PAYMENT_STATUSES.SETTLED,
          payoutState: {
            ...(paymentRow.data?.payoutState || {}),
            queueItemId: queueId,
            status: PAYOUT_STATUSES.PAID_OUT,
            settledAtMs: nowMs(),
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs(),
        },
        { merge: true }
      ),
    ]);

    await logFinancialAudit({
      action: "payout_released",
      requestId,
      paymentId,
      payoutQueueId: queueId,
      actorUid: caller.callerUid,
      actorRole: caller.callerRole,
      reason: releaseNotes,
      next: {
        settlementReference,
        payoutStatus: PAYOUT_STATUSES.PAID_OUT,
      },
    });
    await logFinanceManagerActivity(
      caller,
      "payout_released",
      `Payout released for queue ${queueId}`,
      { queueId, requestId, paymentId }
    );

    await notifyPaymentParties({
      requestData: requestRow.data,
      payment: {
        ...paymentRow.data,
        id: paymentId,
        status: PAYMENT_STATUSES.SETTLED,
      },
      type: "PAYMENT_UPDATE",
      title: "Partner payout settled",
      body: `${paymentRow.data.paymentLabel} payout was marked as settled internally.`,
    });

    return { ok: true, queueId, status: PAYOUT_STATUSES.PAID_OUT };
  });

  const reconcilePaymentReference = functions.https.onCall(async (data) => {
    const result = await finalizeSuccessfulPayment({
      reference: safeStr(data?.reference),
      source: "redirect_verify",
      redirectParams:
        data?.redirectParams && typeof data.redirectParams === "object"
          ? data.redirectParams
          : null,
    });
    return result;
  });

  const listUnlockAutoRefundCandidates = functions.https.onCall(async (data, context) => {
    await requireAdminCallerContext(context, {
      allowManager: true,
      requiredManagerModule: "finances",
      allowAssignedAdmin: false,
    });
    const ids = Array.from(
      new Set((Array.isArray(data?.requestIds) ? data.requestIds : []).map((id) => safeStr(id)).filter(Boolean))
    );
    const rows = [];

    for (const requestId of ids) {
      const requestSnap = await requestDocRef(requestId).get();
      if (!requestSnap.exists) continue;
      const requestData = requestSnap.data() || {};
      const unlockPaymentId = safeStr(requestData?.unlockPaymentId) || "unlock_request_payment";
      const paymentSnap = await paymentDocRef(requestId, unlockPaymentId).get();
      if (!paymentSnap.exists) continue;
      const payment = normalizePaymentRow({ id: paymentSnap.id, ...(paymentSnap.data() || {}) });
      const eligibleAtMs = toNum(
        payment?.unlockAutoRefundEligibleAtMs || requestData?.unlockAutoRefundEligibleAtMs,
        0
      );
      if (
        payment.paymentType !== PAYMENT_TYPES.UNLOCK_REQUEST ||
        payment.status !== PAYMENT_STATUSES.PAID ||
        eligibleAtMs <= 0 ||
        nowMs() < eligibleAtMs ||
        shouldBlockUnlockAutoRefund(requestData)
      ) {
        continue;
      }
      rows.push({
        requestId,
        paymentId: payment.id,
        paymentLabel: payment.paymentLabel,
        amount: payment.amount,
        currency: payment.currency,
        eligibleAtMs,
      });
    }

    rows.sort((a, b) => Number(a.eligibleAtMs || 0) - Number(b.eligibleAtMs || 0));
    return { ok: true, rows };
  });

  const runUnlockAutoRefundSweep = functions.https.onCall(async (data, context) => {
    const caller = await requireAdminCallerContext(context, {
      allowManager: true,
      requiredManagerModule: "finances",
      allowAssignedAdmin: false,
    });
    const ids = Array.from(
      new Set((Array.isArray(data?.requestIds) ? data.requestIds : []).map((id) => safeStr(id)).filter(Boolean))
    );
    let applied = 0;
    for (const requestId of ids) {
      const result = await maybeAutoRefundUnlockPayment({
        requestId,
        actorUid: safeStr(context?.auth?.uid) || "system",
        actorRole: caller?.isManager ? "manager_manual_sweep" : "admin_manual_sweep",
      });
      if (result?.applied) applied += 1;
    }
    return { ok: true, applied };
  });

  const sweepUnlockPaymentAutoRefunds = onSchedule(
    {
      region: REGION,
      schedule: "every 15 minutes",
      timeZone: "Etc/UTC",
    },
    async () => {
      const settings = await getFinanceSettings();
      if (settings?.refundControls?.autoRefundEnabled === false) return;

      const currentMs = nowMs();
      const snap = await db
        .collection("serviceRequests")
        .where("unlockAutoRefundEligibleAtMs", "<=", currentMs)
        .limit(120)
        .get();

      for (const docSnap of snap.docs) {
        try {
          await maybeAutoRefundUnlockPayment({
            requestId: docSnap.id,
            actorUid: "system",
            actorRole: "scheduler",
          });
        } catch (error) {
          logger.error("unlock auto-refund sweep failed", {
            requestId: docSnap.id,
            error: error?.message || String(error),
          });
        }
      }
    }
  );

  const paystackWebhook = functions.region(REGION).https.onRequest(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const settings = await getFinanceSettings();
    const providerStatus = buildProviderStatus(settings);
    if (!providerStatus.secretConfigured) {
      res.status(503).send("Provider not configured");
      return;
    }

    const signature = safeStr(req.headers["x-paystack-signature"], 300).toLowerCase();
    const expectedSignature = crypto
      .createHmac("sha512", providerStatus.secretKey)
      .update(req.rawBody || Buffer.from(JSON.stringify(req.body || {})))
      .digest("hex")
      .toLowerCase();

    if (!signature || signature !== expectedSignature) {
      logger.warn("invalid paystack webhook signature");
      res.status(401).send("invalid signature");
      return;
    }

    const eventPayload = req.body && typeof req.body === "object" ? req.body : {};
    const eventName = safeStr(eventPayload?.event, 120) || "unknown";
    const reference = safeStr(eventPayload?.data?.reference, 120);
    const providerEventId =
      safeStr(eventPayload?.data?.id, 120) ||
      reference ||
      crypto.randomBytes(8).toString("hex");
    const lockId = `paystack_${eventName}_${providerEventId}`;

    if (!(await claimEventLock(lockId, "paystack_webhook"))) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    await topLevelRef(PAYMENT_PROVIDER_EVENTS_COLLECTION, lockId).set({
      provider: "paystack",
      event: eventName,
      reference,
      transactionId: safeStr(eventPayload?.data?.id, 120),
      payload: eventPayload,
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs(),
    });

    try {
      if (reference && eventName === "charge.success") {
        await finalizeSuccessfulPayment({
          reference,
          source: "paystack_webhook",
          webhookPayload: eventPayload,
        });
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      logger.error("paystack webhook processing failed", {
        reference,
        eventName,
        error: error?.message || String(error),
      });
      res.status(200).json({ ok: false, retrySafe: true });
    }
  });

  return {
    saveFinanceSettings,
    savePartnerFinancialProfile,
    getFinanceEnvironmentStatus,
    createFullPackageUnlockCheckoutSession,
    createUnlockCheckoutSession,
    activatePreparedUnlockRequest,
    createInProgressPaymentProposal,
    adminApprovePaymentRequest,
    adminRevokePaymentRequest,
    createPaymentCheckoutSession,
    getOrCreateSharedPaymentLink,
    resolveSharedPaymentLink,
    requestPaymentRefund,
    adminDecidePaymentRefund,
    releasePartnerPayout,
    reconcilePaymentReference,
    listUnlockAutoRefundCandidates,
    runUnlockAutoRefundSweep,
    sweepUnlockPaymentAutoRefunds,
    paystackWebhook,
  };
};

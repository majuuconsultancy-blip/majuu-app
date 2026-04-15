import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { db } from "../firebase";

const functions = getFunctions(undefined, "us-central1");

export const FINANCE_SETTINGS_COLLECTION = "financeSettings";
export const FINANCE_SETTINGS_DOC = "global";
export const PAYOUT_QUEUE_COLLECTION = "payoutQueue";
export const SETTLEMENT_HISTORY_COLLECTION = "settlementHistory";
export const FINANCIAL_AUDIT_LOG_COLLECTION = "financialAuditLogs";

export const PLATFORM_CUT_TYPES = ["percentage", "flat"];
export const PAYMENT_PROVIDERS = ["mpesa", "paystack"];
export const PAYOUT_QUEUE_STATUSES = [
  "pending",
  "on_hold",
  "ready",
  "processing",
  "paid_out",
  "failed",
  "reversed",
];

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return safeString(value, max).toLowerCase();
}

function roundMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

function roundRate(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100) / 100);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCurrency(value, fallback = "KES") {
  return safeString(value || fallback, 8).toUpperCase() || fallback;
}

function normalizeFeeType(value, fallback = "percentage") {
  return lower(value) === "flat" ? "flat" : fallback === "flat" ? "flat" : "percentage";
}

function normalizeProviderKey(value, fallback = "mpesa") {
  const raw = lower(value, 40);
  if (PAYMENT_PROVIDERS.includes(raw)) return raw;
  return PAYMENT_PROVIDERS.includes(lower(fallback, 40)) ? lower(fallback, 40) : "mpesa";
}

function defaultProviderCatalog() {
  return {
    mpesa: {
      enabled: true,
      label: "M-Pesa",
    },
    paystack: {
      enabled: false,
      label: "Paystack",
    },
  };
}

function normalizeProviderCatalog(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = defaultProviderCatalog();
  return PAYMENT_PROVIDERS.reduce((acc, providerKey) => {
    const row = source?.[providerKey] && typeof source[providerKey] === "object" ? source[providerKey] : {};
    acc[providerKey] = {
      enabled:
        typeof row?.enabled === "boolean"
          ? row.enabled
          : defaults?.[providerKey]?.enabled === true,
      label: safeString(row?.label || defaults?.[providerKey]?.label, 80) || defaults?.[providerKey]?.label,
    };
    return acc;
  }, {});
}

function callFinance(name, payload = {}) {
  const callable = httpsCallable(functions, name);
  return callable(payload).then((result) => result?.data ?? null);
}

export function defaultFinanceSettings() {
  const providers = defaultProviderCatalog();
  return {
    paymentProvider: {
      activeProvider: "mpesa",
      providerEnvironment: "test",
      providerCallbackUrl: "",
      paymentLinkBaseUrl: "",
      providers,
    },
    pricingControls: {
      globalDiscountEnabled: false,
      globalDiscountPercentage: 0,
    },
    // Backward-compatible alias retained for older readers.
    provider: {
      name: "mpesa",
      active: "mpesa",
      environment: "test",
      callbackBaseUrl: "",
      paymentLinkBaseUrl: "",
      providers,
    },
    defaultCurrency: "KES",
    refundControls: {
      unlockAutoRefundHours: 48,
      autoRefundEnabled: true,
      sharedLinkExpiryHours: 72,
    },
    payoutControls: {
      manualReleaseOnly: true,
      requireDestination: true,
      deductProcessorFeeFromPartner: false,
    },
    // Legacy fallbacks preserved to avoid breaking older finance logic paths.
    inProgressPricing: {
      defaultCurrency: "KES",
      allowServiceFeeInput: true,
      allowAdminAdjustAmounts: true,
      platformCutEnabledGlobal: true,
    },
    platformFee: {
      defaultCutType: "percentage",
      defaultCutValue: 10,
      cutBase: "official_plus_service_fee",
    },
  };
}

export function normalizeFinanceSettingsDoc(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  const defaults = defaultFinanceSettings();
  const providerCatalog = normalizeProviderCatalog(
    source?.paymentProvider?.providers ||
      source?.provider?.providers ||
      defaults?.paymentProvider?.providers
  );
  const activeProvider = normalizeProviderKey(
    source?.paymentProvider?.activeProvider ||
      source?.provider?.active ||
      source?.provider?.name,
    defaults?.paymentProvider?.activeProvider
  );
  const providerEnvironment =
    lower(
      source?.paymentProvider?.providerEnvironment ||
        source?.provider?.environment ||
        defaults?.paymentProvider?.providerEnvironment
    ) === "live"
      ? "live"
      : "test";
  const providerCallbackUrl = safeString(
    source?.paymentProvider?.providerCallbackUrl ||
      source?.paymentProvider?.callbackBaseUrl ||
      source?.provider?.callbackBaseUrl ||
      defaults?.paymentProvider?.providerCallbackUrl,
    400
  );
  const defaultCurrency = normalizeCurrency(
    source?.defaultCurrency ||
      source?.inProgressPricing?.defaultCurrency ||
      defaults.defaultCurrency
  );
  const allowServiceFeeInput =
    source?.inProgressPricing?.allowServiceFeeInput !== false;
  const allowAdminAdjustAmounts =
    source?.inProgressPricing?.allowAdminAdjustAmounts !== false;
  const platformCutType = normalizeFeeType(
    source?.platformFee?.defaultCutType || defaults?.platformFee?.defaultCutType
  );
  const platformCutValue = roundRate(
    source?.platformFee?.defaultCutValue ?? defaults?.platformFee?.defaultCutValue
  );
  const platformCutBase =
    lower(source?.platformFee?.cutBase) === "official_amount"
      ? "official_amount"
      : "official_plus_service_fee";
  return {
    paymentProvider: {
      activeProvider,
      providerEnvironment,
      providerCallbackUrl,
      paymentLinkBaseUrl: safeString(
        source?.paymentProvider?.paymentLinkBaseUrl ||
          source?.provider?.paymentLinkBaseUrl,
        400
      ),
      providers: providerCatalog,
    },
    pricingControls: {
      globalDiscountEnabled: source?.pricingControls?.globalDiscountEnabled === true,
      globalDiscountPercentage: roundRate(source?.pricingControls?.globalDiscountPercentage),
    },
    provider: {
      name: activeProvider,
      active: activeProvider,
      environment: providerEnvironment,
      callbackBaseUrl: providerCallbackUrl,
      paymentLinkBaseUrl: safeString(
        source?.paymentProvider?.paymentLinkBaseUrl ||
          source?.provider?.paymentLinkBaseUrl,
        400
      ),
      providers: providerCatalog,
    },
    defaultCurrency,
    refundControls: {
      unlockAutoRefundHours: roundMoney(
        source?.refundControls?.unlockAutoRefundHours ?? defaults.refundControls.unlockAutoRefundHours
      ),
      autoRefundEnabled: source?.refundControls?.autoRefundEnabled !== false,
      sharedLinkExpiryHours: roundMoney(
        source?.refundControls?.sharedLinkExpiryHours ?? defaults.refundControls.sharedLinkExpiryHours
      ),
    },
    payoutControls: {
      manualReleaseOnly: source?.payoutControls?.manualReleaseOnly !== false,
      requireDestination: source?.payoutControls?.requireDestination !== false,
      deductProcessorFeeFromPartner:
        source?.payoutControls?.deductProcessorFeeFromPartner === true,
    },
    inProgressPricing: {
      defaultCurrency,
      allowServiceFeeInput,
      allowAdminAdjustAmounts,
      platformCutEnabledGlobal:
        source?.inProgressPricing?.platformCutEnabledGlobal !== false,
    },
    platformFee: {
      defaultCutType: platformCutType,
      defaultCutValue: platformCutValue,
      cutBase: platformCutBase,
    },
    updatedAtMs: Number(source?.updatedAtMs || 0) || toMillis(source?.updatedAt),
    updatedByUid: safeString(source?.updatedByUid, 160),
    updatedByEmail: safeString(source?.updatedByEmail, 180),
  };
}

export function normalizePayoutQueueRow(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ...source,
    id: safeString(source?.id, 180),
    queueId: safeString(source?.queueId || source?.id, 180),
    requestId: safeString(source?.requestId, 180),
    paymentId: safeString(source?.paymentId, 180),
    partnerId: safeString(source?.partnerId, 160),
    partnerName: safeString(source?.partnerName, 160),
    status: lower(source?.status, 80),
    amount: roundMoney(source?.amount),
    currency: normalizeCurrency(source?.currency || "KES"),
    holdReason: safeString(source?.holdReason, 200),
    payoutDestinationReady: source?.payoutDestinationReady === true,
    settlementReference: safeString(source?.settlementReference, 160),
    releaseNotes: safeString(source?.releaseNotes, 2000),
    createdAtMs: Number(source?.createdAtMs || 0) || toMillis(source?.createdAt),
    updatedAtMs: Number(source?.updatedAtMs || 0) || toMillis(source?.updatedAt),
    releasedAtMs: Number(source?.releasedAtMs || 0) || toMillis(source?.releasedAt),
  };
}

export function normalizeSettlementRow(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ...source,
    id: safeString(source?.settlementId || source?.id, 180),
    settlementId: safeString(source?.settlementId || source?.id, 180),
    queueId: safeString(source?.queueId, 180),
    requestId: safeString(source?.requestId, 180),
    paymentId: safeString(source?.paymentId, 180),
    partnerId: safeString(source?.partnerId, 160),
    partnerName: safeString(source?.partnerName, 160),
    amount: roundMoney(source?.amount),
    currency: normalizeCurrency(source?.currency || "KES"),
    settlementReference: safeString(source?.settlementReference, 160),
    releaseNotes: safeString(source?.releaseNotes, 2000),
    releasedByUid: safeString(source?.releasedByUid, 160),
    releasedByRole: safeString(source?.releasedByRole, 80),
    createdAtMs: Number(source?.createdAtMs || 0) || toMillis(source?.createdAt),
    releasedAtMs: Number(source?.releasedAtMs || 0) || toMillis(source?.releasedAt),
  };
}

export function normalizeFinancialAuditRow(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  return {
    ...source,
    id: safeString(source?.auditId || source?.id, 180),
    auditId: safeString(source?.auditId || source?.id, 180),
    action: safeString(source?.action, 120),
    actorUid: safeString(source?.actorUid, 160),
    actorRole: safeString(source?.actorRole, 80),
    requestId: safeString(source?.requestId, 180),
    paymentId: safeString(source?.paymentId, 180),
    refundId: safeString(source?.refundId, 180),
    payoutQueueId: safeString(source?.payoutQueueId, 180),
    reason: safeString(source?.reason, 2000),
    createdAtMs: Number(source?.createdAtMs || 0) || toMillis(source?.createdAt),
  };
}

export function subscribeFinanceSettings({ onData, onError } = {}) {
  const ref = doc(db, FINANCE_SETTINGS_COLLECTION, FINANCE_SETTINGS_DOC);
  return onSnapshot(
    ref,
    (snap) => {
      onData?.(normalizeFinanceSettingsDoc(snap.exists() ? snap.data() || {} : {}));
    },
    onError
  );
}

export function subscribePayoutQueue({ onData, onError, max = 120 } = {}) {
  const ref = query(
    collection(db, PAYOUT_QUEUE_COLLECTION),
    orderBy("updatedAtMs", "desc"),
    limit(max)
  );
  return onSnapshot(
    ref,
    (snap) => {
      onData?.(
        snap.docs.map((docSnap) =>
          normalizePayoutQueueRow({ id: docSnap.id, ...(docSnap.data() || {}) })
        )
      );
    },
    onError
  );
}

export function subscribeSettlementHistory({ onData, onError, max = 120 } = {}) {
  const ref = query(
    collection(db, SETTLEMENT_HISTORY_COLLECTION),
    orderBy("createdAtMs", "desc"),
    limit(max)
  );
  return onSnapshot(
    ref,
    (snap) => {
      onData?.(
        snap.docs.map((docSnap) =>
          normalizeSettlementRow({ id: docSnap.id, ...(docSnap.data() || {}) })
        )
      );
    },
    onError
  );
}

export function subscribeFinancialAuditLog({ onData, onError, max = 150 } = {}) {
  const ref = query(
    collection(db, FINANCIAL_AUDIT_LOG_COLLECTION),
    orderBy("createdAtMs", "desc"),
    limit(max)
  );
  return onSnapshot(
    ref,
    (snap) => {
      onData?.(
        snap.docs.map((docSnap) =>
          normalizeFinancialAuditRow({ id: docSnap.id, ...(docSnap.data() || {}) })
        )
      );
    },
    onError
  );
}

export async function getFinanceEnvironmentStatus() {
  return callFinance("getFinanceEnvironmentStatus", {});
}

export async function saveFinanceSettings(settings = {}) {
  return callFinance("saveFinanceSettings", { settings });
}

export async function getPaymentProviderConfigStatus() {
  return callFinance("getPaymentProviderConfigStatus", {});
}

export async function savePaymentProviderConfig(config = {}) {
  return callFinance("savePaymentProviderConfig", { config });
}

export async function releaseQueuedPartnerPayout(payload = {}) {
  return callFinance("releasePartnerPayout", payload);
}

export async function createInProgressPaymentProposal(payload = {}) {
  return callFinance("createInProgressPaymentProposal", payload);
}

export async function adminApprovePaymentRequest(payload = {}) {
  return callFinance("adminApprovePaymentRequest", payload);
}

export async function adminRevokePaymentRequest(payload = {}) {
  return callFinance("adminRevokePaymentRequest", payload);
}

export async function createUnlockCheckoutSession(payload = {}) {
  return callFinance("createUnlockCheckoutSession", payload);
}

export async function createPaymentCheckoutSession(payload = {}) {
  return callFinance("createPaymentCheckoutSession", payload);
}

export async function getOrCreateSharedPaymentLink(payload = {}) {
  return callFinance("getOrCreateSharedPaymentLink", payload);
}

export async function resolveSharedPaymentLink(payload = {}) {
  return callFinance("resolveSharedPaymentLink", payload);
}

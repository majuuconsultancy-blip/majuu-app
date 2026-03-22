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
export const PARTNER_FINANCIAL_PROFILES_COLLECTION = "partnerFinancialProfiles";
export const PAYOUT_QUEUE_COLLECTION = "payoutQueue";
export const SETTLEMENT_HISTORY_COLLECTION = "settlementHistory";
export const FINANCIAL_AUDIT_LOG_COLLECTION = "financialAuditLogs";

export const PLATFORM_CUT_TYPES = ["percentage", "flat"];
export const PLATFORM_CUT_BASE_OPTIONS = ["official_plus_service_fee", "official_amount"];
export const TAX_MODES = ["exclusive", "inclusive"];
export const PAYOUT_RELEASE_BEHAVIORS = ["manual_review", "auto_release"];
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

function normalizeTaxMode(value, fallback = "exclusive") {
  return lower(value) === "inclusive"
    ? "inclusive"
    : fallback === "inclusive"
      ? "inclusive"
      : "exclusive";
}

function callFinance(name, payload = {}) {
  const callable = httpsCallable(functions, name);
  return callable(payload).then((result) => result?.data ?? null);
}

export function defaultFinanceSettings() {
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
      unlockAutoRefundHours: 48,
      autoRefundEnabled: true,
      sharedLinkExpiryHours: 72,
    },
    payoutControls: {
      manualReleaseOnly: true,
      requireDestination: true,
      deductProcessorFeeFromPartner: false,
    },
  };
}

export function normalizeFinanceSettingsDoc(row = {}) {
  const source = row && typeof row === "object" ? row : {};
  const defaults = defaultFinanceSettings();
  return {
    provider: {
      name: "paystack",
      environment: lower(source?.provider?.environment || defaults.provider.environment) === "live"
        ? "live"
        : "test",
      callbackBaseUrl: safeString(
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
      label: safeString(source?.tax?.label || defaults.tax.label, 80) || "Tax",
      type: normalizeFeeType(source?.tax?.type || defaults.tax.type),
      rate: roundRate(source?.tax?.rate ?? defaults.tax.rate),
      mode: normalizeTaxMode(source?.tax?.mode || defaults.tax.mode),
    },
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
    updatedAtMs: Number(source?.updatedAtMs || 0) || toMillis(source?.updatedAt),
    updatedByUid: safeString(source?.updatedByUid, 160),
    updatedByEmail: safeString(source?.updatedByEmail, 180),
  };
}

export function defaultPartnerFinancialProfile(partner = {}) {
  return {
    partnerId: safeString(partner?.id, 140),
    partnerName: safeString(partner?.displayName || partner?.partnerName, 140),
    activeFinancialStatus: "active",
    defaultPlatformCutType: "percentage",
    defaultPlatformCutValue: 10,
    platformCutBase: "official_plus_service_fee",
    taxProfileReference: "",
    taxOverrides: null,
    payoutReleaseBehavior: "manual_review",
    payoutDestinationReady: false,
    payoutDestination: {
      type: "bank_transfer",
      bankName: "",
      accountName: "",
      accountNumberLast4: "",
      reference: "",
    },
    notes: "",
    effectiveAtMs: Date.now(),
    updatedAtMs: 0,
  };
}

function normalizePayoutDestination(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    type: safeString(source?.type || "bank_transfer", 40) || "bank_transfer",
    bankName: safeString(source?.bankName, 120),
    accountName: safeString(source?.accountName, 120),
    accountNumberLast4: safeString(source?.accountNumberLast4, 8).slice(-4),
    reference: safeString(source?.reference, 160),
  };
}

export function normalizePartnerFinancialProfileDoc(row = {}, partner = {}) {
  const source = row && typeof row === "object" ? row : {};
  const defaults = defaultPartnerFinancialProfile(partner);
  return {
    partnerId: safeString(source?.partnerId || defaults.partnerId, 140),
    partnerName: safeString(source?.partnerName || defaults.partnerName, 140),
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
    taxProfileReference: safeString(
      source?.taxProfileReference || defaults.taxProfileReference,
      160
    ),
    taxOverrides:
      source?.taxOverrides && typeof source.taxOverrides === "object"
        ? {
            enabled: source.taxOverrides.enabled === true,
            label: safeString(source.taxOverrides.label, 80),
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
    notes: safeString(source?.notes || defaults.notes, 4000),
    effectiveAtMs: Number(source?.effectiveAtMs || 0) || defaults.effectiveAtMs,
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

export function subscribePartnerFinancialProfiles({ onData, onError, max = 250 } = {}) {
  const ref = query(collection(db, PARTNER_FINANCIAL_PROFILES_COLLECTION), limit(max));
  return onSnapshot(
    ref,
    (snap) => {
      const rows = snap.docs
        .map((docSnap) =>
          normalizePartnerFinancialProfileDoc({ id: docSnap.id, ...(docSnap.data() || {}) })
        )
        .sort((left, right) => left.partnerName.localeCompare(right.partnerName));
      onData?.(rows);
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

export async function savePartnerFinancialProfile({ partnerId, profile } = {}) {
  return callFinance("savePartnerFinancialProfile", { partnerId, profile });
}

export async function releaseQueuedPartnerPayout(payload = {}) {
  return callFinance("releasePartnerPayout", payload);
}

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Coins,
  FileText,
  Link2,
  Package,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { managerHasModuleAccess } from "../services/managerModules";
import {
  defaultFinanceSettings,
  getFinanceEnvironmentStatus,
  getPaymentProviderConfigStatus,
  PAYMENT_PROVIDERS,
  releaseQueuedPartnerPayout,
  saveFinanceSettings,
  savePaymentProviderConfig,
  subscribeFinanceSettings,
  subscribeFinancialAuditLog,
  subscribePayoutQueue,
  subscribeSettlementHistory,
} from "../services/financeservice";
import { listPartners } from "../services/partnershipService";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function isPermissionIssue(error) {
  const code = safeString(error?.code, 80).toLowerCase();
  const message = safeString(error?.message, 240).toLowerCase();
  return code.includes("permission-denied") || message.includes("permission") || message.includes("missing or insufficient permissions");
}

function handleFinanceReadError(error, fallbackMessage, setErr) {
  console.error(error);
  if (isPermissionIssue(error)) return;
  setErr(error?.message || fallbackMessage);
}

function toDateTimeLabel(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "Not available";
  return new Date(ms).toLocaleString();
}

function formatMoney(amount, currency = "KES") {
  const safeAmount = Math.max(0, Math.round(Number(amount || 0)));
  const safeCurrency = safeString(currency || "KES", 8).toUpperCase() || "KES";
  return `${safeCurrency} ${safeAmount.toLocaleString()}`;
}

function paymentProviderLabel(value) {
  const key = safeString(value, 40).toLowerCase();
  if (key === "mpesa") return "M-Pesa";
  return key ? key.toUpperCase() : "Unknown";
}

function createOpenSections() {
  return {
    environment: false,
    providers: false,
    branchFinance: false,
    payoutQueue: false,
    settlementHistory: false,
    auditLog: false,
  };
}

function SectionCard({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  meta = null,
  children,
}) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
            <AppIcon icon={icon} size={ICON_MD} />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
            {subtitle ? (
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {meta}
          <AppIcon
            icon={ChevronDown}
            size={ICON_MD}
            className={`text-zinc-500 transition ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function TinyStat({ label, value, tone = "default" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50/80 text-amber-900"
        : "border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200";
  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ToggleRow({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-400"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {label}
        </span>
        {hint ? (
          <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-300">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export default function AdminFinancesScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [hasFinanceAccess, setHasFinanceAccess] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isFinanceManager, setIsFinanceManager] = useState(false);
  const [partners, setPartners] = useState([]);
  const [payoutQueue, setPayoutQueue] = useState([]);
  const [settlementHistory, setSettlementHistory] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [environmentStatus, setEnvironmentStatus] = useState(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState(defaultFinanceSettings());
  const [settingsDraft, setSettingsDraft] = useState(defaultFinanceSettings());
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [providerConfigSnapshot, setProviderConfigSnapshot] = useState(null);
  const [providerConfigDraft, setProviderConfigDraft] = useState(null);
  const [providerConfigDirty, setProviderConfigDirty] = useState(false);
  const [providerConfigBusy, setProviderConfigBusy] = useState(false);
  const [providerEncryptionReady, setProviderEncryptionReady] = useState(false);
  const [releaseDraftByQueueId, setReleaseDraftByQueueId] = useState({});
  const [releaseBusyId, setReleaseBusyId] = useState("");
  const [openSections, setOpenSections] = useState(createOpenSections);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const labelClass =
    "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const inputClass =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext();
        const managerAllowed =
          Boolean(roleCtx?.isManager) &&
          managerHasModuleAccess(roleCtx?.managerScope, "finances");
        if (!cancelled) {
          setHasFinanceAccess(Boolean(roleCtx?.isSuperAdmin || managerAllowed));
          setIsSuperAdmin(Boolean(roleCtx?.isSuperAdmin));
          setIsFinanceManager(managerAllowed);
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setHasFinanceAccess(false);
          setIsSuperAdmin(false);
          setIsFinanceManager(false);
        }
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canEditFinance = isSuperAdmin || isFinanceManager;

  useEffect(() => {
    if (!hasFinanceAccess) return undefined;
    let cancelled = false;
    void listPartners({ activeOnly: false, max: 300 })
      .then((rows) => {
        if (!cancelled) setPartners(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!cancelled) {
          setPartners([]);
          handleFinanceReadError(error, "Failed to load partners.", setErr);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasFinanceAccess]);

  useEffect(() => {
    if (!hasFinanceAccess) return undefined;
    return subscribeFinanceSettings({
      onData: (settings) => {
        setSettingsSnapshot(settings);
        if (!settingsDirty) setSettingsDraft(settings);
      },
      onError: (error) => {
        handleFinanceReadError(error, "Failed to load finance settings.", setErr);
      },
    });
  }, [hasFinanceAccess, settingsDirty]);

  useEffect(() => {
    if (!hasFinanceAccess) return undefined;
    return subscribePayoutQueue({
      onData: (rows) => setPayoutQueue(Array.isArray(rows) ? rows : []),
      onError: (error) => {
        handleFinanceReadError(error, "Failed to load payout queue.", setErr);
      },
    });
  }, [hasFinanceAccess]);

  useEffect(() => {
    if (!hasFinanceAccess) return undefined;
    return subscribeSettlementHistory({
      onData: (rows) => setSettlementHistory(Array.isArray(rows) ? rows : []),
      onError: (error) => {
        handleFinanceReadError(error, "Failed to load settlement history.", setErr);
      },
    });
  }, [hasFinanceAccess]);

  useEffect(() => {
    if (!hasFinanceAccess) return undefined;
    return subscribeFinancialAuditLog({
      onData: (rows) => setAuditLog(Array.isArray(rows) ? rows : []),
      onError: (error) => {
        handleFinanceReadError(error, "Failed to load financial audit log.", setErr);
      },
    });
  }, [hasFinanceAccess]);

  const refreshEnvironmentStatus = async () => {
    try {
      const result = await getFinanceEnvironmentStatus();
      setEnvironmentStatus(result?.providerStatus || null);
    } catch (error) {
      console.error(error);
    }
  };

  const refreshProviderConfigStatus = async () => {
    try {
      const result = await getPaymentProviderConfigStatus();
      const config = result?.config || null;
      setProviderConfigSnapshot(config);
      if (!providerConfigDirty) setProviderConfigDraft(config);
      setProviderEncryptionReady(result?.encryptionReady === true);
      if (result?.providerStatus) setEnvironmentStatus(result.providerStatus);
    } catch (error) {
      console.error(error);
      handleFinanceReadError(error, "Failed to load payment provider configuration.", setErr);
    }
  };

  useEffect(() => {
    if (!hasFinanceAccess) return;
    void refreshEnvironmentStatus();
  }, [hasFinanceAccess]);

  useEffect(() => {
    if (!hasFinanceAccess) return;
    void refreshProviderConfigStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFinanceAccess]);

  const readyPayoutCount = useMemo(
    () => payoutQueue.filter((row) => row.status === "ready").length,
    [payoutQueue]
  );
  const heldPayoutCount = useMemo(
    () => payoutQueue.filter((row) => row.status === "on_hold").length,
    [payoutQueue]
  );

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateSettingsDraft = (path, value) => {
    setSettingsDirty(true);
    setSettingsDraft((prev) => {
      const next = { ...(prev || defaultFinanceSettings()) };
      const parts = String(path || "").split(".");
      let cursor = next;
      while (parts.length > 1) {
        const part = parts.shift();
        cursor[part] = { ...(cursor?.[part] || {}) };
        cursor = cursor[part];
      }
      cursor[parts[0]] = value;
      return next;
    });
  };

  const updateProviderConfigDraft = (path, value) => {
    setProviderConfigDirty(true);
    setProviderConfigDraft((prev) => {
      const next = { ...(prev || {}) };
      const parts = String(path || "").split(".");
      let cursor = next;
      while (parts.length > 1) {
        const part = parts.shift();
        cursor[part] = { ...(cursor?.[part] || {}) };
        cursor = cursor[part];
      }
      cursor[parts[0]] = value;
      return next;
    });
  };

  const saveGlobalSettings = async () => {
    if (!canEditFinance) {
      setErr("Only authorized finance managers can update finance settings.");
      return;
    }
    setSettingsBusy(true);
    setErr("");
    setMsg("");
    try {
      const result = await saveFinanceSettings(settingsDraft);
      const normalized = result?.settings || settingsDraft;
      setSettingsSnapshot(normalized);
      setSettingsDraft(normalized);
      setSettingsDirty(false);
      setEnvironmentStatus(result?.providerStatus || environmentStatus);
      setMsg("Finance settings saved.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save finance settings.");
    } finally {
      setSettingsBusy(false);
    }
  };

  const releasePayout = async (row) => {
    if (!canEditFinance) {
      setErr("Only authorized finance managers can release payouts.");
      return;
    }
    const queueId = safeString(row?.queueId || row?.id);
    if (!queueId) return;
    const releaseDraft = releaseDraftByQueueId?.[queueId] || {};
    setReleaseBusyId(queueId);
    setErr("");
    setMsg("");
    try {
      await releaseQueuedPartnerPayout({
        queueId,
        settlementReference: safeString(releaseDraft?.settlementReference, 160),
        releaseNotes: safeString(releaseDraft?.releaseNotes, 2000),
      });
      setMsg("Payout released.");
      setReleaseDraftByQueueId((prev) => ({ ...prev, [queueId]: {} }));
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to release payout.");
    } finally {
      setReleaseBusyId("");
    }
  };

  const saveProviderConfig = async () => {
    if (!canEditFinance) {
      setErr("Only authorized finance managers can update provider config.");
      return;
    }
    setProviderConfigBusy(true);
    setErr("");
    setMsg("");
    try {
      const result = await savePaymentProviderConfig(providerConfigDraft || {});
      const nextConfig = result?.config || providerConfigDraft;
      setProviderConfigSnapshot(nextConfig);
      setProviderConfigDraft(nextConfig);
      setProviderConfigDirty(false);
      setProviderEncryptionReady(result?.encryptionReady === true);
      if (result?.providerStatus) setEnvironmentStatus(result.providerStatus);
      setMsg(result?.changed ? "Payment provider config saved." : "No provider config changes.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save payment provider config.");
    } finally {
      setProviderConfigBusy(false);
    }
  };

  if (checkingRole) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className={card}>Checking access...</div>
        </div>
      </div>
    );
  }

  if (!hasFinanceAccess) {
    return (
      <div className={pageBg}>
        <div className="app-page-shell app-page-shell--wide">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            You do not have access to the Finances module.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={pageBg}>
      <div className="app-page-shell app-page-shell--wide">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Coins} size={ICON_SM} />
              Finances
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Finance Control Center
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Manage payment rules, payouts, and finance records.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin/sacc")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {msg ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
            {msg}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <TinyStat
            label="Provider"
            value={`${paymentProviderLabel(
              environmentStatus?.provider ||
                settingsSnapshot?.paymentProvider?.activeProvider ||
                settingsSnapshot?.provider?.active ||
                settingsSnapshot?.provider?.name ||
                "mpesa"
            )} • ${safeString(
              environmentStatus?.environment ||
                settingsSnapshot?.paymentProvider?.providerEnvironment ||
                settingsSnapshot?.provider?.environment ||
                "test"
            )}`}
            tone={environmentStatus?.ready ? "good" : "warn"}
          />
          <TinyStat
            label="Provider Ready"
            value={environmentStatus?.ready ? "Ready for M-Pesa STK push" : "Missing config"}
            tone={environmentStatus?.ready ? "good" : "warn"}
          />
          <TinyStat label="Partners" value={`${partners.length} onboarded`} />
          <TinyStat label="Payout Queue" value={`${readyPayoutCount} ready • ${heldPayoutCount} held`} />
        </div>

        <div className="mt-4 grid gap-4">
          <SectionCard
            icon={ShieldCheck}
            title="Global Finance Settings"
            subtitle="Provider, refund, and payout rules that apply platform-wide."
            open={openSections.environment}
            onToggle={() => toggleSection("environment")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                {environmentStatus?.ready ? "Ready" : "Needs config"}
              </span>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Payment Provider</span>
                  <select
                    value={
                      settingsDraft?.paymentProvider?.activeProvider ||
                      settingsDraft?.provider?.active ||
                      settingsDraft?.provider?.name ||
                      "mpesa"
                    }
                    onChange={(event) => {
                      updateSettingsDraft("paymentProvider.activeProvider", event.target.value);
                      updateSettingsDraft("provider.active", event.target.value);
                      updateSettingsDraft("provider.name", event.target.value);
                    }}
                    className={inputClass}
                  >
                    {PAYMENT_PROVIDERS.map((providerKey) => (
                      <option key={providerKey} value={providerKey}>
                        {paymentProviderLabel(providerKey)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Provider Environment</span>
                  <select
                    value={
                      settingsDraft?.paymentProvider?.providerEnvironment ||
                      settingsDraft?.provider?.environment ||
                      "test"
                    }
                    onChange={(event) => {
                      updateSettingsDraft("paymentProvider.providerEnvironment", event.target.value);
                      updateSettingsDraft("provider.environment", event.target.value);
                    }}
                    className={inputClass}
                  >
                    <option value="test">Test</option>
                    <option value="live">Live</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Provider Callback URL</span>
                  <input
                    value={
                      settingsDraft?.paymentProvider?.providerCallbackUrl ||
                      settingsDraft?.provider?.callbackBaseUrl ||
                      ""
                    }
                    onChange={(event) => {
                      updateSettingsDraft("paymentProvider.providerCallbackUrl", event.target.value);
                      updateSettingsDraft("provider.callbackBaseUrl", event.target.value);
                    }}
                    placeholder="https://app.majuu.example"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Share Link Base URL</span>
                  <input
                    value={
                      settingsDraft?.paymentProvider?.paymentLinkBaseUrl ||
                      settingsDraft?.provider?.paymentLinkBaseUrl ||
                      ""
                    }
                    onChange={(event) => {
                      updateSettingsDraft("paymentProvider.paymentLinkBaseUrl", event.target.value);
                      updateSettingsDraft("provider.paymentLinkBaseUrl", event.target.value);
                    }}
                    placeholder="https://pay.majuu.app"
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Default Currency</span>
                  <input
                    value={
                      settingsDraft?.defaultCurrency ||
                      settingsDraft?.inProgressPricing?.defaultCurrency ||
                      "KES"
                    }
                    onChange={(event) => {
                      updateSettingsDraft("defaultCurrency", event.target.value);
                      updateSettingsDraft("inProgressPricing.defaultCurrency", event.target.value);
                    }}
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Global Discount %</span>
                  <input
                    value={settingsDraft?.pricingControls?.globalDiscountPercentage ?? 0}
                    onChange={(event) =>
                      updateSettingsDraft(
                        "pricingControls.globalDiscountPercentage",
                        Number(event.target.value || 0)
                      )
                    }
                    inputMode="numeric"
                    min={0}
                    max={100}
                    disabled={settingsDraft?.pricingControls?.globalDiscountEnabled !== true}
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Unlock Auto-refund Hours</span>
                  <input
                    value={settingsDraft?.refundControls?.unlockAutoRefundHours ?? 48}
                    onChange={(event) =>
                      updateSettingsDraft("refundControls.unlockAutoRefundHours", event.target.value)
                    }
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Shared-link Expiry Hours</span>
                  <input
                    value={settingsDraft?.refundControls?.sharedLinkExpiryHours ?? 72}
                    onChange={(event) =>
                      updateSettingsDraft("refundControls.sharedLinkExpiryHours", event.target.value)
                    }
                    inputMode="numeric"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <ToggleRow
                  checked={settingsDraft?.refundControls?.autoRefundEnabled !== false}
                  onChange={(checked) =>
                    updateSettingsDraft("refundControls.autoRefundEnabled", checked)
                  }
                  label="Enable Auto-refund Sweep"
                  hint="Runs backend-safe unlock refund processing when no work starts."
                />
                <ToggleRow
                  checked={settingsDraft?.pricingControls?.globalDiscountEnabled === true}
                  onChange={(checked) =>
                    updateSettingsDraft("pricingControls.globalDiscountEnabled", checked)
                  }
                  label="Enable Global Discount"
                  hint="When on, global discount overrides per-request discount values."
                />
                <div className="grid gap-3">
                  <ToggleRow
                    checked={settingsDraft?.payoutControls?.manualReleaseOnly !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("payoutControls.manualReleaseOnly", checked)
                    }
                    label="Manual Payout Release Only"
                    hint="Payouts remain held until explicit release from finance control."
                  />
                  <ToggleRow
                    checked={settingsDraft?.payoutControls?.requireDestination !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("payoutControls.requireDestination", checked)
                    }
                    label="Require Payout Destination Metadata"
                    hint="Prevents payout release when partner destination metadata is incomplete."
                  />
                  <ToggleRow
                    checked={settingsDraft?.inProgressPricing?.platformCutEnabledGlobal !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("inProgressPricing.platformCutEnabledGlobal", checked)
                    }
                    label="Global Platform Cut Toggle"
                    hint="Default cut toggle for all in-progress payment approvals."
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Last saved by {safeString(settingsSnapshot?.updatedByEmail || "system")} on{" "}
                  {toDateTimeLabel(settingsSnapshot?.updatedAtMs)}
                </div>
                <button
                  type="button"
                  onClick={() => void saveGlobalSettings()}
                  disabled={settingsBusy || !settingsDirty || !canEditFinance}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {settingsBusy ? "Saving..." : "Save finance settings"}
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={Link2}
            title="Payment Providers"
            subtitle="Configure Daraja and Paystack credentials per environment."
            open={openSections.providers}
            onToggle={() => toggleSection("providers")}
            meta={
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  providerEncryptionReady
                    ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
                    : "border-amber-200 bg-amber-50/80 text-amber-900"
                }`}
              >
                {providerEncryptionReady ? "Encryption ready" : "Encryption key missing"}
              </span>
            }
          >
            <div className="grid gap-4">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {providerConfigSnapshot
                  ? "Provider config loaded from backend."
                  : "Provider config has not loaded yet."}
              </div>
              {PAYMENT_PROVIDERS.map((providerKey) => (
                <div
                  key={providerKey}
                  className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                >
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {paymentProviderLabel(providerKey)}
                  </div>
                  <div className="mt-3 grid gap-4">
                    {["test", "live"].map((envKey) => {
                      const row =
                        providerConfigDraft?.providers?.[providerKey]?.[envKey] || {};
                      const maskedSecrets = row?.secretConfigured || {};
                      return (
                        <div
                          key={`${providerKey}_${envKey}`}
                          className="rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
                        >
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                            {envKey} environment
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <ToggleRow
                              checked={row?.active === true}
                              onChange={(checked) =>
                                updateProviderConfigDraft(
                                  `providers.${providerKey}.${envKey}.active`,
                                  checked
                                )
                              }
                              label="Active"
                              hint="Enable this provider in this environment."
                            />
                            <label className="grid gap-1.5">
                              <span className={labelClass}>Callback URL</span>
                              <input
                                value={row?.callbackUrl || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.callbackUrl`,
                                    event.target.value
                                  )
                                }
                                placeholder="https://..."
                                className={inputClass}
                              />
                            </label>
                          </div>

                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="grid gap-1.5">
                              <span className={labelClass}>Shortcode</span>
                              <input
                                value={row?.settings?.shortcode || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.settings.shortcode`,
                                    event.target.value
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <span className={labelClass}>Paybill</span>
                              <input
                                value={row?.settings?.paybill || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.settings.paybill`,
                                    event.target.value
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <span className={labelClass}>
                                Consumer Key {maskedSecrets?.consumerKey ? "(set)" : ""}
                              </span>
                              <input
                                type="password"
                                value={row?.secrets?.consumerKey || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.secrets.consumerKey`,
                                    event.target.value
                                  )
                                }
                                placeholder="Enter new value to update"
                                className={inputClass}
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <span className={labelClass}>
                                Consumer Secret {maskedSecrets?.consumerSecret ? "(set)" : ""}
                              </span>
                              <input
                                type="password"
                                value={row?.secrets?.consumerSecret || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.secrets.consumerSecret`,
                                    event.target.value
                                  )
                                }
                                placeholder="Enter new value to update"
                                className={inputClass}
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <span className={labelClass}>
                                Passkey {maskedSecrets?.passkey ? "(set)" : ""}
                              </span>
                              <input
                                type="password"
                                value={row?.secrets?.passkey || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.secrets.passkey`,
                                    event.target.value
                                  )
                                }
                                placeholder="Enter new value to update"
                                className={inputClass}
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <span className={labelClass}>Initiator Name</span>
                              <input
                                value={row?.settings?.initiatorName || ""}
                                onChange={(event) =>
                                  updateProviderConfigDraft(
                                    `providers.${providerKey}.${envKey}.settings.initiatorName`,
                                    event.target.value
                                  )
                                }
                                className={inputClass}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Provider config updates are encrypted before storage.
                </div>
                <button
                  type="button"
                  onClick={() => void saveProviderConfig()}
                  disabled={providerConfigBusy || !providerConfigDirty || !canEditFinance}
                  className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {providerConfigBusy ? "Saving..." : "Save provider config"}
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={Link2}
            title="Branch financial controls"
            subtitle="Legacy partner financial profiles are deprecated."
            open={openSections.branchFinance}
            onToggle={() => toggleSection("branchFinance")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                Managed in Partnerships
              </span>
            }
          >
            <div className="grid gap-3">
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                Partner Financial Profile is deprecated. Configure payout routing and platform cut at
                branch level under Partnerships.
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">
                Branch-level finance controls include:
                <ul className="mt-2 list-disc pl-5">
                  <li>Financial status (active or inactive)</li>
                  <li>Platform cut type, value, and base</li>
                  <li>Release behavior override (manual or auto)</li>
                  <li>Payout destination metadata and readiness</li>
                </ul>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => navigate("/app/admin/sacc/partnerships")}
                    className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                  >
                    Open Branch Management
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
          <SectionCard
            icon={Package}
            title="Payout queue"
            subtitle="Pending partner payouts."
            open={openSections.payoutQueue}
            onToggle={() => toggleSection("payoutQueue")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                {payoutQueue.length} items
              </span>
            }
          >
            <div className="grid gap-3">
              {payoutQueue.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                  No payout queue items yet.
                </div>
              ) : (
                payoutQueue.map((row) => {
                  const queueId = safeString(row?.queueId || row?.id);
                  const releaseDraft = releaseDraftByQueueId?.[queueId] || {};
                  const releaseBusy = releaseBusyId === queueId;
                  return (
                    <div
                      key={queueId}
                      className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {row.partnerName || row.partnerId || "Partner payout"}
                          </div>
                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                            {formatMoney(row.amount, row.currency)}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Request {row.requestId || "-"} • Payment {row.paymentId || "-"}
                          </div>
                          {row.holdReason ? (
                            <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                              Hold reason: {row.holdReason}
                            </div>
                          ) : null}
                        </div>
                        <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                          {row.status || "pending"}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <div>Created: {toDateTimeLabel(row.createdAtMs)}</div>
                        <div>Updated: {toDateTimeLabel(row.updatedAtMs)}</div>
                        <div>Destination ready: {row.payoutDestinationReady ? "Yes" : "No"}</div>
                      </div>
                      {row.status === "ready" ? (
                        <div className="mt-3 grid gap-2">
                          <input
                            value={releaseDraft?.settlementReference || ""}
                            onChange={(event) =>
                              setReleaseDraftByQueueId((prev) => ({
                                ...prev,
                                [queueId]: {
                                  ...(prev?.[queueId] || {}),
                                  settlementReference: event.target.value,
                                },
                              }))
                            }
                            placeholder="Settlement reference"
                            className={inputClass}
                            disabled={releaseBusy}
                          />
                          <textarea
                            value={releaseDraft?.releaseNotes || ""}
                            onChange={(event) =>
                              setReleaseDraftByQueueId((prev) => ({
                                ...prev,
                                [queueId]: {
                                  ...(prev?.[queueId] || {}),
                                  releaseNotes: event.target.value,
                                },
                              }))
                            }
                            rows={3}
                            placeholder="Release notes"
                            className={inputClass}
                            disabled={releaseBusy}
                          />
                          <button
                            type="button"
                            onClick={() => void releasePayout(row)}
                            disabled={releaseBusy || !canEditFinance}
                            className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                          >
                            {releaseBusy ? "Releasing..." : "Release payout"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </SectionCard>

          <SectionCard
            icon={FileText}
            title="Settlement history"
            subtitle="Released payouts."
            open={openSections.settlementHistory}
            onToggle={() => toggleSection("settlementHistory")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                {settlementHistory.length} records
              </span>
            }
          >
            <div className="grid gap-3">
              {settlementHistory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                  No settlements yet.
                </div>
              ) : (
                settlementHistory.map((row) => (
                  <div
                    key={row.settlementId}
                    className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                  >
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {row.partnerName || row.partnerId || "Partner"}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      {formatMoney(row.amount, row.currency)}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Settlement ref: {row.settlementReference || "Not provided"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Released: {toDateTimeLabel(row.releasedAtMs || row.createdAtMs)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            icon={FileText}
            title="Financial audit log"
            subtitle="Finance activity history."
            open={openSections.auditLog}
            onToggle={() => toggleSection("auditLog")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                {auditLog.length} events
              </span>
            }
          >
            <div className="grid gap-3">
              {auditLog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                  No finance audit entries yet.
                </div>
              ) : (
                auditLog.map((row) => (
                  <div
                    key={row.auditId}
                    className="rounded-2xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
                  >
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {row.action || "finance_event"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {row.actorRole || "system"} • {row.actorUid || "system"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {toDateTimeLabel(row.createdAtMs)}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Request {row.requestId || "-"} • Payment {row.paymentId || "-"} • Refund{" "}
                      {row.refundId || "-"}
                    </div>
                    {row.reason ? (
                      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                        {row.reason}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}





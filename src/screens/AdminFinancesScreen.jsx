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
  defaultPartnerFinancialProfile,
  getFinanceEnvironmentStatus,
  PAYOUT_RELEASE_BEHAVIORS,
  PLATFORM_CUT_BASE_OPTIONS,
  PLATFORM_CUT_TYPES,
  releaseQueuedPartnerPayout,
  saveFinanceSettings,
  savePartnerFinancialProfile,
  subscribeFinanceSettings,
  subscribeFinancialAuditLog,
  subscribePartnerFinancialProfiles,
  subscribePayoutQueue,
  subscribeSettlementHistory,
  TAX_MODES,
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

function createOpenSections() {
  return {
    environment: false,
    partnerProfiles: false,
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
  const [partnerProfiles, setPartnerProfiles] = useState([]);
  const [payoutQueue, setPayoutQueue] = useState([]);
  const [settlementHistory, setSettlementHistory] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [environmentStatus, setEnvironmentStatus] = useState(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState(defaultFinanceSettings());
  const [settingsDraft, setSettingsDraft] = useState(defaultFinanceSettings());
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [partnerDraft, setPartnerDraft] = useState(defaultPartnerFinancialProfile());
  const [partnerDirty, setPartnerDirty] = useState(false);
  const [partnerBusy, setPartnerBusy] = useState(false);
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
    return subscribePartnerFinancialProfiles({
      onData: (rows) => setPartnerProfiles(Array.isArray(rows) ? rows : []),
      onError: (error) => {
        handleFinanceReadError(error, "Failed to load partner financial profiles.", setErr);
      },
    });
  }, [hasFinanceAccess]);

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

  useEffect(() => {
    if (!hasFinanceAccess) return;
    void refreshEnvironmentStatus();
  }, [hasFinanceAccess]);

  useEffect(() => {
    if (!partners.length) {
      setSelectedPartnerId("");
      return;
    }
    if (partners.some((row) => safeString(row?.id) === selectedPartnerId)) return;
    setSelectedPartnerId(safeString(partners[0]?.id));
  }, [partners, selectedPartnerId]);

  const selectedPartner = useMemo(
    () => partners.find((row) => safeString(row?.id) === selectedPartnerId) || null,
    [partners, selectedPartnerId]
  );

  useEffect(() => {
    if (!selectedPartner) {
      setPartnerDraft(defaultPartnerFinancialProfile());
      setPartnerDirty(false);
      return;
    }
    const existingProfile =
      partnerProfiles.find((row) => safeString(row?.partnerId) === safeString(selectedPartner?.id)) ||
      null;
    const baseDraft = defaultPartnerFinancialProfile(selectedPartner);
    const nextDraft = existingProfile
      ? {
          ...baseDraft,
          ...existingProfile,
          payoutDestination: {
            ...(baseDraft.payoutDestination || {}),
            ...(existingProfile?.payoutDestination || {}),
          },
        }
      : baseDraft;
    setPartnerDraft(nextDraft);
    setPartnerDirty(false);
  }, [selectedPartner, partnerProfiles]);

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

  const updatePartnerDraft = (path, value) => {
    setPartnerDirty(true);
    setPartnerDraft((prev) => {
      const next = { ...(prev || defaultPartnerFinancialProfile(selectedPartner)) };
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

  const saveSelectedPartnerProfile = async () => {
    const partnerId = safeString(selectedPartner?.id);
    if (!partnerId) {
      setErr("Select a partner first.");
      return;
    }
    setPartnerBusy(true);
    setErr("");
    setMsg("");
    try {
      await savePartnerFinancialProfile({
        partnerId,
        profile: {
          ...partnerDraft,
          taxOverrides:
            partnerDraft?.taxOverrides?.enabled === true ? partnerDraft.taxOverrides : null,
        },
      });
      setPartnerDirty(false);
      setMsg("Partner financial profile saved.");
    } catch (error) {
      console.error(error);
      setErr("Failed to save. Please try again.");
    } finally {
      setPartnerBusy(false);
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
            value={`${safeString(environmentStatus?.provider || "paystack")} • ${safeString(
              environmentStatus?.environment || settingsSnapshot?.provider?.environment || "test"
            )}`}
            tone={environmentStatus?.ready ? "good" : "warn"}
          />
          <TinyStat
            label="Provider Ready"
            value={environmentStatus?.ready ? "Ready for hosted checkout" : "Missing config"}
            tone={environmentStatus?.ready ? "good" : "warn"}
          />
          <TinyStat label="Partners" value={`${partners.length} onboarded`} />
          <TinyStat label="Payout Queue" value={`${readyPayoutCount} ready • ${heldPayoutCount} held`} />
        </div>

        <div className="mt-4 grid gap-4">
          <SectionCard
            icon={ShieldCheck}
            title="Environment, pricing, and platform rules"
            subtitle="Payment and payout rules."
            open={openSections.environment}
            onToggle={() => toggleSection("environment")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                {environmentStatus?.ready ? "Ready" : "Needs config"}
              </span>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Paystack environment</span>
                  <select
                    value={settingsDraft?.provider?.environment || "test"}
                    onChange={(event) =>
                      updateSettingsDraft("provider.environment", event.target.value)
                    }
                    className={inputClass}
                  >
                    <option value="test">Test</option>
                    <option value="live">Live</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Callback base URL</span>
                  <input
                    value={settingsDraft?.provider?.callbackBaseUrl || ""}
                    onChange={(event) =>
                      updateSettingsDraft("provider.callbackBaseUrl", event.target.value)
                    }
                    placeholder="https://app.majuu.example"
                    className={inputClass}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Default in-progress currency</span>
                  <input
                    value={settingsDraft?.inProgressPricing?.defaultCurrency || "KES"}
                    onChange={(event) =>
                      updateSettingsDraft("inProgressPricing.defaultCurrency", event.target.value)
                    }
                    className={inputClass}
                  />
                </label>
                <div className="grid gap-3">
                  <ToggleRow
                    checked={settingsDraft?.inProgressPricing?.allowServiceFeeInput !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("inProgressPricing.allowServiceFeeInput", checked)
                    }
                    label="Allow service-fee input during staff prompt"
                    hint="Staff can add an optional service fee, but MAJUU platform cut remains system-calculated."
                  />
                  <ToggleRow
                    checked={settingsDraft?.inProgressPricing?.allowAdminAdjustAmounts !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("inProgressPricing.allowAdminAdjustAmounts", checked)
                    }
                    label="Allow admin adjustment before approval"
                    hint="Assigned admin can edit the official amount and service fee before freezing the approval snapshot."
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Default platform cut type</span>
                  <select
                    value={settingsDraft?.platformFee?.defaultCutType || "percentage"}
                    onChange={(event) =>
                      updateSettingsDraft("platformFee.defaultCutType", event.target.value)
                    }
                    className={inputClass}
                  >
                    {PLATFORM_CUT_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {option === "flat" ? "Flat" : "Percentage"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Default platform cut value</span>
                  <input
                    value={settingsDraft?.platformFee?.defaultCutValue ?? 10}
                    onChange={(event) =>
                      updateSettingsDraft("platformFee.defaultCutValue", event.target.value)
                    }
                    inputMode="decimal"
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className={labelClass}>Platform cut base</span>
                  <select
                    value={settingsDraft?.platformFee?.cutBase || "official_plus_service_fee"}
                    onChange={(event) =>
                      updateSettingsDraft("platformFee.cutBase", event.target.value)
                    }
                    className={inputClass}
                  >
                    {PLATFORM_CUT_BASE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === "official_amount"
                          ? "Official amount only"
                          : "Official amount + service fee"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                <ToggleRow
                  checked={settingsDraft?.tax?.enabled === true}
                  onChange={(checked) => updateSettingsDraft("tax.enabled", checked)}
                  label="Enable tax architecture"
                  hint="Keeps tax configurable without hardcoding legal truth."
                />
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="grid gap-1.5">
                    <span className={labelClass}>Tax label</span>
                    <input
                      value={settingsDraft?.tax?.label || "Tax"}
                      onChange={(event) => updateSettingsDraft("tax.label", event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className={labelClass}>Tax type</span>
                    <select
                      value={settingsDraft?.tax?.type || "percentage"}
                      onChange={(event) => updateSettingsDraft("tax.type", event.target.value)}
                      className={inputClass}
                    >
                      {PLATFORM_CUT_TYPES.map((option) => (
                        <option key={option} value={option}>
                          {option === "flat" ? "Flat" : "Percentage"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className={labelClass}>Tax rate/value</span>
                    <input
                      value={settingsDraft?.tax?.rate ?? 0}
                      onChange={(event) => updateSettingsDraft("tax.rate", event.target.value)}
                      inputMode="decimal"
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <span className={labelClass}>Tax mode</span>
                    <select
                      value={settingsDraft?.tax?.mode || "exclusive"}
                      onChange={(event) => updateSettingsDraft("tax.mode", event.target.value)}
                      className={inputClass}
                    >
                      {TAX_MODES.map((option) => (
                        <option key={option} value={option}>
                          {option === "inclusive" ? "Inclusive" : "Exclusive"}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Unlock auto-refund hours</span>
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
                  <span className={labelClass}>Shared-link expiry hours</span>
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
                  label="Enable unlock auto-refund sweep"
                  hint="Prevents frontend-controlled unlock refunds and keeps retry-safe server execution."
                />
                <div className="grid gap-3">
                  <ToggleRow
                    checked={settingsDraft?.payoutControls?.manualReleaseOnly !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("payoutControls.manualReleaseOnly", checked)
                    }
                    label="Manual payout release only"
                    hint="Collected in-progress money stays held until Super Admin explicitly releases payout."
                  />
                  <ToggleRow
                    checked={settingsDraft?.payoutControls?.requireDestination !== false}
                    onChange={(checked) =>
                      updateSettingsDraft("payoutControls.requireDestination", checked)
                    }
                    label="Require payout destination metadata"
                    hint="Prevents payout release when partner payout destination is missing."
                  />
                  <ToggleRow
                    checked={settingsDraft?.payoutControls?.deductProcessorFeeFromPartner === true}
                    onChange={(checked) =>
                      updateSettingsDraft(
                        "payoutControls.deductProcessorFeeFromPartner",
                        checked
                      )
                    }
                    label="Deduct processor fee from partner payout"
                    hint="Leaves room for later split-payout and settlement policy changes."
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
            title="Partner financial profiles"
            subtitle="Partner payout settings."
            open={openSections.partnerProfiles}
            onToggle={() => toggleSection("partnerProfiles")}
            meta={
              <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                {partnerProfiles.length} configured
              </span>
            }
          >
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className={labelClass}>Partner</span>
                  <select
                    value={selectedPartnerId}
                    onChange={(event) => setSelectedPartnerId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select partner</option>
                    {partners.map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <TinyStat
                    label="Partner status"
                    value={safeString(selectedPartner?.status || "not selected")}
                    tone={selectedPartner?.isActive ? "good" : "warn"}
                  />
                  <TinyStat
                    label="Coverage"
                    value={
                      selectedPartner
                        ? `${Number(selectedPartner?.supportedCounties?.length || 0)} counties`
                        : "Select a partner"
                    }
                  />
                </div>
              </div>

              {selectedPartner ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="grid gap-1.5">
                      <span className={labelClass}>Financial status</span>
                      <select
                        value={partnerDraft?.activeFinancialStatus || "active"}
                        onChange={(event) =>
                          updatePartnerDraft("activeFinancialStatus", event.target.value)
                        }
                        className={inputClass}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className={labelClass}>Platform cut type</span>
                      <select
                        value={partnerDraft?.defaultPlatformCutType || "percentage"}
                        onChange={(event) =>
                          updatePartnerDraft("defaultPlatformCutType", event.target.value)
                        }
                        className={inputClass}
                      >
                        {PLATFORM_CUT_TYPES.map((option) => (
                          <option key={option} value={option}>
                            {option === "flat" ? "Flat" : "Percentage"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className={labelClass}>Platform cut value</span>
                      <input
                        value={partnerDraft?.defaultPlatformCutValue ?? 10}
                        onChange={(event) =>
                          updatePartnerDraft("defaultPlatformCutValue", event.target.value)
                        }
                        inputMode="decimal"
                        className={inputClass}
                      />
                    </label>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className={labelClass}>Platform cut base</span>
                      <select
                        value={partnerDraft?.platformCutBase || "official_plus_service_fee"}
                        onChange={(event) =>
                          updatePartnerDraft("platformCutBase", event.target.value)
                        }
                        className={inputClass}
                      >
                        {PLATFORM_CUT_BASE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option === "official_amount"
                              ? "Official amount only"
                              : "Official amount + service fee"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className={labelClass}>Payout release behavior</span>
                      <select
                        value={partnerDraft?.payoutReleaseBehavior || "manual_review"}
                        onChange={(event) =>
                          updatePartnerDraft("payoutReleaseBehavior", event.target.value)
                        }
                        className={inputClass}
                      >
                        {PAYOUT_RELEASE_BEHAVIORS.map((option) => (
                          <option key={option} value={option}>
                            {option === "auto_release" ? "Auto release" : "Manual review"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <ToggleRow
                      checked={partnerDraft?.taxOverrides?.enabled === true}
                      onChange={(checked) =>
                        updatePartnerDraft(
                          "taxOverrides",
                          checked
                            ? {
                                enabled: true,
                                label: safeString(
                                  partnerDraft?.taxOverrides?.label || settingsSnapshot?.tax?.label || "Tax"
                                ),
                                type: safeString(
                                  partnerDraft?.taxOverrides?.type || settingsSnapshot?.tax?.type || "percentage"
                                ),
                                rate:
                                  partnerDraft?.taxOverrides?.rate ??
                                  settingsSnapshot?.tax?.rate ??
                                  0,
                                mode: safeString(
                                  partnerDraft?.taxOverrides?.mode || settingsSnapshot?.tax?.mode || "exclusive"
                                ),
                              }
                            : null
                        )
                      }
                      label="Enable partner tax override"
                      hint="Freezes partner-specific tax behavior without touching old approved snapshots."
                    />
                    {partnerDraft?.taxOverrides ? (
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="grid gap-1.5">
                          <span className={labelClass}>Override label</span>
                          <input
                            value={partnerDraft?.taxOverrides?.label || ""}
                            onChange={(event) =>
                              updatePartnerDraft("taxOverrides", {
                                ...(partnerDraft?.taxOverrides || {}),
                                label: event.target.value,
                              })
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <span className={labelClass}>Type</span>
                          <select
                            value={partnerDraft?.taxOverrides?.type || "percentage"}
                            onChange={(event) =>
                              updatePartnerDraft("taxOverrides", {
                                ...(partnerDraft?.taxOverrides || {}),
                                type: event.target.value,
                              })
                            }
                            className={inputClass}
                          >
                            {PLATFORM_CUT_TYPES.map((option) => (
                              <option key={option} value={option}>
                                {option === "flat" ? "Flat" : "Percentage"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1.5">
                          <span className={labelClass}>Rate/value</span>
                          <input
                            value={partnerDraft?.taxOverrides?.rate ?? 0}
                            onChange={(event) =>
                              updatePartnerDraft("taxOverrides", {
                                ...(partnerDraft?.taxOverrides || {}),
                                rate: event.target.value,
                              })
                            }
                            inputMode="decimal"
                            className={inputClass}
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <span className={labelClass}>Mode</span>
                          <select
                            value={partnerDraft?.taxOverrides?.mode || "exclusive"}
                            onChange={(event) =>
                              updatePartnerDraft("taxOverrides", {
                                ...(partnerDraft?.taxOverrides || {}),
                                mode: event.target.value,
                              })
                            }
                            className={inputClass}
                          >
                            {TAX_MODES.map((option) => (
                              <option key={option} value={option}>
                                {option === "inclusive" ? "Inclusive" : "Exclusive"}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <ToggleRow
                      checked={partnerDraft?.payoutDestinationReady === true}
                      onChange={(checked) => updatePartnerDraft("payoutDestinationReady", checked)}
                      label="Payout destination ready"
                      hint="Queue release stays blocked until this destination metadata is ready."
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1.5">
                        <span className={labelClass}>Bank name</span>
                        <input
                          value={partnerDraft?.payoutDestination?.bankName || ""}
                          onChange={(event) =>
                            updatePartnerDraft("payoutDestination.bankName", event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className={labelClass}>Account name</span>
                        <input
                          value={partnerDraft?.payoutDestination?.accountName || ""}
                          onChange={(event) =>
                            updatePartnerDraft("payoutDestination.accountName", event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className={labelClass}>Account number last 4</span>
                        <input
                          value={partnerDraft?.payoutDestination?.accountNumberLast4 || ""}
                          onChange={(event) =>
                            updatePartnerDraft("payoutDestination.accountNumberLast4", event.target.value)
                          }
                          className={inputClass}
                          inputMode="numeric"
                        />
                      </label>
                      <label className="grid gap-1.5">
                        <span className={labelClass}>Destination reference</span>
                        <input
                          value={partnerDraft?.payoutDestination?.reference || ""}
                          onChange={(event) =>
                            updatePartnerDraft("payoutDestination.reference", event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                    </div>
                  </div>

                  <label className="grid gap-1.5">
                    <span className={labelClass}>Internal notes</span>
                    <textarea
                      value={partnerDraft?.notes || ""}
                      onChange={(event) => updatePartnerDraft("notes", event.target.value)}
                      rows={4}
                      className={inputClass}
                      placeholder="Partner-specific finance notes, payout instructions, or internal restrictions."
                    />
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      Effective at {toDateTimeLabel(partnerDraft?.effectiveAtMs)}. Last updated by{" "}
                      {safeString(partnerDraft?.updatedByEmail || "system")} on{" "}
                      {toDateTimeLabel(partnerDraft?.updatedAtMs)}
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveSelectedPartnerProfile()}
                      disabled={partnerBusy || !partnerDirty}
                      className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                    >
                      {partnerBusy ? "Saving..." : "Save partner finance profile"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                  Select a partner to manage finance rules.
                </div>
              )}
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

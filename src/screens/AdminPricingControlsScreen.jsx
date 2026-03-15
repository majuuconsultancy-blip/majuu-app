import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Coins, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META } from "../constants/migrationOptions";
import { useRequestPricingList } from "../hooks/useRequestPricing";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  formatPricingMoney,
  normalizePricingAmountValue,
  updateRequestPricing,
} from "../services/pricingservice";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export default function AdminPricingControlsScreen() {
  const navigate = useNavigate();
  const { rows, loading, error: pricingError } = useRequestPricingList({
    requestType: "single",
  });

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [activeRowKey, setActiveRowKey] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setIsSuperAdmin(Boolean(roleCtx?.isSuperAdmin));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setIsSuperAdmin(false);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDrafts((current) => {
      const next = {};
      rows.forEach((row) => {
        const currentValue = current[row.pricingKey];
        next[row.pricingKey] =
          row.pricingKey === activeRowKey && currentValue != null
            ? currentValue
            : String(row.amount || "");
      });
      return next;
    });
  }, [rows, activeRowKey]);

  const trackCounts = useMemo(() => {
    return rows.reduce((acc, row) => {
      const track = safeString(row.track, 20) || "other";
      acc[track] = Number(acc[track] || 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:focus:ring-emerald-500/10";

  const handleDraftChange = (pricingKey, value) => {
    const cleanDigits = String(value || "").replace(/[^\d]/g, "");
    setDrafts((current) => ({
      ...current,
      [pricingKey]: cleanDigits,
    }));
  };

  const handleUpdate = async (row) => {
    if (!row?.pricingKey) return;

    const nextAmount = normalizePricingAmountValue(drafts[row.pricingKey], 0);
    if (nextAmount <= 0) {
      setErr(`Enter a valid price for ${row.serviceName || "this request"}.`);
      setMsg("");
      return;
    }

    setBusyKey(row.pricingKey);
    setErr("");
    setMsg("");

    try {
      const updatedRow = await updateRequestPricing({
        pricingKey: row.pricingKey,
        track: row.track,
        serviceName: row.serviceName,
        requestType: row.requestType,
        amount: nextAmount,
        currency: row.currency,
      });

      setDrafts((current) => ({
        ...current,
        [row.pricingKey]: String(updatedRow.amount || nextAmount),
      }));
      setMsg(
        `${updatedRow.serviceName} updated to ${formatPricingMoney(
          updatedRow.amount,
          updatedRow.currency
        )}.`
      );
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update request pricing.");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className={pageBg}>
      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Coins} size={ICON_SM} />
              Pricing Controls
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC Pricing Controls
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Inline request pricing for live single-request flows.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin/sacc")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage request pricing.
          </div>
        ) : (
          <>
            {err ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            {msg ? (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200">
                {msg}
              </div>
            ) : null}

            {pricingError ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                {pricingError}
              </div>
            ) : null}

            <div className={`mt-5 ${card} p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Live Request Types
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Edit the amount inline and save. Updated values become the pricing source of truth for request checkout flows.
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-3 py-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  {rows.length} request types
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                {Object.entries(trackCounts).map(([track, count]) => (
                  <span
                    key={track}
                    className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/70 px-2.5 py-1"
                  >
                    {(APP_TRACK_META[track]?.label || track)}: {count}
                  </span>
                ))}
              </div>
            </div>

            {loading && !rows.length ? (
              <div className={`mt-4 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading pricing rows...
              </div>
            ) : !rows.length ? (
              <div className={`mt-4 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                No request pricing rows available yet.
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {rows.map((row) => {
                  const draftValue = safeString(drafts[row.pricingKey], 20);
                  const parsedDraft = normalizePricingAmountValue(draftValue, 0);
                  const dirty = parsedDraft > 0 && parsedDraft !== Number(row.amount || 0);
                  const rowBusy = busyKey === row.pricingKey;
                  const trackLabel = APP_TRACK_META[row.track]?.label || row.track;

                  return (
                    <div key={row.pricingKey} className={`${card} px-4 py-4`}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                              {trackLabel}
                            </span>
                            {row.tag ? (
                              <span className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-600 dark:text-zinc-300">
                                {row.tag}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {row.serviceName}
                          </div>
                          {row.note ? (
                            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                              {row.note}
                            </div>
                          ) : null}
                          <div className="mt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                            Current:{" "}
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {formatPricingMoney(row.amount, row.currency)}
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_auto] sm:items-center lg:min-w-[320px]">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={draftValue}
                            onFocus={() => setActiveRowKey(row.pricingKey)}
                            onBlur={() => setActiveRowKey("")}
                            onChange={(event) =>
                              handleDraftChange(row.pricingKey, event.target.value)
                            }
                            placeholder="Enter KES amount"
                            className={input}
                            disabled={rowBusy}
                          />

                          <button
                            type="button"
                            onClick={() => void handleUpdate(row)}
                            disabled={rowBusy || !dirty}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                          >
                            <AppIcon icon={Save} size={ICON_SM} />
                            {rowBusy ? "Updating..." : "Update"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

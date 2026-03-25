import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Coins,
  Package,
  Save,
  Search,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { EAST_AFRICA_RESIDENCE_COUNTRIES } from "../constants/eastAfricaProfile";
import { useCountryDirectory } from "../hooks/useCountryDirectory";
import {
  APP_TRACK_META,
  APP_TRACK_OPTIONS,
} from "../constants/migrationOptions";
import { buildRequestPricingKey } from "../constants/requestCatalog";
import {
  useFullPackagePricingList,
  useRequestPricingList,
} from "../hooks/useRequestPricing";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  getRequestDefinitionTrackTypes,
  subscribeAllRequestDefinitions,
} from "../services/requestDefinitionService";
import {
  formatPricingMoney,
  normalizePricingAmountValue,
  updateFullPackagePricing,
  updateRequestPricing,
} from "../services/pricingservice";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function getRowTracks(row) {
  if (Array.isArray(row?.tracks) && row.tracks.length) {
    return row.tracks.map((track) => safeString(track, 20).toLowerCase()).filter(Boolean);
  }
  const track = safeString(row?.track, 20).toLowerCase();
  return track ? [track] : [];
}

function formatTrackLabelList(tracks) {
  return getRowTracks({ tracks })
    .map((track) => APP_TRACK_META[track]?.label || track)
    .join(" / ");
}

function matchesSearch(row, search) {
  const needle = safeString(search, 120).toLowerCase();
  if (!needle) return true;

  return [
    row?.serviceName,
    row?.label,
    row?.note,
    row?.tag,
    row?.displayCountry,
    row?.country,
    formatTrackLabelList(getRowTracks(row)),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function SectionFilter({
  label,
  value,
  onChange,
  options,
  disabled = false,
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-2xl border border-zinc-200 bg-white/85 px-3.5 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
      >
        {options.map((option) => (
          <option key={option.value || "blank"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PricingRowsTable({
  rows,
  drafts,
  activeRowKey,
  busyKey,
  onFocusRow,
  onBlurRow,
  onDraftChange,
  onSaveRow,
}) {
  const inputClass =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
        No pricing rows match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white/75 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55">
      {rows.map((row, index) => {
        const draftValue = safeString(drafts[row.pricingKey], 20);
        const parsedDraft = normalizePricingAmountValue(draftValue, 0);
        const dirty =
          parsedDraft > 0 && (Boolean(row.amountMixed) || parsedDraft !== Number(row.amount || 0));
        const rowBusy = busyKey === row.pricingKey;
        const isActive = activeRowKey === row.pricingKey;
        const trackLabel = formatTrackLabelList(getRowTracks(row));

        return (
          <div
            key={row.pricingKey}
            className={[
              "px-4 py-4",
              index > 0
                ? "border-t border-zinc-200/80 dark:border-zinc-800/80"
                : "",
              isActive ? "bg-emerald-50/50 dark:bg-emerald-950/10" : "",
            ].join(" ")}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    {trackLabel}
                  </span>
                  <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                    {row.displayCountry || row.country}
                  </span>
                  {row.tag ? (
                    <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
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

                <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  Current:{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {row.amountMixed
                      ? "Mixed by track"
                      : Number(row.amount || 0) > 0
                      ? formatPricingMoney(row.amount, row.currency)
                      : "Not set"}
                  </span>
                </div>
                {Array.isArray(row.currentAmounts) && row.currentAmounts.length > 1 ? (
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {row.currentAmounts
                      .map((entry) => {
                        const label = APP_TRACK_META[entry.track]?.label || entry.track;
                        return `${label}: ${
                          Number(entry.amount || 0) > 0
                            ? formatPricingMoney(entry.amount, entry.currency)
                            : "Not set"
                        }`;
                      })
                      .join(" | ")}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_auto] lg:min-w-[320px]">
                <input
                  type="text"
                  inputMode="numeric"
                  value={draftValue}
                  onFocus={() => onFocusRow(row.pricingKey)}
                  onBlur={onBlurRow}
                  onChange={(event) => onDraftChange(row.pricingKey, event.target.value)}
                  placeholder="Enter KES amount"
                  className={inputClass}
                  disabled={rowBusy}
                />

                <button
                  type="button"
                  onClick={() => void onSaveRow(row)}
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
  );
}

export default function AdminPricingControlsScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [requestDefinitions, setRequestDefinitions] = useState([]);

  const [search, setSearch] = useState("");
  const [fullOpen, setFullOpen] = useState(true);
  const [fullTrack, setFullTrack] = useState("");
  const [fullCountry, setFullCountry] = useState("");
  const [singleTrack, setSingleTrack] = useState("");
  const [singleCountry, setSingleCountry] = useState("");

  const [drafts, setDrafts] = useState({});
  const [activeRowKey, setActiveRowKey] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const { countries: allCountries } = useCountryDirectory();

  const singlePricing = useRequestPricingList({
    track: singleTrack,
    country: singleCountry,
    requestType: "single",
  });
  const fullPricing = useFullPackagePricingList({
    track: fullTrack,
    country: fullCountry,
  });

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
    if (!isSuperAdmin) return undefined;

    return subscribeAllRequestDefinitions({
      onData: (rows) => {
        setRequestDefinitions(Array.isArray(rows) ? rows : []);
      },
      onError: (error) => {
        console.error(error);
        setRequestDefinitions([]);
      },
    });
  }, [isSuperAdmin]);

  const customDefinitionRows = useMemo(() => {
    const pricingRowsByKey = new Map(
      (Array.isArray(singlePricing.rows) ? singlePricing.rows : [])
        .map((row) => [safeString(row?.pricingKey, 200), row])
        .filter(([pricingKey]) => Boolean(pricingKey))
    );

    const trackFilter = safeString(singleTrack, 20).toLowerCase();
    const countryFilter = safeString(singleCountry, 120);
    const residenceCountries = (Array.isArray(EAST_AFRICA_RESIDENCE_COUNTRIES)
      ? EAST_AFRICA_RESIDENCE_COUNTRIES
      : []
    )
      .map((country) => safeString(country, 120))
      .filter(Boolean);

    const defs = Array.isArray(requestDefinitions) ? requestDefinitions : [];

    return defs
      .flatMap((def) => {
        const title = safeString(def?.title, 140);
        const placement = safeString(def?.entryPlacement, 40).toLowerCase();
        const countries =
          placement === "track_simple"
            ? residenceCountries
            : [safeString(def?.country, 120)].filter(Boolean);
        if (!title || !countries.length) return [];

        return countries.flatMap((country) =>
          getRequestDefinitionTrackTypes(def).map((track) => {
          const pricingKey = buildRequestPricingKey({
            track,
            requestType: "single",
            country,
            serviceName: title,
          });
          if (!pricingKey) return null;

          const pricingRow = pricingRowsByKey.get(pricingKey) || null;
          const activeNote = def?.isActive === false ? "Inactive definition" : "";
          const placementNote =
            placement === "track_simple"
              ? "Track simple request by home country"
              : "Country WeHelp request";
          const summaryNote = safeString(def?.summary, 220);
          const note = [summaryNote, placementNote, activeNote].filter(Boolean).join(" · ");

          return {
            pricingKey,
            scope: "single_request",
            requestType: "single",
            track,
            country,
            displayCountry: country,
            serviceName: title,
            label: title,
            note: note || "SACC request",
            tag: safeString(def?.tag, 40) || (placement === "track_simple" ? "Simple" : "SACC"),
            currency: safeString(pricingRow?.currency || "KES", 8) || "KES",
            amount: Number(pricingRow?.amount || 0),
            defaultAmount: Number(pricingRow?.defaultAmount || 0),
            sortOrder: Number(pricingRow?.sortOrder || def?.sortOrder || 0),
            source: pricingRow?.source || "definition",
          };
          })
        );
      })
      .filter(Boolean)
      .filter((row) => {
        if (trackFilter && row.track !== trackFilter) return false;
        if (countryFilter && row.country !== countryFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const trackGap = safeString(a?.track, 20).localeCompare(safeString(b?.track, 20));
        if (trackGap !== 0) return trackGap;
        const countryGap = safeString(a?.displayCountry, 120).localeCompare(
          safeString(b?.displayCountry, 120)
        );
        if (countryGap !== 0) return countryGap;
        const sortGap = Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0);
        if (sortGap !== 0) return sortGap;
        return safeString(a?.serviceName, 160).localeCompare(safeString(b?.serviceName, 160));
      });
  }, [requestDefinitions, singleCountry, singlePricing.rows, singleTrack]);

  const combinedSingleRows = useMemo(() => {
    const custom = Array.isArray(customDefinitionRows) ? customDefinitionRows : [];
    const grouped = new Map();

    custom.forEach((row) => {
      const groupKey = [
        "single_request_group",
        safeString(row?.serviceName, 160),
        safeString(row?.country, 120),
      ]
        .filter(Boolean)
        .join("::");
      if (!groupKey) return;

      const existing = grouped.get(groupKey);
      const entry = {
        pricingKey: safeString(row?.pricingKey, 200),
        track: safeString(row?.track, 20).toLowerCase(),
        country: safeString(row?.country, 120),
        requestType: safeString(row?.requestType, 20) || "single",
        serviceName: safeString(row?.serviceName, 160),
        label: safeString(row?.label, 160),
        note: safeString(row?.note, 240),
        tag: safeString(row?.tag, 40),
        currency: safeString(row?.currency || "KES", 8) || "KES",
        amount: Number(row?.amount || 0),
        defaultAmount: Number(row?.defaultAmount || 0),
        sortOrder: Number(row?.sortOrder || 0),
        source: safeString(row?.source, 40) || "definition",
      };

      if (!existing) {
        grouped.set(groupKey, {
          pricingKey: groupKey,
          scope: "single_request_group",
          requestType: entry.requestType,
          track: entry.track,
          tracks: entry.track ? [entry.track] : [],
          pricingEntries: entry.pricingKey ? [entry] : [],
          country: entry.country,
          displayCountry: safeString(row?.displayCountry || row?.country, 120),
          serviceName: entry.serviceName,
          label: entry.label,
          note: entry.note,
          tag: entry.tag,
          currency: entry.currency,
          amount: entry.amount,
          amountMixed: false,
          currentAmounts: entry.track
            ? [{ track: entry.track, amount: entry.amount, currency: entry.currency }]
            : [],
          defaultAmount: entry.defaultAmount,
          sortOrder: entry.sortOrder,
          source: entry.source,
        });
        return;
      }

      if (entry.track && !existing.tracks.includes(entry.track)) {
        existing.tracks.push(entry.track);
      }
      if (entry.pricingKey) {
        existing.pricingEntries.push(entry);
      }
      existing.currentAmounts.push({
        track: entry.track,
        amount: entry.amount,
        currency: entry.currency,
      });
      if (Number(existing.amount || 0) !== entry.amount) {
        existing.amountMixed = true;
        existing.amount = 0;
      }
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const countryGap = safeString(a?.displayCountry, 120).localeCompare(
        safeString(b?.displayCountry, 120)
      );
      if (countryGap !== 0) return countryGap;
      const sortGap = Number(a?.sortOrder || 0) - Number(b?.sortOrder || 0);
      if (sortGap !== 0) return sortGap;
      return safeString(a?.serviceName, 160).localeCompare(safeString(b?.serviceName, 160));
    });
  }, [customDefinitionRows]);

  const allRows = useMemo(
    () => [...combinedSingleRows, ...fullPricing.rows],
    [combinedSingleRows, fullPricing.rows]
  );

  useEffect(() => {
    setDrafts((current) => {
      const next = {};
      allRows.forEach((row) => {
        const currentValue = current[row.pricingKey];
        next[row.pricingKey] =
          row.pricingKey === activeRowKey && currentValue != null
            ? currentValue
            : String(row.amount || "");
      });
      return next;
    });
  }, [activeRowKey, allRows]);

  const searchValue = safeString(search, 120);
  const filteredSingleRows = useMemo(
    () => combinedSingleRows.filter((row) => matchesSearch(row, searchValue)),
    [combinedSingleRows, searchValue]
  );
  const filteredFullRows = useMemo(() => {
    if (!fullTrack || !fullCountry) return [];
    return fullPricing.rows.filter((row) => matchesSearch(row, searchValue));
  }, [fullCountry, fullPricing.rows, fullTrack, searchValue]);

  const trackOptions = useMemo(
    () => [
      { value: "", label: "All tracks" },
      ...APP_TRACK_OPTIONS.map((track) => ({
        value: track,
        label: APP_TRACK_META[track]?.label || track,
      })),
    ],
    []
  );
  const fullTrackOptions = useMemo(
    () => [{ value: "", label: "Select track" }, ...trackOptions.slice(1)],
    [trackOptions]
  );
  const countryOptions = useMemo(
    () => {
      const countrySet = new Set();
      (Array.isArray(EAST_AFRICA_RESIDENCE_COUNTRIES) ? EAST_AFRICA_RESIDENCE_COUNTRIES : []).forEach(
        (country) => {
          const name = safeString(country, 120);
          if (name) countrySet.add(name);
        }
      );
      (Array.isArray(allCountries) ? allCountries : []).forEach((country) => {
        const name = safeString(country?.name, 120);
        if (name) countrySet.add(name);
      });
      (Array.isArray(requestDefinitions) ? requestDefinitions : []).forEach((definition) => {
        const name = safeString(definition?.country, 120);
        if (name) countrySet.add(name);
      });

      return [
        { value: "", label: "All countries" },
        ...Array.from(countrySet)
          .sort((left, right) => left.localeCompare(right))
          .map((country) => ({
            value: country,
            label: country,
          })),
      ];
    },
    [allCountries, requestDefinitions]
  );
  const fullCountryOptions = useMemo(
    () => [{ value: "", label: "Select country" }, ...countryOptions.slice(1)],
    [countryOptions]
  );

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";

  const handleDraftChange = (pricingKey, value) => {
    const digitsOnly = String(value || "").replace(/[^\d]/g, "");
    setDrafts((current) => ({
      ...current,
      [pricingKey]: digitsOnly,
    }));
  };

  const handleSave = async (row) => {
    if (!row?.pricingKey) return;

    const nextAmount = normalizePricingAmountValue(drafts[row.pricingKey], 0);
    if (nextAmount <= 0) {
      setErr(`Enter a valid price for ${row.serviceName || "this pricing row"}.`);
      setMsg("");
      return;
    }

    setBusyKey(row.pricingKey);
    setErr("");
    setMsg("");

    try {
      if (row.scope === "single_request_group") {
        const entries = Array.isArray(row.pricingEntries) ? row.pricingEntries : [];
        if (!entries.length) {
          throw new Error("No pricing entries were found for this request.");
        }
        await Promise.all(
          entries.map((entry) =>
            updateRequestPricing({
              pricingKey: entry.pricingKey,
              track: entry.track,
              country: entry.country,
              serviceName: entry.serviceName,
              requestType: entry.requestType,
              label: entry.label,
              note: row.note,
              tag: row.tag,
              amount: nextAmount,
              currency: entry.currency || row.currency,
            })
          )
        );

        setDrafts((current) => ({
          ...current,
          [row.pricingKey]: String(nextAmount),
        }));
        setMsg(
          `${row.serviceName} (${row.country}) updated for ${getRowTracks(row).length} track${
            getRowTracks(row).length === 1 ? "" : "s"
          } to ${formatPricingMoney(nextAmount, row.currency)}.`
        );
        return;
      }

      const updater =
        row.scope === "full_package_item" ? updateFullPackagePricing : updateRequestPricing;
      const updatedRow = await updater({
        pricingKey: row.pricingKey,
        track: row.track,
        country: row.country,
        serviceName: row.serviceName,
        requestType: row.requestType,
        label: row.label,
        note: row.note,
        tag: row.tag,
        amount: nextAmount,
        currency: row.currency,
      });

      setDrafts((current) => ({
        ...current,
        [row.pricingKey]: String(updatedRow.amount || nextAmount),
      }));
      setMsg(
        `${updatedRow.serviceName} (${updatedRow.country}) updated to ${formatPricingMoney(
          updatedRow.amount,
          updatedRow.currency
        )}.`
      );
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update pricing.");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className={pageBg}>
      <div className="app-page-shell app-page-shell--wide">
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
              Manage live request pricing by track and country, with full-package controls on top.
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

        {checkingRole ? (
          <div className={`mt-5 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage pricing controls.
          </div>
        ) : (
          <>
            {err ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            {msg ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200">
                {msg}
              </div>
            ) : null}

            <div className={`mt-5 ${card}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Find pricing rows fast
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Search by request name, track, country, note, or tag.
                  </div>
                </div>

                <label className="relative block w-full max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search pricing rows"
                    className="w-full rounded-2xl border border-zinc-200 bg-white/85 py-3 pl-9 pr-4 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                  />
                </label>
              </div>
            </div>

            <div className={`mt-4 ${card}`}>
              <button
                type="button"
                onClick={() => setFullOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    <AppIcon icon={Package} size={ICON_MD} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Full Package Pricing
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Set per-item package pricing by track and country. The diagnostic total will add these values together and subtract items the user already has.
                    </div>
                  </div>
                </div>

                <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                  {fullTrack && fullCountry ? `${filteredFullRows.length} rows` : "Select filters"}
                  <ChevronDown
                    className={[
                      "h-4 w-4 transition-transform",
                      fullOpen ? "rotate-180" : "rotate-0",
                    ].join(" ")}
                  />
                </span>
              </button>

              {fullOpen ? (
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <SectionFilter
                      label="Track"
                      value={fullTrack}
                      onChange={(value) => {
                        setFullTrack(value);
                        setFullCountry("");
                      }}
                      options={fullTrackOptions}
                    />
                    <SectionFilter
                      label="Country"
                      value={fullCountry}
                      onChange={setFullCountry}
                      options={fullCountryOptions}
                      disabled={!fullTrack}
                    />
                  </div>

                  {fullPricing.error && fullTrack && fullCountry ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                      {fullPricing.error}
                    </div>
                  ) : null}

                  {!fullTrack ? (
                    <div className="rounded-3xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                      Choose a track to reveal full-package pricing rows.
                    </div>
                  ) : !fullCountry ? (
                    <div className="rounded-3xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                      Choose a country to edit the full-package item prices for that route.
                    </div>
                  ) : fullPricing.loading && !filteredFullRows.length ? (
                    <div className="rounded-3xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                      Loading full-package pricing rows...
                    </div>
                  ) : (
                    <PricingRowsTable
                      rows={filteredFullRows}
                      drafts={drafts}
                      activeRowKey={activeRowKey}
                      busyKey={busyKey}
                      onFocusRow={setActiveRowKey}
                      onBlurRow={() => setActiveRowKey("")}
                      onDraftChange={handleDraftChange}
                      onSaveRow={handleSave}
                    />
                  )}
                </div>
              ) : null}
            </div>

            <div className={`mt-4 ${card}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Single Request Pricing
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Edit current request prices by track and country. These values feed the single-request checkout flow directly.
                  </div>
                </div>

                <div className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                  {filteredSingleRows.length} rows
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <SectionFilter
                  label="Track"
                  value={singleTrack}
                  onChange={setSingleTrack}
                  options={trackOptions}
                />
                <SectionFilter
                  label="Country"
                  value={singleCountry}
                  onChange={setSingleCountry}
                  options={countryOptions}
                />
              </div>

              {singlePricing.error ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                  {singlePricing.error}
                </div>
              ) : null}

              <div className="mt-4">
                {singlePricing.loading && !filteredSingleRows.length ? (
                  <div className="rounded-3xl border border-dashed border-zinc-200 bg-white/60 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                    Loading request pricing rows...
                  </div>
                ) : (
                  <PricingRowsTable
                    rows={filteredSingleRows}
                    drafts={drafts}
                    activeRowKey={activeRowKey}
                    busyKey={busyKey}
                    onFocusRow={setActiveRowKey}
                    onBlurRow={() => setActiveRowKey("")}
                    onDraftChange={handleDraftChange}
                    onSaveRow={handleSave}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

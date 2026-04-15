import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  getNearbyCountySuggestions,
  normalizeCountyList,
} from "../constants/kenyaCounties";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { normalizeSingleAssignedBranchIds } from "../services/assignedAdminBranchBinding";
import { setAssignedAdminByEmail } from "../services/assignedadminservice";
import {
  deriveOperationalBranchCoverage,
  listPartners,
} from "../services/partnershipService";
import { smartBack } from "../utils/navBack";

function safeStr(value) {
  return String(value || "").trim();
}

function normalizeCountryOptions(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => safeStr(value))
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export default function AdminAssignAdminScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [email, setEmail] = useState("");
  const [partners, setPartners] = useState([]);
  const [country, setCountry] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [primaryCounty, setPrimaryCounty] = useState("");
  const [neighboringCounties, setNeighboringCounties] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [branchSearch, setBranchSearch] = useState("");
  const [countySearch, setCountySearch] = useState("");
  const [countyOpen, setCountyOpen] = useState(false);
  const [town, setTown] = useState("");
  const [maxActiveRequests, setMaxActiveRequests] = useState("");
  const [availability, setAvailability] = useState("active");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const countyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setIsSuperAdmin(Boolean(ctx?.isSuperAdmin));
        if (ctx?.isSuperAdmin) {
          const rows = await listPartners({ max: 250 });
          if (!cancelled) {
            const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.isActive !== false);
            setPartners(activeRows);
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setIsSuperAdmin(false);
        setPartners([]);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!countyOpen) return undefined;
    const onPointerDown = (event) => {
      if (!countyRef.current) return;
      if (!countyRef.current.contains(event.target)) {
        setCountyOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [countyOpen]);

  const selectedNeighboringCounties = useMemo(
    () => normalizeCountyList(neighboringCounties).filter((county) => county !== primaryCounty),
    [neighboringCounties, primaryCounty]
  );

  const selectedPartner = useMemo(
    () => partners.find((partner) => partner.id === partnerId) || null,
    [partners, partnerId]
  );

  const partnerCountryOptions = useMemo(
    () =>
      selectedPartner?.isActive === false
        ? []
        : normalizeCountryOptions(selectedPartner?.homeCountries || []),
    [selectedPartner]
  );
  const partnerBranchOptions = useMemo(() => {
    const rows = Array.isArray(selectedPartner?.branches) ? selectedPartner.branches : [];
    return rows
      .filter((branch) => branch?.active !== false && branch?.isActive !== false)
      .map((branch) => ({
        branchId: safeStr(branch?.branchId || branch?.id),
        branchName: safeStr(branch?.branchName || branch?.name),
        country: safeStr(branch?.country, 120),
        primaryCounty: safeStr(branch?.primaryCounty || branch?.county),
        neighboringCounties: normalizeCountyList(branch?.neighboringCounties || []),
        coverageCounties: normalizeCountyList(branch?.coverageCounties || []),
      }))
      .filter((branch) => branch.branchId && branch.branchName);
  }, [selectedPartner]);
  const selectedBranches = useMemo(() => {
    const selected = new Set(selectedBranchIds.map((value) => safeStr(value).toLowerCase()).filter(Boolean));
    return partnerBranchOptions.filter((branch) => selected.has(branch.branchId.toLowerCase()));
  }, [partnerBranchOptions, selectedBranchIds]);
  const derivedBranchCoverage = useMemo(
    () => deriveOperationalBranchCoverage(selectedBranches, { activeOnly: true }),
    [selectedBranches]
  );
  const hasBranchSelection = selectedBranches.length > 0;
  const autoPrimaryCounty = useMemo(() => {
    const first = selectedBranches.find((branch) => safeStr(branch?.primaryCounty))?.primaryCounty;
    if (first) return first;
    return normalizeCountyList(derivedBranchCoverage?.coverageCounties || [])[0] || "";
  }, [derivedBranchCoverage?.coverageCounties, selectedBranches]);
  const autoNeighboringCounties = useMemo(
    () =>
      normalizeCountyList(derivedBranchCoverage?.coverageCounties || []).filter(
        (county) => county !== autoPrimaryCounty
      ),
    [autoPrimaryCounty, derivedBranchCoverage?.coverageCounties]
  );
  const autoCountries = useMemo(
    () => normalizeCountryOptions(selectedBranches.map((branch) => branch?.country)),
    [selectedBranches]
  );
  const effectiveCountries = useMemo(() => {
    if (hasBranchSelection && autoCountries.length) return autoCountries;
    return normalizeCountryOptions([country]);
  }, [autoCountries, country, hasBranchSelection]);
  const isKenyaScope = effectiveCountries.some(
    (countryName) => safeStr(countryName).toLowerCase() === "kenya"
  );

  const partnerCountyOptions = useMemo(
    () =>
      selectedPartner?.isActive === false
        ? []
        : normalizeCountyList(selectedPartner?.supportedCounties || []),
    [selectedPartner]
  );

  const countyFieldsEnabled =
    isKenyaScope && Boolean(partnerId) && Boolean(selectedPartner) && partnerCountyOptions.length > 0;
  const neighboringFieldsEnabled =
    countyFieldsEnabled && Boolean(primaryCounty) && partnerCountyOptions.length > 1;
  const manualCountyFieldsEnabled = countyFieldsEnabled && !hasBranchSelection;

  const filteredCounties = useMemo(() => {
    const needle = safeStr(countySearch).toLowerCase();
    const rows = partnerCountyOptions.filter((county) => county !== primaryCounty);
    if (!needle) return rows;
    return rows.filter((county) => county.toLowerCase().includes(needle));
  }, [countySearch, partnerCountyOptions, primaryCounty]);

  const recommendedCounties = useMemo(() => {
    return getNearbyCountySuggestions(primaryCounty, selectedNeighboringCounties)
      .filter((county) => partnerCountyOptions.includes(county))
      .slice(0, 8);
  }, [partnerCountyOptions, primaryCounty, selectedNeighboringCounties]);
  const filteredBranchOptions = useMemo(() => {
    const needle = safeStr(branchSearch).toLowerCase();
    if (!needle) return partnerBranchOptions;
    return partnerBranchOptions.filter((branch) =>
      [
        branch.branchName,
        branch.country,
        branch.primaryCounty,
        ...(branch.neighboringCounties || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [branchSearch, partnerBranchOptions]);

  useEffect(() => {
    if (!partnerId) {
      setSelectedBranchIds([]);
      setBranchSearch("");
      setPrimaryCounty("");
      setNeighboringCounties([]);
      setCountySearch("");
      setCountyOpen(false);
      return;
    }

    const validBranchIds = new Set(
      partnerBranchOptions.map((branch) => safeStr(branch?.branchId).toLowerCase()).filter(Boolean)
    );
    setSelectedBranchIds((current) =>
      normalizeSingleAssignedBranchIds(
        current.filter((branchId) => validBranchIds.has(safeStr(branchId).toLowerCase()))
      )
    );

    const allowed = new Set(partnerCountyOptions);
    setPrimaryCounty((current) => (current && allowed.has(current) ? current : ""));
    setNeighboringCounties((current) =>
      normalizeCountyList(current).filter((county) => allowed.has(county))
    );

    if (!partnerCountyOptions.length) {
      setCountySearch("");
      setCountyOpen(false);
    }
  }, [partnerBranchOptions, partnerCountyOptions, partnerId]);

  useEffect(() => {
    if (!partnerId) return;
    const stillVisible = partners.some((partner) => partner.id === partnerId);
    if (stillVisible) return;
    setPartnerId("");
    setSelectedBranchIds([]);
    setBranchSearch("");
    setPrimaryCounty("");
    setNeighboringCounties([]);
    setCountySearch("");
    setCountyOpen(false);
  }, [partnerId, partners]);

  useEffect(() => {
    if (!selectedPartner) {
      if (country) setCountry("");
      return;
    }
    if (hasBranchSelection) return;
    if (!country) return;
    const supported = partnerCountryOptions.some(
      (countryName) => safeStr(countryName).toLowerCase() === safeStr(country).toLowerCase()
    );
    if (!supported) {
      setCountry("");
    }
  }, [country, hasBranchSelection, partnerCountryOptions, selectedPartner]);

  useEffect(() => {
    if (isKenyaScope) return;
    setPrimaryCounty("");
    setNeighboringCounties([]);
    setCountySearch("");
    setCountyOpen(false);
  }, [isKenyaScope]);

  useEffect(() => {
    if (!hasBranchSelection) return;
    setCountyOpen(false);
    setCountySearch("");
  }, [hasBranchSelection]);

  const toggleCounty = (countyName) => {
    const normalized = normalizeCountyList([...selectedNeighboringCounties, countyName])
      .filter((county) => county !== primaryCounty);
    const key = safeStr(countyName).toLowerCase();
    if (selectedNeighboringCounties.some((value) => safeStr(value).toLowerCase() === key)) {
      setNeighboringCounties(
        selectedNeighboringCounties.filter((value) => safeStr(value).toLowerCase() !== key)
      );
      return;
    }
    setNeighboringCounties(normalized);
  };

  const toggleBranch = (branchId) => {
    const safeId = safeStr(branchId);
    if (!safeId) return;
    const key = safeId.toLowerCase();
    setSelectedBranchIds((current) => {
      const list = Array.isArray(current) ? current : [];
      const has = list.some((value) => safeStr(value).toLowerCase() === key);
      return has ? [] : normalizeSingleAssignedBranchIds([safeId]);
    });
  };

  const askConfirmAssign = () => {
    setErr("");
    const safeEmail = safeStr(email).toLowerCase();
    if (!safeEmail || !safeEmail.includes("@")) {
      setErr("Enter a valid admin email.");
      return;
    }
    if (!safeStr(partnerId)) {
      setErr("Select a partner.");
      return;
    }
    if (!hasBranchSelection) {
      setErr("Select one branch. Assigned admins are bound to a single branch.");
      return;
    }
    if (!autoCountries.length && !safeStr(country)) {
      setErr("Selected branches are missing physical country. Set fallback stationed country.");
      return;
    }
    if (isKenyaScope && hasBranchSelection && !safeStr(autoPrimaryCounty)) {
      setErr("Selected branches do not provide Kenya county coverage.");
      return;
    }
    const maxActive = toBoundedInt(maxActiveRequests, 0, 1, 120);
    if (maxActive <= 0) {
      setErr("Enter max active requests.");
      return;
    }
    setConfirmOpen(true);
  };

  const runAssign = async () => {
    const safeEmail = safeStr(email).toLowerCase();
    if (!safeEmail) return;
    const maxActive = toBoundedInt(maxActiveRequests, 0, 1, 120);
    if (maxActive <= 0) return;
    const stationedCountry = safeStr(autoCountries[0] || country);
    const boundBranchIds = normalizeSingleAssignedBranchIds(selectedBranchIds);

    setBusy(true);
    setErr("");
    try {
      await setAssignedAdminByEmail({
        email: safeEmail,
        action: "upsert",
        stationedCountry,
        country: stationedCountry,
        partnerId,
        selectedBranchIds: boundBranchIds,
        town,
        availability,
        maxActiveRequests: maxActive,
      });
      navigate("/app/admin", { replace: true });
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to assign admin.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const label = "text-[11px] font-semibold text-zinc-600 dark:text-zinc-300";
  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/50 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Assign Admin
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Assign an admin and define coverage settings.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin")}
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
            Only Super Admin can assign admins.
          </div>
        ) : (
          <div className={`mt-5 ${card} p-4`}>
            {err ? (
              <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <div className={label}>Partner</div>
                <select
                  className={input}
                  value={partnerId}
                  onChange={(event) => {
                    setPartnerId(event.target.value);
                    setCountry("");
                    setSelectedBranchIds([]);
                    setBranchSearch("");
                    setPrimaryCounty("");
                    setNeighboringCounties([]);
                    setCountySearch("");
                    setCountyOpen(false);
                  }}
                >
                  <option value="">Select partner</option>
                  {partners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.displayName}
                    </option>
                  ))}
                </select>
                {partners.length === 0 ? (
                  <div className="text-xs text-amber-700 dark:text-amber-200">
                    No active partners yet. Create one first in SACC Partnerships.
                  </div>
                ) : !partnerId ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Select partner first, then operational branch coverage.
                  </div>
                ) : !selectedPartner ? (
                  <div className="text-xs text-amber-700 dark:text-amber-200">
                    The selected partner is unavailable. Pick an active partner.
                  </div>
                ) : partnerCountryOptions.length === 0 ? (
                  <div className="text-xs text-amber-700 dark:text-amber-200">
                    This partner has no home-country coverage yet. Add home countries in SACC Partnerships first.
                  </div>
                ) : isKenyaScope && partnerCountyOptions.length === 0 ? (
                  <div className="text-xs text-amber-700 dark:text-amber-200">
                    This partner has no county coverage yet. Add counties in SACC Partnerships first.
                  </div>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Input Email</div>
                <input
                  className={input}
                  placeholder="assigned.admin@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Assigned Branch (Routing + Finance)</div>
                <input
                  className={input}
                  value={branchSearch}
                  onChange={(event) => setBranchSearch(event.target.value)}
                  placeholder={!selectedPartner ? "Select partner first" : "Search branches"}
                  disabled={!selectedPartner}
                />
                <div className="max-h-56 overflow-y-auto rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/70">
                  {!selectedPartner ? (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      Select a partner to choose branch routing coverage.
                    </div>
                  ) : partnerBranchOptions.length === 0 ? (
                    <div className="text-sm text-amber-700 dark:text-amber-200">
                      This partner has no operational branches yet. Configure branches in SACC Partnerships.
                    </div>
                  ) : filteredBranchOptions.length === 0 ? (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">
                      No branches match your search.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {filteredBranchOptions.map((branch) => {
                        const checked = selectedBranchIds.some(
                          (value) => safeStr(value).toLowerCase() === safeStr(branch.branchId).toLowerCase()
                        );
                        const coverageLabel = normalizeCountyList([
                          branch.primaryCounty,
                          ...(branch.neighboringCounties || []),
                        ]).join(", ");
                        const countryLabel = safeStr(branch?.country);
                        return (
                          <button
                            key={branch.branchId}
                            type="button"
                            onClick={() => toggleBranch(branch.branchId)}
                            className={[
                              "rounded-xl border px-3 py-2 text-left transition",
                              checked
                                ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                : "border-zinc-200 bg-white/80 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100",
                            ].join(" ")}
                          >
                            <div className="text-sm font-semibold">{branch.branchName}</div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {countryLabel
                                ? `${countryLabel}${coverageLabel ? ` • ${coverageLabel}` : ""}`
                                : coverageLabel || "No county coverage configured on this branch"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {hasBranchSelection ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    Auto coverage attached from branch:
                    {" "}
                    {autoCountries.length ? `Country ${autoCountries.join(", ")}.` : "Country not set on branch."}{" "}
                    {autoPrimaryCounty || "No primary county"}.
                    {autoNeighboringCounties.length
                      ? ` Nearby: ${autoNeighboringCounties.join(", ")}`
                      : " No neighboring counties configured."}
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Select one branch. Assigned admins remain bound to this branch for routing and payouts.
                  </div>
                )}
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Stationed Country (Legacy Fallback)</div>
                <select
                  className={input}
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  disabled={!selectedPartner || (hasBranchSelection && autoCountries.length > 0)}
                >
                  <option value="">
                    {!selectedPartner
                      ? "Select partner first"
                      : hasBranchSelection && autoCountries.length > 0
                      ? "Auto from selected branches"
                      : "Select stationed country"}
                  </option>
                  {partnerCountryOptions.map((countryName) => (
                    <option key={countryName} value={countryName}>
                      {countryName}
                    </option>
                  ))}
                </select>
                {!selectedPartner ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Select a partner first to choose fallback stationed country.
                  </div>
                ) : hasBranchSelection && autoCountries.length > 0 ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Branch selection drives country coverage automatically.
                  </div>
                ) : hasBranchSelection ? (
                  <div className="text-xs text-amber-700 dark:text-amber-200">
                    Selected branches are missing country. Set fallback stationed country for now.
                  </div>
                ) : partnerCountryOptions.length === 0 ? (
                  <div className="text-xs text-amber-700 dark:text-amber-200">
                    This partner has no home-country coverage configured yet.
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Used only when branch coverage is not selected.
                  </div>
                )}
              </div>

              {isKenyaScope ? (
                <>
                  <div className="grid gap-1.5">
                    <div className={label}>Primary County</div>
                    <select
                      className={input}
                      value={primaryCounty}
                      disabled={!manualCountyFieldsEnabled}
                      onChange={(event) => {
                        const nextPrimary = event.target.value;
                        setPrimaryCounty(nextPrimary);
                        setNeighboringCounties((prev) =>
                          normalizeCountyList(prev).filter((county) => county !== nextPrimary)
                        );
                      }}
                    >
                      <option value="">
                        {!countyFieldsEnabled
                          ? "Select partner first"
                          : hasBranchSelection
                          ? "Auto from branches"
                          : "Select primary county"}
                      </option>
                      {partnerCountyOptions.map((countyName) => (
                        <option key={countyName} value={countyName}>
                          {countyName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div ref={countyRef} className="relative grid gap-1.5">
                    <div className={label}>Neighboring Counties</div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!manualCountyFieldsEnabled || !neighboringFieldsEnabled) return;
                        setCountyOpen((value) => !value);
                      }}
                      disabled={!manualCountyFieldsEnabled || !neighboringFieldsEnabled}
                      className={`${input} inline-flex items-center justify-between text-left`}
                    >
                      <span className="truncate">
                        {!manualCountyFieldsEnabled
                          ? hasBranchSelection
                            ? "Auto from selected branches"
                            : "Select partner first"
                          : !countyFieldsEnabled
                          ? "Select partner first"
                          : !primaryCounty
                          ? "Select primary county first"
                          : selectedNeighboringCounties.length
                          ? selectedNeighboringCounties.join(", ")
                          : "Select neighboring counties"}
                      </span>
                      <AppIcon
                        icon={ChevronDown}
                        size={ICON_SM}
                        className={countyOpen ? "rotate-180 transition" : "transition"}
                      />
                    </button>

                    {countyOpen ? (
                      <div className="absolute left-0 right-0 top-full z-[10040] mt-2 rounded-2xl border border-zinc-200 bg-white/96 p-3 shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/96">
                        <input
                          className={input}
                          placeholder="Search counties..."
                          value={countySearch}
                          onChange={(event) => setCountySearch(event.target.value)}
                        />

                        {recommendedCounties.length ? (
                          <div className="mt-3">
                            <div className="mb-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                              Nearby county suggestions
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {recommendedCounties.map((countyName) => (
                                <button
                                  key={`rec-${countyName}`}
                                  type="button"
                                  onClick={() => toggleCounty(countyName)}
                                  className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                >
                                  + {countyName}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="mt-3 grid max-h-56 gap-1 overflow-y-auto">
                          {filteredCounties.map((countyName) => {
                            const selected = selectedNeighboringCounties.includes(countyName);
                            return (
                              <button
                                key={countyName}
                                type="button"
                                onClick={() => toggleCounty(countyName)}
                                className={[
                                  "rounded-xl border px-3 py-2 text-left text-sm font-medium transition",
                                  selected
                                    ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.15)] dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                    : "border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100",
                                ].join(" ")}
                              >
                                {countyName}
                              </button>
                            );
                          })}
                          {!filteredCounties.length ? (
                            <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                              No more counties available for this partner.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : effectiveCountries.length ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-300">
                  County subdivision routing remains Kenya-only for now. This admin will route by country coverage and partner match.
                </div>
              ) : null}

              <div className="grid gap-1.5">
                <div className={label}>Select Town or City</div>
                <input
                  className={input}
                  placeholder="Town or city"
                  value={town}
                  onChange={(event) => setTown(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Select Max Active</div>
                <input
                  type="number"
                  min={1}
                  max={120}
                  className={input}
                  value={maxActiveRequests}
                  onChange={(event) => setMaxActiveRequests(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Availability</div>
                <select
                  className={input}
                  value={availability}
                  onChange={(event) => setAvailability(event.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="busy">Busy</option>
                  <option value="offline">Offline</option>
                </select>
              </div>

              <button
                type="button"
                onClick={askConfirmAssign}
                disabled={busy}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                <AppIcon icon={UserPlus} size={ICON_MD} />
                Assign Admin
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close assign confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center app-overlay-safe">
            <div className="w-full max-w-sm rounded-3xl border border-emerald-200 bg-white p-4 shadow-xl dark:border-emerald-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                <AppIcon icon={CheckCircle2} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Assign this admin?
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 break-all">
                {safeStr(email).toLowerCase()}
              </div>
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                {country ? `Stationed country: ${country}` : "Stationed country not selected"}
                {isKenyaScope && (hasBranchSelection ? autoPrimaryCounty : primaryCounty)
                  ? ` | County: ${hasBranchSelection ? autoPrimaryCounty : primaryCounty}`
                  : ""}
                {hasBranchSelection ? ` | Branches: ${selectedBranches.length}` : ""}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runAssign()}
                  disabled={busy}
                  className="rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? "Assigning..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

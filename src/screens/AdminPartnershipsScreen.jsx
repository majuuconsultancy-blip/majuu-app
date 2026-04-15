import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, APP_TRACK_OPTIONS } from "../constants/migrationOptions";
import {
  KENYA_COUNTY_OPTIONS,
  normalizeCountyList,
} from "../constants/kenyaCounties";
import { EAST_AFRICA_RESIDENCE_COUNTRIES } from "../constants/eastAfricaProfile";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { subscribeAllCountries } from "../services/countryService";
import {
  createEmptyPartnerDraft,
  createPartner,
  deriveOperationalBranchCoverage,
  draftFromPartner,
  listPartners,
  setPartnerActiveState,
  updatePartner,
} from "../services/partnershipService";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function makeId(prefix = "row") {
  return `${safeString(prefix, 20).toLowerCase() || "row"}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function makeBranch(defaultCountry = "") {
  const branchId = makeId("branch");
  return {
    branchId,
    branchName: "",
    id: branchId,
    name: "",
    country: safeString(defaultCountry, 120),
    primaryCounty: "",
    neighboringCounties: [],
    coverageCounties: [],
    county: "",
    physicalTown: "",
    town: "",
    address: "",
    payoutDestination: {
      type: "bank_transfer",
      mpesaMode: "till",
      bankName: "",
      bankBranchName: "",
      accountName: "",
      accountNumber: "",
      accountNumberLast4: "",
      phoneNumber: "",
      paybillNumber: "",
      paybillAccountNumber: "",
      tillNumber: "",
      reference: "",
      otherLabel: "",
      destinationDetails: "",
    },
    financial: {
      activeFinancialStatus: "active",
      platformCutType: "percentage",
      platformCutValue: 10,
      platformCutBase: "official_plus_service_fee",
      releaseBehaviorOverride: "manual_review",
      payoutDestinationReady: false,
    },
    payoutMetadata: {},
    notes: "",
    active: true,
    isActive: true,
  };
}

function metaRowsFromObject(value) {
  const source = value && typeof value === "object" ? value : {};
  const rows = Object.entries(source)
    .map(([key, entryValue]) => ({
      id: makeId("meta"),
      key: safeString(key, 80),
      value: safeString(entryValue, 200),
    }))
    .filter((row) => row.key);
  return rows.length ? rows : [{ id: makeId("meta"), key: "", value: "" }];
}

function metaObjectFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    const key = safeString(row?.key, 80);
    const value = safeString(row?.value, 200);
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}

function MetaPill({ children, active = false }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        active
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
          : "border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
      }`}
    >
      {children}
    </span>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/75 p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
      {subtitle ? <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SelectionPill({ children, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-semibold text-emerald-800"
    >
      <span>{children}</span>
      <span className="text-emerald-500">x</span>
    </button>
  );
}

function SelectionDropdown({
  label,
  inputClass,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  selectValue,
  onSelectValueChange,
  onAdd,
  selectPlaceholder,
  options,
  selectedValues,
  emptyLabel,
  onRemove,
}) {
  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1.5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <label>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            Search
          </div>
          <input
            className={inputClass}
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <label>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
            {label}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select
              className={inputClass}
              value={selectValue}
              onChange={(event) => onSelectValueChange(event.target.value)}
            >
              <option value="">{selectPlaceholder}</option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onAdd}
              disabled={!selectValue}
              className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </label>
      </div>

      <div className="min-h-[42px] rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/45">
        {selectedValues.length ? (
          <div className="flex flex-wrap gap-2">
            {selectedValues.map((value) => (
              <SelectionPill key={value} onRemove={() => onRemove(value)}>
                {value}
              </SelectionPill>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

export default function AdminPartnershipsScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [partners, setPartners] = useState([]);
  const [countries, setCountries] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(createEmptyPartnerDraft());
  const [metadataRows, setMetadataRows] = useState(metaRowsFromObject({}));
  const [homeCountrySearch, setHomeCountrySearch] = useState("");
  const [homeCountryPick, setHomeCountryPick] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const [countryPick, setCountryPick] = useState("");
  const [countySearch, setCountySearch] = useState("");
  const [countyPick, setCountyPick] = useState("");
  const [notesMetaOpen, setNotesMetaOpen] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (!cancelled) setIsSuperAdmin(Boolean(ctx?.isSuperAdmin));
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setIsSuperAdmin(false);
        }
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadPartners = async () => {
    setLoading(true);
    setErr("");
    try {
      const rows = await listPartners({ activeOnly: false, max: 250 });
      setPartners(Array.isArray(rows) ? rows : []);
    } catch (error) {
      console.error(error);
      setPartners([]);
      setErr(error?.message || "Failed to load partners.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadPartners();
  }, [isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return undefined;
    return subscribeAllCountries({
      onData: (rows) => setCountries(Array.isArray(rows) ? rows : []),
      onError: (error) => {
        console.error(error);
        setCountries([]);
      },
    });
  }, [isSuperAdmin]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-3.5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const label = "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  const activeCountries = useMemo(
    () =>
      countries
        .filter((country) => country?.isActive)
        .map((country) => safeString(country?.name, 120))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [countries]
  );

  const filteredPartners = useMemo(() => {
    const needle = safeString(search, 120).toLowerCase();
    return partners
      .filter((partner) => {
        if (!needle) return true;
        return [
          partner?.displayName,
          partner?.internalName,
          partner?.notes,
          ...(partner?.homeCountries || []),
          ...(partner?.supportedCountries || []),
          ...(partner?.supportedCounties || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .filter((partner) => {
        if (!statusFilter) return true;
        return statusFilter === "active" ? partner?.isActive !== false : partner?.isActive === false;
      });
  }, [partners, search, statusFilter]);

  const activeCount = useMemo(
    () => partners.filter((partner) => partner?.isActive !== false).length,
    [partners]
  );

  const filteredHomeCountryOptions = useMemo(() => {
    const needle = safeString(homeCountrySearch, 120).toLowerCase();
    return EAST_AFRICA_RESIDENCE_COUNTRIES.filter(
      (country) =>
        !(draft?.homeCountries || []).includes(country) &&
        country.toLowerCase().includes(needle)
    );
  }, [draft?.homeCountries, homeCountrySearch]);

  const filteredCountryOptions = useMemo(() => {
    const needle = safeString(countrySearch, 120).toLowerCase();
    return activeCountries.filter(
      (country) =>
        !(draft?.supportedCountries || []).includes(country) &&
        country.toLowerCase().includes(needle)
    );
  }, [activeCountries, countrySearch, draft?.supportedCountries]);

  const filteredCountyOptions = useMemo(() => {
    const needle = safeString(countySearch, 120).toLowerCase();
    return KENYA_COUNTY_OPTIONS.filter(
      (county) =>
        !normalizeCountyList(draft?.supportedCounties || []).includes(county) &&
        county.toLowerCase().includes(needle)
    );
  }, [countySearch, draft?.supportedCounties]);
  const branchPhysicalCountryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (draft?.homeCountries || [])
            .map((country) => safeString(country, 120))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [draft?.homeCountries]
  );
  const branchCoverageSummary = useMemo(
    () => deriveOperationalBranchCoverage(draft?.branches || [], { activeOnly: true }),
    [draft?.branches]
  );

  const updateDraft = (patch) => setDraft((current) => ({ ...current, ...(patch || {}) }));

  const toggleTrack = (track) => {
    setDraft((current) => {
      const set = new Set(current?.supportedTracks || []);
      if (set.has(track)) set.delete(track);
      else set.add(track);
      return { ...current, supportedTracks: APP_TRACK_OPTIONS.filter((item) => set.has(item)) };
    });
  };

  const toggleCountry = (countryName) => {
    setDraft((current) => {
      const set = new Set(current?.supportedCountries || []);
      if (set.has(countryName)) set.delete(countryName);
      else set.add(countryName);
      return { ...current, supportedCountries: Array.from(set).sort((a, b) => a.localeCompare(b)) };
    });
  };

  const addCountry = () => {
    if (!countryPick) return;
    toggleCountry(countryPick);
    setCountryPick("");
  };

  const toggleHomeCountry = (countryName) => {
    setDraft((current) => {
      const set = new Set(current?.homeCountries || []);
      if (set.has(countryName)) set.delete(countryName);
      else set.add(countryName);
      return { ...current, homeCountries: Array.from(set).sort((a, b) => a.localeCompare(b)) };
    });
  };

  const addHomeCountry = () => {
    if (!homeCountryPick) return;
    toggleHomeCountry(homeCountryPick);
    setHomeCountryPick("");
  };

  const toggleCounty = (countyName) => {
    setDraft((current) => {
      const set = new Set(normalizeCountyList(current?.supportedCounties || []));
      if (set.has(countyName)) set.delete(countyName);
      else set.add(countyName);
      return {
        ...current,
        supportedCounties: normalizeCountyList(Array.from(set)),
        neighboringCounties: [],
      };
    });
  };

  const addCounty = () => {
    if (!countyPick) return;
    toggleCounty(countyPick);
    setCountyPick("");
  };

  const updateBranch = (branchId, patch) => {
    const safeBranchId = safeString(branchId, 120);
    setDraft((current) => ({
      ...current,
      branches: (current?.branches || []).map((branch) =>
        (safeString(branch?.branchId || branch?.id, 120) === safeBranchId)
          ? {
              ...branch,
              ...(patch || {}),
              branchId: safeBranchId || safeString(branch?.branchId || branch?.id, 120),
              id: safeBranchId || safeString(branch?.branchId || branch?.id, 120),
            }
          : branch
      ),
    }));
  };

  const updateBranchPrimaryCounty = (branchId, nextPrimaryCounty) => {
    const safePrimary = normalizeCountyList([nextPrimaryCounty])[0] || "";
    setDraft((current) => ({
      ...current,
      branches: (current?.branches || []).map((branch) => {
        const currentBranchId = branch?.branchId || branch?.id;
        if (currentBranchId !== branchId) return branch;
        const neighboring = normalizeCountyList(branch?.neighboringCounties || []).filter(
          (county) => county !== safePrimary
        );
        const coverage = normalizeCountyList([safePrimary, ...neighboring]);
        return {
          ...branch,
          branchId: currentBranchId,
          id: currentBranchId,
          primaryCounty: safePrimary,
          county: safePrimary,
          neighboringCounties: neighboring,
          coverageCounties: coverage,
        };
      }),
    }));
  };

  const openCreate = () => {
    setErr("");
    setMsg("");
    setEditingId("");
    setDraft(createEmptyPartnerDraft());
    setMetadataRows(metaRowsFromObject({}));
    setHomeCountrySearch("");
    setHomeCountryPick("");
    setCountrySearch("");
    setCountryPick("");
    setCountySearch("");
    setCountyPick("");
    setNotesMetaOpen(false);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (partner) => {
    setErr("");
    setMsg("");
    setEditingId(partner?.id || "");
    setDraft(draftFromPartner(partner));
    setMetadataRows(metaRowsFromObject(partner?.metadata));
    setHomeCountrySearch("");
    setHomeCountryPick("");
    setCountrySearch("");
    setCountryPick("");
    setCountySearch("");
    setCountyPick("");
    setNotesMetaOpen(
      Boolean(safeString(partner?.notes, 20)) ||
        Object.keys(partner?.metadata && typeof partner.metadata === "object" ? partner.metadata : {}).length > 0
    );
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetForm = () => {
    setFormOpen(false);
    setEditingId("");
    setDraft(createEmptyPartnerDraft());
    setMetadataRows(metaRowsFromObject({}));
    setHomeCountrySearch("");
    setHomeCountryPick("");
    setCountrySearch("");
    setCountryPick("");
    setCountySearch("");
    setCountyPick("");
    setNotesMetaOpen(false);
  };

  const closeForm = () => {
    if (busy === "save") return;
    resetForm();
  };

  const saveDraft = async () => {
    setBusy("save");
    setErr("");
    setMsg("");
    try {
      const payload = { ...draft, metadata: metaObjectFromRows(metadataRows) };
      if (editingId) {
        await updatePartner(editingId, payload);
        setMsg("Partner updated.");
      } else {
        await createPartner(payload);
        setMsg("Partner created.");
      }
      resetForm();
      await loadPartners();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save partner.");
    } finally {
      setBusy("");
    }
  };

  const toggleActive = async (partner) => {
    const actionKey = `active:${partner?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");
    try {
      const nextState = partner?.isActive === false;
      await setPartnerActiveState(partner?.id, nextState);
      setMsg(nextState ? "Partner activated." : "Partner deactivated.");
      await loadPartners();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update partner status.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={pageBg}>
      <div className="mx-auto max-w-6xl px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC Partnerships
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Home-country eligibility, destination coverage, and county routing for partner assignment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin/sacc")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {checkingRole ? <div className={`mt-5 ${card}`}>Checking access...</div> : null}
        {!checkingRole && !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage partnerships.
          </div>
        ) : null}

        {!checkingRole && isSuperAdmin ? (
          <>
            {err ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-700">{err}</div> : null}
            {msg ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-800">{msg}</div> : null}

            {formOpen ? (
              <div className="mt-5 grid gap-3">
                <div className={card}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {editingId ? "Edit Partner" : "Create Partner"}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        Partner onboarding, operational branch routing, fallback county coverage, and internal metadata.
                      </div>
                    </div>
                    <button type="button" onClick={closeForm} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700">
                      <AppIcon icon={X} size={ICON_SM} />
                      Close
                    </button>
                  </div>
                </div>

                <Section title="Basics" subtitle="Display name, internal name, and active state.">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label>
                      <div className={label}>Display Name</div>
                      <input className={input} value={draft.displayName} onChange={(e) => updateDraft({ displayName: e.target.value })} />
                    </label>
                    <label>
                      <div className={label}>Internal Name</div>
                      <input className={input} value={draft.internalName} onChange={(e) => updateDraft({ internalName: e.target.value })} />
                    </label>
                    <label>
                      <div className={label}>Status</div>
                      <select className={input} value={draft.status} onChange={(e) => updateDraft({ status: e.target.value })}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                  </div>
                </Section>

                <Section title="Track Coverage" subtitle="Partners can support only some tracks.">
                  <div className="flex flex-wrap gap-2">
                    {APP_TRACK_OPTIONS.map((track) => (
                      <button
                        key={track}
                        type="button"
                        onClick={() => toggleTrack(track)}
                        className={`rounded-2xl border px-3.5 py-2 text-sm font-semibold ${
                          (draft?.supportedTracks || []).includes(track)
                            ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
                            : "border-zinc-200 bg-white/80 text-zinc-700"
                        }`}
                      >
                        {APP_TRACK_META[track]?.label || track}
                      </button>
                    ))}
                  </div>
                </Section>

                <Section
                  title="Home Countries"
                  subtitle="Only users whose residence country matches one of these countries will see this partner."
                >
                  <SelectionDropdown
                    label="Home country list"
                    inputClass={input}
                    searchValue={homeCountrySearch}
                    onSearchChange={setHomeCountrySearch}
                    searchPlaceholder="Search home countries"
                    selectValue={homeCountryPick}
                    onSelectValueChange={setHomeCountryPick}
                    onAdd={addHomeCountry}
                    selectPlaceholder={
                      filteredHomeCountryOptions.length ? "Select home country" : "No more countries"
                    }
                    options={filteredHomeCountryOptions}
                    selectedValues={draft?.homeCountries || []}
                    emptyLabel="No home countries selected yet."
                    onRemove={toggleHomeCountry}
                  />
                </Section>

                <Section title="Country Coverage" subtitle="Select the destination countries this partner can handle.">
                  <SelectionDropdown
                    label="Country list"
                    inputClass={input}
                    searchValue={countrySearch}
                    onSearchChange={setCountrySearch}
                    searchPlaceholder="Search countries"
                    selectValue={countryPick}
                    onSelectValueChange={setCountryPick}
                    onAdd={addCountry}
                    selectPlaceholder={filteredCountryOptions.length ? "Select country" : "No more countries"}
                    options={filteredCountryOptions}
                    selectedValues={draft?.supportedCountries || []}
                    emptyLabel="No countries selected yet."
                    onRemove={toggleCountry}
                  />
                </Section>

                <Section
                  title="County Coverage (Legacy Fallback)"
                  subtitle="Operational routing now comes from branch coverage. Keep this for backward compatibility."
                >
                  <SelectionDropdown
                    label="County list"
                    inputClass={input}
                    searchValue={countySearch}
                    onSearchChange={setCountySearch}
                    searchPlaceholder="Search counties"
                    selectValue={countyPick}
                    onSelectValueChange={setCountyPick}
                    onAdd={addCounty}
                    selectPlaceholder={filteredCountyOptions.length ? "Select county" : "No more counties"}
                    options={filteredCountyOptions}
                    selectedValues={draft?.supportedCounties || []}
                    emptyLabel="No counties selected yet."
                    onRemove={toggleCounty}
                  />
                </Section>

                <Section
                  title="Operational Branch Routing"
                  subtitle="Branches now drive county routing coverage, admin assignment, and payout destination mapping. Physical country must be selected from Home Countries."
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetaPill active>Active Branches: {(branchCoverageSummary?.branches || []).length}</MetaPill>
                    <MetaPill>
                      Coverage Counties: {(branchCoverageSummary?.coverageCounties || []).length}
                    </MetaPill>
                    <MetaPill>
                      Primary Counties: {(branchCoverageSummary?.primaryCounties || []).length}
                    </MetaPill>
                  </div>
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    Branch coverage summary: {(branchCoverageSummary?.coverageCounties || []).join(", ") || "No branch coverage configured yet."}
                  </div>

                  <div className="mt-3 grid gap-3">
                    {(draft?.branches || []).map((branch, index) => {
                      const branchId = safeString(branch?.branchId || branch?.id, 120) || makeId("branch");
                      const branchCountry = safeString(branch?.country, 120);
                      const branchCountryInHomeCountries = branchPhysicalCountryOptions.includes(branchCountry);
                      const branchCountryOptions =
                        branchCountry && !branchCountryInHomeCountries
                          ? [branchCountry, ...branchPhysicalCountryOptions]
                          : branchPhysicalCountryOptions;
                      const payoutDestination =
                        branch?.payoutDestination && typeof branch.payoutDestination === "object"
                          ? branch.payoutDestination
                          : {};
                      const payoutType =
                        safeString(payoutDestination?.type, 40).toLowerCase() === "mpesa"
                          ? "mpesa"
                          : safeString(payoutDestination?.type, 40).toLowerCase() === "other"
                          ? "other"
                          : "bank_transfer";
                      const mpesaMode =
                        safeString(
                          payoutDestination?.mpesaMode ||
                            (safeString(payoutDestination?.paybillNumber, 80) ? "paybill" : ""),
                          20
                        ).toLowerCase() === "paybill"
                          ? "paybill"
                          : "till";
                      const primaryCounty = normalizeCountyList([
                        branch?.primaryCounty || branch?.county || "",
                      ])[0] || "";
                      const neighboring = normalizeCountyList(branch?.neighboringCounties || []).filter(
                        (county) => county !== primaryCounty
                      );
                      const coverage = normalizeCountyList([
                        primaryCounty,
                        ...neighboring,
                      ]);
                      const financialSource =
                        branch?.financial && typeof branch.financial === "object"
                          ? branch.financial
                          : branch;
                      const branchFinancial = {
                        activeFinancialStatus:
                          safeString(
                            financialSource?.activeFinancialStatus || financialSource?.financialStatus,
                            40
                          ).toLowerCase() === "inactive"
                            ? "inactive"
                            : "active",
                        platformCutType:
                          safeString(
                            financialSource?.platformCutType || financialSource?.defaultPlatformCutType,
                            40
                          ).toLowerCase() === "flat"
                            ? "flat"
                            : "percentage",
                        platformCutValue:
                          Number(
                            financialSource?.platformCutValue ??
                              financialSource?.defaultPlatformCutValue ??
                              10
                          ) || 0,
                        platformCutBase:
                          safeString(financialSource?.platformCutBase, 60).toLowerCase() ===
                          "official_amount"
                            ? "official_amount"
                            : "official_plus_service_fee",
                        releaseBehaviorOverride:
                          safeString(
                            financialSource?.releaseBehaviorOverride ||
                              financialSource?.payoutReleaseBehavior,
                            60
                          ).toLowerCase() === "auto_release"
                            ? "auto_release"
                            : "manual_review",
                        payoutDestinationReady:
                          typeof financialSource?.payoutDestinationReady === "boolean"
                            ? financialSource.payoutDestinationReady
                            : Boolean(branch?.payoutDestination),
                      };
                      return (
                        <div
                          key={branchId || index}
                          className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              Branch {index + 1}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                updateDraft({
                                  branches: (draft?.branches || []).filter(
                                    (item) =>
                                      safeString(item?.branchId || item?.id, 120) !== branchId
                                  ),
                                })
                              }
                              className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-semibold text-rose-700"
                            >
                              <AppIcon icon={Trash2} size={ICON_SM} />
                              Remove
                            </button>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                            <label className="grid gap-1.5">
                              <div className={label}>Branch Name</div>
                              <input
                                className={input}
                                placeholder="Branch name"
                                value={branch?.branchName || branch?.name || ""}
                                onChange={(e) =>
                                  updateBranch(branchId, {
                                    branchName: e.target.value,
                                    name: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <div className={label}>Physical Country</div>
                              <select
                                className={input}
                                value={branch?.country || ""}
                                onChange={(e) => updateBranch(branchId, { country: e.target.value })}
                                disabled={!branchPhysicalCountryOptions.length}
                              >
                                <option value="">
                                  {branchPhysicalCountryOptions.length
                                    ? "Select branch home country"
                                    : "Select home countries first"}
                                </option>
                                {branchCountryOptions.map((country) => (
                                  <option key={`branch-country-${country}`} value={country}>
                                    {country}
                                  </option>
                                ))}
                              </select>
                              {branchCountry && !branchCountryInHomeCountries ? (
                                <div className="text-xs text-amber-700 dark:text-amber-300">
                                  This branch country is outside selected home countries. Please re-select from Home Countries.
                                </div>
                              ) : null}
                            </label>
                            <label className="grid gap-1.5">
                              <div className={label}>Physical Town / City</div>
                              <input
                                className={input}
                                placeholder="Town / City"
                                value={branch?.physicalTown || branch?.town || ""}
                                onChange={(e) =>
                                  updateBranch(branchId, {
                                    physicalTown: e.target.value,
                                    town: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <label className="grid gap-1.5">
                              <div className={label}>Primary County</div>
                              <select
                                className={input}
                                value={primaryCounty}
                                onChange={(e) => updateBranchPrimaryCounty(branchId, e.target.value)}
                              >
                                <option value="">Select primary county</option>
                                {KENYA_COUNTY_OPTIONS.map((countyName) => (
                                  <option key={`${branchId}-primary-${countyName}`} value={countyName}>
                                    {countyName}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1.5">
                              <div className={label}>Neighboring Counties (Multi-select)</div>
                              <select
                                multiple
                                size={Math.min(8, Math.max(4, KENYA_COUNTY_OPTIONS.length))}
                                className={input}
                                value={neighboring}
                                onChange={(e) => {
                                  const selected = Array.from(e.target.selectedOptions).map(
                                    (option) => option.value
                                  );
                                  const nextNeighboring = normalizeCountyList(selected).filter(
                                    (county) => county !== primaryCounty
                                  );
                                  updateBranch(branchId, {
                                    neighboringCounties: nextNeighboring,
                                    coverageCounties: normalizeCountyList([
                                      primaryCounty,
                                      ...nextNeighboring,
                                    ]),
                                  });
                                }}
                              >
                                {KENYA_COUNTY_OPTIONS.filter((county) => county !== primaryCounty).map(
                                  (countyName) => (
                                    <option key={`${branchId}-neighbor-${countyName}`} value={countyName}>
                                      {countyName}
                                    </option>
                                  )
                                )}
                              </select>
                            </label>
                          </div>

                          <div className="mt-3 grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/45">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                              Branch Financial Controls
                            </div>
                            <div className="grid gap-3 lg:grid-cols-3">
                              <label className="grid gap-1.5">
                                <div className={label}>Financial Status</div>
                                <select
                                  className={input}
                                  value={branchFinancial.activeFinancialStatus}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      financial: {
                                        ...(branch?.financial || {}),
                                        activeFinancialStatus:
                                          safeString(e.target.value, 40).toLowerCase() === "inactive"
                                            ? "inactive"
                                            : "active",
                                      },
                                    })
                                  }
                                >
                                  <option value="active">Active</option>
                                  <option value="inactive">Inactive</option>
                                </select>
                              </label>
                              <label className="grid gap-1.5">
                                <div className={label}>Platform Cut Type</div>
                                <select
                                  className={input}
                                  value={branchFinancial.platformCutType}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      financial: {
                                        ...(branch?.financial || {}),
                                        platformCutType:
                                          safeString(e.target.value, 40).toLowerCase() === "flat"
                                            ? "flat"
                                            : "percentage",
                                      },
                                    })
                                  }
                                >
                                  <option value="percentage">Percentage</option>
                                  <option value="flat">Flat Rate</option>
                                </select>
                              </label>
                              <label className="grid gap-1.5">
                                <div className={label}>Platform Cut Value</div>
                                <input
                                  className={input}
                                  inputMode="decimal"
                                  value={branchFinancial.platformCutValue}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      financial: {
                                        ...(branch?.financial || {}),
                                        platformCutValue: Number(e.target.value || 0),
                                      },
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <div className="grid gap-3 lg:grid-cols-2">
                              <label className="grid gap-1.5">
                                <div className={label}>Platform Cut Base</div>
                                <select
                                  className={input}
                                  value={branchFinancial.platformCutBase}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      financial: {
                                        ...(branch?.financial || {}),
                                        platformCutBase:
                                          safeString(e.target.value, 60).toLowerCase() ===
                                          "official_amount"
                                            ? "official_amount"
                                            : "official_plus_service_fee",
                                      },
                                    })
                                  }
                                >
                                  <option value="official_amount">Official Amount Only</option>
                                  <option value="official_plus_service_fee">
                                    Official Amount + Service Fee
                                  </option>
                                </select>
                              </label>
                              <label className="grid gap-1.5">
                                <div className={label}>Release Behavior</div>
                                <select
                                  className={input}
                                  value={branchFinancial.releaseBehaviorOverride}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      financial: {
                                        ...(branch?.financial || {}),
                                        releaseBehaviorOverride:
                                          safeString(e.target.value, 60).toLowerCase() ===
                                          "auto_release"
                                            ? "auto_release"
                                            : "manual_review",
                                      },
                                    })
                                  }
                                >
                                  <option value="manual_review">Manual</option>
                                  <option value="auto_release">Auto</option>
                                </select>
                              </label>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/45">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                              Payout Destination
                            </div>
                            <div className="grid gap-3">
                              <label className="grid gap-1.5">
                                <div className={label}>Destination Type</div>
                                <select
                                  className={input}
                                  value={payoutType}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      payoutDestination: {
                                        ...(branch?.payoutDestination || {}),
                                        type: ["mpesa", "other"].includes(
                                          safeString(e.target.value, 40).toLowerCase()
                                        )
                                          ? safeString(e.target.value, 40).toLowerCase()
                                          : "bank_transfer",
                                        mpesaMode:
                                          safeString(e.target.value, 40).toLowerCase() === "mpesa"
                                            ? mpesaMode
                                            : "",
                                      },
                                    })
                                  }
                                >
                                  <option value="bank_transfer">Bank transfer</option>
                                  <option value="mpesa">M-Pesa</option>
                                  <option value="other">Other</option>
                                </select>
                              </label>

                              {payoutType === "mpesa" ? (
                                <div className="grid gap-3 lg:grid-cols-3">
                                  <label className="grid gap-1.5">
                                    <div className={label}>M-Pesa Route</div>
                                    <select
                                      className={input}
                                      value={mpesaMode}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "mpesa",
                                            mpesaMode:
                                              safeString(e.target.value, 20).toLowerCase() === "paybill"
                                                ? "paybill"
                                                : "till",
                                          },
                                        })
                                      }
                                    >
                                      <option value="till">Till</option>
                                      <option value="paybill">Paybill</option>
                                    </select>
                                  </label>

                                  {mpesaMode === "paybill" ? (
                                    <>
                                      <label className="grid gap-1.5">
                                        <div className={label}>Business Number</div>
                                        <input
                                          className={input}
                                          value={
                                            branch?.payoutDestination?.paybillNumber ||
                                            branch?.payoutDestination?.shortCode ||
                                            ""
                                          }
                                          onChange={(e) =>
                                            updateBranch(branchId, {
                                              payoutDestination: {
                                                ...(branch?.payoutDestination || {}),
                                                type: "mpesa",
                                                mpesaMode: "paybill",
                                                paybillNumber: safeString(e.target.value, 80),
                                                shortCode: safeString(e.target.value, 80),
                                              },
                                            })
                                          }
                                        />
                                      </label>
                                      <label className="grid gap-1.5">
                                        <div className={label}>Account Number</div>
                                        <input
                                          className={input}
                                          value={branch?.payoutDestination?.paybillAccountNumber || ""}
                                          onChange={(e) =>
                                            updateBranch(branchId, {
                                              payoutDestination: {
                                                ...(branch?.payoutDestination || {}),
                                                type: "mpesa",
                                                mpesaMode: "paybill",
                                                paybillAccountNumber: safeString(e.target.value, 120),
                                              },
                                            })
                                          }
                                        />
                                      </label>
                                    </>
                                  ) : (
                                    <label className="grid gap-1.5">
                                      <div className={label}>Till Number</div>
                                      <input
                                        className={input}
                                        value={branch?.payoutDestination?.tillNumber || ""}
                                        onChange={(e) =>
                                          updateBranch(branchId, {
                                            payoutDestination: {
                                              ...(branch?.payoutDestination || {}),
                                              type: "mpesa",
                                              mpesaMode: "till",
                                              tillNumber: safeString(e.target.value, 80),
                                            },
                                          })
                                        }
                                      />
                                    </label>
                                  )}

                                  <label className="grid gap-1.5">
                                    <div className={label}>Reference</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.reference || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "mpesa",
                                            reference: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                              ) : payoutType === "other" ? (
                                <div className="grid gap-3 lg:grid-cols-2">
                                  <label className="grid gap-1.5">
                                    <div className={label}>Destination Label</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.otherLabel || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "other",
                                            otherLabel: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5">
                                    <div className={label}>Destination Details</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.destinationDetails || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "other",
                                            destinationDetails: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5 lg:col-span-2">
                                    <div className={label}>Reference</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.reference || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "other",
                                            reference: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                              ) : (
                                <div className="grid gap-3 lg:grid-cols-3">
                                  <label className="grid gap-1.5">
                                    <div className={label}>Bank Name</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.bankName || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "bank_transfer",
                                            bankName: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5">
                                    <div className={label}>Bank Branch</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.bankBranchName || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "bank_transfer",
                                            bankBranchName: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5">
                                    <div className={label}>Account Name</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.accountName || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "bank_transfer",
                                            accountName: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5">
                                    <div className={label}>Account Number</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.accountNumber || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "bank_transfer",
                                            accountNumber: safeString(e.target.value, 80),
                                            accountNumberLast4: safeString(e.target.value, 80).slice(-4),
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="grid gap-1.5">
                                    <div className={label}>Reference</div>
                                    <input
                                      className={input}
                                      value={branch?.payoutDestination?.reference || ""}
                                      onChange={(e) =>
                                        updateBranch(branchId, {
                                          payoutDestination: {
                                            ...(branch?.payoutDestination || {}),
                                            type: "bank_transfer",
                                            reference: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                              )}
                              <label className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                                <input
                                  type="checkbox"
                                  checked={branchFinancial.payoutDestinationReady === true}
                                  onChange={(e) =>
                                    updateBranch(branchId, {
                                      financial: {
                                        ...(branch?.financial || {}),
                                        payoutDestinationReady: e.target.checked,
                                      },
                                    })
                                  }
                                  className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-400"
                                />
                                Payout destination ready for release
                              </label>
                            </div>
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-[auto_1fr]">
                            <label className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                              <input
                                type="checkbox"
                                checked={branch?.active !== false && branch?.isActive !== false}
                                onChange={(e) =>
                                  updateBranch(branchId, {
                                    active: e.target.checked,
                                    isActive: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-400"
                              />
                              Active branch
                            </label>
                            <textarea
                              className={input}
                              rows={2}
                              placeholder="Branch operational notes"
                              value={branch?.notes || ""}
                              onChange={(e) => updateBranch(branchId, { notes: e.target.value })}
                            />
                          </div>

                          <div className="mt-3 rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                            Routing coverage: {coverage.join(", ") || "No county coverage configured yet."}
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() =>
                        updateDraft({
                          branches: [
                            ...(draft?.branches || []),
                            makeBranch(branchPhysicalCountryOptions[0] || ""),
                          ],
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-2.5 text-sm font-semibold text-emerald-800"
                    >
                      <AppIcon icon={Plus} size={ICON_SM} />
                      Add Branch
                    </button>
                  </div>
                </Section>

                <Section title="Internal Notes and Metadata" subtitle="Admin-only notes and compatibility metadata.">
                  <button
                    type="button"
                    onClick={() => setNotesMetaOpen((current) => !current)}
                    className="inline-flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2.5 text-left text-sm font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
                  >
                    <span>{notesMetaOpen ? "Hide notes and metadata" : "Show notes and metadata"}</span>
                    <AppIcon icon={ChevronDown} size={ICON_SM} className={notesMetaOpen ? "rotate-180 transition" : "transition"} />
                  </button>

                  {notesMetaOpen ? (
                    <div className="mt-3 grid gap-3">
                      <textarea className={input} rows={4} placeholder="Internal notes" value={draft.notes} onChange={(e) => updateDraft({ notes: e.target.value })} />
                      <div className="grid gap-3">
                        {metadataRows.map((row) => (
                          <div key={row.id} className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
                            <input className={input} placeholder="Key" value={row.key} onChange={(e) => setMetadataRows((current) => current.map((item) => item.id === row.id ? { ...item, key: e.target.value } : item))} />
                            <input className={input} placeholder="Value" value={row.value} onChange={(e) => setMetadataRows((current) => current.map((item) => item.id === row.id ? { ...item, value: e.target.value } : item))} />
                            <button type="button" onClick={() => setMetadataRows((current) => current.filter((item) => item.id !== row.id).length ? current.filter((item) => item.id !== row.id) : [{ id: makeId("meta"), key: "", value: "" }])} className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700">
                              <AppIcon icon={Trash2} size={ICON_SM} />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => setMetadataRows((current) => [...current, { id: makeId("meta"), key: "", value: "" }])} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700">
                          <AppIcon icon={Plus} size={ICON_SM} />
                          Add Metadata Row
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      Keep this collapsed unless you need admin-only notes or extra metadata.
                    </div>
                  )}
                </Section>

                <div className={`${card} flex items-center justify-between gap-3`}>
                  <div className="text-sm text-zinc-600 dark:text-zinc-300">
                    This record drives preferred-agent validation, admin partner binding, and partner-aware routing.
                  </div>
                  <button type="button" onClick={() => void saveDraft()} disabled={busy === "save"} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
                    <AppIcon icon={Save} size={ICON_SM} />
                    {busy === "save" ? "Saving..." : "Save Partner"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className={`mt-5 ${card}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Partners ({activeCount} active / {partners.length} total)
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Home-country eligibility is applied before branch/county routing.
                  </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <label className="relative block w-full sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search partners" className="w-full rounded-2xl border border-zinc-200 bg-white/85 py-3 pl-9 pr-4 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100" />
                  </label>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100">
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-800">
                    <AppIcon icon={Plus} size={ICON_SM} />
                    Create
                  </button>
                </div>
              </div>
            </div>

            {loading ? <div className={`mt-4 ${card}`}>Loading partners...</div> : null}
            {!loading && filteredPartners.length === 0 ? <div className={`mt-4 ${card}`}>No partners found.</div> : null}
            {!loading && filteredPartners.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {filteredPartners.map((partner) => {
                  const activeBusy = busy === `active:${partner?.id || ""}`;
                  return (
                    <div key={partner.id} className={card}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {partner.displayName || "Untitled Partner"}
                            </div>
                            <MetaPill active={partner.isActive !== false}>
                              {partner.isActive !== false ? "Active" : "Inactive"}
                            </MetaPill>
                            {partner.internalName ? <MetaPill>{partner.internalName}</MetaPill> : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <MetaPill>Tracks: {(partner?.supportedTracks || []).map((track) => APP_TRACK_META[track]?.label || track).join(", ") || "None"}</MetaPill>
                            <MetaPill>
                              Home Countries: {(partner?.homeCountries || []).join(", ") || "None"}
                            </MetaPill>
                            <MetaPill>Countries: {(partner?.supportedCountries || []).length}</MetaPill>
                            <MetaPill>Counties: {(partner?.supportedCounties || []).length}</MetaPill>
                            <MetaPill>Branches: {(partner?.branches || []).length}</MetaPill>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:w-[280px] lg:justify-end">
                          <button type="button" onClick={() => openEdit(partner)} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700">
                            <AppIcon icon={Pencil} size={ICON_SM} />
                            Edit
                          </button>
                          <button type="button" onClick={() => void toggleActive(partner)} disabled={activeBusy} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-60">
                            <AppIcon icon={partner.isActive ? ShieldOff : ShieldCheck} size={ICON_SM} />
                            {activeBusy ? "Updating..." : partner.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

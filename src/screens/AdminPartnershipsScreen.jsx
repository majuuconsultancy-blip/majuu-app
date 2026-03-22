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
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { subscribeAllCountries } from "../services/countryService";
import {
  createEmptyPartnerDraft,
  createPartner,
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

function makeBranch() {
  return {
    id: makeId("branch"),
    name: "",
    country: "",
    county: "",
    town: "",
    address: "",
    notes: "",
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
    setDraft((current) => ({
      ...current,
      branches: (current?.branches || []).map((branch) =>
        branch?.id === branchId ? { ...branch, ...(patch || {}) } : branch
      ),
    }));
  };

  const openCreate = () => {
    setErr("");
    setMsg("");
    setEditingId("");
    setDraft(createEmptyPartnerDraft());
    setMetadataRows(metaRowsFromObject({}));
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
    setDraft({ ...draftFromPartner(partner), branches: partner?.branches || [] });
    setMetadataRows(metaRowsFromObject(partner?.metadata));
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
              County-based partner coverage for request routing, preferred agents, and admin binding.
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
                        Partner onboarding, county coverage, optional branches, and internal metadata.
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

                <Section title="County Coverage" subtitle="This is the routing source of truth for the partner.">
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

                <Section title="Branch Metadata" subtitle="Optional physical offices or liaison points under this partner.">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    Branches are internal reference points only. They do not expand routing coverage. Routing still comes from the county coverage above, and branch country means the branch's physical country.
                  </div>
                  <div className="grid gap-3">
                    {(draft?.branches || []).map((branch, index) => (
                      <div key={branch?.id || index} className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Branch {index + 1}</div>
                          <button type="button" onClick={() => updateDraft({ branches: (draft?.branches || []).filter((item) => item?.id !== branch?.id) })} className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-semibold text-rose-700">
                            <AppIcon icon={Trash2} size={ICON_SM} />
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          <input className={input} placeholder="Branch name" value={branch?.name || ""} onChange={(e) => updateBranch(branch?.id, { name: e.target.value })} />
                          <select className={input} value={branch?.country || ""} onChange={(e) => updateBranch(branch?.id, { country: e.target.value })}>
                            <option value="">
                              {activeCountries.length ? "Select branch country" : "No active countries"}
                            </option>
                            {activeCountries.map((country) => <option key={`branch-country-${country}`} value={country}>{country}</option>)}
                          </select>
                          <select className={input} value={branch?.county || ""} onChange={(e) => updateBranch(branch?.id, { county: e.target.value })} disabled={(draft?.supportedCounties || []).length === 0}>
                            <option value="">
                              {(draft?.supportedCounties || []).length ? "Select branch county" : "Select county coverage first"}
                            </option>
                            {(draft?.supportedCounties || []).map((county) => <option key={`branch-${county}`} value={county}>{county}</option>)}
                          </select>
                          <input className={input} placeholder="Town / City" value={branch?.town || ""} onChange={(e) => updateBranch(branch?.id, { town: e.target.value })} />
                          <textarea className={input} rows={2} placeholder="Address" value={branch?.address || ""} onChange={(e) => updateBranch(branch?.id, { address: e.target.value })} />
                          <textarea className={input} rows={2} placeholder="Branch notes" value={branch?.notes || ""} onChange={(e) => updateBranch(branch?.id, { notes: e.target.value })} />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => updateDraft({ branches: [...(draft?.branches || []), makeBranch()] })} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-2.5 text-sm font-semibold text-emerald-800">
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
                    County coverage is the routing source of truth.
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

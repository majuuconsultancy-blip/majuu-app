import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { managerHasModuleAccess } from "../services/managerModules";
import {
  createEmptySelfHelpResourceDraft,
  createSelfHelpResource,
  draftFromSelfHelpResource,
  getSelfHelpResourceCategoryLabel,
  getSelfHelpResourceTrackLabel,
  importBundledSelfHelpResources,
  SELF_HELP_RESOURCE_ALL_TRACKS,
  SELF_HELP_RESOURCE_CATEGORY_OPTIONS,
  SELF_HELP_RESOURCE_GLOBAL_COUNTRY,
  SELF_HELP_RESOURCE_TRACK_OPTIONS,
  setSelfHelpResourceActiveState,
  subscribeAllSelfHelpResources,
  updateSelfHelpResource,
} from "../services/selfHelpResourceService";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function formatClicks(value) {
  return Number(value || 0).toLocaleString();
}

function matchesSearch(item, search) {
  const needle = safeString(search, 120).toLowerCase();
  if (!needle) return true;

  return [
    item?.title,
    item?.description,
    item?.providerName,
    item?.country,
    getSelfHelpResourceTrackLabel(item?.trackType),
    getSelfHelpResourceCategoryLabel(item?.category),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function typeTone(resource) {
  if (resource?.isAffiliate) {
    return "border-fuchsia-200 bg-fuchsia-50/80 text-fuchsia-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/25 dark:text-fuchsia-200";
  }
  if (resource?.isOfficial) {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200";
  }
  return "border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
}

function getTypeLabel(resource) {
  if (resource?.isAffiliate) return "Affiliate";
  if (resource?.isOfficial) return "Official";
  return "Direct";
}

export default function AdminSelfHelpLinksManagementScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [hasAffiliateAccess, setHasAffiliateAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(createEmptySelfHelpResourceDraft());
  const [busy, setBusy] = useState("");

  const trackTypeForCountries =
    safeString(draft?.trackType, 40) === SELF_HELP_RESOURCE_ALL_TRACKS ? "" : draft?.trackType || "";
  const { countries: managedCountriesForTrack, hasManagedDocs: hasManagedCountries } =
    useManagedDestinationCountries({ trackType: trackTypeForCountries });

  const countryOptions = useMemo(() => {
    const baseCountries = [
      SELF_HELP_RESOURCE_GLOBAL_COUNTRY,
      ...(Array.isArray(managedCountriesForTrack) ? managedCountriesForTrack : []),
    ];
    const seen = new Set(baseCountries.map((country) => safeString(country, 120).toLowerCase()));

    const currentCountry = safeString(draft?.country, 120);
    const needsLegacyOption =
      currentCountry && !seen.has(safeString(currentCountry, 120).toLowerCase());

    const legacyOption = needsLegacyOption
      ? [{ value: currentCountry, label: `${currentCountry} (legacy/inactive)` }]
      : [];
    const activeOptions = baseCountries.map((country) => ({
      value: country,
      label: country,
    }));

    if (!hasManagedCountries) return activeOptions;
    return [...legacyOption, ...activeOptions];
  }, [draft?.country, hasManagedCountries, managedCountriesForTrack]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext();
        if (cancelled) return;
        const canAccess =
          Boolean(roleCtx?.isSuperAdmin) ||
          (Boolean(roleCtx?.isManager) &&
            managerHasModuleAccess(roleCtx?.managerScope, "selfhelp-links"));
        setHasAffiliateAccess(canAccess);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setHasAffiliateAccess(false);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasAffiliateAccess) return undefined;

    setLoading(true);
    setErr("");

    return subscribeAllSelfHelpResources({
      onData: (rows) => {
        setItems(rows);
        setLoading(false);
      },
      onError: (error) => {
        setItems([]);
        setErr(error?.message || "Failed to load SelfHelp links.");
        setLoading(false);
      },
    });
  }, [hasAffiliateAccess]);

  const filteredItems = useMemo(
    () => items.filter((item) => matchesSearch(item, search)),
    [items, search]
  );
  const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items]);
  const featuredCount = useMemo(() => items.filter((item) => item.isFeatured).length, [items]);

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...(patch || {}) }));
  };

  const openCreate = () => {
    setErr("");
    setMsg("");
    setEditingId("");
    setDraft(createEmptySelfHelpResourceDraft());
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (item) => {
    setErr("");
    setMsg("");
    setEditingId(item?.id || "");
    setDraft(draftFromSelfHelpResource(item));
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    if (busy) return;
    setFormOpen(false);
    setEditingId("");
    setDraft(createEmptySelfHelpResourceDraft());
  };

  const saveDraft = async () => {
    setBusy("save");
    setErr("");
    setMsg("");
    try {
      if (editingId) {
        await updateSelfHelpResource(editingId, draft);
        setMsg("SelfHelp link updated.");
      } else {
        await createSelfHelpResource(draft);
        setMsg("SelfHelp link created.");
      }
      setFormOpen(false);
      setEditingId("");
      setDraft(createEmptySelfHelpResourceDraft());
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save SelfHelp link.");
    } finally {
      setBusy("");
    }
  };

  const toggleActive = async (item) => {
    const actionKey = `active:${item?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");
    try {
      const nextActiveState = !item?.isActive;
      await setSelfHelpResourceActiveState(item?.id, nextActiveState);
      setMsg(nextActiveState ? "Resource enabled." : "Resource disabled.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update resource status.");
    } finally {
      setBusy("");
    }
  };

  const toggleFeatured = async (item) => {
    const actionKey = `featured:${item?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");
    try {
      await updateSelfHelpResource(item?.id, { ...item, isFeatured: !item?.isFeatured });
      setMsg(item?.isFeatured ? "Featured flag removed." : "Marked as featured.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update featured flag.");
    } finally {
      setBusy("");
    }
  };

  const importBundled = async () => {
    setBusy("import");
    setErr("");
    setMsg("");
    try {
      const result = await importBundledSelfHelpResources({ onlyMissing: true });
      setMsg(
        result.importedCount > 0
          ? `Imported ${result.importedCount} bundled SelfHelp links into Firestore.`
          : "Bundled SelfHelp links were already imported."
      );
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to import bundled SelfHelp links.");
    } finally {
      setBusy("");
    }
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const label = "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Link2} size={ICON_SM} />
              Affiliate Management
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC Affiliate Management
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
              Manage affiliate and self-help outbound resources by track, country, and category.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin/sacc")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/70 text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
            aria-label="Back"
            title="Back"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !hasAffiliateAccess ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            You do not have access to Affiliate Management.
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
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Resource inventory
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Import the current bundled SelfHelp catalog once, then manage live links here.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      {items.length} total
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      {activeCount} active
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50/80 px-3 py-1.5 font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                      {featuredCount} featured
                    </span>
                  </div>
                </div>

                <div className="flex w-full max-w-xl flex-col gap-3 sm:flex-row sm:items-center">
                  <label className="relative block min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search title, provider, country, category, or track"
                      className="w-full rounded-2xl border border-zinc-200 bg-white/85 py-3 pl-9 pr-4 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void importBundled()}
                    disabled={busy === "import"}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                  >
                    <AppIcon icon={RefreshCcw} size={ICON_SM} />
                    {busy === "import" ? "Importing..." : "Import Current Catalog"}
                  </button>
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                  >
                    <AppIcon icon={Plus} size={ICON_SM} />
                    Add Resource
                  </button>
                </div>
              </div>
            </div>

            {formOpen ? (
              <div className={`mt-4 ${card}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {editingId ? "Edit SelfHelp Resource" : "Create SelfHelp Resource"}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Track, country, category, provider, URLs, flags, and sort order are the core
                      management fields.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={Boolean(busy)}
                    className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className={label}>Title</span>
                      <input className={input} value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Flights to Canada" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className={label}>Provider Name</span>
                      <input className={input} value={draft.providerName} onChange={(event) => updateDraft({ providerName: event.target.value })} placeholder="Skyscanner" />
                    </label>
                  </div>

                  <label className="grid gap-1.5">
                    <span className={label}>Description</span>
                    <textarea className={`${input} min-h-24 resize-y`} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Short operator-facing note or user-facing description" />
                  </label>

                  <div className="grid gap-3 lg:grid-cols-3">
                    <label className="grid gap-1.5">
                      <span className={label}>Track Type</span>
                      <select className={input} value={draft.trackType} onChange={(event) => updateDraft({ trackType: event.target.value })}>
                        {SELF_HELP_RESOURCE_TRACK_OPTIONS.map((trackType) => (
                          <option key={trackType} value={trackType}>
                            {getSelfHelpResourceTrackLabel(trackType)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className={label}>Country</span>
                      <select className={input} value={draft.country} onChange={(event) => updateDraft({ country: event.target.value })}>
                        {countryOptions.map((country) => (
                          <option key={country.value} value={country.value}>
                            {country.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1.5">
                      <span className={label}>Category</span>
                      <select className={input} value={draft.category} onChange={(event) => updateDraft({ category: event.target.value })}>
                        {SELF_HELP_RESOURCE_CATEGORY_OPTIONS.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className={label}>Base URL</span>
                      <input className={input} value={draft.baseUrl} onChange={(event) => updateDraft({ baseUrl: event.target.value })} placeholder="https://..." />
                    </label>
                    <label className="grid gap-1.5">
                      <span className={label}>Affiliate URL</span>
                      <input className={input} value={draft.affiliateUrl} onChange={(event) => updateDraft({ affiliateUrl: event.target.value })} placeholder="https://..." />
                    </label>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <label className="grid gap-1.5">
                      <span className={label}>Sort Order</span>
                      <input type="number" min={0} max={100000} className={input} value={draft.sortOrder} onChange={(event) => updateDraft({ sortOrder: event.target.value })} />
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">Higher values float higher inside SelfHelp lists.</div>
                    </label>
                    <div className="grid gap-2">
                      <span className={label}>Flags</span>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          ["isActive", "Active"],
                          ["isFeatured", "Featured"],
                          ["isOfficial", "Official"],
                          ["isAffiliate", "Affiliate"],
                          ["supportsSmartParams", "Smart-ready"],
                        ].map(([key, text]) => (
                          <label key={key} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                            <input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => updateDraft({ [key]: event.target.checked })} />
                            {text}
                          </label>
                        ))}
                        <div className="flex items-center rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-200">
                          Clicks: {formatClicks(draft.clickCount)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={busy === "save"}
                    className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                  >
                    <AppIcon icon={Save} size={ICON_SM} />
                    {busy === "save" ? "Saving..." : editingId ? "Save Changes" : "Create Resource"}
                  </button>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className={`mt-4 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading SelfHelp links...
              </div>
            ) : !filteredItems.length ? (
              <div className={`mt-4 ${card}`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {items.length ? "No links match the current search." : "No SelfHelp links yet."}
                </div>
                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {items.length
                    ? "Try a broader search or create a new link."
                    : "Import the bundled catalog or create the first resource record from this screen."}
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {filteredItems.map((item) => {
                  const activeBusy = busy === `active:${item.id}`;
                  const featuredBusy = busy === `featured:${item.id}`;
                  const primaryUrl = item.isAffiliate && item.affiliateUrl ? item.affiliateUrl : item.baseUrl;

                  return (
                    <div key={item.id} className={`${card} p-0`}>
                      <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</div>
                            {item.isFeatured ? <span className="rounded-full border border-amber-200 bg-amber-50/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">Featured</span> : null}
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${item.isActive ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200" : "border-zinc-200 bg-zinc-50/80 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"}`}>{item.isActive ? "Active" : "Disabled"}</span>
                          </div>
                          {item.description ? <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{item.description}</div> : null}
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">{getSelfHelpResourceTrackLabel(item.trackType)}</span>
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">{item.country}</span>
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">{getSelfHelpResourceCategoryLabel(item.category)}</span>
                            <span className={`rounded-full border px-2.5 py-1 font-semibold ${typeTone(item)}`}>{getTypeLabel(item)}</span>
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">{item.providerName}</span>
                            {item.supportsSmartParams ? <span className="rounded-full border border-zinc-200 bg-zinc-50/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-200">Smart-ready</span> : null}
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">Clicks {formatClicks(item.clickCount)}</span>
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">Sort {item.sortOrder}</span>
                          </div>
                          <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{safeString(primaryUrl, 160)}</div>
                        </div>

                        <div className="flex flex-wrap gap-2 lg:w-[280px] lg:justify-end">
                          <button type="button" onClick={() => openEdit(item)} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                            <AppIcon icon={Pencil} size={ICON_SM} />
                            Edit
                          </button>
                          <button type="button" onClick={() => void toggleFeatured(item)} disabled={featuredBusy} className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-3.5 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 active:scale-[0.99] disabled:opacity-60 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                            <AppIcon icon={Sparkles} size={ICON_SM} />
                            {featuredBusy ? "Updating..." : item.isFeatured ? "Unfeature" : "Feature"}
                          </button>
                          <button type="button" onClick={() => void toggleActive(item)} disabled={activeBusy} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                            <AppIcon icon={ShieldCheck} size={ICON_SM} />
                            {activeBusy ? "Updating..." : item.isActive ? "Disable" : "Enable"}
                          </button>
                          <a href={primaryUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                            <AppIcon icon={ExternalLink} size={ICON_SM} />
                            Open
                          </a>
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

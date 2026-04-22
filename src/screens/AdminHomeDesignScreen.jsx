import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ImagePlus,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, APP_TRACK_OPTIONS } from "../constants/migrationOptions";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  createEmptyHomeDesignFeaturedCountryDraft,
  createEmptyHomeDesignModuleDraft,
  createHomeDesignModule,
  draftFromHomeDesignModule,
  HOME_DESIGN_DEFAULT_CONTEXT,
  setHomeDesignModuleActiveState,
  subscribeAllHomeDesignModules,
  updateHomeDesignModule,
} from "../services/homeDesignService";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function MetaPill({ children, tone = "default" }) {
  const cls =
    tone === "active"
      ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
      : tone === "inactive"
      ? "border-zinc-200 bg-zinc-50/80 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
      : "border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function FeaturedCountryEditor({
  entry,
  index,
  isTop,
  isBottom,
  countryOptions,
  labelClassName,
  inputClassName,
  onChange,
  onMove,
  onRemove,
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Featured country #{index + 1}
        </div>
        <MetaPill tone={entry.isActive ? "active" : "inactive"}>
          {entry.isActive ? "Active" : "Inactive"}
        </MetaPill>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="grid gap-1.5">
          <span className={labelClassName}>Country</span>
          <select
            className={inputClassName}
            value={entry.country}
            onChange={(event) =>
              onChange({
                country: event.target.value,
                label: entry.label || event.target.value,
              })
            }
          >
            <option value="">Select country</option>
            {countryOptions.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className={labelClassName}>Display Label</span>
          <input
            className={inputClassName}
            value={entry.label}
            onChange={(event) => onChange({ label: event.target.value })}
            placeholder="Use a shorter card title if needed"
          />
        </label>

        <label className="grid gap-1.5">
          <span className={labelClassName}>Eyebrow</span>
          <input
            className={inputClassName}
            value={entry.eyebrow}
            onChange={(event) => onChange({ eyebrow: event.target.value })}
            placeholder="Featured destination"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={labelClassName}>Meta Label</span>
            <input
              className={inputClassName}
              value={entry.metaLabel}
              onChange={(event) => onChange({ metaLabel: event.target.value })}
              placeholder="Approval rate"
            />
          </label>

          <label className="grid gap-1.5">
            <span className={labelClassName}>Meta Value</span>
            <input
              className={inputClassName}
              value={entry.metaValue}
              onChange={(event) => onChange({ metaValue: event.target.value })}
              placeholder="84%"
            />
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className={labelClassName}>Flag Override</span>
          <input
            className={inputClassName}
            value={entry.flagOverride}
            onChange={(event) => onChange({ flagOverride: event.target.value })}
            placeholder="Optional emoji flag"
          />
        </label>

      </div>

      <label className="mt-3 grid gap-1.5">
        <span className={labelClassName}>Description</span>
        <textarea
          className={`${inputClassName} min-h-[90px] resize-y`}
          value={entry.description}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="Short context for why this destination is featured."
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <label className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
          <input
            type="checkbox"
            checked={Boolean(entry.isActive)}
            onChange={(event) => onChange({ isActive: event.target.checked })}
          />
          Entry active
        </label>

        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={isTop}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
        >
          <AppIcon icon={ArrowUp} size={ICON_SM} />
          Up
        </button>

        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={isBottom}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
        >
          <AppIcon icon={ArrowDown} size={ICON_SM} />
          Down
        </button>

        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200"
        >
          <AppIcon icon={Trash2} size={ICON_SM} />
          Remove
        </button>
      </div>
    </div>
  );
}

export default function AdminHomeDesignScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(createEmptyHomeDesignModuleDraft());

  const { countries: managedCountries } = useManagedDestinationCountries({
    trackType: draft.trackType,
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

    setLoading(true);
    setErr("");

    return subscribeAllHomeDesignModules({
      onData: (rows) => {
        setModules(Array.isArray(rows) ? rows : []);
        setLoading(false);
      },
      onError: (error) => {
        console.error(error);
        setModules([]);
        setErr(error?.message || "Failed to load home design modules.");
        setLoading(false);
      },
    });
  }, [isSuperAdmin]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const label =
    "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  const countryOptions = useMemo(
    () =>
      (Array.isArray(managedCountries) ? managedCountries : []).map((country) => ({
        value: country,
        label: country,
      })),
    [managedCountries]
  );

  const activeCount = useMemo(
    () => modules.filter((module) => module.isActive).length,
    [modules]
  );

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...(patch || {}) }));
  };

  const updateFeaturedCountry = (entryId, patch) => {
    setDraft((current) => ({
      ...current,
      featuredCountries: (Array.isArray(current?.featuredCountries)
        ? current.featuredCountries
        : []
      ).map((entry) => (entry.id === entryId ? { ...entry, ...(patch || {}) } : entry)),
    }));
  };

  const addFeaturedCountry = () => {
    setDraft((current) => ({
      ...current,
      featuredCountries: [
        ...(Array.isArray(current?.featuredCountries) ? current.featuredCountries : []),
        {
          ...createEmptyHomeDesignFeaturedCountryDraft(),
          id: `featured_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        },
      ],
    }));
  };

  const removeFeaturedCountry = (entryId) => {
    setDraft((current) => ({
      ...current,
      featuredCountries: (Array.isArray(current?.featuredCountries)
        ? current.featuredCountries
        : []
      ).filter((entry) => entry.id !== entryId),
    }));
  };

  const moveFeaturedCountry = (entryId, direction) => {
    setDraft((current) => {
      const entries = [...(Array.isArray(current?.featuredCountries) ? current.featuredCountries : [])];
      const index = entries.findIndex((entry) => entry.id === entryId);
      if (index < 0) return current;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= entries.length) return current;
      const reordered = [...entries];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(nextIndex, 0, moved);
      return { ...current, featuredCountries: reordered };
    });
  };

  const openCreate = () => {
    setErr("");
    setMsg("");
    setEditingId("");
    setDraft(createEmptyHomeDesignModuleDraft());
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (module) => {
    setErr("");
    setMsg("");
    setEditingId(module?.id || "");
    setDraft(draftFromHomeDesignModule(module));
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    if (busy === "save") return;
    setFormOpen(false);
    setEditingId("");
    setDraft(createEmptyHomeDesignModuleDraft());
  };

  const saveDraft = async () => {
    setBusy("save");
    setErr("");
    setMsg("");

    try {
      if (editingId) {
        await updateHomeDesignModule(editingId, draft);
        setMsg("Home design module updated.");
      } else {
        await createHomeDesignModule(draft);
        setMsg("Home design module created.");
      }

      setFormOpen(false);
      setEditingId("");
      setDraft(createEmptyHomeDesignModuleDraft());
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save home design module.");
    } finally {
      setBusy("");
    }
  };

  const toggleModuleActive = async (module) => {
    const actionKey = `active:${module?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");

    try {
      const nextState = !module?.isActive;
      await setHomeDesignModuleActiveState(module?.id, nextState);
      setMsg(nextState ? "Home design module activated." : "Home design module deactivated.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update home design status.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={pageBg}>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={ImagePlus} size={ICON_SM} />
              Home Design
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC Home Design
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
              Manage featured countries, messaging, and visual layout settings from one place.
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
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage home design modules.
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
                    Home layout inventory
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Each track can have multiple contexts, like default, study, or travel campaign
                    variants, with one active module per track + context pair.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      {modules.length} total
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      {activeCount} active
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                >
                  <AppIcon icon={Plus} size={ICON_SM} />
                  New Module
                </button>
              </div>
            </div>

            {formOpen ? (
              <div className={`mt-4 ${card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {editingId ? "Edit Home Design" : "Create Home Design"}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Featured countries here feed the Track screen carousel directly.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={busy === "save"}
                    className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                  >
                    <AppIcon icon={X} size={ICON_SM} />
                    Close
                  </button>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
                  <label className="grid gap-1.5">
                    <span className={label}>Module Title</span>
                    <input
                      className={input}
                      value={draft.title}
                      onChange={(event) => updateDraft({ title: event.target.value })}
                      placeholder="Study Home Design"
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className={label}>Track</span>
                    <select
                      className={input}
                      value={draft.trackType}
                      onChange={(event) => updateDraft({ trackType: event.target.value })}
                    >
                      {APP_TRACK_OPTIONS.map((track) => (
                        <option key={track} value={track}>
                          {APP_TRACK_META[track]?.label || track}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1.5">
                    <span className={label}>Context Key</span>
                    <input
                      className={input}
                      value={draft.contextKey}
                      onChange={(event) => updateDraft({ contextKey: event.target.value })}
                      placeholder={HOME_DESIGN_DEFAULT_CONTEXT}
                    />
                  </label>
                </div>

                <label className="mt-3 grid gap-1.5">
                  <span className={label}>Subtitle</span>
                  <textarea
                    className={`${input} min-h-[90px] resize-y`}
                    value={draft.subtitle}
                    onChange={(event) => updateDraft({ subtitle: event.target.value })}
                    placeholder="Short supporting copy for the carousel section."
                  />
                </label>

                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                    <AppIcon icon={ShieldCheck} size={ICON_SM} />
                    Carousel Context
                  </div>
                  <div className="mt-2 text-sm text-emerald-900/90 dark:text-emerald-100/90">
                    Use the same track with different context keys when you need alternate featured
                    country groups for future campaign or mode-specific layouts.
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.isActive)}
                      onChange={(event) => updateDraft({ isActive: event.target.checked })}
                    />
                    Module is active
                  </label>
                </div>

                <div className="mt-5 rounded-3xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/25">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Featured Countries
                      </div>
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        These cards power the top countries carousel on the Track screen.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={addFeaturedCountry}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                    >
                      <AppIcon icon={Plus} size={ICON_SM} />
                      Add Country
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {!draft.featuredCountries?.length ? (
                      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                        Add featured countries with metadata like approval rate or visa timeline.
                      </div>
                    ) : (
                      draft.featuredCountries.map((entry, index) => (
                        <FeaturedCountryEditor
                          key={entry.id || `${entry.country}-${index}`}
                          entry={entry}
                          index={index}
                          isTop={index === 0}
                          isBottom={index === draft.featuredCountries.length - 1}
                          countryOptions={countryOptions}
                          labelClassName={label}
                          inputClassName={input}
                          onChange={(patch) => updateFeaturedCountry(entry.id, patch)}
                          onMove={(direction) => moveFeaturedCountry(entry.id, direction)}
                          onRemove={() => removeFeaturedCountry(entry.id)}
                        />
                      ))
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={busy === "save"}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <AppIcon icon={Save} size={ICON_SM} />
                  {busy === "save"
                    ? "Saving..."
                    : editingId
                    ? "Save Home Design"
                    : "Create Home Design"}
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className={`mt-4 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading home design modules...
              </div>
            ) : !modules.length ? (
              <div className={`mt-4 ${card}`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  No home design modules yet.
                </div>
                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Create the first module to control the Track screen carousel from SACC.
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {modules.map((module) => {
                  const activeBusy = busy === `active:${module.id}`;
                  return (
                    <div key={module.id} className={`${card} ${module.isActive ? "" : "opacity-90"}`}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {module.title}
                            </div>
                            <MetaPill tone={module.isActive ? "active" : "inactive"}>
                              {module.isActive ? "Active" : "Inactive"}
                            </MetaPill>
                            <MetaPill>{APP_TRACK_META[module.trackType]?.label || module.trackType}</MetaPill>
                            <MetaPill>Context: {module.contextKey || HOME_DESIGN_DEFAULT_CONTEXT}</MetaPill>
                          </div>

                          {module.subtitle ? (
                            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                              {module.subtitle}
                            </div>
                          ) : null}

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <MetaPill>
                              Featured: {module.activeFeaturedCountryCount} active / {module.featuredCountryCount} total
                            </MetaPill>
                          </div>

                          {module.featuredCountries?.length ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {module.featuredCountries.slice(0, 4).map((entry) => (
                                <span
                                  key={`${module.id}-${entry.id}`}
                                  className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                                >
                                  {safeString(entry.label || entry.country, 80)}
                                </span>
                              ))}
                              {module.featuredCountries.length > 4 ? (
                                <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                                  +{module.featuredCountries.length - 4} more
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-2 lg:w-[260px] lg:justify-end">
                          <button
                            type="button"
                            onClick={() => openEdit(module)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            <AppIcon icon={Pencil} size={ICON_SM} />
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => void toggleModuleActive(module)}
                            disabled={activeBusy}
                            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            <AppIcon icon={module.isActive ? ShieldOff : ShieldCheck} size={ICON_SM} />
                            {activeBusy
                              ? "Updating..."
                              : module.isActive
                              ? "Deactivate"
                              : "Activate"}
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

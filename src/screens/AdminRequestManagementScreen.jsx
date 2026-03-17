import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileText,
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
import { APP_TRACK_META, normalizeDestinationCountry } from "../constants/migrationOptions";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  createEmptyRequestDefinitionDraft,
  createEmptyRequestExtraFieldDraft,
  createRequestDefinition,
  draftFromRequestDefinition,
  getRequestDefinitionTrackLabel,
  REQUEST_EXTRA_FIELD_TYPE_OPTIONS,
  setRequestDefinitionActiveState,
  subscribeAllRequestDefinitions,
  updateRequestDefinition,
} from "../services/requestDefinitionService";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeParagraph(value, max = 320) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function matchesDefinitionSearch(definition, search) {
  const needle = safeString(search, 120).toLowerCase();
  if (!needle) return true;

  return [
    definition?.title,
    definition?.country,
    getRequestDefinitionTrackLabel(definition?.trackType),
    ...(Array.isArray(definition?.extraFields)
      ? definition.extraFields.map((field) => field?.label)
      : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function formatFieldType(type) {
  const safeType = safeString(type, 20).toLowerCase();
  if (safeType === "textarea") return "Textarea";
  if (safeType === "number") return "Number";
  if (safeType === "document") return "Document";
  return "Text";
}

function applyFieldOrder(fields = []) {
  return fields.map((field, index) => ({
    ...field,
    sortOrder: index + 1,
  }));
}

function FieldMetaPill({ children, tone = "default" }) {
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

export default function AdminRequestManagementScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [definitions, setDefinitions] = useState([]);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(createEmptyRequestDefinitionDraft());
  const [busy, setBusy] = useState("");

  const [fieldEditorOpen, setFieldEditorOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState("");
  const [fieldDraft, setFieldDraft] = useState(createEmptyRequestExtraFieldDraft());
  const [fieldErr, setFieldErr] = useState("");

  const { countries: managedCountriesForTrack, hasManagedDocs: hasManagedCountries } =
    useManagedDestinationCountries({ trackType: draft.trackType });

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

    return subscribeAllRequestDefinitions({
      onData: (rows) => {
        setDefinitions(rows);
        setLoading(false);
      },
      onError: (error) => {
        console.error(error);
        setDefinitions([]);
        setErr(error?.message || "Failed to load request definitions.");
        setLoading(false);
      },
    });
  }, [isSuperAdmin]);

  const filteredDefinitions = useMemo(
    () => definitions.filter((definition) => matchesDefinitionSearch(definition, search)),
    [definitions, search]
  );
  const activeCount = useMemo(
    () => definitions.filter((definition) => definition.isActive).length,
    [definitions]
  );

  const countryOptions = useMemo(() => {
    const activeList = Array.isArray(managedCountriesForTrack) ? managedCountriesForTrack : [];
    const activeSet = new Set(activeList.map((country) => safeString(country, 120).toLowerCase()));

    const currentCountry =
      normalizeDestinationCountry(draft.country) || safeString(draft.country, 120);
    const needsLegacyOption =
      currentCountry && !activeSet.has(safeString(currentCountry, 120).toLowerCase());

    const legacyOption = needsLegacyOption
      ? [{ value: currentCountry, label: `${currentCountry} (legacy/inactive)` }]
      : [];
    const activeOptions = activeList.map((country) => ({
      value: country,
      label: country,
    }));

    if (!hasManagedCountries) return activeOptions;
    return [...legacyOption, ...activeOptions];
  }, [draft.country, hasManagedCountries, managedCountriesForTrack]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const label = "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...(patch || {}) }));
  };

  const updateFieldDraft = (patch) => {
    setFieldDraft((current) => ({ ...current, ...(patch || {}) }));
  };

  const resetFieldEditor = () => {
    setEditingFieldId("");
    setFieldErr("");
    setFieldDraft(createEmptyRequestExtraFieldDraft());
    setFieldEditorOpen(false);
  };

  const openCreate = () => {
    setErr("");
    setMsg("");
    setEditingId("");
    setDraft(createEmptyRequestDefinitionDraft());
    resetFieldEditor();
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (definition) => {
    setErr("");
    setMsg("");
    setEditingId(definition?.id || "");
    setDraft(draftFromRequestDefinition(definition));
    resetFieldEditor();
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    if (busy === "save") return;
    setFormOpen(false);
    setEditingId("");
    setDraft(createEmptyRequestDefinitionDraft());
    resetFieldEditor();
  };

  const openAddField = () => {
    setFieldErr("");
    setEditingFieldId("");
    setFieldDraft(createEmptyRequestExtraFieldDraft());
    setFieldEditorOpen(true);
  };

  const openEditField = (field) => {
    setFieldErr("");
    setEditingFieldId(field?.id || "");
    setFieldDraft({
      ...field,
      minLength: field?.minLength > 0 ? String(field.minLength) : "",
      maxLength: field?.maxLength > 0 ? String(field.maxLength) : "",
      sortOrder: String(field?.sortOrder || ""),
    });
    setFieldEditorOpen(true);
  };

  const saveFieldDraft = () => {
    const labelText = safeString(fieldDraft.label, 120);
    const helperText = safeParagraph(fieldDraft.helperText, 240);
    const placeholder =
      safeString(fieldDraft.type, 20).toLowerCase() === "document"
        ? ""
        : safeString(fieldDraft.placeholder, 120);
    const minLength = fieldDraft.minLength === "" ? 0 : Number(fieldDraft.minLength);
    const maxLength = fieldDraft.maxLength === "" ? 0 : Number(fieldDraft.maxLength);

    if (!labelText) {
      setFieldErr("Field label is required.");
      return;
    }

    if (!Number.isFinite(minLength) || minLength < 0) {
      setFieldErr("Minimum length must be 0 or more.");
      return;
    }

    if (!Number.isFinite(maxLength) || maxLength < 0) {
      setFieldErr("Maximum length must be 0 or more.");
      return;
    }

    if (maxLength > 0 && minLength > maxLength) {
      setFieldErr("Minimum length cannot be greater than maximum length.");
      return;
    }

    const nextField = {
      ...fieldDraft,
      id: safeString(fieldDraft.id, 80) || `field_${Date.now().toString(36)}`,
      label: labelText,
      placeholder,
      helperText,
      minLength:
        safeString(fieldDraft.type, 20).toLowerCase() === "document"
          ? ""
          : minLength > 0
          ? String(Math.round(minLength))
          : "",
      maxLength:
        safeString(fieldDraft.type, 20).toLowerCase() === "document"
          ? ""
          : maxLength > 0
          ? String(Math.round(maxLength))
          : "",
      digitsOnly:
        safeString(fieldDraft.type, 20).toLowerCase() === "document"
          ? false
          : Boolean(fieldDraft.digitsOnly),
      required: Boolean(fieldDraft.required),
      isActive: Boolean(fieldDraft.isActive),
    };

    setDraft((current) => {
      const currentFields = Array.isArray(current?.extraFields) ? current.extraFields : [];
      const existingIndex = currentFields.findIndex((field) => field.id === editingFieldId);
      const nextFields =
        existingIndex >= 0
          ? currentFields.map((field, index) => (index === existingIndex ? nextField : field))
          : [...currentFields, nextField];

      return {
        ...current,
        extraFields: applyFieldOrder(nextFields),
      };
    });

    resetFieldEditor();
  };

  const removeField = (fieldId) => {
    setDraft((current) => ({
      ...current,
      extraFields: applyFieldOrder(
        (Array.isArray(current?.extraFields) ? current.extraFields : []).filter(
          (field) => field.id !== fieldId
        )
      ),
    }));

    if (editingFieldId === fieldId) {
      resetFieldEditor();
    }
  };

  const moveField = (fieldId, direction) => {
    setDraft((current) => {
      const currentFields = [...(Array.isArray(current?.extraFields) ? current.extraFields : [])];
      const index = currentFields.findIndex((field) => field.id === fieldId);
      if (index < 0) return current;

      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= currentFields.length) return current;

      const nextFields = [...currentFields];
      const [moved] = nextFields.splice(index, 1);
      nextFields.splice(nextIndex, 0, moved);

      return {
        ...current,
        extraFields: applyFieldOrder(nextFields),
      };
    });
  };

  const toggleDraftFieldActive = (fieldId) => {
    setDraft((current) => ({
      ...current,
      extraFields: (Array.isArray(current?.extraFields) ? current.extraFields : []).map((field) =>
        field.id === fieldId ? { ...field, isActive: !field.isActive } : field
      ),
    }));
  };

  const saveDefinitionDraft = async () => {
    setBusy("save");
    setErr("");
    setMsg("");
    setFieldErr("");

    try {
      if (editingId) {
        await updateRequestDefinition(editingId, draft);
        setMsg("Request definition updated.");
      } else {
        await createRequestDefinition(draft);
        setMsg("Request definition created.");
      }

      setFormOpen(false);
      setEditingId("");
      setDraft(createEmptyRequestDefinitionDraft());
      resetFieldEditor();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save request definition.");
    } finally {
      setBusy("");
    }
  };

  const toggleDefinitionActive = async (definition) => {
    const actionKey = `active:${definition?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");

    try {
      const nextState = !definition?.isActive;
      await setRequestDefinitionActiveState(definition?.id, nextState);
      setMsg(nextState ? "Request definition activated." : "Request definition deactivated.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update request definition status.");
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
              <AppIcon icon={FileText} size={ICON_SM} />
              Request Management
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC Request Management
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
              Manage request definitions by title, track, country, status, and extra fields without
              touching the live built-in request form flow.
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
            Only Super Admin can manage request definitions.
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
                    Definitions inventory
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Core request fields stay in the existing live flow. This module only manages the
                    extra request-specific fields that will sit on top later.
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      {definitions.length} total
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      {activeCount} active
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
                      placeholder="Search title, country, track, or extra field"
                      className="w-full rounded-2xl border border-zinc-200 bg-white/85 py-3 pl-9 pr-4 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                  >
                    <AppIcon icon={Plus} size={ICON_SM} />
                    New Definition
                  </button>
                </div>
              </div>
            </div>

            {formOpen ? (
              <div className={`mt-4 ${card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {editingId ? "Edit Request Definition" : "Create Request Definition"}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      The source of truth here is the request definition config only. Built-in core
                      fields stay fixed outside this builder.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={busy === "save"}
                    className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
                    <label className="grid gap-1.5">
                      <span className={label}>Request Title</span>
                      <input
                        className={input}
                        value={draft.title}
                        onChange={(event) => updateDraft({ title: event.target.value })}
                        placeholder="Study Australia"
                      />
                    </label>

                    <label className="grid gap-1.5">
                      <span className={label}>Track Type</span>
                      <select
                        className={input}
                        value={draft.trackType}
                        onChange={(event) => updateDraft({ trackType: event.target.value })}
                      >
                        {Object.entries(APP_TRACK_META).map(([key, meta]) => (
                          <option key={key} value={key}>
                            {meta.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1.5">
                      <span className={label}>Country</span>
                      <select
                        className={input}
                        value={draft.country}
                        onChange={(event) => updateDraft({ country: event.target.value })}
                      >
                        {countryOptions.map((country) => (
                          <option key={country.value} value={country.value}>
                            {country.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                      <AppIcon icon={ShieldCheck} size={ICON_SM} />
                      Core Fields Stay Fixed
                    </div>
                    <div className="mt-2 text-sm text-emerald-900/90 dark:text-emerald-100/90">
                      Name, phone number, nationality, county / city, and the current live
                      identity and location fields remain untouched. This definition stores only the
                      extra request-specific fields for future rendering.
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.isActive)}
                        onChange={(event) => updateDraft({ isActive: event.target.checked })}
                      />
                      Definition is active
                    </label>
                    <div className="flex items-center rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      Extra fields are stored separately from user request submissions.
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-3xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-950/25">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Extra Fields Builder
                      </div>
                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                        Reorder the list to control field sort order. These fields are additional on
                        top of the current built-in request form.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={openAddField}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                    >
                      <AppIcon icon={Plus} size={ICON_SM} />
                      Add Field
                    </button>
                  </div>

                  <div className="mt-4 grid gap-2">
                    {!draft.extraFields?.length ? (
                      <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/70 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                        No extra fields yet. Add things like Passport Number, Transcript Upload, or
                        Parent / Guardian Name.
                      </div>
                    ) : (
                      draft.extraFields.map((field, index) => {
                        const isTop = index === 0;
                        const isBottom = index === draft.extraFields.length - 1;

                        return (
                          <div
                            key={field.id}
                            className="rounded-2xl border border-zinc-200 bg-white/80 p-4 dark:border-zinc-700 dark:bg-zinc-900/60"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {field.label}
                                  </div>
                                  <FieldMetaPill>{formatFieldType(field.type)}</FieldMetaPill>
                                  <FieldMetaPill tone={field.required ? "active" : "inactive"}>
                                    {field.required ? "Required" : "Optional"}
                                  </FieldMetaPill>
                                  <FieldMetaPill tone={field.isActive ? "active" : "inactive"}>
                                    {field.isActive ? "Active" : "Inactive"}
                                  </FieldMetaPill>
                                  <FieldMetaPill>#{index + 1}</FieldMetaPill>
                                </div>

                                {field.helperText ? (
                                  <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                                    {field.helperText}
                                  </div>
                                ) : null}

                                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                  {field.placeholder ? (
                                    <FieldMetaPill>Placeholder: {field.placeholder}</FieldMetaPill>
                                  ) : null}
                                  {Number(field.minLength || 0) > 0 ? (
                                    <FieldMetaPill>Min {field.minLength}</FieldMetaPill>
                                  ) : null}
                                  {Number(field.maxLength || 0) > 0 ? (
                                    <FieldMetaPill>Max {field.maxLength}</FieldMetaPill>
                                  ) : null}
                                  {field.digitsOnly ? (
                                    <FieldMetaPill>Digits only</FieldMetaPill>
                                  ) : null}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 lg:w-[320px] lg:justify-end">
                                <button
                                  type="button"
                                  onClick={() => openEditField(field)}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                                >
                                  <AppIcon icon={Pencil} size={ICON_SM} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleDraftFieldActive(field.id)}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                                >
                                  <AppIcon icon={field.isActive ? ShieldOff : ShieldCheck} size={ICON_SM} />
                                  {field.isActive ? "Disable" : "Enable"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveField(field.id, "up")}
                                  disabled={isTop}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                                >
                                  <AppIcon icon={ArrowUp} size={ICON_SM} />
                                  Up
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveField(field.id, "down")}
                                  disabled={isBottom}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                                >
                                  <AppIcon icon={ArrowDown} size={ICON_SM} />
                                  Down
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeField(field.id)}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200"
                                >
                                  <AppIcon icon={Trash2} size={ICON_SM} />
                                  Remove
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {fieldEditorOpen ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {editingFieldId ? "Edit Extra Field" : "Add Extra Field"}
                          </div>
                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                            Safe first-pass field types are text, textarea, number, and document.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={resetFieldEditor}
                          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                        >
                          <AppIcon icon={X} size={ICON_SM} />
                          Close
                        </button>
                      </div>

                      {fieldErr ? (
                        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                          {fieldErr}
                        </div>
                      ) : null}

                      <div className="mt-4 grid gap-3">
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                          <label className="grid gap-1.5">
                            <span className={label}>Field Label</span>
                            <input
                              className={input}
                              value={fieldDraft.label}
                              onChange={(event) => updateFieldDraft({ label: event.target.value })}
                              placeholder="Passport Number"
                            />
                          </label>
                          <label className="grid gap-1.5">
                            <span className={label}>Field Type</span>
                            <select
                              className={input}
                              value={fieldDraft.type}
                              onChange={(event) => {
                                const nextType = event.target.value;
                                updateFieldDraft({
                                  type: nextType,
                                  placeholder: nextType === "document" ? "" : fieldDraft.placeholder,
                                  minLength: nextType === "document" ? "" : fieldDraft.minLength,
                                  maxLength: nextType === "document" ? "" : fieldDraft.maxLength,
                                  digitsOnly: nextType === "document" ? false : nextType === "number",
                                });
                              }}
                            >
                              {REQUEST_EXTRA_FIELD_TYPE_OPTIONS.map((type) => (
                                <option key={type} value={type}>
                                  {formatFieldType(type)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          <label className="grid gap-1.5">
                            <span className={label}>Placeholder</span>
                            <input
                              className={input}
                              value={fieldDraft.placeholder}
                              onChange={(event) =>
                                updateFieldDraft({ placeholder: event.target.value })
                              }
                              disabled={fieldDraft.type === "document"}
                              placeholder={
                                fieldDraft.type === "document"
                                  ? "Document fields use label + helper text"
                                  : "Enter passport number"
                              }
                            />
                          </label>
                          <label className="grid gap-1.5">
                            <span className={label}>Helper Text</span>
                            <input
                              className={input}
                              value={fieldDraft.helperText}
                              onChange={(event) =>
                                updateFieldDraft({ helperText: event.target.value })
                              }
                              placeholder="Upload your birth certificate"
                            />
                          </label>
                        </div>

                        {fieldDraft.type === "document" ? (
                          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                            Document fields currently store only configuration like label, helper
                            text, required state, and active state. File rendering will plug in
                            later without changing core request fields.
                          </div>
                        ) : (
                          <div className="grid gap-3 lg:grid-cols-3">
                            <label className="grid gap-1.5">
                              <span className={label}>Min Length</span>
                              <input
                                type="number"
                                min={0}
                                className={input}
                                value={fieldDraft.minLength}
                                onChange={(event) =>
                                  updateFieldDraft({ minLength: event.target.value })
                                }
                                placeholder="0"
                              />
                            </label>
                            <label className="grid gap-1.5">
                              <span className={label}>Max Length</span>
                              <input
                                type="number"
                                min={0}
                                className={input}
                                value={fieldDraft.maxLength}
                                onChange={(event) =>
                                  updateFieldDraft({ maxLength: event.target.value })
                                }
                                placeholder="0"
                              />
                            </label>
                            <div className="grid gap-2">
                              <span className={label}>Validation</span>
                              <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                                <input
                                  type="checkbox"
                                  checked={Boolean(fieldDraft.digitsOnly)}
                                  onChange={(event) =>
                                    updateFieldDraft({ digitsOnly: event.target.checked })
                                  }
                                  disabled={fieldDraft.type === "textarea"}
                                />
                                Digits only
                              </label>
                            </div>
                          </div>
                        )}

                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                            <input
                              type="checkbox"
                              checked={Boolean(fieldDraft.required)}
                              onChange={(event) =>
                                updateFieldDraft({ required: event.target.checked })
                              }
                            />
                            Required field
                          </label>
                          <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                            <input
                              type="checkbox"
                              checked={Boolean(fieldDraft.isActive)}
                              onChange={(event) =>
                                updateFieldDraft({ isActive: event.target.checked })
                              }
                            />
                            Field is active
                          </label>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={resetFieldEditor}
                            className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={saveFieldDraft}
                            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                          >
                            <AppIcon icon={Save} size={ICON_SM} />
                            {editingFieldId ? "Save Field" : "Add Field"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => void saveDefinitionDraft()}
                  disabled={busy === "save"}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <AppIcon icon={Save} size={ICON_SM} />
                  {busy === "save"
                    ? "Saving..."
                    : editingId
                    ? "Save Request Definition"
                    : "Create Request Definition"}
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className={`mt-4 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading request definitions...
              </div>
            ) : !filteredDefinitions.length ? (
              <div className={`mt-4 ${card}`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {definitions.length
                    ? "No request definitions match the current search."
                    : "No request definitions yet."}
                </div>
                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  {definitions.length
                    ? "Try a broader search or create a new request definition."
                    : "Create the first definition to start storing request-specific extra fields separately from user submissions."}
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {filteredDefinitions.map((definition) => {
                  const activeBusy = busy === `active:${definition.id}`;
                  const activeFieldLabel =
                    definition.extraFieldCount === definition.activeExtraFieldCount
                      ? `${definition.extraFieldCount}`
                      : `${definition.activeExtraFieldCount} active / ${definition.extraFieldCount} total`;

                  return (
                    <div
                      key={definition.id}
                      className={`${card} ${definition.isActive ? "" : "opacity-90"}`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {definition.title}
                            </div>
                            <FieldMetaPill tone={definition.isActive ? "active" : "inactive"}>
                              {definition.isActive ? "Active" : "Inactive"}
                            </FieldMetaPill>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <FieldMetaPill>
                              Track: {APP_TRACK_META[definition.trackType]?.label || definition.trackType}
                            </FieldMetaPill>
                            <FieldMetaPill>Country: {definition.country}</FieldMetaPill>
                            <FieldMetaPill>Extra Fields: {activeFieldLabel}</FieldMetaPill>
                          </div>

                          {definition.extraFields?.length ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {definition.extraFields.slice(0, 4).map((field) => (
                                <span
                                  key={`${definition.id}-${field.id}`}
                                  className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                                >
                                  {field.label}
                                </span>
                              ))}
                              {definition.extraFields.length > 4 ? (
                                <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                                  +{definition.extraFields.length - 4} more
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                              No extra fields configured yet.
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 lg:w-[260px] lg:justify-end">
                          <button
                            type="button"
                            onClick={() => openEdit(definition)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            <AppIcon icon={Pencil} size={ICON_SM} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleDefinitionActive(definition)}
                            disabled={activeBusy}
                            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            <AppIcon
                              icon={definition.isActive ? ShieldOff : ShieldCheck}
                              size={ICON_SM}
                            />
                            {activeBusy
                              ? "Updating..."
                              : definition.isActive
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

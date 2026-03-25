import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Newspaper,
  Pencil,
  Plus,
  Radio,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META, normalizeDestinationCountry } from "../constants/migrationOptions";
import {
  NEWS_SOURCE_TYPE_LABELS,
  NEWS_SOURCE_TYPE_OPTIONS,
  NEWS_TAG_OPTIONS,
  normalizeNewsTag,
} from "../constants/news";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  createEmptyNewsDraft,
  createNewsItem,
  deleteNewsItem,
  draftFromNewsItem,
  getImpactLabel,
  getNewsTimestampMs,
  setNewsPublishedState,
  subscribeAllNews,
  updateNewsItem,
} from "../services/newsservice";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function formatRelativeTime(timestampMs) {
  const ts = Number(timestampMs || 0);
  if (!ts) return "";

  const diffMs = Date.now() - ts;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function tagListFromDraft(tagsInput) {
  const seen = new Set();
  return String(tagsInput || "")
    .split(",")
    .map((item) => normalizeNewsTag(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sourceTone(sourceType) {
  const safeType = String(sourceType || "").trim().toLowerCase();
  if (safeType === "official") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200";
  }
  if (safeType === "media") {
    return "border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/25 dark:text-sky-200";
  }
  return "border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
}

export default function AdminNewsManagementScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(createEmptyNewsDraft());
  const [busy, setBusy] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { countries: managedCountriesForTrack, hasManagedDocs: hasManagedCountries } =
    useManagedDestinationCountries({ trackType: draft.trackType });

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

    return subscribeAllNews({
      onData: (rows) => {
        setItems(rows);
        setLoading(false);
      },
      onError: (error) => {
        setItems([]);
        setErr(error?.message || "Failed to load news items.");
        setLoading(false);
      },
    });
  }, [isSuperAdmin]);

  const selectedTags = useMemo(() => tagListFromDraft(draft.tagsInput), [draft.tagsInput]);
  const editingLabel = editingId ? "Edit News Publication" : "Create News Publication";
  const tagSet = new Set(selectedTags.map((tag) => tag.toLowerCase()));

  const updateDraft = (patch) => {
    setDraft((current) => ({
      ...current,
      ...(patch || {}),
    }));
  };

  const openCreate = () => {
    setMsg("");
    setErr("");
    setEditingId("");
    setDraft(createEmptyNewsDraft());
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (item) => {
    setMsg("");
    setErr("");
    setEditingId(item?.id || "");
    setDraft(draftFromNewsItem(item));
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    if (busy) return;
    setFormOpen(false);
    setEditingId("");
    setDraft(createEmptyNewsDraft());
  };

  const toggleSuggestedTag = (tag) => {
    const currentTags = tagListFromDraft(draft.tagsInput);
    const key = String(tag || "").trim().toLowerCase();
    const exists = currentTags.some((item) => item.toLowerCase() === key);
    const nextTags = exists
      ? currentTags.filter((item) => item.toLowerCase() !== key)
      : [...currentTags, tag];

    updateDraft({ tagsInput: nextTags.join(", ") });
  };

  const saveDraft = async () => {
    setBusy("save");
    setErr("");
    setMsg("");

    try {
      if (editingId) {
        await updateNewsItem(editingId, draft);
        setMsg("News item updated.");
      } else {
        await createNewsItem(draft);
        setMsg("News item created.");
      }
      setFormOpen(false);
      setEditingId("");
      setDraft(createEmptyNewsDraft());
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save news item.");
    } finally {
      setBusy("");
    }
  };

  const togglePublished = async (item) => {
    const actionKey = `publish:${item?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");

    try {
      const nextPublishedState = !item?.isPublished;
      await setNewsPublishedState(item?.id, nextPublishedState);
      setMsg(nextPublishedState ? "News item published." : "News item unpublished.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update publish state.");
    } finally {
      setBusy("");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget?.id) return;

    setBusy(`delete:${deleteTarget.id}`);
    setErr("");
    setMsg("");

    try {
      await deleteNewsItem(deleteTarget.id);
      setMsg("News item deleted.");
      if (editingId === deleteTarget.id) {
        setFormOpen(false);
        setEditingId("");
        setDraft(createEmptyNewsDraft());
      }
      setDeleteTarget(null);
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to delete news item.");
    } finally {
      setBusy("");
    }
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const label = "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Newspaper} size={ICON_SM} />
              News Publication
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC News Publication
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Publish migration-relevant updates and control how they appear in-app.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin/sacc")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            aria-label="Back"
            title="Back"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage news.
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

            <div className={`mt-5 ${card} p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    News Items
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Higher importance scores float higher in the feed. Breaking items can surface in the top banner.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                >
                  <AppIcon icon={Plus} size={ICON_MD} />
                  Create News
                </button>
              </div>
            </div>

            {formOpen ? (
              <div className={`mt-4 ${card} p-4`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {editingLabel}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Title, summary, why this matters, track, country, and source are the core publishing fields.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={Boolean(busy)}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-3 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>

                <div className="mt-4 grid gap-3">
                  <label className="grid gap-1.5">
                    <span className={label}>Title</span>
                    <input
                      className={input}
                      value={draft.title}
                      onChange={(event) => updateDraft({ title: event.target.value })}
                      placeholder="Headline"
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className={label}>Summary</span>
                    <textarea
                      className={`${input} min-h-24 resize-y`}
                      value={draft.summary}
                      onChange={(event) => updateDraft({ summary: event.target.value })}
                      placeholder="Short summary for the feed"
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className={label}>Why This Matters</span>
                    <textarea
                      className={`${input} min-h-24 resize-y`}
                      value={draft.whyThisMatters}
                      onChange={(event) => updateDraft({ whyThisMatters: event.target.value })}
                      placeholder="Explain the user impact clearly"
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className={label}>Full Content / Body</span>
                    <textarea
                      className={`${input} min-h-32 resize-y`}
                      value={draft.content}
                      onChange={(event) => updateDraft({ content: event.target.value })}
                      placeholder="Optional deeper content"
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
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

                  <label className="grid gap-1.5">
                    <span className={label}>Tags</span>
                    <input
                      className={input}
                      value={draft.tagsInput}
                      onChange={(event) => updateDraft({ tagsInput: event.target.value })}
                      placeholder="Visa, Scholarships, Housing"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {NEWS_TAG_OPTIONS.map((tag) => {
                        const selected = tagSet.has(tag.toLowerCase());
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleSuggestedTag(tag)}
                            className={[
                              "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition active:scale-[0.99]",
                              selected
                                ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                : "border-zinc-200 bg-white/80 text-zinc-600 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300",
                            ].join(" ")}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className={label}>Source Name</span>
                      <input
                        className={input}
                        value={draft.sourceName}
                        onChange={(event) => updateDraft({ sourceName: event.target.value })}
                        placeholder="Australian Government"
                      />
                    </label>

                    <label className="grid gap-1.5">
                      <span className={label}>Source Type</span>
                      <select
                        className={input}
                        value={draft.sourceType}
                        onChange={(event) => updateDraft({ sourceType: event.target.value })}
                      >
                        {NEWS_SOURCE_TYPE_OPTIONS.map((type) => (
                          <option key={type} value={type}>
                            {NEWS_SOURCE_TYPE_LABELS[type]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="grid gap-1.5">
                    <span className={label}>Source Link</span>
                    <input
                      className={input}
                      value={draft.sourceLink}
                      onChange={(event) => updateDraft({ sourceLink: event.target.value })}
                      placeholder="https://..."
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className={label}>Importance Score</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className={input}
                      value={draft.importanceScore}
                      onChange={(event) => updateDraft({ importanceScore: event.target.value })}
                    />
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      Higher scores float higher in the user feed.
                    </div>
                  </label>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.isBreaking)}
                        onChange={(event) => updateDraft({ isBreaking: event.target.checked })}
                      />
                      Mark as breaking
                    </label>

                    <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={Boolean(draft.isPublished)}
                        onChange={(event) => updateDraft({ isPublished: event.target.checked })}
                      />
                      Publish now
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={busy === "save"}
                    className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                  >
                    <AppIcon icon={Save} size={ICON_MD} />
                    {busy === "save" ? "Saving..." : editingId ? "Save Changes" : "Create News Item"}
                  </button>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className={`mt-4 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading news items...
              </div>
            ) : !items.length ? (
              <div className={`mt-4 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                No news items yet. Create the first one from this screen.
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {items.map((item) => {
                  const publishBusy = busy === `publish:${item.id}`;
                  const deleteBusy = busy === `delete:${item.id}`;
                  const impactLabel = getImpactLabel(item);
                  const trackLabel = APP_TRACK_META[item.trackType]?.label || item.trackType;
                  const relativeTime = formatRelativeTime(getNewsTimestampMs(item));

                  return (
                    <div key={item.id} className={`${card} px-4 py-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {item.title}
                            </div>
                            {item.isBreaking ? (
                              <span className="rounded-full border border-rose-200 bg-rose-50/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
                                Breaking
                              </span>
                            ) : null}
                            {impactLabel ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                                {impactLabel}
                              </span>
                            ) : null}
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                                item.isPublished
                                  ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                                  : "border-zinc-200 bg-zinc-50/80 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                              }`}
                            >
                              {item.isPublished ? "Published" : "Draft"}
                            </span>
                          </div>

                          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            {item.summary}
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                            <span>{trackLabel}</span>
                            <span>{item.country}</span>
                            <span className={`rounded-full border px-2 py-0.5 ${sourceTone(item.sourceType)}`}>
                              {NEWS_SOURCE_TYPE_LABELS[item.sourceType] || "Other"}
                            </span>
                            <span>{item.sourceName}</span>
                            {relativeTime ? <span>{relativeTime}</span> : null}
                            <span>Priority {item.importanceScore}</span>
                          </div>

                          {item.whyThisMatters ? (
                            <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/45">
                              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                                <AppIcon icon={ShieldCheck} size={ICON_SM} />
                                Why this matters
                              </div>
                              <div className="mt-1.5 text-sm leading-5 text-zinc-700 dark:text-zinc-200">
                                {item.whyThisMatters}
                              </div>
                            </div>
                          ) : null}

                          {item.tags?.length ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {item.tags.map((tag) => (
                                <span
                                  key={`${item.id}-${tag}`}
                                  className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                        >
                          <AppIcon icon={Pencil} size={ICON_SM} />
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => void togglePublished(item)}
                          disabled={publishBusy}
                          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                        >
                          <AppIcon icon={item.isPublished ? EyeOff : Eye} size={ICON_SM} />
                          {publishBusy
                            ? "Updating..."
                            : item.isPublished
                            ? "Unpublish"
                            : "Publish"}
                        </button>

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(item)}
                          disabled={deleteBusy}
                          className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200"
                        >
                          <AppIcon icon={Trash2} size={ICON_SM} />
                          {deleteBusy ? "Deleting..." : "Delete"}
                        </button>

                        {item.isBreaking ? (
                          <span className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-zinc-950/45 dark:text-rose-200">
                            <AppIcon icon={Radio} size={ICON_SM} />
                            Breaking banner eligible
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close delete confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center app-overlay-safe">
            <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-4 shadow-xl dark:border-rose-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                <AppIcon icon={Trash2} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Delete this news item?
              </div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                {safeString(deleteTarget?.title, 120)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  disabled={Boolean(busy)}
                  className="rounded-2xl border border-rose-200 bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

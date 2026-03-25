import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Globe2,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { APP_TRACK_META } from "../constants/migrationOptions";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  COUNTRY_CURRENCY_SUGGESTIONS,
  COUNTRY_TRACK_OPTIONS,
  countrySupportsTrack,
  createCountry,
  createEmptyCountryDraft,
  draftFromCountry,
  getCountryAccentSuggestions,
  setCountryActiveState,
  suggestCountryAccentColor,
  subscribeAllCountries,
  updateCountry,
} from "../services/countryService";
import {
  buildCountryAccentBadgeStyle,
  buildCountryAccentSurfaceStyle,
  normalizeHexColor,
} from "../utils/countryAccent";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function matchesCountrySearch(country, search) {
  const needle = safeString(search, 120).toLowerCase();
  if (!needle) return true;

  const trackLabels = (Array.isArray(country?.supportedTracks) ? country.supportedTracks : []).map(
    (track) => APP_TRACK_META[track]?.label || track
  );

  return [country?.name, country?.code, country?.currency, country?.accentColor, ...trackLabels]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
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

export default function AdminCountryManagementScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [countries, setCountries] = useState([]);
  const [search, setSearch] = useState("");
  const [trackFilter, setTrackFilter] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState(createEmptyCountryDraft());
  const [busy, setBusy] = useState("");

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

    return subscribeAllCountries({
      onData: (rows) => {
        setCountries(rows);
        setLoading(false);
      },
      onError: (error) => {
        console.error(error);
        setCountries([]);
        setErr(error?.message || "Failed to load countries.");
        setLoading(false);
      },
    });
  }, [isSuperAdmin]);

  const filteredCountries = useMemo(
    () =>
      countries
        .filter((country) => matchesCountrySearch(country, search))
        .filter((country) => (trackFilter ? countrySupportsTrack(country, trackFilter) : true)),
    [countries, search, trackFilter]
  );

  const activeCount = useMemo(
    () => countries.filter((country) => country.isActive).length,
    [countries]
  );

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

  const accentSuggestions = useMemo(
    () => getCountryAccentSuggestions(draft),
    [draft]
  );

  const toggleDraftTrack = (track) => {
    setDraft((current) => {
      const currentTracks = Array.isArray(current?.supportedTracks) ? current.supportedTracks : [];
      const normalizedTrack = safeString(track, 20).toLowerCase();
      const set = new Set(currentTracks);
      if (set.has(normalizedTrack)) set.delete(normalizedTrack);
      else set.add(normalizedTrack);

      return {
        ...current,
        supportedTracks: COUNTRY_TRACK_OPTIONS.filter((t) => set.has(t)),
      };
    });
  };

  const openCreate = () => {
    setErr("");
    setMsg("");
    setEditingId("");
    setDraft(createEmptyCountryDraft());
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEdit = (country) => {
    setErr("");
    setMsg("");
    setEditingId(country?.id || "");
    setDraft(draftFromCountry(country));
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    if (busy === "save") return;
    setFormOpen(false);
    setEditingId("");
    setDraft(createEmptyCountryDraft());
  };

  const saveDraft = async () => {
    setBusy("save");
    setErr("");
    setMsg("");

    try {
      if (editingId) {
        await updateCountry(editingId, draft);
        setMsg("Country updated.");
      } else {
        await createCountry(draft);
        setMsg("Country created.");
      }

      setFormOpen(false);
      setEditingId("");
      setDraft(createEmptyCountryDraft());
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to save country.");
    } finally {
      setBusy("");
    }
  };

  const toggleCountryActive = async (country) => {
    const actionKey = `active:${country?.id || ""}`;
    setBusy(actionKey);
    setErr("");
    setMsg("");

    try {
      const nextState = !country?.isActive;
      await setCountryActiveState(country?.id, nextState);
      setMsg(nextState ? "Country activated." : "Country deactivated.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update country status.");
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
              <AppIcon icon={Globe2} size={ICON_SM} />
              Country Management
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              SACC Country Management
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Central source of truth for countries: activation, supported tracks, and currency.
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
            Only Super Admin can manage countries.
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

            {formOpen ? (
              <div className={`mt-5 ${card}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {editingId ? "Edit Country" : "Create Country"}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                      Configure name, code, currency, supported tracks, and active state.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={busy === "save"}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                  >
                    <AppIcon icon={X} size={ICON_SM} />
                    Close
                  </button>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <div className={label}>Country Name</div>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                      placeholder="e.g. Canada"
                      className={input}
                    />
                  </label>

                  <label className="block">
                    <div className={label}>Country Code</div>
                    <input
                      type="text"
                      value={draft.code}
                      onChange={(event) => updateDraft({ code: event.target.value.toUpperCase() })}
                      placeholder="e.g. CA"
                      className={input}
                    />
                  </label>

                  <label className="block">
                    <div className={label}>Currency</div>
                    <input
                      type="text"
                      value={draft.currency}
                      onChange={(event) =>
                        updateDraft({ currency: event.target.value.toUpperCase() })
                      }
                      placeholder="e.g. KES"
                      className={input}
                      list="country-currency-options"
                    />
                    <datalist id="country-currency-options">
                      {COUNTRY_CURRENCY_SUGGESTIONS.map((currency) => (
                        <option key={currency} value={currency} />
                      ))}
                    </datalist>
                  </label>

                  <label className="block">
                    <div className={label}>Flag (Optional)</div>
                    <input
                      type="text"
                      value={draft.flag}
                      onChange={(event) => updateDraft({ flag: event.target.value })}
                      placeholder="e.g. 🇰🇪 or https://..."
                      className={input}
                    />
                  </label>

                  <div className="block">
                    <div className={label}>Accent Color</div>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="color"
                        value={normalizeHexColor(draft.accentColor, suggestCountryAccentColor(draft))}
                        onChange={(event) => updateDraft({ accentColor: event.target.value })}
                        className="h-12 w-14 rounded-2xl border border-zinc-200 bg-white/90 p-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70"
                      />
                      <input
                        type="text"
                        value={draft.accentColor}
                        onChange={(event) => updateDraft({ accentColor: event.target.value })}
                        placeholder="#157347"
                        className={input}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {accentSuggestions.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => updateDraft({ accentColor: color })}
                          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:opacity-90 dark:text-zinc-100"
                          style={buildCountryAccentBadgeStyle(color, { strong: true })}
                        >
                          <span
                            className="inline-flex h-3.5 w-3.5 rounded-full border border-white/70"
                            style={{ backgroundColor: color }}
                          />
                          {color}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 rounded-2xl border px-4 py-3 text-sm text-zinc-700 dark:text-zinc-200" style={buildCountryAccentSurfaceStyle(draft.accentColor, { strong: true })}>
                      This accent is reused subtly across track, request, and support screens for this country.
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <div className={label}>Supported Tracks</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COUNTRY_TRACK_OPTIONS.map((track) => {
                      const enabled =
                        Array.isArray(draft?.supportedTracks) && draft.supportedTracks.includes(track);
                      const trackLabel = APP_TRACK_META[track]?.label || track;
                      return (
                        <button
                          key={track}
                          type="button"
                          onClick={() => toggleDraftTrack(track)}
                          className={`rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                            enabled
                              ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                              : "border-zinc-200 bg-white/80 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900/90"
                          }`}
                        >
                          {trackLabel}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    This controls which countries appear after users pick a track (Study/Work/Travel).
                  </div>
                </div>

                <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.isActive)}
                      onChange={(event) => updateDraft({ isActive: event.target.checked })}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-200 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-emerald-500/20"
                    />
                    Active
                  </label>

                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={busy === "save"}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-2.5 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                  >
                    <AppIcon icon={Save} size={ICON_SM} />
                    {busy === "save" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className={`mt-5 ${card}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Countries ({activeCount} active / {countries.length} total)
                  </div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Configure country availability per track and assign the currency context.
                  </div>
                </div>

                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <label className="relative block w-full sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search countries"
                      className="w-full rounded-2xl border border-zinc-200 bg-white/85 py-3 pl-9 pr-4 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100 active:scale-[0.99] dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                  >
                    <AppIcon icon={Plus} size={ICON_SM} />
                    Create
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTrackFilter("")}
                  className={`rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                    !trackFilter
                      ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                      : "border-zinc-200 bg-white/80 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900/90"
                  }`}
                >
                  All Tracks
                </button>
                {COUNTRY_TRACK_OPTIONS.map((track) => {
                  const active = trackFilter === track;
                  const trackLabel = APP_TRACK_META[track]?.label || track;
                  return (
                    <button
                      key={track}
                      type="button"
                      onClick={() => setTrackFilter(track)}
                      className={`rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                        active
                          ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                          : "border-zinc-200 bg-white/80 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900/90"
                      }`}
                    >
                      {trackLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            {loading ? (
              <div className={`mt-4 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading countries...
              </div>
            ) : filteredCountries.length === 0 ? (
              <div className={`mt-4 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
                No countries found.
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {filteredCountries.map((country) => {
                  const activeKey = `active:${country?.id || ""}`;
                  const activeBusy = busy === activeKey;
                  const trackLabels = (Array.isArray(country?.supportedTracks)
                    ? country.supportedTracks
                    : []
                  ).map((track) => APP_TRACK_META[track]?.label || track);

                  return (
                    <div
                      key={country.id}
                      className={`${card} ${country.isActive ? "" : "opacity-90"}`}
                      style={buildCountryAccentSurfaceStyle(country.accentColor)}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {country.flag ? `${country.flag} ` : ""}
                              {country.name || "Untitled Country"}
                            </div>
                            <MetaPill>{country.code || "Code?"}</MetaPill>
                            <MetaPill tone={country.isActive ? "active" : "inactive"}>
                              {country.isActive ? "Active" : "Inactive"}
                            </MetaPill>
                            <span
                              className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                              style={buildCountryAccentBadgeStyle(country.accentColor)}
                            >
                              Accent {country.accentColor}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <MetaPill>Currency: {country.currency || "—"}</MetaPill>
                            <MetaPill>
                              Tracks: {trackLabels.length ? trackLabels.join(", ") : "None"}
                            </MetaPill>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 lg:w-[280px] lg:justify-end">
                          <button
                            type="button"
                            onClick={() => openEdit(country)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            <AppIcon icon={Pencil} size={ICON_SM} />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleCountryActive(country)}
                            disabled={activeBusy}
                            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          >
                            <AppIcon
                              icon={country.isActive ? ShieldOff : ShieldCheck}
                              size={ICON_SM}
                            />
                            {activeBusy
                              ? "Updating..."
                              : country.isActive
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


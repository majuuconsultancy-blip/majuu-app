import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Briefcase, Compass, GraduationCap, Plane, RotateCcw } from "lucide-react";

import AppIcon from "../components/AppIcon";
import AppLoading from "../components/AppLoading";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { auth } from "../firebase";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import {
  JOURNEY_COUNTRY_TYPES,
  JOURNEY_SOURCES,
  normalizeJourney,
  normalizeJourneyTrack,
} from "../journey/journeyModel";
import { clearUserJourney, updateUserJourney } from "../services/journeyService";
import { getUserState } from "../services/userservice";
import { smartBack } from "../utils/navBack";

const PROCESS_OPTIONS = [
  { key: "study", label: "Study", Icon: GraduationCap },
  { key: "work", label: "Work", Icon: Briefcase },
  { key: "travel", label: "Travel", Icon: Plane },
  { key: "exploring", label: "Just exploring", Icon: Compass },
];

function safeString(value, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function ChoiceChip({ active, label, icon: Icon, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition active:scale-[0.99] disabled:opacity-60",
        active
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100"
          : "border-zinc-200 bg-white/70 text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:bg-zinc-900/70",
      ].join(" ")}
    >
      <AppIcon size={ICON_SM} icon={Icon} />
      {label}
    </button>
  );
}

export default function EditJourneyScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [process, setProcess] = useState("");
  const journeyTrack = useMemo(
    () => (process === "study" || process === "work" || process === "travel" ? process : ""),
    [process]
  );

  const { countries, loading: countriesLoading } = useManagedDestinationCountries({
    trackType: journeyTrack,
  });

  const [countryChoice, setCountryChoice] = useState("");
  const [countryCustom, setCountryCustom] = useState("");
  const [stage, setStage] = useState("");

  const usingOther = countryChoice === "__other__";
  const journeyCountryType = usingOther ? JOURNEY_COUNTRY_TYPES.custom : JOURNEY_COUNTRY_TYPES.managed;
  const journeyCountry = usingOther ? safeString(countryCustom, 80) : safeString(countryChoice, 80);

  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setLoading(true);
      setError("");

      try {
        const state = await getUserState(user.uid, user.email || "");
        if (cancelled) return;

        const journey = normalizeJourney(state?.journey);
        setProcess(journey.track || "");
        if (journey.countryType === JOURNEY_COUNTRY_TYPES.custom) {
          setCountryChoice("__other__");
          setCountryCustom(journey.countryCustom || journey.country || "");
        } else if (journey.country) {
          setCountryChoice(journey.country);
          setCountryCustom("");
        } else {
          setCountryChoice("");
          setCountryCustom("");
        }
        setStage(journey.stage || "");
      } catch (err) {
        console.error(err);
        setError(err?.message || "Could not load your journey.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigate]);

  const resetJourney = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError("");
    try {
      await clearUserJourney(uid, { source: JOURNEY_SOURCES.profile });
      setProcess("");
      setCountryChoice("");
      setCountryCustom("");
      setStage("");
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not reset journey.");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError("");

    try {
      if (process === "exploring" || !normalizeJourneyTrack(journeyTrack)) {
        await clearUserJourney(uid, { source: JOURNEY_SOURCES.profile });
        navigate("/app/profile", { replace: true });
        return;
      }

      if (!journeyCountry) {
        setError("Select a journey country (or choose Other / Not listed).");
        return;
      }

      await updateUserJourney(
        uid,
        {
          track: journeyTrack,
          countryType: journeyCountryType,
          country: journeyCountryType === JOURNEY_COUNTRY_TYPES.managed ? journeyCountry : "",
          countryCustom: journeyCountryType === JOURNEY_COUNTRY_TYPES.custom ? journeyCountry : "",
          stage,
        },
        { source: JOURNEY_SOURCES.profile }
      );

      navigate("/app/profile", { replace: true });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not save journey.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <AppLoading />;

  const topBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="max-w-xl mx-auto px-5 py-8 pb-12">
        <button
          type="button"
          onClick={() => smartBack(navigate, "/app/profile")}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:bg-white active:scale-[0.99] disabled:opacity-60"
        >
          <AppIcon size={ICON_SM} icon={ArrowLeft} />
          Back
        </button>

        <div className="mt-4">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Journey</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Update what you’re currently doing so MAJUU routes you better.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            What process are you currently in?
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PROCESS_OPTIONS.map((opt) => (
              <ChoiceChip
                key={opt.key}
                active={process === opt.key}
                label={opt.label}
                icon={opt.Icon}
                disabled={saving}
                onClick={() => {
                  setError("");
                  setProcess(opt.key);
                  setCountryChoice("");
                  setCountryCustom("");
                }}
              />
            ))}
          </div>

          {journeyTrack ? (
            <div className="mt-5 rounded-3xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/35 dark:bg-emerald-950/15">
              <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">Journey setup</div>

              <div className="mt-3">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Journey country
                </label>
                <select
                  value={countryChoice}
                  onChange={(e) => {
                    setError("");
                    setCountryChoice(e.target.value);
                    if (e.target.value !== "__other__") setCountryCustom("");
                  }}
                  disabled={saving || countriesLoading}
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                >
                  <option value="">{countriesLoading ? "Loading countries..." : "Select a country"}</option>
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value="__other__">Other / Not listed</option>
                </select>

                {usingOther ? (
                  <div className="mt-3">
                    <input
                      value={countryCustom}
                      onChange={(e) => setCountryCustom(e.target.value)}
                      disabled={saving}
                      placeholder="Type your country"
                      className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                    />
                    <div className="mt-2 text-[11px] text-emerald-900/90 dark:text-emerald-100/90">
                      Journey tracking currently works best for supported countries. You can still continue using MAJUU
                      normally.
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Current stage (optional)
                </label>
                <input
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  disabled={saving}
                  placeholder="e.g. Visa submitted"
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={resetJourney}
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-white active:scale-[0.99] disabled:opacity-60"
          >
            <AppIcon size={ICON_SM} icon={RotateCcw} />
            Reset journey
          </button>
        </div>
      </div>
    </div>
  );
}


import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { Briefcase, GraduationCap, Plane, Compass, ChevronRight } from "lucide-react";

import AppIcon from "../components/AppIcon";
import AppLoading from "../components/AppLoading";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import {
  EAST_AFRICA_PHONE_CODES,
  EAST_AFRICA_RESIDENCE_COUNTRIES,
  getEastAfricaCountyOptions,
  getEastAfricaPhoneCode,
  getEastAfricaResidenceFromPhoneCode,
} from "../constants/eastAfricaProfile";
import { auth } from "../firebase";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { normalizeJourney, normalizeJourneyTrack } from "../journey/journeyModel";
import { resolveLandingPathFromUserState } from "../journey/journeyLanding";
import { JOURNEY_COUNTRY_TYPES, JOURNEY_SOURCES } from "../journey/journeyModel";
import { markProfileJourneySetupCompleted, updateUserJourney } from "../services/journeyService";
import { getUserState, updateUserProfile } from "../services/userservice";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { buildTrackEventKey, logAnalyticsEvent } from "../services/analyticsService";

const PROCESS_OPTIONS = [
  { key: "study", label: "Study", Icon: GraduationCap },
  { key: "work", label: "Work", Icon: Briefcase },
  { key: "travel", label: "Travel", Icon: Plane },
  { key: "exploring", label: "Just exploring", Icon: Compass },
];

function safeString(value, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function detectEastAfricaPhoneCode(phoneRaw) {
  const raw = String(phoneRaw || "").trim();
  if (!raw) return "";

  for (const code of Object.values(EAST_AFRICA_PHONE_CODES)) {
    const codeDigits = onlyDigits(code);
    const digits = onlyDigits(raw);
    if (raw.startsWith(code)) return code;
    if (codeDigits && digits.startsWith(codeDigits)) return code;
  }

  return "";
}

function splitPhoneParts({ countryOfResidence, phoneRaw }) {
  const residence = String(countryOfResidence || "").trim();
  const residenceCode = getEastAfricaPhoneCode(residence);
  const detectedCode = detectEastAfricaPhoneCode(phoneRaw);
  const code = residenceCode || detectedCode || EAST_AFRICA_PHONE_CODES.Kenya;

  const allDigits = onlyDigits(phoneRaw);
  const codeDigits = onlyDigits(code);
  let local = allDigits;

  if (codeDigits && local.startsWith(codeDigits)) {
    local = local.slice(codeDigits.length);
  }

  if (local.startsWith("0") && local.length > 1) {
    local = local.slice(1);
  }

  if (residence === "Kenya" && local.length >= 9) {
    local = local.slice(-9);
  }

  return { phoneCode: code, phoneDigits: local };
}

function buildPhoneValue(phoneCode, phoneDigits) {
  const code = String(phoneCode || "").trim();
  const digits = onlyDigits(phoneDigits);
  if (!code || !digits) return "";
  return `${code}${digits}`;
}

function ChoiceCard({ active, title, description, icon: Icon, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full text-left rounded-3xl border p-4 shadow-sm transition",
        "active:scale-[0.99] disabled:opacity-60",
        active
          ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20"
          : "border-zinc-200 bg-white/70 hover:border-emerald-200 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/70",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={[
                "inline-flex h-9 w-9 items-center justify-center rounded-2xl border",
                active
                  ? "border-emerald-200 bg-white/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-zinc-950/30 dark:text-emerald-200"
                  : "border-zinc-200 bg-white/70 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-200",
              ].join(" ")}
            >
              <AppIcon size={ICON_MD} icon={Icon} />
            </span>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
          </div>
          {description ? (
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{description}</div>
          ) : null}
        </div>

        <span
          className={[
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border transition",
            active
              ? "border-emerald-200 bg-emerald-600 text-white dark:border-emerald-900/40"
              : "border-zinc-200 bg-white/60 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-200",
          ].join(" ")}
          aria-hidden="true"
        >
          <AppIcon size={ICON_SM} icon={ChevronRight} />
        </span>
      </div>
    </button>
  );
}

export default function SetupProfileJourneyScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Profile (optional)
  const [name, setName] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");
  const [phoneCode, setPhoneCode] = useState(EAST_AFRICA_PHONE_CODES.Kenya);
  const [phoneDigits, setPhoneDigits] = useState("");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");

  // Journey
  const [process, setProcess] = useState(""); // study|work|travel|exploring|""
  const journeyTrack = useMemo(
    () => (process === "study" || process === "work" || process === "travel" ? process : ""),
    [process]
  );

  const { countries, loading: countriesLoading } = useManagedDestinationCountries({
    trackType: journeyTrack,
  });

  const [countryChoice, setCountryChoice] = useState(""); // managed country name or "__other__"
  const [countryCustom, setCountryCustom] = useState("");
  const [stage, setStage] = useState("");

  const showJourneySetup = Boolean(journeyTrack);
  const usingOther = countryChoice === "__other__";
  const journeyCountryType = usingOther ? JOURNEY_COUNTRY_TYPES.custom : JOURNEY_COUNTRY_TYPES.managed;
  const journeyCountry = usingOther ? safeString(countryCustom, 80) : safeString(countryChoice, 80);

  const residenceOptions = EAST_AFRICA_RESIDENCE_COUNTRIES;
  const hasCustomResidence =
    Boolean(countryOfResidence) && !residenceOptions.includes(String(countryOfResidence || "").trim());

  const countyOptions = useMemo(() => {
    const opts = getEastAfricaCountyOptions(countryOfResidence);
    return Array.isArray(opts) ? opts : [];
  }, [countryOfResidence]);

  const hasCustomCounty =
    Boolean(county) && Boolean(countryOfResidence) && !countyOptions.includes(String(county || "").trim());

  useEffect(() => {
    if (!uid) return;
    void logAnalyticsEvent({
      uid,
      eventType: ANALYTICS_EVENT_TYPES.JOURNEY_SETUP_STARTED,
      sourceScreen: "SetupProfileJourneyScreen",
    });
  }, [uid]);

  useEffect(() => {
    if (!countryOfResidence) return;
    const nextCode = getEastAfricaPhoneCode(countryOfResidence);
    if (nextCode && nextCode !== phoneCode) setPhoneCode(nextCode);
  }, [countryOfResidence, phoneCode]);

  useEffect(() => {
    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setUserEmail(user.email || "");
      setLoading(true);
      setError("");

      try {
        const state = await getUserState(user.uid, user.email || "");
        if (cancelled) return;

        setName(state?.name || "");
        setCountryOfResidence(state?.countryOfResidence || "");
        setCounty(state?.county || "");
        setTown(state?.town || "");

        const parts = splitPhoneParts({
          countryOfResidence: state?.countryOfResidence || "",
          phoneRaw: state?.phone || "",
        });
        setPhoneCode(parts.phoneCode);
        setPhoneDigits(parts.phoneDigits);

        const journey = normalizeJourney(state?.journey);
        if (journey.track) setProcess(journey.track);
        if (journey.countryType === JOURNEY_COUNTRY_TYPES.custom) {
          setCountryChoice("__other__");
          setCountryCustom(journey.countryCustom || journey.country || "");
        } else if (journey.country) {
          setCountryChoice(journey.country);
          setCountryCustom("");
        }
        if (journey.stage) setStage(journey.stage);

        // If onboarding is already complete, this route is no longer required.
        const landing = resolveLandingPathFromUserState(state || {});
        if (landing !== "/setup") {
          navigate(landing, { replace: true });
          return;
        }
      } catch (err) {
        console.error(err);
        setError(err?.message || "Could not load your profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigate]);

  const skip = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError("");
    try {
      await markProfileJourneySetupCompleted(uid);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not skip setup.");
    } finally {
      setSaving(false);
    }
  };

  const saveAndContinue = async () => {
    if (!uid || saving) return;
    setSaving(true);
    setError("");

    const profilePatch = {};
    if (safeString(name, 80)) profilePatch.name = name;
    if (safeString(countryOfResidence, 80)) profilePatch.countryOfResidence = countryOfResidence;

    const nextPhone = buildPhoneValue(phoneCode, phoneDigits);
    if (safeString(nextPhone, 60)) profilePatch.phone = nextPhone;
    if (!safeString(countryOfResidence, 80) && safeString(nextPhone, 60)) {
      const inferred = getEastAfricaResidenceFromPhoneCode(phoneCode);
      if (safeString(inferred, 80)) profilePatch.countryOfResidence = inferred;
    }
    if (safeString(county, 80)) profilePatch.county = county;
    if (safeString(town, 80)) profilePatch.town = town;

    try {
      if (Object.keys(profilePatch).length) {
        await updateUserProfile(uid, profilePatch);
      }

      if (process === "exploring" || !normalizeJourneyTrack(journeyTrack)) {
        await markProfileJourneySetupCompleted(uid);
        navigate("/dashboard", { replace: true });
        return;
      }

      if (!journeyCountry) {
        setError("Select a journey country (or choose Other / Not listed). You can also skip for now.");
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
        { source: JOURNEY_SOURCES.setup }
      );

      await markProfileJourneySetupCompleted(uid);
      navigate(`/app/${journeyTrack}`, { replace: true });
    } catch (err) {
      console.error(err);
      setError(err?.message || "Could not save your setup.");
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Setup Profile &amp; Journey
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Keep it lightweight. You can update this later in Profile.
            </p>
          </div>

          <button
            type="button"
            onClick={skip}
            disabled={saving}
            className="shrink-0 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:bg-white active:scale-[0.99] disabled:opacity-60"
          >
            Skip
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {/* Profile */}
        <div className="mt-6 rounded-3xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Profile basics (optional)</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            These help us personalize your experience and support you when needed.
          </p>

          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
                placeholder="Your name"
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Country of residence</label>
              <select
                value={countryOfResidence}
                onChange={(e) => {
                  setCountryOfResidence(e.target.value);
                  setCounty("");
                }}
                disabled={saving}
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
              >
                <option value="">Select a country</option>
                {hasCustomResidence ? (
                  <option value={countryOfResidence}>{countryOfResidence}</option>
                ) : null}
                {residenceOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Phone number</label>
              <div className="mt-2 flex gap-2">
                <select
                  value={phoneCode}
                  onChange={(e) => {
                    const nextCode = e.target.value;
                    setPhoneCode(nextCode);
                    if (!countryOfResidence) {
                      const inferred = getEastAfricaResidenceFromPhoneCode(nextCode);
                      if (inferred) setCountryOfResidence(inferred);
                    }
                  }}
                  disabled={saving}
                  className="w-36 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm font-semibold text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                >
                  {Object.entries(EAST_AFRICA_PHONE_CODES).map(([country, code]) => (
                    <option key={country} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <input
                  value={phoneDigits}
                  onChange={(e) => setPhoneDigits(onlyDigits(e.target.value))}
                  disabled={saving}
                  inputMode="tel"
                  placeholder="Phone digits"
                  className="min-w-0 flex-1 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                />
              </div>
              {userEmail ? (
                <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Signed in as {userEmail}</div>
              ) : null}
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">County</label>
              <select
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                disabled={saving || !countryOfResidence}
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
              >
                <option value="">
                  {countryOfResidence ? "Select a county" : "Select country first"}
                </option>
                {hasCustomCounty ? <option value={county}>{county}</option> : null}
                {countyOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Town / City</label>
              <input
                value={town}
                onChange={(e) => setTown(e.target.value)}
                disabled={saving}
                placeholder="e.g. Westlands, Eldoret, Kampala"
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
              />
            </div>
          </div>
        </div>

        {/* Journey */}
        <div className="mt-4 rounded-3xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            What process are you currently in?
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            This helps us route you faster and show the right guidance in Self-Help and We-Help.
          </p>

          <div className="mt-4 grid gap-3">
            {PROCESS_OPTIONS.map((opt) => (
              <ChoiceCard
                key={opt.key}
                active={process === opt.key}
                title={opt.label}
                description={
                  opt.key === "exploring"
                    ? "Browse freely with no setup."
                    : "Set your track and country for better routing."
                }
                icon={opt.Icon}
                disabled={saving}
                onClick={() => {
                  setError("");
                  setProcess(opt.key);
                  setCountryChoice("");
                  setCountryCustom("");

                  if (opt.key === "study" || opt.key === "work" || opt.key === "travel") {
                    void logAnalyticsEvent({
                      uid,
                      eventType: ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED,
                      eventKey: buildTrackEventKey(
                        ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED,
                        opt.key
                      ),
                      trackType: opt.key,
                      sourceScreen: "SetupProfileJourneyScreen",
                    });
                  }
                }}
              />
            ))}
          </div>

          {showJourneySetup ? (
            <div className="mt-5 rounded-3xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/35 dark:bg-emerald-950/15">
              <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">
                Journey setup
              </div>

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
            onClick={saveAndContinue}
            disabled={saving}
            className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Continue"}
          </button>
          <button
            type="button"
            onClick={skip}
            disabled={saving}
            className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-white active:scale-[0.99] disabled:opacity-60"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

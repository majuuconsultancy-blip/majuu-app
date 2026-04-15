import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { Briefcase, GraduationCap, Plane, Compass, ChevronRight } from "lucide-react";

import AppIcon from "../components/AppIcon";
import AppLoading from "../components/AppLoading";
import { useI18n } from "../lib/i18n";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import {
  EAST_AFRICA_PHONE_CODES,
  EAST_AFRICA_RESIDENCE_COUNTRIES,
  getEastAfricaCountyOptions,
  getEastAfricaPhoneCode,
  getEastAfricaResidenceFromPhoneCode,
} from "../constants/eastAfricaProfile";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { auth } from "../firebase";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import {
  JOURNEY_COUNTRY_TYPES,
  JOURNEY_SOURCES,
  normalizeJourney,
  normalizeJourneyTrack,
} from "../journey/journeyModel";
import { buildTrackEventKey, logAnalyticsEvent } from "../services/analyticsService";
import { setBiometricPromptPending } from "../services/biometricLockService";
import { markProfileJourneySetupCompleted, updateUserJourney } from "../services/journeyService";
import { getUserState, updateUserProfile } from "../services/userservice";
import { resolvePostAuthLandingPath } from "../utils/postAuthLanding";
import {
  PROFILE_LANGUAGE_OPTIONS,
  getDefaultLanguageForCountry,
  normalizeProfileLanguage,
} from "../utils/userProfile";

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

function fieldClass(invalid = false) {
  return [
    "mt-2 w-full rounded-2xl border bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:bg-zinc-950/30 dark:text-zinc-100",
    invalid
      ? "border-rose-300 focus:border-rose-300 focus:ring-rose-100 dark:border-rose-900/60"
      : "border-zinc-200 dark:border-zinc-800",
  ].join(" ");
}

export default function SetupProfileJourneyScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [uid, setUid] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  const [name, setName] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");
  const [language, setLanguage] = useState("");
  const [phoneCode, setPhoneCode] = useState(EAST_AFRICA_PHONE_CODES.Kenya);
  const [phoneDigits, setPhoneDigits] = useState("");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");

  const [process, setProcess] = useState("");
  const [countryChoice, setCountryChoice] = useState("");
  const [countryCustom, setCountryCustom] = useState("");
  const [stage, setStage] = useState("");

  const languageTouchedRef = useRef(false);

  const journeyTrack = useMemo(
    () => (process === "study" || process === "work" || process === "travel" ? process : ""),
    [process]
  );
  const { countries, loading: countriesLoading } = useManagedDestinationCountries({
    trackType: journeyTrack,
  });

  const showJourneySetup = Boolean(journeyTrack);
  const usingOther = countryChoice === "__other__";
  const journeyCountry = usingOther ? safeString(countryCustom, 80) : safeString(countryChoice, 80);
  const journeyCountryType = journeyCountry
    ? usingOther
      ? JOURNEY_COUNTRY_TYPES.custom
      : JOURNEY_COUNTRY_TYPES.managed
    : "";

  const residenceOptions = EAST_AFRICA_RESIDENCE_COUNTRIES;
  const hasCustomResidence =
    Boolean(countryOfResidence) &&
    !residenceOptions.includes(String(countryOfResidence || "").trim());

  const countyOptions = useMemo(() => {
    const options = getEastAfricaCountyOptions(countryOfResidence);
    return Array.isArray(options) ? options : [];
  }, [countryOfResidence]);

  const hasCustomCounty =
    Boolean(county) &&
    Boolean(countryOfResidence) &&
    !countyOptions.includes(String(county || "").trim());

  const missingName = showValidation && !safeString(name, 80);
  const missingCountry = showValidation && !safeString(countryOfResidence, 80);
  const missingLanguage = showValidation && !safeString(language, 20);

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

    const suggestedLanguage = getDefaultLanguageForCountry(countryOfResidence);
    if (suggestedLanguage && (!safeString(language, 20) || !languageTouchedRef.current)) {
      setLanguage(suggestedLanguage);
    }
  }, [countryOfResidence, language, phoneCode]);

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

        const homeCountry =
          safeString(state?.profile?.homeCountry, 80) || safeString(state?.countryOfResidence, 80);
        const savedLanguage =
          normalizeProfileLanguage(state?.profile?.language, "") ||
          getDefaultLanguageForCountry(homeCountry) ||
          "";

        setName(state?.name || "");
        setCountryOfResidence(homeCountry);
        setLanguage(savedLanguage);
        setCounty(state?.county || "");
        setTown(state?.town || "");
        languageTouchedRef.current = Boolean(
          normalizeProfileLanguage(state?.profile?.language, "")
        );

        const parts = splitPhoneParts({
          countryOfResidence: homeCountry,
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

        const landing = await resolvePostAuthLandingPath({
          uid: user.uid,
          userState: state || {},
        });
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

  const saveAndContinue = async () => {
    if (!uid || saving) return;

    setShowValidation(true);
    setError("");

    const cleanName = safeString(name, 80);
    const cleanHomeCountry = safeString(countryOfResidence, 80);
    const cleanLanguage = normalizeProfileLanguage(language, "");

    if (!cleanName || !cleanHomeCountry || !cleanLanguage) {
      setError("Complete your name, country of residence, and language to continue.");
      return;
    }

    setSaving(true);

    const nextPhone = buildPhoneValue(phoneCode, phoneDigits);

    try {
      await updateUserProfile(uid, {
        name: cleanName,
        countryOfResidence: cleanHomeCountry,
        homeCountry: cleanHomeCountry,
        language: cleanLanguage,
        phone: nextPhone,
        county,
        town,
      });

      if (process !== "exploring" && normalizeJourneyTrack(journeyTrack)) {
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
      }

      await markProfileJourneySetupCompleted(uid);
      await setBiometricPromptPending(uid, true).catch(() => {});
      navigate("/setup/biometric", { replace: true });
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
      <div className="mx-auto max-w-xl px-5 py-8 pb-12">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Setup Profile
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Finish three quick fields to continue. Everything else can be updated later.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="mt-6 border-t border-zinc-200/80 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Required to continue
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Name, home country, and language are required before entering the app.
          </p>

          <div className="mt-4 grid gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Name
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={saving}
                placeholder="Your name or nickname"
                className={fieldClass(missingName)}
              />
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                A full legal name is not required here.
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Country of residence (home country)
              </label>
              <select
                value={countryOfResidence}
                onChange={(event) => {
                  setCountryOfResidence(event.target.value);
                  setCounty("");
                }}
                disabled={saving}
                className={fieldClass(missingCountry)}
              >
                <option value="">{t("select_country")}</option>
                {hasCustomResidence ? (
                  <option value={countryOfResidence}>{countryOfResidence}</option>
                ) : null}
                {residenceOptions.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Language
              </label>
              <select
                value={language}
                onChange={(event) => {
                  languageTouchedRef.current = true;
                  setLanguage(event.target.value);
                }}
                disabled={saving}
                className={fieldClass(missingLanguage)}
              >
                <option value="">Select language</option>
                {PROFILE_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                We auto-select a language from your country when we can, but you can change it.
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 border-t border-zinc-200/80 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Optional details
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            These stay optional and can be completed later.
          </p>

          <div className="mt-4 grid gap-4">
            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Phone number
              </label>
              <div className="mt-2 flex gap-2">
                <select
                  value={phoneCode}
                  onChange={(event) => {
                    const nextCode = event.target.value;
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
                  onChange={(event) => setPhoneDigits(onlyDigits(event.target.value))}
                  disabled={saving}
                  inputMode="tel"
                  placeholder="Phone digits"
                  className="min-w-0 flex-1 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                />
              </div>
              {userEmail ? (
                <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Signed in as {userEmail}
                </div>
              ) : null}
            </div>

            <div>
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                County / Region
              </label>
              <select
                value={county}
                onChange={(event) => setCounty(event.target.value)}
                disabled={saving || !countryOfResidence}
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
              >
                <option value="">
                  {countryOfResidence ? "Select a county / region" : "Select country first"}
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
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Town / City
              </label>
              <input
                value={town}
                onChange={(event) => setTown(event.target.value)}
                disabled={saving}
                placeholder="e.g. Westlands, Eldoret, Kampala"
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
              />
            </div>
          </div>
        </section>

        <section className="mt-6 border-t border-zinc-200/80 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Current process (optional)
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            This helps us route you faster, but it will not block entry.
          </p>

          <div className="mt-4 grid gap-3">
            {PROCESS_OPTIONS.map((option) => (
              <ChoiceCard
                key={option.key}
                active={process === option.key}
                title={option.label}
                description={
                  option.key === "exploring"
                    ? "Browse freely without setting a track."
                    : "Set your track now and add a country if you want."
                }
                icon={option.Icon}
                disabled={saving}
                onClick={() => {
                  setError("");
                  setProcess(option.key);
                  setCountryChoice("");
                  setCountryCustom("");

                  if (option.key === "study" || option.key === "work" || option.key === "travel") {
                    void logAnalyticsEvent({
                      uid,
                      eventType: ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED,
                      eventKey: buildTrackEventKey(
                        ANALYTICS_EVENT_TYPES.JOURNEY_TRACK_SELECTED,
                        option.key
                      ),
                      trackType: option.key,
                      sourceScreen: "SetupProfileJourneyScreen",
                    });
                  }
                }}
              />
            ))}
          </div>

          {showJourneySetup ? (
            <div className="mt-5 border-t border-zinc-200/70 pt-5 dark:border-zinc-800">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Journey details
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Journey country
                </label>
                <select
                  value={countryChoice}
                  onChange={(event) => {
                    setError("");
                    setCountryChoice(event.target.value);
                    if (event.target.value !== "__other__") setCountryCustom("");
                  }}
                  disabled={saving || countriesLoading}
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                >
                  <option value="">
                    {countriesLoading ? "Loading countries..." : t("select_country")}
                  </option>
                  {countries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                  <option value="__other__">Other / Not listed</option>
                </select>

                {usingOther ? (
                  <div className="mt-3">
                    <input
                      value={countryCustom}
                      onChange={(event) => setCountryCustom(event.target.value)}
                      disabled={saving}
                      placeholder="Type your country"
                      className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                    />
                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Supported-country routing works best with listed destinations, but this field is optional.
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Current stage
                </label>
                <input
                  value={stage}
                  onChange={(event) => setStage(event.target.value)}
                  disabled={saving}
                  placeholder="e.g. Visa submitted"
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100"
                />
              </div>
            </div>
          ) : null}
        </section>

        <div className="mt-6">
          <button
            type="button"
            onClick={saveAndContinue}
            disabled={saving}
            className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
          >
            {saving ? "Saving..." : t("continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

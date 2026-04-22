import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { useI18n } from "../lib/i18n";
import { getUserState, updateUserProfile } from "../services/userservice";
import FileAccessImage from "../components/FileAccessImage";
import { uploadUserProfilePhoto } from "../services/profilePhotoService";
import { smartBack } from "../utils/navBack";
import { KENYA_COUNTY_OPTIONS, normalizeCountyName } from "../constants/kenyaCounties";
import { EAST_AFRICA_RESIDENCE_COUNTRIES } from "../constants/eastAfricaProfile";
import {
  PROFILE_LANGUAGE_OPTIONS,
  getDefaultLanguageForCountry,
  normalizeProfileLanguage,
} from "../utils/userProfile";

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

// ✅ Kenya normalization: accepts 0712..., 712..., +254712..., 254712...
function normalizeKenyaPhone(raw) {
  const digits = onlyDigits(raw);
  let local = digits;

  if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
  if (local.startsWith("0") && local.length >= 10) local = local.slice(1);

  local = local.slice(-9);

  if (!/^(7|1)\d{8}$/.test(local)) {
    throw new Error(
      "Kenya phone must be 9 digits starting with 7 or 1. Example: +254712345678"
    );
  }

  return `+254${local}`;
}

function validateNonKenyaPhone(raw) {
  const cleaned = String(raw || "").trim().replace(/\s+/g, "");
  if (!cleaned) throw new Error("Please enter your phone/WhatsApp.");
  if (onlyDigits(cleaned).length < 8) throw new Error("Phone number looks too short.");
  return cleaned;
}

export default function EditProfileScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [residence, setResidence] = useState("");
  const [language, setLanguage] = useState("");
  const [phone, setPhone] = useState("");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [nextProfilePhotoFile, setNextProfilePhotoFile] = useState(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const languageTouchedRef = useRef(false);

  // originals (for "changed" detection + reset)
  const originalRef = useRef({
    name: "",
    residence: "",
    language: "",
    phone: "",
    county: "",
    town: "",
  });

  const isKenya = residence === "Kenya";

  const isDirty = useMemo(() => {
    const o = originalRef.current;
    return (
      normalizeName(name) !== normalizeName(o.name) ||
      String(residence || "") !== String(o.residence || "") ||
      String(language || "") !== String(o.language || "") ||
      String(phone || "").trim() !== String(o.phone || "").trim() ||
      String(county || "").trim() !== String(o.county || "").trim() ||
      String(town || "").trim() !== String(o.town || "").trim() ||
      nextProfilePhotoFile instanceof File
    );
  }, [name, residence, language, phone, county, town, nextProfilePhotoFile]);

  useEffect(() => {
    if (!residence) return;
    const suggestedLanguage = getDefaultLanguageForCountry(residence);
    if (suggestedLanguage && (!String(language || "").trim() || !languageTouchedRef.current)) {
      setLanguage(suggestedLanguage);
    }
  }, [language, residence]);

  useEffect(() => {
    if (!(nextProfilePhotoFile instanceof File)) {
      setLocalPreviewUrl("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(nextProfilePhotoFile);
    setLocalPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [nextProfilePhotoFile]);

  // ✅ Soft auth init (reduces “random logout feeling” on resume)
  useEffect(() => {
    let alive = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!alive) return;

      // Give it a moment on cold start/resume
      if (!user) {
        setTimeout(() => {
          if (!alive) return;
          if (!auth.currentUser) navigate("/login", { replace: true });
        }, 800);
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");

      try {
        const s = await getUserState(user.uid);
        if (!alive) return;

        const n = s?.name || "";
        const r = s?.profile?.homeCountry || s?.countryOfResidence || "";
        const l =
          normalizeProfileLanguage(s?.profile?.language, "") ||
          getDefaultLanguageForCountry(r) ||
          "";
        const p = s?.phone || "";
        const cty = s?.county || "";
        const twn = s?.town || "";
        const photo = s?.profilePhoto || null;

        setName(n);
        setResidence(r);
        setLanguage(l);
        setPhone(p);
        setCounty(cty);
        setTown(twn);
        setProfilePhoto(photo);
        languageTouchedRef.current = Boolean(normalizeProfileLanguage(s?.profile?.language, ""));

        originalRef.current = {
          name: n,
          residence: r,
          language: l,
          phone: p,
          county: cty,
          town: twn,
        };
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load profile.");
      } finally {
        if (alive) setLoading(false);
      }
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [navigate]);

  const reset = () => {
    const o = originalRef.current;
    setName(o.name || "");
    setResidence(o.residence || "");
    setLanguage(o.language || "");
    setPhone(o.phone || "");
    setCounty(o.county || "");
    setTown(o.town || "");
    setNextProfilePhotoFile(null);
    setErr("");
  };

  const save = async () => {
    if (!uid) return;
    if (saving) return;

    setErr("");

    try {
      const cleanName = normalizeName(name);
      if (!cleanName) throw new Error("Name is required.");
      if (!String(residence || "").trim()) throw new Error("Select country of residence.");
      const cleanLanguage = normalizeProfileLanguage(language, "");
      if (!cleanLanguage) throw new Error("Select language.");

      let finalPhone = String(phone || "").trim();

      if (finalPhone) {
        if (residence === "Kenya") {
          finalPhone = normalizeKenyaPhone(finalPhone);
        } else {
          finalPhone = validateNonKenyaPhone(finalPhone);
        }
      }

      setSaving(true);

      await updateUserProfile(uid, {
        name: cleanName,
        language: cleanLanguage,
        phone: finalPhone,
        countryOfResidence: String(residence || "").trim(),
        homeCountry: String(residence || "").trim(),
        county: normalizeCountyName(county),
        town: String(town || "").trim(),
      });

      if (nextProfilePhotoFile instanceof File) {
        const uploadedPhoto = await uploadUserProfilePhoto(uid, nextProfilePhotoFile);
        setProfilePhoto(uploadedPhoto);
        setNextProfilePhotoFile(null);
      }

      // update local originals
      originalRef.current = {
        name: cleanName,
        residence,
        language: cleanLanguage,
        phone: finalPhone,
        county: normalizeCountyName(county),
        town: String(town || "").trim(),
      };

      navigate("/app/profile", { replace: true });
    } catch (e) {
      setErr(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Loading…
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300 dark:text-zinc-400">
              Fetching your profile.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const topBg =
    "bg-gradient-to-b from-emerald-50/60 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const glass =
    "border border-white/40 bg-white/55 dark:bg-zinc-900/60 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.10)] dark:border-zinc-800/70 dark:bg-zinc-900/55";
  const avatarFallback = (
    <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-700 dark:text-zinc-200">
      {(name || email || "U").trim().slice(0, 1).toUpperCase() || "U"}
    </div>
  );

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-xl px-5 pb-10 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => smartBack(navigate, "/app/home")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
            type="button"
          >
            ← Back
          </button>

          <div className="text-right">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Signed in as</div>
            <div className="max-w-[220px] truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {email || "—"}
            </div>
          </div>
        </div>

        <div className={`mt-5 rounded-3xl ${glass} p-5`}>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Edit profile
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Keep your details correct for faster application filling.
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {/* Form */}
          <div className="mt-5 grid gap-4">
            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Profile photo
              </div>
              <div className="mt-3 flex items-center gap-4">
                <div className="h-20 w-20 overflow-hidden rounded-full border border-zinc-200/80 bg-white/75 dark:border-zinc-700 dark:bg-zinc-950/40">
                  {localPreviewUrl ? (
                    <img src={localPreviewUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <FileAccessImage
                      file={profilePhoto}
                      alt=""
                      className="h-full w-full object-cover"
                      fallback={avatarFallback}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white/75 px-3 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-900">
                    Choose image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!(file instanceof File)) return;
                        setNextProfilePhotoFile(file);
                      }}
                    />
                  </label>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    JPG, PNG, or WEBP. We compress and store the latest image in your private bucket.
                  </div>
                  {nextProfilePhotoFile ? (
                    <div className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      Ready to upload: {nextProfilePhotoFile.name}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Full name
              </div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                autoComplete="name"
                autoCapitalize="words"
                autoCorrect="on"
                spellCheck={false}
                enterKeyHint="next"
                className="mt-2 w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Country of residence / home country
              </div>
              <select
                value={residence}
                onChange={(e) => setResidence(e.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
              >
                <option value="">Select…</option>
                {EAST_AFRICA_RESIDENCE_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Language
              </div>
              <select
                value={language}
                onChange={(e) => {
                  languageTouchedRef.current = true;
                  setLanguage(e.target.value);
                }}
                className="mt-2 w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
              >
                <option value="">Select language</option>
                {PROFILE_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Phone / WhatsApp (optional)
              </div>

              {isKenya ? (
                <>
                  <div className="mt-2 flex gap-2">
                    <div className="shrink-0 rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100">
                      +254
                    </div>
                    <input
                      value={phone}
                      onChange={(e) => {
                        // allow people to paste anything; we normalize on save.
                        setPhone(e.target.value);
                      }}
                      placeholder="712345678 (or paste +254712...)"
                      inputMode="tel"
                      autoComplete="tel"
                      enterKeyHint="done"
                      className="w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    />
                  </div>
                </>
              ) : (
                <>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +2567..., +2557..., +1..."
                    inputMode="tel"
                    autoComplete="tel"
                    enterKeyHint="done"
                    className="mt-2 w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                </>
              )}

              {residence ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">({residence})</div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Preferred county
              </div>
              <select
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                className="mt-2 w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
              >
                <option value="">Select county (optional)</option>
                {KENYA_COUNTY_OPTIONS.map((countyName) => (
                  <option key={countyName} value={countyName}>
                    {countyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl border border-white/40 bg-white/55 dark:bg-zinc-900/60 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
              <div className="text-[11px] font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
                Preferred town / city (optional)
              </div>
              <input
                value={town}
                onChange={(e) => setTown(e.target.value)}
                placeholder="e.g. Westlands, Eldoret, Kisumu CBD"
                enterKeyHint="done"
                className="mt-2 w-full rounded-xl border border-zinc-200/80 bg-white/75 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            {/* Actions */}
            <div className="mt-1 grid gap-3">
              <button
                onClick={save}
                disabled={saving || !isDirty}
                className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                type="button"
              >
                {saving ? "Saving…" : isDirty ? "Save changes" : "No changes"}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={reset}
                  disabled={saving || !isDirty}
                  className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm active:scale-[0.99] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
                  type="button"
                >
                  Reset
                </button>

                <button
                  onClick={() => navigate("/app/profile", { replace: true })}
                  disabled={saving}
                  className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm active:scale-[0.99] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
                  type="button"
                >
                  {t("cancel")}
                </button>
              </div>

              <div className="text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                Profile edits save to your account immediately.
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

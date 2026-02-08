import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import { auth } from "../firebase";
import { getUserState, updateUserProfile } from "../services/userservice";
import ThemeToggle from "../components/ThemeToggle";

const RESIDENCE_COUNTRIES = [
  "Kenya",
  "Uganda",
  "Tanzania",
  "Rwanda",
  "Burundi",
  "South Sudan",
  "Ethiopia",
  "Somalia",
  "DRC",
  "Other",
];

// ✅ simple dial codes (you can expand later)
const DIAL_BY_COUNTRY = {
  Kenya: "+254",
  Uganda: "+256",
  Tanzania: "+255",
  Rwanda: "+250",
  Burundi: "+257",
  "South Sudan": "+211",
  Ethiopia: "+251",
  Somalia: "+252",
  DRC: "+243",
};

/* -------- Minimal icons (no emojis) -------- */
function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 12.2a4.2 4.2 0 1 0-4.2-4.2 4.2 4.2 0 0 0 4.2 4.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 20.2a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m6.5 8.5 5.2 4a1 1 0 0 0 1.2 0l5.1-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.3 3.8 9.6 3c.6-.2 1.2.1 1.4.6l1.2 2.8c.2.5 0 1.1-.5 1.4l-1.6 1c.8 1.7 2.2 3.1 3.9 3.9l1-1.6c.3-.5.9-.7 1.4-.5l2.8 1.2c.6.3.8.9.6 1.4l-.8 2.3c-.2.6-.8 1-1.5 1C10.6 21.5 2.5 13.4 2.5 4.9c0-.6.4-1.2 1-1.5l2.8-1c.3-.1.7 0 1 .4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFlag(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 22V3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 4h10l-1.4 3L16 10H6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconEdit(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 20h4l10.5-10.5a1.5 1.5 0 0 0 0-2.1l-1.9-1.9a1.5 1.5 0 0 0-2.1 0L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6.5 17.5 10.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m6 12.5 3.2 3.2L18 7.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLogout(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 9.5 3 12l3.5 2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShield(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5 19 6.7v6.5c0 4.3-3 8.2-7 9.3-4-1.1-7-5-7-9.3V6.7L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9.3 12.4 1.8 1.8 3.8-4.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FieldShell({ icon: Icon, label, children }) {
  return (
    <div
      className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur
                    dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/60 text-emerald-700
                         dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-300"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {label}
          </div>
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ----------------- helpers (new) ----------------- */
function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeResidencePhone(residence, dial, localDigitsOrFull) {
  const r = String(residence || "").trim();

  // Kenya strict: +254 + 9 digits (starting 7 or 1)
  if (r === "Kenya") {
    const digits = onlyDigits(localDigitsOrFull);
    // if user pasted full 254..., trim it down to last 9 when possible
    let local = digits;
    if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
    if (local.startsWith("0") && local.length >= 10) local = local.slice(1);
    return `${dial}${local}`;
  }

  // others: store as typed, but normalize spaces
  return String(localDigitsOrFull || "").trim().replace(/\s+/g, "");
}

function validateProfile({ draftName, residence, dial, draftPhoneLocal, draftPhoneAny }) {
  const name = String(draftName || "").trim();
  if (name.length < 3) return "Full name must be at least 3 characters.";

  const r = String(residence || "").trim();
  if (!r) return "Please select your country of residence.";

  if (r === "Kenya") {
    const localDigits = onlyDigits(draftPhoneLocal);
    if (!localDigits) return "Please enter your phone number.";
    if (!/^(7|1)\d{8}$/.test(localDigits)) {
      return "Kenya phone must be 9 digits (starting with 7 or 1). Example: +2547XXXXXXXX";
    }
    return "";
  }

  const any = String(draftPhoneAny || "").trim();
  if (!any) return "Please enter your phone/WhatsApp.";
  // light check: must contain at least 8 digits total
  if (onlyDigits(any).length < 8) return "Phone number looks too short.";
  return "";
}

export default function ProfileScreen() {
  const navigate = useNavigate();
  const ADMIN_EMAIL = "brioneroo@gmail.com";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  // view fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");

  // edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftResidence, setDraftResidence] = useState("");

  // ✅ phone drafts (new)
  const [draftPhoneLocal, setDraftPhoneLocal] = useState(""); // for Kenya (9 digits)
  const [draftPhoneAny, setDraftPhoneAny] = useState(""); // for non-Kenya (full)

  const isAdmin = useMemo(() => {
    return (email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }, [email]);

  const initials = useMemo(() => {
    const base = (name || email || "U").trim();
    const parts = base.split(" ").filter(Boolean);
    const first = parts[0]?.[0] || base[0] || "U";
    const second = parts[1]?.[0] || "";
    return (first + second).toUpperCase();
  }, [name, email]);

  const dialCode = useMemo(() => {
    const r = String(draftResidence || countryOfResidence || "").trim();
    return DIAL_BY_COUNTRY[r] || "";
  }, [draftResidence, countryOfResidence]);

  const isKenya = useMemo(() => {
    const r = String(draftResidence || countryOfResidence || "").trim();
    return r === "Kenya";
  }, [draftResidence, countryOfResidence]);

  const completion = useMemo(() => {
    const checks = [
      Boolean((name || "").trim()),
      Boolean((phone || "").trim()),
      Boolean((countryOfResidence || "").trim()),
    ];
    const done = checks.filter(Boolean).length;
    const total = checks.length;
    const pct = Math.round((done / total) * 100);
    return { done, total, pct };
  }, [name, phone, countryOfResidence]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");

      try {
        const s = await getUserState(user.uid);

        const n = s?.name || "";
        const p = s?.phone || "";
        const c = s?.countryOfResidence || "";

        setName(n);
        setPhone(p);
        setCountryOfResidence(c);

        setDraftName(n);
        setDraftResidence(c);

        // ✅ seed phone drafts:
        // if Kenya +254..., extract local 9 digits
        if (c === "Kenya") {
          const digits = onlyDigits(p);
          let local = digits;
          if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
          if (local.startsWith("0") && local.length >= 10) local = local.slice(1);
          local = local.slice(-9);
          setDraftPhoneLocal(local);
          setDraftPhoneAny("");
        } else {
          setDraftPhoneAny(p);
          setDraftPhoneLocal("");
        }
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  const save = async () => {
    if (!uid) return;

    setErr("");

    const validationError = validateProfile({
      draftName,
      residence: draftResidence,
      dial: dialCode,
      draftPhoneLocal,
      draftPhoneAny,
    });

    if (validationError) return setErr(validationError);

    const finalPhone = isKenya
      ? normalizeResidencePhone("Kenya", dialCode || "+254", draftPhoneLocal)
      : normalizeResidencePhone(draftResidence, dialCode, draftPhoneAny);

    setSaving(true);
    try {
      await updateUserProfile(uid, {
        name: String(draftName || "").trim(),
        phone: finalPhone,
        countryOfResidence: String(draftResidence || "").trim(),
      });

      setName(String(draftName || "").trim());
      setPhone(finalPhone);
      setCountryOfResidence(String(draftResidence || "").trim());

      setIsEditing(false);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    navigate("/login", { replace: true });
  };

  const cancelEdit = () => {
    setDraftName(name || "");
    setDraftResidence(countryOfResidence || "");

    if ((countryOfResidence || "") === "Kenya") {
      const digits = onlyDigits(phone);
      let local = digits;
      if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
      if (local.startsWith("0") && local.length >= 10) local = local.slice(1);
      local = local.slice(-9);
      setDraftPhoneLocal(local);
      setDraftPhoneAny("");
    } else {
      setDraftPhoneAny(phone || "");
      setDraftPhoneLocal("");
    }

    setIsEditing(false);
    setErr("");
  };

  // when residence changes while editing, swap input mode safely
  useEffect(() => {
    if (!isEditing) return;

    if (draftResidence === "Kenya") {
      // try to extract local 9 digits from whatever was in "any"
      const digits = onlyDigits(draftPhoneAny);
      let local = digits;
      if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
      if (local.startsWith("0") && local.length >= 10) local = local.slice(1);
      local = local.slice(-9);
      setDraftPhoneLocal(local);
      setDraftPhoneAny("");
    } else {
      // if leaving Kenya, move to full input
      if (draftPhoneAny) return;
      const localDigits = onlyDigits(draftPhoneLocal);
      if (localDigits) {
        const dial = DIAL_BY_COUNTRY["Kenya"] || "+254";
        setDraftPhoneAny(`${dial}${localDigits}`);
      } else {
        setDraftPhoneAny(phone || "");
      }
      setDraftPhoneLocal("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftResidence, isEditing]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="animate-pulse rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="h-6 w-28 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-2 h-4 w-64 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-6 h-24 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-4 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-3 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </div>
    );
  }

  const topBg =
    "bg-gradient-to-b from-emerald-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-xl px-5 pb-10 pt-6">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Profile
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Keep your details updated so we can support you faster.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* ✅ Theme toggle */}
            <ThemeToggle />

            {isAdmin ? (
              <button
                onClick={() => navigate("/app/admin")}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-100
                           dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-emerald-200 dark:hover:bg-zinc-900"
              >
                <IconShield className="h-5 w-5" />
                Admin tools
              </button>
            ) : null}

            <button
             onClick={() => navigate("/app/settings")}
             className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-white
             dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
             Settings
           </button>

            <button
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-white
                         dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              <IconLogout className="h-5 w-5" />
              Logout
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {/* Hero card */}
        <div className="mt-6 rounded-3xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-lg font-bold text-emerald-800
                                dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  {initials}
                </div>
                {isAdmin ? (
                  <span className="absolute -bottom-2 -right-2 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800
                                   dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-emerald-200">
                    Admin
                  </span>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {name?.trim() ? name : "Your name"}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <IconMail className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                  <span className="truncate">{email || "—"}</span>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-300">
                    <span>Profile completion</span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {completion.pct}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${completion.pct}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {completion.done}/{completion.total} required fields completed
                  </div>
                </div>
              </div>
            </div>

            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
              >
                <IconEdit className="h-5 w-5" />
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {/* Fields */}
        <div className="mt-5 grid gap-3">
          <FieldShell icon={IconUser} label="Full name (required)">
            {!isEditing ? (
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {name?.trim() ? name : "Not set"}
              </div>
            ) : (
              <div className="grid gap-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                             dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Minimum 3 characters.
                </div>
              </div>
            )}
          </FieldShell>

          <FieldShell icon={IconFlag} label="Country of residence (required)">
            {!isEditing ? (
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {countryOfResidence?.trim() ? countryOfResidence : "Not set"}
              </div>
            ) : (
              <select
                value={draftResidence}
                onChange={(e) => setDraftResidence(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                           dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
              >
                <option value="">Select…</option>
                {RESIDENCE_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </FieldShell>

          <FieldShell icon={IconPhone} label="Phone / WhatsApp (required)">
            {!isEditing ? (
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {phone?.trim() ? phone : "Not set"}
              </div>
            ) : isKenya ? (
              <div className="grid gap-2">
                <div className="flex gap-2">
                  <div
                    className="shrink-0 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-900
                               dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                  >
                    {dialCode || "+254"}
                  </div>

                  <input
                    value={draftPhoneLocal}
                    onChange={(e) => setDraftPhoneLocal(onlyDigits(e.target.value).slice(0, 9))}
                    placeholder="9 digits (e.g. 712345678)"
                    inputMode="numeric"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                               dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Kenya format: 9 digits starting with <span className="font-semibold">7</span> or{" "}
                  <span className="font-semibold">1</span>. We’ll save it as{" "}
                  <span className="font-semibold">{dialCode || "+254"}XXXXXXXXX</span>.
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <input
                  value={draftPhoneAny}
                  onChange={(e) => setDraftPhoneAny(e.target.value)}
                  placeholder="e.g. +2567..., +2557..., +1..."
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                             dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Tip: include your country code (start with <span className="font-semibold">+</span>).
                </div>
              </div>
            )}
          </FieldShell>
        </div>

        {/* Actions tile (scrolls normally) */}
        {isEditing ? (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="flex gap-3">
              <button
                onClick={cancelEdit}
                disabled={saving}
                className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 disabled:opacity-60
                           dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-950"
              >
                Cancel
              </button>

              <button
                onClick={save}
                disabled={saving}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <IconCheck className="h-5 w-5" />
                  {saving ? "Saving..." : "Save changes"}
                </span>
              </button>
            </div>

            <div className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Tip: keep your profile updated to automatically fill up your credentials.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
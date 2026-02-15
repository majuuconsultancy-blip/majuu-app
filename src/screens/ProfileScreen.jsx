// ✅ ProfileScreen.jsx (FULL COPY-PASTE)
// CHANGE ONLY:
// - Replace ALL custom SVG icons with legit Lucide icons
// - Keep your earlier change: REMOVE flag/nationality + phone from HERO tile (already removed below)
// Everything else untouched.

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import {
  Mail,
  Pencil,
  Check,
  LogOut,
  Settings,
  ShieldCheck,
  Phone,
  Flag,
  ChevronRight,
} from "lucide-react";

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

/* ----------------- helpers ----------------- */
function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}
function normalizeResidencePhone(residence, dial, localDigitsOrFull) {
  const r = String(residence || "").trim();
  if (r === "Kenya") {
    const digits = onlyDigits(localDigitsOrFull);
    let local = digits;
    if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
    if (local.startsWith("0") && local.length >= 10) local = local.slice(1);
    return `${dial}${local}`;
  }
  return String(localDigitsOrFull || "").trim().replace(/\s+/g, "");
}
function validateProfile({ draftName, residence, draftPhoneLocal, draftPhoneAny }) {
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
  if (onlyDigits(any).length < 8) return "Phone number looks too short.";
  return "";
}

/* ---------- Motion ---------- */
const overlay = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

const modal = {
  hidden: { opacity: 0, y: 28, scale: 0.985 },
  show: {
    opacity: 1,
    y: 18,
    scale: 1,
    transition: { type: "spring", stiffness: 520, damping: 40 },
  },
  exit: { opacity: 0, y: 24, scale: 0.985, transition: { duration: 0.16 } },
};

const pageIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" } },
};

const floatCard = {
  rest: { y: 0, scale: 1 },
  hover: { y: -2, scale: 1.01, transition: { duration: 0.18 } },
  tap: { scale: 0.99 },
};

export default function ProfileScreen() {
  const navigate = useNavigate();
  const ADMIN_EMAIL = "brioneroo@gmail.com";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");

  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftResidence, setDraftResidence] = useState("");

  const [draftPhoneLocal, setDraftPhoneLocal] = useState("");
  const [draftPhoneAny, setDraftPhoneAny] = useState("");

  const [busy, setBusy] = useState("");

  const isAdmin = useMemo(
    () => (email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase(),
    [email]
  );

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

  useEffect(() => {
    if (!isEditing) return;

    if (draftResidence === "Kenya") {
      const digits = onlyDigits(draftPhoneAny);
      let local = digits;
      if (local.startsWith("254") && local.length >= 12) local = local.slice(3);
      if (local.startsWith("0") && local.length >= 10) local = local.slice(1);
      local = local.slice(-9);
      setDraftPhoneLocal(local);
      setDraftPhoneAny("");
    } else {
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

  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e) => {
      if (e.key === "Escape" && !saving) cancelEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, saving]);

  useEffect(() => {
    if (!isEditing) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isEditing]);

  const openEdit = () => {
    setErr("");
    setIsEditing(true);
  };

  const save = async () => {
    if (!uid) return;
    setErr("");

    const validationError = validateProfile({
      draftName,
      residence: draftResidence,
      draftPhoneLocal,
      draftPhoneAny,
    });
    if (validationError) return setErr(validationError);

    const finalPhone =
      String(draftResidence || "").trim() === "Kenya"
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
    try {
      setBusy("logout");
      await signOut(auth);
      navigate("/login", { replace: true });
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="animate-pulse rounded-3xl border border-zinc-200 bg-white/70 p-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
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
    "bg-gradient-to-b from-emerald-50/60 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const glass =
    "border border-white/40 bg-white/55 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.10)] dark:border-zinc-800/70 dark:bg-zinc-900/55";

  const tile = `rounded-2xl ${glass} transition will-change-transform`;
  const tileHover =
    "hover:shadow-[0_20px_60px_rgba(0,0,0,0.14)] hover:border-emerald-200/60 dark:hover:border-emerald-900/40";

  const actionCard = `${tile} ${tileHover} p-4 text-left`;

  const adminCard =
    "rounded-2xl border border-emerald-200/70 bg-emerald-50/55 backdrop-blur-xl p-4 shadow-[0_14px_40px_rgba(16,185,129,0.18)] transition hover:bg-emerald-50/70 hover:shadow-[0_22px_70px_rgba(16,185,129,0.22)] active:scale-[0.99] dark:border-emerald-900/45 dark:bg-emerald-950/28";

  const logoutCard =
    "rounded-2xl border border-rose-200/70 bg-rose-50/45 backdrop-blur-xl p-4 shadow-[0_14px_40px_rgba(244,63,94,0.12)] transition hover:bg-rose-50/60 hover:shadow-[0_22px_70px_rgba(244,63,94,0.16)] active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/22";

  const chevron = "text-zinc-400 dark:text-zinc-500 text-xl leading-none";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <motion.div
        variants={pageIn}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-xl px-5 pb-10 pt-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Profile
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Your details, preferences, and quick actions.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <ThemeToggle />
          </div>
        </div>

        {err && !isEditing ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {/* Hero */}
        <motion.div
          className={`mt-6 rounded-3xl ${glass} p-5`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="relative">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-lg font-bold text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  {initials}
                </div>
                {isAdmin ? (
                  <span className="absolute -bottom-2 -right-2 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/45 dark:bg-emerald-950/30 dark:text-emerald-200">
                    Admin
                  </span>
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {name?.trim() ? name : "Your name"}
                </div>

                <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <Mail className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                  <span className="truncate">{email || "—"}</span>
                </div>

                {/* ✅ REMOVED: flag/nationality + phone badge from hero tile */}
              </div>
            </div>

            <motion.button
              type="button"
              onClick={openEdit}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <Pencil className="h-5 w-5" />
              Edit
            </motion.button>
          </div>
        </motion.div>

        {/* Info tiles (saved values) */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <motion.div
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={`${tile} p-4`}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                <Flag className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Residence
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {countryOfResidence?.trim() ? countryOfResidence : "Not set"}
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={`${tile} p-4`}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                <Phone className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Phone / WhatsApp
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {phone?.trim() ? phone : "Not set"}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Quick actions */}
        <div className="mt-4 grid gap-2">
          {isAdmin ? (
            <motion.button
              type="button"
              onClick={() => navigate("/app/admin")}
              variants={floatCard}
              initial="rest"
              whileHover="hover"
              whileTap="tap"
              className={`${adminCard} text-left`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/45 dark:bg-emerald-950/28 dark:text-emerald-200">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                      Admin tools
                    </div>
                    <div className="mt-0.5 text-xs text-emerald-900/70 dark:text-emerald-200/80">
                      Manage requests, users, and staff.
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-emerald-700/70 dark:text-emerald-200/80" />
              </div>
            </motion.button>
          ) : null}

          <motion.button
            type="button"
            onClick={() => navigate("/app/settings")}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={`${actionCard}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <Settings className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Settings
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Preferences and app options.
                  </div>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-zinc-400 dark:text-zinc-500" />
            </div>
          </motion.button>

          <motion.button
            type="button"
            onClick={logout}
            disabled={busy === "logout"}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={`${logoutCard} text-left`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200/80 bg-rose-50/70 text-rose-700 dark:border-rose-900/45 dark:bg-rose-950/24 dark:text-rose-200">
                  <LogOut className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                    {busy === "logout" ? "Logging out…" : "Logout"}
                  </div>
                  <div className="mt-0.5 text-xs text-rose-700/70 dark:text-rose-200/80">
                    Sign out of your account.
                  </div>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-rose-400 dark:text-rose-300" />
            </div>
          </motion.button>
        </div>
      </motion.div>

      {/* ✅ FIXED EDIT SHEET (unchanged, only icon swap for Save button) */}
      <AnimatePresence>
        {isEditing ? (
          <motion.div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            variants={overlay}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <button
              type="button"
              aria-label="Close edit"
              onClick={() => !saving && cancelEdit()}
              className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            />

            <motion.div
              variants={modal}
              initial="hidden"
              animate="show"
              exit="exit"
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => e.stopPropagation()}
              className="
                relative w-full
                max-w-[380px]
                overflow-hidden
                rounded-[26px]
                border border-white/40
                bg-white/75
                shadow-[0_30px_90px_rgba(0,0,0,0.35)]
                backdrop-blur-xl
                dark:border-zinc-800/70 dark:bg-zinc-900/70
                flex flex-col
              "
              style={{
                maxHeight: "calc(100dvh - 180px)",
              }}
            >
              <div className="shrink-0 border-b border-white/40 bg-white/65 px-4 py-4 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-900/65">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                      Edit profile
                    </div>
                    <div className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                      Update your details
                    </div>
                  </div>

                  <motion.button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    whileTap={{ scale: 0.98 }}
                    className="rounded-2xl border border-white/40 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white active:scale-[0.99] disabled:opacity-60
                               dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                  >
                    Close
                  </motion.button>
                </div>

                {err ? (
                  <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
                    {err}
                  </div>
                ) : null}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="grid gap-3">
                  <div className="rounded-2xl border border-white/40 bg-white/55 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Full name
                    </div>
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="Enter your full name"
                      className="mt-2 w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                                 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    />
                  </div>

                  <div className="rounded-2xl border border-white/40 bg-white/55 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Country of residence
                    </div>
                    <select
                      value={draftResidence}
                      onChange={(e) => setDraftResidence(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                                 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                    >
                      <option value="">Select…</option>
                      {RESIDENCE_COUNTRIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-white/40 bg-white/55 p-3 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/30">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Phone / WhatsApp
                    </div>

                    {isKenya ? (
                      <div className="mt-2 grid gap-2">
                        <div className="flex gap-2">
                          <div className="shrink-0 rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100">
                            {dialCode || "+254"}
                          </div>
                          <input
                            value={draftPhoneLocal}
                            onChange={(e) => setDraftPhoneLocal(onlyDigits(e.target.value).slice(0, 9))}
                            placeholder="9 digits (e.g. 712345678)"
                            inputMode="numeric"
                            className="w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                                       dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                          />
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          Kenya format: 9 digits starting with <span className="font-semibold">7</span>{" "}
                          or <span className="font-semibold">1</span>.
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 grid gap-2">
                        <input
                          value={draftPhoneAny}
                          onChange={(e) => setDraftPhoneAny(e.target.value)}
                          placeholder="e.g. +2567..., +2557..., +1..."
                          className="w-full rounded-xl border border-white/50 bg-white/75 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4
                                     dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                        />
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          Tip: include your country code (start with <span className="font-semibold">+</span>).
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-emerald-200/60 bg-emerald-50/50 p-3 backdrop-blur-xl dark:border-emerald-900/40 dark:bg-emerald-950/20">
                    <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      Currently saved
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-emerald-900/80 dark:text-emerald-200/80">
                      <div className="flex items-center justify-between gap-3">
                        <span className="opacity-80">Residence</span>
                        <span className="font-semibold truncate">{countryOfResidence || "—"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="opacity-80">Phone</span>
                        <span className="font-semibold truncate">{phone || "—"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-white/40 bg-white/65 px-4 py-4 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-900/65">
                <div className="flex gap-3">
                  <motion.button
                    onClick={cancelEdit}
                    disabled={saving}
                    whileTap={{ scale: 0.98 }}
                    className="w-full rounded-2xl border border-white/50 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white disabled:opacity-60
                               dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-950"
                    type="button"
                  >
                    Cancel
                  </motion.button>

                  <motion.button
                    onClick={save}
                    disabled={saving}
                    whileTap={{ scale: 0.98 }}
                    className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                    type="button"
                  >
                    <span className="inline-flex items-center justify-center gap-2">
                      <Check className="h-5 w-5" />
                      {saving ? "Saving..." : "Save changes"}
                    </span>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
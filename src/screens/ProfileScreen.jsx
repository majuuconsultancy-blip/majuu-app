// ✅ ProfileScreen.jsx (COPY-PASTE — MODAL REMOVED, EDIT -> /app/profile/edit)
// CHANGE:
// ✅ Android/browser back button now goes to TrackScreen (based on active track if available)
// - Adds a safe popstate handler (same style as TrackScreen fix)
// - Optional: uses /app/track/:track route (fallback to /app/track/study)
//
// Build indicator unchanged

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { motion } from "../utils/motionProxy";

import {
  Mail,
  Pencil,
  LogOut,
  Settings,
  ShieldCheck,
  Phone,
  Flag,
  ChevronRight,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD, ICON_LG } from "../constants/iconSizes";

import { auth } from "../firebase";
import { getUserState } from "../services/userservice";
import ThemeToggle from "../components/ThemeToggle";

/* ---------- Motion ---------- */
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
  const [err, setErr] = useState("");

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");

  // ✅ for back target
  const [activeTrack, setActiveTrack] = useState(""); // "study" | "work" | "travel" | ""

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

        // ✅ read activeTrack for back nav (fallback to selectedTrack if you store it)
        const t = String(s?.activeTrack || s?.selectedTrack || "").toLowerCase();
        if (t === "study" || t === "work" || t === "travel") setActiveTrack(t);
        else setActiveTrack("");
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  // ✅ NEW: Android/browser back button should go to TrackScreen
  useEffect(() => {
    // mark this history entry
    try {
      window.history.replaceState(
        { ...(window.history.state || {}), __majuu_profile: true },
        ""
      );
    } catch {}

    const onPopState = (e) => {
      try {
        e.preventDefault?.();
      } catch {}

      const t = activeTrack || "study";
      navigate(`/app/track/${t}`, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, activeTrack]);

  const openEdit = () => {
    // ✅ go to dedicated edit screen (stable keyboard on Android)
    navigate("/app/profile/edit");
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
          <div className="animate-pulse rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
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
    "border border-white/40 bg-white/55 dark:bg-zinc-900/60 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.10)] dark:border-zinc-800/70 dark:bg-zinc-900/55";

  const tile = `rounded-2xl ${glass} transition will-change-transform`;
  const tileHover =
    "hover:shadow-[0_20px_60px_rgba(0,0,0,0.14)] hover:border-emerald-200/60 dark:hover:border-emerald-900/40";

  const actionCard = `${tile} ${tileHover} p-4 text-left`;

  const adminCard =
    "rounded-2xl border border-emerald-200/70 bg-emerald-50/55 backdrop-blur-xl p-4 shadow-[0_14px_40px_rgba(16,185,129,0.18)] transition hover:bg-emerald-50/70 hover:shadow-[0_22px_70px_rgba(16,185,129,0.22)] active:scale-[0.99] dark:border-emerald-900/45 dark:bg-emerald-950/28";

  const logoutCard =
    "rounded-2xl border border-rose-200/70 bg-rose-50/45 backdrop-blur-xl p-4 shadow-[0_14px_40px_rgba(244,63,94,0.12)] transition hover:bg-rose-50/60 hover:shadow-[0_22px_70px_rgba(244,63,94,0.16)] active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/22";

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

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {/* Hero */}
        <motion.div
          className={`mt-6 rounded-3xl ${glass} p-5`}
          initial={{ opacity: 0, y: 8 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.28, ease: "easeOut" },
          }}
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
                  <AppIcon size={ICON_SM} className="text-zinc-500 dark:text-zinc-400" icon={Mail} />
                  <span className="truncate">{email || "—"}</span>
                </div>
              </div>
            </div>

            <motion.button
              type="button"
              onClick={openEdit}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <AppIcon size={ICON_MD} icon={Pencil} />
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
                <AppIcon size={ICON_MD} icon={Flag} />
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
                <AppIcon size={ICON_MD} icon={Phone} />
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
                    <AppIcon size={ICON_MD} icon={ShieldCheck} />
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
                <AppIcon size={ICON_MD} icon={ChevronRight} className="text-emerald-700/70 dark:text-emerald-200/80" />
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
                  <AppIcon size={ICON_MD} icon={Settings} />
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
              <AppIcon size={ICON_MD} icon={ChevronRight} className="text-zinc-400 dark:text-zinc-500" />
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
                  <AppIcon size={ICON_MD} icon={LogOut} />
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
              <AppIcon size={ICON_MD} icon={ChevronRight} className="text-rose-400 dark:text-rose-300" />
            </div>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}


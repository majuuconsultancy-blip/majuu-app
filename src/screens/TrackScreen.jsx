// ✅ TrackScreen.jsx (FULL COPY-PASTE)
// CHANGE ONLY:
// - Removed country icon (Globe2) because per-country map silhouettes aren't practical with Lucide
// - All other icons remain Lucide
// - ✅ NEW: Android/browser back button now always goes to /dashboard
// - ✅ UPDATED: Removed the huge bottom “Go to Tracks” dock button
// - ✅ UPDATED: Added a small “Tracks” button at the top-right of the header card
// Backend untouched (setSelectedTrack + setActiveContext + URL behavior)

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "../utils/motionProxy";

import {
  GraduationCap,
  Briefcase,
  Plane,
  ChevronRight,
  X,
  User,
  Users,
  Compass,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD, ICON_LG } from "../constants/iconSizes";

import { auth } from "../firebase";
import { setActiveContext, setSelectedTrack } from "../services/userservice";

/* ---------- Track config ---------- */
const TRACKS = {
  study: { title: "Study Abroad", Icon: GraduationCap },
  work: { title: "Work Abroad", Icon: Briefcase },
  travel: { title: "Travel Abroad", Icon: Plane },
};

const COUNTRIES = ["Canada", "Australia", "UK", "Germany", "USA"];

/* ---------- Motion presets ---------- */
const overlayMotion = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] } },
};

// sheet-style for mobile, centered modal for bigger screens
const sheetMotion = {
  hidden: { opacity: 0, y: 6, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.17, ease: [0.2, 0.8, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    y: 4,
    scale: 0.99,
    transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] },
  },
};

const listWrap = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.03 } },
};

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
  },
};

export default function TrackScreen({ track }) {
  const navigate = useNavigate();
  const location = useLocation();

  const safeTrack = useMemo(() => (TRACKS[track] ? track : "study"), [track]);

  const [uid, setUid] = useState(null);

  const [startingType, setStartingType] = useState(""); // "self" | "we"
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [statusMsg, setStatusMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user ? user.uid : null);
    });
    return () => unsub();
  }, []);

  // ✅ NEW: Android/browser back button should go to Dashboard from TrackScreen
  useEffect(() => {
    // Make TrackScreen the current history entry (so back triggers popstate cleanly)
    try {
      window.history.replaceState(
        { ...(window.history.state || {}), __majuu_track: true },
        ""
      );
    } catch {}

    const onPopState = (e) => {
      // Force dashboard instead of returning to previous page
      try {
        e.preventDefault?.();
      } catch {}
      navigate("/dashboard", { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const country = params.get("country");
    const from = params.get("from");

    if (country && from === "choice") {
      setSelectedCountry(country);
      setShowModal(true);
    }
  }, [location.search]);

  // Close modal on ESC
  useEffect(() => {
    if (!showModal) return;

    const onKey = (e) => {
      if (e.key === "Escape" && !saving) setShowModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, saving]);

  const openCountry = (country) => {
    setSelectedCountry(country);
    setShowModal(true);
    setStatusMsg("");
    setStartingType("");
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
  };

  // ✅ Go back to Track selection hub
  const goToTracks = () => {
    if (saving) return;
    navigate("/dashboard");
  };

  const startProcessAndGo = async (helpType) => {
    if (!uid) {
      navigate("/login", { replace: true });
      return;
    }
    if (!selectedCountry || saving) return;

    setStartingType(helpType);
    setSaving(true);
    setStatusMsg("Saving your progress…");

    try {
      await setSelectedTrack(uid, safeTrack);

      await setActiveContext(uid, {
        hasActiveProcess: true,
        activeTrack: safeTrack,
        activeCountry: selectedCountry,
        activeHelpType: helpType, // "self" | "we"
      });

      const qs = encodeURIComponent(selectedCountry);

      if (helpType === "self") {
        navigate(`/app/${safeTrack}/self-help?country=${qs}&from=choice`, {
          replace: true,
        });
      } else {
        navigate(`/app/${safeTrack}/we-help?country=${qs}&from=choice`, {
          replace: true,
        });
      }

      setShowModal(false);
    } catch (e) {
      console.error(e);
      setStatusMsg(e?.message || "Failed to save progress.");
    } finally {
      setSaving(false);
      setStartingType("");
    }
  };

  const info = TRACKS[safeTrack];
  const HeaderIcon = info.Icon;

  const topBg =
    "bg-gradient-to-b from-emerald-50/50 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const countryCard =
    "group w-full text-left rounded-3xl border bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm transition will-change-transform";
  const countryCardHover =
    "border-zinc-200 dark:border-zinc-800 hover:border-emerald-200 hover:bg-white hover:shadow-md active:scale-[0.99] hover:-translate-y-[1px]";
  const countryCardDark =
    "dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-900";

  return (
    <div className={`min-h-screen ${topBg}`}>
      {/* ✅ page padding */}
      <div className="px-5 py-6 pb-10 max-w-xl mx-auto">
        {/* Header */}
        <div className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-white/60 dark:bg-zinc-900/60 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/50">
          {/* ✅ small Tracks button (top-right) */}
          <button
            type="button"
            onClick={goToTracks}
            disabled={saving}
            className="absolute right-4 bottom-3 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:bg-white active:scale-[0.99] disabled:opacity-60
                       dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100 dark:hover:bg-zinc-950/45"
            title="Go to Tracks"
          >
            <AppIcon size={ICON_SM} icon={Compass} />
            Tracks
          </button>

          {/* animated glow blob */}
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-300/25 blur-3xl dark:bg-emerald-400/10"
            animate={{ x: [0, -8, 0], y: [0, 10, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute -left-16 -bottom-16 h-44 w-44 rounded-full bg-emerald-200/25 blur-3xl dark:bg-emerald-500/10"
            animate={{ x: [0, 10, 0], y: [0, -8, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative flex items-end justify-between gap-3 pr-24">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 dark:bg-zinc-900/60 border border-emerald-100 dark:bg-zinc-950/40 dark:border-emerald-900/40">
                  <AppIcon
                    size={ICON_SM}
                    icon={HeaderIcon}
                    className="text-emerald-700 dark:text-emerald-200"
                  />
                </span>
                {info.title}
              </div>

              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Choose a country
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Pick your dream destination.
              </p>
            </div>

            <div className="h-4 w-12 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-950/40" />
          </div>
        </div>

        {/* Status */}
        {statusMsg ? (
          <div className="mt-4 rounded-3xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-900 dark:border-emerald-900/30 dark:bg-emerald-950/25 dark:text-emerald-100">
            {statusMsg}
          </div>
        ) : null}

        {/* Countries */}
        <div className="mt-6">
          <div className="flex items-end justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Countries
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {COUNTRIES.length} options
            </span>
          </div>

          <motion.div
            className="mt-3 grid gap-3 sm:grid-cols-2"
            variants={listWrap}
            initial="hidden"
            animate="show"
          >
            {COUNTRIES.map((c) => (
              <motion.button
                key={c}
                type="button"
                onClick={() => openCountry(c)}
                variants={listItem}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                className={`${countryCard} ${countryCardHover} ${countryCardDark}`}
              >
                <div className="relative">
                  {/* subtle shimmer */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl"
                  >
                    <div className="absolute -left-20 top-0 h-full w-24 rotate-12 bg-white/40 dark:bg-zinc-900/60 blur-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:bg-white/10" />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {c}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Tap to choose help mode
                      </div>
                    </div>

                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition group-hover:border-emerald-200 group-hover:bg-emerald-50/70 group-hover:text-emerald-800 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-200 dark:group-hover:border-emerald-900/40 dark:group-hover:bg-emerald-950/25 dark:group-hover:text-emerald-200">
                      <AppIcon size={ICON_MD} icon={ChevronRight} />
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Modal (Animated) */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/35 px-4 motion-modal-backdrop"
            variants={overlayMotion}
            initial="hidden"
            animate="show"
            exit="exit"
            onMouseDown={closeModal}
          >
            <motion.div
              className={[
                "w-full max-w-md rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 p-5 shadow-lg backdrop-blur motion-modal-panel",
                "dark:border-zinc-800 dark:bg-zinc-900/70",
                "sm:mb-0 mb-4",
              ].join(" ")}
              variants={sheetMotion}
              initial="hidden"
              animate="show"
              exit="exit"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                    Selected country
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedCountry}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Choose how you want help.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60
                             dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-950/45"
                  aria-label="Close"
                  title="Close"
                >
                  <AppIcon size={ICON_MD} icon={X} />
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                {/* Self-help (FREE badge) */}
                <button
                  type="button"
                  onClick={() => startProcessAndGo("self")}
                  disabled={saving}
                  className="group w-full rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-left text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-white active:scale-[0.99] disabled:opacity-60
                             dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100 dark:hover:bg-zinc-950/45"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <AppIcon size={ICON_MD} icon={User} className="text-zinc-700 dark:text-zinc-300 dark:text-zinc-200" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span>
                          {saving && startingType === "self" ? "Starting…" : "Self-Help"}
                        </span>
                        <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                          Free
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Steps & checklists you follow on your own.
                      </div>
                    </div>
                  </div>
                </button>

                {/* We-help (primary) */}
                <button
                  type="button"
                  onClick={() => startProcessAndGo("we")}
                  disabled={saving}
                  className="group w-full rounded-3xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/75">
                      <AppIcon size={ICON_MD} icon={Users} className="text-emerald-700" />
                    </span>
                    <div className="min-w-0">
                      <div>{saving && startingType === "we" ? "Starting…" : "We-Help"}</div>
                      <div className="mt-0.5 text-xs font-medium text-white/80">
                        We guide you and work with you end-to-end.
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="w-full rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-4 py-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60
                             dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-950/35"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Your progress is saved automatically.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


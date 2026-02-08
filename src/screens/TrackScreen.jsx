import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { auth } from "../firebase";
import { setActiveContext, setSelectedTrack } from "../services/userservice";
import { useLocation } from "react-router-dom";

/* ---------- Minimal icons ---------- */
function IconStudy(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3.5 8.5 12 4l8.5 4.5L12 13 3.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.2V16c0 1.7 3 3.2 5.5 3.2s5.5-1.5 5.5-3.2v-5.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWork(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 7V6.2A2.2 2.2 0 0 1 11.2 4h1.6A2.2 2.2 0 0 1 15 6.2V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5.5 8.5h13A2 2 0 0 1 20.5 10.5v7A2 2 0 0 1 18.5 19.5h-13A2 2 0 0 1 3.5 17.5v-7A2 2 0 0 1 5.5 8.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTravel(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M2.5 12.5 21.5 7.5l-6.5 5.5 1.8 6-3.3-4-4.5 3 .8-4.8-4.8-.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 5.5 15.5 12 9 18.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClose(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSelf(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 12.5a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 20c1.7-3.2 4.2-5 7.5-5s5.8 1.8 7.5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconWe(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8.5 12a3.2 3.2 0 1 0-3.2-3.2A3.2 3.2 0 0 0 8.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16 12.2a3 3 0 1 0-3-3 3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.8 20c1.2-2.6 3.2-4.2 6-4.2s4.8 1.6 6 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M12.7 16.7c1.1-.6 2.3-.9 3.6-.9 2.2 0 3.9 1 4.9 3.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- Track config ---------- */
const TRACKS = {
  study: { title: "Study Abroad", Icon: IconStudy },
  work: { title: "Work Abroad", Icon: IconWork },
  travel: { title: "Travel Abroad", Icon: IconTravel },
};

const COUNTRIES = ["Canada", "Australia", "UK", "Germany", "USA"];

/* ---------- Motion presets ---------- */
const overlayMotion = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

const modalMotion = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 420, damping: 34 },
  },
  exit: { opacity: 0, y: 10, scale: 0.985, transition: { duration: 0.16 } },
};

export default function TrackScreen({ track }) {
  const navigate = useNavigate();

  const safeTrack = useMemo(() => (TRACKS[track] ? track : "study"), [track]);

  const [uid, setUid] = useState(null);

  const [startingType, setStartingType] = useState(""); // "self" | "we"
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [statusMsg, setStatusMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const location = useLocation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user ? user.uid : null);
    });
    return () => unsub();
  }, []);

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

  const tileBase =
    "group w-full rounded-2xl border border-zinc-200 bg-white/65 backdrop-blur p-4 shadow-sm transition";
  const tileHover =
    "hover:bg-white hover:border-emerald-200 hover:shadow-md active:scale-[0.99]";

  return (
    <div className="min-h-screen">
      {/* ✅ add extra bottom padding so content doesn't hide behind the floating button */}
      <div className="px-5 py-6 pb-40">
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/70 border border-emerald-100">
                <HeaderIcon className="h-4 w-4 text-emerald-700" />
              </span>
              {info.title}
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Choose a country
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Pick your dream country destination.
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {/* Status */}
        {statusMsg ? (
          <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-800">
            {statusMsg}
          </div>
        ) : null}

        {/* Countries */}
        <div className="mt-6">
          <div className="flex items-end justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">Countries</h2>
            <span className="text-xs text-zinc-500">
              {COUNTRIES.length} options
            </span>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {COUNTRIES.map((c) => (
              <button
                key={c}
                onClick={() => openCountry(c)}
                className={`${tileBase} ${tileHover} text-left`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">{c}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Choose help mode
                    </div>
                  </div>

                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/50 text-zinc-700 transition group-hover:border-emerald-200 group-hover:bg-emerald-50/60 group-hover:text-emerald-800">
                    <IconChevronRight className="h-5 w-5" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ✅ Floating button: middle of bottom third (above bottom nav) */}
      <div className="fixed inset-x-0 z-30 flex justify-center pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm px-5">
          <button
            type="button"
            onClick={goToTracks}
            disabled={saving}
            className="
              w-full
              rounded-2xl
              border border-zinc-200
              bg-white/85 backdrop-blur
              px-5 py-3
              text-sm font-semibold text-zinc-900
              shadow-lg
              transition
              hover:bg-white
              active:scale-[0.99]
              disabled:opacity-60
            "
            style={{
              position: "fixed",
              left: "50%",
              transform: "translateX(-50%)",
              // ✅ adjust this number if your bottom nav is taller/shorter
              bottom: "140px",
              maxWidth: "24rem",
              width: "calc(100% - 2.5rem)",
            }}
          >
            Go to Tracks
          </button>
        </div>
      </div>

      {/* Modal (Animated) */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5"
            variants={overlayMotion}
            initial="hidden"
            animate="show"
            exit="exit"
            onMouseDown={closeModal}
          >
            <motion.div
              className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white/75 p-5 shadow-lg backdrop-blur"
              variants={modalMotion}
              initial="hidden"
              animate="show"
              exit="exit"
              onMouseDown={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-emerald-700">
                    Selected country
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-900">
                    {selectedCountry}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    Choose how you want help.
                  </p>
                </div>

                <button
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-xl border border-zinc-200 bg-white/60 p-2 text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
                  aria-label="Close"
                >
                  <IconClose className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                {/* Self-help */}
                <button
                  onClick={() => startProcessAndGo("self")}
                  disabled={saving}
                  className="group w-full rounded-2xl border border-zinc-200 bg-white/60 px-4 py-3 text-left text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-white active:scale-[0.99] disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white">
                      <IconSelf className="h-5 w-5 text-zinc-700" />
                    </span>
                    <div>
                      <div>
                        {saving && startingType === "self"
                          ? "Starting…"
                          : "Self-Help"}
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-zinc-600">
                        Steps & checklists you follow on your own
                      </div>
                    </div>
                  </div>
                </button>

                {/* We-help (primary) */}
                <button
                  onClick={() => startProcessAndGo("we")}
                  disabled={saving}
                  className="group w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70">
                      <IconWe className="h-5 w-5 text-emerald-700" />
                    </span>
                    <div>
                      <div>
                        {saving && startingType === "we" ? "Starting…" : "We-Help"}
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-white/80">
                        We guide you and work with you
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={closeModal}
                  disabled={saving}
                  className="w-full rounded-2xl border border-zinc-200 bg-transparent px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-4 text-center text-xs text-zinc-500">
                Your progress is saved automatically.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

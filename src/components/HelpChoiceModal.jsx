// ✅ HelpChoiceModal.jsx (POLISHED • FLOATY • CLEAN • MOBILE-FIRST)
// CHANGE ONLY (as requested):
// ✅ When you press BACK while modal is open, it navigates back to TrackScreen
//    (based on current pathname: /app/:track/*). Also closing the modal uses the same behavior.
// - Keeps your analytics + gating logic unchanged.

import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { motion, AnimatePresence } from "../utils/motionProxy";

function cleanStr(x, max = 80) {
  return String(x || "").trim().slice(0, max);
}

async function logChoiceFirestore({ country, choice, uid }) {
  await addDoc(collection(db, "analytics_helpChoices"), {
    choice, // "self" | "we"
    country: cleanStr(country, 80),
    uid,
    createdAt: serverTimestamp(),
  });
}

function logChoiceGA({ country, choice, uid }) {
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "help_choice", {
        choice,
        country: cleanStr(country, 80),
        uid_present: Boolean(uid),
      });
    }
  } catch {
    // ignore
  }
}

/* ---------------- Minimal icons ---------------- */
function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 7l10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBolt(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSpark(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 2l1.2 4.6L18 8l-4.8 1.4L12 14l-1.2-4.6L6 8l4.8-1.4L12 2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M19.2 13.2l.7 2.6 2.6.7-2.6.7-.7 2.6-.7-2.6-2.6-.7 2.6-.7.7-2.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`${className} animate-spin spinner-soft`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a9 9 0 1 1-3-6.7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- Motion ---------------- */
const overlay = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] } },
};

const sheet = {
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

const floaty = {
  rest: { y: 0, scale: 1 },
  hover: { y: -1, scale: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  tap: { scale: 0.985 },
};

// ✅ derive track screen from current URL: /app/:track/...
function deriveTrackPath(pathname) {
  const p = String(pathname || "");
  const m = p.match(/^\/app\/(study|work|travel)(?:\/|$)/i);
  const t = (m?.[1] || "").toLowerCase();
  if (t === "study" || t === "work" || t === "travel") return `/app/${t}`;
  return "/dashboard";
}

export default function HelpChoiceModal({ country, onSelfHelp, onWeHelp, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const safeCountry = useMemo(() => cleanStr(country, 40), [country]);

  const trackPath = useMemo(() => deriveTrackPath(location.pathname), [location.pathname]);

  // ✅ single "back target" behavior: go to TrackScreen
  const goBackToTrack = useCallback(() => {
    if (busy) return;
    // If parent passed onClose, call it (so parent clears modal state)
    try {
      onClose?.();
    } catch {}
    // Then navigate to track screen (replace so modal doesn’t come back)
    navigate(trackPath, { replace: true });
  }, [busy, navigate, trackPath, onClose]);

  // ✅ Back button handling for WebView/browser back
  useEffect(() => {
    // anchor current entry so back becomes predictable
    try {
      window.history.replaceState({ ...(window.history.state || {}), __majuu_helpchoice: true }, "");
    } catch {}

    const onPopState = (e) => {
      try {
        e.preventDefault?.();
      } catch {}
      goBackToTrack();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [goBackToTrack]);

  // ESC closes -> TrackScreen
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") goBackToTrack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBackToTrack]);

  if (!country) return null;

  const handleSelf = async () => {
    if (busy) return;
    setBusy(true);

    const user = auth.currentUser;

    logChoiceGA({ country, choice: "self", uid: user?.uid || null });

    if (user?.uid) {
      try {
        await logChoiceFirestore({ country, choice: "self", uid: user.uid });
      } catch {
        // don't block UX
      }
    }

    setBusy(false);
    onSelfHelp?.();
  };

  const handleWe = async () => {
    if (busy) return;
    setBusy(true);

    const user = auth.currentUser;

    logChoiceGA({ country, choice: "we", uid: user?.uid || null });

    if (user?.uid) {
      try {
        await logChoiceFirestore({ country, choice: "we", uid: user.uid });
      } catch {
        // don't block UX
      }
    }

    if (!user) {
      setBusy(false);
      navigate("/login", {
        state: { from: location.pathname, intended: "wehelp", country },
        replace: false,
      });
      return;
    }

    if (!user.emailVerified) {
      setBusy(false);
      navigate("/verify-email", {
        state: { email: user.email || "", from: location.pathname, intended: "wehelp", country },
        replace: false,
      });
      return;
    }

    setBusy(false);
    onWeHelp?.();
  };

  const rootCard =
    "relative w-[92vw] max-w-sm rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 shadow-[0_14px_34px_rgba(0,0,0,0.14)] backdrop-blur-xl motion-modal-panel";
  const subText = "text-xs text-zinc-500";
  const titleText = "text-[13px] font-semibold text-zinc-700 dark:text-zinc-300";
  const headline = "text-lg font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100";

  const btnBase =
    "w-full rounded-2xl px-4 py-3 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed";
  const btnSelf =
    "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-200";
  const btnWe =
    "border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 hover:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200";
  const chip =
    "inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800";

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 motion-modal-backdrop"
        variants={overlay}
        initial="hidden"
        animate="show"
        exit="exit"
      >
        {/* Backdrop (click outside -> TrackScreen) */}
        <button
          type="button"
          aria-label="Close"
          onClick={goBackToTrack}
          className="absolute inset-0 bg-black/40"
        />

        {/* Modal */}
        <motion.div variants={sheet} initial="hidden" animate="show" exit="exit" className={rootCard}>
          {/* subtle glow */}
          <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full bg-emerald-200/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-sky-200/25 blur-3xl" />

          {/* Header */}
          <div className="relative p-5 pb-4">
            <button
              type="button"
              onClick={goBackToTrack}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
              disabled={busy}
              aria-label="Close modal"
            >
              <IconX className="h-4 w-4" />
            </button>

            <div className={titleText}>Choose how you want help</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <div className={headline}>{safeCountry}</div>
              <span className={chip}>
                <IconSpark className="h-3.5 w-3.5" />
                Pick one
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Self-Help is <span className="font-semibold text-emerald-700">free</span>. We-Help is guided by the MAJUU
              team.
            </p>
          </div>

          {/* Options */}
          <div className="px-5 pb-5">
            <div className="grid gap-3">
              {/* Self-Help */}
              <motion.button
                type="button"
                onClick={handleSelf}
                disabled={busy}
                variants={floaty}
                initial="rest"
                whileHover="hover"
                whileTap="tap"
                className={`${btnBase} ${btnSelf} flex items-center justify-between`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white/15 dark:bg-zinc-900/60">
                    <IconBolt className="h-5 w-5" />
                  </span>
                  <span className="text-left">
                    <div className="leading-tight">Self-Help</div>
                    <div className="text-[12px] font-medium opacity-90">Do it yourself (Free)</div>
                  </span>
                </span>

                {busy ? <Spinner className="h-4 w-4" /> : <span className="text-[12px] opacity-95">Continue</span>}
              </motion.button>

              {/* We-Help */}
              <motion.button
                type="button"
                onClick={handleWe}
                disabled={busy}
                variants={floaty}
                initial="rest"
                whileHover="hover"
                whileTap="tap"
                className={`${btnBase} ${btnWe} flex items-center justify-between`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60">
                    <IconSpark className="h-5 w-5 text-emerald-700" />
                  </span>
                  <span className="text-left">
                    <div className="leading-tight">We-Help</div>
                    <div className="text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
                      Guided support (Login required)
                    </div>
                  </span>
                </span>

                {busy ? <Spinner className="h-4 w-4 text-zinc-700 dark:text-zinc-300" /> : <span className="text-[12px]">Continue</span>}
              </motion.button>

              {/* Footer note */}
              <div className="mt-1 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/55 dark:bg-zinc-900/60 p-3">
                <p className={subText}>
                  We-Help requires login (and verification) so we can keep your request secure and support you properly.
                </p>
              </div>

              {/* Cancel -> TrackScreen */}
              <button
                type="button"
                onClick={goBackToTrack}
                disabled={busy}
                className="mt-1 w-full rounded-2xl px-4 py-2.5 text-sm font-semibold text-zinc-600 dark:text-zinc-300 transition hover:text-zinc-900 active:scale-[0.99] disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}


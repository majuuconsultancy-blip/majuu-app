// ✅ FullPackageDiagnosticModal.jsx (NO-TRANSFORM MODAL — ANDROID JUMP FIX + EXTRA FROSTED)
//
// ✅ CHANGE (your request):
// - Android hardware BACK now closes this modal and returns to the We-Help screen behind it
// - Uses popstate trap (pushState) while open
//
// Build: FDIAG BUILD 2026-02-18 NO-TRANSFORM-B (BACK->CLOSE)

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const CHECKLIST = [
  "Passport",
  "SOP / Motivation Letter",
  "IELTS",
  "CV / Resume",
  "Offer Letter",
  "Proof of Funds",
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatKES(n) {
  const x = Math.round(Number(n) || 0);
  return `KES ${x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const BASE_PRICE = 9999;
const MIN_PRICE = 3999;

const ITEM_CREDITS = {
  Passport: 1700,
  "SOP / Motivation Letter": 1400,
  IELTS: 2200,
  "CV / Resume": 900,
  "Offer Letter": 1600,
  "Proof of Funds": 1400,
};

/* ---------- Minimal icons ---------- */
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

function IconShieldCheck(props) {
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

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 12.5 10 16.5 18 7.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- Body scroll lock (fixed-position) ---------- */
function lockBodyScrollFixed() {
  const y = window.scrollY || 0;
  const prev = {
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyLeft: document.body.style.left,
    bodyRight: document.body.style.right,
    bodyWidth: document.body.style.width,
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow,
  };

  document.documentElement.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${y}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";

  return () => {
    document.documentElement.style.overflow = prev.htmlOverflow;
    document.body.style.position = prev.bodyPosition;
    document.body.style.top = prev.bodyTop;
    document.body.style.left = prev.bodyLeft;
    document.body.style.right = prev.bodyRight;
    document.body.style.width = prev.bodyWidth;
    document.body.style.overflow = prev.bodyOverflow;

    const top = parseInt(prev.bodyTop || "0", 10);
    const restoreY = Number.isFinite(top) && top !== 0 ? -top : y;
    window.scrollTo(0, restoreY);
  };
}

export default function FullPackageDiagnosticModal({ open, onClose, track, country }) {
  const navigate = useNavigate();
  const listScrollRef = useRef(null);

  const [checked, setChecked] = useState({});
  const [pricePulse, setPricePulse] = useState(false);

  // reset each open (as before)
  useEffect(() => {
    if (open) setChecked({});
  }, [open]);

  // lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const unlock = lockBodyScrollFixed();
    return () => unlock();
  }, [open]);

  // ✅ Android hardware BACK closes modal (returns to We-Help behind it)
  useEffect(() => {
    if (!open) return;

    // Add a history entry so back triggers popstate instead of leaving the screen
    try {
      window.history.pushState({ __majuu_fdiag_backtrap: true }, "", window.location.href);
    } catch {}

    const onPopState = () => {
      // Close modal and keep user on same We-Help route
      onClose?.();
      // Re-push to neutralize the back navigation jump on some WebViews
      try {
        window.history.pushState({ __majuu_fdiag_backtrap: true }, "", window.location.href);
      } catch {}
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, onClose]);

  // ESC close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const total = CHECKLIST.length;

  const haveCount = useMemo(
    () => CHECKLIST.reduce((a, i) => a + (checked[i] ? 1 : 0), 0),
    [checked]
  );

  const missingItems = useMemo(() => CHECKLIST.filter((i) => !checked[i]), [checked]);

  const readiness = useMemo(
    () => clamp(Math.round((haveCount / total) * 100), 0, 100),
    [haveCount, total]
  );

  const readinessLabel = useMemo(() => {
    if (readiness < 35) return { text: "Low", cls: "bg-rose-50 border-rose-200 text-rose-800" };
    if (readiness < 70)
      return { text: "Good", cls: "bg-amber-50 border-amber-200 text-amber-900" };
    return { text: "Strong", cls: "bg-emerald-50 border-emerald-200 text-emerald-900" };
  }, [readiness]);

  const discount = useMemo(
    () =>
      CHECKLIST.reduce(
        (acc, item) => acc + (checked[item] ? ITEM_CREDITS[item] || 0 : 0),
        0
      ),
    [checked]
  );

  const livePrice = useMemo(() => clamp(BASE_PRICE - discount, MIN_PRICE, BASE_PRICE), [discount]);

  const saved = useMemo(() => clamp(BASE_PRICE - livePrice, 0, BASE_PRICE), [livePrice]);
  const saveText = saved > 0 ? `Save ${formatKES(saved)}` : "Best value";

  useEffect(() => {
    if (!open) return;
    setPricePulse(true);
    const t = setTimeout(() => setPricePulse(false), 160);
    return () => clearTimeout(t);
  }, [livePrice, open]);

  const isCountryValid = Boolean(country && country !== "Not selected");
  const recommended = missingItems.length >= 3;
  const canProceed = isCountryValid && recommended;

  // ✅ IMPORTANT: keep this single-line so it NEVER changes height and triggers anchoring
  const helperText = !isCountryValid
    ? "Pick a country first."
    : recommended
    ? "Great fit for 3+ missing items."
    : "Best when 3+ items are missing.";

  const handleProceed = () => {
    if (!canProceed) return;

    const missingParam = encodeURIComponent(missingItems.join("|"));
    navigate(
      `/app/full-package/${track}?country=${encodeURIComponent(country)}&missing=${missingParam}`,
      { state: { missingItems } }
    );

    onClose?.();
  };

  const toggle = (item) => {
    const el = listScrollRef.current;
    const top = el ? el.scrollTop : 0;

    setChecked((p) => ({ ...p, [item]: !p[item] }));

    queueMicrotask(() => {
      const el2 = listScrollRef.current;
      if (el2) el2.scrollTop = top;

      requestAnimationFrame(() => {
        const el3 = listScrollRef.current;
        if (el3) el3.scrollTop = top;
      });
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{ touchAction: "manipulation" }}
      role="presentation"
    >
      {/* ✅ SUPER FROSTED BACKDROP */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] motion-modal-backdrop anim-in-fade" />
      <div className="absolute inset-0 bg-white/[0.06] dark:bg-white/[0.03]" />

      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-sky-200/20 blur-3xl" />

      {/* ✅ NO FRAMER MOTION HERE (no transforms) */}
      <div
        className={[
          "relative w-full max-w-md",
          "h-[78vh] max-h-[78vh]",
          "rounded-[22px]",
          "border border-white/40 bg-white/55 dark:bg-zinc-900/60",
          "shadow-[0_12px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl",
          "ring-1 ring-white/20",
          "flex flex-col overflow-hidden motion-modal-panel anim-in-fade",
          "dark:border-zinc-800/70 dark:bg-zinc-900/55 dark:ring-white/10",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ isolation: "isolate" }}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-white/25 bg-white/45 dark:bg-zinc-900/60 backdrop-blur-2xl dark:border-zinc-800/60 dark:bg-zinc-900/45">
          <div className="flex items-start justify-between gap-3 px-5 py-2">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-emerald-900/85 dark:text-emerald-200/90">
                Full package diagnostic
              </div>
              <h2 className="mt-0.5 text-[16px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Let’s understand where you are
              </h2>
              <p className="mt-0.5 text-[12px] text-zinc-600 dark:text-zinc-300">
                Tick what you already have.
              </p>
            </div>

            <button
              onClick={onClose}
              className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/35 bg-white/55 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition hover:bg-white/70 active:scale-[0.99] backdrop-blur-xl dark:border-zinc-700/60 dark:bg-zinc-900/55 dark:text-zinc-200"
              aria-label="Close"
              type="button"
            >
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="shrink-0 border-b border-white/20 bg-white/40 dark:bg-zinc-900/60 backdrop-blur-2xl dark:border-zinc-800/60 dark:bg-zinc-900/40">
          <div className="px-5 py-2">
            <div className="rounded-3xl border border-white/35 bg-white/45 dark:bg-zinc-900/60 px-4 py-2.5 backdrop-blur-2xl dark:border-zinc-800/60 dark:bg-zinc-900/45">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10.5px] font-semibold text-zinc-600 dark:text-zinc-300">
                    Price
                  </div>

                  <div
                    className={[
                      "mt-0.5 text-[18px] font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums leading-none dark:text-zinc-100",
                      pricePulse ? "scale-[1.02]" : "scale-100",
                      "transition-transform duration-150 ease-out",
                    ].join(" ")}
                  >
                    {formatKES(livePrice)}
                  </div>

                  <div className="mt-0.5 text-[10.5px] font-semibold text-emerald-900/70 dark:text-emerald-200/80">
                    {saveText}
                  </div>
                </div>

                <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/60 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <IconShieldCheck className="h-4 w-4" />
                  Best
                </span>
              </div>

              <div className="mt-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] font-semibold text-zinc-900 dark:text-zinc-100">
                    Readiness {readiness}%
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-300">
                      {haveCount}/{total}
                    </span>
                    <span
                      className={[
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        readinessLabel.cls,
                      ].join(" ")}
                    >
                      {readinessLabel.text}
                    </span>
                  </div>
                </div>

                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800/60">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${readiness}%` }}
                  />
                </div>

                <div className="mt-1 text-[10.5px] text-zinc-600 dark:text-zinc-300 truncate">
                  {helperText}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll area */}
        <div className="flex-1 min-h-0 px-5 pt-3 pb-4">
          <div
            ref={listScrollRef}
            className="h-full overflow-y-auto overscroll-contain scrollbar-hide"
            style={{
              WebkitOverflowScrolling: "touch",
              overscrollBehavior: "contain",
              overflowAnchor: "none",
              WebkitOverflowAnchor: "none",
              contain: "layout paint",
            }}
          >
            <div className="grid gap-3">
              {CHECKLIST.map((item) => {
                const isOn = !!checked[item];
                const credit = ITEM_CREDITS[item] || 0;

                return (
                  <div
                    key={item}
                    role="button"
                    aria-pressed={isOn}
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(item);
                    }}
                    className={[
                      "w-full text-left rounded-3xl border px-4 py-3 transition active:scale-[0.99]",
                      "shadow-[0_6px_16px_rgba(0,0,0,0.05)] backdrop-blur-xl",
                      "min-h-[78px]",
                      isOn
                        ? "border-emerald-200 bg-white/55 dark:bg-zinc-900/60 dark:bg-zinc-900/55"
                        : "border-white/35 bg-white/40 dark:bg-zinc-900/60 hover:bg-white/50 hover:border-emerald-200/60 dark:border-zinc-800/60 dark:bg-zinc-900/40",
                    ].join(" ")}
                    style={{
                      touchAction: "manipulation",
                      WebkitTapHighlightColor: "transparent",
                      userSelect: "none",
                      overflowAnchor: "none",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-3">
                        <span
                          className={[
                            "inline-flex h-9 w-9 items-center justify-center rounded-2xl border",
                            isOn
                              ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
                              : "border-white/35 bg-white/45 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 dark:border-zinc-700/60 dark:bg-zinc-950/30 dark:text-zinc-200",
                          ].join(" ")}
                        >
                          {isOn ? (
                            <IconCheck className="h-5 w-5" />
                          ) : (
                            <span className="h-2 w-2 rounded-full bg-zinc-300" />
                          )}
                        </span>

                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {item}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-300">
                            Tap to {isOn ? "undo" : "mark ready"}
                          </div>
                        </div>
                      </div>

                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
                        -{formatKES(credit)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* actions */}
            <div className="mt-4 rounded-3xl border border-white/35 bg-white/45 dark:bg-zinc-900/60 p-4 backdrop-blur-2xl dark:border-zinc-800/60 dark:bg-zinc-900/45">
              <button
                onClick={handleProceed}
                disabled={!canProceed}
                className={[
                  "w-full rounded-2xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99]",
                  canProceed
                    ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border-white/30 bg-white/30 dark:bg-zinc-900/60 text-zinc-400 cursor-not-allowed dark:border-zinc-800/60 dark:bg-zinc-950/20",
                ].join(" ")}
                type="button"
              >
                Proceed
              </button>

              <button
                onClick={onClose}
                className="mt-2.5 w-full rounded-2xl border border-white/35 bg-white/45 dark:bg-zinc-900/60 px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-white/60 active:scale-[0.99] backdrop-blur-2xl dark:border-zinc-800/60 dark:bg-zinc-900/45 dark:text-zinc-100"
                type="button"
              >
                Cancel
              </button>

              <div className="mt-2 text-center text-[10.5px] text-zinc-500 dark:text-zinc-300">
                Tip: recommended when missing <b>3+</b> items.
              </div>
            </div>

            <div className="h-2" />
          </div>
        </div>
      </div>
    </div>
  );
}


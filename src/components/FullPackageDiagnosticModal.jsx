import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

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

function useAnimatedNumber(target, { duration = 520 } = {}) {
  const [value, setValue] = useState(target);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const fromRef = useRef(target);
  const toRef = useRef(target);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    fromRef.current = value;
    toRef.current = target;
    startRef.current = performance.now();

    const tick = (now) => {
      const elapsed = now - startRef.current;
      const t = clamp(elapsed / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = fromRef.current + (toRef.current - fromRef.current) * eased;

      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}

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

export default function FullPackageDiagnosticModal({ open, onClose, track, country }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [checked, setChecked] = useState({});
  const [pricePulse, setPricePulse] = useState(false);

  useEffect(() => {
    if (open) setChecked({});
  }, [open]);

  const toggle = (item) => setChecked((p) => ({ ...p, [item]: !p[item] }));

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
    if (readiness < 35)
      return { text: "Low", cls: "bg-rose-50 border-rose-200 text-rose-800" };
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
  const animatedPrice = useAnimatedNumber(livePrice, { duration: 560 });

  const saved = useMemo(() => clamp(BASE_PRICE - livePrice, 0, BASE_PRICE), [livePrice]);
  const saveText = saved > 0 ? `Save ${formatKES(saved)}` : "Best value";

  useEffect(() => {
    if (!open) return;
    setPricePulse(true);
    const t = setTimeout(() => setPricePulse(false), 220);
    return () => clearTimeout(t);
  }, [livePrice, open]);

  const isCountryValid = Boolean(country && country !== "Not selected");
const recommended = missingItems.length >= 3;   // ✅ MINIMUM 3 missing
const canProceed = isCountryValid && recommended;

const helperText = !isCountryValid
  ? "Pick a country first."
  : recommended
    ? "Great fit for 3+ missing items."
    : "Best when 3+ items are missing.";

  const handleProceed = () => {
  if (!canProceed) return;

  navigate(`/app/full-package/${track}?country=${encodeURIComponent(country)}`, {
    state: { missingItems },
  });
  onClose?.();
};

  const backdropV = { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } };

  const modalV = reduceMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { opacity: 0, y: 14, scale: 0.985 },
        show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: "easeOut" } },
        exit: { opacity: 0, y: 12, scale: 0.985, transition: { duration: 0.16 } },
      };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          variants={backdropV}
          initial="hidden"
          animate="show"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          onMouseDown={onClose}
        >
          <div className="absolute inset-0 bg-black/20" />
          <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/25 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 rounded-full bg-sky-200/20 blur-3xl" />

          <motion.div
            variants={modalV}
            onMouseDown={(e) => e.stopPropagation()}
            className={[
              "relative w-full max-w-md",
              "h-[78vh] max-h-[78vh]", // ✅ fixed height feels more predictable on mobile
              "rounded-[22px]",
              "border border-zinc-200/70 bg-white/80",
              "shadow-[0_20px_70px_rgba(0,0,0,0.18)] backdrop-blur-xl",
              "flex flex-col overflow-hidden", // ✅ allows body to take remaining space
            ].join(" ")}
            role="dialog"
            aria-modal="true"
          >
            {/* Header (sticky, smaller) */}
            <div className="sticky top-0 z-20 border-b border-zinc-200/60 bg-white/70 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3 px-5 py-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-extrabold text-emerald-900/85">
                    Full package diagnostic
                  </div>
                  <h2 className="mt-0.5 text-[16px] font-extrabold tracking-tight text-zinc-900">
                    Let’s understand where you are
                  </h2>
                  <p className="mt-0.5 text-[12px] text-zinc-600">
                    Tick what you already have.
                  </p>
                </div>

                <button
                  onClick={onClose}
                  className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 text-zinc-700 transition hover:bg-white active:scale-[0.99]"
                  aria-label="Close"
                >
                  <IconX className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* ✅ ONE compact sticky summary card (price + readiness inside) */}
            <div className="sticky top-[54px] z-10 border-b border-zinc-200/50 bg-white/60 backdrop-blur-xl">
              <div className="px-5 py-2">
                <div className="rounded-3xl border border-zinc-200/60 bg-white/65 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10.5px] font-extrabold text-zinc-600">
                        Price
                      </div>
                      <motion.div
                        animate={
                          pricePulse && !reduceMotion ? { scale: [1, 1.02, 1] } : { scale: 1 }
                        }
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="mt-0.5 text-[18px] font-extrabold text-zinc-900 tabular-nums leading-none"
                      >
                        {formatKES(animatedPrice)}
                      </motion.div>
                      <div className="mt-0.5 text-[10.5px] font-extrabold text-emerald-900/65">
                        {saveText}
                      </div>
                    </div>

                    <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/60 px-2 py-0.5 text-[10.5px] font-extrabold text-emerald-900">
                      <IconShieldCheck className="h-4 w-4" />
                      Best
                    </span>
                  </div>

                  {/* readiness row */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-extrabold text-zinc-900">
                        Readiness {readiness}%
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] font-semibold text-zinc-500">
                          {haveCount}/{total}
                        </span>
                        <span
                          className={[
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold",
                            readinessLabel.cls,
                          ].join(" ")}
                        >
                          {readinessLabel.text}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200/70">
                      <motion.div
                        initial={false}
                        animate={{ width: `${readiness}%` }}
                        transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: "easeOut" }}
                        className="h-full rounded-full bg-emerald-600"
                      />
                    </div>

                    <div className="mt-1 text-[10.5px] text-zinc-600">{helperText}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ✅ Scroll body takes ALL remaining height, scrollbar hidden */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-4 scrollbar-hide">
              <div className="grid gap-3">
                {CHECKLIST.map((item) => {
                  const isOn = !!checked[item];
                  const credit = ITEM_CREDITS[item] || 0;

                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggle(item)}
                      className={[
                        "w-full text-left rounded-3xl border px-4 py-3 transition active:scale-[0.99]",
                        "shadow-[0_12px_36px_rgba(0,0,0,0.06)] backdrop-blur",
                        isOn
                          ? "border-emerald-200 bg-white/80"
                          : "border-zinc-200/70 bg-white/65 hover:bg-white/80 hover:border-emerald-200/70",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-3">
                          <span
                            className={[
                              "inline-flex h-9 w-9 items-center justify-center rounded-2xl border",
                              isOn
                                ? "border-emerald-200 bg-emerald-50/80 text-emerald-800"
                                : "border-zinc-200 bg-white/70 text-zinc-700",
                            ].join(" ")}
                          >
                            {isOn ? (
                              <IconCheck className="h-5 w-5" />
                            ) : (
                              <span className="h-2 w-2 rounded-full bg-zinc-300" />
                            )}
                          </span>

                          <div className="min-w-0">
                            <div className="font-extrabold text-zinc-900">{item}</div>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              Tap to {isOn ? "undo" : "mark ready"}
                            </div>
                          </div>
                        </div>

                        <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-extrabold text-emerald-900">
                          -{formatKES(credit)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* buttons inside scroll */}
              <div className="mt-4 rounded-3xl border border-zinc-200/70 bg-white/70 p-4">
                <button
                  onClick={handleProceed}
                  disabled={!canProceed}
                  className={[
                    "w-full rounded-2xl border px-4 py-2.5 text-sm font-extrabold shadow-sm transition active:scale-[0.99]",
                    canProceed
                      ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
                      : "border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  Proceed
                </button>

                <button
                  onClick={onClose}
                  className="mt-2.5 w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-2.5 text-sm font-extrabold text-zinc-800 transition hover:bg-white active:scale-[0.99]"
                >
                  Cancel
                </button>

                <div className="mt-2 text-center text-[10.5px] text-zinc-500">
                  Tip: recommended when missing <b>3+</b> items.
                </div>
              </div>

              <div className="h-2" />
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
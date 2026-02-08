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

// helper
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatKES(n) {
  const x = Math.round(Number(n) || 0);
  return `KES ${x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// ✅ Pricing model
const BASE_PRICE = 9999;
const MIN_PRICE = 3999;

// ✅ Weighting price not equal
const ITEM_CREDITS = {
  Passport: 1700,
  "SOP / Motivation Letter": 1400,
  IELTS: 2200,
  "CV / Resume": 900,
  "Offer Letter": 1600,
  "Proof of Funds": 1400,
};

// ✅ Smooth number animation
function useAnimatedNumber(target, { duration = 450 } = {}) {
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
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (toRef.current - fromRef.current) * eased;
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [target]);

  return value;
}

export default function FullPackageDiagnosticModal({
  open,
  onClose,
  track,
  country,
}) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState({});

  useEffect(() => {
    if (open) setChecked({});
  }, [open]);

  const toggle = (item) => {
    setChecked((p) => ({ ...p, [item]: !p[item] }));
  };

  const total = CHECKLIST.length;

  const haveCount = useMemo(
    () => CHECKLIST.reduce((a, i) => a + (checked[i] ? 1 : 0), 0),
    [checked]
  );

  const missingItems = useMemo(
    () => CHECKLIST.filter((i) => !checked[i]),
    [checked]
  );

  const readiness = useMemo(
    () => clamp(Math.round((haveCount / total) * 100), 0, 100),
    [haveCount, total]
  );

  const readinessLabel = useMemo(() => {
    if (readiness < 35) return "Low readiness";
    if (readiness < 70) return "Good progress";
    return "Strong readiness";
  }, [readiness]);

  const discount = useMemo(
    () =>
      CHECKLIST.reduce(
        (acc, item) => acc + (checked[item] ? ITEM_CREDITS[item] || 0 : 0),
        0
      ),
    [checked]
  );

  const livePrice = useMemo(
    () => clamp(BASE_PRICE - discount, MIN_PRICE, BASE_PRICE),
    [discount]
  );

  const animatedPrice = useAnimatedNumber(livePrice, { duration: 500 });
  const saved = useMemo(
    () => clamp(BASE_PRICE - livePrice, 0, BASE_PRICE),
    [livePrice]
  );

  const saveText = saved > 0 ? `You save ${formatKES(saved)}` : "Best value bundle";

  const handleProceed = () => {
    if (!country || country === "Not selected") {
      alert("Please select a country first.");
      return;
    }

    if (missingItems.length < 3) {
      alert(
        "You already have most of the requirements.\nFull package is recommended when at least 3 items are missing."
      );
      return;
    }

    navigate(`/app/full-package/${track}?country=${encodeURIComponent(country)}`, {
      state: { missingItems },
    });

    onClose?.();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-5"
      onMouseDown={onClose}
    >
      {/* ✅ ONLY CHANGE IS HERE (scrollable modal) */}
      <div
        className="w-full max-w-sm max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-lg backdrop-blur"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-900">
          Let’s understand where you are
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Tick what you already have. Price updates instantly.
        </p>

        <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-emerald-800">
                Full package price
              </div>
              <div className="mt-0.5 text-lg font-semibold text-zinc-900 tabular-nums">
                {formatKES(animatedPrice)}
              </div>
              <div className="mt-1 text-xs font-semibold text-emerald-800/80">
                {saveText}
              </div>
              <div className="mt-1 text-[11px] text-zinc-600">
                Starts at {formatKES(BASE_PRICE)} • Minimum {formatKES(MIN_PRICE)}
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-emerald-200 bg-white/70 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              Best value
            </span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900">
              Readiness: {readiness}%
            </div>
            <div className="text-xs font-semibold text-zinc-600">
              {haveCount}/{total} ready
            </div>
          </div>

          <div className="mt-2 h-2 w-full rounded-full bg-zinc-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all"
              style={{ width: `${readiness}%` }}
            />
          </div>

          <div className="mt-2 text-xs font-medium text-zinc-600">
            {readinessLabel}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {CHECKLIST.map((item) => (
            <label
              key={item}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2 text-sm cursor-pointer hover:bg-zinc-50"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={!!checked[item]}
                  onChange={() => toggle(item)}
                  className="accent-emerald-600"
                />
                <span className="text-zinc-900">{item}</span>
              </div>
              <span className="text-[11px] font-semibold text-emerald-800/80">
                -{formatKES(ITEM_CREDITS[item] || 0)}
              </span>
            </label>
          ))}
        </div>

        <button
          onClick={handleProceed}
          className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 active:scale-[0.99] transition"
        >
          Proceed
        </button>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </button>

        <div className="mt-3 text-center text-[11px] text-zinc-500">
          Tip: Full package is best when you’re missing 3+ items.
        </div>
      </div>
    </div>
  );
}
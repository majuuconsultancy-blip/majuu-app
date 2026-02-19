// ✅ IntroScreen.jsx (LOWERED FOR BETTER MOBILE BALANCE)
// Fixes:
// - ✅ Lowers entire layout (was too high)
// - ✅ Uses natural mobile spacing (closer to native apps)
// - ❌ No logic touched
// ❌ No animations changed
// ❌ No routing changed

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "../utils/motionProxy";

const SLIDES = [
  {
    title: "Study, Work & Travel — made simple",
    body: "Pick a destination. Apply free (Self-Help) or get expert help (We-Help).",
    pills: ["Self-Help (Free)", "We-Help", "Status tracking"],
  },
  {
    title: "Track Everything",
    body: "Requests and updates auto-save so you always know what’s next.",
    pills: ["Realtime updates", "Auto-saved", "Clear steps"],
  },
  {
    title: "Support when it matters",
    body: "Send a request, get a quick response, and follow guided steps with MAJUU.",
    pills: ["Fast replies", "Pro Guidance", "Reliable Systems"],
  },
];

const BUILD_TAG = "BUILD 2026-02-d";

function cx(...a) {
  return a.filter(Boolean).join(" ");
}

export default function IntroScreen() {
  const navigate = useNavigate();
  const reduceMotion = true;

  const [i, setI] = useState(0);

  const lastIndex = SLIDES.length - 1;
  const isLast = i === lastIndex;

  const goToAuth = () => navigate("/login", { replace: true });
  const skip = () => goToAuth();

  const next = () => setI((v) => (v >= lastIndex ? lastIndex : v + 1));
  const prev = () => setI((v) => (v <= 0 ? 0 : v - 1));
  const goTo = (idx) => setI(() => Math.max(0, Math.min(lastIndex, idx)));

  const continueLabel = useMemo(() => (isLast ? "Continue" : "Next"), [isLast]);

  const slide = SLIDES[i];

  const slideMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, x: 14 },
        animate: {
          opacity: 1,
          x: 0,
          transition: { type: "spring", stiffness: 420, damping: 34 },
        },
        exit: { opacity: 0, x: -14, transition: { duration: 0.16 } },
      };

  const tapV = reduceMotion
    ? {}
    : {
        whileTap: { scale: 0.985 },
        transition: { duration: 0.16, ease: "easeOut" },
      };

  const pageBg = "min-h-screen bg-zinc-50 dark:bg-zinc-950";

  const glass =
    "rounded-[28px] border border-zinc-200/70 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-xl shadow-[0_22px_80px_rgba(0,0,0,0.12)]";

  return (
    <div className={pageBg}>
      {/* Background layers */}
      <div className="fixed inset-0 -z-10">
        <div
          className="absolute inset-0 opacity-[0.7]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 10%, rgba(16,185,129,0.20), transparent 45%), radial-gradient(circle at 80% 30%, rgba(56,189,248,0.18), transparent 45%), radial-gradient(circle at 50% 90%, rgba(16,185,129,0.12), transparent 55%)",
          }}
        />
        <div className="absolute -top-28 -right-28 h-80 w-80 rounded-full bg-emerald-200/45 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
      </div>

      {/* ✅ THIS is what lowers the whole screen */}
      <div className="mx-auto max-w-xl px-5 pt-24 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
              MAJUU APP
            </div>
            <div className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Get started
            </div>

            <div className="mt-1 text-[10px] font-extrabold text-rose-600">
              {BUILD_TAG}
            </div>
          </div>

          <motion.button
            type="button"
            onClick={skip}
            className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 px-4 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm hover:bg-white"
            {...tapV}
          >
            Skip
          </motion.button>
        </div>

        {/* Main card */}
        <div className={cx("mt-8", glass, "p-5")}>
          <AnimatePresence mode="wait">
            <motion.div key={i} {...slideMotion}>
              <div className="text-2xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
                {slide.title}
              </div>

              <div className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {slide.body}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {(slide.pills || []).map((p) => (
                  <span
                    key={p}
                    className="rounded-full border border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-1 text-[11px] font-semibold text-zinc-800"
                  >
                    {p}
                  </span>
                ))}
              </div>

              <div className="mt-5 text-xs text-zinc-600 dark:text-zinc-300">MAJUU.</div>
            </motion.div>
          </AnimatePresence>

          {/* Dots */}
          <div className="mt-5 flex items-center justify-center gap-2">
            {SLIDES.map((_, idx) => (
              <motion.button
                key={idx}
                type="button"
                onClick={() => goTo(idx)}
                className={cx(
                  "h-2.5 w-2.5 rounded-full transition",
                  idx === i ? "bg-emerald-600" : "bg-zinc-300"
                )}
                {...tapV}
              />
            ))}
          </div>

          {/* CTA */}
          <div className="mt-5">
            <motion.button
              onClick={() => (isLast ? goToAuth() : next())}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              type="button"
              {...tapV}
            >
              {continueLabel}
            </motion.button>

            <motion.button
              type="button"
              onClick={prev}
              disabled={i === 0}
              className="mt-3 w-full rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm"
              {...tapV}
            >
              Back
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
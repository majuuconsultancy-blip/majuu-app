import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

const SLIDES = [
  {
    title: "Study, Work & Travel Made Accessible",
    body:
      "Choose your dream destination, Apply for free on your own or get expert help.",
  },
  {
    title: "Track progress in real time",
    body:
      "Your applications and status updates are saved automatically, so you always know what’s happening.",
  },
  {
    title: "Fast support when you need it",
    body:
      "Send a request, get response in minutes, and get step-by-step guidance by the MAJUU team.",
  },
];

const pageMotion = {
  initial: { opacity: 0, x: 18, scale: 0.99, filter: "blur(2px)" },
  animate: {
    opacity: 1,
    x: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 420, damping: 34 },
  },
  exit: { opacity: 0, x: -18, scale: 0.99, filter: "blur(2px)", transition: { duration: 0.18 } },
};

export default function IntroScreen() {
  const navigate = useNavigate();
  const [i, setI] = useState(0);

  // 4 seconds per slide
  const intervalMs = 4000;

  // Avoid double intervals in React StrictMode (dev)
  const startedRef = useRef(false);

  const lastIndex = SLIDES.length - 1;
  const isLast = i === lastIndex;

  const next = () => setI((v) => Math.min(v + 1, lastIndex));
  const goToAuth = () => navigate("/login", { replace: true });

  const continueLabel = useMemo(() => (isLast ? "Continue" : "Next"), [isLast]);

  useEffect(() => {
    // Start auto only once (helps dev StrictMode)
    if (startedRef.current) return;
    startedRef.current = true;

    const id = setInterval(() => {
      setI((v) => (v >= lastIndex ? v : v + 1));
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, lastIndex]);

  // Optional: when user reaches last slide, stop auto (no need to keep ticking)
  useEffect(() => {
    if (!isLast) return;
    // nothing required here; it’ll stop advancing because we clamp
  }, [isLast]);

  const slide = SLIDES[i];

  return (
    <div className="min-h-screen bg-white">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white">
        <div className="max-w-xl mx-auto px-5 py-10">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>           
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
                Welcome
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                OVERVIEW.
              </p>
            </div>

            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/60" />
          </div>

          {/* Slide card */}
          <div className="mt-8">
            <div className="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur p-6 shadow-sm">
              <AnimatePresence mode="wait">
                <motion.div
                  key={i}
                  variants={pageMotion}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <div className="text-lg font-semibold text-zinc-900">
                    {slide.title}
                  </div>
                  <div className="mt-2 text-sm leading-relaxed text-zinc-600">
                    {slide.body}
                  </div>

                  {/* Simple “feature” pills (no emojis) */}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="text-xs px-2.5 py-1 rounded-full border bg-white/60 text-zinc-700">
                      Country selection
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full border bg-white/60 text-zinc-700">
                      Self-Help guides
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full border bg-white/60 text-zinc-700">
                      We-Help requests
                    </span>
                    <span className="text-xs px-2.5 py-1 rounded-full border bg-white/60 text-zinc-700">
                      Progress tracking
                    </span>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Dots indicator (between card and Continue button) */}
              <div className="mt-6 flex items-center justify-center gap-2">
                {SLIDES.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setI(idx)}
                    aria-label={`Go to slide ${idx + 1}`}
                    className={[
                      "h-2.5 w-2.5 rounded-full transition",
                      idx === i ? "bg-emerald-600" : "bg-zinc-300 hover:bg-zinc-400",
                    ].join(" ")}
                  />
                ))}
              </div>

              {/* Continue / Next (NO skip) */}
              <div className="mt-6">
                <button
                  onClick={() => (isLast ? goToAuth() : next())}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                >
                  {continueLabel}
                </button>

                <div className="mt-3 text-center text-xs text-zinc-500">
                  Your gateway to MAJUU.
                </div>
              </div>
            </div>
          </div>

          {/* tiny footer spacing for mobile */}
          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
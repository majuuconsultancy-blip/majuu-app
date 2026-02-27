import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "../utils/motionProxy";
import { setIntroSeen } from "../utils/introFlag";

const SLIDES = [
  {
    title: "Study, Work and Travel made Accessible",
    pills: ["Self-Help", "We-Help",],
    image: "/onboarding/intro-1.png",
    imageAlt: "Slide 1 onboarding visual",
    bgClass:
      "bg-gradient-to-br from-emerald-100 via-emerald-50 to-sky-100 dark:from-zinc-900 dark:via-zinc-950 dark:to-sky-950/40",
  },
  {
    title: "Track everything in one place",
    pills: ["Progress", "Auto-saved",],
    image: "/onboarding/intro-2.png",
    imageAlt: "Slide 2 onboarding visual",
    bgClass:
      "bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-100 dark:from-sky-950/40 dark:via-zinc-950 dark:to-emerald-950/35",
  },
  {
    title: "Support when it matters most",
    pills: ["Fast processing", "Expert guidance",],
    image: "/onboarding/intro-3.png",
    imageAlt: "Slide 3 onboarding visual",
    bgClass:
      "bg-gradient-to-br from-emerald-100 via-amber-50 to-sky-100 dark:from-emerald-950/35 dark:via-zinc-950 dark:to-sky-950/35",
  },
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function IntroScreen() {
  const navigate = useNavigate();
  const reduceMotion = true;

  const [i, setI] = useState(0);
  const [brokenImages, setBrokenImages] = useState({});
  const scrollerRef = useRef(null);

  const lastIndex = SLIDES.length - 1;
  const isLast = i === lastIndex;
  const continueLabel = useMemo(() => (isLast ? "Continue" : "Next"), [isLast]);

  useEffect(() => {
    setIntroSeen();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => {
      const nextIndex = Math.round(el.scrollLeft / el.clientWidth);
      if (nextIndex !== i && nextIndex >= 0 && nextIndex <= lastIndex) {
        setI(nextIndex);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [i, lastIndex]);

  useEffect(() => {
    const onResize = () => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({ left: i * el.clientWidth, behavior: "auto" });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [i]);

  const goToAuth = () => navigate("/login", { replace: true });
  const skip = () => goToAuth();

  const scrollToIndex = (idx) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(lastIndex, idx));
    el.scrollTo({
      left: clamped * el.clientWidth,
      behavior: reduceMotion ? "auto" : "smooth",
    });
    setI(clamped);
  };

  const next = () => {
    if (isLast) {
      goToAuth();
      return;
    }
    scrollToIndex(i + 1);
  };

  const markImageBroken = (src) => {
    setBrokenImages((prev) => {
      if (prev[src]) return prev;
      return { ...prev, [src]: true };
    });
  };

  return (
    <div className="h-[100dvh] overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto flex h-full max-w-xl flex-col px-5 pt-5 pb-32">
        <div className="relative flex items-center justify-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-emerald-600 text-center">
            MAJUU APP
          </h1>

          <motion.button
            type="button"
            onClick={skip}
            className="absolute right-0 top-0 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/65 px-3.5 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm hover:bg-white"
          >
            Skip
          </motion.button>
        </div>

        <div
          ref={scrollerRef}
          className="mt-3 -mx-5 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SLIDES.map((slide, idx) => {
            const imageMissing = Boolean(brokenImages[slide.image]);

            return (
              <section
                key={slide.image}
                className={cx(
                  "relative w-full shrink-0 snap-center snap-always overflow-hidden",
                  slide.bgClass
                )}
              >
                {!imageMissing ? (
                  <img
                    src={slide.image}
                    alt={slide.imageAlt}
                    className="absolute inset-0 h-full w-full object-contain"
                    onError={() => markImageBroken(slide.image)}
                    loading={idx === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Add slide image
                      </div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                        Place file at <code>{slide.image}</code>
                      </div>
                    </div>
                  </div>
                )}

                <div className="relative flex h-full flex-col items-center px-5 pt-[8vh]">
                  <h2 className="text-center text-[1.35rem] leading-tight font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {slide.title}
                  </h2>

                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    {(slide.pills || []).map((p) => (
                      <span
                        key={p}
                        className="rounded-full border border-emerald-400/60 bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white text-center"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2.5">
          {SLIDES.map((_, idx) => (
            <div
              key={idx}
              aria-hidden="true"
              className={cx(
                "h-2.5 rounded-full transition",
                idx === i ? "w-8 bg-emerald-600" : "w-2.5 bg-zinc-300 dark:bg-zinc-700"
              )}
            />
          ))}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-6 z-40 px-5 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-xl">
          <motion.button
            onClick={next}
            className="mx-auto block w-full max-w-[320px] rounded-2xl border border-emerald-200 bg-emerald-600 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_36px_rgba(16,185,129,0.35)] transition hover:bg-emerald-700"
            type="button"
          >
            {continueLabel}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

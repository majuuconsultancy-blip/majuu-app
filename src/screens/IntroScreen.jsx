import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setIntroSeen } from "../utils/introFlag";

const SLIDES = [
  {
    title: "Study, Work and Travel made accessible",
    subtitle: "Move from confusion to clear next steps with guided options.",
    pills: ["Self-Help", "We-Help"],
    image: "/onboarding/intro-1.png",
    imageAlt: "Slide 1 onboarding visual",
  },
  {
    title: "Track everything in one place",
    subtitle: "Follow your request status, updates and timeline without switching tabs.",
    pills: ["Progress", "Auto-saved"],
    image: "/onboarding/intro-2.png",
    imageAlt: "Slide 2 onboarding visual",
  },
  {
    title: "Support when it matters most",
    subtitle: "Get guided help for critical steps with faster, clearer outcomes.",
    pills: ["Fast processing", "Expert guidance"],
    image: "/onboarding/intro-3.png",
    imageAlt: "Slide 3 onboarding visual",
  },
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function IntroScreen() {
  const navigate = useNavigate();
  const scrollerRef = useRef(null);
  const touchStartRef = useRef({ x: null, y: null });
  const touchStartSlideRef = useRef(0);
  const exitTimerRef = useRef(null);

  const [index, setIndex] = useState(0);
  const [brokenImages, setBrokenImages] = useState({});
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDirection, setExitDirection] = useState("left");

  const lastIndex = SLIDES.length - 1;
  const isLast = index === lastIndex;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduceMotion(Boolean(media.matches));
    apply();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const onScroll = () => {
      const next = Math.round(el.scrollLeft / el.clientWidth);
      if (next !== index && next >= 0 && next <= lastIndex) {
        setIndex(next);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [index, lastIndex]);

  useEffect(() => {
    const onResize = () => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({ left: index * el.clientWidth, behavior: "auto" });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [index]);

  const goToAuth = useCallback(() => {
    setIntroSeen();
    navigate("/login", { replace: true });
  }, [navigate]);

  const goToAuthWithTransition = useCallback(
    (direction = "left") => {
      if (isExiting) return;
      if (reduceMotion) {
        goToAuth();
        return;
      }
      setExitDirection(direction);
      setIsExiting(true);
      exitTimerRef.current = window.setTimeout(() => {
        goToAuth();
      }, 220);
    },
    [goToAuth, isExiting, reduceMotion]
  );

  const scrollToIndex = useCallback(
    (nextIndex) => {
      const el = scrollerRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(lastIndex, nextIndex));
      el.scrollTo({
        left: clamped * el.clientWidth,
        behavior: reduceMotion ? "auto" : "smooth",
      });
      setIndex(clamped);
    },
    [lastIndex, reduceMotion]
  );

  const onContinue = useCallback(() => {
    if (isLast) {
      goToAuthWithTransition("left");
      return;
    }
    scrollToIndex(index + 1);
  }, [goToAuthWithTransition, index, isLast, scrollToIndex]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = String(event?.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (isLast) return;
        scrollToIndex(index + 1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (index === 0) return;
        scrollToIndex(index - 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onContinue();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, isLast, onContinue, scrollToIndex]);

  useEffect(() => {
    const nextSlide = SLIDES[index + 1];
    if (!nextSlide || typeof Image === "undefined") return;
    const img = new Image();
    img.src = nextSlide.image;
  }, [index]);

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  const onSwipeStart = (event) => {
    const point = event.touches?.[0];
    const el = scrollerRef.current;
    if (!point || !el) return;
    touchStartRef.current = { x: point.clientX, y: point.clientY };
    touchStartSlideRef.current = Math.round(el.scrollLeft / el.clientWidth);
  };

  const onSwipeEnd = (event) => {
    const point = event.changedTouches?.[0];
    const startX = touchStartRef.current.x;
    const startY = touchStartRef.current.y;
    const el = scrollerRef.current;
    if (!point || startX == null || startY == null || !el) return;

    const deltaX = point.clientX - startX;
    const deltaY = Math.abs(point.clientY - startY);
    const endSlide = Math.round(el.scrollLeft / el.clientWidth);
    const startedOnLast = touchStartSlideRef.current === lastIndex;
    const endedOnLast = endSlide === lastIndex;
    const isHorizontal = Math.abs(deltaX) > deltaY * 1.15;
    const didLeftSwipe = deltaX < -56;

    touchStartRef.current = { x: null, y: null };

    if (startedOnLast && endedOnLast && isHorizontal && didLeftSwipe) {
      goToAuthWithTransition("left");
    }
  };

  const markImageBroken = (src) => {
    setBrokenImages((prev) => {
      if (prev[src]) return prev;
      return { ...prev, [src]: true };
    });
  };

  return (
    <div
      className={cx(
        "h-[calc(100dvh-var(--app-safe-top))] overflow-hidden overscroll-none bg-white transition-[opacity,transform,filter] duration-200",
        isExiting &&
          (exitDirection === "left"
            ? "pointer-events-none -translate-x-6 opacity-0 blur-[2px]"
            : "pointer-events-none translate-x-6 opacity-0 blur-[2px]")
      )}
    >
      <div className="mx-auto flex h-full max-w-xl flex-col px-5 pt-6 pb-[calc(var(--app-safe-bottom)+2rem)]">
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <div className="justify-self-start text-xs font-semibold text-zinc-500">
            {index + 1}/{SLIDES.length}
          </div>

          <h1 className="justify-self-center whitespace-nowrap text-center text-[1.45rem] leading-none font-black tracking-[0.08em] text-emerald-700 drop-shadow-[0_1px_3px_rgba(5,150,105,0.3)]">
            MAJUU APP
          </h1>

          <button
            type="button"
            onClick={goToAuth}
            className="justify-self-end text-sm font-semibold text-zinc-500 transition hover:text-zinc-800"
          >
            Skip
          </button>
        </header>

        <div className="mt-3 flex items-center justify-center gap-2">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => scrollToIndex(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={cx(
                "h-2 rounded-full transition",
                idx === index ? "w-7 bg-emerald-600" : "w-2 bg-zinc-300"
              )}
            />
          ))}
        </div>

        <div
          ref={scrollerRef}
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
          className="mt-3 -mx-5 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"
        >
          {SLIDES.map((slide, idx) => {
            const imageMissing = Boolean(brokenImages[slide.image]);
            return (
              <section
                key={slide.image}
                className="w-full shrink-0 snap-start [scroll-snap-stop:always] px-5 bg-white"
              >
                <div className="flex h-full flex-col">
                  <div className="pt-3">
                    <h2 className="text-center text-[1.22rem] leading-tight font-semibold tracking-tight text-zinc-900">
                      {slide.title}
                    </h2>
                    <p className="mt-2 text-center text-sm text-zinc-600">{slide.subtitle}</p>
                  </div>

                  <div className="min-h-0 flex-1 pt-4">
                    {!imageMissing ? (
                      <div className="flex h-full items-center justify-center">
                        <img
                          src={slide.image}
                          alt={slide.imageAlt}
                          className="h-full w-full object-contain"
                          onError={() => markImageBroken(slide.image)}
                          loading={idx === 0 ? "eager" : "lazy"}
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900">
                            Add slide image
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            Place file at <code>{slide.image}</code>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="-translate-y-2 pb-2 pt-2">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {(slide.pills || []).map((pill) => (
                        <span
                          key={pill}
                          className="text-[11px] font-bold uppercase tracking-[0.09em] text-emerald-700 [text-shadow:0_0_8px_rgba(16,185,129,0.45)]"
                        >
                          {pill}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <footer className="mt-3 flex items-center justify-end text-sm font-semibold">
          {isLast ? (
            <button
              type="button"
              onClick={() => goToAuthWithTransition("left")}
              className="mr-3 font-extrabold tracking-tight text-emerald-700 transition hover:text-emerald-800"
            >
              Continue
            </button>
          ) : (
            <span aria-hidden="true" className="mr-3 w-16" />
          )}
        </footer>
      </div>
    </div>
  );
}

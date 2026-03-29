import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Check,
  Compass,
  CreditCard,
  DollarSign,
  Globe,
  Lock,
  Search,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import CurrentProcessRing from "../components/home/CurrentProcessRing";
import { setIntroSeen } from "../utils/introFlag";

const SLIDES = [
  {
    title: "Discover the right country for you",
    subtitle:
      "Explore study, work, and travel opportunities and compare destinations based on what fits you best.",
  },
  {
    title: "Choose how you want to move forward",
    subtitle:
      "Go with Self-Help to handle your journey independently, or choose from a list of verified agents for guided support.",
  },
  {
    title: "Track your applications with clarity",
    subtitle:
      "Track your progress from start to finish through a clearer, more transparent application journey.",
  },
  {
    title: "Pay with confidence",
    subtitle:
      "Guided application payments are transparent, protected, and refundable throughout the process.",
  },
];

const DISCOVERY_TAGLINES = [
  "Explore countries before you decide",
  "Find your best study destination",
  "Find your best work destination",
  "Find your best travel destination",
  "Compare countries side by side",
];

const INTRO_BACKGROUND = {
  background:
    "radial-gradient(82% 54% at 50% -8%, rgba(16,185,129,0.16) 0%, rgba(16,185,129,0) 54%), radial-gradient(50% 36% at 85% 82%, rgba(20,184,166,0.08) 0%, rgba(20,184,166,0) 58%), #020303",
};

const PROGRESS_ITEMS = [
  {
    label: "Passport",
    percent: 20,
    valueLabel: "20%",
    note: "",
    gradient: "from-emerald-400 via-teal-300 to-cyan-300",
    position: "left-[0.2rem] top-[5.95rem]",
    align: "text-left",
  },
  {
    label: "Visa",
    percent: 50,
    valueLabel: "50%",
    note: "",
    gradient: "from-emerald-400 via-teal-400 to-cyan-400",
    position: "left-[0.2rem] bottom-[7.15rem]",
    align: "text-left",
  },
  {
    label: "IELTS",
    percent: 100,
    valueLabel: "100%",
    note: "",
    gradient: "from-emerald-300 via-lime-300 to-teal-300",
    position: "right-[0.2rem] top-[5.95rem]",
    align: "text-right",
  },
  {
    label: "Offer Letter",
    percent: 0,
    valueLabel: "0%",
    note: "Pending",
    gradient: "from-emerald-400 via-teal-300 to-cyan-300",
    position: "right-[0.2rem] bottom-[7.15rem]",
    align: "text-right",
  },
];

const TRUST_CUES = [
  { label: "Secure", icon: Lock, position: "left-[-0.3rem] top-[4.35rem]" },
  { label: "Transparent", icon: CreditCard, position: "left-1/2 top-[1.2rem] -translate-x-1/2" },
  { label: "Verified", icon: BadgeCheck, position: "right-[-0.2rem] top-[4.35rem]" },
  { label: "Protected", icon: ShieldCheck, position: "left-[-0.2rem] bottom-[5.35rem]" },
  { label: "Refundable", icon: Check, position: "right-[-0.2rem] bottom-[5.35rem]" },
];

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function DiscoveryHero({ taglineText }) {
  return (
    <div className="relative mx-auto h-[20.5rem] w-full max-w-[23rem]">
      <div className="absolute left-1/2 top-[8.25rem] w-[19.8rem] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[2rem] border border-emerald-200/18 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 px-5 py-4 shadow-[0_22px_54px_rgba(16,185,129,0.22)]">
        <div className="text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/78">
            Discovery
          </div>
          <div className="mt-1.5 text-[1.12rem] font-semibold tracking-[-0.015em] text-white">
            Discover Destinations
          </div>
          <p className="mt-2 h-[1.25rem] text-xs text-white/92">
            <span className="inline-flex items-center justify-center">
              {taglineText}
              <span className="ml-1 inline-block h-3.5 w-px animate-pulse bg-white/90" />
            </span>
          </p>
          <div className="mx-auto mt-3.5 h-px w-20 bg-white/38" />
        </div>
      </div>

      <div className="absolute left-1/2 top-[13.15rem] flex -translate-x-1/2 items-center justify-center gap-5">
        {[Globe, Compass, Search].map((Icon, iconIndex) => (
          <button
            key={iconIndex}
            type="button"
            tabIndex={-1}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200/24 bg-white/6 text-emerald-50 backdrop-blur-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-200/40 hover:bg-white/10 hover:shadow-[0_10px_28px_rgba(16,185,129,0.16)]"
          >
            <AppIcon size={18} icon={Icon} className="text-emerald-50" />
          </button>
        ))}
      </div>
    </div>
  );
}

function MoveForwardHero() {
  return (
    <div className="relative mx-auto h-[20.5rem] w-full max-w-[23rem]">
      <div className="absolute inset-x-0 top-[3.85rem] flex items-start justify-center gap-7">
        <div className="relative w-[8.2rem] text-center">
          <div className="pointer-events-none absolute left-1/2 top-[0.9rem] h-24 w-24 -translate-x-1/2 rounded-full bg-emerald-400/10 blur-2xl" />
          <div className="relative mx-auto flex h-[7.7rem] w-[7.7rem] items-center justify-center rounded-full border border-white/8 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <AppIcon size={32} icon={User} className="text-emerald-50" />
          </div>
          <div className="mt-4 text-[1.1rem] font-semibold tracking-[-0.02em] text-emerald-50">
            Self Help
          </div>
          <div className="mt-2 inline-flex items-center rounded-full border border-emerald-300/18 bg-emerald-400/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200">
            Free
          </div>
          <div className="mt-2 text-[10px] text-emerald-100/54">Independent</div>
        </div>

        <div className="relative w-[8.4rem] text-center">
          <div className="pointer-events-none absolute left-1/2 top-[-0.15rem] h-32 w-32 -translate-x-1/2 rounded-full bg-teal-400/28 blur-2xl" />
          <div className="relative mx-auto flex h-[8.1rem] w-[8.1rem] items-center justify-center rounded-full border border-teal-200/26 bg-gradient-to-br from-emerald-400/30 via-teal-400/34 to-cyan-300/30 shadow-[0_24px_52px_rgba(20,184,166,0.26)]">
            <AppIcon size={35} icon={Users} className="text-white" />
          </div>
          <div className="mt-4 text-[1.16rem] font-semibold tracking-[-0.02em] text-white">
            We Help
          </div>
          <div className="mt-2 inline-flex items-center rounded-full border border-cyan-200/30 bg-cyan-300/18 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
            Paid
          </div>
          <div className="mt-2 text-[10px] text-emerald-100/58">Guided</div>
        </div>
      </div>
    </div>
  );
}

function ProgressBarItem({ item }) {
  return (
    <div className={cx("absolute w-[5.8rem]", item.position, item.align)}>
      <div className="flex items-center justify-between gap-1.5 text-[8px]">
        <span className="font-medium text-emerald-50">{item.label}</span>
        <span className="font-semibold text-emerald-100/76">{item.valueLabel}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/9">
        <div
          className={cx("h-full rounded-full bg-gradient-to-r", item.gradient)}
          style={{ width: `${item.percent}%` }}
        />
      </div>
      {item.note ? (
        <div className="mt-0.5 text-[8px] text-emerald-100/52">{item.note}</div>
      ) : null}
    </div>
  );
}

function ProgressHero() {
  return (
    <div className="relative mx-auto h-[20.5rem] w-full max-w-[23rem]">
      <div className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-100/54">
          Australia
        </div>
        <div className="mt-1 text-sm font-medium text-emerald-50/88">Study</div>
        <div className="relative mt-4">
          <CurrentProcessRing
            percent={70}
            size={138}
            stroke={11}
            label="Australia Study 69%"
            textClassName="text-[1.9rem] font-semibold text-white dark:text-white"
            textStyle={{ fontSize: "1.9rem", color: "#ffffff", fontWeight: 700, lineHeight: 1 }}
          />
          <div className="pointer-events-none absolute -inset-3 -z-10 rounded-full bg-emerald-400/8 blur-2xl" />
        </div>
      </div>

      {PROGRESS_ITEMS.map((item) => (
        <ProgressBarItem key={item.label} item={item} />
      ))}
    </div>
  );
}

function ConfidenceHero() {
  return (
    <div className="relative mx-auto h-[20.5rem] w-full max-w-[23rem]">
      <div className="absolute left-1/2 top-[46%] flex h-[10.35rem] w-[10.35rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[2.7rem] border border-emerald-200/14 bg-black/38 shadow-[0_24px_54px_rgba(16,185,129,0.16)]">
        <div className="absolute inset-[0.6rem] rounded-[2.15rem] bg-gradient-to-br from-emerald-400/26 via-teal-400/18 to-cyan-400/22" />
        <AppIcon size={54} icon={ShieldCheck} className="relative text-emerald-50" />
        <span className="absolute -bottom-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200/24 bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 text-black shadow-[0_14px_34px_rgba(20,184,166,0.24)]">
          <AppIcon size={20} icon={DollarSign} className="text-black" />
        </span>
      </div>

      {TRUST_CUES.map((cue) => (
        <div
          key={cue.label}
          className={cx(
            "absolute inline-flex items-center gap-1.5 rounded-full border border-emerald-200/16 bg-white/6 px-2.5 py-1 text-[10px] font-medium text-emerald-50/94 backdrop-blur-sm",
            cue.position
          )}
        >
          <AppIcon size={16} icon={cue.icon} className="text-emerald-50" />
          <span>{cue.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function IntroScreen() {
  const navigate = useNavigate();
  const scrollerRef = useRef(null);
  const touchStartRef = useRef({ x: null, y: null });
  const touchStartSlideRef = useRef(0);
  const exitTimerRef = useRef(null);

  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDirection, setExitDirection] = useState("left");
  const [taglineIndex, setTaglineIndex] = useState(0);
  const [taglineText, setTaglineText] = useState("");
  const [taglineDeleting, setTaglineDeleting] = useState(false);

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

  useEffect(() => {
    return () => {
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!DISCOVERY_TAGLINES.length) return undefined;

    if (reduceMotion) {
      const phrase = DISCOVERY_TAGLINES[taglineIndex] || DISCOVERY_TAGLINES[0];
      setTaglineText(phrase);
      const rotateTimer = window.setTimeout(() => {
        setTaglineIndex((current) => (current + 1) % DISCOVERY_TAGLINES.length);
      }, 2600);
      return () => window.clearTimeout(rotateTimer);
    }

    const fullText = DISCOVERY_TAGLINES[taglineIndex] || "";

    if (!taglineDeleting && taglineText === fullText) {
      const pauseTimer = window.setTimeout(() => {
        setTaglineDeleting(true);
      }, 3700);
      return () => window.clearTimeout(pauseTimer);
    }

    if (taglineDeleting && taglineText.length === 0) {
      const nextTimer = window.setTimeout(() => {
        setTaglineDeleting(false);
        setTaglineIndex((current) => (current + 1) % DISCOVERY_TAGLINES.length);
      }, 320);
      return () => window.clearTimeout(nextTimer);
    }

    const tickTimer = window.setTimeout(
      () => {
        setTaglineText((current) =>
          taglineDeleting
            ? fullText.slice(0, Math.max(0, current.length - 1))
            : fullText.slice(0, Math.min(fullText.length, current.length + 1))
        );
      },
      taglineDeleting ? 34 : 50
    );
    return () => window.clearTimeout(tickTimer);
  }, [reduceMotion, taglineDeleting, taglineIndex, taglineText]);

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
    const didLeftSwipe = deltaX < -52;

    touchStartRef.current = { x: null, y: null };

    if (startedOnLast && endedOnLast && isHorizontal && didLeftSwipe) {
      goToAuthWithTransition("left");
    }
  };

  return (
    <div
      className={cx(
        "relative h-[calc(var(--app-viewport-height)-var(--app-safe-top))] overflow-hidden overscroll-none text-slate-50 transition-[opacity,transform,filter] duration-300",
        isExiting &&
          (exitDirection === "left"
            ? "pointer-events-none -translate-x-6 opacity-0 blur-[2px]"
            : "pointer-events-none translate-x-6 opacity-0 blur-[2px]")
      )}
      style={{
        ...INTRO_BACKGROUND,
        fontFamily: "Space Grotesk, Manrope, 'Avenir Next', 'Segoe UI', sans-serif",
      }}
    >
      <div className="mx-auto flex h-full max-w-xl flex-col px-5 pt-8 pb-[calc(var(--app-safe-bottom)+1.25rem)]">
        <header className="relative z-20 grid grid-cols-[1fr_auto_1fr] items-start">
          <div className="h-8 w-10 justify-self-start" />

          <h1 className="justify-self-center whitespace-nowrap text-center text-[1.36rem] leading-none font-black tracking-[0.14em] text-emerald-50">
            MAJUU
          </h1>

          <div className="justify-self-end text-right">
            <button
              type="button"
              onClick={goToAuth}
              className="text-sm font-semibold text-emerald-100/84 transition hover:text-emerald-50"
            >
              Skip
            </button>
          </div>
        </header>

        <div
          ref={scrollerRef}
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
          className="mt-5 -mx-5 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden"
        >
          {SLIDES.map((slide, idx) => (
            <section
              key={slide.title}
              className="w-full shrink-0 snap-start [scroll-snap-stop:always] px-5"
            >
              <div className="flex h-full flex-col">
                <div className="mx-auto w-full max-w-[21.8rem] pt-7 text-center">
                  <h2 className="text-[2.08rem] leading-[1.04] font-semibold tracking-[-0.04em] text-emerald-50">
                    {slide.title}
                  </h2>
                  <p className="mx-auto mt-3 max-w-[20.2rem] text-sm leading-relaxed text-emerald-100/66">
                    {slide.subtitle}
                  </p>
                </div>

                <div className="relative min-h-0 flex-1">
                  <div className="relative flex h-full items-center justify-center">
                    {idx === 0 ? <DiscoveryHero taglineText={taglineText} /> : null}
                    {idx === 1 ? <MoveForwardHero /> : null}
                    {idx === 2 ? <ProgressHero /> : null}
                    {idx === 3 ? <ConfidenceHero /> : null}
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>

        <footer className="relative z-20 pt-3">
          <p className="mb-2 text-center text-xs font-medium text-emerald-100/76">
            {isLast ? "Swipe to sign in" : "Swipe"}
          </p>
          <div className="flex items-center justify-center gap-2">
            {SLIDES.map((_, idx) => (
              <span
                key={`dot-${idx}`}
                className={cx(
                  "h-1.5 rounded-full transition-all duration-300",
                  idx === index ? "w-6 bg-emerald-300" : "w-1.5 bg-emerald-100/22"
                )}
              />
            ))}
          </div>
        </footer>
      </div>
    </div>
  );
}

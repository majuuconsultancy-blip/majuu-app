import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion as Motion } from "../../utils/motionProxy";
import { ChevronRight, Newspaper, Radio } from "lucide-react";

import AppIcon from "../AppIcon";
import { ICON_MD, ICON_SM } from "../../constants/iconSizes";

function safeString(value, max = 220) {
  return String(value || "").trim().slice(0, max);
}

function impactTone(label) {
  const safe = safeString(label, 40).toLowerCase();
  if (safe.includes("critical") || safe.includes("high")) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200";
  }
  if (safe.includes("important")) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
}

export default function TrackPulseStrip({
  items = [],
  loading = false,
  onOpenItem,
  onOpenFeed,
  className = "",
}) {
  const safeItems = useMemo(() => {
    return (Array.isArray(items) ? items : []).filter((item) => safeString(item?.title, 220));
  }, [items]);
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActiveIndex = safeItems.length ? activeIndex % safeItems.length : 0;

  useEffect(() => {
    if (safeItems.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % safeItems.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [safeItems.length]);

  const activeItem = safeItems[safeActiveIndex] || null;
  const itemKey =
    `${safeString(activeItem?.id, 80) || safeString(activeItem?.title, 120)}:` +
    safeActiveIndex;
  const rootClass = className.trim();

  if (loading) {
    return (
      <section className={rootClass}>
        <div className="h-3.5 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-10 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/70" />
      </section>
    );
  }

  return (
    <section className={rootClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
          <AppIcon size={ICON_SM} icon={Radio} />
          What's Happening
        </div>
        <button
          type="button"
          onClick={onOpenFeed}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 transition hover:border-emerald-200 hover:text-emerald-800 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-emerald-900/40"
        >
          <AppIcon size={ICON_SM} icon={Newspaper} />
          News
        </button>
      </div>

      {!activeItem ? (
        <button
          type="button"
          onClick={onOpenFeed}
          className="mt-2.5 w-full rounded-2xl border border-dashed border-zinc-200/85 bg-white/70 px-3 py-3 text-left text-sm text-zinc-600 transition hover:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300"
        >
          No published pulse updates yet. Tap to open News.
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpenItem?.(activeItem)}
          className="mt-2.5 flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white/86 px-3 py-3 text-left transition hover:border-emerald-200 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/62 dark:hover:border-emerald-900/40"
        >
          <div className="min-w-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait">
              <Motion.div
                key={itemKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    {safeString(activeItem?.pulseCountry || activeItem?.country || "Global", 80)}
                  </span>
                  {safeString(activeItem?.impactLabel, 40) ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${impactTone(
                        activeItem?.impactLabel
                      )}`}
                    >
                      {activeItem.impactLabel}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {safeString(activeItem?.title, 180)}
                </div>
              </Motion.div>
            </AnimatePresence>
          </div>

          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100">
            <AppIcon size={ICON_MD} icon={ChevronRight} />
          </span>
        </button>
      )}

      {safeItems.length > 1 ? (
        <div className="mt-1.5 text-right text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {safeActiveIndex + 1}/{safeItems.length}
        </div>
      ) : null}
    </section>
  );
}

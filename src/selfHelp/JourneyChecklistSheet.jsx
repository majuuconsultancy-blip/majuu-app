import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion as Motion } from "../utils/motionproxy";
import { Check, EllipsisVertical, X } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";

const overlayMotion = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] } },
};

const panelMotion = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    y: 6,
    scale: 0.99,
    transition: { duration: 0.1, ease: [0.2, 0.8, 0.2, 1] },
  },
};

export default function JourneyChecklistSheet({
  open,
  trackLabel,
  country,
  steps,
  completedStepIds,
  saving,
  onClose,
  onSave,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(completedStepIds || []));
  const orderedSteps = useMemo(() => (Array.isArray(steps) ? steps : []), [steps]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose?.();
    };

    const onBack = (event) => {
      if (!saving) {
        event.preventDefault?.();
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("majuu:back", onBack);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("majuu:back", onBack);
    };
  }, [onClose, open, saving]);

  const summary = useMemo(() => {
    const total = orderedSteps.length;
    const completed = orderedSteps.filter((step) => selectedIds.has(step.id)).length;
    return {
      completed,
      total,
      percent: total ? Math.round((completed / total) * 100) : 0,
    };
  }, [orderedSteps, selectedIds]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open ? (
        <Motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 app-overlay-safe"
          variants={overlayMotion}
          initial="hidden"
          animate="show"
          exit="exit"
        >
          <button
            type="button"
            aria-label="Close journey checklist"
            className="absolute inset-0"
            onClick={() => !saving && onClose?.()}
          />

          <Motion.div
            className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-zinc-200 bg-white px-5 pb-5 pt-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 sm:mb-6 sm:rounded-[28px]"
            style={{
              height:
                "min(62vh, calc(var(--app-viewport-height) - var(--app-safe-top) - var(--app-safe-bottom) - 2rem))",
              maxHeight:
                "min(62vh, calc(var(--app-viewport-height) - var(--app-safe-top) - var(--app-safe-bottom) - 2rem))",
            }}
            variants={panelMotion}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-zinc-200 dark:bg-zinc-700 sm:hidden" />

            <button
              type="button"
              onClick={() => !saving && onClose?.()}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <AppIcon size={ICON_MD} icon={X} />
            </button>

            <div className="pr-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
                <AppIcon size={ICON_SM} icon={EllipsisVertical} />
                Journey checklist
              </div>
              <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {trackLabel} {country ? `for ${country}` : "journey"}
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Select the documents you already have and we'll help find the best next step.
              </p>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/35 dark:bg-emerald-950/20">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">
                      Saved progress
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                      {summary.completed}/{summary.total}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                    {summary.percent}%
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {orderedSteps.map((step) => {
                  const checked = selectedIds.has(step.id);
                  return (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (next.has(step.id)) next.delete(step.id);
                          else next.add(step.id);
                          return next;
                        })
                      }
                      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        checked
                          ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/35 dark:bg-emerald-950/18"
                          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/35"
                      }`}
                    >
                      <span
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${
                          checked
                            ? "border-emerald-200 bg-emerald-600 text-white dark:border-emerald-900/40"
                            : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200"
                        }`}
                      >
                        {checked ? <AppIcon size={ICON_SM} icon={Check} /> : step.stepNumber}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {step.title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                          {step.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onSave?.(Array.from(selectedIds))}
                className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save checklist"}
              </button>
              <button
                type="button"
                onClick={() => !saving && onClose?.()}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      ) : null}
    </AnimatePresence>
  );
}

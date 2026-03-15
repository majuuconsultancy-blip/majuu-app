import { useEffect, useState } from "react";
import { AnimatePresence, motion as Motion } from "../utils/motionProxy";
import { CalendarDays, Home, MapPin, X } from "lucide-react";
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

function fieldIcon(fieldId) {
  if (fieldId === "city") return MapPin;
  if (fieldId === "checkIn") return CalendarDays;
  return Home;
}

export default function SmartStayDialog({
  open,
  title,
  description,
  fields,
  initialValues,
  submitting,
  onClose,
  onSubmit,
}) {
  const [values, setValues] = useState(() => initialValues || {});

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !submitting) {
        onClose?.();
      }
    };

    const onBack = (event) => {
      if (!submitting) {
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
  }, [onClose, open, submitting]);

  if (!open) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit?.(values);
  };

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
            aria-label="Close stay planner"
            className="absolute inset-0"
            onClick={() => !submitting && onClose?.()}
          />

          <Motion.div
            className="relative w-full max-w-md rounded-t-[28px] border border-zinc-200 bg-white px-5 pb-5 pt-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 sm:mb-6 sm:rounded-[28px]"
            variants={panelMotion}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-zinc-200 dark:bg-zinc-700 sm:hidden" />

            <button
              type="button"
              onClick={() => !submitting && onClose?.()}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <AppIcon size={ICON_MD} icon={X} />
            </button>

            <div className="pr-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                <AppIcon size={ICON_SM} icon={Home} />
                Smart stay
              </div>
              <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {title}
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{description}</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 grid gap-3">
              {fields.map((field) => {
                const value = values[field.id] || "";
                const Icon = fieldIcon(field.id);

                return (
                  <label key={field.id} className="grid gap-1.5">
                    <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      {field.label}
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                      <AppIcon size={ICON_SM} icon={Icon} className="text-zinc-500 dark:text-zinc-300" />

                      {field.type === "select" ? (
                        <select
                          value={value}
                          required={field.required}
                          onChange={(event) =>
                            setValues((prev) => ({ ...prev, [field.id]: event.target.value }))
                          }
                          className="w-full bg-transparent text-sm text-zinc-900 outline-none dark:text-zinc-100"
                        >
                          <option value="">Choose one</option>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          value={value}
                          placeholder={field.placeholder || ""}
                          required={field.required}
                          onChange={(event) =>
                            setValues((prev) => ({ ...prev, [field.id]: event.target.value }))
                          }
                          className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                        />
                      )}
                    </div>
                  </label>
                );
              })}

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {submitting ? "Opening..." : "Open stay search"}
                </button>
                <button
                  type="button"
                  onClick={() => !submitting && onClose?.()}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Motion.div>
        </Motion.div>
      ) : null}
    </AnimatePresence>
  );
}

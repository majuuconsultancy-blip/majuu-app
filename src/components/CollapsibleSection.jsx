import { useState } from "react";

function IconChevronDown(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 9.5 12 15l5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CollapsibleSection({
  title,
  subtitle = "",
  meta = "",
  defaultOpen = false,
  open,
  onToggle,
  className = "",
  headerClassName = "",
  bodyClassName = "",
  disabled = false,
  children,
}) {
  const isControlled = typeof open === "boolean";
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpen));
  const isOpen = isControlled ? Boolean(open) : internalOpen;

  const toggle = () => {
    if (disabled) return;
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  return (
    <section className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        disabled={disabled}
        className={[
          "flex w-full items-center justify-between gap-3 text-left transition disabled:opacity-60",
          headerClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="min-w-0">
          {title ? (
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
          ) : null}
          {subtitle ? (
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {meta ? (
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{meta}</span>
          ) : null}
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white/80 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
            <IconChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            />
          </span>
        </div>
      </button>

      {isOpen ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  );
}

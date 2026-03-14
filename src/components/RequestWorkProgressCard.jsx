import { getRequestWorkProgress } from "../utils/requestWorkProgress";

export default function RequestWorkProgressCard({
  request,
  className = "",
  title = "Work progress",
  subtitle = "",
  showWhenIdle = false,
  idleText = "Work has not started yet.",
  pendingText = "Work started. Progress update pending.",
  children = null,
}) {
  const progress = getRequestWorkProgress(request);
  const progressPercent = progress.progressPercent;
  const hasPercent = Number.isFinite(progressPercent) && progressPercent > 0;
  const shouldRender = showWhenIdle || progress.isStarted || hasPercent || children;

  if (!shouldRender) return null;

  const badgeLabel = hasPercent ? `${progressPercent}%` : progress.isInProgress ? "Live" : "Waiting";
  const badgeCls = hasPercent
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : progress.isInProgress
    ? "border-blue-200 bg-blue-50 text-blue-800"
    : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300";

  const helperText = hasPercent
    ? "Updated directly by staff."
    : progress.isStarted || progress.isInProgress
    ? pendingText
    : idleText;

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</div>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badgeCls}`}>
          {badgeLabel}
        </span>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800/80">
        {hasPercent ? (
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out dark:bg-emerald-400"
            style={{ width: `${progressPercent}%` }}
          />
        ) : null}
      </div>

      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{helperText}</div>

      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

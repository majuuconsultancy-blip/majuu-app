function safeStr(value) {
  return String(value || "").trim();
}

function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === "function") {
    try {
      return Number(value.toMillis()) || 0;
    } catch {
      return 0;
    }
  }
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  return 0;
}

function formatUpdateTime(update) {
  const ms = Math.max(0, Number(update?.createdAtMs || 0) || 0, toMillis(update?.createdAt));
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RequestProgressUpdatesList({
  updates = [],
  viewerRole = "user",
  emptyText = "No progress updates yet.",
}) {
  const rows = Array.isArray(updates) ? updates : [];
  const safeViewerRole = safeStr(viewerRole).toLowerCase();

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        Progress timeline
      </div>

      {rows.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-900/40 px-3 py-3 text-sm text-zinc-500 dark:text-zinc-400">
          {emptyText}
        </div>
      ) : (
        <div className="mt-3 grid gap-3">
          {rows.map((update) => {
            const timeLabel = formatUpdateTime(update);
            const isInternal = safeViewerRole !== "user" && update?.visibleToUser === false;
            const progressPercent = Math.round(Number(update?.progressPercent));
            const hasProgress =
              Number.isFinite(progressPercent) && progressPercent >= 0 && progressPercent <= 100;

            return (
              <div
                key={safeStr(update?.id) || `${timeLabel}_${safeStr(update?.content, 80)}`}
                className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {hasProgress ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      {progressPercent}%
                    </span>
                  ) : null}
                  {isInternal ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                      Internal only
                    </span>
                  ) : null}
                  {timeLabel ? (
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      {timeLabel}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 text-sm whitespace-pre-wrap text-zinc-800 dark:text-zinc-100">
                  {safeStr(update?.content) || "Progress updated."}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


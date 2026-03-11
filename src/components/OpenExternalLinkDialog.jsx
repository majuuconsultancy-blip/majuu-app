export default function OpenExternalLinkDialog({
  open,
  title = "Open external link?",
  description = "You are about to open a website outside MAJUU.",
  linkLabel = "",
  onOpen,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 app-overlay-safe">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{description}</p>

        {linkLabel ? (
          <div className="mt-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {linkLabel}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Open
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

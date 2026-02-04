export default function ScreenLoader({
  title = "Loading…",
  subtitle = "Please wait a moment",
  full = true,
}) {
  const Wrap = ({ children }) =>
    full ? (
      <div className="min-h-screen bg-white">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white flex items-center justify-center px-5">
          {children}
        </div>
      </div>
    ) : (
      <div className="flex items-center justify-center px-5 py-10">{children}</div>
    );

  return (
    <Wrap>
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white/70 p-6 shadow-sm backdrop-blur">
        {/* top icon + spinner */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 flex items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">{title}</p>
            <p className="text-xs text-zinc-600">{subtitle}</p>
          </div>
        </div>

        {/* shimmer skeleton */}
        <div className="mt-5 space-y-3">
          <div className="h-3 w-4/5 rounded bg-zinc-100 overflow-hidden relative">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-100" />
          </div>
          <div className="h-3 w-3/5 rounded bg-zinc-100 overflow-hidden relative">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-100" />
          </div>
          <div className="h-3 w-2/3 rounded bg-zinc-100 overflow-hidden relative">
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-zinc-100 via-zinc-200 to-zinc-100" />
          </div>
        </div>
      </div>
    </Wrap>
  );
}
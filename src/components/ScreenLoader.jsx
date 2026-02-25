// ScreenLoader.jsx
// Global full-screen loader used during auth/session checks and blocking states.
// Props:
// - title: string
// - subtitle: string (optional)
// - hint: string (optional)
// - variant: "default" | "minimal" (optional)

export default function ScreenLoader({
  title = "Loading...",
  subtitle = "",
  hint = "",
  variant = "default",
}) {
  const isMinimal = variant === "minimal";

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 px-6 t-fade">
      <div className="mx-auto max-w-xl min-h-screen grid place-items-center">
        <div className={`w-full text-center anim-in-fade ${isMinimal ? "max-w-sm" : "max-w-md"}`}>
          <div className="relative mx-auto h-24 w-24">
            <div className="absolute inset-0 rounded-full bg-emerald-500/16 dark:bg-emerald-400/16 blur-xl motion-loader-glow" />
            <div className="relative flex h-full w-full items-center justify-center">
              <span className="text-lg font-semibold tracking-tight text-emerald-500 dark:text-emerald-400 motion-loader-mark">
                M
              </span>
            </div>
          </div>

          <div className="mt-5 text-base font-semibold leading-snug">{title}</div>

          {subtitle ? (
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</div>
          ) : null}

          {hint ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{hint}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

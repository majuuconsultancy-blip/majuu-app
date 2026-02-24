export default function AppLoading() {
  return (
    <div className="min-h-screen grid place-items-center bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 px-6 t-fade">
      <div className="w-full max-w-sm text-center anim-in-fade">
        <div className="relative mx-auto h-24 w-24">
          <div className="absolute inset-0 rounded-full bg-emerald-500/16 dark:bg-emerald-400/16 blur-xl motion-loader-glow" />
          <div className="relative flex h-full w-full items-center justify-center">
            <span className="text-6xl font-black tracking-tight text-emerald-500 dark:text-emerald-400 motion-loader-mark">
              M
            </span>
          </div>
        </div>

        <p className="mt-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Loading...
        </p>
      </div>
    </div>
  );
}

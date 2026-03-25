import { useEffect, useState } from "react";
import { getThemeMode, setThemeMode } from "../utils/theme";

function IconMoon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20.2 14.9A7.8 7.8 0 0 1 9.1 3.8 7.9 7.9 0 1 0 20.2 14.9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSun(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 18.2a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4Z" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ThemeToggle() {
  const [mode, setMode] = useState(() => getThemeMode());

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === "majuu_theme") setMode(getThemeMode());
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setNextMode = (nextMode) => {
    const safeMode = nextMode === "dark" ? "dark" : "light";
    setMode(safeMode);
    setThemeMode(safeMode);
  };

  const isDark = mode === "dark";

  return (
    <div className="rounded-[1.1rem] border border-zinc-200/80 bg-white/80 p-1 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-zinc-700/70 dark:bg-zinc-900/70">
      <div className="relative grid min-w-[11rem] grid-cols-2 items-center">
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-[calc(50%-0.125rem)] rounded-[0.85rem] bg-zinc-950 shadow-sm transition-transform duration-200 ease-out dark:bg-white ${
            isDark ? "translate-x-full" : "translate-x-0"
          }`}
        />

        <button
          type="button"
          onClick={() => setNextMode("light")}
          className={`relative z-10 inline-flex items-center justify-center gap-2 rounded-[0.85rem] px-3 py-2 text-sm font-semibold transition ${
            isDark ? "text-zinc-500 dark:text-zinc-400" : "text-white dark:text-zinc-950"
          }`}
          aria-pressed={!isDark}
          title="Use light theme"
        >
          <IconSun className="h-4 w-4" />
          <span>Light</span>
        </button>

        <button
          type="button"
          onClick={() => setNextMode("dark")}
          className={`relative z-10 inline-flex items-center justify-center gap-2 rounded-[0.85rem] px-3 py-2 text-sm font-semibold transition ${
            isDark ? "text-zinc-950 dark:text-zinc-950" : "text-zinc-500 dark:text-zinc-400"
          }`}
          aria-pressed={isDark}
          title="Use dark theme"
        >
          <IconMoon className="h-4 w-4" />
          <span>Dark</span>
        </button>
      </div>
    </div>
  );
}

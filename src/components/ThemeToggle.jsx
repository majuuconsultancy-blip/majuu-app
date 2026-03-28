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
  const Icon = isDark ? IconSun : IconMoon;
  const nextMode = isDark ? "light" : "dark";
  const nextLabel = isDark ? "Use light theme" : "Use dark theme";

  return (
    <button
      type="button"
      onClick={() => setNextMode(nextMode)}
      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/80 text-zinc-700 shadow-[0_10px_26px_rgba(15,23,42,0.08)] backdrop-blur-xl transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700/70 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
      aria-label={nextLabel}
      title={nextLabel}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

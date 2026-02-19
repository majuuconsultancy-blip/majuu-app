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
      <path
        d="M12 18.2a6.2 6.2 0 1 0 0-12.4 6.2 6.2 0 0 0 0 12.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
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
  const [mode, setMode] = useState(() => getThemeMode()); // no flash

  useEffect(() => {
    // keep in sync if something else changes theme
    const onStorage = (e) => {
      if (e.key === "theme") setMode(getThemeMode());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = () => {
    const next = mode === "dark" ? "light" : "dark";
    setMode(next);
    setThemeMode(next);
  };

  const isDark = mode === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]
                 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
      title={isDark ? "Switch to light" : "Switch to dark"}
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white/60 text-zinc-700
                       dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-100"
      >
        {isDark ? <IconMoon className="h-4 w-4" /> : <IconSun className="h-4 w-4" />}
      </span>
      <span className="text-xs">{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}
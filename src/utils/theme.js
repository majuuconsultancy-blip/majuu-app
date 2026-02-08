const KEY = "majuu_theme"; // "light" | "dark"

function applyTheme(mode) {
  const root = document.documentElement;
  const useDark = mode === "dark";
  root.classList.toggle("dark", useDark);
}

export function getThemeMode() {
  const v = localStorage.getItem(KEY);
  return v === "dark" ? "dark" : "light";
}

export function setThemeMode(mode) {
  const safe = mode === "dark" ? "dark" : "light";
  localStorage.setItem(KEY, safe);
  applyTheme(safe);
}

export function initTheme() {
  applyTheme(getThemeMode());

  // keep in sync across tabs/windows
  const onStorage = (e) => {
    if (e.key === KEY) applyTheme(getThemeMode());
  };
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
  };
}
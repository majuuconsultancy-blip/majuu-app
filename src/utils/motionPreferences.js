const STORAGE_KEY = "majuu_reduce_motion";

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readStoredPreference() {
  if (!canUseDom()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return null;
}

function applyDatasetFlag(enabled) {
  if (!canUseDom()) return;
  if (enabled) {
    document.documentElement.dataset.reduceMotion = "true";
  } else {
    delete document.documentElement.dataset.reduceMotion;
  }
}

export function applyRuntimeMotionPreference() {
  applyDatasetFlag(readStoredPreference() === true);
}

export function setRuntimeReduceMotion(enabled) {
  if (!canUseDom()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore storage failures
  }
  applyDatasetFlag(Boolean(enabled));
}

export function clearRuntimeReduceMotion() {
  if (!canUseDom()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
  applyDatasetFlag(false);
}


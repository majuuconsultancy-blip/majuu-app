const SESSION_RESTORE_HINT_KEY = "majuu:auth_restore_hint:v1";

export function readSessionRestoreHint() {
  try {
    return window.localStorage.getItem(SESSION_RESTORE_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSessionRestoreHint(hasSession) {
  try {
    window.localStorage.setItem(SESSION_RESTORE_HINT_KEY, hasSession ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

const INTRO_SEEN_KEY = "majuu:intro_seen:v1";

export function hasSeenIntro() {
  try {
    return window.localStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setIntroSeen() {
  try {
    window.localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    // no-op
  }
}


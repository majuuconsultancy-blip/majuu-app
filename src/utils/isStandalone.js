export function isStandalone() {
  // iOS Safari standalone
  const iosStandalone = window.navigator?.standalone === true;

  // Modern browsers / PWA display-mode
  const mql = window.matchMedia?.("(display-mode: standalone)");
  const displayModeStandalone = mql ? mql.matches : false;

  return iosStandalone || displayModeStandalone;
}
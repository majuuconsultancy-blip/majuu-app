export const isStandalone =
  window.matchMedia?.("(display-mode: standalone)")?.matches ||
  window.navigator.standalone === true;

// When true → Framer Motion should NOT animate
export const motionSafe = !isStandalone;
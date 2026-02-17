// ✅ motionProxy.js (NUCLEAR-STABLE: NO JSX, SAFE IN BUILD)
// - Works even if this file remains .js (no JSX parsing needed)
// - Disables framer-motion when running as installed PWA (standalone)
// - Strips motion-only props so React doesn't warn

import React from "react";
import * as FM from "framer-motion";

// Detect installed PWA (standalone) — safe guard
const isStandalone = (() => {
  try {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator?.standalone === true
    );
  } catch {
    return false;
  }
})();

// If installed → disable motion (cheap DOM components)
const disableMotion = isStandalone;

// Create a fake motion.* that renders plain tags
function createNoMotion() {
  return new Proxy(
    {},
    {
      get: (_target, tag) => {
        return function NoMotionComponent(props) {
          const { children, ...rest0 } = props || {};

          // strip framer-motion props so React doesn't warn
          // eslint-disable-next-line no-unused-vars
          const {
            initial,
            animate,
            exit,
            transition,
            variants,
            layout,
            layoutId,
            whileTap,
            whileHover,
            whileInView,
            viewport,
            onAnimationStart,
            onAnimationComplete,
            ...rest
          } = rest0;

          return React.createElement(tag, rest, children);
        };
      },
    }
  );
}

export const motion = disableMotion ? createNoMotion() : FM.motion;

// AnimatePresence: in standalone just render children
export function AnimatePresence({ children }) {
  if (disableMotion) return React.createElement(React.Fragment, null, children);
  return React.createElement(FM.AnimatePresence, null, children);
}

// Optional re-export if you need it elsewhere
export const MotionConfig = FM.MotionConfig;
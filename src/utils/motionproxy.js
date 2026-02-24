// ✅ motionProxy.js (NO JSX, BUILD SAFE)
// - Disables framer-motion on standalone PWA and reduced-motion mode
// - Strips motion-only props so React doesn't warn when motion is disabled

import React from "react";
import * as FM from "framer-motion";

function isStandalonePwa() {
  try {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator?.standalone === true
    );
  } catch {
    return false;
  }
}

function prefersReducedMotion() {
  try {
    if (typeof window === "undefined") return false;
    if (document?.documentElement?.dataset?.reduceMotion === "true") return true;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

function shouldDisableMotion() {
  return isStandalonePwa() || prefersReducedMotion();
}

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

const noMotion = createNoMotion();
export const motion = new Proxy(
  {},
  {
    get(_target, tag) {
      return shouldDisableMotion() ? noMotion[tag] : FM.motion[tag];
    },
  }
);

// AnimatePresence: preserve props when motion is enabled
export function AnimatePresence(props) {
  const { children, ...rest } = props || {};
  if (shouldDisableMotion()) return React.createElement(React.Fragment, null, children);
  return React.createElement(FM.AnimatePresence, rest, children);
}

// Optional re-export if you need it elsewhere
export const MotionConfig = FM.MotionConfig;

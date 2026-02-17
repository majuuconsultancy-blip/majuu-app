import { motion, AnimatePresence } from "../utils/motionProxy";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

export default function PageTransitions({ children }) {
  // ✅ In installed app → NO animation at all
  if (isStandalone()) {
    return <div style={{ height: "100%" }}>{children}</div>;
  }

  // ✅ In browser → keep your animation
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      style={{ height: "100%" }}
    >
      {children}
    </motion.div>
  );
}
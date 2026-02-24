import { motion } from "../utils/motionProxy";

const pageTransition = {
  duration: 0.16,
  ease: [0.2, 0.8, 0.2, 1],
};

export default function PageTransitions({ children }) {
  return (
    <motion.div
      className="route-transition-shell"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 2 }}
      transition={pageTransition}
      style={{ height: "100%" }}
    >
      {children}
    </motion.div>
  );
}


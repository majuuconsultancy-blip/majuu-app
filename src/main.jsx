import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import "./styles/pwa.css";
import "./styles/motion.css";
import { initTheme } from "./utils/theme";
import { applyRuntimeMotionPreference } from "./utils/motionPreferences";

// Detect installed PWA
const isStandalone =
  window.matchMedia?.("(display-mode: standalone)")?.matches ||
  window.navigator.standalone === true;

// Apply compact sizing only in installed app
if (isStandalone) {
  document.documentElement.classList.add("pwa-compact");
}

// Optional runtime user flag (localStorage) for reduced motion.
applyRuntimeMotionPreference();

// Initialize theme
initTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

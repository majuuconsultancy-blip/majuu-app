import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.jsx";
import "./index.css";
import "./styles/pwa.css";
import "./styles/motion.css";
import "./styles/typography.css";
import { initTheme } from "./utils/theme";
import { applyRuntimeMotionPreference } from "./utils/motionPreferences";

// Capacitor WebView + SW caching can make UI updates appear stale on Android.
// Keep service workers enabled for web PWA, but disable/clean them in native app runs.
const isNativeCapacitor = Capacitor.isNativePlatform();

function disableServiceWorkersInNative() {
  if (!isNativeCapacitor) return;
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const sw = navigator.serviceWorker;
    const originalRegister = sw.register?.bind(sw);
    if (originalRegister) {
      sw.register = (...args) => {
        const [scriptURL] = args;
        console.info("[native] Skipping service worker registration:", scriptURL);
        return Promise.resolve({
          active: null,
          installing: null,
          waiting: null,
          scope: "/",
          unregister: async () => true,
          update: async () => undefined,
        });
      };
    }
  } catch {
    // Ignore if ServiceWorkerContainer methods are not writable in this WebView.
  }

  const clearServiceWorkerState = async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    } catch {
      // ignore
    }

    if (!("caches" in window)) return;

    try {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((key) => caches.delete(key)));
    } catch {
      // ignore
    }
  };

  void clearServiceWorkerState();
  window.addEventListener(
    "load",
    () => {
      void clearServiceWorkerState();
    },
    { once: true }
  );
}

disableServiceWorkersInNative();

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

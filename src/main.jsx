import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
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
const SafeAreaInsets = registerPlugin("SafeAreaInsets");

if (isNativeCapacitor && typeof document !== "undefined") {
  document.documentElement.classList.add("native-capacitor");
}

function applySafeAreaCssVars(insets) {
  if (typeof document === "undefined") return;
  const top = Math.max(0, Math.round(Number(insets?.top) || 0));
  const right = Math.max(0, Math.round(Number(insets?.right) || 0));
  const bottom = Math.max(0, Math.round(Number(insets?.bottom) || 0));
  const left = Math.max(0, Math.round(Number(insets?.left) || 0));
  document.documentElement.style.setProperty("--safe-area-inset-top", `${top}px`);
  document.documentElement.style.setProperty("--safe-area-inset-right", `${right}px`);
  document.documentElement.style.setProperty("--safe-area-inset-bottom", `${bottom}px`);
  document.documentElement.style.setProperty("--safe-area-inset-left", `${left}px`);
}

function createEnvProbeSync() {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "fixed";
  probe.style.left = "0";
  probe.style.right = "0";
  probe.style.bottom = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top, 0px)";
  probe.style.paddingRight = "env(safe-area-inset-right, 0px)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
  probe.style.paddingLeft = "env(safe-area-inset-left, 0px)";
  document.documentElement.appendChild(probe);

  const applyInsets = () => {
    const styles = window.getComputedStyle(probe);
    applySafeAreaCssVars({
      top: parseFloat(styles.paddingTop) || 0,
      right: parseFloat(styles.paddingRight) || 0,
      bottom: parseFloat(styles.paddingBottom) || 0,
      left: parseFloat(styles.paddingLeft) || 0,
    });
  };

  const updateSoon = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(applyInsets);
    });
  };

  applyInsets();
  window.addEventListener("resize", updateSoon, { passive: true });
  window.addEventListener("orientationchange", updateSoon, { passive: true });
  window.visualViewport?.addEventListener("resize", updateSoon, { passive: true });
  const onVisibility = () => {
    if (!document.hidden) updateSoon();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    refresh: updateSoon,
    dispose: () => {
      window.removeEventListener("resize", updateSoon);
      window.removeEventListener("orientationchange", updateSoon);
      window.visualViewport?.removeEventListener("resize", updateSoon);
      document.removeEventListener("visibilitychange", onVisibility);
      probe.remove();
    },
  };
}

function syncNativeSafeAreaVars() {
  if (!isNativeCapacitor) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const fallback = createEnvProbeSync();
  const refreshFromPlugin = () => {
    void SafeAreaInsets.refreshInsets().then(applySafeAreaCssVars).catch(() => {});
  };

  const fetchInsetsFromPlugin = async () => {
    try {
      const payload = await SafeAreaInsets.getInsets();
      applySafeAreaCssVars(payload);
      return true;
    } catch {
      return false;
    }
  };

  void (async () => {
    const gotInitialInsets = await fetchInsetsFromPlugin();
    if (!gotInitialInsets) return;

    try {
      const listenerHandle = await SafeAreaInsets.addListener("insetsChange", (payload) => {
        applySafeAreaCssVars(payload);
      });

      fallback.dispose();
      void listenerHandle;

      window.addEventListener("resize", refreshFromPlugin, { passive: true });
      window.addEventListener("orientationchange", refreshFromPlugin, { passive: true });
      window.visualViewport?.addEventListener("resize", refreshFromPlugin, { passive: true });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refreshFromPlugin();
      });
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) refreshFromPlugin();
      }).catch(() => {});
      refreshFromPlugin();
      setTimeout(refreshFromPlugin, 120);
      setTimeout(refreshFromPlugin, 420);
      window.setInterval(refreshFromPlugin, 1800);
    } catch {
      fallback.refresh();
    }
  })();
}

syncNativeSafeAreaVars();

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

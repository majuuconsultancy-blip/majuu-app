import { Capacitor } from "@capacitor/core";
import { signInWithPopup, signInWithRedirect } from "firebase/auth";

const DEFAULT_POPUP_TIMEOUT_MS = 18000;

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  try {
    const standaloneMatch = window.matchMedia?.("(display-mode: standalone)")?.matches === true;
    const fullscreenMatch = window.matchMedia?.("(display-mode: fullscreen)")?.matches === true;
    const iosStandalone = window.navigator?.standalone === true;
    return standaloneMatch || fullscreenMatch || iosStandalone;
  } catch (error) {
    void error;
    return false;
  }
}

function isLikelyEmbeddedWebView() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "").toLowerCase();
  return (
    ua.includes("; wv)") ||
    /\bwv\b/.test(ua) ||
    ua.includes("fbav") ||
    ua.includes("instagram") ||
    ua.includes("line/")
  );
}

function withTimeout(promise, timeoutMs, timeoutErrorFactory) {
  let timerId = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(timeoutErrorFactory()), timeoutMs);
    }),
  ]).finally(() => {
    if (timerId) window.clearTimeout(timerId);
  });
}

function popupTimeoutError(timeoutMs) {
  const error = new Error(`Google popup did not complete within ${timeoutMs}ms.`);
  error.code = "auth/popup-timeout";
  return error;
}

export function shouldPreferGoogleRedirect() {
  if (Capacitor.isNativePlatform()) return true;
  if (isStandaloneDisplayMode()) return true;
  if (isLikelyEmbeddedWebView()) return true;
  return false;
}

export function shouldFallbackPopupToRedirect(error) {
  const code = String(error?.code || "").toLowerCase();
  return (
    code.includes("auth/popup-blocked") ||
    code.includes("auth/operation-not-supported-in-this-environment") ||
    code.includes("auth/popup-timeout")
  );
}

export async function signInWithGoogleSmart({
  auth,
  provider,
  popupTimeoutMs = DEFAULT_POPUP_TIMEOUT_MS,
}) {
  if (shouldPreferGoogleRedirect()) {
    await signInWithRedirect(auth, provider);
    return { mode: "redirect", user: null };
  }

  try {
    const result = await withTimeout(
      signInWithPopup(auth, provider),
      Math.max(4000, Number(popupTimeoutMs) || DEFAULT_POPUP_TIMEOUT_MS),
      () => popupTimeoutError(popupTimeoutMs)
    );
    return { mode: "popup", user: result?.user || null };
  } catch (error) {
    if (!shouldFallbackPopupToRedirect(error)) throw error;
    await signInWithRedirect(auth, provider);
    return { mode: "redirect", user: null };
  }
}

import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { useEffect, useRef, useState } from "react";

const MIN_INSET_PX = 20;
const HIDE_LOCK_MS = 220;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function useKeyboardInset(enabled) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const baseViewportRef = useRef(typeof window !== "undefined" ? window.innerHeight : 0);

  useEffect(() => {
    if (enabled) return undefined;

    const captureBaseViewport = () => {
      const vv = window.visualViewport;
      const docHeight = document.documentElement?.clientHeight || 0;
      const candidate = Math.max(num(window.innerHeight), num(vv?.height) + num(vv?.offsetTop), num(docHeight));
      if (candidate > 0) {
        baseViewportRef.current = Math.max(baseViewportRef.current || 0, candidate);
      }
    };

    captureBaseViewport();
    window.addEventListener("resize", captureBaseViewport);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", captureBaseViewport);
    vv?.addEventListener("scroll", captureBaseViewport);
    return () => {
      window.removeEventListener("resize", captureBaseViewport);
      vv?.removeEventListener("resize", captureBaseViewport);
      vv?.removeEventListener("scroll", captureBaseViewport);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      document.body.classList.remove("app-keyboard-open");
      return undefined;
    }

    let disposed = false;
    let pluginVisible = false;
    let hideLockUntil = 0;
    const removeFns = [];

    const fallbackInset = Math.round(Math.min(360, Math.max(220, (window.innerHeight || 760) * 0.34)));

    const applyInset = (value) => {
      if (disposed) return;
      const next = Math.max(0, Math.round(num(value)));
      setKeyboardInset(next);
      document.body.classList.toggle("app-keyboard-open", next > 0);
    };

    const onPluginShow = (info) => {
      pluginVisible = true;
      const pluginHeight = num(info?.keyboardHeight);
      applyInset(pluginHeight > MIN_INSET_PX ? pluginHeight : fallbackInset);
    };

    const onPluginHide = () => {
      pluginVisible = false;
      hideLockUntil = Date.now() + HIDE_LOCK_MS;
      applyInset(0);
    };

    const attachKeyboardPlugin = async () => {
      if (!Capacitor.isNativePlatform()) return;
      try {
        const handles = await Promise.all([
          Keyboard.addListener("keyboardWillShow", onPluginShow),
          Keyboard.addListener("keyboardDidShow", onPluginShow),
          Keyboard.addListener("keyboardWillHide", onPluginHide),
          Keyboard.addListener("keyboardDidHide", onPluginHide),
        ]);
        handles.forEach((h) => removeFns.push(() => h.remove()));
      } catch {
        // Keep viewport fallback only.
      }
    };

    const syncFromViewport = () => {
      const vv = window.visualViewport;
      const baseHeight = num(baseViewportRef.current) || num(window.innerHeight);
      const vvHeight = num(vv?.height) || num(window.innerHeight);
      const vvTop = num(vv?.offsetTop);
      const docHeight = num(document.documentElement?.clientHeight);

      const rawInset = Math.max(0, baseHeight - vvHeight - vvTop, docHeight - vvHeight - vvTop, baseHeight - (num(window.innerHeight) || vvHeight));
      const nextInset = rawInset > MIN_INSET_PX ? rawInset : 0;

      if (Date.now() < hideLockUntil && nextInset > 0) return;
      if (nextInset > 0) {
        applyInset(nextInset);
        return;
      }
      if (!pluginVisible) applyInset(0);
    };

    void attachKeyboardPlugin();
    syncFromViewport();

    window.addEventListener("resize", syncFromViewport);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncFromViewport);
    vv?.addEventListener("scroll", syncFromViewport);

    const fallbackTimer = window.setTimeout(() => {
      setKeyboardInset((prev) => {
        if (disposed || prev > 0) return prev;
        const active = document.activeElement;
        const isTextField = active instanceof HTMLElement && (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
        if (!isTextField) return prev;
        document.body.classList.add("app-keyboard-open");
        return fallbackInset;
      });
    }, 220);

    return () => {
      disposed = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("scroll", syncFromViewport);
      removeFns.forEach((fn) => {
        try {
          fn();
        } catch {
          // ignore
        }
      });
      document.body.classList.remove("app-keyboard-open");
    };
  }, [enabled]);

  useEffect(() => () => document.body.classList.remove("app-keyboard-open"), []);

  return enabled ? keyboardInset : 0;
}


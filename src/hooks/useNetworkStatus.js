import { useEffect, useState, useCallback } from "react";
import { Network } from "@capacitor/network";

/**
 * Robust network status hook.
 * Uses Capacitor Network + browser fallback + lightweight probes.
 */
export function useNetworkStatus() {
  const [online, setOnline] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  const probe = useCallback(async (url, options = {}) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        ...options,
      });
      clearTimeout(timeoutId);

      // `no-cors` responses are opaque with status 0; resolved fetch still means network path exists.
      return response.ok || response.type === "opaque";
    } catch {
      return false;
    }
  }, []);

  const checkConnectivity = useCallback(async () => {
    const browserOnline = typeof navigator === "undefined" ? true : navigator.onLine;

    let nativeConnected = browserOnline;
    try {
      const status = await Network.getStatus();
      if (typeof status?.connected === "boolean") {
        nativeConnected = status.connected;
      }
    } catch {
      // Capacitor plugin may be unavailable in some web contexts; browser fallback handles this.
    }

    if (!browserOnline && !nativeConnected) {
      return false;
    }

    // 1) Same-origin probe (works for normal app hosting)
    const localOk = await probe(`/vite.svg?t=${Date.now()}`, { method: "GET" });
    if (localOk) return true;

    // 2) External tiny endpoint (helps detect captive or stale local caches)
    const externalOk = await probe(`https://www.gstatic.com/generate_204?t=${Date.now()}`, {
      method: "GET",
      mode: "no-cors",
    });
    if (externalOk) return true;

    // Be permissive if platform/network APIs indicate connectivity.
    return browserOnline || nativeConnected;
  }, [probe]);

  const syncOnlineFromStatus = useCallback(
    async (status) => {
      const platformConnected =
        typeof status?.connected === "boolean"
          ? status.connected
          : typeof navigator === "undefined"
          ? true
          : navigator.onLine;

      if (!platformConnected) {
        setOnline(false);
        return;
      }

      const actuallyOnline = await checkConnectivity();
      setOnline(actuallyOnline);
    },
    [checkConnectivity]
  );

  useEffect(() => {
    let disposed = false;
    let listenerHandle = null;

    const syncInitial = async () => {
      try {
        const status = await Network.getStatus();
        if (!disposed) {
          await syncOnlineFromStatus(status);
        }
      } catch {
        if (disposed) return;
        const fallbackOnline = typeof navigator === "undefined" ? true : navigator.onLine;
        if (!fallbackOnline) {
          setOnline(false);
          return;
        }
        const actuallyOnline = await checkConnectivity();
        if (!disposed) setOnline(actuallyOnline);
      }
    };

    void syncInitial();

    const attachListener = async () => {
      try {
        listenerHandle = await Network.addListener("networkStatusChange", (status) => {
          void syncOnlineFromStatus(status);
        });
      } catch {
        listenerHandle = null;
      }
    };

    void attachListener();

    // Browser fallback listeners
    const onUp = async () => {
      const actuallyOnline = await checkConnectivity();
      if (!disposed) setOnline(actuallyOnline);
    };
    const onDown = () => setOnline(false);

    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);

    return () => {
      disposed = true;
      if (listenerHandle?.remove) listenerHandle.remove();
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, [checkConnectivity, syncOnlineFromStatus]);

  return { online, checkConnectivity };
}

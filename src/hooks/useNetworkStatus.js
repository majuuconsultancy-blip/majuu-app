import { useEffect, useState, useCallback } from "react";
import { Network } from "@capacitor/network";

/**
 * Robust network status hook.
 * Uses Capacitor Network (native) + Browser Fallback + Ping Check.
 */
export function useNetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  const checkConnectivity = useCallback(async () => {
    try {
      const status = await Network.getStatus();
      if (!status.connected) return false;

      // If OS says connected, verify with a tiny ping to ensure no "zombie" connection (DNS/Captive portal issues)
      // We use a cache-busting fetch to the favicon or a tiny resource
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      
      const response = await fetch("/favicon.ico", { 
        method: "HEAD", 
        cache: "no-store",
        signal: controller.signal 
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (e) {
      return false;
    }
  }, []);

  useEffect(() => {
    // 1. Initial State Sync
    Network.getStatus().then(async (status) => {
      if (status.connected) {
        // Double check if we actually have internet
        const actuallyOnline = await checkConnectivity();
        setOnline(actuallyOnline);
      } else {
        setOnline(false);
      }
    });

    // 2. Native Listener
    const listener = Network.addListener("networkStatusChange", async (status) => {
      if (status.connected) {
        // Transitioning UP -> Verify it's real
        const actuallyOnline = await checkConnectivity();
        setOnline(actuallyOnline);
      } else {
        setOnline(false);
      }
    });

    // 3. Browser Fallback (safeguard)
    const onUp = async () => {
      const actuallyOnline = await checkConnectivity();
      setOnline(actuallyOnline);
    };
    const onDown = () => setOnline(false);

    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);

    return () => {
      listener.remove();
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, [checkConnectivity]);

  return { online, checkConnectivity };
}
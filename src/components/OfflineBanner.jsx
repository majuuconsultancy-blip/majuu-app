import { useEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";

const ONLINE_TOAST_MS = 1800;

export default function OfflineBanner({ online }) {
  const [showOnlineToast, setShowOnlineToast] = useState(false);
  const prevOnlineRef = useRef(online);

  useEffect(() => {
    if (prevOnlineRef.current === online) return;

    if (prevOnlineRef.current === false && online === true) {
      setShowOnlineToast(true);
      const timer = setTimeout(() => setShowOnlineToast(false), ONLINE_TOAST_MS);
      prevOnlineRef.current = online;
      return () => clearTimeout(timer);
    }

    if (!online) setShowOnlineToast(false);
    prevOnlineRef.current = online;
  }, [online]);

  if (online && !showOnlineToast) return null;

  const isOffline = !online;
  const shellClass = isOffline
    ? "border-zinc-800/70 bg-zinc-900/85 text-white"
    : "border-emerald-300/40 bg-emerald-600/90 text-white";

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: "var(--app-floating-offset)" }}
    >
      <div
        className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl ${shellClass}`}
        role="status"
        aria-live="polite"
      >
        {isOffline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
        <span>{isOffline ? "No internet connection" : "Back online"}</span>
      </div>
    </div>
  );
}

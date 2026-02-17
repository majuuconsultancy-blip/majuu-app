import { WifiOff } from "lucide-react";

export default function OfflineBanner({ online }) {
  if (online) return null;

  return (
    <div className="sticky top-0 z-50 bg-amber-500/15 backdrop-blur border-b border-amber-500/30 px-3 py-2">
      <div className="flex items-center gap-2 text-amber-200 text-sm">
        <WifiOff className="h-4 w-4" />
        <span>You’re offline. Browsing is available, but actions are disabled.</span>
      </div>
    </div>
  );
}
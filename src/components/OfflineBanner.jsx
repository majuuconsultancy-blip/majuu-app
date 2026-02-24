import { WifiOff } from "lucide-react";
import AppIcon from "./AppIcon";
import { ICON_SM, ICON_MD, ICON_LG } from "../constants/iconSizes";

export default function OfflineBanner({ online }) {
  if (online) return null;

  return (
    <div className="sticky top-0 z-50 bg-amber-500/15 backdrop-blur border-b border-amber-500/30 px-3 py-2">
      <div className="flex items-center gap-2 text-amber-200 text-sm">
        <AppIcon size={ICON_SM} icon={WifiOff} />
        <span>You’re offline. Browsing is available, but actions are disabled.</span>
      </div>
    </div>
  );
}

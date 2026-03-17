import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MapPinned, Pencil } from "lucide-react";
import AppIcon from "./AppIcon";
import { ICON_SM } from "../constants/iconSizes";
import { journeyMatchesRoute } from "../journey/journeyMatchers";
import { journeyDisplayCountry, normalizeJourneyTrack } from "../journey/journeyModel";

function titleCaseTrack(track) {
  const t = normalizeJourneyTrack(track);
  if (!t) return "";
  return `${t.slice(0, 1).toUpperCase()}${t.slice(1)}`;
}

export default function JourneyBanner({ journey, track, country }) {
  const navigate = useNavigate();

  const shouldShow = useMemo(
    () => journeyMatchesRoute(journey, { track, country }),
    [country, journey, track]
  );

  const details = useMemo(() => {
    if (!shouldShow) return null;
    const trackLabel = titleCaseTrack(track);
    const countryLabel = journeyDisplayCountry(journey) || String(country || "").trim();
    const stage = String(journey?.stage || "").trim();
    return { trackLabel, countryLabel, stage };
  }, [country, journey, shouldShow, track]);

  if (!details) return null;

  return (
    <div className="mt-4 rounded-3xl border border-emerald-200/70 bg-emerald-50/55 p-4 shadow-sm backdrop-blur dark:border-emerald-900/40 dark:bg-emerald-950/18">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-zinc-950/25 dark:text-emerald-100">
            <AppIcon size={ICON_SM} icon={MapPinned} />
            Journey
          </div>

          <div className="mt-2 text-sm font-semibold text-emerald-950 dark:text-emerald-100">
            {details.stage ? `Current step: ${details.stage}` : "Continue your journey"}
          </div>
          <div className="mt-1 text-xs text-emerald-900/80 dark:text-emerald-100/80">
            {details.trackLabel ? `${details.trackLabel} \u2192 ` : ""}
            {details.countryLabel}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate("/app/profile/journey")}
          className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-white/60 px-3 py-2 text-xs font-semibold text-emerald-900 shadow-sm transition hover:bg-white active:scale-[0.99] dark:border-emerald-900/40 dark:bg-zinc-950/25 dark:text-emerald-100 dark:hover:bg-zinc-950/35"
          title="Edit journey"
        >
          <AppIcon size={ICON_SM} icon={Pencil} />
          Edit
        </button>
      </div>
    </div>
  );
}


import { normalizeJourney, normalizeUserOnboarding } from "./journeyModel";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

export function resolveLandingPathFromUserState(userState) {
  const state = userState && typeof userState === "object" ? userState : {};
  const onboarding = normalizeUserOnboarding(state?.onboarding);
  if (onboarding.profileJourneySetupCompleted === false) return "/setup";

  const journey = normalizeJourney(state?.journey);
  if (journey.track) return `/app/${journey.track}`;

  return "/dashboard";
}

export function resolveLandingPathFromJourneyTrack(journeyTrack) {
  const track = safeString(journeyTrack, 20).toLowerCase();
  if (track === "study" || track === "work" || track === "travel") return `/app/${track}`;
  return "/dashboard";
}


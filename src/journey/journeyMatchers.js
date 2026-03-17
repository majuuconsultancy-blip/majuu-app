import {
  JOURNEY_COUNTRY_TYPES,
  journeyDisplayCountry,
  normalizeJourneyCountry,
  normalizeJourneyTrack,
} from "./journeyModel";

export function journeyMatchesTrack(journey, track) {
  const t = normalizeJourneyTrack(track);
  return Boolean(journey?.track && t && journey.track === t);
}

export function journeyMatchesRoute(journey, { track, country } = {}) {
  if (!journeyMatchesTrack(journey, track)) return false;

  const routeCountry = normalizeJourneyCountry(country);
  const savedCountry = normalizeJourneyCountry(journeyDisplayCountry(journey));
  if (!routeCountry || !savedCountry) return false;
  return routeCountry === savedCountry;
}

export function journeyShouldHighlightCountry(journey, { track, country } = {}) {
  if (!journeyMatchesTrack(journey, track)) return false;
  if (journey?.countryType !== JOURNEY_COUNTRY_TYPES.managed) return false;
  const option = normalizeJourneyCountry(country);
  const saved = normalizeJourneyCountry(journey?.country);
  return Boolean(option && saved && option === saved);
}


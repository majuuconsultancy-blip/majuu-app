import {
  getJourneyProgressSummary,
  getJourneyStepsForRoute,
  getNextJourneyStep,
} from "./selfHelpJourney";

export function getVerifiedPathForRoute(track, country, options = {}) {
  return getJourneyStepsForRoute(track, country, options?.resources || null);
}

export function getVerifiedProgressSummary(steps, completedStepIds) {
  return getJourneyProgressSummary(steps, completedStepIds);
}

export function getNextVerifiedStep(steps, completedStepIds, preferredStepId = "") {
  return getNextJourneyStep(steps, completedStepIds, preferredStepId);
}

import {
  getJourneyProgressSummary,
  getJourneyStepsForRoute,
  getNextJourneyStep,
} from "./selfHelpJourney";

export function getVerifiedPathForRoute(track, country) {
  return getJourneyStepsForRoute(track, country);
}

export function getVerifiedProgressSummary(steps, completedStepIds) {
  return getJourneyProgressSummary(steps, completedStepIds);
}

export function getNextVerifiedStep(steps, completedStepIds, preferredStepId = "") {
  return getNextJourneyStep(steps, completedStepIds, preferredStepId);
}

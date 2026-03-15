import {
  getSelfHelpResourcesForCategory,
  getSelfHelpResourcesForCategoryFromList,
} from "./selfHelpCatalog";

function safeString(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

const DOCUMENT_CATEGORIES = [
  { id: "passport", label: "Passport" },
  { id: "school-documents", label: "School Documents" },
  { id: "visa", label: "Visa" },
  { id: "flights", label: "Flights" },
  { id: "accommodation", label: "Accommodation" },
  { id: "insurance", label: "Insurance" },
  { id: "other", label: "Other" },
];

const JOURNEY_TEMPLATES = {
  study: [
    { id: "passport-ready", title: "Passport ready", categoryId: "documents", resourceCount: 1, documentCategoryId: "passport" },
    { id: "schools-chosen", title: "Chosen schools / universities", categoryId: "schools", resourceCount: 2 },
    { id: "applications-submitted", title: "Applied to schools", categoryId: "schools", resourceCount: 2 },
    { id: "admission-received", title: "Admission received", categoryId: "schools", resourceCount: 1, documentCategoryId: "school-documents" },
    { id: "financial-proof-prepared", title: "Financial proof prepared", categoryId: "finance", resourceCount: 2 },
    {
      id: "visa-submitted",
      title: "Visa submitted",
      categoryId: "visa",
      resourceCount: 2,
      documentCategoryId: "visa",
      weHelpCta: { label: "Need guided help?", note: "Visa submissions are easy to delay with small mistakes." },
    },
    { id: "visa-approved", title: "Visa approved", categoryId: "visa", resourceCount: 1, documentCategoryId: "visa" },
    { id: "accommodation-arranged", title: "Accommodation arranged", categoryId: "accommodation", resourceCount: 2, documentCategoryId: "accommodation" },
    { id: "flight-booked", title: "Flight booked", categoryId: "flights", resourceCount: 2, documentCategoryId: "flights" },
    { id: "ready-to-travel", title: "Ready to travel", categoryId: "settlement", resourceCount: 2 },
  ],
  work: [
    { id: "passport-ready", title: "Passport ready", categoryId: "resume", resourceCount: 1, documentCategoryId: "passport" },
    { id: "cv-ready", title: "CV / resume ready", categoryId: "resume", resourceCount: 2 },
    { id: "applications-sent", title: "Applications sent", categoryId: "jobs", resourceCount: 2 },
    { id: "offer-secured", title: "Offer secured", categoryId: "jobs", resourceCount: 1, documentCategoryId: "other" },
    {
      id: "permit-submitted",
      title: "Work permit / visa submitted",
      categoryId: "visa",
      resourceCount: 2,
      documentCategoryId: "visa",
      weHelpCta: { label: "Need guided help?", note: "Permit routes are worth extra care before submission." },
    },
    { id: "permit-approved", title: "Work permit / visa approved", categoryId: "visa", resourceCount: 1, documentCategoryId: "visa" },
    { id: "funds-ready", title: "Settlement funds ready", categoryId: "banking", resourceCount: 2 },
    { id: "accommodation-arranged", title: "Accommodation arranged", categoryId: "accommodation", resourceCount: 2, documentCategoryId: "accommodation" },
    { id: "flight-booked", title: "Flight booked", categoryId: "flights", resourceCount: 2, documentCategoryId: "flights" },
    { id: "ready-to-relocate", title: "Ready to relocate", categoryId: "settlement", resourceCount: 2 },
  ],
  travel: [
    { id: "passport-ready", title: "Passport ready", categoryId: "visa", resourceCount: 1, documentCategoryId: "passport" },
    { id: "entry-rules-checked", title: "Entry rules checked", categoryId: "visa", resourceCount: 2 },
    {
      id: "visa-submitted",
      title: "Visa submitted",
      categoryId: "visa",
      resourceCount: 2,
      documentCategoryId: "visa",
      weHelpCta: { label: "Need guided help?", note: "Entry steps are sensitive when timing is tight." },
    },
    { id: "visa-approved", title: "Visa approved", categoryId: "visa", resourceCount: 1, documentCategoryId: "visa" },
    { id: "insurance-arranged", title: "Insurance arranged", categoryId: "insurance", resourceCount: 1, documentCategoryId: "insurance" },
    { id: "accommodation-arranged", title: "Accommodation arranged", categoryId: "accommodation", resourceCount: 2, documentCategoryId: "accommodation" },
    { id: "flight-booked", title: "Flight booked", categoryId: "flights", resourceCount: 2, documentCategoryId: "flights" },
    { id: "spending-money-ready", title: "Spending money ready", categoryId: "currency", resourceCount: 2 },
    { id: "arrival-transport-planned", title: "Arrival transport planned", categoryId: "transport", resourceCount: 2 },
    { id: "ready-to-travel", title: "Ready to travel", categoryId: "transport", resourceCount: 1 },
  ],
};

function buildDescription(step, track, country) {
  const safeCountry = safeString(country, 80) || "your destination";

  if (step.id === "passport-ready") {
    return `Keep your identity details ready before you move deeper into ${safeCountry} planning.`;
  }

  if (step.id === "schools-chosen") {
    return `Shortlist realistic study options in ${safeCountry} before later costs pile up.`;
  }

  if (step.id === "applications-submitted") {
    return "Confirm your applications are actually sent before shifting attention elsewhere.";
  }

  if (step.id === "admission-received") {
    return "Store the offer details so later visa and travel steps stay grounded.";
  }

  if (step.id === "financial-proof-prepared") {
    return "Prepare proof-of-funds and payment planning before sensitive review stages.";
  }

  if (step.id === "entry-rules-checked") {
    return `Use official ${safeCountry} guidance early so you do not book around the wrong requirements.`;
  }

  if (step.id === "spending-money-ready") {
    return "Set your travel spend plan before departure gets close.";
  }

  if (step.id === "arrival-transport-planned") {
    return "Keep your landing plan simple so arrival day is calm and predictable.";
  }

  if (step.id === "ready-to-relocate" || step.id === "ready-to-travel") {
    return track === "work"
      ? "Do one final relocation check before you move."
      : "Do one final travel check before you go.";
  }

  if (step.id.includes("visa") || step.id.includes("permit")) {
    return `Keep official ${safeCountry} immigration guidance close for this step.`;
  }

  if (step.id === "offer-secured") {
    return "Make sure the offer and supporting details are properly recorded.";
  }

  if (step.id === "funds-ready") {
    return "Cover the first weeks abroad before your move becomes real.";
  }

  return `Keep this ${track} milestone moving in the right order for ${safeCountry}.`;
}

export function getJourneyDocumentCategories() {
  return [...DOCUMENT_CATEGORIES];
}

export function getJourneyDocumentCategoryMeta(categoryId) {
  const safeCategoryId = safeString(categoryId, 40).toLowerCase();
  return DOCUMENT_CATEGORIES.find((item) => item.id === safeCategoryId) || null;
}

export function getJourneyStepsForRoute(track, country, resources = null) {
  const safeTrack = safeString(track, 20).toLowerCase();
  const templates = JOURNEY_TEMPLATES[safeTrack] || JOURNEY_TEMPLATES.study;
  const safeCountry = safeString(country, 80);
  const getResourcesForCategory = Array.isArray(resources)
    ? (categoryId) =>
        getSelfHelpResourcesForCategoryFromList(
          safeTrack,
          safeCountry,
          safeString(categoryId, 40),
          resources
        )
    : (categoryId) =>
        getSelfHelpResourcesForCategory(safeTrack, safeCountry, safeString(categoryId, 40));

  return templates.map((step, index) => {
    const categoryResources = getResourcesForCategory(step.categoryId).slice(
      0,
      Math.max(1, Number(step.resourceCount || 1))
    );

    return {
      id: safeString(step.id, 80),
      stepNumber: index + 1,
      title: safeString(step.title, 100),
      description: buildDescription(step, safeTrack, safeCountry),
      categoryId: safeString(step.categoryId, 40),
      resourceIds: categoryResources.map((resource) => resource.id),
      primaryResourceId: categoryResources[0]?.id || "",
      documentCategoryId: safeString(step.documentCategoryId, 40),
      supportsDocument: Boolean(step.documentCategoryId),
      documentCtaLabel: step.documentCategoryId ? "Add document record" : "",
      weHelpCta: step.weHelpCta
        ? {
            label: safeString(step.weHelpCta.label, 40),
            note: safeString(step.weHelpCta.note, 160),
          }
        : null,
    };
  });
}

export function getJourneyProgressSummary(steps, completedStepIds) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const completed = new Set(
    (Array.isArray(completedStepIds) ? completedStepIds : [])
      .map((value) => safeString(value, 80))
      .filter(Boolean)
  );
  const completedCount = safeSteps.filter((step) => completed.has(step.id)).length;
  const totalCount = safeSteps.length;

  return {
    completedCount,
    totalCount,
    percent: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
  };
}

export function getNextJourneyStep(steps, completedStepIds, preferredStepId = "") {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const safePreferred = safeString(preferredStepId, 80);
  const preferred = safeSteps.find((step) => step.id === safePreferred);
  if (preferred) return preferred;

  const completed = new Set(
    (Array.isArray(completedStepIds) ? completedStepIds : [])
      .map((value) => safeString(value, 80))
      .filter(Boolean)
  );

  return safeSteps.find((step) => !completed.has(step.id)) || safeSteps[0] || null;
}

export function getJourneyStepById(track, country, stepId, resources = null) {
  const safeStepId = safeString(stepId, 80);
  if (!safeStepId) return null;
  return getJourneyStepsForRoute(track, country, resources).find(
    (step) => step.id === safeStepId
  ) || null;
}

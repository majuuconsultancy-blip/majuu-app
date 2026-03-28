import { normalizeTrackType } from "../constants/migrationOptions";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function clamp(value, min = 0, max = 1) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return min;
  return Math.max(min, Math.min(max, raw));
}

function average(values, fallback = 0.5) {
  const rows = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(Number(value)));
  if (!rows.length) return fallback;
  return rows.reduce((sum, value) => sum + Number(value), 0) / rows.length;
}

function toTags(value, { maxItems = 14, maxLength = 84 } = {}) {
  const rows = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/,|\n|;|\u2022/g)
        .map((item) => safeString(item, maxLength));
  const seen = new Set();
  const out = [];
  rows.forEach((item) => {
    const safe = safeString(item, maxLength);
    if (!safe) return;
    const key = safe.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(safe);
  });
  return out.slice(0, maxItems);
}

function normalizeScore(value) {
  if (value == null || value === "") return null;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  if (raw <= 10) return clamp(raw / 10, 0, 1);
  return clamp(raw / 100, 0, 1);
}

function parseMoneyEstimate(value) {
  const input = safeString(value, 220).toLowerCase();
  if (!input) return null;
  const match = input.match(/(\d[\d,]*(?:\.\d+)?)(?:\s*([kmb]))?/i);
  if (!match) return null;
  const base = Number(String(match[1] || "").replace(/,/g, ""));
  if (!Number.isFinite(base) || base <= 0) return null;
  const suffix = safeString(match[2], 1).toLowerCase();
  if (suffix === "k") return base * 1000;
  if (suffix === "m") return base * 1000000;
  if (suffix === "b") return base * 1000000000;
  return base;
}

function parseDurationDays(value) {
  const input = safeString(value, 220).toLowerCase();
  if (!input) return null;
  const numbers = [...input.matchAll(/(\d+(?:\.\d+)?)/g)].map((row) => Number(row?.[1]));
  const values = numbers.filter((item) => Number.isFinite(item) && item > 0);
  if (!values.length) return null;
  const pivot = values.length > 1 ? (values[0] + values[1]) / 2 : values[0];

  let unitDays = 1;
  if (input.includes("hour")) unitDays = 1 / 24;
  else if (input.includes("day")) unitDays = 1;
  else if (input.includes("week")) unitDays = 7;
  else if (input.includes("month")) unitDays = 30;
  else if (input.includes("year")) unitDays = 365;
  return pivot * unitDays;
}

function toInverseRangeScore(value, min, max, fallback = 0.58) {
  if (!Number.isFinite(Number(value))) return fallback;
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : Number(value);
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : Number(value);
  if (safeMax <= safeMin) return 0.62;
  const ratio = (Number(value) - safeMin) / (safeMax - safeMin);
  return clamp(1 - ratio, 0, 1);
}

function inferAffordabilityTier(value, costLowScore) {
  const safe = safeString(value, 80).toLowerCase();
  if (safe.includes("tight") || safe.includes("budget") || safe.includes("low")) return 1;
  if (safe.includes("moderate") || safe.includes("balanced") || safe.includes("mid")) return 2;
  if (safe.includes("high") || safe.includes("premium") || safe.includes("luxury")) return 3;
  if (!Number.isFinite(Number(costLowScore))) return null;
  if (costLowScore >= 0.66) return 1;
  if (costLowScore >= 0.4) return 2;
  return 3;
}

const CORE_QUESTIONS = [
  {
    id: "budgetReadiness",
    title: "How financially ready are you?",
    subtitle: "We use this to match against affordability and average setup cost.",
    options: [
      { id: "tight", label: "Tight budget" },
      { id: "moderate", label: "Moderate budget" },
      { id: "high", label: "Ready for higher-cost options" },
    ],
  },
  {
    id: "timelineUrgency",
    title: "When do you want to begin?",
    subtitle: "This maps to process timeline and expected turnaround speed.",
    options: [
      { id: "asap", label: "As soon as possible" },
      { id: "soon", label: "In the next few months" },
      { id: "planning", label: "Planning ahead" },
    ],
  },
  {
    id: "speedPreference",
    title: "What kind of pace do you prefer?",
    subtitle: "Choose between the fastest path or a more flexible long-term route.",
    options: [
      { id: "fastest", label: "Fastest possible path" },
      { id: "balanced", label: "Balanced path" },
      { id: "patient", label: "I can wait for better long-term value" },
    ],
  },
];

const TRACK_QUESTION_MAP = {
  study: {
    id: "trackPreference",
    title: "Which study direction fits you best?",
    subtitle: "We align this with study suitability fields configured in Discovery Publication.",
    options: [
      { id: "tech", label: "Technology / Engineering" },
      { id: "business", label: "Business / Finance" },
      { id: "health", label: "Health / Medical" },
      { id: "arts", label: "Arts / Media / Design" },
      { id: "general", label: "General / Still exploring" },
    ],
  },
  work: {
    id: "trackPreference",
    title: "Which work field reflects your current path?",
    subtitle: "We compare this with work opportunity and employability signals.",
    options: [
      { id: "trades", label: "Skilled Trades" },
      { id: "healthcare", label: "Healthcare" },
      { id: "tech", label: "Tech / IT" },
      { id: "hospitality", label: "Hospitality / Service" },
      { id: "general", label: "General / Open opportunities" },
    ],
  },
  travel: {
    id: "trackPreference",
    title: "What travel style are you leaning toward?",
    subtitle: "This maps to trip-style tags and travel ease/tourism appeal signals.",
    options: [
      { id: "budget", label: "Budget-friendly trip" },
      { id: "scenic", label: "Scenic / leisure trip" },
      { id: "easy", label: "Fast visa / easy planning" },
      { id: "premium", label: "Premium / comfort-focused" },
      { id: "general", label: "General exploration" },
    ],
  },
};

const TRACK_KEYWORD_MAP = {
  study: {
    tech: ["tech", "engineering", "computer", "data", "ai", "it", "stem"],
    business: ["business", "finance", "management", "economics", "mba", "account"],
    health: ["health", "medical", "nursing", "pharmacy", "public health", "biomedical"],
    arts: ["arts", "design", "media", "film", "creative", "fashion", "architecture"],
  },
  work: {
    trades: ["trade", "construction", "electric", "plumbing", "mechanic", "technician"],
    healthcare: ["health", "medical", "nurse", "care", "clinical", "caregiver"],
    tech: ["tech", "it", "software", "developer", "cyber", "data", "cloud"],
    hospitality: ["hospitality", "service", "hotel", "restaurant", "tourism", "retail"],
  },
  travel: {
    budget: ["budget", "affordable", "value", "backpack"],
    scenic: ["scenic", "nature", "leisure", "coast", "mountain", "culture", "relax"],
    easy: ["easy", "fast", "quick", "simple", "visa", "low docs"],
    premium: ["premium", "luxury", "comfort", "high-end", "resort"],
  },
};

function getTrackNumericSignals(compareData, trackType) {
  if (trackType === "study") {
    return [
      normalizeScore(compareData.studentFriendlyScore),
      normalizeScore(compareData.educationValueScore),
    ];
  }
  if (trackType === "work") {
    return [
      normalizeScore(compareData.workOpportunityScore),
      normalizeScore(compareData.employabilityScore),
    ];
  }
  return [
    normalizeScore(compareData.travelEaseScore),
    normalizeScore(compareData.tourismAppealScore),
  ];
}

function getTrackTags(compareData, trackType) {
  const generic = [
    ...toTags(compareData.trackSuitabilityTags),
    ...toTags(compareData.bestForTags),
    ...toTags(compareData.bestFor),
    ...toTags(compareData.featuredStrength),
  ];

  if (trackType === "study") {
    return [...generic, ...toTags(compareData.topStudyFields)].map((item) => item.toLowerCase());
  }
  if (trackType === "work") {
    return [...generic, ...toTags(compareData.topWorkFields)].map((item) => item.toLowerCase());
  }
  return [...generic, ...toTags(compareData.tripStyleTags)].map((item) => item.toLowerCase());
}

function computeBudgetScore(answer, affordabilityTier, costLowScore) {
  const tier = Number(affordabilityTier);
  const hasTier = Number.isFinite(tier);
  const tightCostScore = clamp(costLowScore, 0, 1);
  const midCostScore = clamp(1 - Math.abs(tightCostScore - 0.55) * 1.8, 0.1, 1);
  const highCostScore = clamp(1 - tightCostScore * 0.95, 0.1, 1);

  if (answer === "tight") {
    const tierScore = hasTier ? clamp(1 - Math.abs(tier - 1) / 2, 0, 1) : tightCostScore;
    return clamp(tierScore * 0.65 + tightCostScore * 0.35, 0, 1);
  }
  if (answer === "high") {
    const tierScore = hasTier ? clamp(1 - Math.abs(tier - 3) / 2, 0, 1) : highCostScore;
    return clamp(tierScore * 0.65 + highCostScore * 0.35, 0, 1);
  }
  const tierScore = hasTier ? clamp(1 - Math.abs(tier - 2) / 2, 0, 1) : midCostScore;
  return clamp(tierScore * 0.65 + midCostScore * 0.35, 0, 1);
}

function computeTimelineScore(answer, quickness) {
  const target = answer === "asap" ? 0.88 : answer === "soon" ? 0.64 : 0.38;
  return clamp(1 - Math.abs(quickness - target) * 1.25, 0, 1);
}

function computeSpeedScore(answer, quickness, acceptance) {
  if (answer === "fastest") {
    return clamp(quickness * 0.75 + acceptance * 0.25, 0, 1);
  }
  if (answer === "patient") {
    const patienceFit = clamp(1 - Math.abs(quickness - 0.38) * 1.2, 0, 1);
    return clamp(patienceFit * 0.65 + acceptance * 0.35, 0, 1);
  }
  const balancedFit = clamp(1 - Math.abs(quickness - 0.6) * 1.3, 0, 1);
  return clamp(balancedFit * 0.7 + acceptance * 0.3, 0, 1);
}

function computeTrackScore(trackType, trackPreference, tags, trackSignals) {
  const numericScore = average(trackSignals, 0.6);
  if (trackPreference === "general") return clamp(0.45 + numericScore * 0.55, 0, 1);

  const keywords = TRACK_KEYWORD_MAP[trackType]?.[trackPreference] || [];
  const matches = keywords.filter((keyword) => tags.some((tag) => tag.includes(keyword)));
  const tagScore = matches.length ? clamp(0.55 + matches.length * 0.2, 0.55, 1) : 0.26;
  return clamp(tagScore * 0.72 + numericScore * 0.28, 0, 1);
}

function chooseMatchLabel(index, components = {}) {
  if (index === 0) return "Best overall fit";
  const topDimension = Object.entries(components).sort((left, right) => right[1] - left[1])[0]?.[0] || "";
  if (topDimension === "budget") return "Best budget-value option";
  if (topDimension === "timeline" || topDimension === "speed") return "Fastest route for you";
  if (topDimension === "track") return "Strong fit for your goals";
  return index === 1 ? "Great all-round option" : "Strong alternative route";
}

function createReasons({ trackType, answers, profile, components }) {
  const reasons = [];
  const matchFieldLabel = trackType === "travel" ? "selected trip style" : "preferred field";
  if (components.budget >= 0.66) {
    reasons.push(
      answers.budgetReadiness === "tight"
        ? "Better fit for your budget"
        : answers.budgetReadiness === "high"
        ? "Supports your higher-budget readiness"
        : "Balanced cost profile for your budget"
    );
  }
  if (components.timeline >= 0.66 && safeString(profile.visaResultTime || profile.processCompletionTime, 120)) {
    reasons.push("Better for your selected timeline");
  }
  if (components.speed >= 0.66) {
    reasons.push("Faster visa and process pacing for your preference");
  }
  if (components.track >= 0.66) {
    reasons.push(`Stronger match for your ${matchFieldLabel}`);
  }
  if (Number.isFinite(profile.visaAcceptanceRatePercent) && profile.visaAcceptanceRatePercent >= 70) {
    reasons.push("Higher visa acceptance trend");
  }
  if (answers.budgetReadiness === "tight" && safeString(profile.averageCostEstimate, 120)) {
    reasons.push("Lower average setup cost profile");
  }
  if (safeString(profile.featuredStrength, 140)) {
    reasons.push(safeString(profile.featuredStrength, 90));
  }
  if (!reasons.length) reasons.push("Strong overall alignment with your preferences");
  return [...new Set(reasons)].slice(0, 3);
}

function normalizeAnswerMap(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    budgetReadiness: safeString(source.budgetReadiness, 40) || "moderate",
    timelineUrgency: safeString(source.timelineUrgency, 40) || "soon",
    speedPreference: safeString(source.speedPreference, 40) || "balanced",
    trackPreference: safeString(source.trackPreference, 40) || "general",
  };
}

export function getDiscoveryMatchQuestions(trackType = "study") {
  const safeTrack = normalizeTrackType(trackType || "study");
  return [...CORE_QUESTIONS, TRACK_QUESTION_MAP[safeTrack] || TRACK_QUESTION_MAP.study];
}

export function createEmptyDiscoveryMatchAnswers(trackType = "study") {
  const questions = getDiscoveryMatchQuestions(trackType);
  return questions.reduce((acc, question) => {
    acc[question.id] = "";
    return acc;
  }, {});
}

export function rankDiscoveryCountryMatches({
  trackType = "study",
  answers = {},
  countries = [],
  limit = 3,
} = {}) {
  const safeTrack = normalizeTrackType(trackType || "study");
  const safeAnswers = normalizeAnswerMap(answers);
  const rows = (Array.isArray(countries) ? countries : []).filter(
    (country) => country && country.hasPublication
  );
  if (!rows.length) return [];

  const prepared = rows.map((country) => {
    const compareData = country?.compareData && typeof country.compareData === "object" ? country.compareData : {};
    const visaAcceptanceRatePercent = Number(compareData.visaAcceptanceRatePercent ?? compareData.visaAcceptanceRate);
    const averageCostEstimate = safeString(
      compareData.averageCostEstimate || compareData.typicalApplicationCost,
      160
    );
    const processCompletionTime = safeString(
      compareData.processCompletionTime || compareData.fullProcessDuration,
      160
    );
    const speedScore = normalizeScore(compareData.speedScore ?? compareData.easeScore);
    const costValue = parseMoneyEstimate(averageCostEstimate || compareData.estimatedStarterBudget);
    const visaDays = parseDurationDays(compareData.visaResultTime);
    const processDays = parseDurationDays(processCompletionTime);
    return {
      country,
      compareData,
      visaAcceptanceRatePercent: Number.isFinite(visaAcceptanceRatePercent)
        ? clamp(visaAcceptanceRatePercent, 0, 100)
        : null,
      averageCostEstimate,
      visaResultTime: safeString(compareData.visaResultTime, 160),
      processCompletionTime,
      featuredStrength: safeString(compareData.featuredStrength, 220),
      speedScore,
      costValue,
      visaDays,
      processDays,
    };
  });

  const costValues = prepared.map((row) => row.costValue).filter((value) => Number.isFinite(value));
  const visaDaysValues = prepared.map((row) => row.visaDays).filter((value) => Number.isFinite(value));
  const processDaysValues = prepared
    .map((row) => row.processDays)
    .filter((value) => Number.isFinite(value));
  const minCost = Math.min(...costValues);
  const maxCost = Math.max(...costValues);
  const minVisaDays = Math.min(...visaDaysValues);
  const maxVisaDays = Math.max(...visaDaysValues);
  const minProcessDays = Math.min(...processDaysValues);
  const maxProcessDays = Math.max(...processDaysValues);

  const scored = prepared.map((row) => {
    const costLowScore = toInverseRangeScore(row.costValue, minCost, maxCost, 0.58);
    const visaQuickness = toInverseRangeScore(row.visaDays, minVisaDays, maxVisaDays, 0.56);
    const processQuickness = toInverseRangeScore(row.processDays, minProcessDays, maxProcessDays, 0.56);
    const acceptanceSignal = Number.isFinite(row.visaAcceptanceRatePercent)
      ? clamp(row.visaAcceptanceRatePercent / 100, 0, 1)
      : 0.6;
    const quickness = average([row.speedScore, visaQuickness, processQuickness], 0.58);

    const affordabilityTier = inferAffordabilityTier(
      row.compareData.affordabilityTier,
      costLowScore
    );
    const trackTags = getTrackTags(row.compareData, safeTrack);
    const trackSignals = getTrackNumericSignals(row.compareData, safeTrack);

    const components = {
      budget: computeBudgetScore(safeAnswers.budgetReadiness, affordabilityTier, costLowScore),
      timeline: computeTimelineScore(safeAnswers.timelineUrgency, quickness),
      speed: computeSpeedScore(safeAnswers.speedPreference, quickness, acceptanceSignal),
      track: computeTrackScore(safeTrack, safeAnswers.trackPreference, trackTags, trackSignals),
    };

    const weightedScore =
      components.budget * 0.28 +
      components.timeline * 0.24 +
      components.speed * 0.18 +
      components.track * 0.3;
    const scorePercent = Math.round(clamp(weightedScore, 0, 1) * 100);

    return {
      country: row.country,
      scorePercent: clamp(scorePercent, 35, 98),
      weightedScore,
      components,
      profile: {
        visaAcceptanceRatePercent: row.visaAcceptanceRatePercent,
        visaResultTime: row.visaResultTime,
        processCompletionTime: row.processCompletionTime,
        averageCostEstimate: row.averageCostEstimate,
        featuredStrength: row.featuredStrength,
      },
    };
  });

  scored.sort((left, right) => {
    if (right.scorePercent !== left.scorePercent) return right.scorePercent - left.scorePercent;
    if (right.weightedScore !== left.weightedScore) return right.weightedScore - left.weightedScore;
    return safeString(left.country?.name, 120).localeCompare(safeString(right.country?.name, 120));
  });

  return scored.slice(0, Math.max(1, limit)).map((row, index) => ({
    country: row.country,
    countryName: safeString(row.country?.name, 120),
    countryFlag: safeString(row.country?.flag, 12),
    scorePercent: Number(row.scorePercent),
    matchLabel: chooseMatchLabel(index, row.components),
    reasons: createReasons({
      trackType: safeTrack,
      answers: safeAnswers,
      profile: row.profile,
      components: row.components,
    }),
    components: row.components,
  }));
}

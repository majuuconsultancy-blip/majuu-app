function safeString(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

function safeAmount(value) {
  return String(value || "").replace(/[^\d.]/g, "").slice(0, 24);
}

function padMonth(value) {
  const month = Number(value || 0);
  return `${month}`.padStart(2, "0");
}

function parseMonthInput(value) {
  const text = safeString(value, 10);
  const match = text.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
}

function formatMonthInput(year, month) {
  return `${year}-${padMonth(month)}`;
}

export const MONEY_TOOL_TABS = [
  { id: "currency", label: "Converter" },
  { id: "planner", label: "Budget Plan" },
  { id: "timeline", label: "Timeline" },
];

const PLANNER_TEMPLATES = {
  study: [
    { id: "school-applications", label: "School applications", currencyMode: "destination", defaultAmount: "180" },
    { id: "visa", label: "Visa", currencyMode: "destination", defaultAmount: "650" },
    { id: "insurance", label: "Insurance", currencyMode: "destination", defaultAmount: "320" },
    { id: "flight", label: "Flight", currencyMode: "local", defaultAmount: "850" },
    { id: "accommodation", label: "Accommodation", currencyMode: "destination", defaultAmount: "900" },
    { id: "emergency-buffer", label: "Emergency buffer", currencyMode: "local", defaultAmount: "700" },
  ],
  work: [
    { id: "permit", label: "Visa / work permit", currencyMode: "destination", defaultAmount: "450" },
    { id: "flight", label: "Flights", currencyMode: "local", defaultAmount: "850" },
    { id: "accommodation", label: "Accommodation", currencyMode: "destination", defaultAmount: "900" },
    { id: "settlement", label: "Settlement costs", currencyMode: "local", defaultAmount: "600" },
    { id: "emergency-buffer", label: "Emergency buffer", currencyMode: "local", defaultAmount: "750" },
  ],
  travel: [
    { id: "visa", label: "Visa", currencyMode: "destination", defaultAmount: "120" },
    { id: "flight", label: "Flight", currencyMode: "local", defaultAmount: "700" },
    { id: "accommodation", label: "Accommodation", currencyMode: "destination", defaultAmount: "600" },
    { id: "insurance", label: "Insurance", currencyMode: "local", defaultAmount: "90" },
    { id: "spending-money", label: "Spending money", currencyMode: "destination", defaultAmount: "350" },
    { id: "emergency-buffer", label: "Emergency buffer", currencyMode: "local", defaultAmount: "300" },
  ],
};

const PASSPORT_LEAD_WEEKS = {
  Burundi: 4,
  DRC: 6,
  Ethiopia: 4,
  Kenya: 3,
  Rwanda: 3,
  Somalia: 6,
  "South Sudan": 6,
  Tanzania: 4,
  Uganda: 4,
  default: 4,
};

const TIMELINE_TEMPLATES = {
  study: [
    { id: "passport-ready", title: "Passport ready", leadWeeks: "passport" },
    { id: "schools-chosen", title: "Choose schools", leadWeeks: 3 },
    { id: "applications-submitted", title: "Apply to schools", leadWeeks: 4 },
    { id: "admission-received", title: "Admission received", leadWeeks: 8 },
    { id: "financial-proof-prepared", title: "Prepare financial proof", leadWeeks: 3 },
    { id: "visa-submitted", title: "Submit visa", leadWeeks: 2 },
    { id: "accommodation-arranged", title: "Arrange accommodation", leadWeeks: 5 },
    { id: "flight-booked", title: "Book flight", leadWeeks: 2 },
    { id: "ready-to-travel", title: "Travel / intake month", leadWeeks: 2 },
  ],
  work: [
    { id: "passport-ready", title: "Passport ready", leadWeeks: "passport" },
    { id: "cv-ready", title: "Refresh CV and references", leadWeeks: 2 },
    { id: "applications-sent", title: "Send applications", leadWeeks: 6 },
    { id: "offer-secured", title: "Confirm offer", leadWeeks: 8 },
    { id: "permit-submitted", title: "Submit permit / visa", leadWeeks: 4 },
    { id: "funds-ready", title: "Prepare relocation budget", leadWeeks: 3 },
    { id: "accommodation-arranged", title: "Arrange accommodation", leadWeeks: 4 },
    { id: "flight-booked", title: "Book relocation flight", leadWeeks: 2 },
    { id: "ready-to-relocate", title: "Job start / relocation month", leadWeeks: 2 },
  ],
  travel: [
    { id: "passport-ready", title: "Passport ready", leadWeeks: "passport" },
    { id: "entry-rules-checked", title: "Check entry rules", leadWeeks: 1 },
    { id: "visa-submitted", title: "Submit visa", leadWeeks: 2 },
    { id: "visa-approved", title: "Visa approved", leadWeeks: 4 },
    { id: "insurance-arranged", title: "Arrange insurance", leadWeeks: 1 },
    { id: "accommodation-arranged", title: "Arrange accommodation", leadWeeks: 2 },
    { id: "flight-booked", title: "Book flight", leadWeeks: 1 },
    { id: "arrival-transport-planned", title: "Plan arrival transport", leadWeeks: 1 },
    { id: "ready-to-travel", title: "Travel date", leadWeeks: 1 },
  ],
};

const TARGET_META = {
  study: { label: "Start process date", defaultLeadMonths: 0 },
  work: { label: "Start process date", defaultLeadMonths: 0 },
  travel: { label: "Start process date", defaultLeadMonths: 0 },
};

function shiftMonthInput(value, offset) {
  const parsed = parseMonthInput(value);
  if (!parsed) return "";

  const base = new Date(parsed.year, parsed.month - 1, 1);
  base.setMonth(base.getMonth() + Number(offset || 0));
  return formatMonthInput(base.getFullYear(), base.getMonth() + 1);
}

function shiftMonthInputByWeeks(value, weekOffset) {
  const parsed = parseMonthInput(value);
  if (!parsed) return "";

  const base = new Date(parsed.year, parsed.month - 1, 1);
  base.setDate(base.getDate() + Number(weekOffset || 0) * 7);
  return formatMonthInput(base.getFullYear(), base.getMonth() + 1);
}

function currentMonthInput() {
  const now = new Date();
  return formatMonthInput(now.getFullYear(), now.getMonth() + 1);
}

export function getMoneyToolTabs() {
  return [...MONEY_TOOL_TABS];
}

export function getPlannerTemplate(track) {
  const safeTrack = safeString(track, 20).toLowerCase();
  return [...(PLANNER_TEMPLATES[safeTrack] || PLANNER_TEMPLATES.study)];
}

export function buildBudgetPlannerRows(track, localCurrency, destinationCurrency) {
  const safeLocal = safeString(localCurrency, 6).toUpperCase();
  const safeDestination = safeString(destinationCurrency, 6).toUpperCase();

  return getPlannerTemplate(track).map((row) => ({
    id: row.id,
    label: row.label,
    amount: row.defaultAmount || "",
    currency:
      row.currencyMode === "destination"
        ? safeDestination || safeLocal
        : safeLocal || safeDestination,
  }));
}

export function hydrateBudgetPlannerRows(track, localCurrency, destinationCurrency, rows) {
  const defaults = buildBudgetPlannerRows(track, localCurrency, destinationCurrency);
  const incoming = Array.isArray(rows) ? rows : [];
  const incomingById = new Map(incoming.map((row) => [safeString(row?.id, 80), row]));

  return defaults.map((row) => {
    const saved = incomingById.get(row.id);
    return {
      ...row,
      amount: safeAmount(saved?.amount || row.amount),
      currency: safeString(saved?.currency, 6).toUpperCase() || row.currency,
    };
  });
}

export function buildCurrencyToolState(localCurrency, destinationCurrency, value = {}) {
  const safeLocal = safeString(localCurrency, 6).toUpperCase();
  const safeDestination = safeString(destinationCurrency, 6).toUpperCase();
  const savedFrom = safeString(value?.fromCurrency, 6).toUpperCase();
  const savedTo = safeString(value?.toCurrency, 6).toUpperCase();
  const shouldRepairDefaults =
    safeLocal &&
    safeDestination &&
    savedFrom === safeDestination &&
    savedTo === safeDestination;

  return {
    amount: safeAmount(value?.amount || "1000") || "1000",
    fromCurrency:
      (shouldRepairDefaults ? safeLocal : savedFrom) || safeLocal || safeDestination,
    toCurrency:
      (shouldRepairDefaults ? safeDestination : savedTo) || safeDestination || safeLocal,
  };
}

export function getTimelineTargetMeta(track) {
  const safeTrack = safeString(track, 20).toLowerCase();
  return TARGET_META[safeTrack] || TARGET_META.study;
}

export function getDefaultTimelineTargetMonth(track) {
  const targetMeta = getTimelineTargetMeta(track);
  return shiftMonthInput(currentMonthInput(), targetMeta.defaultLeadMonths);
}

function getPassportLeadWeeks(profileCountry) {
  const safeCountry = safeString(profileCountry, 80);
  return PASSPORT_LEAD_WEEKS[safeCountry] || PASSPORT_LEAD_WEEKS.default;
}

function resolveLeadWeeks(step, profileCountry) {
  if (step.leadWeeks === "passport") {
    return getPassportLeadWeeks(profileCountry);
  }
  return Number(step.leadWeeks || 0);
}

export function buildTimelinePlan(track, targetMonth, profileCountry = "") {
  const safeTrack = safeString(track, 20).toLowerCase();
  const timeline = TIMELINE_TEMPLATES[safeTrack] || TIMELINE_TEMPLATES.study;
  let cumulativeWeeks = 0;

  return timeline.map((item) => {
    cumulativeWeeks += resolveLeadWeeks(item, profileCountry);
    return {
      id: item.id,
      title: item.title,
      month: shiftMonthInputByWeeks(targetMonth, cumulativeWeeks),
      completed: false,
    };
  });
}

export function hydrateTimelineState(track, timelineState, profileCountry = "") {
  const defaultTargetMonth = getDefaultTimelineTargetMonth(track);
  const targetMonth = safeString(timelineState?.targetMonth, 10) || defaultTargetMonth;
  const defaults = buildTimelinePlan(track, targetMonth, profileCountry);
  const incoming = Array.isArray(timelineState?.items) ? timelineState.items : [];
  const incomingById = new Map(incoming.map((item) => [safeString(item?.id, 80), item]));

  return {
    targetMonth,
    items: defaults.map((item) => {
      const saved = incomingById.get(item.id);
      return {
        ...item,
        month: safeString(saved?.month, 10) || item.month,
        completed: Boolean(saved?.completed),
      };
    }),
  };
}

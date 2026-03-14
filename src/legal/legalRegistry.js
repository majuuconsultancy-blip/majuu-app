export const LEGAL_AUDIENCES = Object.freeze({
  PUBLIC: "public",
  USER: "user",
  STAFF: "staff",
  SERVICE_PARTNER: "service_partner",
  INTERNAL: "internal",
});

export const LEGAL_MOUNT_LOCATIONS = Object.freeze({
  SIGNUP: "signup",
  LOGIN: "login",
  PROFILE_PORTAL: "profile-legal-portal",
  PUBLIC_PORTAL: "public-legal-portal",
  STAFF_ONBOARDING: "staff-onboarding",
  SERVICE_PARTNER_ONBOARDING: "service-partner-onboarding",
  PAYMENT_CONTEXT: "payment-context",
});

export const LEGAL_DOC_KEYS = Object.freeze({
  TERMS_AND_CONDITIONS: "terms-and-conditions",
  PRIVACY_POLICY: "privacy-policy",
  ACCEPTABLE_USE_POLICY: "acceptable-use-policy",
  REFUND_POLICY: "refund-policy",
  DISPUTE_RESOLUTION_POLICY: "dispute-resolution-policy",
  ESCROW_POLICY: "escrow-policy",
  STAFF_AGREEMENT: "staff-agreement",
  SERVICE_PARTNER_AGREEMENT: "service-partner-agreement",
  STAFF_TIER_SYSTEM: "staff-tier-system",
  STAFF_PAYMENT_POLICY: "staff-payment-policy",
});

function publicRouteForKey(key) {
  return `/legal/${key}`;
}

function appRouteForKey(key) {
  return `/app/legal/${key}`;
}

function staffOnboardingRouteForKey(key) {
  return `/staff/onboarding/legal/${key}`;
}

function servicePartnerOnboardingRouteForKey(key) {
  return `/app/service-partner/onboarding/legal/${key}`;
}

const LEGAL_DOCUMENTS = [
  {
    key: LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS,
    slug: LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS,
    title: "Terms & Conditions",
    audience: LEGAL_AUDIENCES.USER,
    category: "core",
    publicPortal: true,
    mountLocations: [
      LEGAL_MOUNT_LOCATIONS.SIGNUP,
      LEGAL_MOUNT_LOCATIONS.LOGIN,
      LEGAL_MOUNT_LOCATIONS.PROFILE_PORTAL,
      LEGAL_MOUNT_LOCATIONS.PUBLIC_PORTAL,
    ],
    onboarding: {
      requiredAtSignup: true,
    },
    referencesNonCircumventionClause: true,
    routes: {
      public: publicRouteForKey(LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS),
      app: appRouteForKey(LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS),
    },
  },
  {
    key: LEGAL_DOC_KEYS.PRIVACY_POLICY,
    slug: LEGAL_DOC_KEYS.PRIVACY_POLICY,
    title: "Privacy Policy",
    audience: LEGAL_AUDIENCES.USER,
    category: "core",
    publicPortal: true,
    mountLocations: [
      LEGAL_MOUNT_LOCATIONS.SIGNUP,
      LEGAL_MOUNT_LOCATIONS.LOGIN,
      LEGAL_MOUNT_LOCATIONS.PROFILE_PORTAL,
      LEGAL_MOUNT_LOCATIONS.PUBLIC_PORTAL,
    ],
    onboarding: {
      requiredAtSignup: true,
    },
    routes: {
      public: publicRouteForKey(LEGAL_DOC_KEYS.PRIVACY_POLICY),
      app: appRouteForKey(LEGAL_DOC_KEYS.PRIVACY_POLICY),
    },
  },
  {
    key: LEGAL_DOC_KEYS.ACCEPTABLE_USE_POLICY,
    slug: LEGAL_DOC_KEYS.ACCEPTABLE_USE_POLICY,
    title: "Acceptable Use Policy",
    audience: LEGAL_AUDIENCES.PUBLIC,
    category: "user-policy",
    publicPortal: true,
    mountLocations: [LEGAL_MOUNT_LOCATIONS.PROFILE_PORTAL, LEGAL_MOUNT_LOCATIONS.PUBLIC_PORTAL],
    routes: {
      public: publicRouteForKey(LEGAL_DOC_KEYS.ACCEPTABLE_USE_POLICY),
      app: appRouteForKey(LEGAL_DOC_KEYS.ACCEPTABLE_USE_POLICY),
    },
  },
  {
    key: LEGAL_DOC_KEYS.REFUND_POLICY,
    slug: LEGAL_DOC_KEYS.REFUND_POLICY,
    title: "Refund Policy",
    audience: LEGAL_AUDIENCES.PUBLIC,
    category: "payment-policy",
    publicPortal: true,
    mountLocations: [
      LEGAL_MOUNT_LOCATIONS.PROFILE_PORTAL,
      LEGAL_MOUNT_LOCATIONS.PUBLIC_PORTAL,
      LEGAL_MOUNT_LOCATIONS.PAYMENT_CONTEXT,
    ],
    routes: {
      public: publicRouteForKey(LEGAL_DOC_KEYS.REFUND_POLICY),
      app: appRouteForKey(LEGAL_DOC_KEYS.REFUND_POLICY),
    },
  },
  {
    key: LEGAL_DOC_KEYS.DISPUTE_RESOLUTION_POLICY,
    slug: LEGAL_DOC_KEYS.DISPUTE_RESOLUTION_POLICY,
    title: "Dispute Resolution Policy",
    audience: LEGAL_AUDIENCES.PUBLIC,
    category: "user-policy",
    publicPortal: true,
    mountLocations: [LEGAL_MOUNT_LOCATIONS.PROFILE_PORTAL, LEGAL_MOUNT_LOCATIONS.PUBLIC_PORTAL],
    routes: {
      public: publicRouteForKey(LEGAL_DOC_KEYS.DISPUTE_RESOLUTION_POLICY),
      app: appRouteForKey(LEGAL_DOC_KEYS.DISPUTE_RESOLUTION_POLICY),
    },
  },
  {
    key: LEGAL_DOC_KEYS.ESCROW_POLICY,
    slug: LEGAL_DOC_KEYS.ESCROW_POLICY,
    title: "Escrow Policy",
    audience: LEGAL_AUDIENCES.PUBLIC,
    category: "payment-policy",
    publicPortal: true,
    mountLocations: [
      LEGAL_MOUNT_LOCATIONS.PROFILE_PORTAL,
      LEGAL_MOUNT_LOCATIONS.PUBLIC_PORTAL,
      LEGAL_MOUNT_LOCATIONS.PAYMENT_CONTEXT,
    ],
    routes: {
      public: publicRouteForKey(LEGAL_DOC_KEYS.ESCROW_POLICY),
      app: appRouteForKey(LEGAL_DOC_KEYS.ESCROW_POLICY),
    },
  },
  {
    key: LEGAL_DOC_KEYS.STAFF_AGREEMENT,
    slug: LEGAL_DOC_KEYS.STAFF_AGREEMENT,
    title: "Staff Agreement",
    audience: LEGAL_AUDIENCES.STAFF,
    category: "staff-onboarding",
    publicPortal: false,
    mountLocations: [LEGAL_MOUNT_LOCATIONS.STAFF_ONBOARDING],
    onboarding: {
      flow: "staff",
      required: true,
    },
    includesNonCircumventionClause: true,
    routes: {
      app: appRouteForKey(LEGAL_DOC_KEYS.STAFF_AGREEMENT),
      staffOnboarding: staffOnboardingRouteForKey(LEGAL_DOC_KEYS.STAFF_AGREEMENT),
    },
  },
  {
    key: LEGAL_DOC_KEYS.SERVICE_PARTNER_AGREEMENT,
    slug: LEGAL_DOC_KEYS.SERVICE_PARTNER_AGREEMENT,
    title: "Service Partner Agreement",
    audience: LEGAL_AUDIENCES.SERVICE_PARTNER,
    category: "partner-onboarding",
    publicPortal: false,
    mountLocations: [LEGAL_MOUNT_LOCATIONS.SERVICE_PARTNER_ONBOARDING],
    onboarding: {
      flow: "service-partner",
      required: true,
    },
    includesNonCircumventionClause: true,
    routes: {
      app: appRouteForKey(LEGAL_DOC_KEYS.SERVICE_PARTNER_AGREEMENT),
      servicePartnerOnboarding: servicePartnerOnboardingRouteForKey(LEGAL_DOC_KEYS.SERVICE_PARTNER_AGREEMENT),
    },
  },
  {
    key: LEGAL_DOC_KEYS.STAFF_TIER_SYSTEM,
    slug: LEGAL_DOC_KEYS.STAFF_TIER_SYSTEM,
    title: "Staff Tier System",
    audience: LEGAL_AUDIENCES.STAFF,
    category: "staff-onboarding",
    publicPortal: false,
    mountLocations: [LEGAL_MOUNT_LOCATIONS.STAFF_ONBOARDING],
    onboarding: {
      flow: "staff",
      required: true,
    },
    routes: {
      app: appRouteForKey(LEGAL_DOC_KEYS.STAFF_TIER_SYSTEM),
      staffOnboarding: staffOnboardingRouteForKey(LEGAL_DOC_KEYS.STAFF_TIER_SYSTEM),
    },
  },
  {
    key: LEGAL_DOC_KEYS.STAFF_PAYMENT_POLICY,
    slug: LEGAL_DOC_KEYS.STAFF_PAYMENT_POLICY,
    title: "Staff Payment Policy",
    audience: LEGAL_AUDIENCES.STAFF,
    category: "staff-onboarding",
    publicPortal: false,
    mountLocations: [LEGAL_MOUNT_LOCATIONS.STAFF_ONBOARDING],
    onboarding: {
      flow: "staff",
      required: true,
    },
    routes: {
      app: appRouteForKey(LEGAL_DOC_KEYS.STAFF_PAYMENT_POLICY),
      staffOnboarding: staffOnboardingRouteForKey(LEGAL_DOC_KEYS.STAFF_PAYMENT_POLICY),
    },
  },
];

export const LEGAL_DOCUMENT_REGISTRY = Object.freeze(
  LEGAL_DOCUMENTS.map((doc) => Object.freeze({ ...doc }))
);

const LEGAL_DOCUMENT_MAP = LEGAL_DOCUMENT_REGISTRY.reduce((acc, doc) => {
  acc[doc.key] = doc;
  return acc;
}, {});

export function getLegalDocument(keyOrSlug = "") {
  const value = String(keyOrSlug || "").trim().toLowerCase();
  if (!value) return null;

  if (LEGAL_DOCUMENT_MAP[value]) return LEGAL_DOCUMENT_MAP[value];

  return LEGAL_DOCUMENT_REGISTRY.find((doc) => doc.slug === value) || null;
}

export function getPublicLegalDocuments() {
  return LEGAL_DOCUMENT_REGISTRY.filter((doc) => doc.publicPortal);
}

export function getPaymentPolicyDocuments() {
  return LEGAL_DOCUMENT_REGISTRY.filter((doc) =>
    Array.isArray(doc.mountLocations)
      ? doc.mountLocations.includes(LEGAL_MOUNT_LOCATIONS.PAYMENT_CONTEXT)
      : false
  );
}

export function buildLegalPortalRoute(scope = "public") {
  if (scope === "app") return "/app/legal";
  return "/legal";
}

export function buildLegalDocRoute(docKey, { scope = "public" } = {}) {
  const doc = getLegalDocument(docKey);
  if (!doc) return buildLegalPortalRoute(scope);

  const byScope = String(scope || "public").trim();
  if (doc.routes?.[byScope]) return doc.routes[byScope];

  if (byScope === "app") return appRouteForKey(doc.key);
  if (byScope === "staffOnboarding") return staffOnboardingRouteForKey(doc.key);
  if (byScope === "servicePartnerOnboarding") return servicePartnerOnboardingRouteForKey(doc.key);
  return publicRouteForKey(doc.key);
}

export const STAFF_ONBOARDING_ITEMS = Object.freeze([
  {
    key: "staff-agreement",
    title: "Staff Agreement",
    description: "Review responsibilities, confidentiality, and service standards.",
    docKey: LEGAL_DOC_KEYS.STAFF_AGREEMENT,
    reviewedStateKey: "staffAgreementReviewed",
    checkedStateKey: "staffAgreementChecked",
  },
  {
    key: "staff-tier-system",
    title: "Staff Tier System",
    description: "Understand performance tiers and progression expectations.",
    docKey: LEGAL_DOC_KEYS.STAFF_TIER_SYSTEM,
    reviewedStateKey: "staffTierSystemReviewed",
    checkedStateKey: "staffTierSystemChecked",
  },
  {
    key: "staff-payment-policy",
    title: "Staff Payment Policy",
    description: "Review payout rules, approvals, and payment safeguards.",
    docKey: LEGAL_DOC_KEYS.STAFF_PAYMENT_POLICY,
    reviewedStateKey: "staffPaymentPolicyReviewed",
    checkedStateKey: "staffPaymentPolicyChecked",
  },
]);

export const SERVICE_PARTNER_ONBOARDING_ITEMS = Object.freeze([
  {
    key: "service-partner-agreement",
    title: "Service Partner Agreement",
    description: "Review responsibilities, non-circumvention, and payout terms.",
    docKey: LEGAL_DOC_KEYS.SERVICE_PARTNER_AGREEMENT,
    reviewedStateKey: "servicePartnerAgreementReviewed",
    checkedStateKey: "servicePartnerAgreementChecked",
  },
]);

function readBoolMap(raw, key, fallback = false) {
  if (!raw || typeof raw !== "object") return fallback;
  return raw[key] === true;
}

function createChecklistStateFromItems(items = []) {
  const state = {};
  for (const item of items) {
    state[item.reviewedStateKey] = false;
    state[item.checkedStateKey] = false;
  }
  return state;
}

function hydrateChecklistState(items = [], raw = {}, { forceComplete = false } = {}) {
  const state = createChecklistStateFromItems(items);

  for (const item of items) {
    const reviewed = forceComplete ? true : readBoolMap(raw, item.reviewedStateKey, false);
    const checked = forceComplete
      ? true
      : reviewed && readBoolMap(raw, item.checkedStateKey, false);

    state[item.reviewedStateKey] = reviewed;
    state[item.checkedStateKey] = checked;
  }

  return state;
}

function countCompletedItems(items = [], state = {}) {
  return items.reduce((count, item) => {
    return count + (state?.[item.checkedStateKey] === true ? 1 : 0);
  }, 0);
}

function areAllItemsComplete(items = [], state = {}) {
  return items.every((item) => state?.[item.checkedStateKey] === true);
}

export function createInitialStaffOnboardingState() {
  return createChecklistStateFromItems(STAFF_ONBOARDING_ITEMS);
}

export function hydrateStaffOnboardingState(raw = {}, { forceComplete = false } = {}) {
  return hydrateChecklistState(STAFF_ONBOARDING_ITEMS, raw, { forceComplete });
}

export function countCompletedStaffOnboardingItems(state = {}) {
  return countCompletedItems(STAFF_ONBOARDING_ITEMS, state);
}

export function areStaffOnboardingItemsComplete(state = {}) {
  return areAllItemsComplete(STAFF_ONBOARDING_ITEMS, state);
}

export function createInitialServicePartnerOnboardingState() {
  return createChecklistStateFromItems(SERVICE_PARTNER_ONBOARDING_ITEMS);
}

export function hydrateServicePartnerOnboardingState(raw = {}, { forceComplete = false } = {}) {
  return hydrateChecklistState(SERVICE_PARTNER_ONBOARDING_ITEMS, raw, { forceComplete });
}

export function areServicePartnerOnboardingItemsComplete(state = {}) {
  return areAllItemsComplete(SERVICE_PARTNER_ONBOARDING_ITEMS, state);
}

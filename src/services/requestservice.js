// requestservice.js (REPLACE with this)
import { auth, db } from "../firebase";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { logAnalyticsEvent } from "./analyticsService";
import { REQUEST_BACKEND_STATUSES } from "../utils/requestLifecycle";
import { notifyRequestSubmitted } from "./notificationEventService";
import { createRequestCommand } from "./requestcommandservice";
import {
  PARTNER_FILTER_MODES,
  preferredAgentReasonLabel,
  validatePreferredAgentSelection,
} from "./partnershipService";

function cleanStr(x, max = 500) {
  return String(x || "").trim().slice(0, max);
}

function cleanRequiredCounty(value) {
  const county = cleanStr(value, 80);
  if (!county) {
    const err = new Error("County is required.");
    err.code = "request/county-required";
    throw err;
  }
  return county;
}

function cleanTrack(x) {
  const t = cleanStr(x, 20).toLowerCase();
  return t === "study" || t === "work" || t === "travel" ? t : "study";
}

function cleanRequestType(x) {
  const t = cleanStr(x, 20).toLowerCase();
  return t === "full" ? "full" : "single";
}

function cleanInitialRequestStatus(value) {
  const raw = cleanStr(value, 40).toLowerCase();
  return raw === "payment_pending" ? "payment_pending" : "new";
}

const EXTRA_FIELD_TYPES = new Set(["text", "textarea", "number", "document"]);

function cleanItemKey(x) {
  const raw = cleanStr(x, 120).toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function cleanStringList(input, { maxItems = 60, maxLen = 120 } = {}) {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];

  for (const item of arr) {
    const clean = cleanStr(item, maxLen);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxItems) break;
  }

  return out;
}

function cleanPartnerIdList(input, { maxItems = 300 } = {}) {
  const values = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const clean = cleanStr(value, 140);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanUploadMeta(meta) {
  const raw = meta && typeof meta === "object" ? meta : null;
  const files = Array.isArray(raw?.files) ? raw.files : [];

  const cleanedFiles = files
    .slice(0, 20)
    .map((f) => {
      const name = cleanStr(f?.name, 120) || "file";
      const size = Number(f?.size || 0);
      const type = cleanStr(f?.type || f?.contentType, 80);
      const lastModified = Number(f?.lastModified || 0);

      // Preserve optional per-file metadata used for request definition document fields.
      const fieldId = cleanStr(f?.fieldId, 80);
      const fieldLabel = cleanStr(f?.fieldLabel, 140);
      const kind = cleanStr(f?.kind, 60);

      const payload = { name, size, type, lastModified };
      if (fieldId) payload.fieldId = fieldId;
      if (fieldLabel) payload.fieldLabel = fieldLabel;
      if (kind) payload.kind = kind;
      return payload;
    })
    .filter((f) => f.name);

  // Normalize count from the cleaned file list so we never drop valid file metadata.
  const count = cleanedFiles.length;

  const note = cleanStr(raw?.note, 200);

  // ✅ keep DB clean: store null if nothing was selected
  if (count <= 0) return null;

  return { count, files: cleanedFiles, note };
}

function cleanFileMetaList(input, { maxItems = 10 } = {}) {
  const files = Array.isArray(input) ? input : [];
  const cleaned = [];

  for (const f of files) {
    const name = cleanStr(f?.name, 120) || "file";
    if (!name) continue;
    cleaned.push({
      name,
      size: Number(f?.size || 0),
      type: cleanStr(f?.type, 80),
      lastModified: Number(f?.lastModified || 0),
    });
    if (cleaned.length >= maxItems) break;
  }

  return cleaned;
}

function cleanExtraFieldType(value) {
  const raw = cleanStr(value, 20).toLowerCase();
  return EXTRA_FIELD_TYPES.has(raw) ? raw : "text";
}

function cleanExtraFieldAnswers(input) {
  const raw = input && typeof input === "object" ? input : null;
  if (!raw) return null;

  const answersRaw = Array.isArray(raw?.answers) ? raw.answers : [];
  const answers = answersRaw
    .map((item) => {
      const entry = item && typeof item === "object" ? item : null;
      if (!entry) return null;

      const id = cleanStr(entry?.id, 80);
      const label = cleanStr(entry?.label, 120);
      const type = cleanExtraFieldType(entry?.type);
      const required = Boolean(entry?.required);
      const sortOrder = Number(entry?.sortOrder || 0);

      const value = type === "document" ? "" : cleanStr(entry?.value, 2000);
      const fileMetas = type === "document"
        ? cleanFileMetaList(entry?.fileMetas, { maxItems: 6 })
        : [];

      const hasValue = Boolean(value);
      const hasFiles = fileMetas.length > 0;
      if (!hasValue && !hasFiles) return null;

      return {
        id,
        label,
        type,
        required,
        value,
        fileMetas,
        sortOrder,
      };
    })
    .filter(Boolean)
    .slice(0, 40);

  const definitionId = cleanStr(raw?.definitionId, 140);
  const definitionKey = cleanStr(raw?.definitionKey, 200);
  const title = cleanStr(raw?.title, 140);
  const trackType = raw?.trackType ? cleanTrack(raw?.trackType) : "";
  const country = cleanStr(raw?.country, 80);

  const hasMeta = Boolean(definitionId || definitionKey || title || trackType || country);
  const hasAnswers = answers.length > 0;

  if (!hasMeta && !hasAnswers) return null;

  return {
    definitionId,
    definitionKey,
    title,
    trackType,
    country,
    answers,
  };
}

function cleanPaymentMeta(meta) {
  const raw = meta && typeof meta === "object" ? meta : null;

  const cleaned = {
    status: cleanStr(raw?.status, 40),
    method: cleanStr(raw?.method, 40),
    paidAt: Number(raw?.paidAt || 0),
    ref: cleanStr(raw?.ref, 80),
  };

  // ✅ store null unless there's meaningful data
  const hasAny = cleaned.status || cleaned.method || cleaned.paidAt > 0 || cleaned.ref;

  return hasAny ? cleaned : null;
}

function cleanPricingSnapshot(snapshot) {
  const raw = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!raw) return null;

  const pricingKey = cleanStr(raw?.pricingKey, 180);
  const amount = Number(raw?.amount || 0);
  if (!pricingKey || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    pricingKey,
    scope: cleanStr(raw?.scope, 80),
    requestType: cleanRequestType(raw?.requestType),
    track: cleanTrack(raw?.track),
    country: cleanStr(raw?.country, 120),
    serviceName: cleanStr(raw?.serviceName || raw?.label, 120),
    label: cleanStr(raw?.label || raw?.serviceName, 140),
    tag: cleanStr(raw?.tag, 40),
    amount: Math.round(amount),
    defaultAmount: Math.max(0, Math.round(Number(raw?.defaultAmount || 0))),
    currency: cleanStr(raw?.currency || "KES", 8).toUpperCase() || "KES",
    updatedAtMs: Number(raw?.updatedAtMs || 0),
  };
}

async function resolvePreferredAgentPayload({
  preferredAgentId = "",
  track = "",
  country = "",
  county = "",
  countryOfResidence = "",
  partnerFilterMode = PARTNER_FILTER_MODES.DESTINATION_COUNTRY,
  eligiblePartnerIds = [],
} = {}) {
  const safePreferredAgentId = cleanStr(preferredAgentId, 140);
  const checkedAtMs = Date.now();
  if (!safePreferredAgentId) {
    return {
      preferredAgentId: "",
      preferredAgentName: "",
      preferredAgentStatus: "none",
      preferredAgentInvalidReason: "",
      preferredAgentInvalidMessage: "",
      preferredAgentValidatedAtMs: checkedAtMs,
    };
  }

  try {
    const validation = await validatePreferredAgentSelection({
      partnerId: safePreferredAgentId,
      trackType: track,
      country,
      county,
      countryOfResidence,
      filterMode: partnerFilterMode,
      eligiblePartnerIds: cleanPartnerIdList(eligiblePartnerIds),
    });

    return {
      preferredAgentId: safePreferredAgentId,
      preferredAgentName: cleanStr(validation?.partner?.displayName, 120),
      preferredAgentStatus: validation?.valid ? "valid" : "invalid",
      preferredAgentInvalidReason: validation?.valid ? "" : cleanStr(validation?.reason, 80),
      preferredAgentInvalidMessage: validation?.valid
        ? ""
        : cleanStr(preferredAgentReasonLabel(validation?.reason), 180),
      preferredAgentValidatedAtMs: checkedAtMs,
    };
  } catch (error) {
    console.warn("preferred agent validation failed:", error?.message || error);
    return {
      preferredAgentId: safePreferredAgentId,
      preferredAgentName: "",
      preferredAgentStatus: "invalid",
      preferredAgentInvalidReason: "validation_failed",
      preferredAgentInvalidMessage: "Preferred agent will be reviewed during routing.",
      preferredAgentValidatedAtMs: checkedAtMs,
    };
  }
}

// Helpers for auth soft gate + safety
function requireSignedInUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be logged in to send a request.");
  return user;
}

function ensureVerified(user) {
  // ✅ Soft gate: block email/password accounts until verified
  // Google accounts usually come verified, so they pass.
  if (!user.emailVerified) {
    const err = new Error("Please verify your email before sending a request.");
    err.code = "auth/email-not-verified";
    throw err;
  }
}

function shouldUseLocalCreateFallback(error) {
  const code = cleanStr(error?.code, 180).toLowerCase();
  const message = cleanStr(error?.message, 500).toLowerCase();
  const status = Number(error?.status || 0) || 0;
  return (
    Boolean(error?.isInfrastructureUnavailable) ||
    code.startsWith("api/") ||
    status === 0 ||
    status === 404 ||
    status === 429 ||
    status === 500 ||
    status === 501 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "internal" ||
    message.includes("backend is not available")
  );
}

async function createRequestLocally({
  requestPayload = {},
  actorUid = "",
} = {}) {
  const safeActorUid = cleanStr(actorUid, 180);
  if (!safeActorUid) {
    throw new Error("Request create fallback requires a valid user.");
  }

  const now = Date.now();
  const requestRef = doc(collection(db, "serviceRequests"));
  const payload = requestPayload && typeof requestPayload === "object" ? requestPayload : {};
  const writePayload = {
    ...payload,
    uid: safeActorUid,
    lifecycle: {
      stage: "Submitted",
      decisionFinalized: false,
      finalDecision: "",
      version: 1,
      createdAt: serverTimestamp(),
      createdAtMs: now,
      updatedAt: serverTimestamp(),
      updatedAtMs: now,
    },
    ownership: {
      ownerUid: safeActorUid,
      adminUid: "",
      staffUid: "",
    },
    actionType: "createRequest",
    updatedBy: { uid: safeActorUid, role: "user" },
    createdAt: serverTimestamp(),
    createdAtMs: now,
    updatedAt: serverTimestamp(),
    updatedAtMs: now,
  };

  await setDoc(requestRef, writePayload, { merge: true });
  return {
    ok: true,
    command: "createRequest",
    requestId: requestRef.id,
    stage: "Submitted",
    localFallback: true,
  };
}

export async function createServiceRequest(payload) {
  // ✅ Ensure we have a signed-in user
  const user = requireSignedInUser();

  // ✅ Extra safety: payload uid must match current user
  const payloadUid = cleanStr(payload?.uid, 80);
  if (!payloadUid) throw new Error("Missing uid");
  if (payloadUid !== user.uid) {
    throw new Error("Auth mismatch. Please sign in again and retry.");
  }

  // ✅ Soft gate here (central enforcement)
  ensureVerified(user);

  const requestType = cleanRequestType(payload?.requestType);
  const isSingle = requestType === "single";
  const isFull = requestType === "full";

  const cleanMissingItems = isFull
    ? Array.from(
        new Set(
          (Array.isArray(payload?.missingItems) ? payload.missingItems : [])
            .map((x) => cleanStr(x, 80))
            .filter(Boolean)
        )
      ).slice(0, 50)
    : [];

  const cleanServiceName = isSingle
    ? cleanStr(payload?.serviceName, 80)
    : isFull
    ? cleanStr(payload?.serviceName || "Full Package", 80)
    : "";

  const parentRequestId = cleanStr(payload?.parentRequestId, 64);
  const fullPackageId = cleanStr(payload?.fullPackageId, 120);
  const fullPackageItem = cleanStr(payload?.fullPackageItem, 120);
  const fullPackageItemKey = cleanItemKey(
    payload?.fullPackageItemKey || payload?.serviceKey || fullPackageItem
  );
  const fullPackageSelectedItems = cleanStringList(
    payload?.fullPackageSelectedItems,
    { maxItems: 60, maxLen: 120 }
  );
  const isFullPackage =
    Boolean(fullPackageId) && (Boolean(payload?.isFullPackage) || isFull);

  const paid = Boolean(payload?.paid);
  const paymentMetaRaw = cleanPaymentMeta(payload?.paymentMeta);
  const paymentMeta = paid ? paymentMetaRaw : null;

  const requestUploadMeta = cleanUploadMeta(payload?.requestUploadMeta);
  const extraFieldAnswers = cleanExtraFieldAnswers(payload?.extraFieldAnswers);
  const county = cleanRequiredCounty(payload?.county);
  const town = cleanStr(payload?.town || payload?.city, 80);
  const countryOfResidence = cleanStr(payload?.countryOfResidence, 80);
  const partnerFilterMode = cleanStr(payload?.partnerFilterMode, 40).toLowerCase() ||
    PARTNER_FILTER_MODES.DESTINATION_COUNTRY;
  const unlockPaymentId = cleanStr(payload?.unlockPaymentId, 180);
  const unlockPaymentRequestId = cleanStr(payload?.unlockPaymentRequestId, 180);
  const pricingSnapshot = cleanPricingSnapshot(payload?.pricingSnapshot);
  const requestDefinitionId = cleanStr(
    payload?.requestDefinitionId || payload?.extraFieldAnswers?.definitionId,
    140
  );
  const requestDefinitionKey = cleanStr(
    payload?.requestDefinitionKey || payload?.extraFieldAnswers?.definitionKey,
    200
  );
  const eligiblePartnerIds = cleanPartnerIdList(
    payload?.eligiblePartnerIds || payload?.eligiblePartners || []
  );
  const preferredAgentPayload = await resolvePreferredAgentPayload({
    preferredAgentId: payload?.preferredAgentId,
    track: cleanTrack(payload?.track),
    country: cleanStr(payload?.country, 80),
    county,
    countryOfResidence,
    partnerFilterMode,
    eligiblePartnerIds,
  });
  const initialStatus = cleanInitialRequestStatus(payload?.status);
  const initialRoutingStatus =
    initialStatus === "payment_pending" ? "awaiting_payment" : "awaiting_route";
  const skipAdminPush = payload?.skipAdminPush === true || initialStatus !== "new";

  const clean = {
    uid: user.uid,
    // prefer auth email (more trustworthy), fallback to payload
    email: cleanStr(user.email || payload?.email, 120),

    track: cleanTrack(payload?.track),
    country: cleanStr(payload?.country, 80),
    countryOfResidence,
    partnerFilterMode,

    requestType,
    serviceName: cleanServiceName,

    name: cleanStr(payload?.name, 120),
    phone: cleanStr(payload?.phone, 40),
    note: cleanStr(payload?.note, 1500),
    county,
    countyLower: county.toLowerCase(),
    town,
    city: town, // legacy compatibility
    preferredAgentId: preferredAgentPayload.preferredAgentId,
    preferredAgentName: preferredAgentPayload.preferredAgentName,
    preferredAgentStatus: preferredAgentPayload.preferredAgentStatus,
    preferredAgentInvalidReason: preferredAgentPayload.preferredAgentInvalidReason,
    preferredAgentInvalidMessage: preferredAgentPayload.preferredAgentInvalidMessage,
    preferredAgentValidatedAtMs: preferredAgentPayload.preferredAgentValidatedAtMs,
    assignedPartnerId: "",
    assignedPartnerName: "",
    assignedAdminId: "",
    routingStatus: "awaiting_route",

    missingItems: cleanMissingItems,
    parentRequestId: parentRequestId || "",
    isFullPackage,
    fullPackageId: isFullPackage ? fullPackageId : "",
    fullPackageItem: isFullPackage ? fullPackageItem : "",
    fullPackageItemKey: isFullPackage ? fullPackageItemKey : "",
    fullPackageSelectedItems: isFullPackage ? fullPackageSelectedItems : [],

    paid,
    paymentMeta,
    pricingSnapshot,
    unlockPaymentId,
    unlockPaymentRequestId,
    requestDefinitionId,
    requestDefinitionKey,
    eligiblePartnerIds,
    requestUploadMeta,
    extraFieldAnswers,

    status: "new",
    backendStatus: REQUEST_BACKEND_STATUSES.NEW,
    userStatus: "",
    everAssigned: false,
    currentAdminUid: "",
    currentAdminRole: "",
    currentAdminEmail: "",
    currentAdminAvailability: "",
    ownerLockedAdminUid: "",
    markedInProgressAt: null,
    markedInProgressAtMs: 0,
    staffProgressPercent: null,
    staffProgressUpdatedAt: null,
    staffProgressUpdatedAtMs: 0,
    escalationCount: 0,
    responseDeadlineAtMs: 0,
    routingMeta: {
      track: cleanTrack(payload?.track),
      country: cleanStr(payload?.country, 80),
      countryOfResidence,
      partnerFilterMode,
      county,
      town,
      currentAdminUid: "",
      currentAdminEmail: "",
      assignedAdminId: "",
      assignedPartnerId: "",
      assignedPartnerName: "",
      preferredAgentId: preferredAgentPayload.preferredAgentId,
      preferredAgentName: preferredAgentPayload.preferredAgentName,
      preferredAgentStatus: preferredAgentPayload.preferredAgentStatus,
      preferredAgentInvalidReason: preferredAgentPayload.preferredAgentInvalidReason,
      preferredAgentInvalidMessage: preferredAgentPayload.preferredAgentInvalidMessage,
      requestDefinitionId,
      requestDefinitionKey,
      eligiblePartnerIds,
      routedAtMs: 0,
      routingReason:
        initialStatus === "payment_pending" ? "awaiting_unlock_payment" : "awaiting_route",
      routingStatus: initialRoutingStatus,
      adminAvailabilityAtRouting: "",
      escalationReason: "",
      unresolvedReason: "",
      partnerDecisionSource: "",
      countyMatchType: "",
      eligiblePartnerCount: 0,
      eligibleAdminCount: 0,
      escalationCount: 0,
      reassignmentHistory: [],
      acceptedAtMs: 0,
      lockedOwnerAdminUid: "",
    },
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };
  clean.status = initialStatus;
  clean.routingStatus = initialRoutingStatus;
  const idempotencySeed = `${user.uid}:${clean.track}:${clean.country}:${clean.requestType}:${Date.now()}`;
  let commandResult = null;
  try {
    commandResult = await createRequestCommand({
      request: clean,
      idempotencyKey: cleanStr(payload?.idempotencyKey || idempotencySeed, 120),
    });
  } catch (error) {
    if (!shouldUseLocalCreateFallback(error)) {
      throw error;
    }
    commandResult = await createRequestLocally({
      requestPayload: clean,
      actorUid: user.uid,
    });
  }
  const createdRequestId = cleanStr(commandResult?.requestId, 180);
  if (!createdRequestId) {
    throw new Error("Failed to create request (missing requestId).");
  }

  if (initialStatus === "new") {
    void logAnalyticsEvent({
      uid: user.uid,
      eventType: ANALYTICS_EVENT_TYPES.REQUEST_SUBMITTED,
      trackType: clean.track,
      country: clean.country,
      requestId: createdRequestId,
      requestTitle: clean.serviceName,
      sourceScreen: "requestservice.createServiceRequest",
      metadata: {
        requestType: clean.requestType,
        isFullPackage: Boolean(clean.isFullPackage),
        fullPackageId: clean.fullPackageId || "",
        paid: Boolean(clean.paid),
      },
    });
  }

  if (!skipAdminPush) {
    try {
      await notifyRequestSubmitted({ requestId: createdRequestId });
    } catch (error) {
      console.warn("Failed to fan out NEW_REQUEST notifications:", error?.message || error);
    }
  }

  // ✅ Trigger auto-routing in the background
  return createdRequestId;
}

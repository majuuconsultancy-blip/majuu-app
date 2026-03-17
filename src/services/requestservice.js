// requestservice.js (REPLACE with this)
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { sendPushToAdmin } from "./pushServerClient";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { logAnalyticsEvent } from "./analyticsService";

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

  const ref = collection(db, "serviceRequests");

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
  const unlockPaymentId = cleanStr(payload?.unlockPaymentId, 180);
  const unlockPaymentRequestId = cleanStr(payload?.unlockPaymentRequestId, 180);
  const pricingSnapshot = cleanPricingSnapshot(payload?.pricingSnapshot);

  const clean = {
    uid: user.uid,
    // prefer auth email (more trustworthy), fallback to payload
    email: cleanStr(user.email || payload?.email, 120),

    track: cleanTrack(payload?.track),
    country: cleanStr(payload?.country, 80),

    requestType,
    serviceName: cleanServiceName,

    name: cleanStr(payload?.name, 120),
    phone: cleanStr(payload?.phone, 40),
    note: cleanStr(payload?.note, 1500),
    county,
    countyLower: county.toLowerCase(),
    town,
    city: town, // legacy compatibility

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
    requestUploadMeta,
    extraFieldAnswers,

    status: "new",
    currentAdminUid: "",
    currentAdminRole: "",
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
      county,
      town,
      currentAdminUid: "",
      routedAtMs: 0,
      routingReason: "awaiting_auto_route",
      adminAvailabilityAtRouting: "",
      escalationReason: "",
      escalationCount: 0,
      reassignmentHistory: [],
      acceptedAtMs: 0,
      lockedOwnerAdminUid: "",
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(ref, clean);

  void logAnalyticsEvent({
    uid: user.uid,
    eventType: ANALYTICS_EVENT_TYPES.REQUEST_SUBMITTED,
    trackType: clean.track,
    country: clean.country,
    requestId: docRef.id,
    requestTitle: clean.serviceName,
    sourceScreen: "requestservice.createServiceRequest",
    metadata: {
      requestType: clean.requestType,
      isFullPackage: Boolean(clean.isFullPackage),
      fullPackageId: clean.fullPackageId || "",
      paid: Boolean(clean.paid),
    },
  });

  try {
    await sendPushToAdmin({
      title: "New request",
      body: "A new service request was submitted.",
      data: {
        type: "NEW_REQUEST",
        requestId: docRef.id,
        route: `/app/admin/request/${encodeURIComponent(docRef.id)}`,
      },
    });
  } catch (error) {
    console.warn("Failed to trigger NEW_REQUEST push:", error?.message || error);
  }
  return docRef.id;
}

import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";

const EXTRACT_METHOD = "template_v1";

const DOC_TYPE_FIELD_MAP = {
  PASSPORT: ["fullName", "passportNumber", "dob", "nationality", "expiryDate"],
  NATIONAL_ID: ["fullName", "idNumber", "dob", "address"],
  BANK_STATEMENT: ["fullName", "bankName", "accountNumber", "period"],
  BIRTH_CERT: ["fullName", "dob", "nationality", "notes"],
  CERTIFICATE: ["fullName", "certificateName", "issueDate", "notes"],
  PHOTO: ["fullName", "notes"],
  GENERIC: ["fullName", "phone", "email", "address", "notes"],
};

const STATUS_SET = new Set(["draft", "reviewed", "approved"]);
const ROLE_SET = new Set(["staff", "admin", "user"]);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?\d[\d()\s.-]{7,}\d)/;
const ID_RE = /\b\d{6,12}\b/;
const PASSPORT_RE = /\b(?=[A-Z0-9]{6,9}\b)(?=.*[A-Z])(?=.*\d)[A-Z0-9]+\b/i;
const PERIOD_RE = /\b(20\d{2}[-_ ]?(?:0[1-9]|1[0-2]))\b/;

function safeStr(value, max = 800) {
  return String(value || "").trim().slice(0, max);
}

function safeId(value) {
  return safeStr(value, 120);
}

function normalizeRole(role) {
  const clean = safeStr(role, 20).toLowerCase();
  return ROLE_SET.has(clean) ? clean : "staff";
}

function normalizeStatus(status) {
  const clean = safeStr(status, 20).toLowerCase();
  return STATUS_SET.has(clean) ? clean : "draft";
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function normalizeDocTypeValue(value) {
  const raw = safeStr(value, 80).toUpperCase();
  if (!raw) return "";
  if (raw.includes("PASSPORT")) return "PASSPORT";
  if (raw.includes("NATIONAL") || raw === "ID" || raw.includes("ID_CARD")) return "NATIONAL_ID";
  if (raw.includes("BANK") || raw.includes("STATEMENT")) return "BANK_STATEMENT";
  if (raw.includes("BIRTH")) return "BIRTH_CERT";
  if (raw.includes("CERT")) return "CERTIFICATE";
  if (raw.includes("PHOTO") || raw.includes("IMAGE") || raw.includes("PIC")) return "PHOTO";
  return "";
}

function inferDocTypeFromText(text) {
  const clean = safeStr(text, 240).toLowerCase();
  if (!clean) return "";
  if (clean.includes("passport")) return "PASSPORT";
  if (
    clean.includes("national id") ||
    clean.includes("national-id") ||
    clean.includes("id card") ||
    clean.includes("national") ||
    /\bid\b/.test(clean)
  ) {
    return "NATIONAL_ID";
  }
  if (clean.includes("bank") || clean.includes("statement")) return "BANK_STATEMENT";
  if (clean.includes("birth")) return "BIRTH_CERT";
  if (clean.includes("certificate")) return "CERTIFICATE";
  if (clean.includes("photo") || clean.includes("image") || clean.includes("picture")) return "PHOTO";
  return "";
}

function resolveDocType(attachment) {
  const explicitRaw =
    safeStr(attachment?.docType, 80) ||
    safeStr(attachment?.tag, 80) ||
    safeStr(attachment?.label, 80) ||
    safeStr(attachment?.kind, 80) ||
    safeStr(attachment?.category, 80);

  const explicit = normalizeDocTypeValue(explicitRaw) || inferDocTypeFromText(explicitRaw);
  if (explicit) {
    return { docType: explicit, source: "tag" };
  }

  const filename = safeStr(
    attachment?.name || attachment?.filename || attachment?.fileName || attachment?.title,
    200
  );
  const inferred = inferDocTypeFromText(filename);
  if (inferred) {
    return { docType: inferred, source: "filename" };
  }

  return { docType: "GENERIC", source: "default" };
}

function buildAttachmentNotes(attachment) {
  return [
    safeStr(attachment?.metaNote, 1200),
    safeStr(attachment?.notes, 1200),
    safeStr(attachment?.note, 1200),
    safeStr(attachment?.description, 1200),
  ]
    .filter(Boolean)
    .join(" ");
}

function firstMatch(text, regex) {
  const m = safeStr(text, 5000).match(regex);
  return safeStr(m?.[0], 120);
}

function normalizePeriod(match) {
  const value = safeStr(match, 32).replace(/[_ ]+/g, "-");
  if (!value) return "";
  return value;
}

function guessBankNameFromFilename(attachment) {
  const filename = safeStr(
    attachment?.name || attachment?.filename || attachment?.fileName || "",
    200
  ).toLowerCase();

  const banks = [
    "equity",
    "kcb",
    "absa",
    "co-operative",
    "cooperative",
    "stanbic",
    "standard chartered",
    "ncba",
    "family bank",
    "ecobank",
  ];

  const found = banks.find((bank) => filename.includes(bank));
  if (!found) return "";
  return found
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function setFieldValue({ fields, confidence }, key, value, source = "inferred") {
  const cleanValue = safeStr(value, 240);
  if (!key) return false;
  fields[key] = cleanValue;
  if (!cleanValue) {
    confidence[key] = 0;
    return false;
  }

  if (source === "regex") {
    confidence[key] = 0.75;
    return true;
  }

  confidence[key] = 0.35;
  return true;
}

function sanitizeFields(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  Object.entries(input).forEach(([key, value]) => {
    const cleanKey = safeStr(key, 80);
    if (!cleanKey) return;
    out[cleanKey] = safeStr(value, 240);
  });
  return out;
}

function sanitizeConfidence(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  Object.entries(input).forEach(([key, value]) => {
    const cleanKey = safeStr(key, 80);
    if (!cleanKey) return;
    out[cleanKey] = clamp01(value);
  });
  return out;
}

function sanitizeHighlights(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => safeStr(item, 160)).filter(Boolean).slice(0, 12);
}

function buildUpdatedBy(role) {
  return {
    uid: safeId(auth?.currentUser?.uid) || "unknown",
    role: normalizeRole(role),
  };
}

function requireIds(requestId, attachmentId) {
  const rid = safeId(requestId);
  const aid = safeId(attachmentId);
  if (!rid) throw new Error("Missing requestId");
  if (!aid) throw new Error("Missing attachmentId");
  return { rid, aid };
}

function resolveAttachmentId(attachment) {
  return safeId(attachment?.id || attachment?.attachmentId);
}

function normalizeNameForCompare(name) {
  return safeStr(name, 200)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttachmentDisplayName(attachment) {
  return (
    safeStr(attachment?.name, 180) ||
    safeStr(attachment?.filename, 180) ||
    safeStr(attachment?.fileName, 180) ||
    "Document"
  );
}

function modeName(values) {
  const counter = new Map();
  values.forEach((value) => {
    if (!value.normalized) return;
    const current = counter.get(value.normalized) || {
      count: 0,
      display: value.display,
    };
    current.count += 1;
    if (!current.display && value.display) {
      current.display = value.display;
    }
    counter.set(value.normalized, current);
  });

  let winner = { normalized: "", display: "", count: 0 };
  counter.forEach((entry, normalized) => {
    if (entry.count > winner.count) {
      winner = {
        normalized,
        display: entry.display || "",
        count: entry.count,
      };
    }
  });
  return winner;
}

export function getTemplateFieldKeys(docType) {
  const normalized = normalizeDocTypeValue(docType) || "GENERIC";
  return DOC_TYPE_FIELD_MAP[normalized] || DOC_TYPE_FIELD_MAP.GENERIC;
}

export function generateTemplateExtract({ request, attachment } = {}) {
  const { docType, source } = resolveDocType(attachment);
  const templateKeys = getTemplateFieldKeys(docType);
  const fields = {};
  const confidence = {};
  const highlights = [];

  templateKeys.forEach((key) => {
    fields[key] = "";
    confidence[key] = 0;
  });

  if (source === "filename") {
    highlights.push("Doc type inferred from filename");
  } else if (source === "tag") {
    highlights.push("Doc type from attachment metadata");
  } else {
    highlights.push("Using generic metadata template");
  }

  const requestFullName = safeStr(request?.name || request?.fullName, 120);
  if (requestFullName && Object.prototype.hasOwnProperty.call(fields, "fullName")) {
    setFieldValue({ fields, confidence }, "fullName", requestFullName, "inferred");
    highlights.push("Added full name from request profile");
  }

  const requestPhone = safeStr(request?.phone, 80);
  if (requestPhone && Object.prototype.hasOwnProperty.call(fields, "phone")) {
    setFieldValue({ fields, confidence }, "phone", requestPhone, "inferred");
  }

  const requestEmail = safeStr(request?.email, 120);
  if (requestEmail && Object.prototype.hasOwnProperty.call(fields, "email")) {
    setFieldValue({ fields, confidence }, "email", requestEmail, "inferred");
  }

  const attachmentNotes = buildAttachmentNotes(attachment);
  const foundEmail = firstMatch(attachmentNotes, EMAIL_RE);
  const foundPhone = firstMatch(attachmentNotes, PHONE_RE);
  const foundId = firstMatch(attachmentNotes, ID_RE);
  const foundPassport = firstMatch(attachmentNotes.toUpperCase(), PASSPORT_RE);
  const foundPeriod = normalizePeriod(firstMatch(attachmentNotes, PERIOD_RE));

  if (foundEmail) {
    if (!Object.prototype.hasOwnProperty.call(fields, "email")) {
      fields.email = "";
      confidence.email = 0;
    }
    setFieldValue({ fields, confidence }, "email", foundEmail, "regex");
    highlights.push("Detected email from notes");
  }

  if (foundPhone) {
    if (!Object.prototype.hasOwnProperty.call(fields, "phone")) {
      fields.phone = "";
      confidence.phone = 0;
    }
    setFieldValue({ fields, confidence }, "phone", foundPhone, "regex");
    highlights.push("Detected phone from notes");
  }

  if (docType === "NATIONAL_ID" && foundId) {
    setFieldValue({ fields, confidence }, "idNumber", foundId, "regex");
    highlights.push("Detected ID number pattern from notes");
  }

  if (docType === "PASSPORT" && foundPassport) {
    setFieldValue({ fields, confidence }, "passportNumber", foundPassport, "regex");
    highlights.push("Detected passport-like pattern from notes");
  }

  if (docType === "BANK_STATEMENT") {
    const filenameBank = guessBankNameFromFilename(attachment);
    if (filenameBank) {
      setFieldValue({ fields, confidence }, "bankName", filenameBank, "inferred");
      highlights.push("Detected bank name from filename");
    }

    if (foundPeriod) {
      setFieldValue({ fields, confidence }, "period", foundPeriod, "regex");
      highlights.push("Detected statement period from notes");
    }
  }

  if (Object.prototype.hasOwnProperty.call(fields, "notes")) {
    const shortNote = safeStr(attachmentNotes, 220);
    if (shortNote) {
      setFieldValue({ fields, confidence }, "notes", shortNote, "inferred");
    }
  }

  return {
    docType,
    fields,
    confidence,
    highlights: sanitizeHighlights(highlights),
  };
}

export function getExtractRef(requestId, attachmentId) {
  const { rid, aid } = requireIds(requestId, attachmentId);
  return doc(db, "serviceRequests", rid, "documentExtracts", aid);
}

export async function createOrGetDraftExtract(requestId, attachment, request = null, role = "staff") {
  const attachmentId = resolveAttachmentId(attachment);
  const { rid, aid } = requireIds(requestId, attachmentId);
  const ref = getExtractRef(rid, aid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() };
  }

  const generated = generateTemplateExtract({ request, attachment });
  const payload = {
    attachmentId: aid,
    requestId: rid,
    status: "draft",
    method: EXTRACT_METHOD,
    docType: generated.docType,
    fields: generated.fields,
    confidence: generated.confidence,
    highlights: generated.highlights,
    notes: "",
    updatedBy: buildUpdatedBy(role),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  await setDoc(ref, payload, { merge: true });
  return { id: aid, ...payload };
}

export async function updateExtractFields(requestId, attachmentId, patch = {}, role = "staff") {
  const { rid, aid } = requireIds(requestId, attachmentId);
  const ref = getExtractRef(rid, aid);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? snap.data() || {} : {};

  const nextFields =
    patch.fields && typeof patch.fields === "object"
      ? { ...(prev.fields || {}), ...sanitizeFields(patch.fields) }
      : prev.fields || {};

  const nextConfidence =
    patch.confidence && typeof patch.confidence === "object"
      ? { ...(prev.confidence || {}), ...sanitizeConfidence(patch.confidence) }
      : prev.confidence || {};

  const nextStatus = patch.status ? normalizeStatus(patch.status) : normalizeStatus(prev.status);

  const payload = {
    attachmentId: aid,
    requestId: rid,
    status: nextStatus,
    method: safeStr(patch.method || prev.method || EXTRACT_METHOD, 80) || EXTRACT_METHOD,
    docType: normalizeDocTypeValue(patch.docType || prev.docType) || "GENERIC",
    fields: nextFields,
    confidence: nextConfidence,
    highlights:
      patch.highlights !== undefined
        ? sanitizeHighlights(patch.highlights)
        : sanitizeHighlights(prev.highlights),
    notes:
      patch.notes !== undefined ? safeStr(patch.notes, 1200) : safeStr(prev.notes, 1200),
    updatedBy: buildUpdatedBy(role),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(ref, payload, { merge: true });
  return payload;
}

export async function resetExtractToDraft(requestId, attachment, request = null, role = "staff") {
  const attachmentId = resolveAttachmentId(attachment);
  const { rid, aid } = requireIds(requestId, attachmentId);
  const ref = getExtractRef(rid, aid);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? snap.data() || {} : {};
  const generated = generateTemplateExtract({ request, attachment });

  const payload = {
    attachmentId: aid,
    requestId: rid,
    status: "draft",
    method: EXTRACT_METHOD,
    docType: generated.docType,
    fields: generated.fields,
    confidence: generated.confidence,
    highlights: generated.highlights,
    notes: safeStr(prev.notes, 1200),
    updatedBy: buildUpdatedBy(role),
    updatedAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(ref, payload, { merge: true });
  return payload;
}

export async function getExtractsByAttachmentIds(requestId, attachmentIds = []) {
  const rid = safeId(requestId);
  if (!rid) throw new Error("Missing requestId");

  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(attachmentIds) ? attachmentIds : [])
        .map((id) => safeId(id))
        .filter(Boolean)
    )
  );

  if (uniqueIds.length === 0) return {};

  const out = {};
  const chunks = [];
  for (let i = 0; i < uniqueIds.length; i += 10) {
    chunks.push(uniqueIds.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    const ref = collection(db, "serviceRequests", rid, "documentExtracts");
    const qy = query(ref, where(documentId(), "in", chunk));
    const snap = await getDocs(qy);
    snap.docs.forEach((d) => {
      out[d.id] = { id: d.id, ...d.data() };
    });
  }

  return out;
}

export function buildNameUniformityProofread({
  attachments = [],
  extractsByAttachmentId = {},
  request = null,
} = {}) {
  const rows = (Array.isArray(attachments) ? attachments : []).map((attachment) => {
    const attachmentId = resolveAttachmentId(attachment);
    const extract = extractsByAttachmentId?.[attachmentId] || null;
    const extractedName = safeStr(extract?.fields?.fullName, 160);
    const normalized = normalizeNameForCompare(extractedName);

    return {
      attachmentId,
      attachmentName: getAttachmentDisplayName(attachment),
      extractedName,
      normalizedName: normalized,
      hasExtract: Boolean(extract),
      extractStatus: safeStr(extract?.status, 40) || "",
      fullNameConfidence: clamp01(extract?.confidence?.fullName),
    };
  });

  const candidateNames = rows
    .filter((row) => row.normalizedName)
    .map((row) => ({ normalized: row.normalizedName, display: row.extractedName }));

  const winner = modeName(candidateNames);
  const requestName = safeStr(request?.name || request?.fullName, 160);
  const requestNormalized = normalizeNameForCompare(requestName);

  const baselineNormalized = winner.normalized || requestNormalized;
  const baselineDisplay = winner.display || requestName;

  let uniformCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;

  const rowChecks = rows.map((row) => {
    if (!baselineNormalized) {
      missingCount += 1;
      return {
        ...row,
        status: "missing_name",
        verdict: "No comparable name found yet",
      };
    }

    if (!row.normalizedName) {
      missingCount += 1;
      return {
        ...row,
        status: "missing_name",
        verdict: "Name is missing in this document extract",
      };
    }

    if (row.normalizedName === baselineNormalized) {
      uniformCount += 1;
      return {
        ...row,
        status: "uniform",
        verdict: "Name matches baseline",
      };
    }

    mismatchCount += 1;
    return {
      ...row,
      status: "mismatch",
      verdict: "Name differs from baseline",
    };
  });

  const totalDocs = rows.length;
  const checkedDocs = rowChecks.filter((row) => row.status !== "missing_name").length;

  let summaryStatus = "ok";
  if (!baselineNormalized) summaryStatus = "insufficient_data";
  else if (mismatchCount > 0) summaryStatus = "attention";
  else if (missingCount > 0) summaryStatus = "partial";

  const summaryLine =
    summaryStatus === "attention"
      ? `${mismatchCount} document${mismatchCount === 1 ? "" : "s"} have name mismatch`
      : summaryStatus === "partial"
      ? "No mismatches found, but some documents are missing extracted names"
      : summaryStatus === "insufficient_data"
      ? "No extracted names found to compare yet"
      : "All checked document names look uniform";

  return {
    baselineName: baselineDisplay,
    baselineNormalized,
    totalDocs,
    checkedDocs,
    uniformCount,
    mismatchCount,
    missingCount,
    summaryStatus,
    summaryLine,
    rows: rowChecks,
  };
}

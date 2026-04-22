function safeString(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function normalizeSegment(value, fallback = "x", max = 160) {
  const clean = safeString(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function normalizePath(rawPath = "") {
  return safeString(rawPath, 720)
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function extensionFromMime(mime = "") {
  const clean = safeString(mime, 120).toLowerCase();
  if (clean === "image/jpeg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "application/pdf") return "pdf";
  if (clean === "text/plain") return "txt";
  return "";
}

function splitNameAndExtension(fileName = "", fallbackBase = "file") {
  const raw = normalizePath(fileName).split("/").pop() || fallbackBase;
  const dotIndex = raw.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === raw.length - 1) {
    return { base: raw, ext: "" };
  }
  return {
    base: raw.slice(0, dotIndex),
    ext: raw.slice(dotIndex + 1),
  };
}

export function buildStorageFileName({
  originalName = "",
  contentType = "",
  fallbackBase = "file",
} = {}) {
  const parsed = splitNameAndExtension(originalName, fallbackBase);
  const derivedExt = extensionFromMime(contentType);
  const ext = safeString(parsed.ext || derivedExt, 12).toLowerCase();
  const base = normalizeSegment(parsed.base, fallbackBase, 120);
  return ext ? `${base}.${ext}` : base;
}

export const STORAGE_PATH_CONTRACTS = Object.freeze({
  REQUEST_ATTACHMENT: "request_attachment",
  CHAT_ATTACHMENT: "chat_attachment",
  SELF_HELP_DOCUMENT: "self_help_document",
  PROFILE_IMAGE: "profile_image",
});

const STORAGE_RULES = Object.freeze([
  {
    contract: STORAGE_PATH_CONTRACTS.REQUEST_ATTACHMENT,
    pattern: /^requests\/[^/]+\/attachments\/[^/]+\/[^/]+$/i,
    requiredMetadata: ["requestId", "attachmentId", "ownerUid", "source"],
  },
  {
    contract: STORAGE_PATH_CONTRACTS.CHAT_ATTACHMENT,
    pattern: /^requests\/[^/]+\/chat\/[^/]+\/[^/]+\/[^/]+$/i,
    requiredMetadata: ["requestId", "fromRole", "attachmentKind", "source"],
  },
  {
    contract: STORAGE_PATH_CONTRACTS.SELF_HELP_DOCUMENT,
    pattern: /^users\/[^/]+\/self_help\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/i,
    requiredMetadata: ["ownerUid", "track", "country", "recordId", "source"],
  },
  {
    contract: STORAGE_PATH_CONTRACTS.PROFILE_IMAGE,
    pattern: /^users\/[^/]+\/profile\/avatar\/[^/]+$/i,
    requiredMetadata: ["ownerUid", "source"],
  },
]);

function findRuleForPath(path = "") {
  const cleanPath = normalizePath(path);
  return STORAGE_RULES.find((rule) => rule.pattern.test(cleanPath)) || null;
}

export function getStorageContractForPath(path = "") {
  return findRuleForPath(path)?.contract || "";
}

export function validateStoragePathContract(path = "") {
  const cleanPath = normalizePath(path);
  const rule = findRuleForPath(cleanPath);
  return {
    ok: Boolean(rule),
    path: cleanPath,
    contract: rule?.contract || "",
    requiredMetadata: Array.isArray(rule?.requiredMetadata) ? rule.requiredMetadata : [],
  };
}

export function assertStoragePathContract(path = "") {
  const result = validateStoragePathContract(path);
  if (!result.ok) {
    throw new Error(
      "Invalid storagePath contract. Use a canonical path from storageContract builders."
    );
  }
  return result;
}

export function validateStorageMetadataForPath(path = "", metadata = {}) {
  const rule = findRuleForPath(path);
  if (!rule) {
    return {
      ok: false,
      contract: "",
      missing: [],
    };
  }
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const missing = rule.requiredMetadata.filter((key) => !safeString(source?.[key], 200));
  return {
    ok: missing.length === 0,
    contract: rule.contract,
    missing,
  };
}

export function buildRequestAttachmentStoragePath({
  requestId = "",
  attachmentId = "",
  fileName = "",
  contentType = "",
} = {}) {
  const rid = normalizeSegment(requestId, "request");
  const aid = normalizeSegment(attachmentId, "attachment");
  const safeFileName = buildStorageFileName({
    originalName: fileName,
    contentType,
    fallbackBase: "document",
  });
  return `requests/${rid}/attachments/${aid}/${Date.now()}_${safeFileName}`;
}

export function buildChatAttachmentStoragePath({
  requestId = "",
  fromRole = "",
  attachmentKind = "",
  fileName = "",
  contentType = "",
} = {}) {
  const rid = normalizeSegment(requestId, "request");
  const role = normalizeSegment(fromRole || "user", "user");
  const kind = normalizeSegment(attachmentKind || "document", "document");
  const safeFileName = buildStorageFileName({
    originalName: fileName,
    contentType,
    fallbackBase: kind === "photo" || kind === "image" ? "image" : "document",
  });
  return `requests/${rid}/chat/${role}/${kind}/${Date.now()}_${safeFileName}`;
}

export function buildSelfHelpDocumentStoragePath({
  uid = "",
  track = "",
  country = "",
  recordId = "",
  fileName = "",
  contentType = "",
} = {}) {
  const userSeg = normalizeSegment(uid, "user");
  const trackSeg = normalizeSegment(track, "track");
  const countrySeg = normalizeSegment(country, "country");
  const docSeg = normalizeSegment(recordId, "document");
  const safeFileName = buildStorageFileName({
    originalName: fileName,
    contentType,
    fallbackBase: "document",
  });
  return `users/${userSeg}/self_help/${trackSeg}/${countrySeg}/${docSeg}/${Date.now()}_${safeFileName}`;
}

export function buildProfileImageStoragePath({
  uid = "",
  fileName = "",
  contentType = "",
} = {}) {
  const userSeg = normalizeSegment(uid, "user");
  const safeFileName = buildStorageFileName({
    originalName: fileName,
    contentType,
    fallbackBase: "avatar",
  });
  return `users/${userSeg}/profile/avatar/${Date.now()}_${safeFileName}`;
}

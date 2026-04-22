import { ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase";
import {
  getFallbackStorageProvider,
  getStorageProvider,
  getSupabaseBucket,
  getSupabaseClient,
} from "./storageProvider";
import {
  assertStoragePathContract,
  buildStorageFileName,
  validateStorageMetadataForPath,
} from "./storageContract";

function safeStr(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function normalizePathSegment(value, fallback = "file") {
  const cleaned = safeStr(value, 120)
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9._/-]+/g, "_")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return cleaned || fallback;
}

export function buildSafeUploadFileName({
  originalName = "",
  contentType = "",
  fallbackBase = "file",
} = {}) {
  return buildStorageFileName({
    originalName,
    contentType,
    fallbackBase,
  });
}

function sanitizeMetadata(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  Object.entries(input).forEach(([key, value]) => {
    const safeKey = safeStr(key, 80);
    const safeValue = safeStr(value, 260);
    if (!safeKey || !safeValue) return;
    out[safeKey] = safeValue;
  });
  return out;
}

async function uploadWithFirebase({
  file,
  path,
  contentType,
  cacheControl,
  customMetadata,
} = {}) {
  const objectRef = ref(storage, path);
  const uploadResult = await uploadBytes(objectRef, file, {
    contentType: safeStr(contentType, 120) || safeStr(file?.type, 120) || "application/octet-stream",
    cacheControl: safeStr(cacheControl, 160),
    customMetadata: sanitizeMetadata(customMetadata),
  });
  const metadata = uploadResult.metadata || {};
  return {
    provider: "firebase",
    storageKind: "bucket",
    bucket: safeStr(metadata.bucket, 200),
    path: safeStr(metadata.fullPath, 500) || path,
    contentType: safeStr(metadata.contentType, 120) || safeStr(file?.type, 120),
    sizeBytes: Number(metadata.size || file?.size || 0) || 0,
    checksum: safeStr(metadata.md5Hash, 120),
    generation: safeStr(metadata.generation, 80),
  };
}

async function uploadWithSupabase({
  file,
  path,
  contentType,
  cacheControl,
  customMetadata,
} = {}) {
  const supabase = getSupabaseClient({ throwOnMissing: true });
  const bucket = getSupabaseBucket();
  const upload = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: safeStr(contentType, 120) || safeStr(file?.type, 120) || "application/octet-stream",
    cacheControl: safeStr(cacheControl, 160),
    metadata: sanitizeMetadata(customMetadata),
  });
  if (upload?.error) {
    throw new Error(upload.error.message || "Supabase upload failed.");
  }

  const metadata = upload?.data || {};
  return {
    provider: "supabase",
    storageKind: "bucket",
    bucket: safeStr(bucket, 200),
    path: safeStr(metadata?.path, 500) || path,
    contentType: safeStr(contentType, 120) || safeStr(file?.type, 120),
    sizeBytes: Number(file?.size || 0) || 0,
    checksum: safeStr(metadata?.id || "", 120),
    generation: safeStr(metadata?.fullPath || metadata?.path || "", 80),
  };
}

async function uploadViaProvider(provider, options) {
  if (provider === "supabase") return uploadWithSupabase(options);
  return uploadWithFirebase(options);
}

export async function uploadBinaryFile({
  file,
  storagePath = "",
  contentType = "",
  cacheControl = "public,max-age=3600",
  customMetadata = {},
} = {}) {
  if (!(file instanceof Blob)) {
    throw new Error("uploadBinaryFile requires a Blob/File.");
  }
  const rawPath = normalizePathSegment(storagePath, "");
  if (!rawPath) {
    throw new Error("uploadBinaryFile requires a canonical storagePath.");
  }
  const contractState = assertStoragePathContract(rawPath);
  const metadata = sanitizeMetadata(customMetadata);
  const metadataState = validateStorageMetadataForPath(rawPath, metadata);
  if (!metadataState.ok) {
    throw new Error(
      `Missing required storage metadata for ${contractState.contract}: ${metadataState.missing.join(", ")}`
    );
  }

  const path = contractState.path;
  const primaryProvider = getStorageProvider();
  const fallbackProvider = getFallbackStorageProvider(primaryProvider);
  const uploadInput = {
    file,
    path,
    contentType,
    cacheControl,
    customMetadata: metadata,
  };

  try {
    const result = await uploadViaProvider(primaryProvider, uploadInput);
    return {
      ...result,
      contract: contractState.contract,
    };
  } catch (error) {
    if (!fallbackProvider || fallbackProvider === primaryProvider) throw error;
    console.warn(
      `Primary upload via ${primaryProvider} failed; retrying with ${fallbackProvider}:`,
      error?.message || error
    );
    const result = await uploadViaProvider(fallbackProvider, uploadInput);
    return {
      ...result,
      contract: contractState.contract,
    };
  }
}

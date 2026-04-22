import { getDownloadURL, ref as firebaseStorageRef } from "firebase/storage";
import { storage } from "../firebase";
import { getSupabaseBucket, getSupabaseClient } from "./storageProvider";

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CACHE_SKEW_MS = 45 * 1000;
const urlCache = new Map();

function safeStr(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function isHttpUrl(value = "") {
  const clean = safeStr(value, 1200);
  return clean.startsWith("http://") || clean.startsWith("https://");
}

export function resolveExternalFileUrl(input = {}) {
  const candidates = [
    input?.externalUrl,
    input?.url,
    input?.downloadUrl,
    input?.fileUrl,
    input?.preview?.externalUrl,
    input?.storage?.externalUrl,
  ];
  for (const candidate of candidates) {
    const clean = safeStr(candidate, 1200);
    if (isHttpUrl(clean)) return clean;
  }
  return "";
}

export function getFileLocator(input = {}) {
  return {
    externalUrl: resolveExternalFileUrl(input),
    storageKind: safeStr(
      input?.storageKind || input?.preview?.storageKind || input?.storage?.kind,
      40
    ).toLowerCase(),
    storageBucket: safeStr(
      input?.storageBucket || input?.bucket || input?.preview?.storageBucket || input?.storage?.bucket,
      220
    ),
    storagePath: safeStr(
      input?.storagePath || input?.path || input?.preview?.storagePath || input?.storage?.path,
      520
    ),
    storageProvider: safeStr(
      input?.storageProvider || input?.provider || input?.preview?.storageProvider || input?.storage?.provider,
      40
    ).toLowerCase(),
  };
}

export function canResolveFileAccess(input = {}) {
  const locator = getFileLocator(input);
  return Boolean(locator.storagePath || locator.externalUrl);
}

function looksLikeSupabaseUrl(url = "") {
  return /supabase\.co\/storage\/v1\//i.test(safeStr(url, 1200));
}

function looksLikeFirebaseUrl(url = "") {
  return /firebasestorage|storage\.googleapis\.com|googleusercontent/i.test(safeStr(url, 1200));
}

function inferProvider(locator = {}) {
  const explicit = safeStr(locator?.storageProvider, 40).toLowerCase();
  if (explicit === "supabase" || explicit === "firebase") return explicit;

  const bucket = safeStr(locator?.storageBucket, 220);
  const externalUrl = safeStr(locator?.externalUrl, 1200);
  const supabaseBucket = safeStr(getSupabaseBucket(), 220);

  if (bucket && supabaseBucket && bucket === supabaseBucket) return "supabase";
  if (looksLikeSupabaseUrl(externalUrl)) return "supabase";
  if (bucket && bucket !== supabaseBucket) return "firebase";
  if (looksLikeFirebaseUrl(externalUrl)) return "firebase";
  return "";
}

function cacheKeyFor(locator = {}, provider = "") {
  return [
    safeStr(provider, 40),
    safeStr(locator?.storageBucket, 220),
    safeStr(locator?.storagePath, 520),
  ].join("::");
}

function readCachedUrl(locator = {}, provider = "") {
  const key = cacheKeyFor(locator, provider);
  if (!key || key === "::") return "";
  const cached = urlCache.get(key);
  if (!cached) return "";
  if (Number(cached.expiresAtMs || 0) <= Date.now() + CACHE_SKEW_MS) {
    urlCache.delete(key);
    return "";
  }
  return safeStr(cached.url, 1200);
}

function writeCachedUrl(locator = {}, provider = "", url = "", expiresAtMs = 0) {
  const key = cacheKeyFor(locator, provider);
  const cleanUrl = safeStr(url, 1200);
  if (!key || key === "::" || !cleanUrl) return;
  urlCache.set(key, {
    url: cleanUrl,
    expiresAtMs: safeNum(expiresAtMs, Date.now() + 5 * 60 * 1000),
  });
}

export async function resolveFileAccessUrl(input = {}, { ttlSeconds = SIGNED_URL_TTL_SECONDS } = {}) {
  const locator = getFileLocator(input);
  if (!locator.storagePath) return locator.externalUrl;

  const provider = inferProvider(locator);
  const cachedUrl = readCachedUrl(locator, provider);
  if (cachedUrl) return cachedUrl;

  if (provider === "supabase") {
    const bucket = locator.storageBucket || getSupabaseBucket();
    const supabase = getSupabaseClient({ throwOnMissing: true });
    const safeTtl = Math.max(60, Math.min(24 * 60 * 60, safeNum(ttlSeconds, SIGNED_URL_TTL_SECONDS)));
    const signed = await supabase.storage.from(bucket).createSignedUrl(locator.storagePath, safeTtl);
    if (signed?.error) {
      if (locator.externalUrl) return locator.externalUrl;
      throw new Error(signed.error.message || "Failed to create Supabase signed URL.");
    }
    const signedUrl = safeStr(signed?.data?.signedUrl, 1200);
    if (!signedUrl) {
      if (locator.externalUrl) return locator.externalUrl;
      return "";
    }
    writeCachedUrl(locator, provider, signedUrl, Date.now() + safeTtl * 1000);
    return signedUrl;
  }

  if (provider === "firebase") {
    const durableUrl = await getDownloadURL(firebaseStorageRef(storage, locator.storagePath));
    writeCachedUrl(locator, provider, durableUrl, Date.now() + 12 * 60 * 60 * 1000);
    return safeStr(durableUrl, 1200);
  }

  return locator.externalUrl;
}

export function buildFileAccessSignature(input = {}) {
  const locator = getFileLocator(input);
  return [
    safeStr(locator.externalUrl, 1200),
    safeStr(locator.storageKind, 40),
    safeStr(locator.storageBucket, 220),
    safeStr(locator.storagePath, 520),
    safeStr(locator.storageProvider, 40),
  ].join("|");
}

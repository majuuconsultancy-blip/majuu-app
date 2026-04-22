import { createClient } from "@supabase/supabase-js";

function safeStr(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 60) {
  return safeStr(value, max).toLowerCase();
}

function normalizeProvider(value = "") {
  const clean = lower(value, 30);
  if (clean === "supabase" || clean === "firebase") return clean;
  return "";
}

const STORAGE_PROVIDER = normalizeProvider(import.meta.env.VITE_STORAGE_PROVIDER || "supabase");
const STORAGE_FALLBACK_PROVIDER = normalizeProvider(
  import.meta.env.VITE_STORAGE_FALLBACK_PROVIDER || "firebase"
);
const SUPABASE_URL = safeStr(import.meta.env.VITE_SUPABASE_URL, 600);
const SUPABASE_ANON_KEY = safeStr(import.meta.env.VITE_SUPABASE_ANON_KEY, 1200);
const SUPABASE_STORAGE_BUCKET =
  safeStr(import.meta.env.VITE_SUPABASE_STORAGE_BUCKET, 180) || "majuu-files";

let supabaseClient = null;

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function getStorageProvider() {
  if (STORAGE_PROVIDER === "supabase") {
    if (hasSupabaseConfig()) return "supabase";
    return "firebase";
  }
  if (STORAGE_PROVIDER === "firebase") return "firebase";
  if (hasSupabaseConfig()) return "supabase";
  return "firebase";
}

export function getFallbackStorageProvider(primaryProvider = "") {
  const primary = normalizeProvider(primaryProvider) || getStorageProvider();
  if (STORAGE_FALLBACK_PROVIDER && STORAGE_FALLBACK_PROVIDER !== primary) {
    if (STORAGE_FALLBACK_PROVIDER === "supabase" && !hasSupabaseConfig()) {
      return primary === "firebase" ? "" : "firebase";
    }
    return STORAGE_FALLBACK_PROVIDER;
  }
  if (primary === "supabase") return "firebase";
  if (hasSupabaseConfig()) return "supabase";
  return "";
}

export function getSupabaseBucket() {
  return SUPABASE_STORAGE_BUCKET;
}

export function getSupabaseClient({ throwOnMissing = false } = {}) {
  if (supabaseClient) return supabaseClient;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (throwOnMissing) {
      throw new Error("Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }
    return null;
  }
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return supabaseClient;
}

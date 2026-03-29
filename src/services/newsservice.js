import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import {
  APP_DESTINATION_COUNTRIES,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import {
  normalizeNewsSourceType,
  normalizeNewsTag,
} from "../constants/news";
import { getCurrentUserRoleContext } from "./adminroleservice";
import { logManagerModuleActivity } from "./managerservice";
import { managerHasModuleAccess } from "./managerModules";

const NEWS_COLLECTION = "news";

function safeString(value, max = 5000) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safeParagraphText(value, max = 10000) {
  return String(value || "").trim().replace(/\r\n/g, "\n").slice(0, max);
}

function toBoundedNumber(value, fallback = 0, min = 0, max = 100) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeSourceLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Source link must start with http or https.");
    }
    return url.toString();
  } catch {
    throw new Error("Enter a valid source link.");
  }
}

function normalizeTagsInput(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => item.trim());

  const seen = new Set();
  return parts
    .map((item) => normalizeNewsTag(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function toTimestampMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  const seconds = Number(value?.seconds || 0);
  const nanoseconds = Number(value?.nanoseconds || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const extraMs = Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0;
  return seconds * 1000 + extraMs;
}

function baseNewsShape(input = {}) {
  return {
    title: safeString(input.title, 140),
    summary: safeParagraphText(input.summary, 600),
    content: safeParagraphText(input.content, 12000),
    whyThisMatters: safeParagraphText(input.whyThisMatters, 1200),
    trackType: normalizeTrackType(input.trackType),
    country: normalizeDestinationCountry(input.country) || APP_DESTINATION_COUNTRIES[0],
    tags: normalizeTagsInput(input.tags),
    sourceName: safeString(input.sourceName, 120),
    sourceType: normalizeNewsSourceType(input.sourceType),
    sourceLink: normalizeSourceLink(input.sourceLink),
    importanceScore: toBoundedNumber(input.importanceScore, 50, 0, 100),
    isBreaking: normalizeBoolean(input.isBreaking),
    isPublished: normalizeBoolean(input.isPublished),
  };
}

function validateNewsPayload(payload) {
  if (!payload.title) throw new Error("Title is required.");
  if (!payload.summary) throw new Error("Summary is required.");
  if (!payload.whyThisMatters) throw new Error("Why this matters is required.");
  if (!payload.sourceName) throw new Error("Source name is required.");
}

function normalizeNewsRecord(id, raw = {}) {
  const createdAtMs =
    Number(raw?.createdAtMs || 0) || toTimestampMs(raw?.createdAt) || Number(raw?.updatedAtMs || 0);
  const updatedAtMs = Number(raw?.updatedAtMs || 0) || toTimestampMs(raw?.updatedAt) || createdAtMs;

  return {
    id: String(id || "").trim(),
    title: safeString(raw?.title, 140),
    summary: safeParagraphText(raw?.summary, 600),
    content: safeParagraphText(raw?.content, 12000),
    whyThisMatters: safeParagraphText(raw?.whyThisMatters, 1200),
    trackType: normalizeTrackType(raw?.trackType),
    country: normalizeDestinationCountry(raw?.country) || APP_DESTINATION_COUNTRIES[0],
    tags: normalizeTagsInput(raw?.tags),
    sourceName: safeString(raw?.sourceName, 120),
    sourceType: normalizeNewsSourceType(raw?.sourceType),
    sourceLink: String(raw?.sourceLink || "").trim(),
    importanceScore: toBoundedNumber(raw?.importanceScore, 50, 0, 100),
    isBreaking: normalizeBoolean(raw?.isBreaking),
    isPublished: normalizeBoolean(raw?.isPublished),
    createdAt: raw?.createdAt || null,
    updatedAt: raw?.updatedAt || null,
    createdAtMs,
    updatedAtMs,
  };
}

function compareByImportanceThenRecency(a, b) {
  const importanceGap = Number(b?.importanceScore || 0) - Number(a?.importanceScore || 0);
  if (importanceGap !== 0) return importanceGap;

  const freshnessGap = Number(b?.updatedAtMs || b?.createdAtMs || 0) - Number(a?.updatedAtMs || a?.createdAtMs || 0);
  if (freshnessGap !== 0) return freshnessGap;

  return String(a?.title || "").localeCompare(String(b?.title || ""));
}

async function requireNewsActor() {
  const uid = String(auth.currentUser?.uid || "").trim();
  if (!uid) throw new Error("You must be signed in.");
  const roleCtx = await getCurrentUserRoleContext(uid);
  const canAccess =
    Boolean(roleCtx?.isSuperAdmin) ||
    (Boolean(roleCtx?.isManager) &&
      managerHasModuleAccess(roleCtx?.managerScope, "news"));
  if (!canAccess) {
    throw new Error("You do not have access to the News module.");
  }
  return roleCtx;
}

async function logNewsManagerActivity(action, details = "", metadata = {}) {
  try {
    await logManagerModuleActivity({
      moduleKey: "news",
      action,
      details,
      metadata,
    });
  } catch {
    // non-blocking
  }
}

export function createEmptyNewsDraft({ trackType = "", country = "" } = {}) {
  return {
    title: "",
    summary: "",
    content: "",
    whyThisMatters: "",
    trackType: normalizeTrackType(trackType || "study"),
    country: normalizeDestinationCountry(country) || APP_DESTINATION_COUNTRIES[0],
    tagsInput: "",
    sourceName: "",
    sourceType: "official",
    sourceLink: "",
    importanceScore: 70,
    isBreaking: false,
    isPublished: true,
  };
}

export function draftFromNewsItem(item) {
  const clean = normalizeNewsRecord(item?.id, item || {});
  return {
    title: clean.title,
    summary: clean.summary,
    content: clean.content,
    whyThisMatters: clean.whyThisMatters,
    trackType: clean.trackType,
    country: clean.country,
    tagsInput: clean.tags.join(", "),
    sourceName: clean.sourceName,
    sourceType: clean.sourceType,
    sourceLink: clean.sourceLink,
    importanceScore: clean.importanceScore,
    isBreaking: clean.isBreaking,
    isPublished: clean.isPublished,
  };
}

export function toNewsPayload(input = {}) {
  const payload = baseNewsShape({
    ...input,
    tags: input?.tags ?? input?.tagsInput ?? [],
  });
  validateNewsPayload(payload);
  return payload;
}

export function sortNewsItemsByPriority(items = []) {
  return [...items].sort(compareByImportanceThenRecency);
}

export function pickBreakingNewsItem(items = []) {
  const sortedBreaking = sortNewsItemsByPriority(items).filter((item) => item.isBreaking);
  return sortedBreaking[0] || null;
}

export function getNewsTimestampMs(item) {
  return Number(item?.updatedAtMs || item?.createdAtMs || 0);
}

export function getImpactLabel(item) {
  const score = Number(item?.importanceScore || 0);
  if (item?.isBreaking) return "Critical";
  if (score >= 85) return "High Impact";
  if (score >= 65) return "Important";
  if (score >= 40) return "Watch";
  return "";
}

export function subscribePublishedNews({ trackType, country, onData, onError }) {
  const safeTrack = normalizeTrackType(trackType);
  const safeCountry = normalizeDestinationCountry(country) || APP_DESTINATION_COUNTRIES[0];
  const newsQuery = query(collection(db, NEWS_COLLECTION), where("isPublished", "==", true));

  return onSnapshot(
    newsQuery,
    (snapshot) => {
      const items = snapshot.docs
        .map((row) => normalizeNewsRecord(row.id, row.data() || {}))
        .filter((item) => item.trackType === safeTrack && item.country === safeCountry);

      onData?.(sortNewsItemsByPriority(items));
    },
    (error) => {
      console.error("published news subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function listPublishedNews({ trackType, country }) {
  const safeTrack = normalizeTrackType(trackType);
  const safeCountry = normalizeDestinationCountry(country) || APP_DESTINATION_COUNTRIES[0];
  const snapshot = await getDocs(
    query(collection(db, NEWS_COLLECTION), where("isPublished", "==", true))
  );

  const items = snapshot.docs
    .map((row) => normalizeNewsRecord(row.id, row.data() || {}))
    .filter((item) => item.trackType === safeTrack && item.country === safeCountry);

  return sortNewsItemsByPriority(items);
}

export function subscribeAllNews({ onData, onError }) {
  return onSnapshot(
    collection(db, NEWS_COLLECTION),
    (snapshot) => {
      const items = snapshot.docs.map((row) => normalizeNewsRecord(row.id, row.data() || {}));
      onData?.(sortNewsItemsByPriority(items));
    },
    (error) => {
      console.error("news admin subscription failed:", error);
      onError?.(error);
    }
  );
}

export async function createNewsItem(input = {}) {
  const actor = await requireNewsActor();

  const payload = toNewsPayload(input);
  const nowMs = Date.now();
  const ref = doc(collection(db, NEWS_COLLECTION));

  await setDoc(ref, {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  });

  if (actor?.isManager) {
    await logNewsManagerActivity("news_item_created", payload.title, {
      newsId: ref.id,
      trackType: payload.trackType,
      country: payload.country,
    });
  }

  return ref.id;
}

export async function updateNewsItem(newsId, input = {}) {
  const actor = await requireNewsActor();

  const safeId = String(newsId || "").trim();
  if (!safeId) throw new Error("Missing news item id.");

  const payload = toNewsPayload(input);
  await updateDoc(doc(db, NEWS_COLLECTION, safeId), {
    ...payload,
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  });

  if (actor?.isManager) {
    await logNewsManagerActivity("news_item_updated", payload.title, {
      newsId: safeId,
      trackType: payload.trackType,
      country: payload.country,
    });
  }
}

export async function setNewsPublishedState(newsId, isPublished) {
  const actor = await requireNewsActor();

  const safeId = String(newsId || "").trim();
  if (!safeId) throw new Error("Missing news item id.");

  await updateDoc(doc(db, NEWS_COLLECTION, safeId), {
    isPublished: normalizeBoolean(isPublished),
    updatedAt: serverTimestamp(),
    updatedAtMs: Date.now(),
  });

  if (actor?.isManager) {
    await logNewsManagerActivity(
      normalizeBoolean(isPublished) ? "news_item_published" : "news_item_unpublished",
      "",
      { newsId: safeId }
    );
  }
}

export async function deleteNewsItem(newsId) {
  const actor = await requireNewsActor();

  const safeId = String(newsId || "").trim();
  if (!safeId) throw new Error("Missing news item id.");

  await deleteDoc(doc(db, NEWS_COLLECTION, safeId));
  if (actor?.isManager) {
    await logNewsManagerActivity("news_item_deleted", "", { newsId: safeId });
  }
}

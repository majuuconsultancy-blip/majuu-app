import { useMemo } from "react";

import en from "../locales/en.json";
import sw from "../locales/sw.json";
import { userProfileStore, useUserProfileStore } from "../services/userProfileStore";
import { normalizeProfileLanguage } from "../utils/userProfile";

const translations = {
  en,
  sw,
};

function safeKey(value) {
  return String(value || "").trim();
}

function resolveLanguage(language) {
  return normalizeProfileLanguage(language, "en") || "en";
}

function translate(key, language) {
  const safeTranslationKey = safeKey(key);
  if (!safeTranslationKey) return "";

  const activeLanguage = resolveLanguage(language);
  const activeDictionary = translations[activeLanguage] || translations.en;
  const englishDictionary = translations.en || {};

  return (
    activeDictionary?.[safeTranslationKey] ||
    englishDictionary?.[safeTranslationKey] ||
    safeTranslationKey
  );
}

export function getCurrentLanguage() {
  return resolveLanguage(userProfileStore.getState()?.profile?.language);
}

export function t(key) {
  return translate(key, getCurrentLanguage());
}

export function useI18n() {
  const language = useUserProfileStore((snapshot) =>
    resolveLanguage(snapshot?.profile?.language)
  );

  return useMemo(
    () => ({
      language,
      t: (key) => translate(key, language),
    }),
    [language]
  );
}

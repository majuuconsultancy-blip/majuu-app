import { normalizeText } from "./textNormalizer";

export function safeText(value) {
  if (!value) return "";
  return normalizeText(String(value));
}

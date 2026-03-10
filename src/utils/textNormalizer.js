export function normalizeText(text) {
  if (!text || typeof text !== "string") return text;

  const fixes = {
    "â€™": "’",
    "â€œ": "“",
    "â€": "”",
    "â€“": "–",
    "â€”": "—",
    "â€¢": "•",
    "Ã©": "é",
    "Ã¨": "è",
    "Ã¡": "á",
    "Ã ": "à",
    "Ã¶": "ö",
    "Ã¼": "ü",
    "Ã±": "ñ",

    // Common mojibake variants also seen in app text.
    "â€¦": "…",
    "âœ…": "✅",
    "Â·": "·",
    "Ã—": "×",
    "Ã¢Å“â€¦": "✅",
    "Ã°Å¸â€œÅ½": "📎",
  };

  let cleaned = text;

  Object.keys(fixes).forEach((broken) => {
    cleaned = cleaned.replaceAll(broken, fixes[broken]);
  });

  return cleaned.normalize("NFC");
}

export function normalizeTextDeep(value) {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeTextDeep(item));
  if (!value || typeof value !== "object") return value;

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;

  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = normalizeTextDeep(value[key]);
  });
  return out;
}

export function normalizeText(text) {
  if (!text || typeof text !== "string") return text;

  const fixes = {
    "â€™": "'",
    "â€œ": "\"",
    "â€": "\"",
    "â€“": "-",
    "â€”": "-",
    "â€¢": " - ",
    "â€¦": "...",
    "Ã©": "é",
    "Ã¨": "è",
    "Ã¡": "á",
    "Ã ": "à",
    "Ã¶": "ö",
    "Ã¼": "ü",
    "Ã±": "ñ",

    // Double-encoded variants seen in stored content.
    "Ã¢â‚¬â„¢": "'",
    "Ã¢â‚¬Å“": "\"",
    "Ã¢â‚¬Â": "\"",
    "Ã¢â‚¬â€œ": "-",
    "Ã¢â‚¬â€": "-",
    "Ã¢â‚¬Â¢": " - ",
    "Ã¢â‚¬Â¦": "...",
    "ÃƒÂ©": "é",
    "ÃƒÂ¨": "è",
    "ÃƒÂ¡": "á",
    "Ãƒ ": "à",
    "ÃƒÂ¶": "ö",
    "ÃƒÂ¼": "ü",
    "ÃƒÂ±": "ñ",
    "Ã‚Â·": " - ",
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

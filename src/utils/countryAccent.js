const DEFAULT_COUNTRY_ACCENT = "#0f766e";

function safeString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

export function normalizeHexColor(value, fallback = "") {
  const raw = safeString(value, 32).replace(/[^#a-fA-F0-9]/g, "");
  if (!raw) return safeString(fallback, 32);

  const prefixed = raw.startsWith("#") ? raw : `#${raw}`;
  const shortHex = /^#([0-9a-fA-F]{3})$/.exec(prefixed);
  if (shortHex) {
    const expanded = shortHex[1]
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded}`.toUpperCase();
  }

  if (/^#([0-9a-fA-F]{6})$/.test(prefixed)) {
    return prefixed.toUpperCase();
  }

  return safeString(fallback, 32);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex, DEFAULT_COUNTRY_ACCENT);
  if (!normalized) return { r: 15, g: 118, b: 110 };

  const clean = normalized.slice(1);
  return {
    r: Number.parseInt(clean.slice(0, 2), 16),
    g: Number.parseInt(clean.slice(2, 4), 16),
    b: Number.parseInt(clean.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function getCountryAccentPalette(accentColor = "") {
  const base = normalizeHexColor(accentColor, DEFAULT_COUNTRY_ACCENT) || DEFAULT_COUNTRY_ACCENT;
  return {
    base,
    soft: rgba(base, 0.1),
    softStrong: rgba(base, 0.16),
    border: rgba(base, 0.28),
    borderStrong: rgba(base, 0.44),
    rail: rgba(base, 0.78),
    text: rgba(base, 0.94),
    shadow: rgba(base, 0.12),
    glow: rgba(base, 0.18),
  };
}

export function buildCountryAccentSurfaceStyle(accentColor = "", { strong = false } = {}) {
  const palette = getCountryAccentPalette(accentColor);
  return {
    borderColor: strong ? palette.borderStrong : palette.border,
    backgroundImage: `linear-gradient(135deg, ${
      strong ? palette.softStrong : palette.soft
    } 0%, rgba(255, 255, 255, 0) 58%)`,
    boxShadow: `0 14px 34px ${palette.shadow}`,
  };
}

export function buildCountryAccentRailStyle(accentColor = "") {
  const palette = getCountryAccentPalette(accentColor);
  return {
    backgroundColor: palette.rail,
  };
}

export function buildCountryAccentBadgeStyle(accentColor = "", { strong = false } = {}) {
  const palette = getCountryAccentPalette(accentColor);
  return {
    borderColor: strong ? palette.borderStrong : palette.border,
    backgroundColor: strong ? palette.softStrong : palette.soft,
    color: palette.text,
  };
}

export function buildCountryAccentTextStyle(accentColor = "") {
  const palette = getCountryAccentPalette(accentColor);
  return {
    color: palette.text,
  };
}

function getCountryKeys(country = {}) {
  const name = safeString(country?.name, 120).toLowerCase();
  const code = safeString(country?.code, 12).toLowerCase();
  return [name, code].filter(Boolean);
}

export function resolveCountryAccentColor(countryMap, countryName = "", fallback = "") {
  const map = countryMap instanceof Map ? countryMap : new Map();
  const key = safeString(countryName, 120).toLowerCase();
  const row = map.get(key) || null;
  return normalizeHexColor(row?.accentColor, fallback || DEFAULT_COUNTRY_ACCENT) || DEFAULT_COUNTRY_ACCENT;
}

export function buildCountryLookupMap(countries = []) {
  const rows = Array.isArray(countries) ? countries : [];
  const map = new Map();

  rows.forEach((country) => {
    getCountryKeys(country).forEach((key) => {
      if (!map.has(key)) {
        map.set(key, country);
      }
    });
  });

  return map;
}

export { DEFAULT_COUNTRY_ACCENT };

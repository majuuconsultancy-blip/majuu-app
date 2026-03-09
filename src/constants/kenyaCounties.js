export const KENYA_COUNTIES = [
  "Baringo",
  "Bomet",
  "Bungoma",
  "Busia",
  "Elgeyo-Marakwet",
  "Embu",
  "Garissa",
  "Homa Bay",
  "Isiolo",
  "Kajiado",
  "Kakamega",
  "Kericho",
  "Kiambu",
  "Kilifi",
  "Kirinyaga",
  "Kisii",
  "Kisumu",
  "Kitui",
  "Kwale",
  "Laikipia",
  "Lamu",
  "Machakos",
  "Makueni",
  "Mandera",
  "Marsabit",
  "Meru",
  "Migori",
  "Mombasa",
  "Murang'a",
  "Nairobi",
  "Nakuru",
  "Nandi",
  "Narok",
  "Nyamira",
  "Nyandarua",
  "Nyeri",
  "Samburu",
  "Siaya",
  "Taita-Taveta",
  "Tana River",
  "Tharaka-Nithi",
  "Trans Nzoia",
  "Turkana",
  "Uasin Gishu",
  "Vihiga",
  "Wajir",
  "West Pokot",
];

export const KENYA_COUNTY_OPTIONS = [...KENYA_COUNTIES].sort((a, b) => a.localeCompare(b));

export function normalizeCountyName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const found = KENYA_COUNTIES.find((county) => county.toLowerCase() === raw.toLowerCase());
  return found || raw;
}

export function normalizeCountyLower(value) {
  return normalizeCountyName(value).toLowerCase();
}

export function normalizeCountyList(values) {
  const arr = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  for (const value of arr) {
    const normalized = normalizeCountyName(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= 47) break;
  }
  return out;
}

export function normalizeCountyLowerList(values) {
  return normalizeCountyList(values).map((county) => county.toLowerCase());
}

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

// Lightweight nearby-county presets used by Admin Assign flows for faster coverage setup.
export const KENYA_COUNTY_NEIGHBORS = {
  Baringo: ["Elgeyo-Marakwet", "Uasin Gishu", "Nakuru", "Laikipia", "Samburu", "Turkana", "West Pokot"],
  Bomet: ["Kericho", "Narok", "Kisii", "Nyamira", "Nakuru"],
  Bungoma: ["Busia", "Kakamega", "Trans Nzoia", "West Pokot"],
  Busia: ["Bungoma", "Kakamega", "Siaya"],
  "Elgeyo-Marakwet": ["Uasin Gishu", "Baringo", "West Pokot", "Trans Nzoia"],
  Embu: ["Kirinyaga", "Tharaka-Nithi", "Kitui", "Machakos"],
  Garissa: ["Tana River", "Isiolo", "Wajir", "Lamu", "Kitui"],
  "Homa Bay": ["Migori", "Kisii", "Nyamira", "Siaya"],
  Isiolo: ["Marsabit", "Samburu", "Laikipia", "Meru", "Garissa", "Wajir"],
  Kajiado: ["Nairobi", "Machakos", "Makueni", "Narok", "Taita-Taveta"],
  Kakamega: ["Bungoma", "Busia", "Vihiga", "Nandi", "Siaya", "Trans Nzoia"],
  Kericho: ["Bomet", "Nandi", "Kisumu", "Nyamira", "Nakuru", "Narok", "Uasin Gishu"],
  Kiambu: ["Nairobi", "Murang'a", "Nyandarua", "Nakuru", "Machakos", "Kajiado"],
  Kilifi: ["Mombasa", "Kwale", "Tana River", "Taita-Taveta"],
  Kirinyaga: ["Nyeri", "Murang'a", "Embu", "Machakos"],
  Kisii: ["Nyamira", "Migori", "Homa Bay", "Narok", "Bomet"],
  Kisumu: ["Siaya", "Vihiga", "Nandi", "Kericho", "Nyamira", "Homa Bay"],
  Kitui: ["Machakos", "Makueni", "Tana River", "Garissa", "Embu", "Tharaka-Nithi"],
  Kwale: ["Mombasa", "Kilifi", "Taita-Taveta", "Lamu"],
  Laikipia: ["Samburu", "Isiolo", "Meru", "Nyeri", "Nakuru", "Baringo"],
  Lamu: ["Tana River", "Garissa", "Kilifi", "Kwale"],
  Machakos: ["Nairobi", "Kiambu", "Kajiado", "Makueni", "Kitui", "Embu", "Kirinyaga"],
  Makueni: ["Machakos", "Kajiado", "Taita-Taveta", "Kitui", "Tana River"],
  Mandera: ["Wajir", "Marsabit", "Garissa"],
  Marsabit: ["Mandera", "Wajir", "Isiolo", "Samburu", "Turkana"],
  Meru: ["Tharaka-Nithi", "Embu", "Isiolo", "Laikipia", "Nyeri"],
  Migori: ["Homa Bay", "Kisii", "Narok"],
  Mombasa: ["Kwale", "Kilifi"],
  "Murang'a": ["Kiambu", "Nyeri", "Kirinyaga", "Nyandarua"],
  Nairobi: ["Kiambu", "Machakos", "Kajiado"],
  Nakuru: ["Laikipia", "Nyandarua", "Kericho", "Bomet", "Narok", "Baringo", "Kiambu"],
  Nandi: ["Uasin Gishu", "Kakamega", "Vihiga", "Kisumu", "Kericho", "Baringo"],
  Narok: ["Kajiado", "Nakuru", "Bomet", "Kisii", "Migori"],
  Nyamira: ["Kisii", "Bomet", "Kericho", "Kisumu", "Homa Bay"],
  Nyandarua: ["Nakuru", "Laikipia", "Nyeri", "Murang'a", "Kiambu"],
  Nyeri: ["Laikipia", "Meru", "Kirinyaga", "Murang'a", "Nyandarua"],
  Samburu: ["Turkana", "Marsabit", "Isiolo", "Laikipia", "Baringo"],
  Siaya: ["Busia", "Kakamega", "Vihiga", "Kisumu", "Homa Bay"],
  "Taita-Taveta": ["Makueni", "Kajiado", "Kwale", "Kilifi", "Tana River"],
  "Tana River": ["Garissa", "Lamu", "Kilifi", "Kitui", "Makueni", "Taita-Taveta"],
  "Tharaka-Nithi": ["Meru", "Embu", "Kitui"],
  "Trans Nzoia": ["West Pokot", "Uasin Gishu", "Elgeyo-Marakwet", "Bungoma", "Kakamega"],
  Turkana: ["West Pokot", "Samburu", "Marsabit", "Baringo"],
  "Uasin Gishu": ["Elgeyo-Marakwet", "Baringo", "Nandi", "Trans Nzoia", "Kericho"],
  Vihiga: ["Kakamega", "Nandi", "Kisumu", "Siaya"],
  Wajir: ["Mandera", "Marsabit", "Isiolo", "Garissa"],
  "West Pokot": ["Turkana", "Baringo", "Elgeyo-Marakwet", "Trans Nzoia", "Bungoma"],
};

export function getNearbyCountySuggestions(primaryCounty, selectedCounties = []) {
  const root = normalizeCountyName(primaryCounty);
  if (!root) return [];

  const selectedSet = new Set(normalizeCountyList(selectedCounties).map((county) => county.toLowerCase()));
  const candidates = Array.isArray(KENYA_COUNTY_NEIGHBORS[root]) ? KENYA_COUNTY_NEIGHBORS[root] : [];

  return normalizeCountyList(candidates).filter((county) => !selectedSet.has(county.toLowerCase()));
}

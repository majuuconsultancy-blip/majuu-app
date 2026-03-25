import {
  normalizeProfileLanguage,
  normalizeProfileName,
  normalizeUserProfile,
} from "./userProfile";

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeName(name) {
  return normalizeProfileName(name, 80);
}

// Returns normalized +254XXXXXXXXX if Kenya, otherwise returns trimmed input
export function normalizePhoneByResidence(countryOfResidence, phoneRaw) {
  const residence = String(countryOfResidence || "").trim();

  if (residence === "Kenya") {
    const digits = onlyDigits(phoneRaw);

    let local = digits;

    // accept +254..., 254..., 07..., 7...
    if (local.startsWith("254")) local = local.slice(3);
    if (local.startsWith("0")) local = local.slice(1);

    local = local.slice(-9);

    if (!/^(7|1)\d{8}$/.test(local)) return ""; // invalid
    return `+254${local}`;
  }

  const clean = String(phoneRaw || "").trim();
  if (!clean) return "";

  // basic sanity for non-Kenya
  if (onlyDigits(clean).length < 8) return "";
  return clean;
}

export function getMissingProfileFields(userState) {
  const missing = [];
  const profile = normalizeUserProfile(userState);

  const name = normalizeName(userState?.name);
  const residence = String(profile?.homeCountry || userState?.countryOfResidence || "").trim();
  const language = normalizeProfileLanguage(profile?.language, "");

  if (!name) missing.push("Name");

  if (!residence) missing.push("Country of Residence");

  if (!language) missing.push("Language");

  return missing;
}

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
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

  const name = normalizeName(userState?.name);
  const residence = String(userState?.countryOfResidence || "").trim();
  const phoneRaw = String(userState?.phone || "").trim();

  // Name: required + >= 3
  if (!name) missing.push("Full Name");
  else if (name.length < 3) missing.push("Full Name (min 3 letters)");

  // Residence required
  if (!residence) missing.push("Country of Residence");

  // Phone required + strict if Kenya
  if (!phoneRaw) {
    missing.push("Phone / WhatsApp");
  } else {
    const normalized = normalizePhoneByResidence(residence, phoneRaw);

    if (!normalized) {
      if (residence === "Kenya") {
        missing.push("Phone / WhatsApp (Kenya: +254 + 9 digits)");
      } else {
        missing.push("Phone / WhatsApp (invalid)");
      }
    }
  }

  return missing;
}
export function getMissingProfileFields(userState) {
  const missing = [];

  if (!String(userState?.name || "").trim()) missing.push("Full Name");
  if (!String(userState?.phone || "").trim()) missing.push("Phone / WhatsApp");
  if (!String(userState?.countryOfResidence || "").trim())
    missing.push("Country of Residence");

  return missing;
}
function safeStr(value) {
  return String(value || "").trim();
}

export function isSystemChatMessage(message) {
  const type = safeStr(message?.type).toLowerCase();
  const fromRole = safeStr(message?.fromRole).toLowerCase();
  return type === "system" || fromRole === "system";
}

export function getSystemChatMessageLabel(message, viewerRole = "user") {
  const kind = safeStr(message?.systemKind).toLowerCase();
  const role = safeStr(viewerRole).toLowerCase();

  if (kind === "request_reassigned") {
    return role === "user" ? "Reassigned" : "Reassigned to new staff";
  }

  if (kind === "request_unassigned") {
    return role === "user" ? "Reassigned" : "Unassigned from staff";
  }

  return safeStr(message?.text) || "System update";
}


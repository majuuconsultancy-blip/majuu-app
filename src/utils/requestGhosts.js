function safeString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

export function isUnsubmittedGhostRequest(request) {
  const status = safeString(request?.status, 40).toLowerCase();
  const submissionState = safeString(request?.submissionState, 40).toLowerCase();
  const draftLifecycle = safeString(request?.draftLifecycle, 40).toLowerCase();

  if (status === "draft") return true;
  if (submissionState === "draft") return true;
  if (draftLifecycle) return true;

  return Boolean(
    request?.draftResumeState ||
      request?.draftFlowType ||
      request?.draftRoutePath ||
      request?.draftRouteSearch ||
      request?.draftLastSavedStep ||
      request?.draftRequestId
  );
}

export function filterVisibleSubmittedRequests(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => !isUnsubmittedGhostRequest(row));
}

export function extractRequestIdFromAppPath(pathname) {
  const raw = safeString(pathname, 400);
  const match = raw.match(/^\/app\/request\/([^/?#]+)/i);
  if (!match?.[1]) return "";

  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return String(match[1]).trim();
  }
}

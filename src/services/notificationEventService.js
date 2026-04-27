import { apiRequest } from "./apiService";

function safeStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

export async function emitNotificationEvent(event, payload = {}) {
  const safeEvent = safeStr(event, 80);
  if (!safeEvent) return { ok: false, skipped: true, reason: "missing_event" };

  return apiRequest(
    "/api/notification-event",
    {
      method: "POST",
      body: {
        event: safeEvent,
        payload: payload && typeof payload === "object" ? payload : {},
      },
    },
    "Notification event failed."
  );
}

export function notifyRequestSubmitted({ requestId }) {
  const safeRequestId = safeStr(requestId, 180);
  if (!safeRequestId) {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_request_id" });
  }
  return emitNotificationEvent("request_submitted", { requestId: safeRequestId });
}

export function notifyMessageCreated({ requestId, messageId, status }) {
  const safeRequestId = safeStr(requestId, 180);
  const safeMessageId = safeStr(messageId, 180);
  const safeStatus = safeStr(status, 40).toLowerCase();
  if (!safeRequestId || !safeMessageId || !safeStatus) {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_message_fields" });
  }
  return emitNotificationEvent("message_created", {
    requestId: safeRequestId,
    messageId: safeMessageId,
    status: safeStatus,
  });
}

export function notifyRequestStartedWork({ requestId }) {
  const safeRequestId = safeStr(requestId, 180);
  if (!safeRequestId) {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_request_id" });
  }
  return emitNotificationEvent("request_started_work", { requestId: safeRequestId });
}

export function notifyProgressUpdated({ requestId, updateId }) {
  const safeRequestId = safeStr(requestId, 180);
  const safeUpdateId = safeStr(updateId, 180);
  if (!safeRequestId || !safeUpdateId) {
    return Promise.resolve({ ok: false, skipped: true, reason: "missing_progress_fields" });
  }
  return emitNotificationEvent("progress_updated", {
    requestId: safeRequestId,
    updateId: safeUpdateId,
  });
}

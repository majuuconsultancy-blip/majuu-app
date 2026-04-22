import { useEffect, useMemo, useState } from "react";
import {
  buildRequestDefinitionKey,
  fetchRequestDefinitionByKey,
} from "../services/requestDefinitionService";
import DocumentExtractPanel from "./DocumentExtractPanel";
import DocumentProofreadPanel from "./DocumentProofreadPanel";
import FileAccessLink from "./FileAccessLink";
import { canResolveFileAccess } from "../services/fileAccessService";

function safeStr(value, max = 600) {
  return String(value ?? "").trim().slice(0, max);
}

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function bytesToLabel(bytes) {
  const size = Number(bytes || 0);
  if (size <= 0) return "0 KB";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round((size / 1024 / 1024) * 10) / 10} MB`;
}

function attachmentStatusLabel(status) {
  const clean = safeStr(status, 60).toLowerCase();
  if (clean === "pending_upload") return "Pending upload";
  if (clean === "uploaded") return "Uploaded";
  if (clean === "approved") return "Approved";
  if (clean === "rejected") return "Rejected";
  if (!clean) return "Saved";
  return clean
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function normalizeDocumentAnswer(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const type = safeStr(entry?.type, 30).toLowerCase();
  if (type !== "document") return null;

  const id = safeStr(entry?.id, 80);
  const label = safeStr(entry?.label, 160) || id || "Document";

  return {
    id,
    label,
    required: Boolean(entry?.required),
    sortOrder: toNum(entry?.sortOrder, 0),
  };
}

function normalizeAttachment(raw, fallbackId = "") {
  const entry = raw && typeof raw === "object" ? raw : {};
  const id = safeStr(entry?.id || fallbackId, 160);
  const name = safeStr(entry?.name || entry?.filename, 180) || "Document";
  const contentType = safeStr(entry?.contentType || entry?.type, 80) || "application/pdf";

  return {
    id,
    name,
    size: toNum(entry?.size, 0),
    contentType,
    status: safeStr(entry?.status, 60),
    url: safeStr(entry?.url || entry?.downloadUrl || entry?.fileUrl, 1200),
    storageKind: safeStr(entry?.storageKind, 40).toLowerCase(),
    storageBucket: safeStr(entry?.storageBucket || entry?.bucket, 220),
    storagePath: safeStr(entry?.storagePath || entry?.path, 520),
    storageProvider: safeStr(entry?.storageProvider || entry?.provider, 40).toLowerCase(),
    fieldId: safeStr(entry?.fieldId, 80),
    fieldLabel: safeStr(entry?.fieldLabel || entry?.label, 160),
    label: safeStr(entry?.label, 160),
    kind: safeStr(entry?.kind, 80),
    metaNote: safeStr(entry?.metaNote || entry?.note, 800),
    raw: entry,
  };
}

function sortByOrderThenLabel(left, right) {
  const orderGap = toNum(left?.sortOrder, 0) - toNum(right?.sortOrder, 0);
  if (orderGap !== 0) return orderGap;
  return safeStr(left?.label, 160).localeCompare(safeStr(right?.label, 160));
}

function buildKeyFromRequest(extra, request) {
  const meta = extra && typeof extra === "object" ? extra : {};
  const req = request && typeof request === "object" ? request : {};

  const directKey = safeStr(meta?.definitionKey, 240);
  if (directKey) return directKey;

  const title =
    safeStr(meta?.title, 160) ||
    safeStr(req?.serviceName, 160) ||
    safeStr(req?.fullPackageItem, 160);

  const trackType = safeStr(meta?.trackType, 20) || safeStr(req?.track, 20);
  const country = safeStr(meta?.country, 80) || safeStr(req?.country, 80);

  return buildRequestDefinitionKey({ title, trackType, country });
}

function buildSignature(item) {
  return `${safeStr(item?.name, 180).toLowerCase()}|${toNum(item?.size, 0)}`;
}

function isExtraFieldAttachment(item) {
  const kind = safeStr(item?.kind, 80).toLowerCase();
  return Boolean(
    safeStr(item?.fieldId, 80) ||
      safeStr(item?.fieldLabel || item?.label, 160) ||
      kind === "extra_field_document"
  );
}

function matchesField(item, fieldId, label) {
  const itemFieldId = safeStr(item?.fieldId, 80);
  const itemFieldLabel = safeStr(item?.fieldLabel || item?.label, 160).toLowerCase();
  const normalizedFieldId = safeStr(fieldId, 80);
  const normalizedLabel = safeStr(label, 160).toLowerCase();

  if (normalizedFieldId && itemFieldId && itemFieldId === normalizedFieldId) return true;
  if (normalizedLabel && itemFieldLabel && itemFieldLabel === normalizedLabel) return true;
  return false;
}

function mergeItems({ attachments }) {
  const merged = [];
  const seen = new Set();

  (Array.isArray(attachments) ? attachments : []).forEach((attachment, index) => {
    const signature = `${attachment.id || index}|${buildSignature(attachment)}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    merged.push({
      id: attachment.id || `attachment-${index}`,
      name: attachment.name,
      size: attachment.size,
      type: attachment.contentType,
      status: attachmentStatusLabel(attachment.status),
      statusTone: attachment.status ? "attachment" : "neutral",
      url: attachment.url,
      storageKind: attachment.storageKind,
      storageBucket: attachment.storageBucket,
      storagePath: attachment.storagePath,
      storageProvider: attachment.storageProvider,
      metaNote: attachment.metaNote,
      source: "attachment",
      attachment,
    });
  });

  return merged;
}

function renderTypeLabel(type) {
  const clean = safeStr(type, 80);
  if (!clean) return "PDF";
  if (clean === "application/pdf") return "PDF";
  if (clean === "link") return "Link";
  return clean;
}

export default function RequestDocumentFieldsSection({
  request,
  requestId = "",
  title = "Document fields",
  className = "",
  showHeader = true,
  viewerRole = "user",
  attachments = null,
  attachmentsLoading = false,
  attachmentsError = "",
} = {}) {
  const extra =
    request?.extraFieldAnswers &&
    typeof request.extraFieldAnswers === "object" &&
    !Array.isArray(request.extraFieldAnswers)
      ? request.extraFieldAnswers
      : null;

  const documentAnswers = useMemo(() => {
    const list = Array.isArray(extra?.answers) ? extra.answers : [];
    return list.map(normalizeDocumentAnswer).filter(Boolean).sort(sortByOrderThenLabel);
  }, [extra]);

  const definitionKey = useMemo(() => buildKeyFromRequest(extra, request), [extra, request]);
  const [definitionState, setDefinitionState] = useState(() => ({
    key: "",
    row: null,
  }));

  useEffect(() => {
    let cancelled = false;

    if (!definitionKey) return undefined;

    fetchRequestDefinitionByKey(definitionKey)
      .then((row) => {
        if (cancelled) return;
        setDefinitionState({ key: definitionKey, row: row || null });
      })
      .catch((error) => {
        if (cancelled) return;
        const code = safeStr(error?.code, 80).toLowerCase();
        if (code && code !== "permission-denied") {
          console.warn("request document schema lookup failed:", error?.message || error);
        }
        setDefinitionState({ key: definitionKey, row: null });
      });

    return () => {
      cancelled = true;
    };
  }, [definitionKey]);

  const resolvedRequestId = safeStr(requestId || request?.id, 120);

  const effectiveDefinition =
    definitionKey && definitionState.key === definitionKey ? definitionState.row : null;
  const effectiveDefinitionLoading =
    Boolean(definitionKey) && definitionState.key !== definitionKey;

  const normalizedAttachments = useMemo(() => {
    if (!Array.isArray(attachments)) return [];
    return attachments
      .map((item, index) => normalizeAttachment(item, `attachment-${index}`))
      .filter(Boolean);
  }, [attachments]);

  const effectiveLoading = Boolean(attachmentsLoading);
  const effectiveError = safeStr(attachmentsError, 300);

  const { groups, totalActiveAttachments } = useMemo(() => {
    const answerById = new Map();
    documentAnswers.forEach((answer) => {
      if (!answer?.id) return;
      answerById.set(answer.id, answer);
    });

    const schemaFields = Array.isArray(effectiveDefinition?.extraFields)
      ? effectiveDefinition.extraFields
          .filter(
            (field) =>
              field?.isActive !== false && safeStr(field?.type, 30).toLowerCase() === "document"
          )
          .sort((left, right) => toNum(left?.sortOrder, 0) - toNum(right?.sortOrder, 0))
      : [];

    const matchedAttachmentIds = new Set();
    const seenGroupIds = new Set();
    const nextGroups = [];

    const attachForField = (fieldId, label) =>
      normalizedAttachments.filter((attachment) => {
        if (!attachment?.id || matchedAttachmentIds.has(attachment.id)) return false;
        if (!matchesField(attachment, fieldId, label)) return false;
        matchedAttachmentIds.add(attachment.id);
        return true;
      });

    schemaFields.forEach((field) => {
      const fieldId = safeStr(field?.id, 80);
      if (!fieldId) return;

      const label = safeStr(field?.label, 160) || fieldId;
      const answer = answerById.get(fieldId) || null;

      nextGroups.push({
        id: fieldId,
        label,
        required: Boolean(field?.required),
        sortOrder: toNum(field?.sortOrder, answer?.sortOrder ?? 0),
        items: mergeItems({
          attachments: attachForField(fieldId, label),
        }),
      });
      seenGroupIds.add(fieldId);
    });

    documentAnswers
      .filter((answer) => !seenGroupIds.has(answer.id))
      .forEach((answer) => {
        nextGroups.push({
          id: answer.id || `answer-${answer.label}`,
          label: answer.label,
          required: Boolean(answer.required),
          sortOrder: toNum(answer.sortOrder, 0),
          items: mergeItems({
            attachments: attachForField(answer.id, answer.label),
          }),
        });
        if (answer.id) seenGroupIds.add(answer.id);
      });

    normalizedAttachments
      .filter((attachment) => attachment?.id && !matchedAttachmentIds.has(attachment.id))
      .filter(isExtraFieldAttachment)
      .forEach((attachment) => {
        matchedAttachmentIds.add(attachment.id);
        const groupId =
          safeStr(attachment.fieldId, 80) ||
          safeStr(attachment.fieldLabel || attachment.label, 160) ||
          attachment.id;
        const groupLabel =
          safeStr(attachment.fieldLabel || attachment.label, 160) || "Document";

        nextGroups.push({
          id: groupId,
          label: groupLabel,
          required: false,
          sortOrder: Number.MAX_SAFE_INTEGER,
          items: mergeItems({ attachments: [attachment] }),
        });
      });

    const otherAttachments = normalizedAttachments
      .filter((attachment) => !matchedAttachmentIds.has(attachment.id))
      .filter((attachment) => !isExtraFieldAttachment(attachment));
    if (otherAttachments.length > 0) {
      nextGroups.push({
        id: "other_documents",
        label: "Other documents",
        required: false,
        sortOrder: Number.MAX_SAFE_INTEGER,
        items: mergeItems({ attachments: otherAttachments }),
      });
    }

    return {
      groups: nextGroups.sort(sortByOrderThenLabel),
      totalActiveAttachments: normalizedAttachments.length,
    };
  }, [effectiveDefinition, documentAnswers, normalizedAttachments]);

  const shouldRender =
    groups.length > 0 || effectiveLoading || Boolean(effectiveError) || effectiveDefinitionLoading;

  if (!shouldRender) return null;

  const wrapperCls =
    className ||
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4";
  const canUseReviewTools = viewerRole === "admin" || viewerRole === "staff";
  const visibleAttachmentCount = totalActiveAttachments;

  return (
    <div className={wrapperCls}>
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
            {title}
          </div>
          <div className="text-[11px] font-semibold text-zinc-400">
            {effectiveDefinitionLoading
              ? "Schema..."
              : `${visibleAttachmentCount} attachment${visibleAttachmentCount === 1 ? "" : "s"}`}
          </div>
        </div>
      ) : null}

      {canUseReviewTools && normalizedAttachments.length > 0 ? (
        <DocumentProofreadPanel
          requestId={resolvedRequestId}
          request={request}
          attachments={normalizedAttachments}
        />
      ) : null}

      {effectiveError ? (
        <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-sm text-rose-700">
          {effectiveError}
        </div>
      ) : null}

      <div className={`${showHeader ? "mt-3" : ""} grid gap-3`}>
        {groups.map((group) => {
          const hasItems = group.items.length > 0;

          return (
            <div
              key={group.id}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                    {group.label}
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {hasItems
                      ? `${group.items.length} file${group.items.length === 1 ? "" : "s"}`
                      : group.required
                      ? "Required document field"
                      : "Optional document field"}
                  </div>
                </div>
                <span
                  className={[
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold border",
                    hasItems
                      ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                      : "border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/80 text-zinc-600 dark:text-zinc-300",
                  ].join(" ")}
                >
                  {hasItems ? "Provided" : "Not provided"}
                </span>
              </div>

              {hasItems ? (
                <div className="mt-3 grid gap-2">
                  {group.items.map((item) => {
                    const toneCls =
                      item.statusTone === "attachment"
                        ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                        : "border-zinc-200 bg-zinc-50/80 text-zinc-700";

                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
                              {item.name}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                              {bytesToLabel(item.size)} · {renderTypeLabel(item.type)}
                            </div>
                            {item.metaNote ? (
                              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                                {item.metaNote}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneCls}`}>
                              {item.status}
                            </span>
                            {canResolveFileAccess(item) ? (
                              <FileAccessLink
                                file={item}
                                className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                              >
                                Open
                              </FileAccessLink>
                            ) : null}
                          </div>
                        </div>

                        {canUseReviewTools && item.attachment ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <DocumentExtractPanel
                              requestId={resolvedRequestId}
                              request={request}
                              attachment={item.attachment}
                              role={viewerRole}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                  No file saved for this document field.
                </div>
              )}
            </div>
          );
        })}
        {effectiveLoading && groups.length === 0 ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-3 text-sm text-zinc-600 dark:text-zinc-300">
            Loading document fields...
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  buildRequestDefinitionKey,
  fetchRequestDefinitionByKey,
} from "../services/requestDefinitionService";

function safeStr(value, max = 600) {
  return String(value ?? "").trim().slice(0, max);
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bytesToLabel(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return "0 KB";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
}

function normalizeFileMeta(input) {
  if (!input || typeof input !== "object") return null;
  const name = safeStr(input?.name, 140);
  if (!name) return null;
  return {
    name,
    size: toNum(input?.size, 0),
    type: safeStr(input?.type, 80),
    lastModified: toNum(input?.lastModified, 0),
  };
}

function normalizeAnswer(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const id = safeStr(entry?.id, 80);
  const label = safeStr(entry?.label, 160);
  const type = safeStr(entry?.type, 24).toLowerCase();
  const sortOrder = toNum(entry?.sortOrder, 0);
  const value = type === "document" ? "" : safeStr(entry?.value, 2200);
  const fileMetas = Array.isArray(entry?.fileMetas)
    ? entry.fileMetas.map(normalizeFileMeta).filter(Boolean)
    : [];

  const hasValue = Boolean(value);
  const hasDocs = fileMetas.length > 0;

  return {
    id,
    label: label || id,
    type: type || (hasDocs ? "document" : "text"),
    sortOrder,
    value,
    fileMetas,
    hasContent: hasValue || hasDocs,
  };
}

function sortByOrderThenLabel(left, right) {
  const gap = toNum(left?.sortOrder, 0) - toNum(right?.sortOrder, 0);
  if (gap !== 0) return gap;
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

export default function RequestExtraDetailsSection({
  request,
  title = "Extra details",
  className = "",
} = {}) {
  const extra =
    request?.extraFieldAnswers &&
    typeof request.extraFieldAnswers === "object" &&
    !Array.isArray(request.extraFieldAnswers)
      ? request.extraFieldAnswers
      : null;

  if (!extra) return null;
  const answers = useMemo(() => {
    const list = Array.isArray(extra?.answers) ? extra.answers : [];
    return list
      .map(normalizeAnswer)
      .filter((row) => row.id)
      .sort(sortByOrderThenLabel);
  }, [extra]);

  const definitionKey = useMemo(() => buildKeyFromRequest(extra, request), [extra, request]);
  const [definition, setDefinition] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!definitionKey) {
      setDefinition(null);
      setSchemaLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSchemaLoading(true);
    fetchRequestDefinitionByKey(definitionKey)
      .then((row) => {
        if (cancelled) return;
        setDefinition(row || null);
      })
      .catch((error) => {
        if (cancelled) return;
        const code = safeStr(error?.code, 60).toLowerCase();
        if (code && code !== "permission-denied") {
          console.warn("extra details schema lookup failed:", error?.message || error);
        }
        setDefinition(null);
      })
      .finally(() => {
        if (!cancelled) setSchemaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [definitionKey]);

  const rows = useMemo(() => {
    const answerById = new Map();
    answers.forEach((answer) => {
      if (!answer?.id) return;
      answerById.set(answer.id, answer);
    });

    const schemaFields = Array.isArray(definition?.extraFields) ? definition.extraFields : null;
    if (!schemaFields || schemaFields.length === 0) {
      return answers.filter((row) => row.hasContent);
    }

    const out = [];
    const seen = new Set();

    const sortedSchema = [...schemaFields].sort(
      (a, b) => toNum(a?.sortOrder, 0) - toNum(b?.sortOrder, 0)
    );

    sortedSchema.forEach((field) => {
      const fieldId = safeStr(field?.id, 80);
      if (!fieldId) return;

      const schemaLabel = safeStr(field?.label, 160) || fieldId;
      const schemaType = safeStr(field?.type, 24).toLowerCase();
      const isActive = field?.isActive !== false;
      const answer = answerById.get(fieldId) || null;

      if (answer && answer.hasContent) {
        out.push({
          ...answer,
          label: schemaLabel,
          sortOrder: toNum(field?.sortOrder, answer.sortOrder),
          type: answer.type || schemaType || "text",
        });
        seen.add(fieldId);
        return;
      }

      if (isActive && schemaType === "document") {
        out.push({
          id: fieldId,
          label: schemaLabel,
          type: "document",
          sortOrder: toNum(field?.sortOrder, 0),
          value: "",
          fileMetas: [],
          hasContent: true,
          isMissingDocument: true,
        });
      }
    });

    answers
      .filter((row) => row.hasContent && !seen.has(row.id))
      .sort(sortByOrderThenLabel)
      .forEach((row) => out.push(row));

    return out.sort(sortByOrderThenLabel);
  }, [answers, definition]);

  const shouldRender = rows.length > 0;
  if (!shouldRender) return null;

  const wrapperCls =
    className ||
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4";

  return (
    <div className={wrapperCls}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold tracking-normal text-zinc-500 dark:text-zinc-400">
          {title}
        </div>
        {schemaLoading ? (
          <div className="text-[11px] font-semibold text-zinc-400">Loading...</div>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3">
        {rows.map((row) => {
          const label = safeStr(row?.label, 160) || safeStr(row?.id, 80) || "Field";
          const type = safeStr(row?.type, 24).toLowerCase();
          const value = safeStr(row?.value, 2200);
          const fileMetas = Array.isArray(row?.fileMetas)
            ? row.fileMetas.map(normalizeFileMeta).filter(Boolean)
            : [];

          if (type === "document") {
            const uploaded = fileMetas.length > 0;
            const statusLabel = uploaded ? "Uploaded" : "Not provided";
            const summary = uploaded
              ? fileMetas.length === 1
                ? fileMetas[0].name
                : `${fileMetas.length} files`
              : "";

            return (
              <div key={row.id} className="grid gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm text-zinc-600 dark:text-zinc-300">{label}</div>
                  <div
                    className={[
                      "text-sm font-semibold text-right",
                      uploaded
                        ? "text-emerald-700 dark:text-emerald-200"
                        : "text-zinc-500 dark:text-zinc-400",
                    ].join(" ")}
                  >
                    {statusLabel}
                  </div>
                </div>

                {uploaded ? (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                    <div className="font-semibold break-words">{summary}</div>
                    {fileMetas.length > 1 ? (
                      <div className="mt-1 grid gap-1">
                        {fileMetas.slice(0, 6).map((meta, idx) => (
                          <div key={`${row.id}-${idx}`} className="flex justify-between gap-3">
                            <span className="min-w-0 break-words">{meta.name}</span>
                            <span className="shrink-0 text-zinc-500">{bytesToLabel(meta.size)}</span>
                          </div>
                        ))}
                        {fileMetas.length > 6 ? (
                          <div className="text-zinc-500">+{fileMetas.length - 6} more</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-1 text-zinc-500">{bytesToLabel(fileMetas[0]?.size)}</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <div key={row.id} className="flex items-start justify-between gap-3">
              <div className="text-sm text-zinc-600 dark:text-zinc-300">{label}</div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 text-right whitespace-pre-wrap break-words">
                {value || "-"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

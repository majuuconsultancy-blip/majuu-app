import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Copy,
  FileCheck2,
  RefreshCw,
  X,
} from "lucide-react";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  buildNameUniformityProofread,
  getExtractsByAttachmentIds,
} from "../services/documentExtractService";
import AppIcon from "./AppIcon";

function safeStr(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

async function copyText(value) {
  const text = String(value || "");
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

function statusMeta(status) {
  if (status === "uniform") {
    return {
      label: "Uniform",
      className:
        "inline-flex rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-900",
      icon: CheckCircle2,
    };
  }

  if (status === "mismatch") {
    return {
      label: "Mismatch",
      className:
        "inline-flex rounded-full border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-[11px] font-semibold text-rose-800",
      icon: AlertTriangle,
    };
  }

  return {
    label: "Missing Name",
    className:
      "inline-flex rounded-full border border-zinc-200 bg-zinc-50/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700",
    icon: CircleDashed,
  };
}

function summaryBadge(status) {
  if (status === "attention") {
    return {
      label: "Needs attention",
      className:
        "inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50/70 px-2.5 py-1 text-[11px] font-semibold text-rose-800",
      icon: AlertTriangle,
    };
  }
  if (status === "partial") {
    return {
      label: "Partial",
      className:
        "inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900",
      icon: CircleDashed,
    };
  }
  if (status === "insufficient_data") {
    return {
      label: "No data yet",
      className:
        "inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-700",
      icon: CircleDashed,
    };
  }
  return {
    label: "Looks good",
    className:
      "inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-900",
    icon: CheckCircle2,
  };
}

export default function DocumentProofreadPanel({
  requestId,
  request,
  attachments = [],
}) {
  const canPortal = typeof document !== "undefined";
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const attachmentCount = Array.isArray(attachments) ? attachments.length : 0;
  const canRun = Boolean(safeStr(requestId, 120) && attachmentCount > 0);
  const badge = summaryBadge(report?.summaryStatus);

  const reportText = useMemo(() => {
    if (!report) return "";
    const lines = [
      "DOCUMENT PROOFREAD (DUMMY)",
      `Baseline name: ${report.baselineName || "N/A"}`,
      `Total docs: ${report.totalDocs}`,
      `Checked docs: ${report.checkedDocs}`,
      `Uniform: ${report.uniformCount}`,
      `Mismatch: ${report.mismatchCount}`,
      `Missing: ${report.missingCount}`,
      "",
      "Per document:",
    ];

    report.rows.forEach((row) => {
      const rowName = row.extractedName || "(missing)";
      lines.push(`- ${row.attachmentName}: ${row.status} | ${rowName}`);
    });

    return lines.join("\n");
  }, [report]);

  async function runProofread() {
    if (!canRun) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const attachmentIds = attachments
        .map((attachment) => safeStr(attachment?.id || attachment?.attachmentId, 120))
        .filter(Boolean);
      const extractsByAttachmentId = await getExtractsByAttachmentIds(requestId, attachmentIds);
      const nextReport = buildNameUniformityProofread({
        attachments,
        extractsByAttachmentId,
        request,
      });
      setReport(nextReport);
    } catch (e) {
      console.error("proofread error:", e);
      setError(e?.message || "Failed to run proofread.");
    } finally {
      setLoading(false);
    }
  }

  async function onOpen() {
    setModalOpen(true);
    await runProofread();
  }

  async function onCopyReport() {
    const ok = await copyText(reportText);
    if (!ok) {
      setError("Could not copy proofread report.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          disabled={!canRun}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
        >
          <AppIcon icon={FileCheck2} size={ICON_SM} className="text-emerald-700" />
          Documents proofread
        </button>

        {report ? (
          <span className={badge.className}>
            <AppIcon icon={badge.icon} size={ICON_SM} />
            {badge.label}
          </span>
        ) : null}
      </div>

      {canPortal && modalOpen
        ? createPortal(
            <div className="fixed inset-0 z-[85] p-3 sm:p-5">
              <button
                type="button"
                aria-label="Close proofread modal"
                onClick={() => setModalOpen(false)}
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] t-fade"
              />

              <div className="relative mx-auto flex h-[min(92vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl t-pop">
                <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Documents proofread (dummy)
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Cross-checks extracted names only. This is a helper, not OCR validation.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-2 text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-50 active:scale-[0.99]"
                  >
                    <AppIcon icon={X} size={ICON_MD} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-5">
                  {loading ? (
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-3 text-sm text-zinc-600 dark:text-zinc-300">
                      Running proofread...
                    </div>
                  ) : null}

                  {!loading && report ? (
                    <>
                      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/40 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={badge.className}>
                            <AppIcon icon={badge.icon} size={ICON_SM} />
                            {badge.label}
                          </span>
                          <span className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                            Baseline: {report.baselineName || "N/A"}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                          {report.summaryLine}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-300 sm:grid-cols-4">
                          <div>Total: {report.totalDocs}</div>
                          <div>Checked: {report.checkedDocs}</div>
                          <div>Uniform: {report.uniformCount}</div>
                          <div>Mismatch: {report.mismatchCount}</div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2">
                        {report.rows.map((row) => {
                          const meta = statusMeta(row.status);
                          return (
                            <div
                              key={row.attachmentId || row.attachmentName}
                              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {row.attachmentName}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                                    {row.extractedName || "No extracted full name yet"}
                                  </div>
                                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {row.verdict}
                                  </div>
                                </div>
                                <span className={meta.className}>
                                  <AppIcon icon={meta.icon} size={ICON_SM} />
                                  {meta.label}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  {error ? (
                    <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={runProofread}
                      disabled={loading || !canRun}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                    >
                      <AppIcon icon={RefreshCw} size={ICON_SM} />
                      Run again
                    </button>

                    <button
                      type="button"
                      onClick={onCopyReport}
                      disabled={!report}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                    >
                      <AppIcon icon={copied ? CheckCircle2 : Copy} size={ICON_SM} className={copied ? "text-emerald-700" : ""} />
                      {copied ? "Copied report" : "Copy report"}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}


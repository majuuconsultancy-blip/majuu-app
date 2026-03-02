import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { onSnapshot } from "firebase/firestore";
import { BadgeCheck, Check, Copy, RotateCcw, Sparkles, X } from "lucide-react";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  createOrGetDraftExtract,
  getExtractRef,
  getTemplateFieldKeys,
  resetExtractToDraft,
  updateExtractFields,
} from "../services/documentExtractService";
import AppIcon from "./AppIcon";

const STATUS_META = {
  draft: {
    label: "Draft",
    className:
      "inline-flex rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900",
  },
  reviewed: {
    label: "Reviewed",
    className:
      "inline-flex rounded-full border border-sky-200 bg-sky-50/70 px-2.5 py-1 text-[11px] font-semibold text-sky-900",
  },
  approved: {
    label: "Approved",
    className:
      "inline-flex rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-900",
  },
};

const FIELD_LABELS = {
  fullName: "Full Name",
  idNumber: "ID Number",
  passportNumber: "Passport No",
  dob: "Date of Birth",
  phone: "Phone",
  email: "Email",
  address: "Address",
  nextOfKinName: "Next of Kin Name",
  nextOfKinPhone: "Next of Kin Phone",
  nationality: "Nationality",
  expiryDate: "Expiry Date",
  bankName: "Bank Name",
  accountNumber: "Account Number",
  period: "Statement Period",
  certificateName: "Certificate",
  issueDate: "Issue Date",
  notes: "Notes",
};

function safeStr(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function toFieldLabel(key) {
  const clean = safeStr(key, 80);
  if (!clean) return "Field";
  if (FIELD_LABELS[clean]) return FIELD_LABELS[clean];
  return clean
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

async function copyText(value) {
  const text = String(value ?? "");
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

function toPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

export default function DocumentExtractPanel({
  requestId,
  request,
  attachment,
  role = "staff",
}) {
  const attachmentId = safeStr(attachment?.id || attachment?.attachmentId, 120);
  const canRun = Boolean(safeStr(requestId, 120) && attachmentId);
  const canPortal = typeof document !== "undefined";

  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [extract, setExtract] = useState(null);
  const [draftFields, setDraftFields] = useState({});
  const [busyAction, setBusyAction] = useState("");
  const [panelError, setPanelError] = useState("");
  const [copiedToken, setCopiedToken] = useState("");

  useEffect(() => {
    setModalOpen(false);
    setExtract(null);
    setDraftFields({});
    setPanelError("");
    setBusyAction("");
    setCopiedToken("");
  }, [attachmentId, requestId]);

  useEffect(() => {
    if (!modalOpen || !canRun) return undefined;

    setLoading(true);
    setPanelError("");

    const unsub = onSnapshot(
      getExtractRef(requestId, attachmentId),
      (snap) => {
        const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        setExtract(data);
        setDraftFields(data?.fields || {});
        setLoading(false);
      },
      (error) => {
        console.error("document extract snapshot error:", error);
        setPanelError(error?.message || "Failed to load extract.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [modalOpen, canRun, requestId, attachmentId]);

  useEffect(() => {
    if (!modalOpen || typeof document === "undefined") return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [modalOpen]);

  useEffect(() => {
    if (!modalOpen || typeof window === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modalOpen]);

  const fieldKeys = useMemo(() => {
    const templateKeys = getTemplateFieldKeys(extract?.docType);
    const merged = new Set([
      ...templateKeys,
      ...Object.keys(extract?.fields || {}),
      ...Object.keys(draftFields || {}),
    ]);
    return Array.from(merged);
  }, [extract?.docType, extract?.fields, draftFields]);

  const status = safeStr(extract?.status, 24).toLowerCase() || "draft";
  const statusMeta = STATUS_META[status] || STATUS_META.draft;

  const methodLabel = safeStr(extract?.method, 40) || "template_v1";
  const docTypeLabel = safeStr(extract?.docType, 40) || "GENERIC";
  const highlights = Array.isArray(extract?.highlights) ? extract.highlights : [];
  const confidenceMap = extract?.confidence || {};

  const canEdit = Boolean(extract);

  const extractButtonLabel = extract ? "Extract details" : "Extract details";

  async function handleExtractClick() {
    if (!canRun) return;
    setModalOpen(true);
    setPanelError("");
    setBusyAction("create");
    try {
      await createOrGetDraftExtract(requestId, attachment, request, role);
    } catch (error) {
      console.error("createOrGetDraftExtract failed:", error);
      setPanelError(error?.message || "Failed to prepare extract draft.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleFieldBlur(fieldKey) {
    if (!canEdit) return;
    const nextValue = String(draftFields?.[fieldKey] ?? "");
    const prevValue = String(extract?.fields?.[fieldKey] ?? "");
    if (nextValue === prevValue) return;

    setPanelError("");
    setBusyAction(`save:${fieldKey}`);
    try {
      await updateExtractFields(
        requestId,
        attachmentId,
        { fields: { [fieldKey]: nextValue } },
        role
      );
    } catch (error) {
      console.error("updateExtractFields failed:", error);
      setPanelError(error?.message || "Failed to save field.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCopyField(fieldKey) {
    const ok = await copyText(draftFields?.[fieldKey] || "");
    if (!ok) {
      setPanelError("Copy failed for this field.");
      return;
    }
    setCopiedToken(fieldKey);
    window.setTimeout(() => setCopiedToken(""), 1200);
  }

  async function handleCopyAll() {
    const lines = fieldKeys.map((fieldKey) => {
      const value = String(draftFields?.[fieldKey] || "");
      return `${toFieldLabel(fieldKey)}: ${value}`;
    });
    const ok = await copyText(lines.join("\n"));
    if (!ok) {
      setPanelError("Copy all failed.");
      return;
    }
    setCopiedToken("all");
    window.setTimeout(() => setCopiedToken(""), 1200);
  }

  async function handleSetStatus(nextStatus) {
    if (!canEdit) return;
    setPanelError("");
    setBusyAction(`status:${nextStatus}`);
    try {
      await updateExtractFields(requestId, attachmentId, { status: nextStatus }, role);
    } catch (error) {
      console.error("status update failed:", error);
      setPanelError(error?.message || "Failed to update status.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleResetDraft() {
    if (!canRun) return;
    setPanelError("");
    setBusyAction("reset");
    try {
      await resetExtractToDraft(requestId, attachment, request, role);
    } catch (error) {
      console.error("resetExtractToDraft failed:", error);
      setPanelError(error?.message || "Failed to reset draft.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleExtractClick}
          disabled={!canRun || busyAction === "create"}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60"
        >
          {busyAction === "create" ? (
            <>
              <AppIcon icon={Sparkles} size={ICON_SM} className="animate-pulse text-emerald-700" />
              Preparing draft...
            </>
          ) : (
            <>
              <AppIcon icon={Sparkles} size={ICON_SM} className="text-emerald-700" />
              {extractButtonLabel}
            </>
          )}
        </button>
        {extract ? <span className={statusMeta.className}>{statusMeta.label}</span> : null}
        {panelError && !modalOpen ? (
          <span className="text-xs text-rose-700">{panelError}</span>
        ) : null}
      </div>
      {canPortal && modalOpen
        ? createPortal(
            <div className="fixed inset-0 z-[80] p-3 sm:p-5">
              <button
                type="button"
                aria-label="Close extract modal"
                onClick={() => setModalOpen(false)}
                className="absolute inset-0 bg-black/45 backdrop-blur-[2px] t-fade"
              />

              <div className="relative mx-auto flex h-[min(92vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl t-pop">
                <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      Extract details
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={statusMeta.className}>{statusMeta.label}</span>
                      <span className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                        method: {methodLabel}
                      </span>
                      <span className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                        {docTypeLabel}
                      </span>
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
                      Loading extract...
                    </div>
                  ) : null}

                  {!loading && !extract ? (
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-3 text-sm text-zinc-600 dark:text-zinc-300">
                      No extract draft yet.
                    </div>
                  ) : null}

                  {!loading && extract ? (
                    <>
                      {highlights.length > 0 ? (
                        <ul className="grid gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                          {highlights.map((item, idx) => (
                            <li key={`${item}-${idx}`} className="leading-relaxed">
                              {`\u2022 ${item}`}
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {fieldKeys.map((fieldKey) => {
                          const value = String(draftFields?.[fieldKey] || "");
                          const saving = busyAction === `save:${fieldKey}`;
                          const copied = copiedToken === fieldKey;
                          const confidence = toPercent(confidenceMap?.[fieldKey]);

                          return (
                            <div
                              key={fieldKey}
                              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                  {toFieldLabel(fieldKey)}
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleCopyField(fieldKey)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-50 active:scale-[0.99]"
                                >
                                  {copied ? (
                                    <>
                                      <AppIcon icon={Check} size={ICON_SM} className="text-emerald-700" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <AppIcon icon={Copy} size={ICON_SM} />
                                      Copy
                                    </>
                                  )}
                                </button>
                              </div>

                              <input
                                type="text"
                                value={value}
                                onChange={(e) =>
                                  setDraftFields((prev) => ({ ...prev, [fieldKey]: e.target.value }))
                                }
                                onBlur={() => handleFieldBlur(fieldKey)}
                                className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/40 px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-300/20"
                                placeholder={`Enter ${toFieldLabel(fieldKey).toLowerCase()}`}
                              />

                              <div className="mt-1.5 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                  Confidence: {confidence}%
                                </span>
                                {saving ? (
                                  <span className="text-[11px] font-semibold text-emerald-700">
                                    Saving...
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  {panelError ? (
                    <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
                      {panelError}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyAll}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99]"
                    >
                      {copiedToken === "all" ? (
                        <>
                          <AppIcon icon={Check} size={ICON_SM} className="text-emerald-700" />
                          Copied all
                        </>
                      ) : (
                        <>
                          <AppIcon icon={Copy} size={ICON_SM} />
                          Copy all
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetStatus("reviewed")}
                      disabled={busyAction.startsWith("status:") || status === "reviewed"}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-1.5 text-xs font-semibold text-sky-900 transition hover:bg-sky-100 active:scale-[0.99] disabled:opacity-60"
                    >
                      <AppIcon icon={Check} size={ICON_SM} />
                      Mark reviewed
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSetStatus("approved")}
                      disabled={busyAction.startsWith("status:") || status === "approved"}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60"
                    >
                      <AppIcon icon={BadgeCheck} size={ICON_SM} />
                      Approve
                    </button>

                    <button
                      type="button"
                      onClick={handleResetDraft}
                      disabled={busyAction === "reset"}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                    >
                      <AppIcon icon={RotateCcw} size={ICON_SM} />
                      {busyAction === "reset" ? "Resetting..." : "Reset draft"}
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

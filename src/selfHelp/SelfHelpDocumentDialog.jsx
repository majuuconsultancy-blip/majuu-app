import { useEffect, useState } from "react";
import { AnimatePresence, motion as Motion } from "../utils/motionproxy";
import { FileText, Upload, X } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";

const overlayMotion = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] } },
};

const panelMotion = {
  hidden: { opacity: 0, y: 10, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.16, ease: [0.2, 0.8, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    y: 6,
    scale: 0.99,
    transition: { duration: 0.1, ease: [0.2, 0.8, 0.2, 1] },
  },
};

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function buildInitialState(record, defaultStepId, defaultCategoryId) {
  return {
    id: safeString(record?.id, 240),
    category: safeString(record?.category, 40).toLowerCase() || safeString(defaultCategoryId, 40).toLowerCase(),
    documentType: safeString(record?.documentType, 80),
    stepId: safeString(record?.stepId, 80) || safeString(defaultStepId, 80),
    fileName: safeString(record?.fileName, 180),
    fileType: safeString(record?.fileType, 80),
    fileSize: Number(record?.fileSize || 0) || 0,
    externalUrl: safeString(
      record?.externalUrl || record?.url || record?.downloadUrl || record?.fileUrl,
      1200
    ),
    storageKind: safeString(record?.storageKind, 30).toLowerCase(),
    storageBucket: safeString(record?.storageBucket || record?.bucket, 160),
    storagePath: safeString(record?.storagePath || record?.path, 400),
    storageGeneration: safeString(record?.storageGeneration || record?.generation, 80),
    storageChecksum: safeString(record?.storageChecksum || record?.checksum, 120),
    storageProvider: safeString(record?.storageProvider || record?.provider, 40).toLowerCase(),
    notes: safeString(record?.notes, 1200),
    uploadFile: null,
  };
}

export default function SelfHelpDocumentDialog({
  open,
  record,
  categories,
  steps,
  defaultStepId,
  defaultCategoryId,
  saving,
  onClose,
  onSubmit,
}) {
  const [values, setValues] = useState(() =>
    buildInitialState(record, defaultStepId, defaultCategoryId)
  );

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !saving) onClose?.();
    };

    const onBack = (event) => {
      if (!saving) {
        event.preventDefault?.();
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("majuu:back", onBack);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("majuu:back", onBack);
    };
  }, [onClose, open, saving]);

  if (!open) return null;

  return (
    <AnimatePresence>
      {open ? (
        <Motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 app-overlay-safe"
          variants={overlayMotion}
          initial="hidden"
          animate="show"
          exit="exit"
        >
          <button
            type="button"
            aria-label="Close document dialog"
            className="absolute inset-0"
            onClick={() => !saving && onClose?.()}
          />

          <Motion.div
            className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-zinc-200 bg-white px-5 pb-5 pt-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 sm:mb-6 sm:rounded-[28px]"
            style={{
              height:
                "min(74vh, calc(var(--app-viewport-height) - var(--app-safe-top) - var(--app-safe-bottom) - 2rem))",
              maxHeight:
                "min(74vh, calc(var(--app-viewport-height) - var(--app-safe-top) - var(--app-safe-bottom) - 2rem))",
            }}
            variants={panelMotion}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-zinc-200 dark:bg-zinc-700 sm:hidden" />

            <button
              type="button"
              onClick={() => !saving && onClose?.()}
              className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-label="Close"
            >
              <AppIcon size={ICON_MD} icon={X} />
            </button>

            <div className="pr-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                <AppIcon size={ICON_SM} icon={FileText} />
                SelfHelp documents
              </div>
              <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {values.id ? "Edit document record" : "Add document record"}
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Upload the real file so your document stays available across request, profile, and admin views.
              </p>
            </div>

            <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Category</span>
                  <select
                    value={values.category}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, category: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                  >
                    <option value="">Choose category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Linked step</span>
                  <select
                    value={values.stepId}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, stepId: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                  >
                    <option value="">Not linked to a step</option>
                    {steps.map((step) => (
                      <option key={step.id} value={step.id}>
                        {step.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Document type</span>
                  <input
                    value={values.documentType}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, documentType: safeString(event.target.value, 80) }))
                    }
                    placeholder="Admission letter, visa approval, booking confirmation..."
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">File upload</span>
                  <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-zinc-950/40">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200">
                      <AppIcon size={ICON_SM} icon={Upload} />
                      Pick file
                      <input
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          setValues((current) => ({
                            ...current,
                            fileName: safeString(file.name, 180),
                            fileType: safeString(file.type, 80),
                            fileSize: Number(file.size || 0) || 0,
                            uploadFile: file,
                          }));
                        }}
                      />
                    </label>

                    {values.uploadFile ? (
                      <div className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        Ready to upload: {values.uploadFile.name}
                      </div>
                    ) : values.storagePath ? (
                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        Existing stored file will be kept unless you pick a replacement.
                      </div>
                    ) : null}

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input
                        value={values.fileName}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, fileName: safeString(event.target.value, 180) }))
                        }
                        placeholder="File name"
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                      />
                      <input
                        value={values.fileType}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, fileType: safeString(event.target.value, 80) }))
                        }
                        placeholder="File type"
                        className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                      />
                    </div>
                  </div>
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Notes</span>
                  <textarea
                    value={values.notes}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, notes: safeString(event.target.value, 1200) }))
                    }
                    rows={4}
                    placeholder="Optional notes about what this document confirms"
                    className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-900 outline-none ring-emerald-200 focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
                  />
                </label>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={saving || !values.category}
                onClick={() => onSubmit?.(values)}
                className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save document"}
              </button>
              <button
                type="button"
                onClick={() => !saving && onClose?.()}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </Motion.div>
        </Motion.div>
      ) : null}
    </AnimatePresence>
  );
}

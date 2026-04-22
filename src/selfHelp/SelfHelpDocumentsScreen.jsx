import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  FileText,
  GraduationCap,
  Pencil,
  Plane,
  Plus,
  Trash2,
} from "lucide-react";
import { motion as Motion } from "../utils/motionproxy";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { auth } from "../firebase";
import { SELF_HELP_TRACK_META } from "./selfHelpCatalog";
import {
  getJourneyDocumentCategories,
  getJourneyDocumentCategoryMeta,
  getJourneyStepById,
  getJourneyStepsForRoute,
} from "./selfHelpJourney";
import {
  buildSelfHelpDocumentsRouteTarget,
  buildSelfHelpRouteTarget,
} from "./selfHelpLinking";
import SelfHelpDocumentDialog from "./SelfHelpDocumentDialog";
import {
  cacheSelfHelpProgress,
  deleteSelfHelpDocumentRecord,
  getSelfHelpDocuments,
  getSelfHelpProgress,
  getSelfHelpRouteState,
  peekSelfHelpProgress,
  previewSelfHelpDocumentProgress,
  saveSelfHelpDocumentRecord,
} from "./selfHelpProgressStore";
import {
  mergeSelfHelpRuntimeResources,
  subscribeRuntimeSelfHelpResources,
} from "../services/selfHelpResourceService";
import { uploadBinaryFile } from "../services/fileUploadService";
import { buildSelfHelpDocumentStoragePath } from "../services/storageContract";
import { canResolveFileAccess } from "../services/fileAccessService";
import FileAccessLink from "../components/FileAccessLink";

const TRACK_ICONS = {
  study: GraduationCap,
  work: Briefcase,
  travel: Plane,
};

const pageMotion = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] },
  },
};

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function formatDate(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return "Just added";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function groupDocumentsByCategory(categories, documents) {
  const items = Array.isArray(documents) ? documents : [];
  return categories
    .map((category) => ({
      ...category,
      items: items.filter((item) => item.category === category.id),
    }))
    .filter((group) => group.items.length > 0);
}

export default function SelfHelpDocumentsScreen({ track }) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const country = safeString(params.get("country"), 80);
  const stepParam = safeString(params.get("step"), 80);
  const categoryParam = safeString(params.get("docCategory"), 40).toLowerCase();
  const createParam = params.get("create") === "1";
  const trackMeta = SELF_HELP_TRACK_META[track] || SELF_HELP_TRACK_META.study;
  const HeaderIcon = TRACK_ICONS[track] || GraduationCap;

  const [uid, setUid] = useState("");
  const [progress, setProgress] = useState(null);
  const [resourceRecords, setResourceRecords] = useState([]);
  const [statusMsg, setStatusMsg] = useState("");
  const [dialogState, setDialogState] = useState({
    open: false,
    record: null,
    defaultStepId: "",
    defaultCategoryId: "",
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const autoOpenedRef = useRef(false);

  const routeState = useMemo(
    () => getSelfHelpRouteState(progress, track, country),
    [country, progress, track]
  );
  const runtimeResources = useMemo(
    () => mergeSelfHelpRuntimeResources(resourceRecords),
    [resourceRecords]
  );
  const steps = useMemo(
    () => getJourneyStepsForRoute(track, country, runtimeResources),
    [country, runtimeResources, track]
  );
  const stepById = useMemo(
    () => new Map(steps.map((step) => [step.id, step])),
    [steps]
  );
  const categories = useMemo(() => getJourneyDocumentCategories(), []);
  const documents = useMemo(
    () => getSelfHelpDocuments(progress, track, country),
    [country, progress, track]
  );
  const groupedDocuments = useMemo(
    () => groupDocumentsByCategory(categories, documents),
    [categories, documents]
  );

  const preferredStep =
    getJourneyStepById(track, country, stepParam, runtimeResources) ||
    getJourneyStepById(track, country, routeState?.currentStepId || "", runtimeResources);
  const preferredCategoryId =
    categoryParam ||
    preferredStep?.documentCategoryId ||
    getJourneyDocumentCategoryMeta(categoryParam)?.id ||
    "";
  const linkedStepCount = new Set(documents.map((item) => item.stepId).filter(Boolean)).size;

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setProgress(peekSelfHelpProgress(user.uid));

      try {
        const nextProgress = await getSelfHelpProgress(user.uid);
        if (!active) return;
        setProgress(nextProgress);
      } catch (error) {
        console.error("SelfHelp documents load failed:", error);
        if (active) {
          setStatusMsg("We could not load your SelfHelp documents right now.");
        }
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [navigate]);

  useEffect(() => {
    if (!uid) return undefined;

    return subscribeRuntimeSelfHelpResources({
      onData: (rows) => {
        setResourceRecords(rows);
      },
      onError: (error) => {
        console.error("SelfHelp document resources load failed:", error);
      },
    });
  }, [uid]);

  useEffect(() => {
    if (!createParam || autoOpenedRef.current) return;
    if (!uid) return;

    autoOpenedRef.current = true;
    setDialogState({
      open: true,
      record: null,
      defaultStepId: preferredStep?.id || "",
      defaultCategoryId: preferredCategoryId || "",
    });
  }, [createParam, preferredCategoryId, preferredStep?.id, uid]);

  const backTarget = useMemo(
    () =>
      buildSelfHelpRouteTarget({
        track,
        country,
        sectionId: routeState?.lastExpandedSection || preferredStep?.categoryId || "",
        stepId: preferredStep?.id || routeState?.currentStepId || "",
      }),
    [country, preferredStep?.categoryId, preferredStep?.id, routeState?.currentStepId, routeState?.lastExpandedSection, track]
  );

  const goBack = () => {
    if (backTarget?.path) {
      navigate(`${backTarget.path}${backTarget.search || ""}`, {
        replace: true,
        state: backTarget.state,
      });
      return;
    }

    navigate(`/app/${track}/self-help`, { replace: true });
  };

  const openCreateDialog = (stepId = "", categoryId = "") => {
    setDialogState({
      open: true,
      record: null,
      defaultStepId: safeString(stepId, 80),
      defaultCategoryId: safeString(categoryId, 40).toLowerCase(),
    });
  };

  const openEditDialog = (record) => {
    setDialogState({
      open: true,
      record,
      defaultStepId: safeString(record?.stepId, 80),
      defaultCategoryId: safeString(record?.category, 40).toLowerCase(),
    });
  };

  const closeDialog = () => {
    setDialogState((current) => ({ ...current, open: false, record: null }));
  };

  const handleSave = async (values) => {
    if (!uid || !country) return;

    const resolvedId =
      safeString(values?.id, 240) ||
      `${track}::${country}::${Date.now()}::${Math.random().toString(36).slice(2, 8)}`;
    const step = stepById.get(safeString(values?.stepId, 80));
    let payload = {
      id: resolvedId,
      track,
      country,
      category: safeString(values?.category, 40).toLowerCase(),
      documentType: safeString(values?.documentType, 80),
      stepId: step?.id || safeString(values?.stepId, 80),
      stepTitle: step?.title || "",
      fileName: safeString(values?.fileName, 180),
      fileType: safeString(values?.fileType, 80),
      fileSize: Number(values?.fileSize || 0) || 0,
      externalUrl: safeString(values?.externalUrl, 1200),
      storageBucket: safeString(values?.storageBucket, 160),
      storagePath: safeString(values?.storagePath, 400),
      storageGeneration: safeString(values?.storageGeneration, 80),
      storageChecksum: safeString(values?.storageChecksum, 120),
      storageProvider: safeString(values?.storageProvider, 40).toLowerCase(),
      notes: safeString(values?.notes, 1200),
    };

    setSaving(true);
    setStatusMsg("");

    try {
      if (values?.uploadFile instanceof File) {
        const uploadResult = await uploadBinaryFile({
          file: values.uploadFile,
          storagePath: buildSelfHelpDocumentStoragePath({
            uid,
            track,
            country,
            recordId: resolvedId,
            fileName: values.uploadFile.name || payload.fileName || "document",
            contentType: values.uploadFile.type || payload.fileType || "application/octet-stream",
          }),
          contentType: values.uploadFile.type || payload.fileType || "application/octet-stream",
          customMetadata: {
            ownerUid: uid,
            source: "self_help",
            track: safeString(track, 20),
            country: safeString(country, 80),
            recordId: resolvedId,
          },
        });
        payload = {
          ...payload,
          fileName: safeString(values.uploadFile.name || payload.fileName, 180),
          fileType: safeString(uploadResult?.contentType || values.uploadFile.type || payload.fileType, 80),
          fileSize: Number(uploadResult?.sizeBytes || values.uploadFile.size || payload.fileSize || 0) || 0,
          externalUrl: "",
          storageKind: safeString(uploadResult?.storageKind || "bucket", 30).toLowerCase(),
          storageBucket: safeString(uploadResult?.bucket, 160),
          storagePath: safeString(uploadResult?.path, 400),
          storageGeneration: safeString(uploadResult?.generation, 80),
          storageChecksum: safeString(uploadResult?.checksum, 120),
          storageProvider: safeString(uploadResult?.provider, 40).toLowerCase(),
        };
      }

      const hasUploadSelection = values?.uploadFile instanceof File;
      const hasStoredPath = Boolean(safeString(payload?.storagePath, 400));
      if (!values?.id && !hasUploadSelection) {
        throw new Error("Please choose a file to upload before saving.");
      }
      if (!hasStoredPath) {
        throw new Error("Document storage is incomplete. Please upload the file again.");
      }

      const optimisticProgress = previewSelfHelpDocumentProgress(progress, payload);
      setProgress(optimisticProgress);
      cacheSelfHelpProgress(uid, optimisticProgress);
      closeDialog();

      const next = await saveSelfHelpDocumentRecord(uid, payload);
      setProgress(next);
    } catch (error) {
      console.error("SelfHelp document save failed:", error);
      setStatusMsg(error?.message || "We could not upload and save this document right now.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record) => {
    if (!uid || !record?.id) return;

    const confirmed = window.confirm(`Delete the ${record.documentType || "document"} record?`);
    if (!confirmed) return;

    setDeletingId(record.id);
    setStatusMsg("");

    try {
      const next = await deleteSelfHelpDocumentRecord(uid, { id: record.id });
      setProgress(next);
    } catch (error) {
      console.error("SelfHelp document delete failed:", error);
      setStatusMsg("We could not delete that document record right now.");
    } finally {
      setDeletingId("");
    }
  };

  const createRouteTarget = buildSelfHelpDocumentsRouteTarget({
    track,
    country,
    stepId: preferredStep?.id || "",
    categoryId: preferredCategoryId || "",
    create: true,
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/55 via-white to-white pb-8 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <Motion.div
          className="mx-auto max-w-3xl px-5 py-6"
          variants={pageMotion}
          initial="hidden"
          animate="show"
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Back
            </button>

            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/85 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
              <AppIcon size={ICON_MD} icon={FileText} />
            </span>
          </div>

          <div className="mt-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/80 dark:border-emerald-900/40 dark:bg-zinc-950/50">
                  <AppIcon size={ICON_SM} icon={HeaderIcon} className="text-emerald-700 dark:text-emerald-200" />
                </span>
                {trackMeta.label} self-help
              </div>

              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Self-Help Documents
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
                Safely store destination-related documents here to stay organized and keep track of what comes next.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">
              {documents.length} records
            </span>
            <span className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1.5 font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">
              {linkedStepCount} linked steps
            </span>
            {preferredStep ? (
              <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                Focus: {preferredStep.title}
              </span>
            ) : null}
          </div>

          {statusMsg ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
              {statusMsg}
            </div>
          ) : null}

          <div className="mt-6 rounded-3xl border border-zinc-200/80 bg-white/85 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  Document Flow
                </div>
                <div className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Organized around real journey milestones
                </div>
                <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Keep each record linked to the milestone it supports.
                </div>
              </div>

              <button
                type="button"
                onClick={() => openCreateDialog(preferredStep?.id || "", preferredCategoryId || "")}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/75 px-3 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100"
              >
                <AppIcon size={ICON_SM} icon={Plus} />
                Add document
              </button>
            </div>

            <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              Categories stay in sync automatically as your journey updates.
            </div>
          </div>

          {groupedDocuments.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-zinc-200/80 bg-white/85 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
              <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                No document records yet
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Start with a milestone like admission received, visa approved, flight booked, or accommodation arranged.
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4">
              {groupedDocuments.map((group) => (
                <div
                  key={group.id}
                  className="rounded-3xl border border-zinc-200/80 bg-white/85 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {group.label}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {group.items.length} record{group.items.length === 1 ? "" : "s"}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openCreateDialog("", group.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/85 px-3 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      <AppIcon size={ICON_SM} icon={Plus} />
                      Add record
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {group.items.map((record) => {
                      const linkedStep = stepById.get(record.stepId);
                      return (
                        <div
                          key={record.id}
                          className="rounded-2xl border border-zinc-200/80 bg-zinc-50/85 p-4 dark:border-zinc-800 dark:bg-zinc-950/35"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                {record.documentType || "Document record"}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                                {linkedStep ? (
                                  <span className="rounded-full border border-emerald-100 bg-emerald-50/75 px-2 py-1 font-semibold text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                                    {linkedStep.title}
                                  </span>
                                ) : null}
                                <span className="rounded-full border border-zinc-200 bg-white/80 px-2 py-1 font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
                                  Added {formatDate(record.addedAt)}
                                </span>
                              </div>
                              {record.fileName ? (
                                <div className="mt-3 text-sm text-zinc-700 dark:text-zinc-200">
                                  {record.fileName}
                                  {record.fileType ? ` (${record.fileType})` : ""}
                                </div>
                              ) : null}
                              {canResolveFileAccess(record) ? (
                                <div className="mt-2">
                                  <FileAccessLink
                                    file={record}
                                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"
                                  >
                                    Open file
                                  </FileAccessLink>
                                </div>
                              ) : null}
                              {record.notes ? (
                                <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                                  {record.notes}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditDialog(record)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/75 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/45 dark:text-zinc-200 dark:hover:bg-zinc-900"
                                aria-label={`Edit ${record.documentType || "document"} record`}
                              >
                                <AppIcon size={ICON_SM} icon={Pencil} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(record)}
                                disabled={deletingId === record.id}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-white/75 text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900/40 dark:bg-zinc-950/45 dark:text-rose-300 dark:hover:bg-rose-950/20"
                                aria-label={`Delete ${record.documentType || "document"} record`}
                              >
                                <AppIcon size={ICON_SM} icon={Trash2} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Motion.div>
      </div>

      <button
        type="button"
        onClick={() => {
          if (createRouteTarget?.path) {
            navigate(`${createRouteTarget.path}${createRouteTarget.search || ""}`, { replace: true });
            openCreateDialog(preferredStep?.id || "", preferredCategoryId || "");
            return;
          }
          openCreateDialog(preferredStep?.id || "", preferredCategoryId || "");
        }}
        className="fixed bottom-6 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-emerald-700 dark:border-emerald-900/40"
      >
        <AppIcon size={ICON_SM} icon={Plus} />
        Add document
      </button>

      <SelfHelpDocumentDialog
        key={`${dialogState.record?.id || "new"}:${dialogState.defaultStepId}:${dialogState.defaultCategoryId}:${dialogState.open ? "open" : "closed"}`}
        open={dialogState.open}
        record={dialogState.record}
        categories={categories}
        steps={steps}
        defaultStepId={dialogState.defaultStepId}
        defaultCategoryId={dialogState.defaultCategoryId}
        saving={saving}
        onClose={closeDialog}
        onSubmit={handleSave}
      />
    </div>
  );
}

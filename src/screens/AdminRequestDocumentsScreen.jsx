import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { smartBack } from "../utils/navBack";
import RequestDocumentFieldsSection from "../components/RequestDocumentFieldsSection";
import { normalizeTextDeep } from "../utils/textNormalizer";
import {
  splitRequestDocumentsForLegacyViews,
  subscribeRequestDocumentContext,
} from "../services/documentEngineService";

function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15.5 5.5 9 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFile(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 3.8h6.6L19.2 8.4v12a1.8 1.8 0 0 1-1.8 1.8H8A3.2 3.2 0 0 1 4.8 18.8V7A3.2 3.2 0 0 1 8 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.6 3.8v4.6h4.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminRequestDocumentsScreen() {
  const navigate = useNavigate();
  const { requestId } = useParams();

  const validId = useMemo(() => {
    const id = String(requestId || "").trim();
    return id || null;
  }, [requestId]);

  const [canonicalRows, setCanonicalRows] = useState([]);
  const [canonicalErr, setCanonicalErr] = useState("");
  const [canonicalRequestId, setCanonicalRequestId] = useState("");
  const [requestData, setRequestData] = useState(null);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!validId) {
        if (active) setRequestData(null);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "serviceRequests", validId));
        if (!active) return;
        setRequestData(snap.exists() ? normalizeTextDeep(snap.data() || null) : null);
      } catch (error) {
        console.error("request fetch error:", error);
        if (active) setRequestData(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [validId]);

  useEffect(() => {
    if (!validId) return undefined;

    const unsub = subscribeRequestDocumentContext({
      requestId: validId,
      viewerRole: "admin",
      onData: (rows) => {
        setCanonicalRequestId(validId);
        setCanonicalRows(Array.isArray(rows) ? rows : []);
        setCanonicalErr("");
      },
      onError: (error) => {
        console.error("canonical request docs snapshot error:", error);
        setCanonicalRequestId(validId);
        setCanonicalErr(error?.message || "Failed to load unified request documents.");
      },
    });

    return () => unsub?.();
  }, [validId]);

  const hasCanonicalForRequest = canonicalRequestId === validId;
  const canonicalErrForRequest = hasCanonicalForRequest ? canonicalErr : "";
  const canonicalLoaded = Boolean(validId) && hasCanonicalForRequest;
  const canonicalSplit = useMemo(
    () =>
      splitRequestDocumentsForLegacyViews(hasCanonicalForRequest ? canonicalRows : []),
    [canonicalRows, hasCanonicalForRequest]
  );

  const effectiveAttachments = canonicalSplit.attachments;
  const loading = Boolean(validId) && !canonicalLoaded && !canonicalErrForRequest;
  const pageError = !validId ? "Missing request ID." : canonicalErrForRequest;

  const cardBase =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const softBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  return (
    <div className={`min-h-screen ${softBg}`}>
      <div className="app-page-shell app-page-shell--wide">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70 dark:bg-zinc-900/60">
                <IconFile className="h-4 w-4 text-emerald-700" />
              </span>
              Applicant uploads
            </div>

            <h1 className="mt-3 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Uploaded documents
            </h1>

            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Request ID: <span className="font-mono break-all">{validId || "-"}</span>
            </p>
          </div>

          <button
            onClick={() => smartBack(navigate, "/app/admin")}
            className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            type="button"
          >
            <IconBack className="h-5 w-5 text-emerald-700" />
            Back
          </button>
        </div>

        {pageError ? (
          <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700">
            {pageError}
          </div>
        ) : null}

        {validId ? (
          <RequestDocumentFieldsSection
            request={requestData}
            requestId={validId}
            title="Document fields"
            viewerRole="admin"
            attachments={effectiveAttachments}
            attachmentsLoading={loading}
            attachmentsError={canonicalErrForRequest}
            className={`mt-6 ${cardBase} p-5`}
          />
        ) : null}
      </div>
    </div>
  );
}

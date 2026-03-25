import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "../firebase";
import { smartBack } from "../utils/navBack";
import DocumentExtractPanel from "../components/DocumentExtractPanel";
import DocumentProofreadPanel from "../components/DocumentProofreadPanel";
import RequestDocumentFieldsSection from "../components/RequestDocumentFieldsSection";
import { normalizeTextDeep } from "../utils/textNormalizer";

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

function IconDownload(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 3.8v10.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M8.5 10.8 12 14.3l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 19.5a2.5 2.5 0 0 0 2.5 2.5h8A2.5 2.5 0 0 0 18.5 19.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function bytesToLabel(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
}

function attStatusLabel(status) {
  const s = String(status || "pending_upload").toLowerCase();
  if (s === "pending_upload") return "Received";
  if (s === "uploaded") return "Uploaded";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return s;
}

function safeStr(x) {
  return String(x || "").trim();
}

function isExtraFieldAttachment(item) {
  const kind = safeStr(item?.kind).toLowerCase();
  return Boolean(
    safeStr(item?.fieldId) ||
      safeStr(item?.fieldLabel || item?.label) ||
      kind === "extra_field_document"
  );
}

export default function StaffRequestDocumentsScreen() {
  const navigate = useNavigate();
  const { requestId } = useParams();

  const validId = useMemo(() => {
    const id = String(requestId || "").trim();
    return id || null;
  }, [requestId]);

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [requestData, setRequestData] = useState(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      setUid(user.uid);
      setCheckingAuth(false);
    });
    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    (async () => {
      if (!validId || !uid) {
        setRequestData(null);
        return;
      }

      try {
        setErr("");
        setAllowed(false);
        setRequestData(null);

        const reqSnap = await getDoc(doc(db, "serviceRequests", validId));
        if (!reqSnap.exists()) throw new Error("Request not found");

        const req = reqSnap.data() || {};
        setRequestData(normalizeTextDeep(req));
        const assignedTo = safeStr(req?.assignedTo);

        if (assignedTo && assignedTo === uid) {
          setAllowed(true);
          return;
        }

        const taskSnap = await getDoc(doc(db, "staff", uid, "tasks", validId));
        if (taskSnap.exists()) {
          setAllowed(true);
          return;
        }

        setErr("You are not assigned to this request.");
      } catch (error) {
        console.error(error);
        setAllowed(false);
        setRequestData(null);
        setErr(error?.message || "Access check failed.");
      }
    })();
  }, [validId, uid]);

  useEffect(() => {
    if (!validId || !allowed) return undefined;

    setLoading(true);
    setErr("");

    const colRef = collection(db, "serviceRequests", validId, "attachments");
    const qy = query(colRef, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setAttachments(snap.docs.map((d) => normalizeTextDeep({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("attachments snapshot error:", error);
        setErr(error?.message || "Failed to load uploaded documents.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [allowed, validId]);

  const legacyAttachments = useMemo(
    () => attachments.filter((item) => !isExtraFieldAttachment(item)),
    [attachments]
  );

  const cardBase =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const softBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  if (checkingAuth) {
    return (
      <div className={`min-h-screen ${softBg}`}>
        <div className="app-page-shell app-page-shell--wide">
          <div className={`${cardBase} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Preparing...</div>
        </div>
      </div>
    );
  }

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
            onClick={() => smartBack(navigate, "/staff/tasks")}
            className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            type="button"
          >
            <IconBack className="h-5 w-5 text-emerald-700" />
            Back
          </button>
        </div>

        {err ? (
          <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700">
            {err}
          </div>
        ) : null}

        {!allowed ? (
          <div className={`mt-6 ${cardBase} p-5`}>
            <div className="text-sm text-zinc-600 dark:text-zinc-300">
              You can only view documents for requests assigned to you.
            </div>
          </div>
        ) : (
          <>
            <RequestDocumentFieldsSection
              request={requestData}
              requestId={validId}
              title="Document fields"
              viewerRole="staff"
              attachments={attachments}
              attachmentsLoading={loading}
              attachmentsError={err}
              showLegacySection={false}
              className={`mt-6 ${cardBase} p-5`}
            />

            <div className={`mt-4 ${cardBase} p-5`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                    Legacy upload records
                  </div>
                  <div className="text-xs text-zinc-500">Preserved request-level attachments</div>
                </div>
                <span className="text-xs text-zinc-500">{legacyAttachments.length} files</span>
              </div>

              {legacyAttachments.length > 0 ? (
                <DocumentProofreadPanel
                  requestId={validId}
                  request={requestData}
                  attachments={legacyAttachments}
                />
              ) : null}

              {loading ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                  Loading...
                </div>
              ) : legacyAttachments.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300">
                  No legacy upload records.
                </div>
              ) : (
                <div className="mt-4 grid gap-2">
                  {legacyAttachments.map((a) => {
                    const url = safeStr(a?.url || a?.downloadUrl || a?.fileUrl);
                    const hasLink = url.startsWith("http");
                    const contentType = safeStr(a?.contentType || a?.type || "file");
                    const name = safeStr(a?.name || a?.filename || "Document");
                    const label = safeStr(a?.label);
                    const metaNote = safeStr(a?.metaNote || a?.note);
                    const kind = safeStr(a?.kind);

                    return (
                      <div
                        key={a.id}
                        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-4 transition hover:border-emerald-200 hover:bg-white"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 break-words">
                              {name}
                            </div>

                            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                              {bytesToLabel(a.size)} · {contentType}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              <span className="inline-flex rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                                {attStatusLabel(a.status)}
                              </span>

                              {label ? (
                                <span className="inline-flex rounded-full border border-emerald-100 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                                  {label}
                                </span>
                              ) : null}

                              {kind ? (
                                <span className="inline-flex rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                                  {kind}
                                </span>
                              ) : null}
                            </div>

                            {metaNote ? (
                              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">
                                {metaNote}
                              </div>
                            ) : null}

                            {hasLink ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                              >
                                <IconDownload className="h-5 w-5" />
                                Open / Download
                              </a>
                            ) : (
                              <div className="mt-3 text-sm font-semibold text-zinc-400">
                                Download link not available yet
                              </div>
                            )}

                            <DocumentExtractPanel
                              requestId={validId}
                              request={requestData}
                              attachment={a}
                              role="staff"
                            />
                          </div>

                          <span className="shrink-0 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800">
                            Applicant
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

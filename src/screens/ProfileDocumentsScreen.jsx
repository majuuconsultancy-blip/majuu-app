import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Inbox, Upload } from "lucide-react";
import { motion as Motion } from "../utils/motionproxy";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { auth } from "../firebase";
import { subscribeUserDocumentHub } from "../services/documentEngineService";
import { canResolveFileAccess } from "../services/fileAccessService";
import FileAccessLink from "../components/FileAccessLink";

function safeStr(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function bytesToLabel(bytes) {
  const b = Number(bytes || 0);
  if (!Number.isFinite(b) || b <= 0) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
}

function prettyContextLabel(row) {
  const context = safeStr(row?.contextType, 60).toLowerCase();
  if (context === "request_upload") return "Request";
  if (context === "request_chat") return "Chat";
  if (context === "request_delivery") return "Final delivery";
  if (context === "self_help") return "Self-help";
  if (context === "vault") return "Vault";
  return context ? context.replace(/[_-]+/g, " ") : "Document";
}

function prettyDate(ts) {
  const dateMs = Number(ts || 0);
  if (!dateMs) return "";
  try {
    return new Date(dateMs).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function ProfileDocumentsScreen() {
  const navigate = useNavigate();
  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("all");
  const [allRows, setAllRows] = useState([]);
  const [uploaded, setUploaded] = useState([]);
  const [downloaded, setDownloaded] = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      setUid(String(user.uid || "").trim());
    });
    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (!uid) return undefined;

    const unsub = subscribeUserDocumentHub({
      uid,
      onData: (rows) => {
        setAllRows(Array.isArray(rows?.all) ? rows.all : []);
        setUploaded(Array.isArray(rows?.uploaded) ? rows.uploaded : []);
        setDownloaded(
          Array.isArray(rows?.downloaded)
            ? rows.downloaded
            : Array.isArray(rows?.received)
            ? rows.received
            : []
        );
        setLoading(false);
      },
      onError: (error) => {
        console.error("profile documents snapshot error:", error);
        setErr(error?.message || "Failed to load documents.");
        setLoading(false);
      },
    });

    return () => unsub?.();
  }, [uid]);

  const activeRows = useMemo(
    () => (tab === "uploaded" ? uploaded : tab === "downloaded" ? downloaded : allRows),
    [tab, allRows, downloaded, uploaded]
  );

  const tabBase =
    "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition";
  const tabIdle =
    "border-zinc-200 bg-white/80 text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200";
  const tabActive = "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white pb-8 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <Motion.div
          className="mx-auto max-w-3xl px-5 py-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate("/app/profile")}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              <AppIcon size={ICON_SM} icon={ArrowLeft} />
              Back
            </button>

            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50/85 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
              <AppIcon size={ICON_MD} icon={FileText} />
            </span>
          </div>

          <div className="mt-5">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Documents
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              A single place for what you have uploaded and what you have downloaded.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("all")}
              className={`${tabBase} ${tab === "all" ? tabActive : tabIdle}`}
            >
              <AppIcon size={ICON_SM} icon={FileText} />
              All
              <span className="rounded-full bg-white/75 px-2 py-0.5 text-xs">{allRows.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setTab("uploaded")}
              className={`${tabBase} ${tab === "uploaded" ? tabActive : tabIdle}`}
            >
              <AppIcon size={ICON_SM} icon={Upload} />
              Uploaded
              <span className="rounded-full bg-white/75 px-2 py-0.5 text-xs">{uploaded.length}</span>
            </button>

            <button
              type="button"
              onClick={() => setTab("downloaded")}
              className={`${tabBase} ${tab === "downloaded" ? tabActive : tabIdle}`}
            >
              <AppIcon size={ICON_SM} icon={Inbox} />
              Downloaded
              <span className="rounded-full bg-white/75 px-2 py-0.5 text-xs">{downloaded.length}</span>
            </button>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          <div className="mt-5 rounded-3xl border border-zinc-200/80 bg-white/85 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
            {loading ? (
              <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300">
                Loading documents...
              </div>
            ) : activeRows.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300">
                No {tab === "all" ? "" : `${tab} `}documents yet.
              </div>
            ) : (
              <div className="grid gap-2">
                {activeRows.map((row) => {
                  const name = safeStr(row?.preview?.name, 180) || "Document";
                  const fileRef = {
                    ...row?.preview,
                    storageKind: row?.preview?.storageKind,
                    storageBucket: row?.preview?.storageBucket,
                    storagePath: row?.preview?.storagePath,
                    storageProvider: row?.preview?.storageProvider,
                  };
                  const openable = canResolveFileAccess(fileRef);
                  const context = prettyContextLabel(row);
                  const requestId = safeStr(row?.requestId, 120);
                  const size = bytesToLabel(row?.preview?.sizeBytes);
                  const createdAtLabel = prettyDate(
                    Number(row?.createdAtMs || row?.updatedAtMs || 0)
                  );
                  const card = (
                    <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {name}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                            <span>{context}</span>
                            <span>{size}</span>
                            {createdAtLabel ? <span>{createdAtLabel}</span> : null}
                          </div>
                          {requestId ? (
                            <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                              Request: {requestId}
                            </div>
                          ) : null}
                        </div>

                        <span
                          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${
                            openable
                              ? "border border-emerald-200 bg-emerald-600 text-white"
                              : "border border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400"
                          }`}
                        >
                          {openable ? "Open" : "Metadata"}
                        </span>
                      </div>
                    </div>
                  );

                  return openable ? (
                    <FileAccessLink
                      key={row.id}
                      file={fileRef}
                      className="block no-underline"
                    >
                      {card}
                    </FileAccessLink>
                  ) : (
                    <div key={row.id}>{card}</div>
                  );
                })}
              </div>
            )}
          </div>
        </Motion.div>
      </div>
    </div>
  );
}

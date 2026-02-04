import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, collection, onSnapshot, query, orderBy } from "firebase/firestore";

import { auth, db } from "../firebase";
import { clearActiveProcess } from "../services/userservice";

/* ---------------- Minimal icons ---------------- */
function IconReceipt(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3.8h10A2.2 2.2 0 0 1 19.2 6v15.2l-2.2-1.2-2.2 1.2-2.2-1.2-2.2 1.2-2.2-1.2-2.2 1.2V6A2.2 2.2 0 0 1 7 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 8.4h7.6M8.2 12h7.6M8.2 15.6h5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconNote(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3.8h7.8L20.2 9v11.2A1.8 1.8 0 0 1 18.4 22H7A3.2 3.2 0 0 1 3.8 18.8V7A3.2 3.2 0 0 1 7 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 3.8V9h5.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.8 13h8M7.8 16.4h6.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
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

function IconArrowLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 18 8.5 12l6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- Helpers ---------------- */
function statusUI(status) {
  const s = String(status || "new").toLowerCase();

  if (s === "new")
    return {
      label: "Submitted",
      badge: "bg-zinc-100 text-zinc-700 border border-zinc-200",
    };

  if (s === "contacted")
    return {
      label: "In progress",
      badge: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };

  if (s === "closed")
    return {
      label: "Completed",
      badge: "bg-emerald-100 text-emerald-900 border border-emerald-200",
    };

  if (s === "rejected")
    return {
      label: "Needs correction",
      badge: "bg-rose-50 text-rose-700 border border-rose-100",
    };

  return {
    label: s,
    badge: "bg-zinc-100 text-zinc-700 border border-zinc-200",
  };
}

function attachmentStatusLabel(status) {
  const s = String(status || "pending_upload").toLowerCase();
  if (s === "pending_upload") return "Received";
  if (s === "uploaded") return "Uploaded";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";
  return s;
}

function bytesToLabel(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return "0 KB";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
}

/** ✅ Fallback for old requests: parse "Missing items: ..." from note */
function parseMissingItemsFromNote(note) {
  const text = String(note || "");
  const match = text.match(/Missing items:\s*([^\n\r]+)/i);
  if (!match) return [];
  const raw = match[1].trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

export default function RequestStatusScreen() {
  const navigate = useNavigate();
  const { requestId } = useParams();

  const [loading, setLoading] = useState(true);
  const [req, setReq] = useState(null);
  const [err, setErr] = useState("");

  const [fileErr, setFileErr] = useState("");
  const [attachments, setAttachments] = useState([]);

  const [adminFilesErr, setAdminFilesErr] = useState("");
  const [adminFiles, setAdminFiles] = useState([]);

  const validRequestId = useMemo(() => {
    const id = String(requestId || "").trim();
    return id.length > 0 ? id : null;
  }, [requestId]);

  useEffect(() => {
    let unsubDoc = null;
    let unsubAtt = null;
    let unsubAdminFiles = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubDoc) unsubDoc();
      if (unsubAtt) unsubAtt();
      if (unsubAdminFiles) unsubAdminFiles();

      unsubDoc = null;
      unsubAtt = null;
      unsubAdminFiles = null;

      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      if (!validRequestId) {
        setErr("Missing request ID in URL.");
        setReq(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr("");

      // Request doc
      const ref = doc(db, "serviceRequests", validRequestId);
      unsubDoc = onSnapshot(
        ref,
        async (snap) => {
          if (!snap.exists()) {
            setErr("Request not found.");
            setReq(null);
            setLoading(false);
            return;
          }

          const data = { id: snap.id, ...snap.data() };
          setReq(data);
          setLoading(false);

          const st = String(data.status || "").toLowerCase();
          if (st === "closed" || st === "rejected") {
            try {
              await clearActiveProcess(user.uid);
            } catch (e) {
              console.error("clearActiveProcess failed:", e);
            }
          }
        },
        (e) => {
          console.error("Request doc snapshot error:", e);
          setErr(e?.message || "Failed to load request.");
          setLoading(false);
        }
      );

      // User submitted docs
      const attRef = collection(
        db,
        "serviceRequests",
        validRequestId,
        "attachments"
      );
      const attQ = query(attRef, orderBy("createdAt", "desc"));
      unsubAtt = onSnapshot(
        attQ,
        (snap) => {
          setAttachments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setFileErr("");
        },
        (e) => {
          console.error("attachments snapshot error:", e);
          setFileErr(e?.message || "Failed to load submitted documents.");
        }
      );

      // Admin -> User docs (downloadable)
      const afRef = collection(
        db,
        "serviceRequests",
        validRequestId,
        "adminFiles"
      );
      const afQ = query(afRef, orderBy("createdAt", "desc"));
      unsubAdminFiles = onSnapshot(
        afQ,
        (snap) => {
          setAdminFiles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setAdminFilesErr("");
        },
        (e) => {
          console.error("adminFiles snapshot error:", e);
          setAdminFilesErr(e?.message || "Failed to load documents from MAJUU.");
        }
      );
    });

    return () => {
      if (unsubDoc) unsubDoc();
      if (unsubAtt) unsubAtt();
      if (unsubAdminFiles) unsubAdminFiles();
      unsubAuth();
    };
  }, [navigate, validRequestId]);

  const cardBase =
    "rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur";
  const softBg = "bg-gradient-to-b from-emerald-50/40 via-white to-white";

  if (loading) {
    return (
      <div className={`min-h-screen ${softBg}`}>
        <div className="max-w-xl mx-auto px-5 py-10">
          <div className={`${cardBase} p-5`}>
            <p className="text-sm text-zinc-600">Loading request…</p>
          </div>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={`min-h-screen ${softBg}`}>
        <div className="max-w-xl mx-auto px-5 py-10">
          <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-5 text-sm text-rose-700">
            {err}
          </div>

          <button
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/60 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white"
            onClick={() => navigate("/app/progress")}
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Progress
          </button>
        </div>
      </div>
    );
  }

  const ui = statusUI(req?.status);
  const track = String(req?.track || "").toLowerCase();
  const safeTrack = track === "work" || track === "travel" ? track : "study";
  const countryQS = encodeURIComponent(req?.country || "");
  const st = String(req?.status || "new").toLowerCase();

  const adminNote = String(
    req?.adminDecisionNote || req?.decisionNote || req?.adminNote || ""
  ).trim();
  const isFull = String(req?.requestType || "").toLowerCase() === "full";

  const canContinue = isFull && (st === "contacted" || st === "closed");
  const canStartNew = !isFull && st === "closed";
  const canTryAgain = st === "rejected";

  const handleContinue = () => {
    const country = req?.country || "Not selected";

    let missingItems = Array.isArray(req?.missingItems) ? req.missingItems : [];
    if (!missingItems.length) missingItems = parseMissingItemsFromNote(req?.note);

    try {
      sessionStorage.setItem(
        `fp_missing_${safeTrack}`,
        JSON.stringify(missingItems)
      );
    } catch {}

    if (!missingItems.length) {
      alert(
        "We couldn't find your missing items.\nPlease re-open Full Package and tick your checklist again."
      );
      navigate(`/app/${safeTrack}/we-help?country=${encodeURIComponent(country)}`);
      return;
    }

    navigate(
      `/app/full-package/${safeTrack}?country=${encodeURIComponent(country)}&requestId=${req?.id}`,
      { state: { missingItems } }
    );
  };

  // ✅ UPDATED: Retry now deep-links into the correct RequestModal
  const handleTryAgain = () => {
    const country = req?.country || "Not selected";
    const countryQS2 = encodeURIComponent(country);

    // FULL PACKAGE → go to FullPackageMissingScreen + auto-open modal
    if (isFull) {
      let missingItems = Array.isArray(req?.missingItems) ? req.missingItems : [];
      if (!missingItems.length) missingItems = parseMissingItemsFromNote(req?.note);

      try {
        sessionStorage.setItem(
          `fp_missing_${safeTrack}`,
          JSON.stringify(missingItems)
        );
      } catch {}

      const picked =
        String(req?.fullPackageItem || "").trim() ||
        String(missingItems?.[0] || "").trim() ||
        "Document checklist";

      navigate(
        `/app/full-package/${safeTrack}?country=${countryQS2}&parentRequestId=${encodeURIComponent(
          String(req?.id || requestId || "")
        )}&autoOpen=1&item=${encodeURIComponent(picked)}`,
        { state: { missingItems } }
      );
      return;
    }

    // SINGLE SERVICE → go to WeHelp + auto-open modal on that service
    const serviceName = String(req?.serviceName || "").trim();
    navigate(
      `/app/${safeTrack}/we-help?country=${countryQS2}&autoOpen=1&open=${encodeURIComponent(
        serviceName
      )}`
    );
  };

  return (
    <div className={`min-h-screen ${softBg}`}>
      <div className="max-w-xl mx-auto px-5 py-6 pb-10">
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70">
                <IconReceipt className="h-4 w-4 text-emerald-700" />
              </span>
              Request
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Request details
            </h1>

            <p className="mt-1 text-sm text-zinc-600">
              {String(req?.track || "").toUpperCase()} · {req?.country || "-"}
            </p>
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${ui.badge}`}
          >
            {ui.label}
          </span>
        </div>

        {/* Main card */}
        <div className={`mt-5 ${cardBase} p-5`}>
          <div className="text-sm text-zinc-600">
            {isFull ? "Full package" : `Single service: ${req?.serviceName || "-"}`}
          </div>

          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Request ID</span>
              <span className="font-mono text-zinc-900">{req?.id}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Full name</span>
              <span className="font-medium text-zinc-900">{req?.name || "-"}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Phone</span>
              <span className="font-medium text-zinc-900">{req?.phone || "-"}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-500">Email</span>
              <span className="font-medium text-zinc-900">{req?.email || "-"}</span>
            </div>

            {req?.note ? (
              <div className="mt-2 rounded-2xl border border-zinc-200 bg-white/60 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                  <IconNote className="h-4 w-4 text-zinc-500" />
                  Your note
                </div>
                <div className="mt-2 text-sm text-zinc-800 whitespace-pre-wrap">
                  {req.note}
                </div>
              </div>
            ) : null}
          </div>

          {(st === "rejected" || st === "closed" || st === "contacted") &&
          adminNote ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl border border-amber-200 bg-white/70">
                  <IconNote className="h-4 w-4 text-amber-800" />
                </span>
                Note from the MAJUU team
              </div>
              <div className="mt-2 text-sm text-amber-900 whitespace-pre-wrap">
                {adminNote}
              </div>
            </div>
          ) : null}

          {st === "new" ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-700">
              We’ve received your request. Our team will review it and update you
              here.
              <div className="mt-2 text-xs text-zinc-500">
                Tip: You can always check Progress for updates.
              </div>
            </div>
          ) : null}

          {st === "contacted" ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-900">
              Your request is being processed. Please check back later.
            </div>
          ) : null}

          {st === "closed" ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-900">
              {isFull
                ? "Your full package was approved. Continue with the next steps."
                : "Your request has been completed."}
            </div>
          ) : null}

          {st === "rejected" ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
              This request needs correction. Please follow the team note above.
            </div>
          ) : null}
        </div>

        {/* ✅ Documents from MAJUU (downloadable) */}
        <div className={`mt-5 ${cardBase} p-5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60">
                <IconFile className="h-5 w-5 text-emerald-800" />
              </span>
              <div>
                <div className="font-semibold text-zinc-900">
                  Documents from MAJUU
                </div>
                <div className="text-xs text-zinc-500">SOPs, templates, forms</div>
              </div>
            </div>
            <span className="text-xs text-zinc-500">{adminFiles.length} files</span>
          </div>

          {adminFilesErr ? (
            <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {adminFilesErr}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            {adminFiles.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
                No documents sent yet.
              </div>
            ) : (
              adminFiles.map((f) => {
                const name = String(f.name || "Document");
                const url = String(f.url || "").trim();

                return (
                  <div
                    key={f.id}
                    className="rounded-2xl border border-zinc-200 bg-white/60 p-4 transition hover:border-emerald-200 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-zinc-900 break-words">
                          {name}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600">
                          Tap Open to download
                        </div>
                      </div>

                      <a
                        href={url || "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={`shrink-0 inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.99] ${
                          url
                            ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
                            : "border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed pointer-events-none"
                        }`}
                      >
                        Open
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* User submitted docs */}
        <div className={`mt-5 ${cardBase} p-5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60">
                <IconFile className="h-5 w-5 text-emerald-800" />
              </span>
              <div>
                <div className="font-semibold text-zinc-900">
                  Submitted documents
                </div>
                <div className="text-xs text-zinc-500">
                  Visible when you upload documents.
                </div>
              </div>
            </div>

            <span className="text-xs text-zinc-500">{attachments.length} files</span>
          </div>

          {fileErr ? (
            <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
              {fileErr}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            {attachments.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-600">
                No documents submitted.
              </div>
            ) : (
              attachments.map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl border border-zinc-200 bg-white/60 p-4 transition hover:border-emerald-200 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-zinc-900 break-words">
                        {a.name || "PDF"}
                      </div>
                      <div className="mt-1 text-xs text-zinc-600">
                        Status:{" "}
                        <span className="font-semibold text-zinc-800">
                          {attachmentStatusLabel(a.status)}
                        </span>{" "}
                        · {bytesToLabel(a.size)}
                      </div>
                    </div>

                    <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                      {String(a.status || "pending_upload").toLowerCase()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ✅ Bottom action button (NOT fixed) */}
        {canContinue || canStartNew || canTryAgain ? (
          <div className="mt-5">
            {canContinue ? (
              <button
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                onClick={handleContinue}
              >
                Continue
              </button>
            ) : null}

            {canStartNew ? (
              <button
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
                onClick={() => navigate("/dashboard", { replace: true })}
              >
                Start a new request
              </button>
            ) : null}

            {canTryAgain ? (
              <button
                className="w-full rounded-xl border border-rose-200 bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.99]"
                onClick={handleTryAgain}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Back button */}
        <div className="mt-3">
          <button
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/60 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white active:scale-[0.99]"
            onClick={() => navigate("/app/progress")}
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Progress
          </button>
        </div>

        <div className="h-10" />
      </div>
    </div>
  );
}
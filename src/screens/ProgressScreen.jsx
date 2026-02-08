import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  deleteDoc,
  getDocs,
} from "firebase/firestore";

import { auth, db } from "../firebase";
import { getUserState } from "../services/userservice";
import { getMyApplications } from "../services/progressservice";

/* ---------- Minimal icons (no emojis) ---------- */
function IconPulse(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 13.2h3.2l1.6-6.1 3.3 13 2.2-7.1H20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 5.5 15.5 12 9 18.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTrash(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 4.8h6M6.5 7.2h11M9.2 7.2l.6 13h4.4l.6-13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- Status UI ---------- */
function statusUI(status) {
  const s = String(status || "new").toLowerCase();

  if (s === "new")
    return {
      label: "Submitted",
      badge:
        "bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-200 dark:border-zinc-700",
      dot: "bg-zinc-400 dark:bg-zinc-500",
    };

  if (s === "contacted")
    return {
      label: "Received",
      badge:
        "bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900/40",
      dot: "bg-emerald-500",
    };

  if (s === "closed")
    return {
      label: "Succeeded",
      badge:
        "bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/55 dark:text-emerald-200 dark:border-emerald-900/40",
      dot: "bg-emerald-700",
    };

  if (s === "rejected")
    return {
      label: "Rejected",
      badge:
        "bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-900/40",
      dot: "bg-rose-500",
    };

  return {
    label: s,
    badge:
      "bg-zinc-100 text-zinc-700 border border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-200 dark:border-zinc-700",
    dot: "bg-zinc-400 dark:bg-zinc-500",
  };
}

/* ✅ Fallback for old full-package requests: parse "Missing items: ..." from note */
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

export default function ProgressScreen() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [requests, setRequests] = useState([]);
  const [apps, setApps] = useState([]); // kept (pitch can hide)
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState("");

  async function deleteRequestDeep(requestId) {
    const attRef = collection(db, "serviceRequests", requestId, "attachments");
    const attSnap = await getDocs(attRef);
    for (const d of attSnap.docs) {
      await deleteDoc(
        doc(db, "serviceRequests", requestId, "attachments", d.id)
      );
    }
    await deleteDoc(doc(db, "serviceRequests", requestId));
  }

  useEffect(() => {
    let unsubReq = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setLoading(true);
      setErr("");

      try {
        const s = await getUserState(user.uid);
        setState(s);

        const reqRef = collection(db, "serviceRequests");
        const reqQ = query(reqRef, where("uid", "==", user.uid));

        if (unsubReq) unsubReq();

        unsubReq = onSnapshot(
          reqQ,
          (snap) => {
            const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            data.sort(
              (a, b) =>
                (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
            );
            setRequests(data);
          },
          (error) => {
            console.error("Realtime requests error:", error);
            setErr(error?.message || "Failed to listen for requests");
          }
        );

        const appls = await getMyApplications(user.uid, 25);
        setApps(appls);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load progress");
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (unsubReq) unsubReq();
    };
  }, [navigate]);

  const goContinue = () => {
    const helpType = String(state?.activeHelpType || "").toLowerCase();
    const requestId = String(state?.activeRequestId || "").trim();
    const track = String(state?.activeTrack || "").toLowerCase();

    if (helpType === "we" && requestId) {
      navigate(`/app/request/${requestId}`, { replace: true });
      return;
    }
    if (track) {
      navigate(`/app/${track}`, { replace: true });
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  const hasActive = Boolean(state?.hasActiveProcess);
  const activeTrack = String(state?.activeTrack || "-");
  const activeCountry = String(state?.activeCountry || "-");
  const activeMode =
    String(state?.activeHelpType || "").toLowerCase() === "we"
      ? "We-Help"
      : "Self-Help";

  const cardBase =
    "rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60";
  const cardHover =
    "transition hover:border-emerald-200 hover:bg-white hover:shadow-md dark:hover:border-emerald-900/40 dark:hover:bg-zinc-900";

  const primaryBtn =
    "w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60";
  const ghostBtn =
    "rounded-2xl border border-zinc-200 bg-white/60 px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900";

  const requestsCountLabel = useMemo(() => {
    const n = requests.length;
    return n === 1 ? "1 request" : `${n} requests`;
  }, [requests.length]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="max-w-xl mx-auto px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading progress…
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-6">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-emerald-200">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-100 bg-white/70 dark:border-zinc-700 dark:bg-zinc-950/40">
                  <IconPulse className="h-4 w-4 text-emerald-700 dark:text-emerald-200" />
                </span>
                Progress
              </div>

              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Your activity
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Continue your process and track We-Help requests.
              </p>
            </div>

            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
          </div>

          {/* Error */}
          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {/* Current process */}
          <div className={`mt-6 ${cardBase} ${cardHover}`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                Current process
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {hasActive ? "Live" : "Idle"}
              </span>
            </div>

            {hasActive ? (
              <div className="mt-4 grid gap-3">
                <div className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Track
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {activeTrack}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Country
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {activeCountry}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Mode
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {activeMode}
                    </span>
                  </div>
                </div>

                <button onClick={goContinue} className={primaryBtn}>
                  Continue
                </button>
              </div>
            ) : (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                No active process yet. Choose a track to begin.
                <div className="mt-4">
                  <button
                    onClick={() => navigate("/dashboard")}
                    className={ghostBtn}
                  >
                    Choose track
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Requests */}
          <div className="mt-8">
            <div className="flex items-end justify-between">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                We-Help requests
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {requestsCountLabel}
              </span>
            </div>

            {requests.length === 0 ? (
              <div className={`mt-3 ${cardBase}`}>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  No requests yet
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  When you submit a We-Help request, it will show up here.
                </div>
                <div className="mt-4">
                  <button
                    onClick={() => navigate("/dashboard")}
                    className={ghostBtn}
                  >
                    Start a request
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 grid gap-3">
                {requests.map((r) => {
                  const ui = statusUI(r.status);
                  const track = String(r.track || "").toLowerCase();
                  const safeTrack =
                    track === "work" || track === "travel" ? track : "study";

                  const st = String(r.status || "new").toLowerCase();

                  const canDelete = st === "closed" || st === "rejected";
                  const isDeleting = deletingId === r.id;

                  const isFull =
                    String(r.requestType || "").toLowerCase() === "full";

                  const titleLeft = `${String(r.track || "").toUpperCase()} • ${
                    r.country || "-"
                  }`;
                  const subtitle = isFull
                    ? "Full package"
                    : `Single: ${r.serviceName || "-"}`;

                  // ✅ Try again routing EXACTLY like RequestStatusScreen
                  const handleTryAgain = () => {
                    const country = r.country || "Not selected";
                    const countryQS2 = encodeURIComponent(country);

                    if (isFull) {
                      let missingItems = Array.isArray(r.missingItems)
                        ? r.missingItems
                        : [];
                      if (!missingItems.length)
                        missingItems = parseMissingItemsFromNote(r.note);

                      try {
                        sessionStorage.setItem(
                          `fp_missing_${safeTrack}`,
                          JSON.stringify(missingItems)
                        );
                      } catch {}

                      const picked =
                        String(r.fullPackageItem || "").trim() ||
                        String(missingItems?.[0] || "").trim() ||
                        "Document checklist";

                      navigate(
                        `/app/full-package/${safeTrack}?country=${countryQS2}&parentRequestId=${encodeURIComponent(
                          String(r.id || "")
                        )}&autoOpen=1&item=${encodeURIComponent(picked)}`,
                        { state: { missingItems } }
                      );
                      return;
                    }

                    const serviceName = String(r.serviceName || "").trim();
                    navigate(
                      `/app/${safeTrack}/we-help?country=${countryQS2}&autoOpen=1&open=${encodeURIComponent(
                        serviceName
                      )}`
                    );
                  };

                  return (
                    <div key={r.id} className={`${cardBase} ${cardHover}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${ui.dot}`}
                            />
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                              {titleLeft}
                            </div>
                          </div>

                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                            {subtitle}
                          </div>

                          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            ID: <span className="font-mono">{r.id}</span>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${ui.badge}`}
                        >
                          {ui.label}
                        </span>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => navigate(`/app/request/${r.id}`)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99]
                                     dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/55"
                        >
                          View
                          <IconChevronRight className="h-4 w-4" />
                        </button>

                        {st === "rejected" && (
                          <button
                            onClick={handleTryAgain}
                            className="rounded-2xl border border-zinc-200 bg-white/60 px-3.5 py-2 text-sm font-semibold text-zinc-900 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]
                                       dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
                          >
                            Try again
                          </button>
                        )}

                        {canDelete && (
                          <button
                            disabled={isDeleting}
                            onClick={async () => {
                              const ok = window.confirm(
                                "Delete this request? This cannot be undone."
                              );
                              if (!ok) return;

                              setErr("");
                              setDeletingId(r.id);

                              try {
                                await deleteRequestDeep(r.id);
                              } catch (e) {
                                console.error("Delete request failed:", e);
                                setErr(e?.message || "Failed to delete request.");
                              } finally {
                                setDeletingId("");
                              }
                            }}
                            className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60
                                       dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/55"
                          >
                            <IconTrash className="h-4 w-4" />
                            {isDeleting ? "Deleting…" : "Delete"}
                          </button>
                        )}
                      </div>

                      {st === "new" ? (
                        <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                          Received — you’ll see updates here as we process it.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* apps kept but not rendered */}
        </div>
      </div>
    </div>
  );
}
// ✅ StaffTasksScreen.jsx (FULL COPY-PASTE)
// Adds:
// - ✅ Logout button (top right)
// - ✅ Tabs: New / Ongoing / Done
//    - New: staffStatus !== "in_progress" && !== "done"  (not started)
//    - Ongoing: staffStatus === "in_progress"            (started, not done)
//    - Done: staffStatus === "done"                      (sent to admin)
// - ✅ Search
// - ✅ Counters per tab + total
// - ✅ Recommendation pill (only shows when staffDecision is recommend_*)
// - ✅ Safer loading + map fetch

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { auth, db } from "../firebase";

/* ---------- Icons ---------- */
function IconChevronLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10.8 18.2a7.4 7.4 0 1 1 0-14.8 7.4 7.4 0 0 1 0 14.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16.8 16.8 21 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLogout(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7V6.3A2.3 2.3 0 0 1 12.3 4h5.4A2.3 2.3 0 0 1 20 6.3v11.4A2.3 2.3 0 0 1 17.7 20h-5.4A2.3 2.3 0 0 1 10 17.7V17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 9l-3 3 3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------- Pills ---------- */
function taskPillByStaffStatus(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "done") {
    return { label: "Done", cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
  }
  if (s === "in_progress") {
    return {
      label: "Ongoing",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }
  return { label: "New", cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
}

function recPill(staffDecision) {
  const d = String(staffDecision || "").toLowerCase();
  if (d === "recommend_accept") {
    return {
      label: "Recommend accept",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  }
  if (d === "recommend_reject") {
    return {
      label: "Recommend reject",
      cls: "bg-rose-50 text-rose-700 border border-rose-100",
    };
  }
  return null;
}

const TABS = [
  { key: "new", label: "New" },
  { key: "ongoing", label: "Ongoing" },
  { key: "done", label: "Done" },
];

function isValidTabKey(k) {
  const key = String(k || "").toLowerCase();
  return TABS.some((t) => t.key === key);
}

function normalizeStaffTab(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "done") return "done";
  if (s === "in_progress") return "ongoing";
  return "new";
}

export default function StaffTasksScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabFromUrl = searchParams.get("tab");
  const qFromUrl = searchParams.get("q") || "";

  const [tab, setTab] = useState(isValidTabKey(tabFromUrl) ? tabFromUrl : "new");
  const [search, setSearch] = useState(String(qFromUrl));

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [tasks, setTasks] = useState([]);
  const [requestsMap, setRequestsMap] = useState({}); // requestId -> request data
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState("");

  // keep URL state in sync (Back button friendly)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);

    const trimmed = String(search || "").trim();
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search]);

  useEffect(() => {
    let unsubTasks = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubTasks) unsubTasks();

      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setLoading(true);
      setErr("");

      const tRef = collection(db, "staff", user.uid, "tasks");
      const tQ = query(tRef, orderBy("assignedAt", "desc"));

      unsubTasks = onSnapshot(
        tQ,
        async (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setTasks(list);

          // fetch serviceRequests for each task (OK for small scale)
          const nextMap = {};
          await Promise.all(
            list.map(async (t) => {
              const rid = String(t.requestId || t.id);
              if (!rid) return;
              try {
                const rSnap = await getDoc(doc(db, "serviceRequests", rid));
                if (rSnap.exists()) nextMap[rid] = { id: rSnap.id, ...rSnap.data() };
              } catch (e) {
                // ignore per-item
              }
            })
          );

          setRequestsMap(nextMap);
          setLoading(false);
        },
        (e) => {
          console.error(e);
          setErr(e?.message || "Failed to load tasks.");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubTasks) unsubTasks();
    };
  }, [navigate]);

  const enriched = useMemo(() => {
    return tasks
      .map((t) => {
        const rid = String(t.requestId || t.id);
        const req = requestsMap[rid];
        const staffStatus = String(req?.staffStatus || "assigned");
        const staffTab = normalizeStaffTab(staffStatus);

        // NOTE: "New" means staff hasn't started work yet.
        // If you ever want "New" to ONLY include req.status === "new", add:
        // const statusOk = String(req?.status || "new").toLowerCase() === "new";
        // and filter on statusOk as well.
        return {
          task: t,
          rid,
          req,
          staffStatus,
          staffTab,
        };
      })
      .filter((x) => x.rid);
  }, [tasks, requestsMap]);

  const counts = useMemo(() => {
    const c = { new: 0, ongoing: 0, done: 0 };
    enriched.forEach((x) => {
      if (c[x.staffTab] != null) c[x.staffTab] += 1;
    });
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();

    return enriched
      .filter((x) => x.staffTab === tab)
      .filter((x) => {
        if (!q) return true;
        const r = x.req || {};
        return [
          r.track,
          r.country,
          r.requestType,
          r.serviceName,
          r.name,
          r.note,
          r.staffDecision,
          r.staffStatus,
          x.rid,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [enriched, tab, search]);

  const doLogout = async () => {
    try {
      setBusy("logout");
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Logout failed.");
    } finally {
      setBusy("");
    }
  };

  const tabBtnBase =
    "rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const tabBtnOn =
    "border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  const tabBtnOff =
    "border-zinc-200 bg-white/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60";

  const activeLabel = useMemo(() => {
    return TABS.find((t) => t.key === tab)?.label || "New";
  }, [tab]);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white pb-6 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-6">
          {/* Top row: Back + Logout */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]
                           dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100"
              >
                <IconChevronLeft className="h-4 w-4" />
                Back
              </button>

              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Your tasks
              </h1>

              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                New: {counts.new} • Ongoing: {counts.ongoing} • Done: {counts.done}
              </p>
            </div>

            <button
              type="button"
              onClick={doLogout}
              disabled={busy === "logout" || !uid}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/60 px-3.5 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-rose-200 hover:bg-rose-50/60 active:scale-[0.99] disabled:opacity-60
                         dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100"
              title="Logout"
            >
              <IconLogout className="h-5 w-5" />
              {busy === "logout" ? "Logging out…" : "Logout"}
            </button>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          {/* Tabs */}
          <div className="mt-6 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`${tabBtnBase} ${tab === t.key ? tabBtnOn : tabBtnOff}`}
                type="button"
              >
                {t.label}
                <span className="ml-2 rounded-full border border-zinc-200 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-700">
                  {t.key === "new" ? counts.new : t.key === "ongoing" ? counts.ongoing : counts.done}
                </span>
              </button>
            ))}
          </div>

          {/* Search + counters */}
          <div className="mt-5">
            <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Search
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2.5 shadow-sm backdrop-blur focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
              <IconSearch className="h-5 w-5 text-zinc-500" />
              <input
                className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                placeholder="Track, country, applicant, service, ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Showing{" "}
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {filtered.length}
                </span>{" "}
                in <span className="font-semibold">{activeLabel}</span>
              </span>

              <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                Tab: {activeLabel}
              </span>
            </div>
          </div>

          {/* States */}
          {loading ? (
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600 shadow-sm backdrop-blur">
              Loading…
            </div>
          ) : tasks.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600 shadow-sm backdrop-blur">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                No tasks assigned
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Wait for assignments from admin.
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600 shadow-sm backdrop-blur">
              No requests found in this tab.
            </div>
          ) : (
            <div className="mt-6 grid gap-3">
              {filtered.map(({ task, rid, req, staffStatus }) => {
                const tp = taskPillByStaffStatus(staffStatus);
                const rp = recPill(req?.staffDecision);

                const title = req
                  ? `${String(req.track || "").toUpperCase()} • ${req.country || "-"}`
                  : `Request • ${rid}`;

                const sub = req
                  ? String(req.requestType || "").toLowerCase() === "full"
                    ? "Full Package"
                    : `Single: ${req.serviceName || req.requestType || "-"}`
                  : "Loading request details…";

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => navigate(`/staff/request/${rid}`)}
                    className="w-full text-left rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-white hover:shadow-md active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {title}
                        </div>
                        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                          {sub}
                        </div>

                        {rp ? (
                          <div className="mt-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] leading-none font-semibold ${rp.cls}`}
                            >
                              {rp.label}
                            </span>
                          </div>
                        ) : null}

                        <div className="mt-2 text-[11px] text-zinc-500">
                          ID: <span className="font-mono">{rid}</span>
                        </div>
                      </div>

                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${tp.cls}`}>
                        {tp.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
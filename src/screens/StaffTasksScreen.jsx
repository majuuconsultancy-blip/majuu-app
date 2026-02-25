// ✅ StaffTasksScreen.jsx
// Staff task unread badges are derived only from published chat messages + readState.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useNotifsV2Store } from "../services/notifsV2Store";
import { smartBack } from "../utils/navBack";

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

function IconBell(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15 17H5.5a1 1 0 0 1-.8-1.6l1.1-1.5a3 3 0 0 0 .6-1.8V10a5.5 5.5 0 1 1 11 0v2.1a3 3 0 0 0 .6 1.8l1.1 1.5a1 1 0 0 1-.8 1.6H15Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10.2 19a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Pills ---------- */
function taskPillByStaffStatus(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "done") {
    return {
      label: "Done",
      cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
    };
  }
  if (s === "in_progress") {
    return {
      label: "Ongoing",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }
  return {
    label: "New",
    cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800",
  };
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
  const [requestsMap, setRequestsMap] = useState({});
  const [uid, setUid] = useState("");
  const [busy, setBusy] = useState("");

  // Global unread source-of-truth (driven by notifsV2Engine)
  const unreadByRequest = useNotifsV2Store((s) => s.unreadByRequest);
  const unreadNotifCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);

  // ✅ entrance animation
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);

  // ✅ prevent setState after unmount during async request detail fetch
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // keep URL state in sync
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
          if (!aliveRef.current) return;
          setTasks(list);

          const nextMap = {};
          await Promise.all(
            list.map(async (t) => {
              const rid = String(t.requestId || t.id);
              if (!rid) return;
              try {
                const rSnap = await getDoc(doc(db, "serviceRequests", rid));
                if (rSnap.exists()) nextMap[rid] = { id: rSnap.id, ...rSnap.data() };
              } catch {
                // ignore per-item
              }
            })
          );

          if (!aliveRef.current) return;
          setRequestsMap(nextMap);
          setLoading(false);
        },
        (e) => {
          console.error(e);
          if (!aliveRef.current) return;
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

        return { task: t, rid, req, staffStatus, staffTab };
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

  // ✅ unread “requests count” per tab (not messages)
  const unreadCountsByTab = useMemo(() => {
    const c = { new: 0, ongoing: 0, done: 0 };
    if (!unreadByRequest || Object.keys(unreadByRequest).length === 0) return c;

    enriched.forEach((x) => {
      if (!unreadByRequest?.[x.rid]?.unread) return;
      if (c[x.staffTab] != null) c[x.staffTab] += 1;
    });

    return c;
  }, [enriched, unreadByRequest]);

  const unreadInActiveTab = unreadCountsByTab[tab] || 0;

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
    "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900";

  const activeLabel = useMemo(() => {
    return TABS.find((t) => t.key === tab)?.label || "New";
  }, [tab]);

  const softBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const enterWrap =
    "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  const floatCard =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60";

  return (
    <div className={`min-h-screen ${softBg}`}>
      <div className={`max-w-xl mx-auto px-5 py-6 pb-10 ${enterWrap} ${enterCls}`}>
        {/* Sticky top bar */}
        <div className="sticky top-0 z-10 -mx-5 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-950/40">
          {/* Top row: Back + Logout */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <button
                type="button"
                onClick={() => smartBack(navigate, "/staff/tasks")}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
              >
                <IconChevronLeft className="h-4 w-4" />
                Back
              </button>

              <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Your tasks
              </h1>

              <button
                type="button"
                onClick={() => navigate("/staff/notifications")}
                className="relative mt-3 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                title="Notifications"
              >
                <span className="relative inline-flex items-center">
                  <IconBell className="h-4 w-4" />
                  {unreadNotifCount > 0 ? (
                    <span
                      className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-500"
                      aria-label="Unread notifications"
                    />
                  ) : null}
                </span>
                Notifications
              </button>

              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                New: {counts.new} • Ongoing: {counts.ongoing} • Done: {counts.done}
              </p>
            </div>

            <button
              type="button"
              onClick={doLogout}
              disabled={busy === "logout" || !uid}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-rose-200 hover:bg-rose-50/60 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
              title="Logout"
            >
              <IconLogout className="h-5 w-5" />
              {busy === "logout" ? "Logging out…" : "Logout"}
            </button>
          </div>

          {/* subtle divider */}
          <div className="mt-4 h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-zinc-700/70" />
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`${tabBtnBase} ${tab === t.key ? tabBtnOn : tabBtnOff}`}
              type="button"
            >
              {t.label}
              <span className="ml-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                {t.key === "new" ? counts.new : t.key === "ongoing" ? counts.ongoing : counts.done}
              </span>

              {/* unread request badge per tab */}
              {unreadCountsByTab[t.key] > 0 ? (
                <span className="ml-2 rounded-full border border-amber-200 bg-amber-50/70 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                  {unreadCountsByTab[t.key]}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* banner for active tab */}
        {unreadInActiveTab > 0 ? (
          <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 shadow-sm">
            <div className="font-semibold">
              New messages in{" "}
              <span className="rounded-full border border-amber-200 bg-white/60 dark:bg-zinc-900/60 px-2 py-0.5 text-[12px] font-bold">
                {unreadInActiveTab}
              </span>{" "}
              {unreadInActiveTab === 1 ? "request" : "requests"}
            </div>
            <div className="mt-1 text-xs text-amber-900/80">
              Open chat inside a request to clear it.
            </div>
          </div>
        ) : null}

        {/* Search */}
        <div className="mt-5">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Search
          </label>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 shadow-sm backdrop-blur transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100/80 dark:border-zinc-800 dark:bg-zinc-900/60 dark:focus-within:ring-emerald-300/20">
            <IconSearch className="h-5 w-5 text-zinc-500" />
            <input
              className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
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

            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              Tab: {activeLabel}
            </span>
          </div>
        </div>

        {/* States */}
        {loading ? (
          <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
            Loading…
          </div>
        ) : tasks.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              No tasks assigned
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Wait for assignments from admin.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
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

              const sNorm = String(req?.staffStatus || "assigned").toLowerCase();
              const goTo =
                sNorm === "in_progress" || sNorm === "done"
                  ? `/staff/request/${rid}`
                  : `/staff/request/${rid}/start`;

              const hasUnread = Boolean(unreadByRequest?.[rid]?.unread);

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={async () => {
                    navigate(goTo);
                  }}
                  className={floatCard}
                >
                  <div className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {title}
                        </div>

                        {hasUnread ? (
                          <span
                            className="inline-flex h-2.5 w-2.5 rounded-full bg-rose-500"
                            aria-label="Unread chat"
                            title="Unread chat"
                          />
                        ) : null}
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

                      <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
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
  );
}

// ✅ AdminRequestsScreen.jsx (FULL COPY-PASTE)
// Stable fix:
// ✅ Filters kept (date range, assigned, staff status, staff recommendation)
// ✅ RED DOTS are now GLOBAL + CONSISTENT:
//    - Uses collectionGroup("pendingMessages") where status=="pending" to know which requests have new messages
//    - For those requestIds, listens to serviceRequests/<id> to classify the correct tab (new/assigned/closed/rejected)
// ✅ No caching based on visited tabs. No per-tab listener teardown flicker.
//
// Notes:
// - If you expect >1000 pending messages at once, increase LIMIT_PENDING.
// - This is frontend-only; your services untouched.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getRequests } from "../services/adminrequestservice";
import { setStaffAccessByEmail } from "../services/staffservice";

import {
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "../firebase";

import { motion, AnimatePresence } from "../utils/motionProxy";
import {
  RefreshCw,
  Search,
  ChevronRight,
  ChevronDown,
  UserPlus,
  UserX,
  SlidersHorizontal,
  X,
  Calendar,
} from "lucide-react";

// ✅ 4 tabs: New / Accepted / Rejected / Assigned
const TABS = [
  { key: "new", label: "New" },
  { key: "closed", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "assigned", label: "Assigned" },
];

const LIMIT_PENDING = 1000;

/* ---------- UI helpers ---------- */
function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new")
    return { label: "New", cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
  if (s === "contacted")
    return {
      label: "In Progress",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  if (s === "closed")
    return {
      label: "Accepted",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  if (s === "rejected")
    return { label: "Rejected", cls: "bg-rose-50 text-rose-700 border border-rose-100" };
  return { label: s, cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
}

function staffPill(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "in_progress") {
    return {
      label: "Staff: In progress",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  }
  if (s === "done") {
    return {
      label: "Staff: Done",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }
  return { label: "Staff: Assigned", cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
}

function staffRecPill(staffDecision) {
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
  return null; // none / not decided
}

function isValidTabKey(key) {
  const k = String(key || "").toLowerCase();
  return TABS.some((t) => t.key === k);
}

function formatShortTS(ts) {
  const sec = ts?.seconds;
  if (!sec) return "";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function getCreatedAtMs(r) {
  const s = r?.createdAt?.seconds;
  if (!s) return 0;
  return s * 1000;
}

function dayStartMs(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return 0;
  const [y, m, d] = String(yyyy_mm_dd).split("-").map((x) => Number(x));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function dayEndMs(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return 0;
  const [y, m, d] = String(yyyy_mm_dd).split("-").map((x) => Number(x));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/* ---------- ✅ stable tab classifier ---------- */
function classifyTabFromRequestDoc(data) {
  const st = String(data?.status || "new").toLowerCase();
  const assignedTo = String(data?.assignedTo || "").trim();

  if (st === "closed") return "closed";
  if (st === "rejected") return "rejected";

  // conceptually Assigned tab = assignedTo + status still active
  if ((st === "new" || st === "contacted") && assignedTo) return "assigned";

  // active but unassigned -> New tab
  return "new";
}

/* ---------- ✅ Staff panel (smaller + collapsible) ---------- */
function StaffAccessPanel() {
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [maxActive, setMaxActive] = useState(2);
  const [specText, setSpecText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const specialities = useMemo(() => {
    return String(specText || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [specText]);

  const shell =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/65 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition dark:border-zinc-800 dark:bg-zinc-900/40";
  const headerBtn =
    "w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition active:scale-[0.99]";
  const smallTitle = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
  const smallSub = "mt-0.5 text-xs text-zinc-500 dark:text-zinc-400";

  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:focus:ring-emerald-500/10";
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const grantBtn =
    "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const revokeBtn =
    "border border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/25 dark:text-rose-200 dark:border-rose-900/40 dark:hover:bg-rose-950/35";

  const run = async (action) => {
    setErr("");
    setMsg("");

    const safeEmail = String(email || "").trim().toLowerCase();
    if (!safeEmail || !safeEmail.includes("@")) {
      setErr("Enter a valid email.");
      return;
    }

    try {
      setBusy(action);

      const res = await setStaffAccessByEmail({
        email: safeEmail,
        action, // "grant" | "revoke"
        maxActive: Number(maxActive) || 2,
        specialities,
      });

      setMsg(action === "grant" ? `✅ Staff enabled: ${res.email}` : `✅ Staff revoked: ${res.email}`);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to update staff access.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-5">
      <div className={`${shell} overflow-hidden`}>
        <button type="button" onClick={() => setOpen((v) => !v)} className={headerBtn}>
          <div className="min-w-0">
            <div className={smallTitle}>Staff Hire System</div>
            <div className={smallSub}>{open ? "Add/remove staff access." : "Tap to expand"}</div>
          </div>

          <div className="shrink-0 inline-flex items-center gap-2">
            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              Staff
            </span>

            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 ${
                open ? "rotate-180" : "rotate-0"
              }`}
            >
              <ChevronDown className="h-5 w-5" />
            </span>
          </div>
        </button>

        <div className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4">
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/45">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  The staff member must already be signed up in the app to be activated.
                </div>

                {err ? (
                  <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                    {err}
                  </div>
                ) : null}

                {msg ? (
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    {msg}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3">
                  <input
                    className={input}
                    placeholder="staff@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <input
                      className={input}
                      type="number"
                      min={1}
                      max={10}
                      value={maxActive}
                      onChange={(e) => setMaxActive(e.target.value)}
                      placeholder="maxActive"
                    />
                    <input
                      className={input}
                      value={specText}
                      onChange={(e) => setSpecText(e.target.value)}
                      placeholder="specialities (comma separated)"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => run("grant")}
                      disabled={busy === "grant" || busy === "revoke"}
                      className={`${btnBase} ${grantBtn}`}
                    >
                      <UserPlus className="h-5 w-5" />
                      {busy === "grant" ? "Granting…" : "Grant"}
                    </button>

                    <button
                      type="button"
                      onClick={() => run("revoke")}
                      disabled={busy === "grant" || busy === "revoke"}
                      className={`${btnBase} ${revokeBtn}`}
                    >
                      <UserX className="h-5 w-5" />
                      {busy === "revoke" ? "Revoking…" : "Revoke"}
                    </button>
                  </div>

                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Uses query to find UID by email.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-emerald-500/20" />
        </div>
      </div>
    </div>
  );
}

/* ---------- Motion ---------- */
const pageIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: "easeOut" } },
};
const listWrap = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};
const listItem = {
  hidden: { opacity: 0, y: 10, scale: 0.995 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 520, damping: 42 } },
};

export default function AdminRequestsScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabFromUrl = searchParams.get("tab");
  const qFromUrl = searchParams.get("q") || "";

  const [status, setStatus] = useState(isValidTabKey(tabFromUrl) ? tabFromUrl : "new");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState(String(qFromUrl));

  // ✅ Filter UI (minimal popover beside search)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    from: "", // yyyy-mm-dd
    to: "", // yyyy-mm-dd
    assigned: "any", // any | assigned | unassigned
    staffDecision: "any", // any | recommend_accept | recommend_reject | none
    staffStatus: "any", // any | assigned | in_progress | done
  });

  // ✅ subtle entrance
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);

  // ✅ Keep URL synced (tab + q only)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", status);

    const trimmed = String(search || "").trim();
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  const load = async () => {
    setLoading(true);
    setMsg("");

    try {
      if (status === "assigned") {
        const [newOnes, contactedOnes] = await Promise.all([
          getRequests({ status: "new", max: 200 }).catch(() => []),
          getRequests({ status: "contacted", max: 200 }).catch(() => []),
        ]);

        const merged = [
          ...(Array.isArray(newOnes) ? newOnes : []),
          ...(Array.isArray(contactedOnes) ? contactedOnes : []),
        ];

        const assigned = merged.filter((r) => {
          const assignedTo = String(r?.assignedTo || "").trim();
          const st = String(r?.status || "").toLowerCase();
          return assignedTo && st !== "closed" && st !== "rejected";
        });

        const map = new Map();
        assigned.forEach((r) => map.set(r.id, r));
        setItems(Array.from(map.values()));
        return;
      }

      const data = await getRequests({ status, max: 120 });
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setMsg(e?.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /* ---------- ✅ GLOBAL new-message dots (fixed) ---------- */
  const [pendingSet, setPendingSet] = useState(() => new Set()); // Set<requestId>
  const reqDocUnsubsRef = useRef({}); // { [rid]: () => void }
  const [reqMetaById, setReqMetaById] = useState({}); // { [rid]: { status, assignedTo, tabKey } }

  // 1) One global listener: collectionGroup pendingMessages (status == pending)
  useEffect(() => {
    const cg = collectionGroup(db, "pendingMessages");
    const qy = query(cg, where("status", "==", "pending"), limit(LIMIT_PENDING));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const next = new Set();

        snap.docs.forEach((d) => {
          // path: serviceRequests/<rid>/pendingMessages/<mid>
          const parts = d.ref.path.split("/");
          const i = parts.indexOf("serviceRequests");
          const rid = i >= 0 ? String(parts[i + 1] || "") : "";
          if (rid) next.add(rid);
        });

        setPendingSet(next);
      },
      (err) => {
        console.error("pendingMessages collectionGroup listener error:", err);
        // keep old set rather than wiping (prevents flicker)
      }
    );

    return () => unsub();
  }, []);

  // 2) For each rid in pendingSet, listen to its serviceRequests doc to classify which tab it belongs to
  useEffect(() => {
    const need = Array.from(pendingSet || []);
    const existing = reqDocUnsubsRef.current || {};

    // remove listeners no longer needed
    Object.keys(existing).forEach((rid) => {
      if (!need.includes(rid)) {
        try { existing[rid]?.(); } catch {}
        delete existing[rid];
        setReqMetaById((prev) => {
          if (!prev[rid]) return prev;
          const n = { ...prev };
          delete n[rid];
          return n;
        });
      }
    });

    // add listeners for new rids
    need.forEach((rid) => {
      if (existing[rid]) return;

      const rRef = doc(db, "serviceRequests", rid);
      const unsub = onSnapshot(
        rRef,
        (snap) => {
          const data = snap.exists() ? snap.data() : null;
          if (!data) {
            setReqMetaById((prev) => {
              if (!prev[rid]) return prev;
              const n = { ...prev };
              delete n[rid];
              return n;
            });
            return;
          }

          const tabKey = classifyTabFromRequestDoc(data);
          const st = String(data?.status || "new").toLowerCase();
          const assignedTo = String(data?.assignedTo || "").trim();

          setReqMetaById((prev) => {
            const prevOne = prev[rid];
            if (
              prevOne &&
              prevOne.tabKey === tabKey &&
              prevOne.status === st &&
              prevOne.assignedTo === assignedTo
            ) {
              return prev;
            }
            return { ...prev, [rid]: { tabKey, status: st, assignedTo } };
          });
        },
        (err) => {
          console.error("serviceRequests doc listen error:", rid, err);
        }
      );

      existing[rid] = unsub;
    });

    reqDocUnsubsRef.current = existing;

    return () => {
      // don't tear down here — we manage add/remove above
    };
  }, [pendingSet]);

  // cleanup doc listeners on unmount
  useEffect(() => {
    return () => {
      const m = reqDocUnsubsRef.current || {};
      Object.keys(m).forEach((rid) => {
        try { m[rid]?.(); } catch {}
      });
      reqDocUnsubsRef.current = {};
    };
  }, []);

  const tabHasDot = useMemo(() => {
    const out = { new: false, closed: false, rejected: false, assigned: false };
    (pendingSet ? Array.from(pendingSet) : []).forEach((rid) => {
      const tk = reqMetaById?.[rid]?.tabKey;
      if (tk && out[tk] !== undefined) out[tk] = true;
    });
    return out;
  }, [pendingSet, reqMetaById]);

  /* ---------- Search + Filters ---------- */
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;

    return (items || []).filter((r) =>
      [
        r.track,
        r.country,
        r.requestType,
        r.serviceName,
        r.name,
        r.phone,
        r.email,
        r.note,
        r.status,
        r.staffStatus,
        r.staffDecision,
        r.assignedTo,
        r.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, search]);

  const filtered = useMemo(() => {
    const fromMs = dayStartMs(filters.from);
    const toMs = dayEndMs(filters.to);

    return (searched || []).filter((r) => {
      const createdMs = getCreatedAtMs(r);

      if (fromMs && createdMs && createdMs < fromMs) return false;
      if (toMs && createdMs && createdMs > toMs) return false;

      const assignedTo = String(r?.assignedTo || "").trim();
      const staffStatus = String(r?.staffStatus || "").toLowerCase();
      const staffDecision = String(r?.staffDecision || "").toLowerCase();

      if (filters.assigned === "assigned" && !assignedTo) return false;
      if (filters.assigned === "unassigned" && assignedTo) return false;

      if (filters.staffStatus !== "any") {
        if (!assignedTo) return false;
        const want = filters.staffStatus;
        const normalized = staffStatus || "assigned";
        if (normalized !== want) return false;
      }

      if (filters.staffDecision !== "any") {
        if (!assignedTo) return false;
        if (filters.staffDecision === "none") {
          if (staffDecision && staffDecision !== "none") return false;
        } else {
          if (staffDecision !== filters.staffDecision) return false;
        }
      }

      return true;
    });
  }, [searched, filters]);

  const activeLabel = useMemo(() => {
    return TABS.find((t) => t.key === status)?.label || String(status).toUpperCase();
  }, [status]);

  const openRequest = (id) => {
    const q = String(search || "").trim();
    const qs = new URLSearchParams();
    qs.set("tab", status);
    if (q) qs.set("q", q);
    navigate(`/app/admin/request/${id}?${qs.toString()}`);
  };

  const softBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const enterWrap = "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-900/45";
  const tile =
    "w-full text-left rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/45 dark:hover:border-emerald-900/40";

  const tabBtnBase =
    "rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const tabBtnOn =
    "border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  const tabBtnOff =
    "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100 dark:hover:bg-zinc-900";

  const anyFiltersActive = useMemo(() => {
    return (
      !!filters.from ||
      !!filters.to ||
      filters.assigned !== "any" ||
      filters.staffDecision !== "any" ||
      filters.staffStatus !== "any"
    );
  }, [filters]);

  const resetFilters = () => {
    setFilters({
      from: "",
      to: "",
      assigned: "any",
      staffDecision: "any",
      staffStatus: "any",
    });
  };

  const RedDot = ({ className = "" }) => (
    <span
      className={`inline-flex h-2.5 w-2.5 rounded-full bg-rose-600 shadow-[0_0_0_3px_rgba(244,63,94,0.12)] ${className}`}
      aria-hidden="true"
    />
  );

  return (
    <div className={`min-h-screen ${softBg}`}>
      <motion.div variants={pageIn} initial="hidden" animate="show" className={`px-5 py-6 ${enterWrap} ${enterCls}`}>
        {/* Sticky header */}
        <div className="sticky top-0 z-20 -mx-5 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-950/40">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Admin Page
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Manage incoming requests, assignments and decisions.
              </p>
            </div>

            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/45 dark:text-zinc-100 dark:hover:bg-zinc-900"
              type="button"
            >
              <RefreshCw className="h-5 w-5 text-emerald-700 dark:text-emerald-200" />
              Refresh
            </button>
          </div>

          <div className="mt-3 h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-emerald-500/20" />
        </div>

        {/* Staff access panel */}
        <StaffAccessPanel />

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const showDot = !!tabHasDot?.[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                className={`${tabBtnBase} ${status === t.key ? tabBtnOn : tabBtnOff}`}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  {t.label}
                  {showDot ? <RedDot className="translate-y-[1px]" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + Filters */}
        <div className="mt-5">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Search</label>

          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 shadow-sm backdrop-blur transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-900/45 dark:focus-within:ring-emerald-500/10">
              <Search className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
              <input
                className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 dark:text-zinc-100"
                placeholder="Track, country, name, email, ID, staff…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={`relative inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition active:scale-[0.99]
                ${
                  anyFiltersActive
                    ? "border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-900/45 dark:text-zinc-100 dark:hover:bg-zinc-900"
                }`}
              title="Filters"
            >
              <SlidersHorizontal className="h-5 w-5" />
              Filter
              {anyFiltersActive ? (
                <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
                  !
                </span>
              ) : null}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Showing{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">{filtered.length}</span>{" "}
              of{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">{items.length}</span>
            </span>

            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              Tab: {activeLabel}
            </span>
          </div>

          {/* Filters popover */}
          <AnimatePresence>
            {filtersOpen ? (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.99 }}
                transition={{ duration: 0.16 }}
                className="mt-3 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/75 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Filters</div>

                  <div className="flex items-center gap-2">
                    {anyFiltersActive ? (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100"
                      >
                        Reset
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-2 text-zinc-700 dark:text-zinc-300 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200"
                      aria-label="Close filters"
                      title="Close"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      From
                      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/45">
                        <Calendar className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        <input
                          type="date"
                          value={filters.from}
                          onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
                          className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none dark:text-zinc-100"
                        />
                      </div>
                    </label>

                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      To
                      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/45">
                        <Calendar className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        <input
                          type="date"
                          value={filters.to}
                          onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
                          className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none dark:text-zinc-100"
                        />
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Assigned
                      <select
                        value={filters.assigned}
                        onChange={(e) => setFilters((p) => ({ ...p, assigned: e.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                      >
                        <option value="any">Any</option>
                        <option value="assigned">Assigned</option>
                        <option value="unassigned">Unassigned</option>
                      </select>
                    </label>

                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Staff status
                      <select
                        value={filters.staffStatus}
                        onChange={(e) => setFilters((p) => ({ ...p, staffStatus: e.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                      >
                        <option value="any">Any</option>
                        <option value="assigned">assigned</option>
                        <option value="in_progress">in_progress</option>
                        <option value="done">done</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Recommendation
                      <select
                        value={filters.staffDecision}
                        onChange={(e) => setFilters((p) => ({ ...p, staffDecision: e.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                      >
                        <option value="any">Any</option>
                        <option value="recommend_accept">recommend_accept</option>
                        <option value="recommend_reject">recommend_reject</option>
                        <option value="none">none</option>
                      </select>
                    </label>

                    <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Soon...
                      <div className="mt-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                        More filters to come.
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* States */}
        {loading ? (
          <div className={`mt-6 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Loading…</div>
        ) : msg ? (
          <div className="mt-6 rounded-3xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
            {msg}
          </div>
        ) : filtered.length === 0 ? (
          <div className={`mt-6 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>No requests found.</div>
        ) : (
          <motion.div variants={listWrap} initial="hidden" animate="show" className="mt-6 grid gap-3">
            {filtered.map((r) => {
              const p = pill(r.status);
              const left = `${String(r.track || "").toUpperCase()} • ${r.country || "-"}`;
              const right = r.requestType === "full" ? "Full Package" : `Single: ${r.serviceName || "-"}`;

              const rid = String(r.id || "");
              const assignedTo = String(r?.assignedTo || "").trim();
              const staffStatus = String(r?.staffStatus || "").trim();
              const staffDecision = String(r?.staffDecision || "").trim();
              const staffUpdatedAt = formatShortTS(r?.staffUpdatedAt);

              const sp = assignedTo ? staffPill(staffStatus || "assigned") : null;
              const rp = assignedTo ? staffRecPill(staffDecision) : null;

              const hasNew = pendingSet?.has(rid);

              return (
                <motion.button
                  key={r.id}
                  variants={listItem}
                  type="button"
                  onClick={() => openRequest(r.id)}
                  className={`${tile} relative overflow-hidden`}
                >
                  {hasNew ? (
                    <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-rose-600/80" />
                  ) : null}

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{left}</div>
                        {hasNew ? <RedDot /> : null}
                      </div>

                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{right}</div>

                      {assignedTo ? (
                        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                          Assigned to:{" "}
                          <span className="font-mono text-zinc-800 dark:text-zinc-100">{assignedTo}</span>
                          {staffUpdatedAt ? (
                            <span className="ml-2 text-zinc-500 dark:text-zinc-400">• Updated: {staffUpdatedAt}</span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        ID: <span className="font-mono">{r.id}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 max-w-[190px]">
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${p.cls}`}>{p.label}</span>

                      {sp ? (
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sp.cls}`}>
                          {sp.label}
                        </span>
                      ) : null}

                      {rp ? (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${rp.cls}`}
                          title="Staff recommendation"
                        >
                          {rp.label}
                        </span>
                      ) : null}

                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 dark:hover:bg-zinc-900">
                        <ChevronRight className="h-5 w-5" />
                      </span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        )}

        <div className="h-10" />
      </motion.div>
    </div>
  );
}


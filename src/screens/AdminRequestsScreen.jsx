import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getRequests } from "../services/adminrequestservice";

// ✅ Only 3 tabs: New / Accepted / Rejected (Accepted maps to status "closed")
const TABS = [
  { key: "new", label: "New" },
  { key: "closed", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
];

/* ---------- Minimal icons (no emojis) ---------- */
function IconRefresh(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 4.8v5.2h-5.2"
        stroke="currentColor"
        strokeWidth="1.8"
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

/* ---------- UI helpers ---------- */
function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new")
    return {
      label: "New",
      cls: "bg-zinc-100 text-zinc-700 border border-zinc-200",
    };
  if (s === "closed")
    return {
      label: "Accepted",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  if (s === "rejected")
    return {
      label: "Rejected",
      cls: "bg-rose-50 text-rose-700 border border-rose-100",
    };
  return {
    label: s,
    cls: "bg-zinc-100 text-zinc-700 border border-zinc-200",
  };
}

export default function AdminRequestsScreen() {
  const navigate = useNavigate();

  // status is still "new" | "closed" | "rejected" (closed = Accepted)
  const [status, setStatus] = useState("new");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setMsg("");
    try {
      const data = await getRequests({ status, max: 100 });
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;

    return items.filter((r) =>
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
        r.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, search]);

  const tabBtnBase =
    "rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const tabBtnOn =
    "border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  const tabBtnOff =
    "border-zinc-200 bg-white/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60";

  const activeLabel = useMemo(() => {
    return TABS.find((t) => t.key === status)?.label || String(status).toUpperCase();
  }, [status]);

  return (
    <div className="min-h-screen bg-white">
      <div className="px-5 py-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Admin Requests
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Manage incoming requests and decisions.
            </p>
          </div>

          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
            type="button"
          >
            <IconRefresh className="h-5 w-5 text-emerald-700" />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`${tabBtnBase} ${status === t.key ? tabBtnOn : tabBtnOff}`}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="mt-5">
          <label className="text-sm font-semibold text-zinc-900">Search</label>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2.5 shadow-sm backdrop-blur focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
            <IconSearch className="h-5 w-5 text-zinc-500" />
            <input
              className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
              placeholder="Track, country, name, email, ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              Showing{" "}
              <span className="font-semibold text-zinc-700">{filtered.length}</span>{" "}
              of <span className="font-semibold text-zinc-700">{items.length}</span>
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
        ) : msg ? (
          <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700 shadow-sm">
            {msg}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600 shadow-sm backdrop-blur">
            No requests found.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {filtered.map((r) => {
              const p = pill(r.status);
              const left = `${String(r.track || "").toUpperCase()} • ${r.country || "-"}`;
              const right =
                r.requestType === "full"
                  ? "Full Package"
                  : `Single: ${r.serviceName || "-"}`;

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(`/app/admin/request/${r.id}`)}
                  className="w-full text-left rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-white hover:shadow-md active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-zinc-900">{left}</div>
                      <div className="mt-1 text-sm text-zinc-600">{right}</div>
                      <div className="mt-2 text-[11px] text-zinc-500">
                        ID: <span className="font-mono">{r.id}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${p.cls}`}>
                        {p.label}
                      </span>

                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/60 text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-800">
                        <IconChevronRight className="h-5 w-5" />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
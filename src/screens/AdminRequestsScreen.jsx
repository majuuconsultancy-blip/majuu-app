// ✅ AdminRequestsScreen.jsx (FULL COPY-PASTE)
// UI-only improvements:
// - ✅ Staff Hire System made smaller + collapsible (mini panel) to reduce visual weight
// - ✅ Subtle “apple-ish” entrance + floaty cards (CSS-only, no deps)
// - ✅ More premium background + softer shadows + hover lift
// - ✅ Sticky top header (mobile friendly) so Refresh/Search feel easier
// - ✅ Same backend calls untouched: getRequests(), setStaffAccessByEmail()

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getRequests } from "../services/adminrequestservice";
import { setStaffAccessByEmail } from "../services/staffservice";

// ✅ Now 4 tabs: New / Accepted / Rejected / Assigned
// "Assigned" shows any request with assignedTo present AND not finalized.
const TABS = [
  { key: "new", label: "New" },
  { key: "closed", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "assigned", label: "Assigned" },
];

/* ---------- Minimal icons ---------- */
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

function IconChevronDown(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 9.5 12 15l5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUserPlus(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M16 21a6 6 0 0 0-12 0" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M19 8v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconUserOff(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M16 21a6 6 0 0 0-12 0" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M16 8l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M22 8l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- UI helpers ---------- */
function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new")
    return { label: "New", cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
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
  return { label: s, cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
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
  return { label: "Staff: Assigned", cls: "bg-zinc-100 text-zinc-700 border border-zinc-200" };
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
    "rounded-3xl border border-zinc-200 bg-white/65 shadow-sm backdrop-blur transition";
  const headerBtn =
    "w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition active:scale-[0.99]";
  const smallTitle = "text-sm font-semibold text-zinc-900";
  const smallSub = "mt-0.5 text-xs text-zinc-500";

  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60";
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const grantBtn = "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const revokeBtn = "border border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100";

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
        {/* mini header */}
        <button type="button" onClick={() => setOpen((v) => !v)} className={headerBtn}>
          <div className="min-w-0">
            <div className={smallTitle}>Staff Hire System</div>
            <div className={smallSub}>
              {open ? "Add/remove staff access." : "Tap to expand"}
            </div>
          </div>
          <div className="shrink-0 inline-flex items-center gap-2">
            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
              Staff
            </span>
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 bg-white/60 text-zinc-700 transition ${
                open ? "rotate-180" : "rotate-0"
              }`}
            >
              <IconChevronDown className="h-5 w-5" />
            </span>
          </div>
        </button>

        {/* collapsible body */}
        <div
          className={`grid transition-all duration-300 ease-out ${
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 pb-4">
              <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
                <div className="text-xs text-zinc-500">
                  The staff member must already be signed up in the app to be activated.
                </div>

                {err ? (
                  <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
                    {err}
                  </div>
                ) : null}

                {msg ? (
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-800">
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
                      <IconUserPlus className="h-5 w-5" />
                      {busy === "grant" ? "Granting…" : "Grant"}
                    </button>

                    <button
                      type="button"
                      onClick={() => run("revoke")}
                      disabled={busy === "grant" || busy === "revoke"}
                      className={`${btnBase} ${revokeBtn}`}
                    >
                      <IconUserOff className="h-5 w-5" />
                      {busy === "revoke" ? "Revoking…" : "Revoke"}
                    </button>
                  </div>

                  <div className="text-[11px] text-zinc-500">
                    Uses query to find UID by email.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* tiny footer sparkle */}
        <div className="px-4 pb-3">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent" />
        </div>
      </div>
    </div>
  );
}

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

  // ✅ subtle “apple-ish” entrance
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);

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
      // ✅ Assigned tab: pull NEW + CONTACTED, then filter assignedTo only (and not finalized).
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

        // de-dupe by id
        const map = new Map();
        assigned.forEach((r) => map.set(r.id, r));
        setItems(Array.from(map.values()));
        return;
      }

      // normal tabs
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

  const tabBtnBase =
    "rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const tabBtnOn =
    "border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  const tabBtnOff =
    "border-zinc-200 bg-white/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60";

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
    "bg-gradient-to-b from-emerald-50/40 via-white to-white";
  const enterWrap =
    "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  // floaty tiles
  const card =
    "rounded-3xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur transition duration-300 ease-out";
  const tile =
    "w-full text-left rounded-3xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99]";

  return (
    <div className={`min-h-screen ${softBg}`}>
      <div className={`px-5 py-6 ${enterWrap} ${enterCls}`}>
        {/* Sticky header */}
        <div className="sticky top-0 z-10 -mx-5 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
                Admin Page
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Manage incoming application requests and decisions.
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

          {/* subtle divider */}
          <div className="mt-3 h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent" />
        </div>

        {/* Staff access panel (smaller) */}
        <StaffAccessPanel />

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
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2.5 shadow-sm backdrop-blur transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
            <IconSearch className="h-5 w-5 text-zinc-500" />
            <input
              className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
              placeholder="Track, country, name, email, ID, staff…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>
              Showing <span className="font-semibold text-zinc-700">{filtered.length}</span> of{" "}
              <span className="font-semibold text-zinc-700">{items.length}</span>
            </span>
            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
              Tab: {activeLabel}
            </span>
          </div>
        </div>

        {/* States */}
        {loading ? (
          <div className={`mt-6 ${card} p-4 text-sm text-zinc-600`}>
            Loading…
          </div>
        ) : msg ? (
          <div className="mt-6 rounded-3xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700 shadow-sm">
            {msg}
          </div>
        ) : filtered.length === 0 ? (
          <div className={`mt-6 ${card} p-4 text-sm text-zinc-600`}>
            No requests found.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {filtered.map((r) => {
              const p = pill(r.status);
              const left = `${String(r.track || "").toUpperCase()} • ${r.country || "-"}`;
              const right =
                r.requestType === "full" ? "Full Package" : `Single: ${r.serviceName || "-"}`;

              const assignedTo = String(r?.assignedTo || "").trim();
              const staffStatus = String(r?.staffStatus || "").trim();
              const staffDecision = String(r?.staffDecision || "").trim();

              // ✅ Your Staff screen always updates staffUpdatedAt. Use that as "last update"
              const staffUpdatedAt = formatShortTS(r?.staffUpdatedAt);

              const sp = assignedTo ? staffPill(staffStatus || "assigned") : null;
              const rp = assignedTo ? staffRecPill(staffDecision) : null;

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => openRequest(r.id)}
                  className={tile}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-900">{left}</div>
                      <div className="mt-1 text-sm text-zinc-600">{right}</div>

                      {assignedTo ? (
                        <div className="mt-2 text-xs text-zinc-600">
                          Assigned to:{" "}
                          <span className="font-mono text-zinc-800">{assignedTo}</span>
                          {staffUpdatedAt ? (
                            <span className="ml-2 text-zinc-500">• Updated: {staffUpdatedAt}</span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-2 text-[11px] text-zinc-500">
                        ID: <span className="font-mono">{r.id}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 max-w-[170px]">
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${p.cls}`}>
                        {p.label}
                      </span>

                      {sp ? (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sp.cls}`}
                        >
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

                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-3xl border border-zinc-200 bg-white/60 text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-800">
                        <IconChevronRight className="h-5 w-5" />
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="h-10" />
      </div>
    </div>
  );
}
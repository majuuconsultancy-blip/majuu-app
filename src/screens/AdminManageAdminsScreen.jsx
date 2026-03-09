import { useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Save, ShieldOff } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  KENYA_COUNTY_OPTIONS,
  getNearbyCountySuggestions,
  normalizeCountyList,
} from "../constants/kenyaCounties";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  listAssignedAdmins,
  setAssignedAdminByEmail,
} from "../services/assignedadminservice";
import { smartBack } from "../utils/navBack";

function safeStr(value) {
  return String(value || "").trim();
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function timeoutToUnit(minutes) {
  const raw = Number(minutes);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { value: "", unit: "minutes" };
  }
  const n = toBoundedInt(raw, 0, 5, 240);
  if (n >= 60 && n % 60 === 0) {
    return { value: n / 60, unit: "hours" };
  }
  return { value: n, unit: "minutes" };
}

function timeoutToMinutes(value, unit) {
  const base = Number(value || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const cleanUnit = safeStr(unit).toLowerCase();
  const raw = cleanUnit === "hours" ? base * 60 : base;
  return toBoundedInt(raw, 0, 5, 240);
}

function makeDraft(row) {
  const scope = row?.adminScope || {};
  const timeout = timeoutToUnit(scope?.responseTimeoutMinutes);
  const maxActiveRaw = Number(scope?.maxActiveRequests);
  return {
    availability: safeStr(scope?.availability || "active").toLowerCase() || "active",
    town: safeStr(scope?.town),
    counties: normalizeCountyList(scope?.counties || []),
    countySearch: "",
    maxActiveRequests:
      Number.isFinite(maxActiveRaw) && maxActiveRaw > 0
        ? toBoundedInt(maxActiveRaw, 0, 1, 120)
        : "",
    responseTimeoutValue: timeout.value,
    responseTimeoutUnit: timeout.unit,
  };
}

export default function AdminManageAdminsScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [expandedUid, setExpandedUid] = useState("");
  const [draftByUid, setDraftByUid] = useState({});
  const [countyOpenByUid, setCountyOpenByUid] = useState({});
  const [actionBusy, setActionBusy] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setIsSuperAdmin(Boolean(ctx?.isSuperAdmin));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setIsSuperAdmin(false);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRows = async () => {
    setLoading(true);
    setErr("");
    try {
      const list = await listAssignedAdmins({ max: 250 });
      const clean = Array.isArray(list) ? list : [];
      setRows(clean);
      setDraftByUid((prev) => {
        const next = { ...(prev || {}) };
        clean.forEach((row) => {
          const uid = safeStr(row?.uid);
          if (!uid || next[uid]) return;
          next[uid] = makeDraft(row);
        });
        return next;
      });
    } catch (error) {
      console.error(error);
      setRows([]);
      setErr(error?.message || "Failed to load assigned admins.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const setDraft = (uid, patch) => {
    setDraftByUid((prev) => ({
      ...(prev || {}),
      [uid]: {
        ...(prev?.[uid] || {}),
        ...(patch || {}),
      },
    }));
  };

  const toggleCounty = (uid, countyName) => {
    const draft = draftByUid?.[uid] || {};
    const selected = normalizeCountyList(draft?.counties || []);
    if (selected.includes(countyName)) {
      setDraft(uid, { counties: selected.filter((county) => county !== countyName) });
      return;
    }
    setDraft(uid, { counties: normalizeCountyList([...selected, countyName]) });
  };

  const toggleExpand = (row) => {
    const uid = safeStr(row?.uid);
    if (!uid) return;
    if (expandedUid === uid) {
      setExpandedUid("");
      setCountyOpenByUid((prev) => ({ ...(prev || {}), [uid]: false }));
      return;
    }
    setExpandedUid(uid);
    if (!draftByUid?.[uid]) {
      setDraft(uid, makeDraft(row));
    }
  };

  const toggleCountyDropdown = (uid) => {
    setCountyOpenByUid((prev) => ({
      ...(prev || {}),
      [uid]: !prev?.[uid],
    }));
  };

  const runRevoke = async () => {
    const target = confirmRevoke;
    if (!target) return;
    const uid = safeStr(target?.uid);
    const email = safeStr(target?.email).toLowerCase();
    if (!email) {
      setConfirmRevoke(null);
      setErr("Missing admin email. Cannot revoke.");
      return;
    }

    setActionBusy(`revoke:${uid}`);
    setErr("");
    setMsg("");
    try {
      await setAssignedAdminByEmail({
        email,
        action: "remove",
      });
      setMsg(`Revoked admin: ${email}`);
      setConfirmRevoke(null);
      if (expandedUid === uid) setExpandedUid("");
      await loadRows();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to revoke admin.");
    } finally {
      setActionBusy("");
    }
  };

  const runUpdate = async (row) => {
    const uid = safeStr(row?.uid);
    const email = safeStr(row?.email).toLowerCase();
    const draft = draftByUid?.[uid] || makeDraft(row);
    const counties = normalizeCountyList(draft?.counties || []);
    if (!email) {
      setErr("Missing admin email.");
      return;
    }
    if (!counties.length) {
      setErr("Select at least one county.");
      return;
    }
    const maxActive = toBoundedInt(draft?.maxActiveRequests, 0, 1, 120);
    if (maxActive <= 0) {
      setErr("Enter max requests.");
      return;
    }
    const timeoutMinutes = timeoutToMinutes(
      draft?.responseTimeoutValue,
      draft?.responseTimeoutUnit
    );
    if (timeoutMinutes <= 0) {
      setErr("Enter response timeout.");
      return;
    }

    setActionBusy(`update:${uid}`);
    setErr("");
    setMsg("");
    try {
      await setAssignedAdminByEmail({
        email,
        action: "upsert",
        counties,
        town: safeStr(draft?.town),
        availability: safeStr(draft?.availability || "active").toLowerCase() || "active",
        maxActiveRequests: maxActive,
        responseTimeoutMinutes: timeoutMinutes,
      });
      setMsg(`Updated admin: ${email}`);
      await loadRows();
      setExpandedUid("");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update admin.");
    } finally {
      setActionBusy("");
    }
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const label = "text-[11px] font-semibold text-zinc-600 dark:text-zinc-300";
  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/50 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Manage Admins
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Review assigned admins and update their coverage settings.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3.5 py-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage assigned admins.
          </div>
        ) : (
          <>
            {err ? (
              <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            {msg ? (
              <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                {msg}
              </div>
            ) : null}

            {loading ? (
              <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                Loading admins...
              </div>
            ) : rows.length === 0 ? (
              <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                No assigned admins found.
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                {rows.map((row) => {
                  const uid = safeStr(row?.uid);
                  const email = safeStr(row?.email || uid).toLowerCase();
                  const isExpanded = expandedUid === uid;
                  const draft = draftByUid?.[uid] || makeDraft(row);
                  const filteredCounties = KENYA_COUNTY_OPTIONS.filter((county) =>
                    county.toLowerCase().includes(safeStr(draft?.countySearch).toLowerCase())
                  );
                  const recommendations = getNearbyCountySuggestions(
                    draft?.counties?.[0],
                    draft?.counties
                  ).slice(0, 8);
                  const countyOpen = Boolean(countyOpenByUid?.[uid]);
                  const revokeBusy = actionBusy === `revoke:${uid}`;
                  const updateBusy = actionBusy === `update:${uid}`;

                  return (
                    <div key={uid} className={card}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleExpand(row)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          toggleExpand(row);
                        }}
                        className="w-full cursor-pointer px-4 py-3 text-left transition active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {email}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmRevoke(row);
                            }}
                            disabled={revokeBusy}
                            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/80 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                          >
                            <AppIcon icon={ShieldOff} size={ICON_SM} />
                            {revokeBusy ? "Revoking..." : "Revoke"}
                          </button>

                          <span className={`text-zinc-500 transition ${isExpanded ? "rotate-180" : ""}`}>
                            <AppIcon icon={ChevronDown} size={ICON_SM} />
                          </span>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 pb-4 pt-3">
                          <div className="grid gap-3">
                            <div className="grid gap-1.5">
                              <div className={label}>Availability</div>
                              <select
                                className={input}
                                value={draft?.availability || "active"}
                                onChange={(event) => setDraft(uid, { availability: event.target.value })}
                              >
                                <option value="active">Active</option>
                                <option value="busy">Busy</option>
                                <option value="offline">Offline</option>
                              </select>
                            </div>

                            <div className="grid gap-1.5">
                              <div className={label}>Add Counties</div>
                              <button
                                type="button"
                                onClick={() => toggleCountyDropdown(uid)}
                                className={`${input} inline-flex items-center justify-between text-left`}
                              >
                                <span className="truncate">
                                  {(draft?.counties || []).length
                                    ? `${(draft?.counties || []).length} counties selected`
                                    : "Select counties"}
                                </span>
                                <AppIcon
                                  icon={ChevronDown}
                                  size={ICON_SM}
                                  className={countyOpen ? "rotate-180 transition" : "transition"}
                                />
                              </button>

                              {countyOpen ? (
                                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-3">
                                  <input
                                    className={input}
                                    placeholder="Search counties..."
                                    value={draft?.countySearch || ""}
                                    onChange={(event) => setDraft(uid, { countySearch: event.target.value })}
                                  />

                                  {recommendations.length ? (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                      {recommendations.map((countyName) => (
                                        <button
                                          key={`rec-${uid}-${countyName}`}
                                          type="button"
                                          onClick={() => toggleCounty(uid, countyName)}
                                          className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                        >
                                          + {countyName}
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}

                                  <div className="mt-3 max-h-44 overflow-y-auto grid gap-1 sm:grid-cols-2">
                                    {filteredCounties.map((countyName) => {
                                      const selected = (draft?.counties || []).includes(countyName);
                                      return (
                                        <button
                                          key={`${uid}-${countyName}`}
                                          type="button"
                                          onClick={() => toggleCounty(uid, countyName)}
                                          className={[
                                            "rounded-xl border px-3 py-2 text-left text-sm font-medium transition",
                                            selected
                                              ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.15)] dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                              : "border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100",
                                          ].join(" ")}
                                        >
                                          {countyName}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="grid gap-1.5">
                              <div className={label}>Max Requests</div>
                              <input
                                type="number"
                                min={1}
                                max={120}
                                className={input}
                                value={draft?.maxActiveRequests ?? ""}
                                onChange={(event) => setDraft(uid, { maxActiveRequests: event.target.value })}
                              />
                            </div>

                            <div className="grid gap-1.5">
                              <div className={label}>Response Timeout</div>
                              <div className="grid grid-cols-[1fr_120px] gap-2">
                                <input
                                  type="number"
                                  min={1}
                                  max={240}
                                  className={input}
                                  value={draft?.responseTimeoutValue ?? ""}
                                  onChange={(event) => setDraft(uid, { responseTimeoutValue: event.target.value })}
                                />
                                <select
                                  className={input}
                                  value={draft?.responseTimeoutUnit || "minutes"}
                                  onChange={(event) => setDraft(uid, { responseTimeoutUnit: event.target.value })}
                                >
                                  <option value="minutes">Minutes</option>
                                  <option value="hours">Hours</option>
                                </select>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => void runUpdate(row)}
                              disabled={updateBusy}
                              className="mt-1 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                            >
                              <AppIcon icon={Save} size={ICON_SM} />
                              {updateBusy ? "Updating..." : "Update Admin"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {confirmRevoke ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmRevoke(null)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close revoke confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-4 shadow-xl dark:border-rose-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                <AppIcon icon={ShieldOff} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Are you sure you want to revoke this admin?
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 break-all">
                {safeStr(confirmRevoke?.email || confirmRevoke?.uid)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(null)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runRevoke()}
                  disabled={Boolean(actionBusy)}
                  className="rounded-2xl border border-rose-200 bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

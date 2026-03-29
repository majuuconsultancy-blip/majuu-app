import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Copy,
  RefreshCw,
  Save,
  ShieldOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  buildManagerInviteLink,
  getManagerModuleOptions,
  listAssignedManagers,
  listManagerAuditLogs,
  listPendingManagerInvites,
  revokeManagerByEmail,
  upsertManagerAssignmentByEmail,
} from "../services/managerservice";
import { normalizeManagerModules } from "../services/managerModules";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return safeString(value, 320).toLowerCase();
}

function toDateTimeLabel(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "Not available";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "Not available";
  }
}

function statusTone(status) {
  const safe = safeString(status, 60).toLowerCase();
  if (safe === "active") {
    return "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200";
  }
  if (safe === "pending") {
    return "border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200";
  }
  return "border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300";
}

function copyToClipboard(text) {
  const safe = safeString(text, 4000);
  if (!safe) return false;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  navigator.clipboard.writeText(safe).catch(() => {});
  return true;
}

export default function AdminManageManagersScreen() {
  const navigate = useNavigate();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [managers, setManagers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [expandedKey, setExpandedKey] = useState("");
  const [draftByEmail, setDraftByEmail] = useState({});
  const [logsByUid, setLogsByUid] = useState({});
  const [loadingLogsByUid, setLoadingLogsByUid] = useState({});
  const [actionBusy, setActionBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [copiedInviteKey, setCopiedInviteKey] = useState("");

  const moduleOptions = getManagerModuleOptions();

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
      const [managerRows, inviteRows] = await Promise.all([
        listAssignedManagers({ max: 300 }),
        listPendingManagerInvites({ max: 300 }),
      ]);

      const safeManagers = Array.isArray(managerRows) ? managerRows : [];
      const safeInvites = Array.isArray(inviteRows) ? inviteRows : [];
      setManagers(safeManagers);
      setPendingInvites(safeInvites);

      setDraftByEmail((previous) => {
        const next = { ...(previous || {}) };
        safeManagers.forEach((row) => {
          const email = normalizeEmail(row?.email);
          if (!email || next[email]) return;
          next[email] = {
            email,
            name: safeString(row?.name, 120),
            stationedCountry: safeString(row?.stationedCountry, 120),
            cityTown: safeString(row?.cityTown, 120),
            managerRole: safeString(row?.managerRole, 120),
            notes: safeString(row?.notes, 2000),
            status: safeString(row?.status, 40) || "active",
            assignedModules: normalizeManagerModules(row?.assignedModules),
          };
        });
        return next;
      });
    } catch (error) {
      console.error(error);
      setManagers([]);
      setPendingInvites([]);
      setErr(error?.message || "Failed to load managers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadRows();
  }, [isSuperAdmin]);

  const combinedRows = useMemo(() => {
    const managerRows = managers.map((row) => ({
      rowType: "manager",
      key: `manager_${safeString(row?.uid || row?.email, 180)}`,
      ...row,
    }));
    const pendingRows = pendingInvites.map((row) => ({
      rowType: "pending",
      key: `pending_${safeString(row?.id || row?.email, 180)}`,
      uid: "",
      ...row,
    }));
    return [...managerRows, ...pendingRows];
  }, [managers, pendingInvites]);

  const setDraft = (email, patch) => {
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) return;
    setDraftByEmail((current) => ({
      ...(current || {}),
      [safeEmail]: {
        ...(current?.[safeEmail] || {}),
        ...(patch || {}),
      },
    }));
  };

  const toggleModuleDraft = (email, moduleKey) => {
    const safeEmail = normalizeEmail(email);
    if (!safeEmail) return;
    const current = draftByEmail?.[safeEmail] || {};
    const currentSet = new Set(normalizeManagerModules(current?.assignedModules));
    if (currentSet.has(moduleKey)) currentSet.delete(moduleKey);
    else currentSet.add(moduleKey);
    setDraft(safeEmail, { assignedModules: Array.from(currentSet) });
  };

  const ensureLogsLoaded = async (uid) => {
    const safeUid = safeString(uid, 180);
    if (!safeUid || logsByUid?.[safeUid]) return;
    setLoadingLogsByUid((current) => ({ ...(current || {}), [safeUid]: true }));
    try {
      const rows = await listManagerAuditLogs({ managerUid: safeUid, max: 80 });
      setLogsByUid((current) => ({ ...(current || {}), [safeUid]: rows }));
    } catch (error) {
      console.error(error);
      setLogsByUid((current) => ({ ...(current || {}), [safeUid]: [] }));
    } finally {
      setLoadingLogsByUid((current) => ({ ...(current || {}), [safeUid]: false }));
    }
  };

  const toggleExpand = (row) => {
    const key = safeString(row?.key, 220);
    if (!key) return;
    const isClosing = expandedKey === key;
    setExpandedKey(isClosing ? "" : key);
    if (!isClosing && safeString(row?.rowType, 40) === "manager") {
      void ensureLogsLoaded(row?.uid);
    }
  };

  const runSaveManager = async (row) => {
    const email = normalizeEmail(row?.email);
    const draft = draftByEmail?.[email] || {};
    const assignedModules = normalizeManagerModules(draft?.assignedModules);

    if (!email) {
      setErr("Manager email is missing.");
      return;
    }
    if (!assignedModules.length) {
      setErr("Select at least one module.");
      return;
    }

    setErr("");
    setMsg("");
    setActionBusy(`save:${email}`);
    try {
      await upsertManagerAssignmentByEmail({
        email,
        name: safeString(draft?.name, 120),
        stationedCountry: safeString(draft?.stationedCountry, 120),
        cityTown: safeString(draft?.cityTown, 120),
        managerRole: safeString(draft?.managerRole, 120),
        notes: safeString(draft?.notes, 2000),
        status: safeString(draft?.status, 40) || "active",
        assignedModules,
      });
      setMsg(`Manager updated: ${email}`);
      await loadRows();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to update manager.");
    } finally {
      setActionBusy("");
    }
  };

  const runRevokeManager = async (row) => {
    const email = normalizeEmail(row?.email);
    if (!email) return;
    const ok = window.confirm(`Revoke manager access for ${email}?`);
    if (!ok) return;

    setErr("");
    setMsg("");
    setActionBusy(`revoke:${email}`);
    try {
      await revokeManagerByEmail({ email });
      setMsg(`Manager revoked: ${email}`);
      await loadRows();
      if (expandedKey === row?.key) setExpandedKey("");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to revoke manager.");
    } finally {
      setActionBusy("");
    }
  };

  const copyInviteForPendingRow = (row) => {
    const key = safeString(row?.key, 220);
    const link = buildManagerInviteLink(row?.inviteId, { email: row?.email });
    if (!link) {
      setErr("Invite link is not available.");
      return;
    }
    if (!copyToClipboard(link)) {
      setErr("Clipboard unavailable. Copy manually.");
      return;
    }
    setCopiedInviteKey(key);
    setMsg("Pending invite link copied.");
    window.setTimeout(() => {
      setCopiedInviteKey((current) => (current === key ? "" : current));
    }, 1800);
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60";
  const label = "text-[11px] font-semibold text-zinc-600 dark:text-zinc-300";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="app-page-shell app-page-shell--medium">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Manage Managers
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Reassign modules, review activity logs, and control manager status.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadRows()}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200"
            >
              <AppIcon icon={RefreshCw} size={ICON_SM} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => smartBack(navigate, "/app/admin/sacc")}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
            >
              <AppIcon icon={ArrowLeft} size={ICON_MD} />
              Back
            </button>
          </div>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can manage managers.
          </div>
        ) : (
          <>
            {err ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
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
                Loading managers...
              </div>
            ) : combinedRows.length === 0 ? (
              <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
                No managers or pending invites found.
              </div>
            ) : (
              <div className="mt-5 grid gap-3">
                {combinedRows.map((row) => {
                  const key = safeString(row?.key, 220);
                  const isExpanded = expandedKey === key;
                  const email = normalizeEmail(row?.email);
                  const draft = draftByEmail?.[email] || {};
                  const rowModules =
                    row?.rowType === "manager"
                      ? normalizeManagerModules(draft?.assignedModules || row?.assignedModules)
                      : normalizeManagerModules(row?.assignedModules);
                  const revokeBusy = actionBusy === `revoke:${email}`;
                  const saveBusy = actionBusy === `save:${email}`;
                  const managerLogs = logsByUid?.[safeString(row?.uid, 180)] || [];
                  const loadingLogs = Boolean(loadingLogsByUid?.[safeString(row?.uid, 180)]);

                  return (
                    <div key={key} className={card}>
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
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                              {safeString(row?.name, 120) || email || "Unnamed manager"}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                              {email}
                              {safeString(row?.stationedCountry, 120)
                                ? ` | ${safeString(row?.stationedCountry, 120)}`
                                : ""}
                              {safeString(row?.cityTown, 120) ? ` | ${safeString(row?.cityTown, 120)}` : ""}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {rowModules.map((moduleKey) => {
                                const meta = moduleOptions.find((module) => module.key === moduleKey);
                                return (
                                  <span
                                    key={`${key}-${moduleKey}`}
                                    className="rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                                  >
                                    {meta?.label || moduleKey}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(
                                row?.status
                              )}`}
                            >
                              {safeString(row?.status, 40) || "active"}
                            </span>
                            <span className={`text-zinc-500 transition ${isExpanded ? "rotate-180" : ""}`}>
                              <AppIcon icon={ChevronDown} size={ICON_SM} />
                            </span>
                          </div>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="border-t border-zinc-200 px-4 pb-4 pt-3 dark:border-zinc-800">
                          {row?.rowType === "pending" ? (
                            <div className="grid gap-3">
                              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                                This invite is pending sign-up. Modules will auto-assign after redemption.
                              </div>
                              <div className="grid gap-1.5">
                                <div className={label}>Invite Expires</div>
                                <div className="text-sm text-zinc-700 dark:text-zinc-200">
                                  {toDateTimeLabel(row?.expiresAtMs)}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyInviteForPendingRow(row)}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                              >
                                <AppIcon
                                  icon={
                                    copiedInviteKey === key ? CheckCircle2 : Copy
                                  }
                                  size={ICON_SM}
                                />
                                {copiedInviteKey === key ? "Copied" : "Copy Invite Link"}
                              </button>
                            </div>
                          ) : (
                            <div className="grid gap-3">
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="grid gap-1.5">
                                  <span className={label}>Name</span>
                                  <input
                                    className={input}
                                    value={draft?.name || ""}
                                    onChange={(event) => setDraft(email, { name: event.target.value })}
                                  />
                                </label>
                                <label className="grid gap-1.5">
                                  <span className={label}>Role</span>
                                  <input
                                    className={input}
                                    value={draft?.managerRole || ""}
                                    onChange={(event) =>
                                      setDraft(email, { managerRole: event.target.value })
                                    }
                                  />
                                </label>
                                <label className="grid gap-1.5">
                                  <span className={label}>Stationed Country</span>
                                  <input
                                    className={input}
                                    value={draft?.stationedCountry || ""}
                                    onChange={(event) =>
                                      setDraft(email, { stationedCountry: event.target.value })
                                    }
                                  />
                                </label>
                                <label className="grid gap-1.5">
                                  <span className={label}>City / Town</span>
                                  <input
                                    className={input}
                                    value={draft?.cityTown || ""}
                                    onChange={(event) => setDraft(email, { cityTown: event.target.value })}
                                  />
                                </label>
                                <label className="grid gap-1.5">
                                  <span className={label}>Status</span>
                                  <select
                                    className={input}
                                    value={draft?.status || "active"}
                                    onChange={(event) => setDraft(email, { status: event.target.value })}
                                  >
                                    <option value="active">Active</option>
                                    <option value="pending">Pending</option>
                                    <option value="inactive">Inactive</option>
                                  </select>
                                </label>
                                <div className="grid gap-1.5">
                                  <span className={label}>Last Login</span>
                                  <div className="rounded-2xl border border-zinc-200 bg-white/85 px-4 py-2.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                                    {toDateTimeLabel(row?.lastLoginAtMs)}
                                  </div>
                                </div>
                              </div>

                              <div className="grid gap-1.5">
                                <div className={label}>Assigned Modules</div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {moduleOptions.map((module) => {
                                    const selected = rowModules.includes(module.key);
                                    return (
                                      <button
                                        key={`${key}-${module.key}-toggle`}
                                        type="button"
                                        onClick={() => toggleModuleDraft(email, module.key)}
                                        className={`rounded-2xl border px-3 py-2 text-left text-xs transition ${
                                          selected
                                            ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                                            : "border-zinc-200 bg-white/80 text-zinc-700 hover:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                                        }`}
                                      >
                                        <div className="font-semibold">{module.label}</div>
                                        <div className="mt-0.5 opacity-80">{module.description}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <label className="grid gap-1.5">
                                <span className={label}>Notes / Prompts</span>
                                <textarea
                                  className={`${input} min-h-[90px] resize-y`}
                                  value={draft?.notes || ""}
                                  onChange={(event) => setDraft(email, { notes: event.target.value })}
                                  placeholder="Manager notes and prompt context"
                                />
                              </label>

                              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-3.5 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-300">
                                Assigned modules are editable by you. Managers only see the modules selected above.
                              </div>

                              <div className="grid gap-2">
                                <div className={label}>Activity Logs</div>
                                {loadingLogs ? (
                                  <div className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400">
                                    Loading logs...
                                  </div>
                                ) : managerLogs.length === 0 ? (
                                  <div className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400">
                                    No activity yet.
                                  </div>
                                ) : (
                                  <div className="grid gap-2">
                                    {managerLogs.slice(0, 12).map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900/70"
                                      >
                                        <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                                          {entry.action}
                                          {entry.moduleKey ? ` | ${entry.moduleKey}` : ""}
                                        </div>
                                        {entry.details ? (
                                          <div className="mt-1 text-zinc-600 dark:text-zinc-300">
                                            {entry.details}
                                          </div>
                                        ) : null}
                                        <div className="mt-1 text-zinc-500 dark:text-zinc-400">
                                          {toDateTimeLabel(entry.createdAtMs)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                                <button
                                  type="button"
                                  onClick={() => void runSaveManager(row)}
                                  disabled={saveBusy}
                                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                                >
                                  <AppIcon icon={Save} size={ICON_SM} />
                                  {saveBusy ? "Saving..." : "Save Changes"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void runRevokeManager(row)}
                                  disabled={revokeBusy}
                                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                                >
                                  <AppIcon icon={ShieldOff} size={ICON_SM} />
                                  {revokeBusy ? "Revoking..." : "Revoke Manager"}
                                </button>
                              </div>
                            </div>
                          )}
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
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Copy, Link2, Sparkles, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { EAST_AFRICA_RESIDENCE_COUNTRIES } from "../constants/eastAfricaProfile";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  assignManagerByEmailDirect,
  createManagerInvite,
  getManagerModuleOptions,
} from "../services/managerservice";
import { normalizeManagerModules } from "../services/managerModules";
import { smartBack } from "../utils/navBack";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function copyToClipboard(text) {
  const safe = safeString(text, 4000);
  if (!safe) return false;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
  navigator.clipboard.writeText(safe).catch(() => {});
  return true;
}

function ModulePill({ label }) {
  return (
    <span className="rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
      {label}
    </span>
  );
}

export default function AdminAssignManagerScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [stationedCountry, setStationedCountry] = useState("");
  const [cityTown, setCityTown] = useState("");
  const [managerRole, setManagerRole] = useState("");
  const [notes, setNotes] = useState("");
  const [assignedModules, setAssignedModules] = useState([]);

  const [busyAction, setBusyAction] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [inviteResult, setInviteResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const moduleOptions = getManagerModuleOptions();
  const busy = Boolean(busyAction);

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

  const selectedModuleMeta = useMemo(() => {
    const selected = new Set(normalizeManagerModules(assignedModules));
    return moduleOptions.filter((module) => selected.has(module.key));
  }, [assignedModules, moduleOptions]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const label = "text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  const toggleModule = (moduleKey) => {
    const safeKey = safeString(moduleKey, 120);
    setAssignedModules((current) => {
      const currentSet = new Set(normalizeManagerModules(current));
      if (currentSet.has(safeKey)) currentSet.delete(safeKey);
      else currentSet.add(safeKey);
      return Array.from(currentSet);
    });
  };

  const buildAssignmentPayload = () => {
    const safeEmail = safeString(email, 320).toLowerCase();
    const safeName = safeString(name, 120);
    const safeCountry = safeString(stationedCountry, 120);
    const safeCity = safeString(cityTown, 120);
    const safeRole = safeString(managerRole, 120);
    const safeModules = normalizeManagerModules(assignedModules);
    const safeNotes = safeString(notes, 2000);

    if (!safeEmail || !safeEmail.includes("@")) {
      throw new Error("Enter a valid manager email.");
    }
    if (!safeName) {
      throw new Error("Manager name is required.");
    }
    if (!safeCountry) {
      throw new Error("Select a stationed country.");
    }
    if (!safeCity) {
      throw new Error("City/Town is required.");
    }
    if (!safeRole) {
      throw new Error("Role is required.");
    }
    if (!safeModules.length) {
      throw new Error("Select at least one assigned module.");
    }

    return {
      email: safeEmail,
      name: safeName,
      stationedCountry: safeCountry,
      cityTown: safeCity,
      managerRole: safeRole,
      assignedModules: safeModules,
      notes: safeNotes,
    };
  };

  const runCreateInvite = async () => {
    setErr("");
    setMsg("");
    setCopied(false);
    let payload;
    try {
      payload = buildAssignmentPayload();
    } catch (error) {
      setErr(error?.message || "Invalid manager details.");
      return;
    }

    setBusyAction("invite");
    try {
      const result = await createManagerInvite({
        ...payload,
        expiresInHours: 24,
      });
      setInviteResult(result || null);
      setMsg("Manager invite link generated. Share or copy it manually.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to create manager invite.");
    } finally {
      setBusyAction("");
    }
  };

  const runAssignDirect = async () => {
    setErr("");
    setMsg("");
    setCopied(false);
    let payload;
    try {
      payload = buildAssignmentPayload();
    } catch (error) {
      setErr(error?.message || "Invalid manager details.");
      return;
    }

    setBusyAction("direct");
    try {
      await assignManagerByEmailDirect(payload);
      setInviteResult(null);
      setMsg("Manager assigned directly. No invite link needed.");
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to assign manager directly.");
    } finally {
      setBusyAction("");
    }
  };

  const handleCopyInvite = () => {
    const link = safeString(inviteResult?.inviteLink, 1900);
    if (!link) return;
    const didCopy = copyToClipboard(link);
    setCopied(didCopy);
    if (!didCopy) {
      setErr("Clipboard unavailable. Copy the link manually.");
      return;
    }
    setMsg("Invite link copied.");
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className={pageBg}>
      <div className="app-page-shell app-page-shell--medium">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={UserPlus} size={ICON_SM} />
              Assign Manager
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Assign Manager
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Create a single-use manual invite and pre-assign modules.
            </p>
          </div>

          <button
            type="button"
            onClick={() => smartBack(navigate, "/app/admin/sacc")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3.5 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
          >
            <AppIcon icon={ArrowLeft} size={ICON_MD} />
            Back
          </button>
        </div>

        {checkingRole ? (
          <div className={`mt-5 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>Checking access...</div>
        ) : !isSuperAdmin ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            Only Super Admin can assign managers.
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

            <div className={`mt-5 ${card}`}>
              <div className="grid gap-3">
                <label className="grid gap-1.5">
                  <span className={label}>Email</span>
                  <input
                    className={input}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="manager@email.com"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className={label}>Name</span>
                  <input
                    className={input}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Manager full name"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className={label}>Stationed Country</span>
                    <select
                      className={input}
                      value={stationedCountry}
                      onChange={(event) => setStationedCountry(event.target.value)}
                    >
                      <option value="">Select country</option>
                      {EAST_AFRICA_RESIDENCE_COUNTRIES.map((country) => (
                        <option key={country} value={country}>
                          {country}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className={label}>City / Town</span>
                    <input
                      className={input}
                      value={cityTown}
                      onChange={(event) => setCityTown(event.target.value)}
                      placeholder="e.g. Nairobi"
                    />
                  </label>
                </div>

                <label className="grid gap-1.5">
                  <span className={label}>Role</span>
                  <input
                    className={input}
                    value={managerRole}
                    onChange={(event) => setManagerRole(event.target.value)}
                    placeholder="e.g. Finance Manager"
                  />
                </label>

                <div className="grid gap-2">
                  <div className={label}>Assigned Modules</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {moduleOptions.map((module) => {
                      const selected = selectedModuleMeta.some((entry) => entry.key === module.key);
                      return (
                        <button
                          key={module.key}
                          type="button"
                          onClick={() => toggleModule(module.key)}
                          className={`rounded-2xl border px-3.5 py-3 text-left transition ${
                            selected
                              ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 shadow-[0_0_0_1px_rgba(16,185,129,0.15)] dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                              : "border-zinc-200 bg-white/80 text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/50 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                          }`}
                        >
                          <div className="text-sm font-semibold">{module.label}</div>
                          <div className="mt-1 text-xs opacity-90">{module.description}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="min-h-[40px] rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/45">
                    {selectedModuleMeta.length ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedModuleMeta.map((module) => (
                          <ModulePill key={module.key} label={module.label} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Selected modules appear here as quick labels.
                      </div>
                    )}
                  </div>
                </div>

                <label className="grid gap-1.5">
                  <span className={label}>Notes / Prompts (Optional)</span>
                  <textarea
                    className={`${input} min-h-[100px] resize-y`}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Extra guidance for this manager"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void runCreateInvite()}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                  >
                    <AppIcon icon={Sparkles} size={ICON_SM} />
                    {busyAction === "invite" ? "Generating Link..." : "Generate Invite Link"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void runAssignDirect()}
                    disabled={busy}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white/90 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 active:scale-[0.99] disabled:opacity-60 dark:bg-zinc-900/70 dark:text-emerald-200 dark:hover:bg-emerald-950/20"
                  >
                    <AppIcon icon={UserPlus} size={ICON_SM} />
                    {busyAction === "direct" ? "Assigning..." : "Assign Without Invite"}
                  </button>
                </div>

                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-300">
                  Direct assign works without Blaze but requires the manager to have already created an account.
                </div>
              </div>
            </div>

            {inviteResult?.inviteLink ? (
              <div className={`mt-4 ${card}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                      <AppIcon icon={Link2} size={ICON_SM} />
                      Manual Invite Link
                    </div>
                    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Single-use. Expires in 24 hours by default.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
                  >
                    <AppIcon icon={copied ? CheckCircle2 : Copy} size={ICON_SM} />
                    {copied ? "Copied" : "Copy Link"}
                  </button>
                </div>
                <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2 text-xs text-zinc-700 break-all dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
                  {inviteResult.inviteLink}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  FolderClock,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import {
  auditRequestDocumentBackfill,
  auditUserVaultBackfill,
} from "../services/documentEngineService";
import {
  clearDocumentEngineReadMode,
  getDocumentEngineValidModes,
  setDocumentEngineGlobalMode,
  setDocumentEngineReadMode,
  subscribeDocumentEngineModeState,
} from "../services/documentEngineFlags";
import { smartBack } from "../utils/navBack";

function safeStr(value, max = 320) {
  return String(value || "").trim().slice(0, max);
}

function prettyMode(mode) {
  const clean = safeStr(mode, 24).toLowerCase();
  if (!clean) return "Not set";
  if (clean === "merge") return "Merge";
  if (clean === "canonical") return "Canonical";
  if (clean === "legacy") return "Legacy";
  return clean;
}

function prettyDate(ms) {
  const value = Number(ms || 0);
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "";
  }
}

function TonePill({ ok = false, children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        ok
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200"
          : "border-amber-200 bg-amber-50/80 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200"
      }`}
    >
      {children}
    </span>
  );
}

function AuditSummary({ title, report }) {
  if (!report) return null;
  const parity = report.parity || {};
  const safeForCutover = parity.safeForCanonicalReadCutover === true;
  const missingRows = Array.isArray(report.missingRows) ? report.missingRows : [];

  return (
    <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        <TonePill ok={safeForCutover}>
          {safeForCutover ? "Safe for canonical reads" : "Missing canonical rows"}
        </TonePill>
      </div>

      <div className="mt-2 grid gap-1 text-xs text-zinc-600 dark:text-zinc-300">
        <div>Expected pairs: {Number(parity.expectedPairs || 0)}</div>
        <div>Missing docs: {Number(parity.missingDocumentRows || 0)}</div>
        <div>Missing links: {Number(parity.missingLinkRows || 0)}</div>
        <div>Coverage: {Number(parity.coveragePercent || 0)}%</div>
      </div>

      {missingRows.length ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
          <div className="font-semibold">Missing examples</div>
          <div className="mt-1 grid gap-1">
            {missingRows.slice(0, 8).map((row) => (
              <div key={`${row.source}:${row.legacyId}`} className="font-mono text-[11px]">
                {row.source}:{row.legacyId} | doc={row.hasDocument ? "yes" : "no"} | link=
                {row.hasLink ? "yes" : "no"}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminDocumentEngineScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  const [modeState, setModeState] = useState({
    effectiveMode: "merge",
    source: "default",
    urlMode: "",
    localMode: "",
    globalMode: "",
    globalMeta: null,
    globalError: "",
    globalDocPath: "runtimeFlags/documentEngine",
  });
  const [globalModeDraft, setGlobalModeDraft] = useState("merge");
  const [localModeDraft, setLocalModeDraft] = useState("merge");
  const [globalNote, setGlobalNote] = useState("");
  const [modeBusy, setModeBusy] = useState("");
  const [modeErr, setModeErr] = useState("");
  const [modeMsg, setModeMsg] = useState("");

  const [requestIdInput, setRequestIdInput] = useState("");
  const [requestAuditBusy, setRequestAuditBusy] = useState(false);
  const [requestAuditErr, setRequestAuditErr] = useState("");
  const [requestAudit, setRequestAudit] = useState(null);

  const [userUidInput, setUserUidInput] = useState("");
  const [userAuditBusy, setUserAuditBusy] = useState(false);
  const [userAuditErr, setUserAuditErr] = useState("");
  const [userAudit, setUserAudit] = useState(null);

  const validModes = useMemo(() => getDocumentEngineValidModes(), []);
  const effectiveMode = modeState?.effectiveMode || "merge";
  const canCutover =
    requestAudit?.parity?.safeForCanonicalReadCutover === true &&
    userAudit?.parity?.safeForCanonicalReadCutover === true;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setHasAccess(Boolean(roleCtx?.isSuperAdmin));
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setHasAccess(false);
      } finally {
        if (!cancelled) setCheckingRole(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeDocumentEngineModeState({
      onData: (snapshot) => {
        setModeState(snapshot || {});
      },
      onError: (error) => {
        console.error("document engine mode sync failed:", error);
      },
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const preferredGlobal = safeStr(modeState?.globalMode, 20) || safeStr(modeState?.effectiveMode, 20);
    if (preferredGlobal) setGlobalModeDraft(preferredGlobal);
  }, [modeState?.globalMode, modeState?.effectiveMode]);

  useEffect(() => {
    const preferredLocal =
      safeStr(modeState?.localMode, 20) ||
      safeStr(modeState?.globalMode, 20) ||
      safeStr(modeState?.effectiveMode, 20);
    if (preferredLocal) setLocalModeDraft(preferredLocal);
  }, [modeState?.localMode, modeState?.globalMode, modeState?.effectiveMode]);

  const applyGlobalMode = async () => {
    setModeErr("");
    setModeMsg("");
    setModeBusy("global");
    try {
      await setDocumentEngineGlobalMode({
        mode: globalModeDraft,
        note: globalNote,
      });
      setModeMsg(`Global document engine mode set to ${prettyMode(globalModeDraft)}.`);
      setGlobalNote("");
    } catch (error) {
      setModeErr(error?.message || "Failed to save global mode.");
    } finally {
      setModeBusy("");
    }
  };

  const applyLocalMode = () => {
    setModeErr("");
    setModeMsg("");
    setModeBusy("local");
    try {
      const ok = setDocumentEngineReadMode(localModeDraft);
      if (!ok) throw new Error("Failed to set local mode.");
      setModeMsg(`Local override mode set to ${prettyMode(localModeDraft)}.`);
    } catch (error) {
      setModeErr(error?.message || "Failed to set local mode.");
    } finally {
      setModeBusy("");
    }
  };

  const resetLocalMode = () => {
    setModeErr("");
    setModeMsg("");
    setModeBusy("localClear");
    try {
      const ok = clearDocumentEngineReadMode();
      if (!ok) throw new Error("Failed to clear local override.");
      setModeMsg("Local override cleared. Effective mode now follows global/default logic.");
    } catch (error) {
      setModeErr(error?.message || "Failed to clear local override.");
    } finally {
      setModeBusy("");
    }
  };

  const runRequestAudit = async () => {
    const requestId = safeStr(requestIdInput, 120);
    if (!requestId) {
      setRequestAuditErr("Enter a request ID first.");
      return;
    }
    setRequestAuditBusy(true);
    setRequestAuditErr("");
    setRequestAudit(null);
    try {
      const report = await auditRequestDocumentBackfill({
        requestId,
      });
      setRequestAudit(report);
    } catch (error) {
      setRequestAuditErr(error?.message || "Failed to audit request backfill.");
    } finally {
      setRequestAuditBusy(false);
    }
  };

  const runUserAudit = async () => {
    const uid = safeStr(userUidInput, 120);
    if (!uid) {
      setUserAuditErr("Enter a user UID first.");
      return;
    }
    setUserAuditBusy(true);
    setUserAuditErr("");
    setUserAudit(null);
    try {
      const report = await auditUserVaultBackfill({
        uid,
      });
      setUserAudit(report);
    } catch (error) {
      setUserAuditErr(error?.message || "Failed to audit user vault backfill.");
    } finally {
      setUserAuditBusy(false);
    }
  };

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/35 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 bg-white/75 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55";
  const input =
    "w-full rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/70 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:ring-emerald-500/10";

  return (
    <div className={pageBg}>
      <div className="mx-auto max-w-5xl px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <AppIcon icon={Database} size={ICON_SM} />
              Document Engine
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Unified Document Engine Ops
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
              Manage engine mode, run safe backfill verification checks, and prepare cutover without
              breaking legacy flows.
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
          <div className={`mt-5 ${card} text-sm text-zinc-600 dark:text-zinc-300`}>
            Checking access...
          </div>
        ) : !hasAccess ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
            You do not have access to Document Engine Ops.
          </div>
        ) : (
          <>
            {modeErr ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {modeErr}
              </div>
            ) : null}
            {modeMsg ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200">
                {modeMsg}
              </div>
            ) : null}

            <div className={`mt-5 ${card}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Engine mode controls
                </div>
                <TonePill ok={effectiveMode === "canonical"}>
                  Effective: {prettyMode(effectiveMode)} ({safeStr(modeState?.source, 20)})
                </TonePill>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Global Mode (Firestore)
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Path: {modeState?.globalDocPath || "runtimeFlags/documentEngine"}
                  </div>
                  <select
                    className={`${input} mt-3`}
                    value={globalModeDraft}
                    onChange={(event) => setGlobalModeDraft(event.target.value)}
                    disabled={modeBusy === "global"}
                  >
                    {validModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {prettyMode(mode)}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${input} mt-2`}
                    value={globalNote}
                    onChange={(event) => setGlobalNote(event.target.value)}
                    placeholder="Optional rollout note..."
                  />
                  <button
                    type="button"
                    onClick={() => void applyGlobalMode()}
                    disabled={modeBusy === "global"}
                    className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <AppIcon icon={ShieldCheck} size={ICON_SM} />
                    {modeBusy === "global" ? "Saving..." : "Set Global Mode"}
                  </button>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Last updated:{" "}
                    {prettyDate(modeState?.globalMeta?.updatedAtMs) || "not yet set"}
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Local Override (this browser only)
                  </div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Useful for safe testing before global cutover.
                  </div>
                  <select
                    className={`${input} mt-3`}
                    value={localModeDraft}
                    onChange={(event) => setLocalModeDraft(event.target.value)}
                    disabled={modeBusy === "local" || modeBusy === "localClear"}
                  >
                    {validModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {prettyMode(mode)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={applyLocalMode}
                      disabled={modeBusy === "local" || modeBusy === "localClear"}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
                    >
                      <AppIcon icon={CheckCircle2} size={ICON_SM} />
                      {modeBusy === "local" ? "Applying..." : "Apply Local"}
                    </button>
                    <button
                      type="button"
                      onClick={resetLocalMode}
                      disabled={modeBusy === "local" || modeBusy === "localClear"}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-amber-200 hover:bg-amber-50/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
                    >
                      <AppIcon icon={RefreshCw} size={ICON_SM} />
                      {modeBusy === "localClear" ? "Clearing..." : "Clear Local"}
                    </button>
                  </div>
                </div>
              </div>

              {modeState?.globalError ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200">
                  Global mode read warning: {modeState.globalError}
                </div>
              ) : null}
            </div>

            <div className={`mt-4 ${card}`}>
              <div className="flex items-center gap-2">
                <AppIcon icon={CheckCircle2} size={ICON_SM} className="text-emerald-700" />
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Safe backfill verification
                </div>
              </div>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                These checks are read-only and compare legacy paths against canonical mirrors.
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    Request parity audit
                  </div>
                  <input
                    className={`${input} mt-2`}
                    value={requestIdInput}
                    onChange={(event) => setRequestIdInput(event.target.value)}
                    placeholder="Request ID"
                  />
                  <button
                    type="button"
                    onClick={() => void runRequestAudit()}
                    disabled={requestAuditBusy}
                    className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
                  >
                    <AppIcon icon={Database} size={ICON_SM} />
                    {requestAuditBusy ? "Checking..." : "Run Request Audit"}
                  </button>
                  {requestAuditErr ? (
                    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/70 p-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
                      {requestAuditErr}
                    </div>
                  ) : null}
                  <AuditSummary title="Request result" report={requestAudit} />
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                    User vault parity audit
                  </div>
                  <input
                    className={`${input} mt-2`}
                    value={userUidInput}
                    onChange={(event) => setUserUidInput(event.target.value)}
                    placeholder="User UID"
                  />
                  <button
                    type="button"
                    onClick={() => void runUserAudit()}
                    disabled={userAuditBusy}
                    className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50/60 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
                  >
                    <AppIcon icon={FolderClock} size={ICON_SM} />
                    {userAuditBusy ? "Checking..." : "Run Vault Audit"}
                  </button>
                  {userAuditErr ? (
                    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/70 p-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
                      {userAuditErr}
                    </div>
                  ) : null}
                  <AuditSummary title="Vault result" report={userAudit} />
                </div>
              </div>
            </div>

            <div className={`mt-4 ${card}`}>
              <div className="flex items-center gap-2">
                <AppIcon icon={AlertTriangle} size={ICON_SM} className="text-amber-700" />
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Canonical cutover checklist
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <div>1. Run request and vault parity checks until missing docs/links are zero.</div>
                <div>2. Run script audit: `npm run audit:documents` in `functions`.</div>
                <div>3. Set global mode to `canonical` only after both checks pass.</div>
                <div>4. Keep dual-write enabled so rollback to `merge` or `legacy` stays safe.</div>
              </div>

              <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Cutover readiness
                  </div>
                  <TonePill ok={canCutover}>
                    {canCutover ? "Ready for canonical-only reads" : "Run both audits first"}
                  </TonePill>
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Current effective mode: {prettyMode(effectiveMode)} ({safeStr(modeState?.source, 20)})
                </div>
              </div>
            </div>

            <div className={`mt-4 ${card}`}>
              <div className="flex items-center gap-2">
                <AppIcon icon={UploadCloud} size={ICON_SM} className="text-emerald-700" />
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Bucket upload lifecycle readiness
                </div>
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Canonical documents now support lifecycle updates for future bucket adoption:
                uploading, available, and failed states sync to `documentLinks.preview` safely.
              </div>
              <div className="mt-2 rounded-2xl border border-zinc-200 bg-white/80 p-3 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                updateCanonicalDocumentLifecycle / markDocumentUploading / markDocumentAvailable /
                markDocumentFailed
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

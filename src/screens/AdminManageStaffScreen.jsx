import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query } from "firebase/firestore";
import { ArrowLeft, ChevronDown, Unlink, UserX } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import { db } from "../firebase";
import { setStaffAccessByEmail } from "../services/staffservice";
import { listStaff, unassignRequest } from "../services/taskassignservice";
import { smartBack } from "../utils/navBack";

function safeStr(value) {
  return String(value || "").trim();
}

function toLabel(value) {
  const raw = safeStr(value).replace(/[_-]+/g, " ");
  if (!raw) return "";
  return raw
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isActiveTaskStatus(status) {
  const s = safeStr(status).toLowerCase();
  return s === "assigned" || s === "active" || s === "in_progress";
}

function formatTaskLabel(task) {
  const track = toLabel(task?.track);
  const country = safeStr(task?.country);
  let service = safeStr(task?.serviceName);
  if (!service) {
    const reqType = safeStr(task?.requestType).toLowerCase();
    if (reqType === "full") service = "Full Package";
    if (!service) service = toLabel(task?.speciality);
  }
  const label = [track, country, service].filter(Boolean).join(" ");
  if (label) return label;
  const rid = safeStr(task?.requestId || task?.id);
  return rid ? `Request ${rid.slice(0, 8)}` : "Assigned task";
}

export default function AdminManageStaffScreen() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [expandedUid, setExpandedUid] = useState("");
  const [tasksByUid, setTasksByUid] = useState({});
  const [tasksLoadingByUid, setTasksLoadingByUid] = useState({});

  const [confirmFire, setConfirmFire] = useState(null);
  const [confirmUnassign, setConfirmUnassign] = useState(null);
  const [actionBusy, setActionBusy] = useState("");

  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";
  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  const loadStaffRows = async () => {
    setLoading(true);
    setErr("");
    try {
      const list = await listStaff({ max: 250, includeLoad: true });
      const hired = (Array.isArray(list) ? list : [])
        .filter((row) => row?.active !== false)
        .sort((a, b) => safeStr(a?.email).localeCompare(safeStr(b?.email)));
      setRows(hired);
    } catch (error) {
      console.error(error);
      setRows([]);
      setErr(error?.message || "Failed to load hired staff.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStaffRows();
  }, []);

  const loadTasksForStaff = async (staffUid) => {
    const uid = safeStr(staffUid);
    if (!uid) return;

    setTasksLoadingByUid((prev) => ({ ...prev, [uid]: true }));
    try {
      const snap = await getDocs(query(collection(db, "staff", uid, "tasks"), limit(150)));
      const tasks = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((task) => isActiveTaskStatus(task?.status))
        .sort((a, b) => {
          const aSec = Number(a?.assignedAt?.seconds || 0);
          const bSec = Number(b?.assignedAt?.seconds || 0);
          return bSec - aSec;
        });
      setTasksByUid((prev) => ({ ...prev, [uid]: tasks }));
    } catch (error) {
      console.error(error);
      setTasksByUid((prev) => ({ ...prev, [uid]: [] }));
    } finally {
      setTasksLoadingByUid((prev) => ({ ...prev, [uid]: false }));
    }
  };

  const toggleExpand = async (staffUid) => {
    const uid = safeStr(staffUid);
    if (!uid) return;
    if (expandedUid === uid) {
      setExpandedUid("");
      return;
    }
    setExpandedUid(uid);
    if (!Array.isArray(tasksByUid?.[uid])) {
      await loadTasksForStaff(uid);
      return;
    }
    await loadTasksForStaff(uid);
  };

  const runFire = async () => {
    const target = confirmFire;
    if (!target) return;
    const email = safeStr(target?.email);
    if (!email) {
      setErr("Staff email missing. Cannot revoke access.");
      setConfirmFire(null);
      return;
    }

    setActionBusy(`fire:${target.uid}`);
    setErr("");
    setMsg("");
    try {
      await setStaffAccessByEmail({
        email,
        action: "revoke",
      });
      setMsg(`Staff fired: ${email}`);
      setConfirmFire(null);
      if (expandedUid === target.uid) setExpandedUid("");
      setTasksByUid((prev) => {
        const next = { ...(prev || {}) };
        delete next[target.uid];
        return next;
      });
      await loadStaffRows();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to fire staff.");
    } finally {
      setActionBusy("");
    }
  };

  const runUnassign = async () => {
    const target = confirmUnassign;
    if (!target?.staffUid || !target?.task) return;
    const requestId = safeStr(target.task.requestId || target.task.id);
    if (!requestId) {
      setErr("Missing request id for task.");
      setConfirmUnassign(null);
      return;
    }

    setActionBusy(`unassign:${target.staffUid}:${requestId}`);
    setErr("");
    setMsg("");
    try {
      await unassignRequest({
        requestId,
        staffUid: target.staffUid,
      });
      setMsg("Task unassigned.");
      setConfirmUnassign(null);
      setTasksByUid((prev) => {
        const current = Array.isArray(prev?.[target.staffUid]) ? prev[target.staffUid] : [];
        const nextTasks = current.filter((task) => safeStr(task?.requestId || task?.id) !== requestId);
        return { ...(prev || {}), [target.staffUid]: nextTasks };
      });
      await loadStaffRows();
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to unassign task.");
    } finally {
      setActionBusy("");
    }
  };

  const activeRows = useMemo(() => rows || [], [rows]);

  return (
    <div className={pageBg}>
      <div className="max-w-xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Manage Staff
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              View hired staff, active load, and unassign tasks.
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
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Loading staff...</div>
        ) : activeRows.length === 0 ? (
          <div className={`mt-5 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>
            No hired staff found.
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            {activeRows.map((staffRow) => {
              const uid = safeStr(staffRow?.uid);
              const email = safeStr(staffRow?.email || uid);
              const activeLoad = Number(staffRow?.activeLoad || 0);
              const maxActive = Math.max(1, Number(staffRow?.maxActive || 1));
              const isExpanded = expandedUid === uid;
              const tasksLoading = Boolean(tasksLoadingByUid?.[uid]);
              const tasks = Array.isArray(tasksByUid?.[uid]) ? tasksByUid[uid] : [];
              const fireBusy = actionBusy === `fire:${uid}`;

              return (
                <div key={uid} className={card}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => void toggleExpand(uid)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      void toggleExpand(uid);
                    }}
                    className="w-full cursor-pointer px-4 py-3 text-left transition active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {email}
                        </div>
                      </div>

                      <span className="inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                        {activeLoad}/{maxActive}
                      </span>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmFire(staffRow);
                        }}
                        disabled={fireBusy}
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50/80 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                        title="Fire staff"
                      >
                        <AppIcon icon={UserX} size={ICON_SM} />
                        {fireBusy ? "Firing..." : "Fire"}
                      </button>

                      <span className={`text-zinc-500 transition ${isExpanded ? "rotate-180" : ""}`}>
                        <AppIcon icon={ChevronDown} size={ICON_SM} />
                      </span>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 pb-3 pt-2">
                      {tasksLoading ? (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                          Loading assigned tasks...
                        </div>
                      ) : tasks.length === 0 ? (
                        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                          No active assigned tasks.
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          {tasks.map((task) => {
                            const requestId = safeStr(task?.requestId || task?.id);
                            const busyKey = `unassign:${uid}:${requestId}`;
                            const unassignBusy = actionBusy === busyKey;
                            return (
                              <div
                                key={`${uid}-${requestId}`}
                                className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/75 dark:bg-zinc-900/70 px-3 py-2"
                              >
                                <div className="min-w-0 flex-1 text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                                  {formatTaskLabel(task)}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmUnassign({
                                      staffUid: uid,
                                      task,
                                    })
                                  }
                                  disabled={unassignBusy}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50/80 text-amber-700 transition hover:bg-amber-100 active:scale-[0.99] disabled:opacity-60 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-200 dark:hover:bg-amber-950/35"
                                  title="Unassign task"
                                >
                                  <AppIcon icon={Unlink} size={ICON_SM} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmFire ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmFire(null)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close fire confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center app-overlay-safe">
            <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-4 shadow-xl dark:border-rose-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                <AppIcon icon={UserX} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Do you really want to fire this staff?
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 break-all">
                {safeStr(confirmFire?.email || confirmFire?.uid)}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmFire(null)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runFire()}
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

      {confirmUnassign ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmUnassign(null)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close unassign confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center app-overlay-safe">
            <div className="w-full max-w-sm rounded-3xl border border-amber-200 bg-white p-4 shadow-xl dark:border-amber-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <AppIcon icon={Unlink} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Do you want to unassign this task from this staff?
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 truncate">
                {formatTaskLabel(confirmUnassign?.task || {})}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmUnassign(null)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runUnassign()}
                  disabled={Boolean(actionBusy)}
                  className="rounded-2xl border border-amber-200 bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
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

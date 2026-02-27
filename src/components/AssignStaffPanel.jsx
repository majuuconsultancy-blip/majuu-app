import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Link2, Unlink } from "lucide-react";
import {
  assignRequestToStaff,
  listStaff,
  unassignRequest,
} from "../services/taskassignservice";
import AppIcon from "./AppIcon";
import { ICON_SM } from "../constants/iconSizes";

function normalizeSpeciality(request) {
  const raw = String(
    request?.serviceName || request?.service || request?.requestType || ""
  )
    .trim()
    .toLowerCase();

  if (raw === "full" || raw.includes("full package")) return "full";
  if (raw.includes("passport")) return "passport";
  if (raw.includes("visa")) return "visa";
  if (raw.includes("sop") || raw.includes("motivation")) return "sop";
  if (raw.includes("cv") || raw.includes("resume")) return "cv";
  if (raw.includes("fund")) return "funds";
  if (raw.includes("admission") || raw.includes("offer")) return "admission";
  if (raw.includes("travel") || raw.includes("flight") || raw.includes("planning")) {
    return "travel";
  }

  return raw || "unknown";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function readPerf(staffDoc) {
  const perf = staffDoc?.performance || {};
  const stats = staffDoc?.stats || staffDoc?.stats?.stats || {};

  const doneCount = Number(perf?.doneCount ?? stats?.totalDone ?? 0) || 0;
  const successCount = Number(perf?.successCount ?? stats?.successCount ?? 0) || 0;
  const avgMinutesRaw = perf?.avgMinutes ?? stats?.avgMinutes ?? null;
  const avgMinutes = Number.isFinite(Number(avgMinutesRaw)) ? Number(avgMinutesRaw) : 0;
  const successRate = doneCount > 0 ? clamp(successCount / doneCount, 0, 1) : 0.5;
  const blocked = Boolean(perf?.blocked);
  const active = staffDoc?.active !== false;

  return { doneCount, avgMinutes, successRate, blocked, active };
}

function computeSmartScore(staffDoc, { specialityKey = "", trackKey = "" } = {}) {
  const { doneCount, avgMinutes, successRate, blocked, active } = readPerf(staffDoc);

  let speedScore = 0.5;
  if (avgMinutes > 0) {
    const x = clamp(avgMinutes, 30, 10080);
    speedScore = clamp(1 - x / 10500, 0.05, 1);
  }

  const staffSpecs = Array.isArray(staffDoc?.specialities)
    ? staffDoc.specialities.map((s) => String(s).trim().toLowerCase())
    : [];
  const hasSpecMatch = specialityKey
    ? staffSpecs.includes(String(specialityKey).toLowerCase())
    : false;

  const staffTracks = Array.isArray(staffDoc?.tracks)
    ? staffDoc.tracks.map((t) => String(t).trim().toLowerCase())
    : [];
  const hasTrackMatch = trackKey ? staffTracks.includes(String(trackKey).toLowerCase()) : false;

  let score = 0;
  if (blocked) score -= 9999;
  if (!active) score -= 2000;
  if (hasSpecMatch) score += 50;
  if (hasTrackMatch) score += 10;
  score += successRate * 100;
  score += speedScore * 40;
  score += clamp(doneCount, 0, 30) * 0.8;

  return { score, blocked, active };
}

export default function AssignStaffPanel({ request }) {
  const [staff, setStaff] = useState([]);
  const [staffUid, setStaffUid] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const requestId = String(request?.id || "").trim();
  const assignedTo = String(request?.assignedTo || "").trim();
  const specialityKey = useMemo(() => normalizeSpeciality(request), [request]);
  const trackKey = useMemo(
    () => String(request?.track || "").trim().toLowerCase(),
    [request]
  );

  useEffect(() => {
    if (assignedTo) setStaffUid(assignedTo);
  }, [assignedTo]);

  useEffect(() => {
    (async () => {
      try {
        const list = await listStaff({ max: 200 });
        setStaff(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load staff list.");
      }
    })();
  }, []);

  const scoredStaff = useMemo(() => {
    const list = Array.isArray(staff) ? staff : [];
    const scored = list.map((s) => ({
      ...s,
      __smart: computeSmartScore(s, { specialityKey, trackKey }),
    }));
    scored.sort((a, b) => (b?.__smart?.score ?? 0) - (a?.__smart?.score ?? 0));
    return scored;
  }, [staff, specialityKey, trackKey]);

  const selected = useMemo(
    () => scoredStaff.find((s) => s.uid === staffUid),
    [scoredStaff, staffUid]
  );
  const assignedStaff = useMemo(
    () => scoredStaff.find((s) => s.uid === assignedTo),
    [scoredStaff, assignedTo]
  );

  const isAssigned = Boolean(assignedTo);
  const assignedLabel = assignedStaff?.email || assignedTo || "-";
  const selectedBlocked = Boolean(selected?.__smart?.blocked);
  const selectedActive = selected?.__smart?.active !== false;

  const card =
    "mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur";
  const btn =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const btnGreen = "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const btnRed = "border border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100";

  const doAssign = async () => {
    setErr("");
    setMsg("");

    if (!requestId) return setErr("Missing request id.");
    if (!staffUid) return setErr("Pick a staff member.");
    if (selectedBlocked) return setErr("This staff member is blocked due to low performance.");
    if (!selectedActive) return setErr("This staff member is inactive.");

    try {
      setBusy("assign");
      await assignRequestToStaff({
        requestId,
        staffUid,
        track: trackKey,
        speciality: specialityKey,
        country: request?.country || "",
        requestType: request?.requestType || "",
        serviceName: request?.serviceName || "",
        applicantName: request?.name || "",
      });
      setMsg(`Assigned to ${selected?.email || staffUid}.`);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Assign failed.");
    } finally {
      setBusy("");
    }
  };

  const doUnassign = async () => {
    setErr("");
    setMsg("");

    if (!requestId) return setErr("Missing request id.");
    const uid = assignedTo || staffUid;
    if (!uid) return setErr("No assignee found.");

    const ok = window.confirm(
      "Are you sure you want to unassign this request from this staff?"
    );
    if (!ok) return;

    try {
      setBusy("unassign");
      await unassignRequest({ requestId, staffUid: uid });
      setMsg("Unassigned.");
      setStaffUid("");
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Unassign failed.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className={card}>
      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Assign staff</div>
      <div className="mt-1 text-xs text-zinc-500">Sorted by a ranking system.</div>

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
        {!isAssigned ? (
          <div className="relative">
            <select
              value={staffUid}
              onChange={(e) => setStaffUid(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-white/45 dark:border-zinc-700/60 bg-white/55 dark:bg-zinc-900/55 backdrop-blur-xl px-4 pr-11 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 shadow-[0_10px_30px_rgba(0,0,0,0.08)] outline-none transition hover:border-emerald-200 focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100/80 dark:focus:ring-emerald-400/15"
            >
              <option value="">Select staff...</option>
              {scoredStaff.map((s) => {
                const m = s.__smart || {};
                const blocked = Boolean(m.blocked);
                const active = Boolean(m.active);
                const rankTxt = Number.isFinite(m.score) ? `rank ${Math.round(m.score)}` : "rank -";
                return (
                  <option key={s.uid} value={s.uid} disabled={blocked || !active}>
                    {s.email || s.uid} - {rankTxt}
                  </option>
                );
              })}
            </select>

            <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-zinc-500 dark:text-zinc-400">
              <AppIcon icon={ChevronDown} size={ICON_SM} />
            </span>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/45 dark:border-zinc-700/60 bg-white/55 dark:bg-zinc-900/55 backdrop-blur-xl px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Assigned to staff - {assignedLabel}
          </div>
        )}

        <button
          type="button"
          onClick={isAssigned ? doUnassign : doAssign}
          disabled={
            busy === "assign" ||
            busy === "unassign" ||
            (!isAssigned && (!staffUid || (selected && (selectedBlocked || !selectedActive))))
          }
          className={`${btn} ${isAssigned ? btnRed : btnGreen} w-full`}
          title={isAssigned ? "Unassign" : "Assign"}
        >
          <AppIcon icon={isAssigned ? Unlink : Link2} size={ICON_SM} />
          {isAssigned
            ? busy === "unassign"
              ? "Unassigning..."
              : "Unassign"
            : busy === "assign"
            ? "Assigning..."
            : "Assign"}
        </button>
      </div>
    </div>
  );
}



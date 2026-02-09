import { useEffect, useMemo, useState } from "react";
import {
  assignRequestToStaff,
  listStaff,
  unassignRequest,
} from "../services/taskassignservice";

function IconLink(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 13a4 4 0 0 1 0-6l1.2-1.2a4 4 0 0 1 5.6 5.6L16 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14 11a4 4 0 0 1 0 6l-1.2 1.2a4 4 0 1 1-5.6-5.6L8 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconUnlink(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M10 13a4 4 0 0 1 0-6l1.2-1.2a4 4 0 0 1 5.6 5.6L16 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Normalize request -> staff speciality key (must match staff.onboarding values) */
function normalizeSpeciality(request) {
  const raw =
    String(request?.serviceName || request?.service || request?.requestType || "")
      .trim()
      .toLowerCase();

  if (raw === "full" || raw.includes("full package")) return "full";
  if (raw.includes("passport")) return "passport";
  if (raw.includes("visa")) return "visa";
  if (raw.includes("sop") || raw.includes("motivation")) return "sop";
  if (raw.includes("cv") || raw.includes("resume")) return "cv";
  if (raw.includes("fund")) return "funds";
  if (raw.includes("admission") || raw.includes("offer")) return "admission";
  if (raw.includes("travel") || raw.includes("flight") || raw.includes("planning")) return "travel";

  return raw || "unknown";
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function fmtPct(x) {
  if (!Number.isFinite(x)) return "-";
  return `${Math.round(x * 100)}%`;
}

function fmtMinsToHuman(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m) || m <= 0) return "-";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h * 10) / 10}h`;
  const d = h / 24;
  return `${Math.round(d * 10) / 10}d`;
}

/**
 * ✅ Backwards compatible perf extractor:
 * supports staff.performance.* OR staff.stats.*
 */
function readPerf(staffDoc) {
  const perf = staffDoc?.performance || {};
  const stats = staffDoc?.stats || staffDoc?.stats?.stats || {};

  const doneCount = Number(perf?.doneCount ?? stats?.totalDone ?? 0) || 0;
  const successCount = Number(perf?.successCount ?? stats?.successCount ?? 0) || 0;

  const avgMinutesRaw = perf?.avgMinutes ?? stats?.avgMinutes ?? null;
  const avgMinutes = Number.isFinite(Number(avgMinutesRaw)) ? Number(avgMinutesRaw) : 0;

  const successRate =
    doneCount > 0 ? clamp(successCount / doneCount, 0, 1) : 0.5; // neutral for new staff

  const blocked = Boolean(perf?.blocked);
  const active = staffDoc?.active !== false;

  return { doneCount, successCount, avgMinutes, successRate, blocked, active };
}

/**
 * Smart staff sorting:
 * - blocked bottom
 * - inactive near bottom
 * - speciality match boost
 * - higher success + faster avg => higher score
 */
function computeSmartScore(staffDoc, { specialityKey = "", trackKey = "" } = {}) {
  const { doneCount, successCount, avgMinutes, successRate, blocked, active } = readPerf(staffDoc);

  // speed score 0..1
  let speedScore = 0.5;
  if (avgMinutes > 0) {
    const x = clamp(avgMinutes, 30, 10080); // 30m..7d
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

  return {
    score,
    blocked,
    active,
    doneCount,
    successCount,
    successRate,
    avgMinutes,
    hasSpecMatch,
    hasTrackMatch,
  };
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
  const trackKey = useMemo(() => String(request?.track || "").trim().toLowerCase(), [request]);

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
    const scored = list.map((s) => {
      const meta = computeSmartScore(s, { specialityKey, trackKey });
      return { ...s, __smart: meta };
    });

    scored.sort((a, b) => (b?.__smart?.score ?? 0) - (a?.__smart?.score ?? 0));
    return scored;
  }, [staff, specialityKey, trackKey]);

  const selected = useMemo(
    () => scoredStaff.find((s) => s.uid === staffUid),
    [scoredStaff, staffUid]
  );

  const selectedBlocked = Boolean(selected?.__smart?.blocked);
  const selectedActive = selected?.__smart?.active !== false;

  const card =
    "mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur";
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

      setMsg(`✅ Assigned to ${selected?.email || staffUid} (${specialityKey})`);
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

    try {
      setBusy("unassign");
      await unassignRequest({ requestId, staffUid: uid });
      setMsg("✅ Unassigned");
      setStaffUid("");
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Unassign failed.");
    } finally {
      setBusy("");
    }
  };

  const selectionHint = useMemo(() => {
    if (!selected) return null;
    const m = selected.__smart;
    if (!m) return null;

    const bits = [];
    if (m.hasSpecMatch) bits.push("Speciality match");
    if (m.hasTrackMatch) bits.push("Track match");
    if (m.doneCount > 0) {
      bits.push(`Success ${fmtPct(m.successRate)}`);
      bits.push(`Avg ${fmtMinsToHuman(m.avgMinutes)}`);
      bits.push(`Done ${m.doneCount}`);
    } else {
      bits.push("No history yet");
    }
    return bits.join(" • ");
  }, [selected]);

  return (
    <div className={card}>
      <div className="text-sm font-semibold text-zinc-900">Assign staff</div>
      <div className="mt-1 text-xs text-zinc-500">
        Smart-sorted: success + speed + speciality match (blocked/inactive disabled).
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
        <select
          value={staffUid}
          onChange={(e) => setStaffUid(e.target.value)}
          className="w-full rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm text-zinc-900 shadow-sm outline-none focus:border-emerald-200"
        >
          <option value="">Select staff…</option>

          {scoredStaff.map((s) => {
            const m = s.__smart || {};
            const blocked = Boolean(m.blocked);
            const active = Boolean(m.active);

            const scoreTxt = Number.isFinite(m.score) ? `score ${Math.round(m.score)}` : "score -";
            const perfTxt =
              m.doneCount > 0 ? `${fmtPct(m.successRate)} • ${fmtMinsToHuman(m.avgMinutes)}` : "new";

            const flags = [
              blocked ? "BLOCKED" : "",
              !active ? "inactive" : "",
              m.hasSpecMatch ? "match" : "",
            ]
              .filter(Boolean)
              .join(", ");

            return (
              <option key={s.uid} value={s.uid} disabled={blocked || !active}>
                {s.email || s.uid} — {scoreTxt} — {perfTxt}
                {flags ? ` (${flags})` : ""}
              </option>
            );
          })}
        </select>

        {selectionHint ? (
          <div className="text-[11px] text-zinc-500">
            Selected: <span className="font-semibold text-zinc-700">{selectionHint}</span>
          </div>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={doAssign}
            disabled={
              busy === "assign" ||
              busy === "unassign" ||
              (selected && (selectedBlocked || !selectedActive))
            }
            className={`${btn} ${btnGreen} flex-1`}
          >
            <IconLink className="h-5 w-5" />
            {busy === "assign" ? "Assigning…" : assignedTo ? "Re-assign" : "Assign"}
          </button>

          <button
            type="button"
            onClick={doUnassign}
            disabled={busy === "assign" || busy === "unassign" || (!assignedTo && !staffUid)}
            className={`${btn} ${btnRed}`}
            title="Unassign"
          >
            <IconUnlink className="h-5 w-5" />
            {busy === "unassign" ? "Removing…" : "Unassign"}
          </button>
        </div>

        {assignedTo ? (
          <div className="text-[11px] text-zinc-500">
            Currently assigned to: <span className="font-mono">{assignedTo}</span>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500">Not assigned yet.</div>
        )}
      </div>
    </div>
  );
}
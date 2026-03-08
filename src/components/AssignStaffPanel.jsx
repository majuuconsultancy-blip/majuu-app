import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Link2, Search, Unlink } from "lucide-react";
import {
  assignRequestToStaff,
  listStaff,
  unassignRequest,
} from "../services/taskassignservice";
import {
  getSpecialityLabel,
  inferRequestSpeciality,
  normalizeSpecialities,
} from "../constants/staffSpecialities";
import AppIcon from "./AppIcon";
import { ICON_SM } from "../constants/iconSizes";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeQuery(text) {
  return String(text || "")
    .trim()
    .toLowerCase();
}

function readPerf(staffDoc) {
  const perf = staffDoc?.performance || {};
  const stats = staffDoc?.stats || staffDoc?.stats?.stats || {};

  const doneCount = Number(perf?.doneCount ?? stats?.totalDone ?? stats?.doneCount ?? 0) || 0;
  const reviewedCount = Number(perf?.reviewedCount ?? stats?.totalReviewed ?? 0) || 0;
  const matchedCount =
    Number(perf?.matchCount ?? stats?.matchedDecisionCount ?? stats?.successCount ?? 0) || 0;
  const successCountLegacy = Number(perf?.successCount ?? stats?.successCount ?? 0) || 0;
  const totalMinutes = Number(stats?.totalMinutes ?? 0) || 0;
  const avgMinutesRaw = perf?.avgMinutes ?? stats?.avgMinutes ?? null;
  let avgMinutes = Number.isFinite(Number(avgMinutesRaw)) ? Number(avgMinutesRaw) : 0;
  if ((!avgMinutes || avgMinutes <= 0) && doneCount > 0 && totalMinutes > 0) {
    avgMinutes = totalMinutes / doneCount;
  }

  let successRate = Number(perf?.successRate ?? stats?.successRate ?? stats?.matchRate);
  if (!Number.isFinite(successRate)) {
    if (reviewedCount > 0) successRate = matchedCount / reviewedCount;
    else if (doneCount > 0) successRate = successCountLegacy / doneCount;
    else successRate = 0.5;
  }
  successRate = clamp(successRate, 0, 1);

  const blocked = Boolean(perf?.blocked) || staffDoc?.active === false;
  const active = staffDoc?.active !== false;

  return { doneCount, avgMinutes, successRate, blocked, active };
}

function computeSmartScore(staffDoc, { specialityKey = "", trackKey = "" } = {}) {
  const perf = readPerf(staffDoc);
  const staffSpecs = normalizeSpecialities(staffDoc?.specialities);
  const hasSpecMatch = specialityKey && specialityKey !== "unknown"
    ? staffSpecs.includes(String(specialityKey).toLowerCase())
    : true;

  const staffTracks = Array.isArray(staffDoc?.tracks)
    ? staffDoc.tracks.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const hasTrackMatch = trackKey ? staffTracks.includes(String(trackKey).toLowerCase()) : false;

  let speedScore = 0.5;
  if (perf.avgMinutes > 0) {
    const x = clamp(perf.avgMinutes, 30, 10080);
    speedScore = clamp(1 - x / 10500, 0.05, 1);
  }

  let score = 0;
  if (perf.blocked) score -= 9999;
  if (!perf.active) score -= 2000;
  if (hasSpecMatch) score += 50;
  if (hasTrackMatch) score += 10;
  score += perf.successRate * 100;
  score += speedScore * 40;
  score += clamp(perf.doneCount, 0, 30) * 0.8;

  return { ...perf, score, hasSpecMatch };
}

export default function AssignStaffPanel({ request }) {
  const [staff, setStaff] = useState([]);
  const [staffUid, setStaffUid] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pickerRef = useRef(null);

  const requestId = String(request?.id || "").trim();
  const assignedTo = String(request?.assignedTo || "").trim();
  const specialityKey = useMemo(() => inferRequestSpeciality(request), [request]);
  const specialityLabel = useMemo(() => getSpecialityLabel(specialityKey), [specialityKey]);
  const trackKey = useMemo(
    () => String(request?.track || "").trim().toLowerCase(),
    [request]
  );

  useEffect(() => {
    if (assignedTo) {
      setStaffUid(assignedTo);
      setPickerOpen(false);
    }
  }, [assignedTo]);

  useEffect(() => {
    (async () => {
      try {
        const list = await listStaff({ max: 200, includeLoad: true });
        setStaff(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load staff list.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onPointerDown = (event) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(event.target)) {
        setPickerOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  const scoredStaff = useMemo(() => {
    const list = Array.isArray(staff) ? staff : [];
    const scored = list.map((s) => {
      const smart = computeSmartScore(s, { specialityKey, trackKey });
      const specs = normalizeSpecialities(s?.specialities);
      const maxActive = Math.max(1, Number(s?.maxActive) || 2);
      const activeLoad = Math.max(0, Number(s?.activeLoad || 0));
      const atCapacity = activeLoad >= maxActive;
      return {
        ...s,
        __smart: smart,
        __specialityKeys: specs,
        __hasSpecMatch: smart.hasSpecMatch,
        __maxActive: maxActive,
        __activeLoad: activeLoad,
        __atCapacity: atCapacity,
      };
    });
    scored.sort((a, b) => (b?.__smart?.score ?? 0) - (a?.__smart?.score ?? 0));
    return scored;
  }, [staff, specialityKey, trackKey]);

  const selectableBySpeciality = useMemo(() => {
    if (specialityKey === "unknown") return scoredStaff;
    return scoredStaff.filter((s) => s.__hasSpecMatch);
  }, [scoredStaff, specialityKey]);

  const visibleOptions = useMemo(() => {
    const q = normalizeQuery(pickerSearch);
    if (!q) return selectableBySpeciality;
    return selectableBySpeciality.filter((s) => {
      const email = normalizeQuery(s?.email);
      const uid = normalizeQuery(s?.uid);
      const specs = (s?.__specialityKeys || []).map((k) => normalizeQuery(getSpecialityLabel(k)));
      return email.includes(q) || uid.includes(q) || specs.join(" ").includes(q);
    });
  }, [selectableBySpeciality, pickerSearch]);

  const selected = useMemo(
    () => scoredStaff.find((s) => String(s.uid) === String(staffUid)),
    [scoredStaff, staffUid]
  );
  const assignedStaff = useMemo(
    () => scoredStaff.find((s) => String(s.uid) === String(assignedTo)),
    [scoredStaff, assignedTo]
  );

  const isAssigned = Boolean(assignedTo);
  const assignedLabel = assignedStaff?.email || assignedTo || "-";
  const selectedBlocked = Boolean(selected?.__smart?.blocked);
  const selectedActive = selected?.__smart?.active !== false;
  const selectedCapacityBlocked = Boolean(selected?.__atCapacity);
  const selectedSpecMatch = Boolean(selected?.__hasSpecMatch);

  const cardBase =
    "relative z-40 mt-4 rounded-3xl border p-4 shadow-sm backdrop-blur transition-colors";
  const cardTone = isAssigned
    ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/25"
    : "border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/25";
  const card = `${cardBase} ${cardTone}`;
  const btn =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const btnGreen = "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const btnRed = "border border-rose-200 bg-rose-600 text-white hover:bg-rose-700";

  const doAssign = async () => {
    setErr("");
    setMsg("");

    if (!requestId) return setErr("Missing request id.");
    if (!staffUid) return setErr("Pick a staff member.");
    if (!selected) return setErr("Selected staff member not found.");
    if (!selectedSpecMatch) return setErr(`Selected staff does not match ${specialityLabel}.`);
    if (selectedBlocked) return setErr("This staff member is blocked due to low performance.");
    if (!selectedActive) return setErr("This staff member is inactive.");
    if (selectedCapacityBlocked) {
      return setErr(
        `This staff member is at capacity (${selected.__activeLoad}/${selected.__maxActive}).`
      );
    }

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
      setPickerOpen(false);
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
      setMsg("Unassigned.");
      setStaffUid("");
      setConfirmOpen(false);
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
      {!isAssigned ? (
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Request speciality:{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">{specialityLabel}</span>
        </div>
      ) : null}

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

      {isAssigned ? (
        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border border-white/45 bg-white/55 px-4 py-3 text-sm font-medium text-zinc-700 dark:border-zinc-700/60 dark:bg-zinc-900/55 dark:text-zinc-300">
            Assigned to = {assignedLabel}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy === "unassign"}
            className={`${btn} ${btnRed} w-full`}
            title="Unassign"
          >
            <AppIcon icon={Unlink} size={ICON_SM} />
            {busy === "unassign" ? "Unassigning..." : "Unassign"}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <div className={`relative ${pickerOpen ? "z-[10040]" : "z-20"}`} ref={pickerRef}>
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="w-full inline-flex items-center justify-between gap-3 rounded-2xl border border-white/45 bg-white/60 px-4 py-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.08)] transition hover:border-emerald-200 dark:border-zinc-700/60 dark:bg-zinc-900/55"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {selected?.email || "Select staff member"}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                  {selected
                    ? `Spec ${selected.__hasSpecMatch ? "match" : "mismatch"} - Load ${selected.__activeLoad}/${selected.__maxActive}`
                    : `${selectableBySpeciality.length} speciality matches`}
                </span>
              </span>
              <span className={`text-zinc-500 transition ${pickerOpen ? "rotate-180" : ""}`}>
                <AppIcon icon={ChevronDown} size={ICON_SM} />
              </span>
            </button>

            {pickerOpen ? (
              <div className="absolute z-[10050] mt-2 w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/70">
                    <AppIcon icon={Search} size={ICON_SM} className="text-zinc-500" />
                    <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Search staff or speciality..."
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto p-2">
                  {visibleOptions.length === 0 ? (
                    <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                      No staff match this request speciality yet.
                    </div>
                  ) : (
                    visibleOptions.map((s) => {
                      const smart = s.__smart || {};
                      const blocked = Boolean(smart.blocked);
                      const active = Boolean(smart.active);
                      const disabled = blocked || !active || s.__atCapacity || !s.__hasSpecMatch;
                      const rankTxt = Number.isFinite(smart.score)
                        ? `Rank ${Math.round(smart.score)}`
                        : "Rank -";
                      const matchTxt = s.__hasSpecMatch ? "Spec match" : "Spec mismatch";
                      const loadTxt = `Load ${s.__activeLoad}/${s.__maxActive}`;

                      return (
                        <button
                          key={s.uid}
                          type="button"
                          onClick={() => {
                            if (disabled) return;
                            setStaffUid(s.uid);
                            setPickerOpen(false);
                          }}
                          disabled={disabled}
                          className={[
                            "mb-2 w-full rounded-xl border px-3 py-2.5 text-left transition",
                            disabled
                              ? "border-zinc-200/80 bg-zinc-100/70 text-zinc-400 cursor-not-allowed dark:border-zinc-800/80 dark:bg-zinc-900/70"
                              : "border-zinc-200 bg-white/80 hover:border-emerald-200 dark:border-zinc-800 dark:bg-zinc-900/80",
                          ].join(" ")}
                        >
                          <div className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {s.email || s.uid}
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {rankTxt} - {matchTxt} - {loadTxt}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={doAssign}
            disabled={
              busy === "assign" ||
              busy === "unassign" ||
              !staffUid ||
              selectedBlocked ||
              !selectedActive ||
              selectedCapacityBlocked ||
              !selectedSpecMatch
            }
            className={`${btn} ${btnGreen} w-full`}
            title="Assign"
          >
            <AppIcon icon={Link2} size={ICON_SM} />
            {busy === "assign" ? "Assigning..." : "Assign"}
          </button>
        </div>
      )}

      {confirmOpen ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close unassign confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-4 shadow-xl dark:border-rose-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
                <AppIcon icon={AlertTriangle} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Are you sure you wanna unassign = {assignedLabel}?
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={doUnassign}
                  disabled={busy === "unassign"}
                  className="rounded-2xl border border-rose-200 bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  {busy === "unassign" ? "Unassigning..." : "Unassign"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppIcon from "../components/AppIcon";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  KENYA_COUNTY_OPTIONS,
  getNearbyCountySuggestions,
  normalizeCountyList,
} from "../constants/kenyaCounties";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { setAssignedAdminByEmail } from "../services/assignedadminservice";
import { smartBack } from "../utils/navBack";

function safeStr(value) {
  return String(value || "").trim();
}

function toBoundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function timeoutToMinutes(value, unit) {
  const base = Number(value || 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const cleanUnit = safeStr(unit).toLowerCase();
  const raw = cleanUnit === "hours" ? base * 60 : base;
  return toBoundedInt(raw, 0, 5, 240);
}

export default function AdminAssignAdminScreen() {
  const navigate = useNavigate();

  const [checkingRole, setCheckingRole] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const [email, setEmail] = useState("");
  const [counties, setCounties] = useState([]);
  const [countySearch, setCountySearch] = useState("");
  const [countyOpen, setCountyOpen] = useState(false);
  const [town, setTown] = useState("");
  const [maxActiveRequests, setMaxActiveRequests] = useState("");
  const [responseTimeoutValue, setResponseTimeoutValue] = useState("");
  const [responseTimeoutUnit, setResponseTimeoutUnit] = useState("minutes");
  const [availability, setAvailability] = useState("active");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const countyRef = useRef(null);

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

  useEffect(() => {
    if (!countyOpen) return undefined;
    const onPointerDown = (event) => {
      if (!countyRef.current) return;
      if (!countyRef.current.contains(event.target)) {
        setCountyOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [countyOpen]);

  const selectedCounties = useMemo(() => normalizeCountyList(counties), [counties]);

  const filteredCounties = useMemo(() => {
    const needle = safeStr(countySearch).toLowerCase();
    if (!needle) return KENYA_COUNTY_OPTIONS;
    return KENYA_COUNTY_OPTIONS.filter((county) => county.toLowerCase().includes(needle));
  }, [countySearch]);

  const recommendedCounties = useMemo(() => {
    const firstCounty = selectedCounties[0] || "";
    return getNearbyCountySuggestions(firstCounty, selectedCounties).slice(0, 8);
  }, [selectedCounties]);

  const toggleCounty = (countyName) => {
    const normalized = normalizeCountyList([...selectedCounties, countyName]);
    const key = safeStr(countyName).toLowerCase();
    if (selectedCounties.some((value) => safeStr(value).toLowerCase() === key)) {
      setCounties(selectedCounties.filter((value) => safeStr(value).toLowerCase() !== key));
      return;
    }
    setCounties(normalized);
  };

  const askConfirmAssign = () => {
    setErr("");
    const safeEmail = safeStr(email).toLowerCase();
    if (!safeEmail || !safeEmail.includes("@")) {
      setErr("Enter a valid admin email.");
      return;
    }
    if (!selectedCounties.length) {
      setErr("Select at least one county.");
      return;
    }
    const maxActive = toBoundedInt(maxActiveRequests, 0, 1, 120);
    if (maxActive <= 0) {
      setErr("Enter max active requests.");
      return;
    }
    const timeoutMinutes = timeoutToMinutes(responseTimeoutValue, responseTimeoutUnit);
    if (timeoutMinutes <= 0) {
      setErr("Enter response timeout.");
      return;
    }
    setConfirmOpen(true);
  };

  const runAssign = async () => {
    const safeEmail = safeStr(email).toLowerCase();
    if (!safeEmail) return;
    const maxActive = toBoundedInt(maxActiveRequests, 0, 1, 120);
    const timeoutMinutes = timeoutToMinutes(responseTimeoutValue, responseTimeoutUnit);
    if (maxActive <= 0 || timeoutMinutes <= 0) return;

    setBusy(true);
    setErr("");
    try {
      await setAssignedAdminByEmail({
        email: safeEmail,
        action: "upsert",
        counties: selectedCounties,
        town,
        availability,
        maxActiveRequests: maxActive,
        responseTimeoutMinutes: timeoutMinutes,
      });
      navigate("/app/admin", { replace: true });
    } catch (error) {
      console.error(error);
      setErr(error?.message || "Failed to assign admin.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
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
              Assign Admin
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Assign an admin and define coverage settings.
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
            Only Super Admin can assign admins.
          </div>
        ) : (
          <div className={`mt-5 ${card} p-4`}>
            {err ? (
              <div className="mb-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {err}
              </div>
            ) : null}

            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <div className={label}>Input Email</div>
                <input
                  className={input}
                  placeholder="assigned.admin@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div ref={countyRef} className="relative grid gap-1.5">
                <div className={label}>Select County</div>
                <button
                  type="button"
                  onClick={() => setCountyOpen((value) => !value)}
                  className={`${input} inline-flex items-center justify-between text-left`}
                >
                  <span className="truncate">
                    {selectedCounties.length ? selectedCounties.join(", ") : "Select counties"}
                  </span>
                  <AppIcon icon={ChevronDown} size={ICON_SM} className={countyOpen ? "rotate-180 transition" : "transition"} />
                </button>

                {countyOpen ? (
                  <div className="absolute left-0 right-0 top-full z-[10040] mt-2 rounded-2xl border border-zinc-200 bg-white/96 p-3 shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/96">
                    <input
                      className={input}
                      placeholder="Search counties..."
                      value={countySearch}
                      onChange={(event) => setCountySearch(event.target.value)}
                    />

                    {recommendedCounties.length ? (
                      <div className="mt-3">
                        <div className="mb-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          Nearby county suggestions
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {recommendedCounties.map((countyName) => (
                            <button
                              key={`rec-${countyName}`}
                              type="button"
                              onClick={() => toggleCounty(countyName)}
                              className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                            >
                              + {countyName}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 max-h-56 overflow-y-auto grid gap-1">
                      {filteredCounties.map((countyName) => {
                        const selected = selectedCounties.includes(countyName);
                        return (
                          <button
                            key={countyName}
                            type="button"
                            onClick={() => toggleCounty(countyName)}
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
                <div className={label}>Select Town or City</div>
                <input
                  className={input}
                  placeholder="Town or city"
                  value={town}
                  onChange={(event) => setTown(event.target.value)}
                />
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Select Max Active</div>
                <input
                  type="number"
                  min={1}
                  max={120}
                  className={input}
                  value={maxActiveRequests}
                  onChange={(event) => setMaxActiveRequests(event.target.value)}
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
                    value={responseTimeoutValue}
                    onChange={(event) => setResponseTimeoutValue(event.target.value)}
                  />
                  <select
                    className={input}
                    value={responseTimeoutUnit}
                    onChange={(event) => setResponseTimeoutUnit(event.target.value)}
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-1.5">
                <div className={label}>Availability</div>
                <select
                  className={input}
                  value={availability}
                  onChange={(event) => setAvailability(event.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="busy">Busy</option>
                  <option value="offline">Offline</option>
                </select>
              </div>

              <button
                type="button"
                onClick={askConfirmAssign}
                disabled={busy}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                <AppIcon icon={UserPlus} size={ICON_MD} />
                Assign Admin
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-[10060]">
          <button
            type="button"
            onClick={() => setConfirmOpen(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close assign confirmation"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-3xl border border-emerald-200 bg-white p-4 shadow-xl dark:border-emerald-900/40 dark:bg-zinc-900">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                <AppIcon icon={CheckCircle2} size={ICON_SM} />
              </div>
              <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Assign this admin?
              </div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 break-all">
                {safeStr(email).toLowerCase()}
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
                  onClick={() => void runAssign()}
                  disabled={busy}
                  className="rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? "Assigning..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

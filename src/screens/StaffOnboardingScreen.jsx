import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";
import { smartBack } from "../utils/navBack";
import { getSpecialityLabel, normalizeSpecialities } from "../constants/staffSpecialities";
import {
  areStaffOnboardingItemsComplete,
  buildLegalDocRoute,
  countCompletedStaffOnboardingItems,
  createInitialStaffOnboardingState,
  hydrateStaffOnboardingState,
  STAFF_ONBOARDING_ITEMS,
} from "../legal/legalRegistry";

const ONBOARDING_VERSION = 3;
const STAFF_ONBOARDING_LOCAL_PREFIX = "majuu_staff_onboarding_";

function localChecklistKey(uid) {
  return `${STAFF_ONBOARDING_LOCAL_PREFIX}${String(uid || "")}`;
}

function readLocalChecklistState(uid) {
  if (!uid || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(localChecklistKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalChecklistState(uid, state) {
  if (!uid || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localChecklistKey(uid), JSON.stringify(state || {}));
  } catch {
    // Ignore local storage write failures.
  }
}

function IconChevronLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9.5 5.5 16 12l-6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatAcceptedDate(value) {
  if (!value) return "";
  try {
    const ms = typeof value?.toMillis === "function" ? value.toMillis() : 0;
    if (!ms) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

export default function StaffOnboardingScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [email, setEmail] = useState("");
  const [maxActive, setMaxActive] = useState(2);
  const [specialities, setSpecialities] = useState([]);
  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [acceptedAtLabel, setAcceptedAtLabel] = useState("");
  const [checklistState, setChecklistState] = useState(() => createInitialStaffOnboardingState());

  const specialityLabels = useMemo(() => {
    const keys = normalizeSpecialities(specialities);
    return keys.map((key) => getSpecialityLabel(key));
  }, [specialities]);

  const completedCount = useMemo(
    () => countCompletedStaffOnboardingItems(checklistState),
    [checklistState]
  );

  const canContinue = useMemo(() => {
    return alreadyAccepted || areStaffOnboardingItemsComplete(checklistState);
  }, [alreadyAccepted, checklistState]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setLoading(true);
      setErr("");

      try {
        const ref = doc(db, "staff", user.uid);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data() || {} : {};

        setEmail(String(data?.email || user.email || "").trim());
        setMaxActive(Math.max(1, Number(data?.maxActive) || 2));
        setSpecialities(Array.isArray(data?.specialities) ? data.specialities : []);

        const accepted = data?.onboarded === true || data?.onboardingAccepted === true;
        const storedChecklist = readLocalChecklistState(user.uid);
        const hydratedChecklist = hydrateStaffOnboardingState(storedChecklist || {}, {
          forceComplete: accepted,
        });

        setAlreadyAccepted(accepted);
        setAcceptedAtLabel(formatAcceptedDate(data?.onboardingAcceptedAt));
        setChecklistState(hydratedChecklist);
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load staff onboarding.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  const persistChecklistState = (nextState) => {
    setChecklistState(nextState);
    writeLocalChecklistState(uid, nextState);
  };

  const openItem = (item) => {
    if (!uid || saving) return;

    const alreadyReviewed = checklistState[item.reviewedStateKey] === true;
    const nextState = alreadyReviewed
      ? checklistState
      : {
          ...checklistState,
          [item.reviewedStateKey]: true,
        };

    if (!alreadyReviewed) {
      persistChecklistState(nextState);
    }

    navigate(buildLegalDocRoute(item.docKey, { scope: "staffOnboarding" }), {
      state: { backTo: "/staff/onboarding" },
    });
  };

  const toggleChecked = (item, value) => {
    if (saving || alreadyAccepted) return;
    if (checklistState[item.reviewedStateKey] !== true) return;

    const nextState = {
      ...checklistState,
      [item.checkedStateKey]: value,
    };

    persistChecklistState(nextState);
  };

  const saveAgreement = async () => {
    if (!uid) return;

    if (alreadyAccepted) {
      navigate("/staff/tasks", { replace: true });
      return;
    }

    if (!areStaffOnboardingItemsComplete(checklistState)) {
      setErr("Review and confirm every required item before continuing.");
      return;
    }

    setSaving(true);
    setErr("");

    try {
      writeLocalChecklistState(uid, checklistState);

      const ref = doc(db, "staff", uid);
      await setDoc(ref, { uid }, { merge: true });
      await updateDoc(ref, {
        onboarded: true,
        onboardingAccepted: true,
        onboardingAcceptedAt: serverTimestamp(),
        onboardingVersion: ONBOARDING_VERSION,
        updatedAt: serverTimestamp(),
      });

      const completedState = hydrateStaffOnboardingState({}, { forceComplete: true });
      setAlreadyAccepted(true);
      setAcceptedAtLabel(new Date().toLocaleDateString());
      persistChecklistState(completedState);

      navigate("/staff/tasks", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to save onboarding acceptance.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="max-w-xl mx-auto px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading staff onboarding...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-8">
        <div className="max-w-xl mx-auto px-5 py-6">
          <button
            type="button"
            onClick={() => smartBack(navigate, "/staff/tasks")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <IconChevronLeft className="h-4 w-4" />
            Back
          </button>

          <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Staff Onboarding
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Review and confirm the required legal and policy documents before accessing staff tasks.
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Staff account</div>
            <div className="mt-1 break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {email || "Staff account"}
            </div>
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
              Max active tasks: <span className="font-semibold">{maxActive}</span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {specialityLabels.length ? (
                specialityLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200"
                  >
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  No speciality assigned yet. Contact admin.
                </span>
              )}
            </div>
          </div>

          {alreadyAccepted ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              Staff onboarding already completed{acceptedAtLabel ? ` on ${acceptedAtLabel}` : ""}.
            </div>
          ) : null}

          <div className="mt-5">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Complete these before continuing
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Open each item, review it, then confirm once you have read it.
            </p>
          </div>

          <div className="mt-4 grid gap-3">
            {STAFF_ONBOARDING_ITEMS.map((item) => {
              const reviewed = checklistState[item.reviewedStateKey] === true;
              const checked = reviewed && checklistState[item.checkedStateKey] === true;

              return (
                <div
                  key={item.key}
                  className={`rounded-2xl border p-4 shadow-sm transition ${
                    reviewed
                      ? "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/15"
                      : "border-zinc-200 bg-white/75 dark:border-zinc-800 dark:bg-zinc-900/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    disabled={saving}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {item.title}
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                          {item.description}
                        </div>
                        <div
                          className={`mt-2 text-xs font-semibold ${
                            reviewed
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {reviewed ? "Reviewed" : "Not reviewed"}
                        </div>
                      </div>
                      <IconChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    </div>
                  </button>

                  {reviewed ? (
                    <label className="mt-3 flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/50 px-3 py-3 text-sm text-zinc-800 dark:text-zinc-200">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleChecked(item, e.target.checked)}
                        disabled={saving || alreadyAccepted}
                        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>I have read and understood this.</span>
                    </label>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
            {completedCount} of {STAFF_ONBOARDING_ITEMS.length} completed
          </div>

          <button
            type="button"
            onClick={saveAgreement}
            disabled={!canContinue || saving}
            className="mt-3 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
          >
            {saving
              ? "Saving..."
              : alreadyAccepted
              ? "Continue to tasks"
              : "Continue to staff tasks"}
          </button>

          {!canContinue ? (
            <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Review and confirm all required items to continue.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

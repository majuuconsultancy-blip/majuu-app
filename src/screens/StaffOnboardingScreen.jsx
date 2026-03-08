import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";
import { smartBack } from "../utils/navBack";
import { getSpecialityLabel, normalizeSpecialities } from "../constants/staffSpecialities";

const ONBOARDING_VERSION = 2;

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
  const [agree, setAgree] = useState(false);

  const specialityLabels = useMemo(() => {
    const keys = normalizeSpecialities(specialities);
    return keys.map((key) => getSpecialityLabel(key));
  }, [specialities]);

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

        const accepted = data?.onboarded === true;
        setAlreadyAccepted(accepted);
        setAgree(accepted);
        setAcceptedAtLabel(formatAcceptedDate(data?.onboardingAcceptedAt));
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load staff guide.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [navigate]);

  const saveAgreement = async () => {
    if (!uid || !agree) return;

    setSaving(true);
    setErr("");

    try {
      const ref = doc(db, "staff", uid);
      await setDoc(ref, { uid }, { merge: true });
      await updateDoc(ref, {
        onboarded: true,
        onboardingAccepted: true,
        onboardingAcceptedAt: serverTimestamp(),
        onboardingVersion: ONBOARDING_VERSION,
        updatedAt: serverTimestamp(),
      });
      navigate("/staff/tasks", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to save agreement.");
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
              Loading staff guide...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm";

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
            Staff guide and agreement
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Read payout, tier and terms details. New staff must agree before accessing tasks.
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          <div className={`mt-5 ${card}`}>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Staff account</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
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

          <div className={`mt-4 ${card}`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Payment and payout
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
              <li>- Payment is issued for completed tasks approved by admin.</li>
              <li>- Rejected or unresolved submissions are not payable.</li>
              <li>- Payout cycles and methods are communicated by admin finance updates.</li>
            </ul>
          </div>

          <div className={`mt-4 ${card}`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Tier system
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
              <li>- Tiers are Provisional, Silver, Gold and Diamond.</li>
              <li>- Your tier is based on output quality, completion speed and acceptance rate.</li>
              <li>- Revoke and rehire policy: first rehire no penalty, second resets tier, third blocks account.</li>
            </ul>
          </div>

          <div className={`mt-4 ${card}`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Staff terms and conditions
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
              <li>- Keep applicant data private and use it only for assigned work.</li>
              <li>- Start assigned tasks on time; stale assignments can be revoked and reassigned.</li>
              <li>- Never request direct payment from applicants outside official channels.</li>
              <li>- Keep status updates accurate and follow admin quality instructions.</li>
            </ul>
          </div>

          {alreadyAccepted ? (
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
              Agreement already accepted{acceptedAtLabel ? ` on ${acceptedAtLabel}` : ""}.
            </div>
          ) : null}

          <div className={`mt-4 ${card}`}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                I have read and agree to the payout policy, tier system and staff terms.
              </span>
            </label>
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={saveAgreement}
              disabled={!agree || saving}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
            >
              {saving ? "Saving..." : alreadyAccepted ? "Continue to tasks" : "Agree and continue to tasks"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

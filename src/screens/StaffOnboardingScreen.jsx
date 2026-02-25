import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";
import { smartBack } from "../utils/navBack";

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

const OPTIONS = [
  { key: "passport", label: "Passport application" },
  { key: "visa", label: "Visa application" },
  { key: "sop", label: "SOP / Motivation letter" },
  { key: "cv", label: "CV / Resume" },
  { key: "funds", label: "Proof of funds" },
  { key: "admission", label: "Admissions / Offer letter" },
  { key: "travel", label: "Travel planning" },
];

export default function StaffOnboardingScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [selected, setSelected] = useState(new Set());

  const selectedArr = useMemo(() => Array.from(selected), [selected]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      setUid(user.uid);
      setLoading(true);
      setErr("");

      try {
        const ref = doc(db, "staff", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() || {};
          setName(String(data.name || "").trim());
          const arr = Array.isArray(data.specialities) ? data.specialities : [];
          setSelected(new Set(arr.map((x) => String(x))));
        }
      } catch (e) {
        console.error(e);
        setErr(e?.message || "Failed to load onboarding.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const toggle = (k) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    if (!uid) return;
    setSaving(true);
    setErr("");

    try {
      const ref = doc(db, "staff", uid);

      // in case doc doesn't exist (admin usually creates it, but safe)
      await setDoc(ref, { uid }, { merge: true });

      await updateDoc(ref, {
        name: String(name || "").trim() || "Staff",
        specialities: selectedArr,
        onboarded: true,
        maxActive: 2,
      });

      navigate("/staff", { replace: true });
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to save onboarding.");
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
              Loading onboarding…
            </p>
          </div>
        </div>
      </div>
    );
  }

  const card =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-6">
        <div className="max-w-xl mx-auto px-5 py-6">
          <button
            type="button"
            onClick={() => smartBack(navigate, "/staff/tasks")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            <IconChevronLeft className="h-4 w-4" />
            Back
          </button>

          <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Staff onboarding
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Choose what you specialize in. You’ll get tasks that match this.
          </p>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          <div className={`mt-6 ${card}`}>
            <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Display name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Brian"
              className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-100"
            />
          </div>

          <div className={`mt-4 ${card}`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Specialities
            </div>

            <div className="mt-3 grid gap-2">
              {OPTIONS.map((o) => {
                const on = selected.has(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => toggle(o.key)}
                    className={[
                      "w-full text-left rounded-2xl border px-4 py-3 text-sm font-semibold transition active:scale-[0.99]",
                      on
                        ? "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
                        : "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900",
                    ].join(" ")}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Finish onboarding"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}




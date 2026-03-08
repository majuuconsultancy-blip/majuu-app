import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";

/* Minimal icons */
function IconBriefcase(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 7V6.2A2.2 2.2 0 0 1 11.2 4h1.6A2.2 2.2 0 0 1 15 6.2V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6 7h12a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4 12h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 5.5 15.5 12 9 18.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function StaffHomeScreen() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState(null);
  const [err, setErr] = useState("");

  const cardBase =
    "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 backdrop-blur p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60";

  useEffect(() => {
    let unsub = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) {
        unsub();
        unsub = null;
      }

      if (!user) return;

      setLoading(true);
      setErr("");

      unsub = onSnapshot(
        doc(db, "staff", user.uid),
        (snap) => {
          setStaff(snap.exists() ? snap.data() : null);
          setLoading(false);
        },
        (e) => {
          console.error(e);
          setErr(e?.message || "Failed to load staff profile.");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsub) unsub();
    };
  }, []);

  const name = useMemo(() => {
    const n = String(staff?.name || "").trim();
    return n || "Staff";
  }, [staff]);

  const specialties = useMemo(() => {
    const arr = Array.isArray(staff?.specialities) ? staff.specialities : [];
    return arr.map((s) => String(s)).filter(Boolean);
  }, [staff]);

  const maxActive = Number(staff?.maxActive || 2);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="max-w-xl mx-auto px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading staff portal…
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 pb-6">
        <div className="max-w-xl mx-auto px-5 py-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-emerald-200">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-100 bg-white/70 dark:bg-zinc-900/60 dark:border-zinc-700 dark:bg-zinc-950/40">
                  <IconBriefcase className="h-4 w-4 text-emerald-700 dark:text-emerald-200" />
                </span>
                Staff portal
              </div>

              <h1 className="mt-3 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Welcome, {name}
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                You can handle up to {maxActive} active requests at a time.
              </p>
            </div>

            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
              {err}
            </div>
          ) : null}

          <div className={`mt-6 ${cardBase}`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Your specialities
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {specialties.length ? (
                specialties.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
                  >
                    {s}
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  None selected yet.
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-2">
              <button
                onClick={() => navigate("/staff/tasks")}
                className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
              >
                Go to tasks
              </button>

              <button
                onClick={() => navigate("/staff/onboarding")}
                className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                View staff guide
                <IconChevronRight className="ml-2 inline h-4 w-4" />
              </button>
            </div>
          </div>

          <div className={`mt-6 ${cardBase}`}>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Tip
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Tasks are assigned based on your specialities. If you do not see
              tasks, review the staff guide and wait for assignment.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}







import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { smartBack } from "../utils/navBack";
import {
  areServicePartnerOnboardingItemsComplete,
  buildLegalDocRoute,
  createInitialServicePartnerOnboardingState,
  hydrateServicePartnerOnboardingState,
  SERVICE_PARTNER_ONBOARDING_ITEMS,
} from "../legal/legalRegistry";

const STORAGE_PREFIX = "majuu_service_partner_onboarding_";

function storageKey(uid) {
  return `${STORAGE_PREFIX}${String(uid || "")}`;
}

function readPartnerOnboardingState(uid) {
  if (!uid || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writePartnerOnboardingState(uid, state) {
  if (!uid || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(state || {}));
  } catch {
    // Ignore storage write failures.
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

export default function ServicePartnerOnboardingScreen() {
  const navigate = useNavigate();

  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(() => createInitialServicePartnerOnboardingState());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLoading(false);
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setEmail(String(user.email || "").trim());

      const stored = readPartnerOnboardingState(user.uid);
      const hydrated = hydrateServicePartnerOnboardingState(stored || {}, {
        forceComplete: false,
      });
      setState(hydrated);
      setLoading(false);
    });

    return () => unsub();
  }, [navigate]);

  const item = SERVICE_PARTNER_ONBOARDING_ITEMS[0];
  const reviewed = state[item.reviewedStateKey] === true;
  const checked = reviewed && state[item.checkedStateKey] === true;
  const completedCount = checked ? 1 : 0;
  const canContinue = useMemo(() => areServicePartnerOnboardingItemsComplete(state), [state]);

  const persist = (nextState) => {
    setState(nextState);
    writePartnerOnboardingState(uid, nextState);
  };

  const openAgreement = () => {
    const nextState = {
      ...state,
      [item.reviewedStateKey]: true,
    };

    if (!reviewed) {
      persist(nextState);
    }

    navigate(buildLegalDocRoute(item.docKey, { scope: "servicePartnerOnboarding" }), {
      state: { backTo: "/app/service-partner/onboarding" },
    });
  };

  const onToggleChecked = (value) => {
    const nextState = {
      ...state,
      [item.checkedStateKey]: value,
    };
    persist(nextState);
  };

  const continueFlow = () => {
    if (!canContinue) return;
    navigate("/app/home", { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
          <div className="max-w-xl mx-auto px-5 py-10">
            <div className="mx-auto h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70 dark:border-zinc-800 dark:bg-zinc-900/60" />
            <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-300">
              Loading partner onboarding...
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
            onClick={() => smartBack(navigate, "/app/profile")}
            className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99]"
          >
            <IconChevronLeft className="h-4 w-4" />
            Back
          </button>

          <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Service Partner Onboarding
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            Review and confirm the required agreement before continuing as a service partner.
          </p>

          <div className="mt-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Partner account</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
              {email || "Service partner account"}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 p-4 shadow-sm">
            <button
              type="button"
              onClick={openAgreement}
              className="w-full text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{item.description}</div>
                  <div className={`mt-2 text-xs font-semibold ${reviewed ? "text-emerald-700" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {reviewed ? "Reviewed" : "Not reviewed"}
                  </div>
                </div>
                <IconChevronRight className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              </div>
            </button>

            {reviewed ? (
              <label className="mt-3 flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/50 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => onToggleChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>I have read and understood this.</span>
              </label>
            ) : null}
          </div>

          <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">
            {completedCount} of 1 completed
          </div>

          <button
            type="button"
            onClick={continueFlow}
            disabled={!canContinue}
            className="mt-3 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
          >
            Continue
          </button>

          {!canContinue ? (
            <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
              Review and confirm the required agreement to continue.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

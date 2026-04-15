import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import AppLoading from "../components/AppLoading";
import { useAuthSession } from "../auth/AuthSessionContext";
import { getUserState } from "../services/userservice";
import {
  enableBiometricLockForUser,
  getBiometricCapability,
  isBiometricPromptPending,
  setBiometricPromptPending,
} from "../services/biometricLockService";
import { resolvePostSetupLandingPathFromUserState } from "../journey/journeyLanding";
import {
  BIOMETRIC_SETUP_PATH,
  resolvePostAuthLandingPath,
} from "../utils/postAuthLanding";

function safeString(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

export default function BiometricSetupPromptScreen() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthSession();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stateCache, setStateCache] = useState(null);
  const [capability, setCapability] = useState({
    supported: false,
    available: false,
    strongAvailable: false,
    deviceSecure: false,
    reason: "",
    code: "",
  });

  const safeUid = safeString(user?.uid, 160);
  const safeEmail = safeString(user?.email, 220);

  const canEnableBiometric = useMemo(
    () => capability.supported && (capability.available || capability.deviceSecure),
    [capability]
  );

  const routeAfterPrompt = useCallback(
    async ({ forceFallback = false } = {}) => {
      try {
        const latestState = await getUserState(safeUid, safeEmail);
        const fallback = resolvePostSetupLandingPathFromUserState(latestState || {});
        const target = forceFallback
          ? fallback
          : await resolvePostAuthLandingPath({ uid: safeUid, userState: latestState || {} });
        navigate(target === BIOMETRIC_SETUP_PATH ? fallback : target, { replace: true });
      } catch (nextError) {
        void nextError;
        navigate("/dashboard", { replace: true });
      }
    },
    [navigate, safeEmail, safeUid]
  );

  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated || !safeUid) {
      navigate("/login", { replace: true });
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        setLoading(true);
        const [nextState, promptPending, bioCapability] = await Promise.all([
          getUserState(safeUid, safeEmail),
          isBiometricPromptPending(safeUid),
          getBiometricCapability(),
        ]);
        if (cancelled) return;

        setStateCache(nextState || null);
        setCapability(bioCapability);

        if (nextState?.onboarding?.profileJourneySetupCompleted === false) {
          navigate("/setup", { replace: true });
          return;
        }

        if (!promptPending) {
          await routeAfterPrompt({ forceFallback: true });
          return;
        }
      } catch (nextError) {
        if (cancelled) return;
        setError(nextError?.message || "Could not prepare secure setup.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, navigate, routeAfterPrompt, safeEmail, safeUid]);

  const handleEnable = async () => {
    if (!safeUid || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await enableBiometricLockForUser(
        safeUid,
        "Secure your account with fingerprint or face unlock"
      );
      if (!result.ok) {
        setError(result.message || "Could not enable biometric lock.");
        return;
      }
      await routeAfterPrompt();
    } catch (nextError) {
      setError(nextError?.message || "Could not enable biometric lock.");
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    if (!safeUid || busy) return;
    setBusy(true);
    setError("");
    try {
      await setBiometricPromptPending(safeUid, false);
      await routeAfterPrompt();
    } catch (nextError) {
      setError(nextError?.message || "Could not continue right now.");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AppLoading
        title="Preparing security setup..."
        subtitle="Checking your account state"
      />
    );
  }

  const selectedTrack = safeString(
    stateCache?.activeTrack || stateCache?.journey?.track || "",
    20
  ).toLowerCase();
  const hasJourney = Boolean(selectedTrack);
  const continueHint = hasJourney
    ? `After this step, you'll continue to ${selectedTrack}.`
    : "After this step, you'll continue to your dashboard.";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="mx-auto flex min-h-screen w-full max-w-xl items-center px-5 py-10">
          <div className="w-full rounded-3xl border border-zinc-200/80 bg-white/85 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/65">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              <span className="text-lg font-semibold">+</span>
            </div>

            <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Set up biometric lock
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Secure your account with fingerprint or face unlock so reopening the app is fast and safe.
            </p>

            <div className="mt-4 rounded-2xl border border-zinc-200/80 bg-zinc-50/75 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/55 dark:text-zinc-300">
              {continueHint}
            </div>

            {!canEnableBiometric ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                {capability.reason || "Biometric lock is not available on this device right now."}
              </div>
            ) : null}

            {error ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {canEnableBiometric ? (
                <button
                  type="button"
                  onClick={handleEnable}
                  disabled={busy}
                  className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? "Setting up..." : "Set up biometric lock"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={busy}
                  className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? "Continuing..." : "Continue"}
                </button>
              )}

              {canEnableBiometric ? (
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={busy}
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100"
                >
                  {busy ? "Continuing..." : "Not now"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

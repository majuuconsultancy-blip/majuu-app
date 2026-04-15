import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { sendEmailVerification, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { getUserState } from "../services/userservice";
import { useAuthSession } from "../auth/AuthSessionContext";
import {
  BIOMETRIC_SETUP_PATH,
  resolvePostAuthLandingPath,
} from "../utils/postAuthLanding";

const RESEND_COOLDOWN_SECONDS = 30;

function MailShieldIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3.5 7.2A2.2 2.2 0 0 1 5.7 5h12.6a2.2 2.2 0 0 1 2.2 2.2v6.1a2.2 2.2 0 0 1-2.2 2.2H11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="m5.1 7.4 5.8 4.4a1.7 1.7 0 0 0 2.1 0l5.8-4.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.8 13.6v3.1c0 2.3 1.6 3.8 3.8 4.3 2.2-.5 3.8-2 3.8-4.3v-3.1l-3.8-1.7-3.8 1.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m11.3 16 1.1 1.1 2-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function normalizeReturnPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/")) return "";

  const blockedPublicPaths = ["/login", "/signup", "/verify-email", "/intro"];
  if (
    blockedPublicPaths.some(
      (base) => path === base || path.startsWith(`${base}?`) || path.startsWith(`${base}#`)
    )
  ) {
    return "";
  }

  return path;
}

function friendlyVerificationError(error, fallback = "We could not complete that action. Please try again.") {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  if (code.includes("auth/too-many-requests")) {
    return "Too many requests right now. Please wait a moment and try again.";
  }
  if (code.includes("auth/network-request-failed") || message.includes("network-request-failed")) {
    return "Network issue detected. Check your connection and try again.";
  }

  return fallback;
}

export default function VerifyEmailScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthSession();

  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState("neutral");
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const checkInFlightRef = useRef(false);

  const activeUser = auth.currentUser || user;
  const emailHint = useMemo(
    () => activeUser?.email || location.state?.email || "",
    [activeUser?.email, location.state?.email]
  );
  const requestedPath = useMemo(
    () => normalizeReturnPath(location.state?.from),
    [location.state?.from]
  );

  const goToVerifiedDestination = useCallback(
    async (verifiedUser) => {
      try {
        const state = await getUserState(verifiedUser.uid, verifiedUser.email || "");
        const resolvedLanding = await resolvePostAuthLandingPath({
          uid: verifiedUser.uid,
          userState: state || {},
        });
        const mustUseResolvedLanding =
          resolvedLanding === "/setup" || resolvedLanding === BIOMETRIC_SETUP_PATH;
        navigate(mustUseResolvedLanding ? resolvedLanding : requestedPath || resolvedLanding, {
          replace: true,
        });
      } catch (error) {
        void error;
        navigate(requestedPath || "/dashboard", { replace: true });
      }
    },
    [navigate, requestedPath]
  );

  const checkVerification = useCallback(
    async ({ silent = false } = {}) => {
      const currentUser = auth.currentUser || user;
      if (!currentUser) {
        navigate("/login", { replace: true });
        return false;
      }
      if (checkInFlightRef.current) return false;

      checkInFlightRef.current = true;
      if (!silent) {
        setChecking(true);
        setStatus("");
        setStatusTone("neutral");
      }

      try {
        await currentUser.reload();
        const refreshedUser = auth.currentUser || currentUser;

        if (!refreshedUser?.emailVerified) {
          if (!silent) {
            setStatus("Still waiting for verification. Open the email link, then tap check again.");
            setStatusTone("warning");
          }
          return false;
        }

        if (!silent) {
          setStatus("Email confirmed. Taking you to your account...");
          setStatusTone("success");
        }
        await goToVerifiedDestination(refreshedUser);
        return true;
      } catch (error) {
        if (!silent) {
          setStatus(friendlyVerificationError(error, "Unable to refresh verification status right now."));
          setStatusTone("error");
        }
        return false;
      } finally {
        checkInFlightRef.current = false;
        if (!silent) {
          setChecking(false);
        }
      }
    },
    [goToVerifiedDestination, navigate, user]
  );

  useEffect(() => {
    if (!activeUser) {
      navigate("/login", { replace: true });
      return;
    }

    if (activeUser.emailVerified) {
      void checkVerification({ silent: true });
    }
  }, [activeUser, checkVerification, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timerId = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [cooldown]);

  useEffect(() => {
    const onFocus = () => {
      void checkVerification({ silent: true });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVerification({ silent: true });
      }
    };

    const pollingId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkVerification({ silent: true });
      }
    }, 15000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(pollingId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkVerification]);

  const handleResend = async () => {
    const currentUser = auth.currentUser || user;
    if (!currentUser || resending || cooldown > 0) return;

    setResending(true);
    setStatus("");
    setStatusTone("neutral");
    try {
      await sendEmailVerification(currentUser);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStatus(
        `A new verification email was sent to ${
          currentUser.email || "your inbox"
        }. Please check spam or junk if it does not appear.`
      );
      setStatusTone("success");
    } catch (error) {
      setStatus(friendlyVerificationError(error, "Unable to resend verification email right now."));
      setStatusTone("error");
    } finally {
      setResending(false);
    }
  };

  const handleSwitchAccount = async () => {
    setSwitchingAccount(true);
    try {
      await signOut(auth);
    } catch (error) {
      void error;
    } finally {
      navigate("/login", { replace: true });
      setSwitchingAccount(false);
    }
  };

  const statusClasses =
    statusTone === "success"
      ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
      : statusTone === "warning"
      ? "border-amber-200 bg-amber-50/80 text-amber-900"
      : statusTone === "error"
      ? "border-rose-200 bg-rose-50/80 text-rose-800"
      : "border-zinc-200 bg-zinc-50/70 text-zinc-700";

  return (
    <div className="min-h-screen bg-[#f4f8f6]">
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-emerald-100/35 via-white to-zinc-100/60">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 -right-16 h-56 w-56 rounded-full bg-emerald-200/60 blur-3xl" />
          <div className="absolute -bottom-16 -left-20 h-64 w-64 rounded-full bg-sky-200/35 blur-3xl" />
        </div>

        <main className="relative mx-auto flex min-h-screen w-full max-w-lg items-center justify-center px-4 py-8 sm:px-6">
          <section className="w-full rounded-[28px] border border-zinc-200/80 bg-white/92 p-6 shadow-[0_24px_80px_rgba(3,16,11,0.16)] backdrop-blur-xl sm:p-7">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white text-emerald-700 shadow-sm">
              <MailShieldIcon className="h-8 w-8" />
            </div>

            <div className="mt-5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Secure Account Setup
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                Confirm your email to unlock your account
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                For account security, we need one quick email confirmation before you can continue.
              </p>
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-200/80 bg-zinc-50/80 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Verification email sent to
              </p>
              <p className="mt-1 break-all text-sm font-semibold text-zinc-900">
                {emailHint || "your email address"}
              </p>
            </div>

            <div className="mt-4 space-y-2 rounded-2xl border border-zinc-200/80 bg-white/70 px-4 py-3 text-sm text-zinc-600">
              <p>1. Open the verification email.</p>
              <p>2. Tap the secure confirmation link.</p>
              <p>3. Return here and continue.</p>
            </div>

            {status ? (
              <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${statusClasses}`}>
                {status}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => void checkVerification({ silent: false })}
                disabled={checking || resending || switchingAccount}
                className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {checking ? "Checking status..." : "I've verified, continue"}
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={resending || cooldown > 0 || checking || switchingAccount}
                className="w-full rounded-2xl border border-zinc-200/90 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resending
                  ? "Sending verification email..."
                  : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : "Resend verification email"}
              </button>

              <button
                type="button"
                onClick={handleSwitchAccount}
                disabled={switchingAccount || checking || resending}
                className="w-full rounded-2xl border border-transparent bg-transparent px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:text-zinc-900 disabled:opacity-60"
              >
                {switchingAccount ? "Switching account..." : "Use a different account"}
              </button>
            </div>

            <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
              If the email is delayed, check spam or junk, then return and tap check again.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

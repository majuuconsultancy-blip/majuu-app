import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { sendEmailVerification } from "firebase/auth";
import { smartBack } from "../utils/navBack";
import { getUserState } from "../services/userservice";
import { resolveLandingPathFromUserState } from "../journey/journeyLanding";

export default function VerifyEmailScreen() {
  const navigate = useNavigate();
  const location = useLocation();

  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const user = auth.currentUser;

  const emailHint = useMemo(() => {
    return user?.email || location.state?.email || "";
  }, [user, location.state]);

  useEffect(() => {
    if (!user) {
      // user refreshed and lost session context? send them back
      navigate("/login", { replace: true });
      return;
    }
  }, [user, navigate]);

  // cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resend = async () => {
    if (!user) return;
    setMsg("");
    setBusy(true);
    try {
      await sendEmailVerification(user);
      setMsg("Verification email sent. Check your inbox (and spam).");
      setCooldown(30);
    } catch (e) {
      setMsg(e?.message || "Failed to resend. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const iveVerified = async () => {
    if (!user) return;
    setMsg("");
    setBusy(true);
    try {
      await user.reload();
      if (user.emailVerified) {
        try {
          const state = await getUserState(user.uid, user.email || "");
          navigate(resolveLandingPathFromUserState(state || {}), { replace: true });
        } catch (error) {
          void error;
          navigate("/dashboard", { replace: true });
        }
      } else {
        setMsg("Still not verified yet. Open the email link then try again.");
      }
    } catch (e) {
      setMsg(e?.message || "Could not refresh status. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-10">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 shadow-sm backdrop-blur">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Verify your email
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              We sent a verification link to{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{emailHint || "your email"}</span>.
              Open it, then come back here.
            </p>

            {msg ? (
              <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
                {msg}
              </div>
            ) : null}

            <div className="mt-5 grid gap-2">
              <button
                type="button"
                onClick={iveVerified}
                disabled={busy}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                {busy ? "Checking..." : "I’ve verified"}
              </button>

              <button
                type="button"
                onClick={resend}
                disabled={busy || cooldown > 0}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-white active:scale-[0.99] disabled:opacity-60"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
              </button>

              <button
                type="button"
                onClick={() => smartBack(navigate, "/login")}
                disabled={busy}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
              >
                Back to login
              </button>  
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Tip: If you can’t find the email, check spam/junk or wait 1–2 minutes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


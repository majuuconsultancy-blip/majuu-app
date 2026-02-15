// ✅ SignupScreen.jsx (FULL COPY-PASTE)
// Changes (UI only):
// - ✅ Google button: proper Google colors + multi-color "G" icon (not currentColor)
// - ✅ Password + Confirm: show/hide eye toggle (open/closed)
// - ✅ Slightly more “finished product” polish: spacing, helper text, subtle states
// - ✅ No backend logic changes (your Firebase flow kept)

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { ensureUserDoc } from "../services/userservice";

/* ---------------- Icons ---------------- */
function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m6.5 8.5 5.2 4a1 1 0 0 0 1.2 0l5.2-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.5 11V8.5a4.5 4.5 0 0 1 9 0V11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 11h11a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.2v2.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconShield(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5 19 6.6v6.2c0 4.8-3 7.8-7 9.2-4-1.4-7-4.4-7-9.2V6.6L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ✅ Proper multi-color Google "G" (no currentColor)
function GoogleGIcon(props) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" {...props}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.1 0 5.9 1.1 8.1 3.1l6-6C34.5 3.3 29.6 1 24 1 14.6 1 6.6 6.4 2.7 14.2l7.1 5.5C11.6 13.8 17.4 9.5 24 9.5Z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-2.8-.4-4H24v8h12.5c-.5 2.6-2 4.8-4.4 6.3l7 5.4c4.1-3.8 6.5-9.3 6.5-15.7Z"
      />
      <path
        fill="#FBBC05"
        d="M9.8 28.4A14.8 14.8 0 0 1 9 24c0-1.5.3-3 .8-4.4l-7.1-5.5A23 23 0 0 0 1 24c0 3.8.9 7.4 2.7 10.5l7.1-6.1Z"
      />
      <path
        fill="#34A853"
        d="M24 47c5.6 0 10.4-1.8 13.9-4.9l-7-5.4c-1.9 1.3-4.4 2.1-6.9 2.1-6.6 0-12.4-4.3-14.2-10.2l-7.1 6.1C6.6 41.6 14.6 47 24 47Z"
      />
    </svg>
  );
}

function IconEye(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function IconEyeOff(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 4 20 20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9.3 9.5a3.3 3.3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.2 6.9C3.6 8.9 2.5 12 2.5 12s3.5 7 9.5 7c2 0 3.8-.6 5.2-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M13.1 5.2A9.7 9.7 0 0 1 12 5c-6 0-9.5 7-9.5 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M21.5 12s-1.5 3-4 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- Helpers ---------------- */
function friendlyAuthError(err) {
  const code = String(err?.code || "").toLowerCase();
  const msg = String(err?.message || "").toLowerCase();

  if (code.includes("auth/email-already-in-use") || msg.includes("email-already-in-use"))
    return "That email is already in use. Try logging in instead.";
  if (code.includes("auth/invalid-email") || msg.includes("invalid-email"))
    return "Please enter a valid email address.";
  if (code.includes("auth/weak-password") || msg.includes("weak-password"))
    return "Password is too weak. Use at least 6 characters.";
  if (code.includes("auth/network-request-failed") || msg.includes("network-request-failed"))
    return "Network error. Check your connection and try again.";
  if (code.includes("auth/popup-closed-by-user"))
    return "Google sign-in was closed.";
  if (code.includes("auth/popup-blocked"))
    return "Popup blocked. Trying another method…";

  return err?.message || "Signup failed. Try again.";
}

export default function SignupScreen() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const passwordOk = useMemo(() => password.trim().length >= 6, [password]);
  const matchOk = useMemo(() => confirm === password, [confirm, password]);

  const canSubmit = useMemo(() => {
    return (
      email.trim().length > 0 &&
      password.trim().length > 0 &&
      confirm.trim().length > 0 &&
      passwordOk &&
      matchOk &&
      !loading
    );
  }, [email, password, confirm, passwordOk, matchOk, loading]);

  async function finishLogin(user) {
    await ensureUserDoc({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      provider: (user.providerData?.[0]?.providerId || "").toString(),
      lastLoginAt: Date.now(),
    });
  }

  const handleGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      await finishLogin(res.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const code = String(err?.code || "").toLowerCase();
      if (
        code.includes("auth/popup-blocked") ||
        code.includes("auth/operation-not-supported-in-this-environment")
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (e2) {
          setError(friendlyAuthError(e2));
        }
      } else {
        setError(friendlyAuthError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");

    const cleanEmail = email.trim();
    if (!passwordOk) return setError("Password must be at least 6 characters.");
    if (!matchOk) return setError("Passwords do not match.");

    setLoading(true);

    try {
      const userCred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      await finishLogin(userCred.user);

      await sendEmailVerification(userCred.user);

      navigate("/verify-email", { replace: true, state: { email: cleanEmail } });
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white">
        <div className="max-w-xl mx-auto px-5 py-10">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                Create your account
              </h1>
              <p className="mt-1 text-sm text-zinc-600">Sign up to start your journey.</p>
            </div>
            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
          </div>

          {/* Card */}
          <div className="mt-7 rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
            <div className="grid gap-3">
              {/* Google (Google-themed) */}
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="
                  w-full rounded-xl border border-zinc-200
                  bg-white px-4 py-3 text-sm font-semibold text-zinc-900
                  shadow-sm transition
                  hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60
                  flex items-center justify-center gap-2
                  focus:outline-none focus:ring-2 focus:ring-blue-200/70
                "
              >
                <GoogleGIcon className="h-5 w-5" />
                Continue with Google
              </button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs text-zinc-500">or</span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>

              <form onSubmit={handleSignup} className="grid gap-4">
                {/* Email */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">Email</label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2.5 focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
                    <IconMail className="h-5 w-5 text-zinc-500" />
                    <input
                      type="email"
                      placeholder="name@email.com"
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">Password</label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2.5 focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
                    <IconLock className="h-5 w-5 text-zinc-500" />
                    <input
                      type={showPass ? "text" : "password"}
                      placeholder="At least 6 characters"
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      disabled={loading}
                    />

                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      disabled={loading}
                      className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
                      aria-label={showPass ? "Hide password" : "Show password"}
                      title={showPass ? "Hide password" : "Show password"}
                    >
                      {showPass ? (
                        <IconEyeOff className="h-5 w-5" />
                      ) : (
                        <IconEye className="h-5 w-5" />
                      )}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div className="text-xs text-zinc-500">Use a strong password you can remember.</div>
                    <div
                      className={[
                        "text-xs font-semibold",
                        password.length === 0
                          ? "text-zinc-400"
                          : passwordOk
                          ? "text-emerald-700"
                          : "text-rose-700",
                      ].join(" ")}
                    >
                      {password.length === 0 ? "—" : passwordOk ? "Good" : "Too short"}
                    </div>
                  </div>
                </div>

                {/* Confirm */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">Confirm password</label>
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2.5 focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
                    <IconShield className="h-5 w-5 text-zinc-500" />
                    <input
                      type={showConfirm ? "text" : "password"}
                      placeholder="Repeat password"
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      required
                      disabled={loading}
                    />

                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      disabled={loading}
                      className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                      title={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? (
                        <IconEyeOff className="h-5 w-5" />
                      ) : (
                        <IconEye className="h-5 w-5" />
                      )}
                    </button>
                  </div>

                  {confirm.length > 0 ? (
                    <div className="mt-2 text-xs">
                      {matchOk ? (
                        <span className="text-emerald-700 font-semibold">Passwords match.</span>
                      ) : (
                        <span className="text-rose-700 font-semibold">Passwords do not match.</span>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Error */}
                {error ? (
                  <div className="rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? "Creating account..." : "Create account"}
                </button>

                {/* Secondary */}
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  disabled={loading}
                  className="w-full rounded-xl border border-zinc-200 bg-white/40 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                >
                  I already have an account
                </button>

                <p className="text-center text-xs text-zinc-500">
                  By continuing, you agree to our terms and privacy policy.
                </p>
              </form>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-zinc-500">
            Tip: Use an email you can access — we’ll send a verification link.
          </div>
        </div>
      </div>
    </div>
  );
}
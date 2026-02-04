import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { ensureUserDoc } from "../services/userservice";

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

function friendlyAuthError(err) {
  const msg = String(err?.message || "").toLowerCase();

  if (msg.includes("invalid-credential") || msg.includes("wrong-password"))
    return "Incorrect email or password.";
  if (msg.includes("user-not-found"))
    return "No account found with that email.";
  if (msg.includes("too-many-requests"))
    return "Too many attempts. Try again in a moment.";
  if (msg.includes("network-request-failed"))
    return "Network error. Check your connection and try again.";

  return err?.message || "Login failed. Try again.";
}

export default function LoginScreen() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.trim().length > 0 && !loading;
  }, [email, password, loading]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const cleanEmail = email.trim();
      const userCred = await signInWithEmailAndPassword(auth, cleanEmail, password);

      await ensureUserDoc({
        uid: userCred.user.uid,
        email: userCred.user.email,
      });

      navigate("/dashboard", { replace: true });
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
                Welcome back
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Sign in to continue.
              </p>
            </div>
            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
          </div>

          {/* Card */}
          <div className="mt-7 rounded-2xl border border-zinc-200 bg-white/70 p-5 shadow-sm backdrop-blur">
            <form onSubmit={handleLogin} className="grid gap-4">
              {/* Email */}
              <div>
                <label className="text-sm font-medium text-zinc-800">
                  Email
                </label>
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
                <label className="text-sm font-medium text-zinc-800">
                  Password
                </label>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2.5 focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
                  <IconLock className="h-5 w-5 text-zinc-500" />
                  <input
                    type="password"
                    placeholder="Your password"
                    className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    disabled={loading}
                  />
                </div>
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
                {loading ? "Signing in..." : "Sign in"}
              </button>

              {/* Secondary */}
              <button
                type="button"
                onClick={() => navigate("/signup")}
                disabled={loading}
                className="w-full rounded-xl border border-zinc-200 bg-white/40 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
              >
                Create an account
              </button>

              <p className="text-center text-xs text-zinc-500">
                By continuing, you agree to our terms and privacy policy.
              </p>
            </form>
          </div>

          {/* Footer hint */}
          <div className="mt-6 text-center text-xs text-zinc-500">
            Tip: Use the same email you signed up with.
          </div>
        </div>
      </div>
    </div>
  );
}
// ✅ LoginScreen.jsx (AUTO-RETRY OFFLINE 3x + NETWORK BANNER — COPY/PASTE)
// - If device is offline: blocks login and shows "Check your network"
// - If Firebase returns network/client-offline errors: auto-retries up to 3 times
// - After 3 fails: shows a clear "Couldn't connect" message
// - Adds a small online/offline listener to clear the message when network returns
// - NO backend changes

import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  sendPasswordResetEmail,
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

function IconGoogle(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M21.6 12.27c0-.68-.06-1.18-.17-1.7H12v3.21h5.54c-.11.8-.71 2.01-2.04 2.82l-.02.11 2.98 2.31.2.02c1.83-1.69 2.9-4.17 2.9-6.77Z"
      />
      <path
        fill="currentColor"
        d="M12 22c2.7 0 4.97-.89 6.63-2.43l-3.16-2.45c-.85.59-1.99 1-3.47 1-2.65 0-4.9-1.69-5.71-4.03l-.1.01-3.08 2.4-.03.1C4.74 19.95 8.09 22 12 22Z"
      />
      <path
        fill="currentColor"
        d="M6.29 14.09A6.02 6.02 0 0 1 6 12c0-.73.13-1.44.29-2.09l-.01-.14-3.11-2.43-.1.05A9.98 9.98 0 0 0 2 12c0 1.61.39 3.13 1.07 4.46l3.22-2.37Z"
      />
      <path
        fill="currentColor"
        d="M12 5.88c1.7 0 2.85.73 3.5 1.34l2.55-2.48C16.96 3.13 14.7 2 12 2 8.09 2 4.74 4.05 3.07 7.54l3.21 2.37C7.1 7.57 9.35 5.88 12 5.88Z"
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
        d="M3.5 5.5 20.5 18.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.2 9.1A3.2 3.2 0 0 0 12 15.2c.6 0 1.1-.1 1.6-.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.3 7.4C3.9 9.2 2.5 12 2.5 12s3.5 7 9.5 7c2 0 3.8-.6 5.3-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 5.4c.8-.2 1.6-.4 2.5-.4 6 0 9.5 7 9.5 7s-.9 1.9-2.7 3.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- Helpers ---------------- */
function friendlyAuthError(err) {
  const code = String(err?.code || "").toLowerCase();
  const msg = String(err?.message || "").toLowerCase();

  if (code.includes("auth/invalid-credential") || msg.includes("invalid-credential"))
    return "Incorrect email or password.";
  if (code.includes("auth/user-not-found") || msg.includes("user-not-found"))
    return "No account found with that email.";
  if (code.includes("auth/too-many-requests") || msg.includes("too-many-requests"))
    return "Too many attempts. Try again in a moment.";
  if (code.includes("auth/network-request-failed") || msg.includes("network-request-failed"))
    return "Network error. Check your connection and try again.";
  if (code.includes("auth/popup-closed-by-user"))
    return "Google sign-in was closed.";
  if (code.includes("auth/popup-blocked"))
    return "Popup blocked. Trying another method…";

  return err?.message || "Login failed. Try again.";
}

function isNetworkishAuthError(err) {
  const code = String(err?.code || "").toLowerCase();
  const msg = String(err?.message || "").toLowerCase();

  // Firebase Auth common network/offline symptoms:
  // - auth/network-request-failed
  // - "client is offline" (often from fetch)
  // - "Failed to fetch"
  // - "Load failed"
  // - "NetworkError"
  if (code.includes("auth/network-request-failed")) return true;
  if (msg.includes("client is offline")) return true;
  if (msg.includes("failed to fetch")) return true;
  if (msg.includes("networkerror")) return true;
  if (msg.includes("load failed")) return true;

  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetries(fn, { tries = 3, baseDelayMs = 650, onRetry } = {}) {
  let lastErr = null;

  for (let i = 1; i <= tries; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;

      // if it's not a network-ish issue, don't retry
      if (!isNetworkishAuthError(e)) throw e;

      // if browser says offline, don't keep retrying
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw e;

      if (i < tries) {
        onRetry?.(i, tries, e);
        // gentle backoff: 650ms, 1100ms, 1700ms...
        const backoff = baseDelayMs + (i - 1) * 450;
        await sleep(backoff);
        continue;
      }
      throw e;
    }
  }

  throw lastErr;
}

function ModalShell({ open, title, subtitle, children, onClose, busy }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (busy) return;
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />
      <div className="relative min-h-[100dvh] flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-200/70 bg-white/85 shadow-xl backdrop-blur-xl px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h2>
              {subtitle ? <p className="mt-1 text-sm text-zinc-600">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="shrink-0 rounded-xl border border-zinc-200/70 bg-white/70 px-3 py-2 text-zinc-700 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
              aria-label="Close"
              title="Close"
            >
              <span className="text-lg leading-none">×</span>
            </button>
          </div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function LoginScreen() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ✅ network banner state
  const [netMsg, setNetMsg] = useState("");
  const [retryInfo, setRetryInfo] = useState(""); // "Retrying 2/3…"

  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const lastAttemptRef = useRef(null); // { type: "email"|"google", payload: {...} }

  // ✅ watch online/offline
  useEffect(() => {
    const onOnline = () => {
      setNetMsg("");
      setRetryInfo("");
    };
    const onOffline = () => {
      setNetMsg("You’re offline. Check your network and try again.");
      setRetryInfo("");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // initial
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNetMsg("You’re offline. Check your network and try again.");
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const canSubmit = useMemo(() => {
    return email.trim().length > 0 && password.trim().length > 0 && !loading;
  }, [email, password, loading]);

  async function finishLogin(user) {
    await ensureUserDoc({
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
      provider: (user.providerData?.[0]?.providerId || "").toString(),
      lastLoginAt: Date.now(),
    });
    navigate("/dashboard", { replace: true });
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setNetMsg("");
    setRetryInfo("");

    const cleanEmail = email.trim();

    // hard block if offline
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNetMsg("You’re offline. Check your network and try again.");
      return;
    }

    setLoading(true);
    lastAttemptRef.current = {
      type: "email",
      payload: { email: cleanEmail, password },
    };

    try {
      const userCred = await withRetries(
        async () => {
          return await signInWithEmailAndPassword(auth, cleanEmail, password);
        },
        {
          tries: 3,
          onRetry: (i, total) => {
            setRetryInfo(`Network issue… retrying ${i + 1}/${total}`);
          },
        }
      );

      setRetryInfo("");
      await finishLogin(userCred.user);
    } catch (err) {
      setRetryInfo("");

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setNetMsg("You’re offline. Check your network and try again.");
      } else if (isNetworkishAuthError(err)) {
        setNetMsg("Couldn’t connect. Check your internet connection and try again.");
      } else {
        setError(friendlyAuthError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setNetMsg("");
    setRetryInfo("");

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNetMsg("You’re offline. Check your network and try again.");
      return;
    }

    setLoading(true);
    lastAttemptRef.current = { type: "google", payload: {} };

    try {
      const res = await withRetries(
        async () => {
          return await signInWithPopup(auth, googleProvider);
        },
        {
          tries: 3,
          onRetry: (i, total) => {
            setRetryInfo(`Network issue… retrying ${i + 1}/${total}`);
          },
        }
      );

      setRetryInfo("");
      await finishLogin(res.user);
    } catch (err) {
      setRetryInfo("");
      const code = String(err?.code || "").toLowerCase();

      // popup blocked → redirect (don’t retry)
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
      } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setNetMsg("You’re offline. Check your network and try again.");
      } else if (isNetworkishAuthError(err)) {
        setNetMsg("Couldn’t connect. Check your internet connection and try again.");
      } else {
        setError(friendlyAuthError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const retryNow = async () => {
    const last = lastAttemptRef.current;
    if (!last) return;

    // block if offline
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNetMsg("You’re offline. Check your network and try again.");
      return;
    }

    setNetMsg("");
    setError("");
    setRetryInfo("");

    if (last.type === "email") {
      // simulate submit without event
      setLoading(true);
      try {
        const { email: em, password: pw } = last.payload;
        const userCred = await withRetries(
          async () => await signInWithEmailAndPassword(auth, em, pw),
          {
            tries: 3,
            onRetry: (i, total) => setRetryInfo(`Network issue… retrying ${i + 1}/${total}`),
          }
        );
        setRetryInfo("");
        await finishLogin(userCred.user);
      } catch (err) {
        setRetryInfo("");
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setNetMsg("You’re offline. Check your network and try again.");
        } else if (isNetworkishAuthError(err)) {
          setNetMsg("Couldn’t connect. Check your internet connection and try again.");
        } else {
          setError(friendlyAuthError(err));
        }
      } finally {
        setLoading(false);
      }
    } else if (last.type === "google") {
      await handleGoogle();
    }
  };

  const openReset = () => {
    setResetMsg("");
    setError("");
    setNetMsg("");
    setRetryInfo("");
    setResetEmail(email.trim());
    setResetOpen(true);
  };

  const sendReset = async () => {
    const clean = resetEmail.trim();
    if (!clean) {
      setResetMsg("Enter your email first.");
      return;
    }

    // block if offline
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setResetMsg("You’re offline. Connect to the internet and try again.");
      return;
    }

    setResetBusy(true);
    setResetMsg("");
    try {
      await sendPasswordResetEmail(auth, clean);
      setResetMsg("Reset link sent. Check inbox (and spam).");
    } catch (err) {
      if (isNetworkishAuthError(err)) {
        setResetMsg("Network error. Check your connection and try again.");
      } else {
        setResetMsg(friendlyAuthError(err));
      }
    } finally {
      setResetBusy(false);
    }
  };

  // Polished styles
  const pageBg = "min-h-screen bg-zinc-50";
  const glassCard =
    "rounded-3xl border border-zinc-200/70 bg-white/80 p-5 shadow-[0_22px_80px_rgba(0,0,0,0.12)] backdrop-blur-xl";
  const fieldShell =
    "mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white/75 px-3 py-3 transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100";
  const primaryBtn =
    "w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.985] disabled:opacity-60";
  const secondaryBtn =
    "w-full rounded-2xl border border-zinc-200/80 bg-white/60 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white active:scale-[0.985] disabled:opacity-60";

  // ✅ Google themed button
  const googleBtn =
    "w-full rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-sm transition hover:shadow-md hover:border-blue-200 focus:outline-none focus:ring-4 focus:ring-blue-100 active:scale-[0.985] disabled:opacity-60 flex items-center justify-center gap-2";

  return (
    <div className={pageBg}>
      {/* background blobs */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute -top-28 -right-28 h-80 w-80 rounded-full bg-emerald-200/45 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
      </div>

      <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-zinc-50">
        <div className="max-w-xl mx-auto px-5 py-10">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                Welcome back
              </h1>
              <p className="mt-1 text-sm text-zinc-600">Sign in to continue.</p>
            </div>

            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
          </div>

          {/* Card */}
          <div className={["mt-7", glassCard].join(" ")}>
            <div className="grid gap-3">
              {/* ✅ Network banner */}
              {netMsg ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-900">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">Connection issue</div>
                      <div className="mt-0.5 text-xs text-amber-900/80">{netMsg}</div>
                      {retryInfo ? (
                        <div className="mt-1 text-xs font-semibold">{retryInfo}</div>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={retryNow}
                      disabled={loading}
                      className="shrink-0 rounded-xl border border-amber-200 bg-white/70 px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : retryInfo ? (
                <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-3 py-2 text-sm text-zinc-700">
                  {retryInfo}
                </div>
              ) : null}

              {/* Google */}
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className={googleBtn}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200/70 bg-white">
                  <IconGoogle className="h-5 w-5 text-[#4285F4]" />
                </span>
                Continue with Google
              </button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200/80" />
                <span className="text-xs font-semibold text-zinc-500">or</span>
                <div className="h-px flex-1 bg-zinc-200/80" />
              </div>

              <form onSubmit={handleLogin} className="grid gap-4">
                {/* Email */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">Email</label>
                  <div className={fieldShell}>
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
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-zinc-800">Password</label>
                    <button
                      type="button"
                      onClick={openReset}
                      disabled={loading}
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:opacity-60"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className={fieldShell}>
                    <IconLock className="h-5 w-5 text-zinc-500" />
                    <input
                      type={showPw ? "text" : "password"}
                      placeholder="Your password"
                      className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      disabled={loading}
                    />

                    {/* Eye toggle */}
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      disabled={loading}
                      className="shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200/70 bg-white/70 p-2 text-zinc-700 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      title={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? (
                        <IconEyeOff className="h-5 w-5" />
                      ) : (
                        <IconEye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Error */}
                {error ? (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                {/* Submit */}
                <button type="submit" disabled={!canSubmit} className={primaryBtn}>
                  {loading ? "Signing in..." : "Sign in"}
                </button>

                {/* Secondary */}
                <button
                  type="button"
                  onClick={() => navigate("/signup")}
                  disabled={loading}
                  className={secondaryBtn}
                >
                  Create an account
                </button>

                <p className="text-center text-xs text-zinc-500">
                  By continuing, you agree to our terms and privacy policy.
                </p>
              </form>
            </div>
          </div>

          {/* Footer hint */}
          <div className="mt-6 text-center text-xs text-zinc-500">
            Tip: Use the same email you signed up with.
          </div>
        </div>
      </div>

      {/* Reset Password Modal */}
      <ModalShell
        open={resetOpen}
        title="Reset password"
        subtitle="We’ll email you a reset link."
        onClose={() => (!resetBusy ? setResetOpen(false) : null)}
        busy={resetBusy}
      >
        <div className="grid gap-3">
          <div>
            <label className="text-sm font-medium text-zinc-800">Email</label>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white/75 px-3 py-3 transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
              <IconMail className="h-5 w-5 text-zinc-500" />
              <input
                type="email"
                className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                placeholder="name@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                disabled={resetBusy}
              />
            </div>
          </div>

          {resetMsg ? (
            <div className="rounded-2xl border border-zinc-200/80 bg-white/70 px-3 py-2 text-sm text-zinc-700">
              {resetMsg}
            </div>
          ) : null}

          <button
            type="button"
            onClick={sendReset}
            disabled={resetBusy}
            className={primaryBtn}
          >
            {resetBusy ? "Sending..." : "Send reset link"}
          </button>

          <button
            type="button"
            onClick={() => setResetOpen(false)}
            disabled={resetBusy}
            className={secondaryBtn}
          >
            Close
          </button>
        </div>
      </ModalShell>
    </div>
  );
}
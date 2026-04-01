// ✅ LoginScreen.jsx (AUTO-RETRY OFFLINE 3x + NETWORK BANNER — COPY/PASTE)
// - If device is offline: blocks login and shows "Check your network"
// - If Firebase returns network/client-offline errors: auto-retries up to 3 times
// - After 3 fails: shows a clear "Couldn't connect" message
// - Adds a small online/offline listener to clear the message when network returns
// - NO backend changes

import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth, authPersistenceReady, googleProvider } from "../firebase";
import { ensureUserDoc } from "../services/userservice";

import { buildLegalDocRoute, LEGAL_DOC_KEYS } from "../legal/legalRegistry";
import { resolveLandingPathFromUserState } from "../journey/journeyLanding";

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
    <svg viewBox="0 0 18 18" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8432 2.0782-1.7968 2.715v2.2582h2.9086c1.7018-1.5668 2.6846-3.8741 2.6846-6.6141Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.8068 5.9564-2.1818l-2.9086-2.2582c-.8068.54-1.8409.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0364-3.7105H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.9636 10.7086C3.7832 10.1686 3.6818 9.5918 3.6818 9s.1014-1.1686.2818-1.7086V4.9595H.9573C.3477 6.1745 0 7.5491 0 9s.3477 2.8255.9573 4.0405l3.0063-2.3319Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5809c1.3214 0 2.5077.4541 3.4405 1.3459l2.5813-2.5814C13.4636.8918 11.4264 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9595l3.0063 2.3319C4.6718 5.1641 6.6559 3.5809 9 3.5809Z"
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

function normalizeReturnPath(value) {
  const path = String(value || "").trim();
  if (!path.startsWith("/")) return "";

  const blockedPublicPaths = ["/login", "/signup", "/verify-email", "/intro"];
  if (blockedPublicPaths.some((base) => path === base || path.startsWith(`${base}?`) || path.startsWith(`${base}#`))) {
    return "";
  }

  return path;
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
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px] motion-modal-backdrop anim-in-fade" />
      <div className="relative min-h-screen flex items-end sm:items-center justify-center app-overlay-safe">
        <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/85 dark:bg-zinc-900/60 shadow-lg backdrop-blur-xl px-5 py-5 motion-modal-panel anim-in-pop">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
              {subtitle ? <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="shrink-0 rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-zinc-700 dark:text-zinc-300 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
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
  const location = useLocation();

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
  const requestedPath = useMemo(() => normalizeReturnPath(location.state?.from), [location.state?.from]);

  const openLegalDoc = (docKey) => {
    navigate(buildLegalDocRoute(docKey), {
      state: { backTo: "/login" },
    });
  };

  const lastAttemptRef = useRef(null); // { type: "email"|"google", payload: {...} }
  const finishLogin = useCallback(
    async (user) => {
      const targetFallback = requestedPath || "/dashboard";
      if (!user.emailVerified) {
        navigate("/verify-email", {
          replace: true,
          state: {
            email: user.email || "",
            from: targetFallback,
          },
        });
        return null;
      }

      const state = await ensureUserDoc({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        provider: (user.providerData?.[0]?.providerId || "").toString(),
        lastLoginAt: Date.now(),
      });

      const target = requestedPath || resolveLandingPathFromUserState(state || {});
      navigate(target, { replace: true });
      return state;
    },
    [navigate, requestedPath]
  );

  useEffect(() => {
    let cancelled = false;
    let redirected = false;

    const redirectIfSignedIn = async (user) => {
      if (!user || redirected || cancelled) return;
      redirected = true;
      try {
        await finishLogin(user);
        if (cancelled) return;
      } catch (error) {
        void error;
        if (!cancelled) {
          if (user?.emailVerified) {
            navigate("/dashboard", { replace: true });
          } else {
            navigate("/verify-email", {
              replace: true,
              state: {
                email: user?.email || "",
                from: requestedPath || "/dashboard",
              },
            });
          }
        }
      }
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      void redirectIfSignedIn(user);
    });

    // Fast path when user is already restored.
    void redirectIfSignedIn(auth.currentUser);

    // Keep background init for other flows, but don't await it.
    authPersistenceReady.catch(() => {});

    return () => {
      cancelled = true;
      unsub();
    };
  }, [finishLogin, navigate, requestedPath]);

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
  const pageBg = "min-h-screen bg-zinc-50 dark:bg-zinc-950";
  const glassCard =
    "rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 p-5 shadow-[0_22px_80px_rgba(0,0,0,0.12)] backdrop-blur-xl";
  const fieldShell =
    "mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/75 dark:bg-zinc-900/60 px-3 py-3 transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100";
  const primaryBtn =
    "w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.985] disabled:opacity-60";
  const secondaryBtn =
    "w-full rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-white active:scale-[0.985] disabled:opacity-60";

  // ✅ Google themed button
  const googleBtn =
    "w-full rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:shadow-md hover:border-blue-200 focus:outline-none focus:ring-4 focus:ring-blue-100 active:scale-[0.985] disabled:opacity-60 flex items-center justify-center gap-2";

  return (
    <div className={pageBg}>
      {/* background blobs */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute -top-28 -right-28 h-80 w-80 rounded-full bg-emerald-200/45 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-sky-200/35 blur-3xl" />
      </div>

      <div className="min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
        <div className="max-w-xl mx-auto px-5 py-10">
          {/* Header */}
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                Welcome back
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Sign in to continue.</p>
            </div>

            <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
          </div>

          {/* Lower content wrapper (stronger offset for Android/Capacitor visual spacing) */}
          <div className="pt-16 sm:pt-20 md:pt-24">
            <div aria-hidden="true" className="mb-4 h-6" />
            {/* Card */}
            <div className={glassCard}>
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
                        className="shrink-0 rounded-xl border border-amber-200 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-amber-900 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                ) : retryInfo ? (
                  <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
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
                  <span className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white dark:bg-zinc-900/60">
                    <IconGoogle className="h-[18px] w-[18px]" />
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
                        className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
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
                        className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
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
                        className="shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-2 text-zinc-700 dark:text-zinc-300 transition hover:bg-white active:scale-[0.98] disabled:opacity-60"
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
                    Review{" "}
                    <button
                      type="button"
                      onClick={() => openLegalDoc(LEGAL_DOC_KEYS.TERMS_AND_CONDITIONS)}
                      className="font-semibold text-emerald-700 transition hover:text-emerald-800"
                    >
                      Terms &amp; Conditions
                    </button>{" "}
                    and{" "}
                    <button
                      type="button"
                      onClick={() => openLegalDoc(LEGAL_DOC_KEYS.PRIVACY_POLICY)}
                      className="font-semibold text-emerald-700 transition hover:text-emerald-800"
                    >
                      Privacy Policy
                    </button>
                    .
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
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/75 dark:bg-zinc-900/60 px-3 py-3 transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100">
              <IconMail className="h-5 w-5 text-zinc-500" />
              <input
                type="email"
                className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                placeholder="name@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                disabled={resetBusy}
              />
            </div>
          </div>

          {resetMsg ? (
            <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
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


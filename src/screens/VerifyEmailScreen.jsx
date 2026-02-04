import { useEffect, useState } from "react";
import { auth } from "../firebase";
import { sendEmailVerification } from "firebase/auth";
import { useNavigate } from "react-router-dom";

/* Minimal icons */
function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
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

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="m6 12 4 4 8-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function VerifyEmailScreen() {
  const navigate = useNavigate();
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) {
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const resend = async () => {
    try {
      if (!auth.currentUser) return;
      setLoading(true);
      setMsg("");
      await sendEmailVerification(auth.currentUser);
      setMsg("Verification email sent. Check your inbox or spam folder.");
    } catch (e) {
      setMsg(e?.message || "Failed to send verification email.");
    } finally {
      setLoading(false);
    }
  };

  const check = async () => {
    try {
      if (!auth.currentUser) return;
      setLoading(true);
      setMsg("");
      await auth.currentUser.reload();

      if (auth.currentUser.emailVerified) {
        navigate("/dashboard", { replace: true });
      } else {
        setMsg("Email not verified yet. Please open the link we sent you.");
      }
    } catch (e) {
      setMsg(e?.message || "Error checking verification status.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white flex items-center justify-center px-5">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white/70 p-6 shadow-sm backdrop-blur">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl border border-emerald-100 bg-emerald-50/70 flex items-center justify-center">
              <IconMail className="h-5 w-5 text-emerald-700" />
            </div>

            <div>
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
                Verify your email
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                We’ve sent a verification link to your email address.
              </p>
            </div>
          </div>

          {/* Info */}
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white/60 p-3 text-sm text-zinc-600">
            Open your inbox, click the verification link, then return here.
          </div>

          {/* Actions */}
          <div className="mt-5 grid gap-2">
            <button
              onClick={check}
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              <IconCheck className="h-4 w-4" />
              I’ve verified my email
            </button>

            <button
              onClick={resend}
              disabled={loading}
              className="rounded-xl border border-zinc-200 bg-white/50 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60"
            >
              Resend verification email
            </button>
          </div>

          {/* Message */}
          {msg && (
            <div className="mt-4 text-sm text-zinc-700">
              {msg}
            </div>
          )}

          {/* Footer */}
          <div className="mt-6 text-center text-xs text-zinc-500">
            You can close this page after verifying and continue in the app.
          </div>
        </div>
      </div>
    </div>
  );
}
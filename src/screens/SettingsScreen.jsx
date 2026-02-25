import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
  updateEmail,
  signOut,
} from "firebase/auth";
import { auth } from "../firebase";
import { smartBack } from "../utils/navBack";

/* -------- Minimal icons (no emojis) -------- */
function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15 6 9 12l6 6"
        stroke="currentColor"
        strokeWidth="1.9"
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
        d="M7.5 10.5V8.6a4.5 4.5 0 0 1 9 0v1.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 10.5h11A2 2 0 0 1 19.5 12.5v6A2 2 0 0 1 17.5 20.5h-11A2 2 0 0 1 4.5 18.5v-6A2 2 0 0 1 6.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.5 7.5h13A2 2 0 0 1 20.5 9.5v8A2 2 0 0 1 18.5 19.5h-13A2 2 0 0 1 3.5 17.5v-8A2 2 0 0 1 5.5 7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 9l7.5 5 7.5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLogout(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M3 12h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 9.5 3 12l3.5 2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Tile({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </div>
          {subtitle ? (
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function isEmailPasswordUser(user) {
  const providers = user?.providerData || [];
  return providers.some((p) => p?.providerId === "password");
}

export default function SettingsScreen() {
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [isPasswordUser, setIsPasswordUser] = useState(false);

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  // Change email
  const [newEmail, setNewEmail] = useState("");

  // ✅ separate loading flags (fixes your issue)
  const [busyPw, setBusyPw] = useState(false);
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyReset, setBusyReset] = useState(false);
  const [busyOut, setBusyOut] = useState(false);

  const anyBusy = busyPw || busyEmail || busyReset || busyOut;

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        navigate("/login", { replace: true });
        return;
      }
      setUserEmail(u.email || "");
      setIsPasswordUser(isEmailPasswordUser(u));
      setChecking(false);
    });
    return () => unsub();
  }, [navigate]);

  const canChangePassword = useMemo(() => {
    if (!isPasswordUser) return false;
    if (anyBusy) return false;
    if (currentPassword.trim().length < 4) return false;
    if (newPassword.trim().length < 6) return false;
    if (newPassword !== newPassword2) return false;
    return true;
  }, [isPasswordUser, anyBusy, currentPassword, newPassword, newPassword2]);

  const canChangeEmail = useMemo(() => {
    if (!isPasswordUser) return false;
    if (anyBusy) return false;
    if (!newEmail.trim()) return false;
    if (!newEmail.includes("@")) return false;
    return true;
  }, [isPasswordUser, anyBusy, newEmail]);

  const goBack = () => smartBack(navigate, "/app/home");

  const reauth = async (email, password) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");
    const cred = EmailAuthProvider.credential(email, password);
    await reauthenticateWithCredential(user, cred);
  };

  const doSignOut = async () => {
    setErr("");
    setOk("");
    setBusyOut(true);
    try {
      await signOut(auth);
      navigate("/login", { replace: true });
    } finally {
      setBusyOut(false);
    }
  };

  const doResetPassword = async () => {
    setErr("");
    setOk("");
    if (!userEmail) return setErr("No email found on this account.");

    setBusyReset(true);
    try {
      await sendPasswordResetEmail(auth, userEmail);
      setOk("Password reset email sent. Check your inbox/spam.");
    } catch (e) {
      setErr(e?.message || "Failed to send reset email.");
    } finally {
      setBusyReset(false);
    }
  };

  const doChangePassword = async () => {
    setErr("");
    setOk("");

    const user = auth.currentUser;
    if (!user) return setErr("Not signed in.");
    if (!isPasswordUser)
      return setErr("This account does not use password login.");

    if (newPassword !== newPassword2) return setErr("Passwords do not match.");
    if (newPassword.trim().length < 6)
      return setErr("Password must be at least 6 characters.");

    setBusyPw(true);
    try {
      await reauth(userEmail, currentPassword);
      await updatePassword(user, newPassword.trim());

      setCurrentPassword("");
      setNewPassword("");
      setNewPassword2("");

      setOk("Password updated successfully.");
    } catch (e) {
      setErr(
        e?.message ||
          "Failed to update password. Try the reset email option if needed."
      );
    } finally {
      setBusyPw(false);
    }
  };

  const doChangeEmail = async () => {
    setErr("");
    setOk("");

    const user = auth.currentUser;
    if (!user) return setErr("Not signed in.");
    if (!isPasswordUser)
      return setErr("This account does not use email/password login.");

    const clean = String(newEmail || "").trim().toLowerCase();
    if (!clean.includes("@")) return setErr("Enter a valid email.");

    setBusyEmail(true);
    try {
      await reauth(userEmail, currentPassword);
      await updateEmail(user, clean);

      setNewEmail("");
      setUserEmail(clean);
      setOk("Email updated successfully.");
    } catch (e) {
      setErr(e?.message || "Failed to update email.");
    } finally {
      setBusyEmail(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="animate-pulse rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="h-6 w-40 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-2 h-4 w-64 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-6 h-24 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </div>
    );
  }

  const topBg =
    "bg-gradient-to-b from-emerald-50 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-xl px-5 pb-10 pt-6">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Settings
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Manage account security and sign-in options.
            </p>
          </div>

          <button
            onClick={goBack}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-white disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            <IconBack className="h-5 w-5" />
            Back
          </button>
        </div>

        {(err || ok) ? (
          <div
            className={`mt-4 rounded-2xl border p-3 text-sm ${
              err
                ? "border-rose-100 bg-rose-50/70 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200"
                : "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200"
            }`}
          >
            {err || ok}
          </div>
        ) : null}

        {/* Account info */}
        <div className="mt-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60 text-emerald-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
              <IconMail className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Signed in as
              </div>
              <div className="truncate text-sm text-zinc-600 dark:text-zinc-300">
                {userEmail || "—"}
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {" "}
                {isPasswordUser
                  ? "Email/Password"
                  : "Other (Google/Phone/etc.)"}
              </div>
            </div>
          </div>
        </div>

        {/* Change password */}
        <div className="mt-5">
          <Tile
            title="Change password"
            subtitle={
              isPasswordUser
                ? "Requires your current password (security)."
                : "Not available for this sign-in method."
            }
          >
            <div className="grid gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/40">
                <IconLock className="h-5 w-5 text-zinc-500" />
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  disabled={!isPasswordUser || anyBusy}
                  className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 dark:text-zinc-100"
                />
              </div>

              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 chars)"
                disabled={!isPasswordUser || anyBusy}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100"
              />

              <input
                type="password"
                value={newPassword2}
                onChange={(e) => setNewPassword2(e.target.value)}
                placeholder="Confirm new password"
                disabled={!isPasswordUser || anyBusy}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100"
              />

              <button
                onClick={doChangePassword}
                disabled={!canChangePassword}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                {busyPw ? "Saving..." : "Update password"}
              </button>

              <button
                onClick={doResetPassword}
                disabled={anyBusy || !userEmail}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:bg-white active:scale-[0.99] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100"
              >
                {busyReset ? "Please wait..." : "Send password reset email"}
              </button>

              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Tip: If you see “requires recent login”, use reset email.
              </div>
            </div>
          </Tile>
        </div>

        {/* Change email */}
        <div className="mt-3">
          <Tile
            title="Change email"
            subtitle={
              isPasswordUser
                ? "Also requires your current password."
                : "Not available for this sign-in method."
            }
          >
            <div className="grid gap-3">
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="New email address"
                disabled={!isPasswordUser || anyBusy}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100"
              />

              <button
                onClick={doChangeEmail}
                disabled={!canChangeEmail}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                {busyEmail ? "Saving..." : "Update email"}
              </button>

              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Note: Changing email requires re-verification.
              </div>
            </div>
          </Tile>
        </div>

        {/* Sign out */}
        <div className="mt-3">
          <Tile title="Sign out" subtitle>
            <button
              onClick={doSignOut}
              disabled={anyBusy}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:bg-white active:scale-[0.99] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <IconLogout className="h-5 w-5" />
                {busyOut ? "Signing out..." : "Sign out"}
              </span>
            </button>
          </Tile>
        </div>

      </div>
    </div>
  );
}


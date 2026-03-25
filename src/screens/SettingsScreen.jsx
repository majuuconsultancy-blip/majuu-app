import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
  updateEmail,
} from "firebase/auth";

import CollapsibleSection from "../components/CollapsibleSection";
import { auth } from "../firebase";
import { smartBack } from "../utils/navBack";
import {
  disableBiometricLockForUser,
  enableBiometricLockForUser,
  getBiometricCapability,
  getBiometricLockEnabled,
} from "../services/biometricLockService";

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

function IconEye(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function IconEyeOff(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3 3 21 21"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.6 6.3A10.7 10.7 0 0 1 12 6.2c6 0 9.5 5.8 9.5 5.8a15.7 15.7 0 0 1-4.1 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 7.4A15.8 15.8 0 0 0 2.5 12s3.5 5.8 9.5 5.8c.8 0 1.6-.1 2.3-.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.9 9.8a3.4 3.4 0 0 0 4.3 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ToggleSwitch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition disabled:opacity-60 ${
        checked
          ? "border-emerald-500 bg-emerald-500"
          : "border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800"
      }`}
    >
      <span
        className={`inline-flex h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-7" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function PasswordField({
  value,
  onChange,
  placeholder,
  disabled = false,
  revealed = false,
  onToggle,
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
      <IconLock className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
      />
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        aria-label={revealed ? "Hide password" : "Show password"}
      >
        {revealed ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function isEmailPasswordUser(user) {
  const providers = user?.providerData || [];
  return providers.some((provider) => provider?.providerId === "password");
}

export default function SettingsScreen() {
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [userEmail, setUserEmail] = useState("");
  const [isPasswordUser, setIsPasswordUser] = useState(false);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showEmailPassword, setShowEmailPassword] = useState(false);

  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioLoading, setBioLoading] = useState(true);
  const [bioCapability, setBioCapability] = useState({
    supported: false,
    available: false,
    strongAvailable: false,
    deviceSecure: false,
    reason: "",
    code: "",
  });

  const [busyPw, setBusyPw] = useState(false);
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyReset, setBusyReset] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let cancelled = false;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUserEmail(user.email || "");
      setIsPasswordUser(isEmailPasswordUser(user));

      try {
        const [enabled, capability] = await Promise.all([
          getBiometricLockEnabled(user.uid),
          getBiometricCapability(),
        ]);
        if (cancelled) return;
        setBioEnabled(Boolean(enabled));
        setBioCapability(capability);
      } catch (error) {
        void error;
      } finally {
        if (!cancelled) {
          setBioLoading(false);
          setChecking(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigate]);

  const anyBusy = busyPw || busyEmail || busyReset || bioBusy;
  const canUseSecureUnlock =
    bioCapability.supported && (bioCapability.available || bioCapability.deviceSecure);

  const canChangePassword = useMemo(() => {
    if (!isPasswordUser || anyBusy) return false;
    if (currentPassword.trim().length < 4) return false;
    if (newPassword.trim().length < 6) return false;
    if (newPassword !== newPassword2) return false;
    return true;
  }, [isPasswordUser, anyBusy, currentPassword, newPassword, newPassword2]);

  const canChangeEmail = useMemo(() => {
    if (!isPasswordUser || anyBusy) return false;
    if (emailPassword.trim().length < 4) return false;
    if (!newEmail.trim() || !newEmail.includes("@")) return false;
    return true;
  }, [isPasswordUser, anyBusy, emailPassword, newEmail]);

  const goBack = () => smartBack(navigate, "/app/profile");

  const reauth = async (email, password) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");
    const credential = EmailAuthProvider.credential(email, password);
    await reauthenticateWithCredential(user, credential);
  };

  const doToggleSecureUnlock = async () => {
    const user = auth.currentUser;
    if (!user) {
      setErr("Not signed in.");
      return;
    }

    setErr("");
    setOk("");
    setBioBusy(true);

    try {
      if (bioEnabled) {
        const result = await disableBiometricLockForUser(user.uid);
        if (!result.ok) {
          setErr(result.message || "Could not turn off secure unlock.");
          return;
        }
        setBioEnabled(false);
        setOk("Secure unlock turned off.");
        return;
      }

      const latestCapability = await getBiometricCapability();
      setBioCapability(latestCapability);
      if (!latestCapability.supported) {
        setErr("Secure unlock is available only in Android/iOS app builds.");
        return;
      }
      if (!latestCapability.available && !latestCapability.deviceSecure) {
        setErr("Set up biometrics or a phone screen lock first.");
        return;
      }

      const result = await enableBiometricLockForUser(user.uid, "Enable secure app unlock");
      if (!result.ok) {
        setErr(result.message || "Could not turn on secure unlock.");
        return;
      }
      setBioEnabled(true);
      setOk("Secure unlock turned on.");
    } finally {
      setBioBusy(false);
    }
  };

  const doResetPassword = async () => {
    setErr("");
    setOk("");
    if (!userEmail) {
      setErr("No email found on this account.");
      return;
    }

    setBusyReset(true);
    try {
      await sendPasswordResetEmail(auth, userEmail);
      setOk("Password reset email sent. Check your inbox or spam folder.");
    } catch (error) {
      setErr(error?.message || "Failed to send reset email.");
    } finally {
      setBusyReset(false);
    }
  };

  const doChangePassword = async () => {
    setErr("");
    setOk("");

    const user = auth.currentUser;
    if (!user) {
      setErr("Not signed in.");
      return;
    }
    if (!isPasswordUser) {
      setErr("This account does not use password login.");
      return;
    }
    if (newPassword !== newPassword2) {
      setErr("Passwords do not match.");
      return;
    }
    if (newPassword.trim().length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }

    setBusyPw(true);
    try {
      await reauth(userEmail, currentPassword);
      await updatePassword(user, newPassword.trim());
      setCurrentPassword("");
      setNewPassword("");
      setNewPassword2("");
      setPasswordOpen(false);
      setOk("Password updated successfully.");
    } catch (error) {
      setErr(
        error?.message ||
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
    if (!user) {
      setErr("Not signed in.");
      return;
    }
    if (!isPasswordUser) {
      setErr("This account does not use email/password login.");
      return;
    }

    const cleanEmail = String(newEmail || "").trim().toLowerCase();
    if (!cleanEmail.includes("@")) {
      setErr("Enter a valid email.");
      return;
    }

    setBusyEmail(true);
    try {
      await reauth(userEmail, emailPassword);
      await updateEmail(user, cleanEmail);
      setNewEmail("");
      setEmailPassword("");
      setUserEmail(cleanEmail);
      setEmailOpen(false);
      setOk("Email updated successfully.");
    } catch (error) {
      setErr(error?.message || "Failed to update email.");
    } finally {
      setBusyEmail(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="animate-pulse rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
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
  const card =
    "rounded-3xl border border-zinc-200/80 bg-white/72 p-4 shadow-sm backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/58";

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-xl px-5 pb-10 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[2rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Settings
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Manage account security and sign-in options.
            </p>
          </div>

          <button
            onClick={goBack}
            disabled={anyBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-white disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            <IconBack className="h-5 w-5" />
            Back
          </button>
        </div>

        {err || ok ? (
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

        <div className={`mt-6 ${card}`}>
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/60 text-emerald-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
              <IconMail className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Signed in as</div>
              <div className="truncate text-sm text-zinc-600 dark:text-zinc-300">{userEmail || "-"}</div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {isPasswordUser ? "Email/Password" : "Other (Google/Phone/etc.)"}
              </div>
            </div>
          </div>
        </div>

        <div className={`mt-3 ${card}`}>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Secure app unlock
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Use phone's biometric lock for faster app reopens
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                {bioLoading ? "Checking..." : bioEnabled ? "On" : "Off"}
              </span>
              <ToggleSwitch
                checked={bioEnabled}
                onChange={doToggleSecureUnlock}
                disabled={bioLoading || bioBusy || (!canUseSecureUnlock && !bioEnabled)}
              />
            </div>
          </div>

          {!canUseSecureUnlock && !bioEnabled && !bioLoading ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Device support status: {bioCapability.reason || "No biometric or screen lock support detected."}
            </div>
          ) : null}
        </div>

        <div className={`mt-3 ${card}`}>
          <CollapsibleSection
            title="Change password"
            subtitle={
              isPasswordUser
                ? "Use your current password to protect this change."
                : "Not available for this sign-in method."
            }
            open={passwordOpen}
            onToggle={setPasswordOpen}
            disabled={!isPasswordUser}
            bodyClassName="mt-4 grid gap-3"
          >
            <PasswordField
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Current password"
              disabled={!isPasswordUser || anyBusy}
              revealed={showCurrentPassword}
              onToggle={() => setShowCurrentPassword((value) => !value)}
            />
            <PasswordField
              value={newPassword}
              onChange={setNewPassword}
              placeholder="New password"
              disabled={!isPasswordUser || anyBusy}
              revealed={showNewPassword}
              onToggle={() => setShowNewPassword((value) => !value)}
            />
            <PasswordField
              value={newPassword2}
              onChange={setNewPassword2}
              placeholder="Confirm new password"
              disabled={!isPasswordUser || anyBusy}
              revealed={showConfirmPassword}
              onToggle={() => setShowConfirmPassword((value) => !value)}
            />

            <button
              onClick={doChangePassword}
              disabled={!canChangePassword}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {busyPw ? "Saving..." : "Update password"}
            </button>

            <button
              onClick={doResetPassword}
              disabled={anyBusy || !userEmail}
              className="w-full rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-950"
            >
              {busyReset ? "Please wait..." : "Send password reset email"}
            </button>

            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Tip: If you see a recent login warning, use the reset email option.
            </div>
          </CollapsibleSection>
        </div>

        <div className={`mt-3 ${card}`}>
          <CollapsibleSection
            title="Change email"
            subtitle={
              isPasswordUser
                ? "Re-enter your password before updating your email address."
                : "Not available for this sign-in method."
            }
            open={emailOpen}
            onToggle={setEmailOpen}
            disabled={!isPasswordUser}
            bodyClassName="mt-4 grid gap-3"
          >
            <div className="rounded-2xl border border-zinc-200/80 bg-white/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Current email
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {userEmail || "-"}
              </div>
            </div>

            <PasswordField
              value={emailPassword}
              onChange={setEmailPassword}
              placeholder="Current password"
              disabled={!isPasswordUser || anyBusy}
              revealed={showEmailPassword}
              onToggle={() => setShowEmailPassword((value) => !value)}
            />

            <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
              <IconMail className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
              <input
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="New email address"
                disabled={!isPasswordUser || anyBusy}
                className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <button
              onClick={doChangeEmail}
              disabled={!canChangeEmail}
              className="w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {busyEmail ? "Saving..." : "Update email"}
            </button>

            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Note: Changing email may require verification on your updated address.
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}

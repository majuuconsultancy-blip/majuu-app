import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import {
  AndroidBiometryStrength,
  BiometricAuth,
  BiometryError,
  BiometryErrorType,
} from "@aparajita/capacitor-biometric-auth";

const LOCK_KEY_PREFIX = "majuu:biometric_lock_enabled:";
const PROMPT_KEY_PREFIX = "majuu:biometric_prompt_pending:";
const IS_NATIVE = Capacitor.isNativePlatform();

function safeUid(uid) {
  return String(uid || "").trim();
}

function lockKey(uid) {
  const id = safeUid(uid);
  return id ? `${LOCK_KEY_PREFIX}${id}` : "";
}

function promptKey(uid) {
  const id = safeUid(uid);
  return id ? `${PROMPT_KEY_PREFIX}${id}` : "";
}

function isTrueLike(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

async function readBool(key, fallback = false) {
  if (!key) return fallback;
  try {
    const { value } = await Preferences.get({ key });
    if (value == null) return fallback;
    return isTrueLike(value);
  } catch (error) {
    void error;
    return fallback;
  }
}

async function writeBool(key, value) {
  if (!key) return;
  await Preferences.set({ key, value: value ? "1" : "0" });
}

function humanizeBiometryError(code, fallback = "") {
  switch (code) {
    case BiometryErrorType.biometryNotEnrolled:
      return "No biometrics are enrolled on this phone.";
    case BiometryErrorType.biometryNotAvailable:
      return "Biometric unlock is not available on this phone.";
    case BiometryErrorType.passcodeNotSet:
    case BiometryErrorType.noDeviceCredential:
      return "Set a phone screen lock (PIN, pattern, or password) first.";
    case BiometryErrorType.biometryLockout:
      return "Too many failed attempts. Try again in a moment.";
    case BiometryErrorType.authenticationFailed:
      return "Authentication failed. Try again.";
    case BiometryErrorType.userCancel:
    case BiometryErrorType.appCancel:
    case BiometryErrorType.systemCancel:
    case BiometryErrorType.userFallback:
      return "Authentication cancelled.";
    default:
      return String(fallback || "Could not complete secure unlock.");
  }
}

function parseBiometryError(error) {
  const code = String(
    error instanceof BiometryError ? error.code : error?.code || BiometryErrorType.none
  );
  const message = humanizeBiometryError(code, error?.message);
  const cancelled =
    code === BiometryErrorType.userCancel ||
    code === BiometryErrorType.appCancel ||
    code === BiometryErrorType.systemCancel ||
    code === BiometryErrorType.userFallback;

  return { code, message, cancelled };
}

function canUseCapability(capability) {
  return Boolean(capability?.supported && (capability?.available || capability?.deviceSecure));
}

async function authenticateSecurePrompt(reason = "Unlock MAJUU") {
  if (!IS_NATIVE) {
    return {
      ok: false,
      code: "native_only",
      cancelled: false,
      message: "Secure unlock is only available on Android/iOS app builds.",
    };
  }

  try {
    await BiometricAuth.authenticate({
      reason: String(reason || "Unlock MAJUU"),
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use passcode",
      androidTitle: "Unlock MAJUU",
      androidSubtitle: "Use biometrics or phone security",
      androidConfirmationRequired: false,
      androidBiometryStrength: AndroidBiometryStrength.weak,
    });

    return { ok: true, code: "", cancelled: false, message: "" };
  } catch (error) {
    const parsed = parseBiometryError(error);
    return { ok: false, ...parsed };
  }
}

export function isLikelyFirstSignIn(user) {
  const createdAt = Date.parse(String(user?.metadata?.creationTime || ""));
  const lastSignInAt = Date.parse(String(user?.metadata?.lastSignInTime || ""));
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSignInAt)) return false;

  return Math.abs(lastSignInAt - createdAt) <= 2 * 60 * 1000;
}

export async function getBiometricCapability() {
  if (!IS_NATIVE) {
    return {
      supported: false,
      available: false,
      strongAvailable: false,
      deviceSecure: false,
      reason: "Native app required",
      code: "native_only",
    };
  }

  try {
    const info = await BiometricAuth.checkBiometry();
    return {
      supported: true,
      available: Boolean(info?.isAvailable),
      strongAvailable: Boolean(info?.strongBiometryIsAvailable),
      deviceSecure: Boolean(info?.deviceIsSecure),
      reason: String(info?.reason || ""),
      code: String(info?.code || ""),
    };
  } catch (error) {
    return {
      supported: false,
      available: false,
      strongAvailable: false,
      deviceSecure: false,
      reason: String(error?.message || "Biometric capability check failed"),
      code: String(error?.code || "check_failed"),
    };
  }
}

export async function getBiometricLockEnabled(uid) {
  return readBool(lockKey(uid), false);
}

export async function setBiometricLockEnabled(uid, enabled) {
  await writeBool(lockKey(uid), Boolean(enabled));
}

export async function isBiometricPromptPending(uid) {
  return readBool(promptKey(uid), false);
}

export async function setBiometricPromptPending(uid, pending) {
  await writeBool(promptKey(uid), Boolean(pending));
}

export async function verifyBiometricUnlock(reason = "Unlock MAJUU") {
  return authenticateSecurePrompt(reason);
}

export async function enableBiometricLockForUser(uid, reason = "Turn on secure app unlock") {
  const id = safeUid(uid);
  if (!id) {
    return { ok: false, code: "missing_uid", cancelled: false, message: "Missing account id." };
  }

  const capability = await getBiometricCapability();
  if (!canUseCapability(capability)) {
    return {
      ok: false,
      code: capability.code || "unsupported",
      cancelled: false,
      message:
        capability.reason ||
        "Secure unlock is unavailable. Set biometrics or phone screen lock first.",
    };
  }

  const authResult = await authenticateSecurePrompt(reason);
  if (!authResult.ok) return authResult;

  await setBiometricLockEnabled(id, true);
  await setBiometricPromptPending(id, false);
  return { ok: true, code: "", cancelled: false, message: "" };
}

export async function disableBiometricLockForUser(uid) {
  const id = safeUid(uid);
  if (!id) return { ok: false, code: "missing_uid", message: "Missing account id." };

  await setBiometricLockEnabled(id, false);
  await setBiometricPromptPending(id, false);
  return { ok: true, code: "", message: "" };
}

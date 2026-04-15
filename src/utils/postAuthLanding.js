import { resolveLandingPathFromUserState } from "../journey/journeyLanding";
import { isBiometricPromptPending } from "../services/biometricLockService";

export const BIOMETRIC_SETUP_PATH = "/setup/biometric";

const BIOMETRIC_PROMPT_BYPASS_PATHS = new Set([
  "/intro",
  "/login",
  "/signup",
  "/verify-email",
  "/setup",
  BIOMETRIC_SETUP_PATH,
]);

function safeString(value, max = 260) {
  return String(value || "").trim().slice(0, max);
}

export function shouldBypassBiometricPromptEnforcement(pathname) {
  const path = safeString(pathname, 260);
  if (!path) return true;
  if (BIOMETRIC_PROMPT_BYPASS_PATHS.has(path)) return true;
  if (path.startsWith("/setup/")) return true;
  return false;
}

export async function resolvePostAuthLandingPath({ uid, userState } = {}) {
  const landing = resolveLandingPathFromUserState(userState || {});
  if (landing === "/setup") return landing;

  const safeUid = safeString(uid, 160);
  if (!safeUid) return landing;

  try {
    const promptPending = await isBiometricPromptPending(safeUid);
    if (promptPending) return BIOMETRIC_SETUP_PATH;
  } catch (error) {
    void error;
  }

  return landing;
}

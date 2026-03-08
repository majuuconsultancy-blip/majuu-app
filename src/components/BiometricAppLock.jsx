import { useEffect, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useLocation } from "react-router-dom";
import { auth } from "../firebase";
import {
  getBiometricLockEnabled,
  verifyBiometricUnlock,
} from "../services/biometricLockService";

const PUBLIC_PATHS = new Set(["/login", "/signup", "/verify-email", "/intro"]);

function shouldSkipLock(pathname) {
  return PUBLIC_PATHS.has(String(pathname || "").trim());
}

export default function BiometricAppLock() {
  const location = useLocation();
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const mountedRef = useRef(false);
  const uidRef = useRef("");
  const lockEnabledRef = useRef(false);
  const promptInFlightRef = useRef(false);
  const wasBackgroundRef = useRef(false);
  const lastUnlockSuccessAtRef = useRef(0);
  const authSeqRef = useRef(0);
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const promptUnlock = async (reason = "Unlock MAJUU to continue") => {
    if (shouldSkipLock(pathRef.current)) return true;
    if (!uidRef.current || !lockEnabledRef.current) return true;
    if (promptInFlightRef.current) return false;

    promptInFlightRef.current = true;
    if (mountedRef.current) {
      setBusy(true);
      setMessage("");
    }

    const result = await verifyBiometricUnlock(reason);

    if (mountedRef.current) {
      if (result.ok) {
        setLocked(false);
        setMessage("");
        lastUnlockSuccessAtRef.current = Date.now();
      } else {
        setLocked(true);
        if (!result.cancelled) {
          setMessage(result.message || "Unlock failed. Try again.");
        }
      }
      setBusy(false);
    }

    promptInFlightRef.current = false;
    return result.ok;
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      authSeqRef.current += 1;
      const seq = authSeqRef.current;
      const prevUid = uidRef.current;

      if (!user) {
        uidRef.current = "";
        lockEnabledRef.current = false;
        if (mountedRef.current) {
          setLocked(false);
          setMessage("");
        }
        return;
      }

      uidRef.current = user.uid;
      const enabled = await getBiometricLockEnabled(user.uid);
      if (!mountedRef.current || seq !== authSeqRef.current) return;

      lockEnabledRef.current = enabled;

      if (!enabled || shouldSkipLock(pathRef.current)) {
        setLocked(false);
        setMessage("");
        return;
      }

      const restoreSession = !prevUid && pathRef.current !== "/login" && pathRef.current !== "/signup";
      if (restoreSession) {
        setLocked(true);
        setMessage("");
        void promptUnlock();
      }
    });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    let cleanedUp = false;
    let removeListener = null;

    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!uidRef.current || !lockEnabledRef.current) return;
      if (shouldSkipLock(pathRef.current)) return;

      // Android may emit app state changes while the system auth sheet is shown.
      // Ignore those transitions to avoid re-triggering unlock in a loop.
      if (promptInFlightRef.current) return;

      if (!isActive) {
        wasBackgroundRef.current = true;
        setLocked(true);
        setMessage("");
        return;
      }

      // Guard against immediate duplicate "active" events right after a successful unlock.
      if (Date.now() - lastUnlockSuccessAtRef.current < 1200) {
        return;
      }

      if (wasBackgroundRef.current) {
        wasBackgroundRef.current = false;
        void promptUnlock();
      }
    }).then((listener) => {
      if (cleanedUp) {
        listener.remove();
        return;
      }
      removeListener = () => listener.remove();
    });

    return () => {
      cleanedUp = true;
      if (removeListener) removeListener();
    };
  }, []);

  if (!locked || shouldSkipLock(location.pathname)) return null;

  return (
    <div className="fixed inset-0 z-[1200] bg-zinc-950/70 backdrop-blur-sm">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-xl items-center justify-center px-5">
        <div className="w-full rounded-3xl border border-zinc-200 bg-white p-5 shadow-xl">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">Unlock required</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Use biometrics or phone security to continue.
          </p>

          {message ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {message}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => {
                void promptUnlock();
              }}
              disabled={busy}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? "Checking..." : "Unlock"}
            </button>

            <button
              type="button"
              onClick={() => {
                void signOut(auth);
              }}
              disabled={busy}
              className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

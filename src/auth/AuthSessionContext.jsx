/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth, authPersistenceReady } from "../firebase";
import {
  readSessionRestoreHint,
  writeSessionRestoreHint,
} from "../utils/sessionRestoreHint";

const AUTH_RESTORE_TIMEOUT_MS = 10000;

const AuthSessionContext = createContext(null);

export function AuthSessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [restoreLikelySession, setRestoreLikelySession] = useState(() =>
    readSessionRestoreHint()
  );

  useEffect(() => {
    let active = true;
    let resolved = false;
    let unsubscribe = () => {};
    let timeoutId = null;

    const updateRestoreHint = (hasSession) => {
      const normalized = Boolean(hasSession);
      setRestoreLikelySession(normalized);
      writeSessionRestoreHint(normalized);
    };

    const finalize = (nextUser) => {
      if (!active) return;
      const normalizedUser = nextUser || null;
      setUser(normalizedUser);
      updateRestoreHint(Boolean(normalizedUser));
      if (!resolved) {
        resolved = true;
        setAuthInitializing(false);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const subscribeToAuthState = () => {
      unsubscribe = onAuthStateChanged(
        auth,
        (nextUser) => finalize(nextUser),
        () => finalize(auth.currentUser)
      );
    };

    const boot = async () => {
      const initialHint = readSessionRestoreHint();
      if (active) setRestoreLikelySession(initialHint);
      const hasKnownSessionHint = initialHint || Boolean(auth.currentUser);

      if (!hasKnownSessionHint) {
        finalize(null);
        subscribeToAuthState();
        return;
      }

      try {
        await authPersistenceReady;
      } catch (error) {
        void error;
      }

      if (typeof auth?.authStateReady === "function") {
        try {
          await Promise.race([
            auth.authStateReady(),
            new Promise((resolve) => window.setTimeout(resolve, AUTH_RESTORE_TIMEOUT_MS)),
          ]);
        } catch (error) {
          void error;
        }
      }

      if (!active) return;

      subscribeToAuthState();

      if (auth.currentUser && !resolved) {
        finalize(auth.currentUser);
        return;
      }

      timeoutId = window.setTimeout(() => finalize(auth.currentUser), AUTH_RESTORE_TIMEOUT_MS);
    };

    void boot();

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      authInitializing,
      authLoading: authInitializing,
      isAuthenticated: Boolean(user),
      restoreLikelySession,
    }),
    [authInitializing, restoreLikelySession, user]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return ctx;
}

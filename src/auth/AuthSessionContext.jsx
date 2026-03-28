import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth, authPersistenceReady } from "../firebase";

const AUTH_RESTORE_TIMEOUT_MS = 10000;

const AuthSessionContext = createContext(null);

export function AuthSessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authInitializing, setAuthInitializing] = useState(true);

  useEffect(() => {
    let active = true;
    let resolved = false;
    let unsubscribe = () => {};
    let timeoutId = null;

    const finalize = (nextUser) => {
      if (!active) return;
      setUser(nextUser || null);
      if (!resolved) {
        resolved = true;
        setAuthInitializing(false);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const boot = async () => {
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

      unsubscribe = onAuthStateChanged(
        auth,
        (nextUser) => finalize(nextUser),
        () => finalize(auth.currentUser)
      );

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
    }),
    [authInitializing, user]
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

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../firebase";
import {
  HOME_DESIGN_DEFAULT_CONTEXT,
  subscribeActiveHomeDesignModule,
} from "../services/homeDesignService";

export function useHomeDesignModule({
  trackType = "",
  contextKey = HOME_DESIGN_DEFAULT_CONTEXT,
} = {}) {
  const [module, setModule] = useState(null);
  const [authReady, setAuthReady] = useState(Boolean(auth.currentUser));
  const [canRead, setCanRead] = useState(Boolean(auth.currentUser));
  const [loading, setLoading] = useState(Boolean(trackType));
  const [error, setError] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setAuthReady(true);
      setCanRead(Boolean(user));
    });
  }, []);

  useEffect(() => {
    if (!trackType) {
      setModule(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    if (!authReady) {
      setLoading(true);
      return undefined;
    }

    if (!canRead) {
      setModule(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    setLoading(true);
    setError("");

    return subscribeActiveHomeDesignModule({
      trackType,
      contextKey,
      onData: (row) => {
        setModule(row || null);
        setLoading(false);
      },
      onError: (nextError) => {
        console.error("home design module load failed:", nextError);
        setModule(null);
        setError(nextError?.message || "Failed to load home design module.");
        setLoading(false);
      },
    });
  }, [authReady, canRead, trackType, contextKey]);

  return useMemo(
    () => ({
      module,
      loading,
      error,
    }),
    [module, loading, error]
  );
}

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { getUserState } from "../services/userservice";
import { normalizeJourney } from "../journey/journeyModel";

export function useUserJourney({ enabled = true } = {}) {
  const [uid, setUid] = useState("");
  const [journey, setJourney] = useState(() => normalizeJourney(null));
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const nextUid = String(user?.uid || "");
      if (cancelled) return;
      setUid(nextUid);
      setError("");
      if (!nextUid) {
        setJourney(normalizeJourney(null));
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const state = await getUserState(nextUid, user?.email || "");
        if (cancelled) return;
        setJourney(normalizeJourney(state?.journey));
      } catch (err) {
        if (cancelled) return;
        console.warn("useUserJourney failed:", err?.message || err);
        setJourney(normalizeJourney(null));
        setError(err?.message || "Failed to load journey.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [enabled]);

  return useMemo(() => ({ uid, journey, loading, error }), [uid, journey, loading, error]);
}


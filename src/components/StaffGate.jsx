import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";

import { auth, db, authPersistenceReady } from "../firebase";
import ScreenLoader from "./ScreenLoader";

const AUTH_NULL_GRACE_MS = 1200;

export default function StaffGate({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [checking, setChecking] = useState(true);
  const logoutTimerRef = useRef(null);
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;

    const clearTimer = () => {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };

    const unsubPromise = (async () => {
      try {
        await authPersistenceReady;
      } catch {}
      if (cancelled) return () => {};

      const unsub = onAuthStateChanged(auth, async (user) => {
        if (user) clearTimer();

        if (!user) {
          setChecking(true);

          clearTimer();
          logoutTimerRef.current = setTimeout(() => {
            const u2 = auth.currentUser;
            if (!u2) {
              setChecking(false);
              navigate("/login", { replace: true, state: { from: pathRef.current } });
              return;
            }
            setChecking(false);
          }, AUTH_NULL_GRACE_MS);

          return;
        }

        try {
          const staffRef = doc(db, "staff", user.uid);
          const staffSnap = await getDoc(staffRef);

          if (!staffSnap.exists()) {
            navigate("/dashboard", { replace: true });
            return;
          }

          const staff = staffSnap.data() || {};

          if (staff.active !== true) {
            navigate("/dashboard", { replace: true });
            return;
          }

          const isOnboardingRoute = pathRef.current.startsWith("/staff/onboarding");
          if (staff.onboarded !== true && !isOnboardingRoute) {
            navigate("/staff/onboarding", { replace: true });
            return;
          }

          setChecking(false);
        } catch {
          navigate("/dashboard", { replace: true });
        }
      });

      return unsub;
    })();

    return () => {
      cancelled = true;
      clearTimer();
      // unsub when resolved
      unsubPromise.then((unsub) => unsub && unsub()).catch(() => {});
    };
  }, [navigate]);

  if (checking) {
    return <ScreenLoader title="Preparing staff session…" subtitle="Checking access and loading tasks" />;
  }

  return children;
}

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";

import { auth, authPersistenceReady } from "../firebase";
import { getCurrentUserRoleContext } from "../services/adminroleservice";

const AUTH_NULL_GRACE_MS = 1200;

export default function AdminGate({ children }) {
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
      if (typeof auth?.authStateReady === "function") {
        try {
          await auth.authStateReady();
        } catch {}
      }
      if (cancelled) return () => {};

      const unsub = onAuthStateChanged(auth, (user) => {
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

        (async () => {
          try {
            const roleCtx = await getCurrentUserRoleContext(user.uid);
            if (!roleCtx.isAdmin) {
              navigate("/dashboard", { replace: true });
              return;
            }
            setChecking(false);
          } catch {
            navigate("/dashboard", { replace: true });
          }
        })();
      });

      return unsub;
    })();

    return () => {
      cancelled = true;
      clearTimer();
      unsubPromise.then((unsub) => unsub && unsub()).catch(() => {});
    };
  }, [navigate]);

  if (checking) {
    return (
      <div className="p-6">
        <p className="font-semibold">Checking Admin access…</p>
      </div>
    );
  }

  return children;
}

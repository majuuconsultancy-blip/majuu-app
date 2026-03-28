import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthSession } from "../auth/AuthSessionContext";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import ScreenLoader from "./ScreenLoader";

export default function AdminGate({ children }) {
  const { user, isAuthenticated, authInitializing } = useAuthSession();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (authInitializing) {
      setChecking(true);
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated || !user?.uid) {
      navigate("/login", { replace: true });
      return () => {
        cancelled = true;
      };
    }

    setChecking(true);

    void (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext(user.uid);
        if (cancelled) return;
        if (!roleCtx.isAdmin) {
          navigate("/dashboard", { replace: true });
          return;
        }
        setChecking(false);
      } catch {
        if (cancelled) return;
        navigate("/dashboard", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authInitializing, isAuthenticated, navigate, user?.uid]);

  if (authInitializing || checking) {
    return (
      <ScreenLoader
        title="Checking admin access..."
        subtitle="Verifying your permissions"
        variant="minimal"
      />
    );
  }

  return children;
}

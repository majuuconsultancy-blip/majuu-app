import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuthSession } from "../auth/AuthSessionContext";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { managerHasModuleAccess } from "../services/managerModules";
import ScreenLoader from "./ScreenLoader";

export default function AdminGate({
  children,
  allowManager = false,
  requiredManagerModule = "",
  fallbackPath = "/dashboard",
}) {
  const { user, isAuthenticated, authInitializing } = useAuthSession();
  const navigate = useNavigate();
  const [grantedAccessKey, setGrantedAccessKey] = useState("");
  const accessKey = `${user?.uid || "anonymous"}:${allowManager ? "manager" : "admin"}:${requiredManagerModule || "all"}`;
  const checking = authInitializing || grantedAccessKey !== accessKey;

  useEffect(() => {
    let cancelled = false;

    if (authInitializing) {
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

    void (async () => {
      try {
        const roleCtx = await getCurrentUserRoleContext(user.uid);
        if (cancelled) return;
        const adminAllowed = Boolean(roleCtx?.isAdmin);
        const managerAllowed =
          Boolean(allowManager) &&
          Boolean(roleCtx?.isManager) &&
          (!requiredManagerModule ||
            managerHasModuleAccess(roleCtx?.managerScope, requiredManagerModule));

        if (!adminAllowed && !managerAllowed) {
          navigate(fallbackPath, { replace: true });
          return;
        }
        setGrantedAccessKey(accessKey);
      } catch {
        if (cancelled) return;
        navigate(fallbackPath, { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    allowManager,
    authInitializing,
    fallbackPath,
    isAuthenticated,
    navigate,
    requiredManagerModule,
    accessKey,
    user?.uid,
  ]);

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

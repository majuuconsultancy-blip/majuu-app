import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuthSession } from "../auth/AuthSessionContext";
import { db } from "../firebase";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { isStaffAccessEnabled } from "../services/staffaccessservice";
import ScreenLoader from "./ScreenLoader";

export default function StaffGate({ children }) {
  const { user, isAuthenticated, authInitializing } = useAuthSession();
  const navigate = useNavigate();
  const location = useLocation();
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
      navigate("/login", { replace: true, state: { from: location.pathname } });
      return () => {
        cancelled = true;
      };
    }

    setChecking(true);

    void (async () => {
      try {
        const uid = user.uid;
        const staffRef = doc(db, "staff", uid);
        const staffSnap = await getDoc(staffRef).catch(() => null);
        const hasStaffDoc = Boolean(staffSnap?.exists?.());
        const staff = hasStaffDoc ? staffSnap.data() || {} : null;
        const byStaffDoc = hasStaffDoc && isStaffAccessEnabled(staff);

        const roleCtx = await getCurrentUserRoleContext(uid).catch(() => null);
        const byRoleCtx = roleCtx?.role === "staff";

        const [taskProbe, requestProbe] = await Promise.all([
          getDocs(query(collection(db, "staff", uid, "tasks"), limit(1))).catch(() => null),
          getDocs(
            query(collection(db, "serviceRequests"), where("assignedTo", "==", uid), limit(1))
          ).catch(() => null),
        ]);

        if (cancelled) return;

        const byAssignmentSignal = Boolean(taskProbe?.docs?.length || requestProbe?.docs?.length);
        if (!byStaffDoc && !byRoleCtx && !byAssignmentSignal) {
          navigate("/dashboard", { replace: true });
          return;
        }

        const isOnboardingRoute = String(location.pathname || "").startsWith("/staff/onboarding");
        if (staff && byStaffDoc && staff.onboarded !== true && !isOnboardingRoute) {
          navigate("/staff/onboarding", { replace: true });
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
  }, [authInitializing, isAuthenticated, location.pathname, navigate, user?.uid]);

  if (authInitializing || checking) {
    return <ScreenLoader title="Preparing staff session..." subtitle="Checking access and loading tasks" />;
  }

  return children;
}

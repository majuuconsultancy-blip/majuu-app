// ✅ StaffGate.jsx (FULL COPY-PASTE)
// Improvements:
// - ✅ Treats onboarded missing/undefined as NOT onboarded (safer)
// - ✅ Avoids onboarding redirect loops by allowing onboarding path

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";
import ScreenLoader from "./ScreenLoader";

export default function StaffGate({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true, state: { from: location.pathname } });
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

        // must be active
        if (staff.active !== true) {
          navigate("/dashboard", { replace: true });
          return;
        }

        // ✅ Force onboarding if onboarded is NOT true (false or missing)
        const isOnboardingRoute = location.pathname.startsWith("/staff/onboarding");
        if (staff.onboarded !== true && !isOnboardingRoute) {
          navigate("/staff/onboarding", { replace: true });
          return;
        }

        setChecking(false);
      } catch (e) {
        // fail closed (but keep it deterministic)
        navigate("/dashboard", { replace: true });
      }
    });

    return () => unsub();
  }, [navigate, location.pathname]);

  if (checking) {
    return (
      <ScreenLoader
        title="Preparing staff session…"
        subtitle="Checking access and loading tasks"
      />
    );
  }

  return children;
}
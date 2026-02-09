// ✅ StaffGate.jsx (FULL COPY-PASTE)
// Protects /staff/* routes so normal users can't access them.

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
          // not staff -> kick to normal app
          navigate("/dashboard", { replace: true });
          return;
        }

        const staff = staffSnap.data() || {};
        if (!staff.active) {
          navigate("/dashboard", { replace: true });
          return;
        }

        // ✅ Optional: force onboarding first
        if (staff.onboarded === false && location.pathname !== "/staff/onboarding") {
          navigate("/staff/onboarding", { replace: true });
          return;
        }

        setChecking(false);
      } catch (e) {
        // if something fails, fail closed
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
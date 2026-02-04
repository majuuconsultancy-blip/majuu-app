import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { useLocation, useNavigate } from "react-router-dom";

const ADMIN_EMAIL = "brioneroo@gmail.com";

export default function AdminGate({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      const email = (user?.email || "").toLowerCase();

      if (!user) {
        navigate("/login", { replace: true, state: { from: location.pathname } });
        return;
      }

      if (email !== ADMIN_EMAIL.toLowerCase()) {
        navigate("/dashboard", { replace: true });
        return;
      }

      setChecking(false);
    });

    return () => unsub();
  }, [navigate, location.pathname]);

  if (checking) {
    return (
      <div className="p-6">
        <p className="font-semibold">Checking admin access…</p>
      </div>
    );
  }

  return children;
}
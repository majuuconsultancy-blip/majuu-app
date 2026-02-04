import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase";
import { getUserProfile } from "../services/userservice";

export default function DashboardScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login");
        return;
      }

      const data = await getUserProfile(user.uid);
      setProfile(data);
      setLoading(false);
    });

    return () => unsub();
  }, [navigate]);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/login");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-xl mx-auto bg-white rounded-xl shadow p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">MAJUU Dashboard</h1>
          <button
            onClick={handleLogout}
            className="px-3 py-2 rounded bg-black text-white"
          >
            Logout
          </button>
        </div>

        <div className="mt-6 grid gap-3">
  <div className="p-4 rounded-lg border bg-gray-50">
    🎓 Study Abroad (coming next)
  </div>
  <div className="p-4 rounded-lg border bg-gray-50">
    💼 Work Abroad (coming next)
  </div>
  <div className="p-4 rounded-lg border bg-gray-50">
    ✈️ Travel Abroad (coming next)
  </div>
  <div className="p-4 rounded-lg border bg-gray-50">
    📈 Progress (coming next)
  </div>
</div>

      </div>
    </div>
  );
}

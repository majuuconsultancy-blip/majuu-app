import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

function cleanStr(x, max = 80) {
  return String(x || "").trim().slice(0, max);
}

async function logChoiceFirestore({ country, choice, uid }) {
  // Firestore analytics: signed-in only (rules enforce this)
  await addDoc(collection(db, "analytics_helpChoices"), {
    choice, // "self" | "we"
    country: cleanStr(country, 80),
    uid,
    createdAt: serverTimestamp(),
  });
}

function logChoiceGA({ country, choice, uid }) {
  // GA4 event (anonymous or signed in)
  // Works if you installed GA (gtag). If not installed, it safely does nothing.
  try {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "help_choice", {
        choice, // self/we
        country: cleanStr(country, 80),
        uid_present: Boolean(uid),
      });
    }
  } catch {
    // ignore
  }
}

export default function HelpChoiceModal({ country, onSelfHelp, onWeHelp, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  if (!country) return null;

  const handleSelf = async () => {
    if (busy) return;
    setBusy(true);

    const user = auth.currentUser;

    // ✅ Always log to GA (best anonymous tracking)
    logChoiceGA({ country, choice: "self", uid: user?.uid || null });

    // ✅ Also log to Firestore if signed in (ties to real user for research)
    if (user?.uid) {
      try {
        await logChoiceFirestore({ country, choice: "self", uid: user.uid });
      } catch {
        // don't block UX if analytics fails
      }
    }

    setBusy(false);
    onSelfHelp?.();
  };

  const handleWe = async () => {
    if (busy) return;
    setBusy(true);

    const user = auth.currentUser;

    // ✅ Always log to GA
    logChoiceGA({ country, choice: "we", uid: user?.uid || null });

    // ✅ Also log to Firestore if signed in
    if (user?.uid) {
      try {
        await logChoiceFirestore({ country, choice: "we", uid: user.uid });
      } catch {
        // don't block UX
      }
    }

    // ✅ Gate We-Help for legit usercount
    if (!user) {
      setBusy(false);
      navigate("/login", {
        state: { from: location.pathname, intended: "wehelp", country },
        replace: false,
      });
      return;
    }

    // ✅ Optional: require verification for We-Help only
    if (!user.emailVerified) {
      setBusy(false);
      navigate("/verify-email", {
        state: { email: user.email || "", from: location.pathname, intended: "wehelp", country },
        replace: false,
      });
      return;
    }

    setBusy(false);
    onWeHelp?.();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-80">
        <h2 className="text-lg font-bold mb-2">{country}</h2>
        <p className="text-sm text-gray-600 mb-4">Pick your preferred Help choice!</p>

        <div className="flex flex-col gap-3">
          <button
            onClick={handleSelf}
            disabled={busy}
            className="p-3 rounded bg-black text-white disabled:opacity-60"
          >
            Self-Help
          </button>

          <button
            onClick={handleWe}
            disabled={busy}
            className="p-3 rounded border disabled:opacity-60"
          >
            We-Help
          </button>

          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm text-gray-500 mt-2 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>

        <p className="mt-4 text-xs text-gray-500">
          We-Help requires login (and verification) so we can serve you properly.
        </p>
      </div>
    </div>
  );
}
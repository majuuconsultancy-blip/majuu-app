// ✅ FullPackageMissingScreen.jsx (FULL COPY-PASTE — FIXED: uses missingItems from Diagnostic Modal)
// Fixes:
// ✅ Uses location.state.missingItems FIRST (from FullPackageDiagnosticModal)
// ✅ Falls back to parent request remainingItems/missingItems only if state not present
// ✅ Falls back to default list only if neither exists
// ✅ createServiceRequest now sends the correct "missingItems" list (not the fallback list)
// ✅ Keeps your auth soft-reconnect behavior (no instant redirect on transient null)

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { motion } from "../utils/motionProxy";

import { auth, db } from "../firebase";
import RequestModal from "../components/RequestModal";
import { createServiceRequest } from "../services/requestservice";
import {
  getUserState,
  setActiveProcessDetails,
  upsertUserContact,
} from "../services/userservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import { createPendingAttachment } from "../services/attachmentservice";

/* ---------------- Icons (minimal, consistent stroke) ---------------- */
function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M15 6 9 12l6 6"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconChevronRight(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6 12.5 10 16.5 18 7.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7.5 11V8.8A4.5 4.5 0 0 1 12 4.3 4.5 4.5 0 0 1 16.5 8.8V11"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 11h11a2 2 0 0 1 2 2v5.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconDoc(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 3.8h6l3 3V20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5.8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14 3.8V7a2 2 0 0 0 2 2h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 11h6M9 14h6M9 17h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconPen(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 20h4l10.5-10.5a2.3 2.3 0 0 0 0-3.2l-.8-.8a2.3 2.3 0 0 0-3.2 0L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M13.7 6.3 17.7 10.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconIdCard(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 7.5h16a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7 15.6c.8-1.4 2.1-2.1 3.6-2.1s2.8.7 3.6 2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.6 12a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M15.6 10h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M15.6 13h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconChat(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 18.5 3.8 20V6.8A2.3 2.3 0 0 1 6.1 4.5H18a2.5 2.5 0 0 1 2.5 2.5V14A2.5 2.5 0 0 1 18 16.5H7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 9.5h8M7.5 12.5h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconPlane(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3 13.5l18-7.5-7.5 18-2.2-7.1L3 13.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M11.3 16.9 21 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconBriefcase(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 7V5.8A1.8 1.8 0 0 1 9.8 4h4.4A1.8 1.8 0 0 1 16 5.8V7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4 7h16a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M2 12h20"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconBook(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.5 4.8h11a2 2 0 0 1 2 2V19a2 2 0 0 0-2-2h-11a2 2 0 0 0-2 2V6.8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 8h8M7.5 11h8M7.5 14h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconShieldCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5 19 6.7v6.5c0 4.3-3 8.2-7 9.3-4-1.1-7-5-7-9.3V6.7L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="m9.3 12.4 1.8 1.8 3.8-4.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconMoney(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 7h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 14.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M6 10h0M18 14h0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- Helpers ---------------- */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/* ---------------- Icon mapping for items ---------------- */
function getItemMeta(item, safeTrack) {
  const s = String(item || "").toLowerCase();

  if (s.includes("document checklist") || s.includes("checklist"))
    return { icon: IconDoc, sub: "We’ll confirm what’s needed and what’s missing." };

  if (s.includes("sop") || s.includes("motivation"))
    return { icon: IconPen, sub: "Draft, improve, and make it convincing." };

  if (s.includes("cv") || s.includes("resume"))
    return { icon: IconIdCard, sub: "Format + improve for your target country." };

  if (s.includes("interview"))
    return { icon: IconChat, sub: "Questions, answers, and confidence practice." };

  if (s.includes("pre-departure") || s.includes("pre departure") || s.includes("flight"))
    return { icon: IconPlane, sub: "Packing, bookings, arrival plan, and tips." };

  if (s.includes("passport"))
    return { icon: IconBook, sub: "Checklist + guidance for a clean application." };

  if (s.includes("visa"))
    return { icon: IconShieldCheck, sub: "Forms, requirements, and submission steps." };

  if (s.includes("ielts"))
    return { icon: IconBook, sub: "Prep plan + resources + practice schedule." };

  if (s.includes("proof of funds") || s.includes("fund"))
    return { icon: IconMoney, sub: "What to show and how to present it." };

  if (s.includes("offer letter"))
    return { icon: IconDoc, sub: "Review details and confirm requirements." };

  if (safeTrack === "work") return { icon: IconBriefcase, sub: "Continue this step with our team." };
  if (safeTrack === "study") return { icon: IconBook, sub: "Continue this step with our team." };
  return { icon: IconPlane, sub: "Continue this step with our team." };
}

export default function FullPackageMissingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { track } = useParams();
  const reduceMotion = true;

  const safeTrack = useMemo(() => {
    const t = String(track || "").toLowerCase().trim();
    return ["study", "work", "travel"].includes(t) ? t : "travel";
  }, [track]);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const country = params.get("country") || "Not selected";
  const parentRequestId = params.get("parentRequestId") || params.get("parent") || "";

  const shouldAutoOpen = params.get("autoOpen") === "1";
  const autoItem = String(params.get("item") || "").trim();

  const titleText = useMemo(() => {
    if (safeTrack === "study") return "Study Abroad";
    if (safeTrack === "work") return "Work Abroad";
    return "Travel Abroad";
  }, [safeTrack]);

  const headerIcon = safeTrack === "study" ? IconBook : safeTrack === "work" ? IconBriefcase : IconPlane;
  const HeaderIcon = headerIcon;

  // ✅ Auth state for this screen only (no hard redirects during transient null)
  const [authChecked, setAuthChecked] = useState(false);

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [userState, setUserState] = useState(null);
  const [missing, setMissing] = useState([]);

  const [parentReq, setParentReq] = useState(null);
  const [parentErr, setParentErr] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [pickedNeed, setPickedNeed] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);

  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");

  const goBack = () => navigate(-1);
  const goToProfile = () => navigate("/app/profile");

  // ✅ 1) missing items from Diagnostic Modal navigation state
  const navMissingItems = useMemo(() => {
    const raw = location?.state?.missingItems;

    if (!raw) return null;
    if (!Array.isArray(raw)) return null;

    const cleaned = raw
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    // if it's empty array, treat as no data
    if (!cleaned.length) return null;

    // de-dupe while preserving order
    const seen = new Set();
    const uniq = [];
    for (const it of cleaned) {
      if (!seen.has(it)) {
        seen.add(it);
        uniq.push(it);
      }
    }
    return uniq.length ? uniq : null;
  }, [location?.state]);

  // ✅ IMPORTANT: Avoid navigating to /login instantly if auth is temporarily null
  useEffect(() => {
    let alive = true;
    const start = Date.now();

    const tick = async () => {
      const user = auth.currentUser;

      if (!alive) return;

      if (!user && Date.now() - start < 1200) {
        setTimeout(tick, 150);
        return;
      }

      setAuthChecked(true);

      if (!user) {
        setUid(null);
        setEmail("");
        setUserState(null);
        setMissing([]);
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");

      try {
        // ✅ pass email so getUserState can auto-heal doc if missing
        const s = await getUserState(user.uid, user.email || "");
        if (!alive) return;

        setUserState(s || null);
        setDefaultName(s?.name || "");
        setDefaultPhone(s?.phone || "");
        setMissing(getMissingProfileFields(s || {}));
      } catch (e) {
        console.error("FullPackageMissing getUserState error:", e);
      }
    };

    tick();
    return () => {
      alive = false;
    };
  }, []);

  // Parent request snapshot (only if parentRequestId exists)
  useEffect(() => {
    if (!parentRequestId) return;

    const ref = doc(db, "serviceRequests", parentRequestId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setParentReq(null);
          setParentErr("Parent request not found.");
          return;
        }
        setParentReq({ id: snap.id, ...snap.data() });
        setParentErr("");
      },
      (e) => {
        console.error("parent request snapshot error:", e);
        setParentErr(e?.message || "Failed to load parent request.");
      }
    );

    return () => unsub();
  }, [parentRequestId]);

  // ✅ 2) missing items from parent request (fallback)
  const parentMissingItems = useMemo(() => {
    const arr =
      parentReq?.remainingItems ||
      parentReq?.missingItems ||
      parentReq?.remaining ||
      parentReq?.items ||
      [];

    if (Array.isArray(arr) && arr.length) {
      const cleaned = arr.map((x) => String(x || "").trim()).filter(Boolean);
      return cleaned.length ? cleaned : null;
    }
    return null;
  }, [parentReq]);

  // ✅ 3) final source-of-truth list for tiles + request payload
  const finalMissingItems = useMemo(() => {
    // priority: navigation state > parent request > default list
    if (navMissingItems?.length) return navMissingItems;
    if (parentMissingItems?.length) return parentMissingItems;

    return [
      "Document checklist",
      "SOP / Motivation Letter",
      "CV / Resume",
      "Interview preparation",
      "Pre-departure guidance",
    ];
  }, [navMissingItems, parentMissingItems]);

  // ✅ Completed list (if parent request has progress)
  const completedList = useMemo(() => {
    const done = parentReq?.completedItems || parentReq?.doneItems || [];
    return Array.isArray(done) ? done.map((x) => String(x)) : [];
  }, [parentReq]);

  const isCompleted = (need) => completedList.includes(String(need));

  const canContinueHere = missing.length === 0;

  useEffect(() => {
    if (autoOpened) return;
    if (!shouldAutoOpen) return;
    if (!canContinueHere) return;

    const picked = autoItem || String(finalMissingItems?.[0] || "").trim() || "Document checklist";

    setPickedNeed(picked);
    setModalOpen(true);
    setAutoOpened(true);
  }, [autoOpened, shouldAutoOpen, canContinueHere, autoItem, finalMissingItems]);

  const openNeed = (need) => {
    if (!canContinueHere) return;
    if (isCompleted(need)) return;
    setPickedNeed(need);
    setModalOpen(true);
  };

  const enableAttachments = true;

  const submitFullPackage = async ({
    name,
    phone,
    note,
    dummyFiles,
    requestUploadMeta,
    email: formEmail,
    city,
    paid,
    paymentMeta,
  }) => {
    if (!uid) return;

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      setModalOpen(false);
      goToProfile();
      return;
    }

    try {
      const cleanName = String(name || "").trim();
      const cleanPhone = String(phone || "").trim();
      if (cleanName && cleanPhone) {
        await upsertUserContact(uid, { name: cleanName, phone: cleanPhone });
        setDefaultName(cleanName);
        setDefaultPhone(cleanPhone);
        setUserState((prev) => ({
          ...(prev || {}),
          name: cleanName,
          phone: cleanPhone,
        }));
      }
    } catch (e) {
      console.warn("upsertUserContact failed (continuing anyway):", e);
    }

    const autoContext = [
      "Full package continuation",
      `ParentRequestId: ${parentRequestId || "-"}`,
      `Track: ${safeTrack}`,
      `Country: ${country}`,
      pickedNeed ? `Selected item: ${pickedNeed}` : null,
      finalMissingItems?.length ? `Missing items: ${finalMissingItems.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const finalNote = String(note || "").trim()
      ? `${String(note).trim()}\n\n---\n${autoContext}`
      : autoContext;

    try {
      const requestId = await createServiceRequest({
        uid,
        email: String(formEmail || email || "").trim(),
        track: safeTrack,
        country,
        requestType: "full",
        serviceName: "Full Package",

        // ✅ CRITICAL: send the correct missing items list
        missingItems: Array.isArray(finalMissingItems) ? finalMissingItems : [],

        name,
        phone,
        note: finalNote,

        city: String(city || "").trim(),
        paid: Boolean(paid),
        paymentMeta: paymentMeta || null,

        requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
        parentRequestId: parentRequestId || "",
        fullPackageItem: pickedNeed || "",
      });

      const picked = Array.isArray(dummyFiles) ? dummyFiles : [];
      if (picked.length > 0) {
        for (const file of picked) {
          await createPendingAttachment({ requestId, file });
        }
      }

      await setActiveProcessDetails(uid, {
        hasActiveProcess: true,
        activeTrack: safeTrack,
        activeCountry: country,
        activeHelpType: "we",
        activeRequestId: requestId,
      });

      setModalOpen(false);
      navigate(`/app/request/${requestId}`, { replace: true });
    } catch (err) {
      if (err?.code === "auth/email-not-verified") {
        navigate("/verify-email", { replace: false });
      }
      throw err;
    }
  };

  const totalCount = finalMissingItems.length;
  const doneCount = useMemo(
    () => finalMissingItems.filter((x) => isCompleted(x)).length,
    [finalMissingItems, completedList]
  );
  const remainingCount = Math.max(0, totalCount - doneCount);
  const progressPct = totalCount ? clamp(Math.round((doneCount / totalCount) * 100), 0, 100) : 0;

  const canTapTiles = canContinueHere;

  const chipTrack =
    safeTrack === "study"
      ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
      : safeTrack === "work"
        ? "border-sky-200 bg-sky-50/60 text-sky-900"
        : "border-emerald-200 bg-emerald-50/60 text-emerald-900";

  const cardBase = "rounded-3xl border border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur";

  const btnPrimary =
    "inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]";

  // ✅ Simple auth UI (no forced redirect)
  if (!authChecked) {
    return (
      <div className="min-h-screen px-5 py-10">
        <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-base font-extrabold">Reconnecting…</div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Restoring your session.
          </div>
        </div>
      </div>
    );
  }

  if (authChecked && !uid) {
    return (
      <div className="min-h-screen px-5 py-10">
        <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-base font-extrabold">You’re signed out</div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Please sign in again to continue.
          </div>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white active:scale-[0.99]"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="px-5 py-6">
        <button
          onClick={goBack}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          <IconBack className="h-5 w-5" />
          Back
        </button>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div
              className={[
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold",
                chipTrack,
              ].join(" ")}
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70">
                <HeaderIcon className="h-4 w-4 opacity-90" />
              </span>
              Full package • {titleText}
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Continue your full package
            </h1>
            <p className="mt-1 text-sm text-zinc-600">Tap any tile to continue that step.</p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {parentErr ? (
          <div className="mt-4 rounded-3xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {parentErr}
          </div>
        ) : null}

        {!canContinueHere ? (
          <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-zinc-900">
                  Complete your profile to continue
                </div>
                <div className="mt-1 text-sm text-zinc-700">
                  Missing: <span className="font-semibold">{missing.join(", ")}</span>
                </div>
              </div>

              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-amber-200 bg-white/70 text-amber-800">
                <IconLock className="h-5 w-5" />
              </span>
            </div>

            <button onClick={goToProfile} className={`${btnPrimary} mt-4 w-full`}>
              Go to Profile
            </button>
          </div>
        ) : null}

        <div className="mt-6 grid gap-3">
          <div className={`${cardBase} p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-zinc-900">Remaining steps</div>
                <div className="mt-1 text-sm text-zinc-600">
                  Country: <span className="font-semibold text-zinc-900">{country}</span>
                </div>

                {navMissingItems?.length ? (
                  <div className="mt-1 text-[11px] text-emerald-700">
                    Using diagnostic results (items you didn’t tick).
                  </div>
                ) : parentRequestId ? (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Continuation from request{" "}
                    <span className="font-semibold">{parentRequestId}</span>
                  </div>
                ) : null}
              </div>

              <div className="text-right">
                <div className="inline-flex items-center gap-2">
                  <span className="rounded-full border border-zinc-200 bg-white/70 px-2 py-1 text-[11px] font-extrabold text-zinc-700">
                    Done {doneCount}/{totalCount}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50/60 px-2 py-1 text-[11px] font-extrabold text-emerald-900">
                    {remainingCount} left
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-200/70">
              <motion.div
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.28, ease: "easeOut" }}
                className="h-full rounded-full bg-emerald-600"
              />
            </div>

            <div className="mt-2 text-[11px] text-zinc-500">
              Tip: Attach PDFs when submitting — it speeds up the review.
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {finalMissingItems.map((need) => {
            const done = isCompleted(need);
            const disabled = !canTapTiles || done;

            const meta = getItemMeta(need, safeTrack);
            const TileIcon = meta.icon;

            return (
              <button
                key={need}
                type="button"
                onClick={() => openNeed(need)}
                disabled={disabled}
                className={[
                  "w-full text-left rounded-3xl border px-4 py-4 transition",
                  "shadow-[0_14px_46px_rgba(0,0,0,0.07)] backdrop-blur",
                  "active:scale-[0.99]",
                  done
                    ? "border-zinc-200 bg-zinc-50/60 text-zinc-500"
                    : "border-zinc-200/70 bg-white/70 hover:bg-white/85 hover:border-emerald-200/70",
                  disabled && !done ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    <span
                      className={[
                        "inline-flex h-11 w-11 items-center justify-center rounded-2xl border",
                        done
                          ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
                          : "border-emerald-100 bg-emerald-50/50 text-emerald-800",
                      ].join(" ")}
                    >
                      {done ? <IconCheck className="h-5 w-5" /> : <TileIcon className="h-5 w-5" />}
                    </span>

                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-extrabold text-zinc-900">
                        {need}
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">
                        {done ? "Completed" : meta.sub}
                      </div>

                      {!done ? (
                        <div className="mt-2 inline-flex items-center gap-2">
                          <span className="rounded-full border border-zinc-200 bg-white/70 px-2 py-1 text-[11px] font-extrabold text-zinc-700">
                            PDFs allowed
                          </span>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50/60 px-2 py-1 text-[11px] font-extrabold text-emerald-900">
                            Continue
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <span
                    className={[
                      "shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-extrabold",
                      done
                        ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                        : "border-zinc-200 bg-white/70 text-zinc-700",
                    ].join(" ")}
                  >
                    {done ? "Done" : "Open"}
                    {!done ? <IconChevronRight className="h-4 w-4" /> : null}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <RequestModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSubmit={submitFullPackage}
          title={pickedNeed ? `Continue: ${pickedNeed}` : "Continue Full Package"}
          subtitle={`${titleText} • ${country}`}
          defaultName={defaultName}
          defaultPhone={defaultPhone}
          defaultEmail={auth.currentUser?.email || email || ""}
          enableAttachments={enableAttachments}
          maxPdfMb={10}
        />
      </div>
    </div>
  );
}
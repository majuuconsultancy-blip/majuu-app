import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase";
import RequestModal from "../components/RequestModal";
import { createServiceRequest } from "../services/requestservice";
import { getUserState, setActiveProcessDetails, upsertUserContact } from "../services/userservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import { createPendingAttachment } from "../services/attachmentservice";

/* - Minimal icons -  */
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
function IconSpark(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 2l1.2 4.2L17.4 8 13.2 9.2 12 13.4 10.8 9.2 6.6 8l4.2-1.8L12 2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M5 13l.8 2.8L8.6 17l-2.8 1.2L5 21l-1.2-2.8L1 17l2.8-1.2L5 13Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 13.5l.7 2.2 2.3.8-2.3.8-.7 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FullPackageMissingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { track } = useParams();

  const safeTrack = useMemo(() => {
    const t = String(track || "").toLowerCase().trim();
    return ["study", "work", "travel"].includes(t) ? t : "travel";
  }, [track]);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const country = params.get("country") || "Not selected";
  const parentRequestId = params.get("parentRequestId") || params.get("parent") || "";

  // ✅ Retry support: auto-open RequestModal from "Try again"
  const shouldAutoOpen = params.get("autoOpen") === "1";
  const autoItem = String(params.get("item") || "").trim();

  const titleText = useMemo(() => {
    if (safeTrack === "study") return "Study Abroad";
    if (safeTrack === "work") return "Work Abroad";
    return "Travel Abroad";
  }, [safeTrack]);

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [userState, setUserState] = useState(null);
  const [missing, setMissing] = useState([]);

  // parent request data (optional)
  const [parentReq, setParentReq] = useState(null);
  const [parentErr, setParentErr] = useState("");

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [pickedNeed, setPickedNeed] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);

  // autofill
  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");

  const goBack = () => navigate(-1);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");

      try {
        const s = await getUserState(user.uid);
        setUserState(s || null);

        setDefaultName(s?.name || "");
        setDefaultPhone(s?.phone || "");

        setMissing(getMissingProfileFields(s || {}));
      } catch (e) {
        console.error("FullPackageMissing getUserState error:", e);
      }
    });

    return () => unsub();
  }, [navigate]);

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

  const missingItems = useMemo(() => {
    // If parent request has remaining list, use it. Otherwise fall back.
    const arr =
      parentReq?.remainingItems || parentReq?.missingItems || parentReq?.remaining || [];
    if (Array.isArray(arr) && arr.length) return arr.map((x) => String(x));

    return [
      "Document checklist",
      "SOP / Motivation Letter",
      "CV / Resume",
      "Interview preparation",
      "Pre-departure guidance",
    ];
  }, [parentReq]);

  const canContinueHere = missing.length === 0;

  // ✅ Auto-open modal when routed from "Try again"
  useEffect(() => {
    if (autoOpened) return;
    if (!shouldAutoOpen) return;
    if (!canContinueHere) return;

    const picked =
      autoItem || String(missingItems?.[0] || "").trim() || "Document checklist";

    setPickedNeed(picked);
    setModalOpen(true);
    setAutoOpened(true);
  }, [autoOpened, shouldAutoOpen, canContinueHere, autoItem, missingItems]);

  const isCompleted = (need) => {
    const done = parentReq?.completedItems || parentReq?.doneItems || [];
    if (!Array.isArray(done)) return false;
    return done.map((x) => String(x)).includes(String(need));
  };

  const openNeed = (need) => {
    if (!canContinueHere) return;
    if (isCompleted(need)) return;
    setPickedNeed(need);
    setModalOpen(true);
  };

  const goToProfile = () => navigate("/app/profile");

  // Allow users to attach PDFs for any selected full-package item
  const enableAttachments = Boolean(pickedNeed);

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
      missingItems?.length ? `Missing items: ${missingItems.join(", ")}` : null,
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
        missingItems: Array.isArray(missingItems) ? missingItems : [],
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

      // ✅ only create attachment docs when files exist
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
      // ✅ soft-gate: unverified → verify screen
      if (err?.code === "auth/email-not-verified") {
        navigate("/verify-email", { replace: false });
      }
      // rethrow so RequestModal shows error message
      throw err;
    }
  };

  const cardBase =
    "rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur";
  const btnPrimary =
    "inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]";

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
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70">
                <IconSpark className="h-4 w-4 text-emerald-700" />
              </span>
              Full package • {titleText}
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Here’s what is Remaining:
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Select any item below to continue...
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {parentErr ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {parentErr}
          </div>
        ) : null}

        {!canContinueHere ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="text-sm font-semibold text-zinc-900">
              Complete your profile to continue
            </div>
            <div className="mt-1 text-sm text-zinc-700">
              Missing: <span className="font-medium">{missing.join(", ")}</span>
            </div>

            <button onClick={goToProfile} className={`${btnPrimary} mt-4 w-full`}>
              Go to Profile
            </button>
          </div>
        ) : null}

        <div className="mt-6 grid gap-3">
          <div className={`${cardBase} p-4`}>
            <div className="text-sm font-semibold text-zinc-900">Remaining items</div>
            <div className="mt-1 text-sm text-zinc-600">
              Country: <span className="font-medium text-zinc-900">{country}</span>
            </div>

            <div className="mt-4 grid gap-2">
              {missingItems.map((need) => {
                const done = isCompleted(need);
                return (
                  <button
                    key={need}
                    onClick={() => openNeed(need)}
                    disabled={!canContinueHere || done}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      done
                        ? "border-zinc-200 bg-zinc-50/60 text-zinc-500"
                        : "border-zinc-200 bg-white/60 hover:border-emerald-200 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{need}</div>
                      <div className="text-xs">{done ? "Completed" : "Continue"}</div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      You can attach PDFs when submitting.
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <RequestModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSubmit={submitFullPackage}
          title="Continue Full Package"
          subtitle={`${titleText} • ${country}`}
          defaultName={defaultName}
          defaultPhone={defaultPhone}
          enableAttachments={enableAttachments}
          maxPdfMb={10}
        />
      </div>
    </div>
  );
}
// ✅ StudyWeHelp.jsx (copy-paste version)
// NOTE: This version supports Retry deep-link:
// /app/study/we-help?country=Australia&autoOpen=1&open=Passport%20Application
// It will auto-open RequestModal on that service.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../firebase";
import RequestModal from "../components/RequestModal";
import FullPackageDiagnosticModal from "../components/FullPackageDiagnosticModal";

import { createServiceRequest } from "../services/requestservice";
import {
  getUserState,
  setActiveProcessDetails,
  upsertUserContact,
} from "../services/userservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import { createPendingAttachment } from "../services/attachmentservice";

/* -------- Minimal icons (no emojis) -------- */
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

function IconArrowRight(props) {
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

/* ---------------- Data ---------------- */
const SINGLE_SERVICES = [
  { title: "Passport Application", note: "Guidance + document checklist" },
  { title: "Visa Application", note: "Forms + appointment + submission support" },
  { title: "IELTS Training", note: "Prep plan + resources + practice schedule" },
  { title: "SOP / Motivation Letter", note: "Writing + polishing" },
  { title: "CV / Resume", note: "Professional formatting + improvements" },
  { title: "Document Review", note: "Verify missing items before submission" },
];

const FULL_PACKAGE = [
  "Consultation & country selection",
  "Document checklist + preparation guidance",
  "Applications guidance",
  "SOP/CV support",
  "Interview preparation",
  "Pre-departure guidance",
];

export default function StudyWeHelp() {
  const navigate = useNavigate();
  const location = useLocation();

  const qs = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const country = qs.get("country") || "Not selected";

  // ✅ Retry support: auto-open RequestModal from RequestStatusScreen
  const shouldAutoOpen = qs.get("autoOpen") === "1";
  const openService = String(qs.get("open") || "").trim();

  const [uid, setUid] = useState(null);
  const [email, setEmail] = useState("");

  const [userState, setUserState] = useState(null);
  const [missing, setMissing] = useState([]);
  const [pageErr, setPageErr] = useState("");

  // Autofill for modal
  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");

  // Request modal (single services only)
  const [modalOpen, setModalOpen] = useState(false);
  const [requestMeta, setRequestMeta] = useState(null); // { requestType, serviceName }
  const [autoOpened, setAutoOpened] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);

  // Full Package diagnostic state
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  const goBackToChoice = () => {
    navigate(`/app/study?country=${encodeURIComponent(country)}&from=choice`);
  };

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
        console.error("StudyWeHelp getUserState error:", e);
        setPageErr(e?.message || "Failed to load your profile. Try again.");
      } finally {
        setProfileChecked(true);
      }
    });

    return () => unsub();
  }, [navigate]);

  // ✅ Auto-open the modal when coming from "Try again"
  useEffect(() => {
    if (autoOpened) return;
    if (!shouldAutoOpen) return;
    if (!openService) return;
    if (!profileChecked) return;

    // don’t open if profile is incomplete
    if (missing.length > 0) return;

    setRequestMeta({ requestType: "single", serviceName: openService });
    setModalOpen(true);
    setAutoOpened(true);
  }, [autoOpened, shouldAutoOpen, openService, profileChecked, missing.length]);

  const modalTitle = useMemo(() => {
    if (!requestMeta) return "Request";
    return `Request: ${requestMeta.serviceName}`;
  }, [requestMeta]);

  const modalSubtitle = useMemo(() => `Study Abroad • ${country}`, [country]);

  const openSingle = (serviceName) => {
    setRequestMeta({ requestType: "single", serviceName });
    setModalOpen(true);
  };

  // Full package opens diagnostic only
  const openFull = () => setDiagnosticOpen(true);

  const goToProfile = () => navigate("/app/profile");

  // attachments only on Document Review
  const enableAttachments =
    requestMeta?.requestType === "single" &&
    requestMeta?.serviceName === "Document Review";

  const submitRequest = async ({
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
    if (!uid || !requestMeta) return;

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

    const requestId = await createServiceRequest({
      uid,
      email: String(formEmail || email || "").trim(),
      track: "study",
      country,
      requestType: requestMeta.requestType, // "single"
      serviceName: requestMeta.serviceName,
      name,
      phone,
      note,

      city: String(city || "").trim(),
      paid: Boolean(paid),
      paymentMeta: paymentMeta || null,
      requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
    });

    // ✅ create attachment records whenever files exist
    const picked = Array.isArray(dummyFiles) ? dummyFiles : [];
    if (picked.length > 0) {
      for (const file of picked) {
        await createPendingAttachment({ requestId, file });
      }
    }

    await setActiveProcessDetails(uid, {
      hasActiveProcess: true,
      activeTrack: "study",
      activeCountry: country,
      activeHelpType: "we",
      activeRequestId: requestId,
    });

    setModalOpen(false);
    navigate(`/app/request/${requestId}`, { replace: true });
  };

  return (
    <div className="min-h-screen">
      <div className="px-5 py-6">
        {/* Back */}
        <button
          onClick={goBackToChoice}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          ← Back
        </button>

        {/* Header */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/60 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-100 bg-white/70">
                <IconBook className="h-4 w-4 text-emerald-700" />
              </span>
              Study · We-Help
            </div>

            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
              Get help with your study process
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Country: <span className="font-medium text-zinc-900">{country}</span>
            </p>
          </div>

          <div className="h-10 w-10 rounded-2xl border border-emerald-100 bg-emerald-50/70" />
        </div>

        {pageErr ? (
          <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {pageErr}
          </div>
        ) : null}

        {/* Profile banner */}
        {missing.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-zinc-900">
                  Complete your profile to continue
                </div>
                <div className="mt-1 text-sm text-zinc-700">
                  Missing: <span className="font-medium">{missing.join(", ")}</span>
                </div>
              </div>

              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200 bg-white/70 text-amber-800">
                <IconShieldCheck className="h-5 w-5" />
              </span>
            </div>

            <button
              onClick={goToProfile}
              className="mt-4 w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
            >
              Go to Profile
            </button>
          </div>
        ) : null}

        {/* Sections */}
        <div className="mt-7 grid gap-4">
          {/* Single services */}
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  Single packages
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Choose one service you want help with.
                </p>
              </div>
              <span className="text-xs text-zinc-500">
                {SINGLE_SERVICES.length} options
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              {SINGLE_SERVICES.map((s) => (
                <button
                  key={s.title}
                  onClick={() => openSingle(s.title)}
                  className="w-full text-left rounded-2xl border border-zinc-200 bg-white/60 p-4 shadow-sm transition hover:border-emerald-200 hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-zinc-900">{s.title}</div>
                      <div className="mt-1 text-sm text-zinc-600">{s.note}</div>
                      {s.title === "Document Review" ? (
                        <div className="mt-2 text-xs text-emerald-700">
                          Attach PDFs when submitting
                        </div>
                      ) : null}
                    </div>

                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50/60 text-emerald-700">
                      <IconArrowRight className="h-5 w-5" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Full package */}
          <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  Full package
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  End-to-end support at a discounted price.
                </p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                Best value
              </span>
            </div>

            <ul className="mt-4 grid gap-2 text-sm text-zinc-700">
              {FULL_PACKAGE.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                  {item}
                </li>
              ))}
            </ul>

            <button
              onClick={openFull}
              className="mt-4 w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
            >
              Request full package
            </button>
          </div>
        </div>

        {/* Full Package diagnostic modal */}
        <FullPackageDiagnosticModal
          open={diagnosticOpen}
          onClose={() => setDiagnosticOpen(false)}
          track="study"
          country={country}
        />

        {/* Single-service Request Modal */}
        <RequestModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSubmit={submitRequest}
          title={modalTitle}
          subtitle={modalSubtitle}
          defaultName={defaultName}
          defaultPhone={defaultPhone}
          enableAttachments={enableAttachments}
          maxPdfMb={10}
        />
      </div>
    </div>
  );
}
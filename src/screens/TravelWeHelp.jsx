// ✅ TravelWeHelp.jsx (FULL COPY-PASTE)
// CHANGE: Replace + add icons (lucide-react). No custom SVG icon components.
// ✅ ADD: Android hardware back ALWAYS goes to TrackScreen (/app/travel)
// - Uses history.pushState + popstate trap (PWA-safe)
// - On-screen Back also goes to /app/travel
// Backend/logic untouched.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
// eslint-disable-next-line no-unused-vars
import { AnimatePresence, motion } from "../utils/motionProxy";
import { smartBack } from "../utils/navBack";

import {
  Plane,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  Search,
  X,
  Sparkles,
  Package,
  BadgeCheck,
  MapPinned,
  FileCheck2,
  PenTool,
  GraduationCap,
  IdCard,
  FileText,
  ChevronDown,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import JourneyBanner from "../components/JourneyBanner";
import { ICON_SM, ICON_MD, ICON_LG } from "../constants/iconSizes";

import { auth } from "../firebase";
import RequestModal from "../components/RequestModal";
import FullPackageDiagnosticModal from "../components/FullPackageDiagnosticModal";

import { createServiceRequest } from "../services/requestservice";
import {
  activatePreparedUnlockRequest,
  createUnlockCheckoutSession,
} from "../services/paymentservice";
import {
  getUserState,
  setActiveProcessDetails,
  upsertUserContact,
} from "../services/userservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import {
  createPendingAttachment,
  createPendingAttachmentFromMeta,
} from "../services/attachmentservice";
import {
  buildRequestPricingKey,
  findRequestCatalogEntry,
} from "../constants/requestCatalog";
import {
  getRequestPricingQuote,
  toRequestPricingSnapshot,
} from "../services/pricingservice";
import { subscribeActiveRequestDefinitions } from "../services/requestDefinitionService";
import { setSnapshot } from "../resume/resumeEngine";
import { normalizeJourney } from "../journey/journeyModel";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { logAnalyticsEvent } from "../services/analyticsService";
import { archiveWorkflowDraft } from "../services/workflowdraftservice";

const FULL_PACKAGE = [
  "Consultation & country selection",
  "Document checklist + preparation guidance",
  "Applications guidance",
  "SOP/CV support",
  "Interview preparation",
  "Pre-departure guidance",
];

/* ---------------- Motion ---------------- */
const pageIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
};

const floatCard = {
  rest: { y: 0, scale: 1 },
  hover: { y: -1, scale: 1.003, transition: { duration: 0.12 } },
  tap: { scale: 0.996 },
};

function buildSingleRequestMeta(serviceName, country = "") {
  const fallbackName = String(serviceName || "").trim();
  const entry = findRequestCatalogEntry({
    track: "travel",
    requestType: "single",
    country,
    serviceName: fallbackName,
  });

  return {
    requestType: "single",
    serviceName: entry?.serviceName || fallbackName,
    pricingKey:
      entry?.pricingKey ||
      buildRequestPricingKey({
        track: "travel",
        requestType: "single",
        country,
        serviceName: entry?.serviceName || fallbackName,
      }) ||
      "",
    isCustom: !entry,
  };
}

function ServiceIcon({ tag, title }) {
  if (title === "Passport Application") return <AppIcon size={ICON_SM} icon={IdCard} />;
  if (title === "Visa Application") return <AppIcon size={ICON_SM} icon={MapPinned} />;
  if (title === "IELTS Training") return <AppIcon size={ICON_SM} icon={GraduationCap} />;
  if (title === "SOP / Motivation Letter") return <AppIcon size={ICON_SM} icon={PenTool} />;
  if (title === "CV / Resume") return <AppIcon size={ICON_SM} icon={FileText} />;
  if (title === "Document Review") return <AppIcon size={ICON_SM} icon={FileCheck2} />;
  if (tag === "Visa") return <AppIcon size={ICON_SM} icon={MapPinned} />;
  if (tag === "Docs") return <AppIcon size={ICON_SM} icon={Package} />;
  if (tag === "Writing") return <AppIcon size={ICON_SM} icon={Sparkles} />;
  if (tag === "Test") return <AppIcon size={ICON_SM} icon={BadgeCheck} />;
  if (tag === "CV") return <AppIcon size={ICON_SM} icon={BadgeCheck} />;
  return <AppIcon size={ICON_SM} icon={Package} />;
}

function ServiceTile({ s, disabled, onClick }) {
  const serviceName = s.serviceName || s.title;
  const isDocReview = serviceName === "Document Review";
  const showTag = Boolean(String(s?.tag || "").trim());
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variants={floatCard}
      initial="rest"
      whileHover={disabled ? "rest" : "hover"}
      whileTap={disabled ? "rest" : "tap"}
      className={[
        "w-full text-left rounded-3xl border p-4 shadow-[0_14px_40px_rgba(0,0,0,0.08)] backdrop-blur-xl transition",
        disabled
          ? "border-zinc-200/70 dark:border-zinc-800 bg-white/55 dark:bg-zinc-900/60 opacity-60 cursor-not-allowed"
          : "border-zinc-200/70 dark:border-zinc-800 bg-white/72 dark:bg-zinc-900/60 hover:border-emerald-200 hover:bg-white/85",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showTag || isDocReview ? (
            <div className="flex items-center gap-2">
              {showTag ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                  <ServiceIcon tag={s.tag} title={serviceName} />
                  {s.tag}
                </span>
              ) : null}

              {isDocReview ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                  <AppIcon size={ICON_SM} icon={FileCheck2} />
                  Attach PDFs
                </span>
              ) : null}
            </div>
          ) : null}

          <div className={`${showTag || isDocReview ? "mt-2 " : ""}font-semibold text-zinc-900 dark:text-zinc-100`}>
            {serviceName}
          </div>
          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{s.note}</div>
        </div>

        <span className="inline-flex h-11 w-11 items-center justify-center rounded-3xl border border-emerald-100 bg-emerald-50/70 text-emerald-800 shadow-sm">
          <AppIcon size={ICON_MD} icon={ArrowRight} />
        </span>
      </div>
    </motion.button>
  );
}

export default function TravelWeHelp() {
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
  const journey = useMemo(() => normalizeJourney(userState?.journey), [userState]);

  // Autofill for modal
  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");
  const [defaultCounty, setDefaultCounty] = useState("");
  const [defaultTown, setDefaultTown] = useState("");

  // Request modal (single services only)
  const [modalOpen, setModalOpen] = useState(false);
  const [requestMeta, setRequestMeta] = useState(null);
  const [modalResumeState, setModalResumeState] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const resumeRestoreAppliedRef = useRef(false);
  const weHelpOpenKeyRef = useRef("");

  // Full Package diagnostic state
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  // UI extras
  const [q, setQ] = useState("");
  const [fullPackageDetailsOpen, setFullPackageDetailsOpen] = useState(false);
  const [toast, setToast] = useState("");

  const [activeDefinitions, setActiveDefinitions] = useState([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [definitionsErr, setDefinitionsErr] = useState("");

  const canUseWeHelp = missing.length === 0 && profileChecked;

  useEffect(() => {
    if (!uid) return;
    const analyticsCountry = String(
      new URLSearchParams(location.search).get("country") || ""
    ).trim();
    const key = `travel:${analyticsCountry}`;
    if (weHelpOpenKeyRef.current === key) return;
    weHelpOpenKeyRef.current = key;

    void logAnalyticsEvent({
      uid,
      eventType: ANALYTICS_EVENT_TYPES.WEHELP_OPENED,
      trackType: "travel",
      country: analyticsCountry,
      sourceScreen: "TravelWeHelp",
    });
  }, [location.search, uid]);

  // ✅ TrackScreen destination
  const backUrl = `/app/travel?country=${encodeURIComponent(country)}&from=choice`;

  const goBackToChoice = () => {
    smartBack(navigate, "/app/home");
  };

  // ✅ HARD FIX: Android hardware back ALWAYS goes to TrackScreen (/app/travel)
  useEffect(() => {
    try {
      window.history.pushState(
        { __majuu_travel_wehelp_back_trap: true },
        "",
        window.location.href
      );
    } catch {
      // Ignore warm-up navigation-state parsing failures.
    }

    const onPopState = () => {
      navigate(backUrl, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, backUrl]);

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
        setDefaultCounty(s?.county || "");
        setDefaultTown(s?.town || s?.city || "");

        setMissing(getMissingProfileFields(s || {}));
      } catch (e) {
        console.error("TravelWeHelp getUserState error:", e);
        setPageErr(e?.message || "Failed to load your profile. Try again.");
      } finally {
        setProfileChecked(true);
      }
    });

    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (!uid) return undefined;
    if (!country || country === "Not selected") {
      setActiveDefinitions([]);
      setDefinitionsErr("");
      setDefinitionsLoading(false);
      return undefined;
    }

    setDefinitionsLoading(true);
    setDefinitionsErr("");

    return subscribeActiveRequestDefinitions({
      trackType: "travel",
      country,
      onData: (rows) => {
        setActiveDefinitions(Array.isArray(rows) ? rows : []);
        setDefinitionsLoading(false);
      },
      onError: (error) => {
        console.error("active request definitions subscription failed:", error);
        setActiveDefinitions([]);
        setDefinitionsErr(error?.message || "Failed to load request definitions.");
        setDefinitionsLoading(false);
      },
    });
  }, [uid, country]);

  useEffect(() => {
    if (resumeRestoreAppliedRef.current) return;
    if (!profileChecked) return;

    const resumeState = location.state?.resumeWeHelp;
    if (!resumeState || String(resumeState.track || "").toLowerCase() !== "travel") return;

    resumeRestoreAppliedRef.current = true;

    if (resumeState?.fullPackage?.detailsOpen) setFullPackageDetailsOpen(true);
    if (resumeState?.fullPackage?.diagnosticOpen) setDiagnosticOpen(true);

    const modalState = resumeState?.requestModal;
    if (modalState?.open && modalState?.serviceName) {
      if (missing.length > 0) {
        setToast("Complete your profile first - then you can submit this request.");
        setTimeout(() => setToast(""), 2600);
      } else {
        setRequestMeta(buildSingleRequestMeta(modalState.serviceName, country));
        setModalResumeState(modalState);
        setModalOpen(true);
        setAutoOpened(true);
      }
    }
  }, [location.state, profileChecked, missing.length]);

  useEffect(() => {
    setSnapshot({
      route: {
        path: location.pathname,
        search: location.search || "",
      },
      weHelp: {
        track: "travel",
        country,
        requestModal: {
          open: modalOpen,
          serviceName: requestMeta?.serviceName || "",
          requestType: requestMeta?.requestType || "",
          step: modalResumeState?.step || (modalOpen ? "form" : "closed"),
          formState: modalResumeState?.formState || null,
        },
        fullPackage: {
          screen: "main",
          detailsOpen: fullPackageDetailsOpen,
          diagnosticOpen,
        },
      },
    });
  }, [
    country,
    location.pathname,
    location.search,
    modalOpen,
    requestMeta,
    modalResumeState,
    fullPackageDetailsOpen,
    diagnosticOpen,
  ]);

  // ✅ Auto-open the modal when coming from "Try again"
  useEffect(() => {
    if (autoOpened) return;
    if (!shouldAutoOpen) return;
    if (!openService) return;
    if (!profileChecked) return;

    if (missing.length > 0) {
      setToast("Complete your profile first — then you can submit this request.");
      setTimeout(() => setToast(""), 2600);
      return;
    }

    setRequestMeta(buildSingleRequestMeta(openService, country));
    setModalOpen(true);
    setAutoOpened(true);
  }, [autoOpened, shouldAutoOpen, openService, profileChecked, missing.length]);

  const modalTitle = useMemo(() => {
    if (!requestMeta) return "Request";
    return `Request: ${requestMeta.serviceName}`;
  }, [requestMeta]);

  const modalSubtitle = useMemo(() => `Travel Abroad • ${country}`, [country]);

  const openDefinition = async (def) => {
    if (!canUseWeHelp) return;
    if (!country || country === "Not selected") {
      alert("Pick a destination country first so we can load the correct request price.");
      return;
    }

    const title = String(def?.title || "").trim();
    if (!title) return;

    const meta = buildSingleRequestMeta(title, country);

    if (meta.isCustom) {
      try {
        const quote = await getRequestPricingQuote({
          pricingKey: meta.pricingKey,
          track: "travel",
          country,
          serviceName: meta.serviceName,
          requestType: meta.requestType,
        });
        if (!quote) {
          alert(
            "This request is configured in SACC but is not live yet: pricing is not set for it."
          );
          return;
        }
      } catch (error) {
        console.warn("pricing quote check failed:", error);
        alert("Failed to verify pricing for this request. Try again.");
        return;
      }
    }

    setModalResumeState(null);
    setRequestMeta(meta);
    setModalOpen(true);
  };

  const openFull = () => {
    if (!canUseWeHelp) return;
    setDiagnosticOpen(true);
  };

  const goToProfile = () => navigate("/app/profile");

  // ✅ Attachments on all single-package requests
  const enableAttachments = requestMeta?.requestType === "single";
  const singlePackages = useMemo(() => {
    const defs = Array.isArray(activeDefinitions) ? activeDefinitions : [];
    return defs
      .filter((def) => String(def?.title || "").trim())
      .sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || "")));
  }, [activeDefinitions]);

  const filteredSinglePackages = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return singlePackages.filter((def) => {
      if (!needle) return true;
      const title = String(def?.title || "").trim().toLowerCase();
      const note =
        Number(def?.activeExtraFieldCount || 0) > 0
          ? `${Number(def?.activeExtraFieldCount || 0)} extra fields`
          : "No extra fields configured yet";
      return `${title} ${note}`.includes(needle);
    });
  }, [singlePackages, q]);

  const submitRequest = async ({
    name,
    phone,
    note,
    dummyFiles,
    requestUploadMeta,
    extraFieldAnswers,
    email: formEmail,
    requestDraftId,
    county,
    town,
    preferredAgentId,
    paid,
    paymentMeta,
    unlockPaymentReceipt,
  }) => {
    if (!uid || !requestMeta) return;

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      setModalOpen(false);
      goToProfile();
      return;
    }

    // Save contact to user profile (non-blocking)
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

    try {
      const pendingRequestId = String(
        unlockPaymentReceipt?.requestId || paymentMeta?.requestId || ""
      ).trim();
      const pricingQuote = await getRequestPricingQuote({
        pricingKey: requestMeta.pricingKey,
        track: "travel",
        country,
        serviceName: requestMeta.serviceName,
        requestType: requestMeta.requestType,
      });
      const appliedPricing = toRequestPricingSnapshot(pricingQuote, {
        amount: unlockPaymentReceipt?.amount,
        currency: unlockPaymentReceipt?.currency || pricingQuote?.currency,
      });
      if (!appliedPricing) {
        throw new Error("Request pricing is unavailable right now. Please try again.");
      }
      if (paid && !pendingRequestId) {
        throw new Error("This paid unlock session could not be linked safely. Please start checkout again.");
      }

      const requestId = pendingRequestId
        ? pendingRequestId
        : await createServiceRequest({
            uid,
            email: String(formEmail || email || "").trim(),
            track: "travel",
            country,
            requestType: requestMeta.requestType,
            serviceName: requestMeta.serviceName,
            name,
            phone,
            note,
            county: String(county || "").trim(),
            town: String(town || "").trim(),
            city: String(town || "").trim(),
            preferredAgentId: String(preferredAgentId || "").trim(),
            paid: false,
            paymentMeta: null,
            pricingSnapshot: appliedPricing,
            requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
            extraFieldAnswers: extraFieldAnswers || null,
          });

      if (pendingRequestId) {
        const activation = await activatePreparedUnlockRequest({
          requestId: pendingRequestId,
          unlockPaymentReceipt,
        });
        if (activation?.alreadyActivated) {
          if (requestDraftId) {
            await archiveWorkflowDraft(requestDraftId, {
              status: "submitted",
              archivedReason: "request_already_activated",
              linkedRequestId: pendingRequestId,
            });
          }
          setModalOpen(false);
          navigate(`/app/request/${pendingRequestId}`, { replace: true });
          return { requestId: pendingRequestId, alreadyActivated: true };
        }
      }

      const picked = Array.isArray(dummyFiles) ? dummyFiles : [];
      if (picked.length > 0) {
        for (const file of picked) {
          await createPendingAttachment({ requestId, file });
        }
      } else {
        const metaFiles = Array.isArray(requestUploadMeta?.files) ? requestUploadMeta.files : [];
        for (const fileMeta of metaFiles) {
          await createPendingAttachmentFromMeta({ requestId, fileMeta });
        }
      }

      await setActiveProcessDetails(uid, {
        hasActiveProcess: true,
        activeTrack: "travel",
        activeCountry: country,
        activeHelpType: "we",
        activeRequestId: requestId,
      });

      setSnapshot({
        route: { path: `/app/request/${requestId}`, search: "" },
        weHelp: { activeRequestId: requestId },
      });

      if (requestDraftId) {
        await archiveWorkflowDraft(requestDraftId, {
          status: "submitted",
          archivedReason: "request_submitted",
          linkedRequestId: requestId,
        });
      }

      setModalOpen(false);
      navigate(`/app/request/${requestId}`, { replace: true });
      return { requestId };
    } catch (err) {
      if (err?.code === "auth/email-not-verified") {
        navigate("/verify-email", { replace: false });
      }
      throw err;
    }
  };

  const prepareUnlockCheckout = async ({
    requestDraftId,
    returnTo,
    name,
    phone,
    email: formEmail,
    county,
    town,
    note,
    preferredAgentId,
    requestUploadMeta,
    extraFieldAnswers,
  } = {}) => {
    if (!uid || !requestMeta) throw new Error("Request details are not ready yet.");

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      setModalOpen(false);
      goToProfile();
      throw new Error("Profile is incomplete.");
    }

    const pricingQuote = await getRequestPricingQuote({
      pricingKey: requestMeta.pricingKey,
      track: "travel",
      country,
      serviceName: requestMeta.serviceName,
      requestType: requestMeta.requestType,
    });
    const appliedPricing = toRequestPricingSnapshot(pricingQuote);
    if (!appliedPricing) {
      throw new Error("Request pricing is unavailable right now. Please try again.");
    }

    const requestId = await createServiceRequest({
      uid,
      email: String(formEmail || email || "").trim(),
      track: "travel",
      country,
      requestType: requestMeta.requestType,
      serviceName: requestMeta.serviceName,
      name: String(name || "").trim(),
      phone: String(phone || "").trim(),
      note,
      county: String(county || "").trim(),
      town: String(town || "").trim(),
      city: String(town || "").trim(),
      preferredAgentId: String(preferredAgentId || "").trim(),
      paid: false,
      paymentMeta: null,
      pricingSnapshot: appliedPricing,
      requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
      extraFieldAnswers: extraFieldAnswers || null,
      status: "payment_pending",
      skipAdminPush: true,
    });

    return createUnlockCheckoutSession({
      requestId,
      draftId: requestDraftId,
      returnTo,
      appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950">
      {/* soft background glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
        <div className="absolute top-44 -left-24 h-72 w-72 rounded-full bg-sky-200/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-100/25 blur-3xl" />
      </div>

      <motion.div
        variants={pageIn}
        initial="hidden"
        animate="show"
        className="px-5 py-6 max-w-xl mx-auto"
      >
        {/* Back */}
        <button
          onClick={goBackToChoice}
          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-white/60 px-3 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50/70 hover:border-emerald-300 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-emerald-900/40 dark:bg-zinc-900/60 dark:text-emerald-200 dark:hover:bg-emerald-950/25 dark:focus:ring-emerald-300/30"
        >
          <AppIcon size={ICON_SM} icon={ArrowLeft} />
          Back
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-900">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 dark:bg-zinc-900/60 border border-emerald-100">
                <AppIcon size={ICON_SM} className="text-emerald-700" icon={Plane} />
              </span>
              Travel · We-Help
            </div>

            <h1 className="mt-3 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Get help with your travel process
            </h1>

            <p className="mt-1 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <AppIcon size={ICON_SM} icon={MapPinned} className="text-emerald-700" />
              Destination: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{country}</span>
            </p>
          </div>

          <div className="shrink-0 h-12 w-12 rounded-3xl border border-emerald-100 bg-emerald-50/80 shadow-sm" />
        </div>

        <JourneyBanner journey={journey} track="travel" country={country} />

        {/* Toast */}
        <AnimatePresence>
          {toast ? (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm font-semibold text-amber-900 backdrop-blur"
            >
              {toast}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {pageErr ? (
          <div className="mt-5 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700">
            {pageErr}
          </div>
        ) : null}

        {/* Profile banner */}
        {missing.length > 0 ? (
          <motion.div
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/70 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.08)] backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Complete your profile to continue
                </div>
                <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Missing: <span className="font-semibold">{missing.join(", ")}</span>
                </div>
              </div>

              <span className="inline-flex h-11 w-11 items-center justify-center rounded-3xl border border-amber-200 bg-white/70 dark:bg-zinc-900/60 text-amber-900 shadow-sm">
                <AppIcon size={ICON_MD} icon={ShieldCheck} />
              </span>
            </div>

            <button
              onClick={goToProfile}
              className="mt-4 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
            >
              Go to Profile
            </button>
          </motion.div>
        ) : null}

        {/* Full package hero */}
        <motion.div
          variants={floatCard}
          initial="rest"
          whileHover={canUseWeHelp ? "hover" : "rest"}
          whileTap={canUseWeHelp ? "tap" : "rest"}
          className={[
            "mt-6 rounded-3xl border p-5 shadow-[0_18px_55px_rgba(0,0,0,0.10)] backdrop-blur-xl",
            canUseWeHelp
              ? "border-emerald-200/80 bg-white/75 dark:bg-zinc-900/60"
              : "border-zinc-200/70 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 opacity-70",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-semibold text-emerald-900">
                <AppIcon size={ICON_SM} icon={Sparkles} />
                Full package · Best value
              </div>

              <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Complete travel support in one request
              </h2>
            </div>

            <span className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-3xl border border-emerald-100 bg-emerald-50/80 text-emerald-800 shadow-sm">
              <AppIcon size={ICON_LG} icon={Package} />
            </span>
          </div>

          <button
            type="button"
            onClick={() => setFullPackageDetailsOpen((v) => !v)}
            className="mt-4 flex w-full items-center justify-between rounded-2xl border border-zinc-200/70 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2.5 text-left text-xs font-semibold text-zinc-700 dark:text-zinc-300"
          >
            <span className="inline-flex items-center gap-2">
              <AppIcon size={ICON_SM} icon={BadgeCheck} className="text-emerald-700" />
              Includes {FULL_PACKAGE.length} verified support steps
            </span>
            <AppIcon
              size={ICON_SM}
              icon={ChevronDown}
              className={`transition-transform ${fullPackageDetailsOpen ? "rotate-180" : ""}`}
            />
          </button>

          {fullPackageDetailsOpen ? (
            <ul className="mt-3 grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              {FULL_PACKAGE.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50/70 text-emerald-800">
                    <AppIcon size={ICON_SM} icon={BadgeCheck} />
                  </span>
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            onClick={openFull}
            disabled={!canUseWeHelp}
            className={[
              "mt-5 w-full rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99]",
              canUseWeHelp
                ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
                : "border-zinc-200 dark:border-zinc-800 bg-zinc-100 text-zinc-400 cursor-not-allowed",
            ].join(" ")}
          >
            Request full package
          </button>

          {!canUseWeHelp ? (
            <div className="mt-3 text-xs text-zinc-500">
              Complete your profile first to unlock requests.
            </div>
          ) : null}
        </motion.div>

        {/* Single-package requests configured in SACC */}
        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Single packages
            </h2>
            <span className="text-xs font-semibold text-zinc-500">
              {singlePackages.length} available
            </span>
          </div>

          <div className="mt-4 rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/72 dark:bg-zinc-900/60 p-3 shadow-sm backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-800">
                <AppIcon size={ICON_MD} icon={Search} />
              </span>

              <div className="min-w-0 flex-1">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search single packages..."
                  className="w-full bg-transparent text-sm font-semibold text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none"
                />
              </div>

              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition hover:bg-white active:scale-[0.995]"
                  aria-label="Clear search"
                  title="Clear"
                >
                  <AppIcon size={ICON_MD} icon={X} />
                </button>
              ) : null}
            </div>
          </div>

          {definitionsErr ? (
            <div className="mt-4 rounded-3xl border border-rose-200 bg-rose-50/70 p-5 text-sm text-rose-700 shadow-sm backdrop-blur dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
              {definitionsErr}
            </div>
          ) : definitionsLoading && singlePackages.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
              Loading single packages...
            </div>
          ) : singlePackages.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
              No single packages configured yet for this route.
            </div>
          ) : filteredSinglePackages.length === 0 ? (
            <div className="mt-4 rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
              No single packages match your search yet.
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {filteredSinglePackages.map((def) => {
                const count = Number(def?.activeExtraFieldCount || 0);
                const note = count > 0 ? `${count} extra fields` : "No extra fields configured yet";
                return (
                  <ServiceTile
                    key={def.definitionKey || def.id}
                    s={{
                      serviceName: def.title,
                      note,
                    }}
                    disabled={!canUseWeHelp}
                    onClick={() => void openDefinition(def)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/*
        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Single packages</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Pick one service to request.
              </p>
            </div>
            <span className="text-xs font-semibold text-zinc-500">
              {singleServices.length} options
            </span>
          </div>

          Search
          <div className="mt-4 rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/72 dark:bg-zinc-900/60 p-3 shadow-sm backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-2xl border border-zinc-200/70 dark:border-zinc-800 bg-white/65 dark:bg-zinc-900/60 px-2.5 py-2 text-left"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-800">
                <AppIcon size={ICON_MD} icon={Filter} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Filters</div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {q
                    ? `Search: ${q}`
                    : chip === "All"
                      ? "All services"
                      : `Category: ${chip}`}
                </div>
              </div>

              {hasActiveFilters ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  Active
                </span>
              ) : null}

              <AppIcon
                size={ICON_SM}
                icon={ChevronDown}
                className={`text-zinc-500 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
              />
            </button>

            {filtersOpen ? (
              <>
                <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-800">
                <AppIcon size={ICON_MD} icon={Search} />
              </span>

              <div className="min-w-0 flex-1">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search services… (visa, SOP, CV, documents)"
                  className="w-full bg-transparent text-sm font-semibold text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none"
                />
              </div>

              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition hover:bg-white active:scale-[0.995]"
                  aria-label="Clear search"
                  title="Clear"
                >
                  <AppIcon size={ICON_MD} icon={X} />
                </button>
              ) : null}

              <span className="hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300">
                <AppIcon size={ICON_MD} icon={Filter} />
              </span>
            </div>

            Chips
                <div className="mt-3 flex flex-wrap gap-2">
              {["All", "Visa", "Docs", "Writing", "Test", "CV"].map((c) => (
                <Chip key={c} active={chip === c} onClick={() => setChip(c)}>
                  {c}
                </Chip>
              ))}
            </div>
              </>
            ) : null}
          </div>

          Tiles
          <div className="mt-4 grid gap-3">
            {filteredSingles.length === 0 ? (
              <div className="rounded-3xl border border-zinc-200/70 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-5 text-sm text-zinc-600 dark:text-zinc-300 shadow-sm backdrop-blur">
                No results. Try a different keyword (e.g. “visa”, “SOP”, “CV”).
              </div>
            ) : (
              filteredSingles.map((s) => (
                <ServiceTile
                  key={s.pricingKey || s.serviceName}
                  s={s}
                  disabled={!canUseWeHelp}
                  onClick={() => openSingle(s.serviceName)}
                />
              ))
            )}
          </div>
        */}

        <div className="h-10" />
      </motion.div>

      {/* Full Package diagnostic modal */}
      <FullPackageDiagnosticModal
        open={diagnosticOpen}
        onClose={() => setDiagnosticOpen(false)}
        track="travel"
        country={country}
      />

      {/* Single-service Request Modal */}
      <RequestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={submitRequest}
        onPay={prepareUnlockCheckout}
        title={modalTitle}
        subtitle={modalSubtitle}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={auth.currentUser?.email || email || ""}
        defaultCounty={defaultCounty}
        defaultTown={defaultTown}
        paymentContext={{
          flow: "weHelp",
          track: "travel",
          country,
          requestType: requestMeta?.requestType || "single",
          serviceName: requestMeta?.serviceName || "",
          pricingKey: requestMeta?.pricingKey || "",
        }}
        initialState={modalResumeState?.formState || null}
        onStateChange={setModalResumeState}
        enableAttachments={enableAttachments}
        maxPdfMb={10}
      />
    </div>
  );
}

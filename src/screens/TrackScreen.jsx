import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useLocation, useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "../utils/motionProxy";
import {
  ArrowLeft,
  Briefcase,
  ChevronRight,
  GraduationCap,
  IdCard,
  Plane,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import RequestModal from "../components/RequestModal";
import { useI18n } from "../lib/i18n";
import { ICON_MD, ICON_SM } from "../constants/iconSizes";
import {
  APP_DESTINATION_COUNTRIES,
  normalizeDestinationCountry,
} from "../constants/migrationOptions";
import { ANALYTICS_EVENT_TYPES } from "../constants/analyticsEvents";
import { auth } from "../firebase";
import { useCountryDirectory } from "../hooks/useCountryDirectory";
import { useHomeDesignModule } from "../hooks/useHomeDesignModule";
import { useManagedDestinationCountries } from "../hooks/useManagedDestinationCountries";
import { useUserJourney } from "../hooks/useUserJourney";
import { journeyShouldHighlightCountry } from "../journey/journeyMatchers";
import { setSnapshot } from "../resume/resumeEngine";
import { logAnalyticsEvent, trackManagedCountryTap } from "../services/analyticsService";
import {
  createPendingAttachment,
  createPendingAttachmentFromMeta,
} from "../services/attachmentservice";
import {
  activatePreparedUnlockRequest,
  createUnlockCheckoutSession,
} from "../services/paymentservice";
import { subscribeActiveRequestDefinitions } from "../services/requestDefinitionService";
import {
  getUserState,
  setActiveContext,
  setActiveProcessDetails,
  setSelectedTrack,
  upsertUserContact,
} from "../services/userservice";
import { buildRequestPricingKey } from "../constants/requestCatalog";
import { getRequestPricingQuote, toRequestPricingSnapshot } from "../services/pricingservice";
import { createServiceRequest } from "../services/requestservice";
import { archiveWorkflowDraft } from "../services/workflowdraftservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import {
  buildCountryAccentBadgeStyle,
  buildCountryAccentRailStyle,
  buildCountryAccentSurfaceStyle,
  resolveCountryAccentColor,
} from "../utils/countryAccent";

const TRACKS = {
  study: {
    title: "Study Abroad",
    subtitle: "Compare routes, choose a destination, or start a direct request.",
    Icon: GraduationCap,
  },
  work: {
    title: "Work Abroad",
    subtitle: "Pick a country flow or launch a direct admin-routed request.",
    Icon: Briefcase,
  },
  travel: {
    title: "Travel Abroad",
    subtitle: "Browse destinations first, then open the right request path.",
    Icon: Plane,
  },
};

const overlayMotion = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] } },
};

const sheetMotion = {
  hidden: { opacity: 0, y: 6, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.17, ease: [0.2, 0.8, 0.2, 1] },
  },
  exit: {
    opacity: 0,
    y: 4,
    scale: 0.99,
    transition: { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] },
  },
};

const listWrap = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.03 } },
};

const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.14, ease: [0.2, 0.8, 0.2, 1] },
  },
};

function safeString(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function getFirstName(value) {
  const safe = safeString(value, 120);
  if (!safe) return "";
  return safe.split(/\s+/).filter(Boolean)[0] || "";
}

function getTrackGreeting(name) {
  if (!name) return "Hello";
  const hours = new Date().getHours();
  if (hours >= 5 && hours < 12) return `Good morning, ${name}`;
  if (hours >= 12 && hours < 18) return `Good afternoon, ${name}`;
  if (hours >= 18 && hours < 24) return `Good evening, ${name}`;
  return `Hello, ${name}`;
}

function getSimpleRequestIcon(definition) {
  const title = safeString(definition?.title, 120).toLowerCase();
  const tag = safeString(definition?.tag, 40).toLowerCase();
  if (title.includes("passport")) return IdCard;
  if (tag === "docs" || title.includes("document")) return IdCard;
  return Sparkles;
}

function buildTrackSimpleRequestMeta({
  definition = null,
  track = "",
  profileCountry = "",
  serviceName = "",
  pricingKey = "",
  requestDefinitionKey = "",
} = {}) {
  const resolvedServiceName = safeString(serviceName || definition?.title, 140);
  const resolvedTrack = safeString(track, 20).toLowerCase();
  const resolvedCountry = safeString(profileCountry, 120);
  const resolvedPricingKey =
    safeString(pricingKey, 200) ||
    buildRequestPricingKey({
      track: resolvedTrack,
      requestType: "single",
      country: resolvedCountry,
      serviceName: resolvedServiceName,
    });

  return {
    requestType: "single",
    serviceName: resolvedServiceName,
    pricingKey: resolvedPricingKey,
    requestDefinitionKey:
      safeString(requestDefinitionKey, 200) || safeString(definition?.definitionKey, 200),
    requestDefinitionCountry: "",
    isCustom: true,
  };
}

export default function TrackScreen({ track }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { journey } = useUserJourney();
  const safeTrack = useMemo(() => (TRACKS[track] ? track : "study"), [track]);
  const info = TRACKS[safeTrack];
  const HeaderIcon = info.Icon;

  const qs = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const homeContext = safeString(qs.get("context"), 60) || "default";
  const shouldAutoOpenSimple = qs.get("autoOpen") === "1";
  const querySimpleServiceName = safeString(qs.get("open"), 140);
  const querySimpleDefinitionKey = safeString(qs.get("definitionKey"), 200);
  const querySimplePricingKey = safeString(qs.get("pricingKey"), 200);

  const {
    countries: managedCountriesForTrack,
    hasManagedDocs: hasManagedCountries,
    loading: countriesLoading,
  } = useManagedDestinationCountries({
    trackType: safeTrack,
    fallbackCountries: APP_DESTINATION_COUNTRIES,
  });
  const { countryMap } = useCountryDirectory();
  const { module: homeDesignModule, loading: homeDesignLoading } = useHomeDesignModule({
    trackType: safeTrack,
    contextKey: homeContext,
  });

  const [uid, setUid] = useState(null);
  const [userState, setUserState] = useState(null);
  const [profileCountry, setProfileCountry] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileChecked, setProfileChecked] = useState(false);
  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");
  const [defaultCounty, setDefaultCounty] = useState("");
  const [defaultTown, setDefaultTown] = useState("");
  const [simpleDefinitions, setSimpleDefinitions] = useState([]);
  const [simpleLoading, setSimpleLoading] = useState(false);
  const [simpleError, setSimpleError] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [simpleModalOpen, setSimpleModalOpen] = useState(false);
  const [simpleRequestMeta, setSimpleRequestMeta] = useState(null);
  const [simpleModalResumeState, setSimpleModalResumeState] = useState(null);
  const [startingType, setStartingType] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const simpleResumeAppliedRef = useRef(false);
  const simpleAutoOpenedRef = useRef(false);

  const visibleCountries = useMemo(() => {
    if (countriesLoading) return [];
    return hasManagedCountries ? managedCountriesForTrack : APP_DESTINATION_COUNTRIES;
  }, [countriesLoading, hasManagedCountries, managedCountriesForTrack]);

  const featuredCountries = useMemo(() => {
    const configured = (Array.isArray(homeDesignModule?.featuredCountries)
      ? homeDesignModule.featuredCountries
      : []
    ).filter((entry) => entry?.isActive !== false && safeString(entry?.country, 120));

    if (configured.length) return configured;

    return visibleCountries.slice(0, 6).map((country, index) => ({
      id: `fallback_${country}_${index}`,
      country,
      label: country,
      eyebrow: "Featured",
      metaLabel: "",
      metaValue: "",
      description: "",
      imageUrl: "",
      flagOverride: "",
      isActive: true,
      sortOrder: index + 1,
    }));
  }, [homeDesignModule, visibleCountries]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user ? user.uid : null);
      if (!user) {
        setUserState(null);
        setProfileCountry("");
        setProfileChecked(true);
        setDefaultName("");
        setDefaultPhone("");
        setDefaultCounty("");
        setDefaultTown("");
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      setProfileChecked(false);
      getUserState(user.uid)
        .then((nextState) => {
          setUserState(nextState || null);
          setProfileCountry(safeString(nextState?.countryOfResidence, 120));
          setDefaultName(safeString(nextState?.name, 140));
          setDefaultPhone(safeString(nextState?.phone, 80));
          setDefaultCounty(safeString(nextState?.county, 120));
          setDefaultTown(safeString(nextState?.town || nextState?.city, 120));
        })
        .catch((error) => {
          console.error("TrackScreen profile load failed:", error);
          setUserState(null);
          setProfileCountry("");
          setDefaultName("");
          setDefaultPhone("");
          setDefaultCounty("");
          setDefaultTown("");
        })
        .finally(() => {
          setProfileLoading(false);
          setProfileChecked(true);
        });
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) return;
    void logAnalyticsEvent({
      uid,
      eventType: ANALYTICS_EVENT_TYPES.TRACK_SCREEN_OPENED,
      trackType: safeTrack,
      sourceScreen: "TrackScreen",
      metadata: { contextKey: homeContext },
    });
  }, [homeContext, safeTrack, uid]);

  useEffect(() => {
    if (!uid || !profileCountry) {
      setSimpleDefinitions([]);
      setSimpleError("");
      setSimpleLoading(false);
      return undefined;
    }

    setSimpleLoading(true);
    setSimpleError("");

    return subscribeActiveRequestDefinitions({
      trackType: safeTrack,
      country: profileCountry,
      entryPlacement: "track_simple",
      countrySource: "profile_country_of_residence",
      onData: (rows) => {
        setSimpleDefinitions(Array.isArray(rows) ? rows : []);
        setSimpleLoading(false);
      },
      onError: (error) => {
        console.error("track simple request definitions load failed:", error);
        setSimpleDefinitions([]);
        setSimpleError(error?.message || "Failed to load simple request types.");
        setSimpleLoading(false);
      },
    });
  }, [profileCountry, safeTrack, uid]);

  useEffect(() => {
    const country = qs.get("country");
    const from = safeString(qs.get("from"), 40).toLowerCase();

    if (country && from === "choice") {
      setSelectedCountry(normalizeDestinationCountry(country) || country);
      setShowModal(true);
    }
  }, [qs]);

  const clearSimpleRequestQueryParams = () => {
    const nextQuery = new URLSearchParams(location.search || "");
    [
      "autoOpen",
      "open",
      "draft",
      "definitionKey",
      "definitionCountry",
      "pricingKey",
    ].forEach((key) => nextQuery.delete(key));
    navigate(
      {
        pathname: location.pathname,
        search: nextQuery.toString() ? `?${nextQuery.toString()}` : "",
      },
      { replace: true }
    );
  };

  useEffect(() => {
    if (simpleResumeAppliedRef.current) return;
    if (!profileChecked || !profileCountry) return;

    const resumeState = location.state?.resumeTrackSimple;
    if (!resumeState || String(resumeState.track || "").toLowerCase() !== safeTrack) return;
    const modalState = resumeState?.requestModal;
    if (!modalState?.open || !modalState?.serviceName) return;

    simpleResumeAppliedRef.current = true;
    setSimpleRequestMeta(
      buildTrackSimpleRequestMeta({
        track: safeTrack,
        profileCountry,
        serviceName: modalState.serviceName,
        pricingKey: modalState.pricingKey,
        requestDefinitionKey: modalState.definitionKey,
      })
    );
    setSimpleModalResumeState(modalState);
    setSimpleModalOpen(true);
  }, [location.state, profileChecked, profileCountry, safeTrack]);

  useEffect(() => {
    if (simpleAutoOpenedRef.current) return;
    if (!shouldAutoOpenSimple || !querySimpleServiceName) return;
    if (!profileChecked || !profileCountry) return;

    simpleAutoOpenedRef.current = true;
    setSimpleRequestMeta(
      buildTrackSimpleRequestMeta({
        track: safeTrack,
        profileCountry,
        serviceName: querySimpleServiceName,
        pricingKey: querySimplePricingKey,
        requestDefinitionKey: querySimpleDefinitionKey,
      })
    );
    setSimpleModalResumeState(null);
    setSimpleModalOpen(true);
  }, [
    profileChecked,
    profileCountry,
    querySimpleDefinitionKey,
    querySimplePricingKey,
    querySimpleServiceName,
    safeTrack,
    shouldAutoOpenSimple,
  ]);

  useEffect(() => {
    setSnapshot({
      route: {
        path: location.pathname,
        search: location.search || "",
      },
      trackSelect: {
        selectedTrack: safeTrack,
        destination: selectedCountry || "",
        country: selectedCountry || "",
        category: safeTrack,
        profileCountry,
        contextKey: homeContext,
        subStep: simpleModalOpen
          ? "track-simple-modal-open"
          : showModal
          ? "country-selected-modal-open"
          : selectedCountry
          ? "country-selected"
          : simpleDefinitions.length
          ? "track-simple-ready"
          : "country-list",
        requestModal: simpleModalOpen
          ? {
              open: true,
              serviceName: simpleRequestMeta?.serviceName || "",
              definitionKey: simpleRequestMeta?.requestDefinitionKey || "",
              pricingKey: simpleRequestMeta?.pricingKey || "",
            }
          : null,
      },
    });
  }, [
    homeContext,
    location.pathname,
    location.search,
    profileCountry,
    safeTrack,
    selectedCountry,
    simpleModalOpen,
    simpleRequestMeta,
    showModal,
    simpleDefinitions.length,
  ]);

  useEffect(() => {
    if (!showModal) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape" && !saving) setShowModal(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal, saving]);

  const resolveAccentColor = (country) => resolveCountryAccentColor(countryMap, country, "");
  const profileAccentColor = resolveAccentColor(profileCountry);
  const firstName = useMemo(
    () => getFirstName(defaultName || userState?.name || auth.currentUser?.displayName || ""),
    [defaultName, userState]
  );
  const greetingTitle = useMemo(() => getTrackGreeting(firstName), [firstName]);
  const topBg = "bg-white dark:bg-zinc-950";
  const countryCard =
    "relative group w-full overflow-hidden text-left rounded-3xl border bg-white/75 p-4 shadow-sm backdrop-blur transition will-change-transform dark:bg-zinc-900/55";
  const sectionTitle =
    "text-[1.55rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100";
  const sectionSubtitle = "mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300";

  const goToTrackSelect = () => {
    if (saving) return;
    navigate("/dashboard", { replace: true });
  };

  const openCountry = (country) => {
    const normalized = normalizeDestinationCountry(country) || country;
    setSelectedCountry(normalized);
    setShowModal(true);
    setStatusMsg("");
    setStartingType("");

    void trackManagedCountryTap({
      trackType: safeTrack,
      country: normalized,
      sourceScreen: "TrackScreen",
    });
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
  };

  const closeSimpleModal = () => {
    setSimpleModalOpen(false);
    setSimpleModalResumeState(null);
    clearSimpleRequestQueryParams();
  };

  const startProcessAndGo = async (helpType) => {
    if (!uid) {
      navigate("/login", { replace: true });
      return;
    }

    const canonicalCountry = normalizeDestinationCountry(selectedCountry) || selectedCountry;
    if (!canonicalCountry || saving) return;

    setSaving(true);
    setStartingType(helpType);
    setStatusMsg("Saving your progress...");

    try {
      await setSelectedTrack(uid, safeTrack);
      await setActiveContext(uid, {
        hasActiveProcess: true,
        activeTrack: safeTrack,
        activeCountry: canonicalCountry,
        activeHelpType: helpType,
      });

      const encodedCountry = encodeURIComponent(canonicalCountry);
      navigate(`/app/${safeTrack}/${helpType === "self" ? "self-help" : "we-help"}?country=${encodedCountry}&from=choice`, {
        replace: true,
      });
      setShowModal(false);
    } catch (error) {
      console.error(error);
      setStatusMsg(error?.message || "Failed to save progress.");
    } finally {
      setSaving(false);
      setStartingType("");
    }
  };

  const launchSimpleRequest = async (definition) => {
    if (!uid) {
      navigate("/login", { replace: true });
      return;
    }

    const meta = buildTrackSimpleRequestMeta({
      definition,
      track: safeTrack,
      profileCountry,
    });
    if (!meta?.serviceName || saving) return;
    if (!profileCountry) {
      setStatusMsg("Set your country of residence first to use direct request types.");
      return;
    }

    setSaving(true);
    setStartingType(`simple:${meta.serviceName}`);
    setStatusMsg("Preparing request...");

    try {
      await setSelectedTrack(uid, safeTrack);
      const pricingQuote = await getRequestPricingQuote({
        pricingKey: meta.pricingKey,
        track: safeTrack,
        country: profileCountry,
        serviceName: meta.serviceName,
        requestType: meta.requestType,
      });
      if (!pricingQuote) {
        alert("This request is configured in SACC but is not live yet: pricing is not set for it.");
        return;
      }
      setSimpleRequestMeta(meta);
      setSimpleModalResumeState(null);
      setSimpleModalOpen(true);
    } catch (error) {
      console.error(error);
      setStatusMsg(error?.message || "Failed to launch request.");
    } finally {
      setSaving(false);
      setStartingType("");
    }
  };

  const submitSimpleRequest = async ({
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
    if (!uid || !simpleRequestMeta) return;

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      closeSimpleModal();
      navigate("/app/profile");
      return;
    }

    try {
      const cleanName = safeString(name, 140);
      const cleanPhone = safeString(phone, 80);
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
    } catch (error) {
      console.warn("upsertUserContact failed (continuing anyway):", error);
    }

    const pricingQuote = await getRequestPricingQuote({
      pricingKey: simpleRequestMeta.pricingKey,
      track: safeTrack,
      country: profileCountry,
      serviceName: simpleRequestMeta.serviceName,
      requestType: simpleRequestMeta.requestType,
    });
    const appliedPricing = toRequestPricingSnapshot(pricingQuote, {
      amount: unlockPaymentReceipt?.amount,
      currency: unlockPaymentReceipt?.currency || pricingQuote?.currency,
    });
    if (!appliedPricing) {
      throw new Error("Request pricing is unavailable right now. Please try again.");
    }

    const pendingRequestId = safeString(
      unlockPaymentReceipt?.requestId || paymentMeta?.requestId,
      160
    );
    if (paid && !pendingRequestId) {
      throw new Error("This paid unlock session could not be linked safely. Please start checkout again.");
    }

    const requestId = pendingRequestId
      ? pendingRequestId
      : await createServiceRequest({
          uid,
          email: safeString(formEmail || auth.currentUser?.email || "", 200),
          track: safeTrack,
          country: profileCountry,
          requestType: simpleRequestMeta.requestType,
          serviceName: simpleRequestMeta.serviceName,
          name,
          phone,
          note,
          county: safeString(county, 120),
          town: safeString(town, 120),
          city: safeString(town, 120),
          countryOfResidence: profileCountry,
          partnerFilterMode: "home_country",
          preferredAgentId: safeString(preferredAgentId, 140),
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
        closeSimpleModal();
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
      activeTrack: safeTrack,
      activeCountry: profileCountry,
      activeHelpType: "we",
      activeRequestId: requestId,
    });

    if (requestDraftId) {
      await archiveWorkflowDraft(requestDraftId, {
        status: "submitted",
        archivedReason: "request_submitted",
        linkedRequestId: requestId,
      });
    }

    closeSimpleModal();
    navigate(`/app/request/${requestId}`, { replace: true });
    return { requestId };
  };

  const prepareSimpleUnlockCheckout = async ({
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
    if (!uid || !simpleRequestMeta) {
      throw new Error("Request details are not ready yet.");
    }

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      closeSimpleModal();
      navigate("/app/profile");
      throw new Error("Profile is incomplete.");
    }

    const pricingQuote = await getRequestPricingQuote({
      pricingKey: simpleRequestMeta.pricingKey,
      track: safeTrack,
      country: profileCountry,
      serviceName: simpleRequestMeta.serviceName,
      requestType: simpleRequestMeta.requestType,
    });
    const appliedPricing = toRequestPricingSnapshot(pricingQuote);
    if (!appliedPricing) {
      throw new Error("Request pricing is unavailable right now. Please try again.");
    }

    const requestId = await createServiceRequest({
      uid,
      email: safeString(formEmail || auth.currentUser?.email || "", 200),
      track: safeTrack,
      country: profileCountry,
      requestType: simpleRequestMeta.requestType,
      serviceName: simpleRequestMeta.serviceName,
      name: safeString(name, 140),
      phone: safeString(phone, 80),
      note,
      county: safeString(county, 120),
      town: safeString(town, 120),
      city: safeString(town, 120),
      countryOfResidence: profileCountry,
      partnerFilterMode: "home_country",
      preferredAgentId: safeString(preferredAgentId, 140),
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

  const simpleModalTitle = useMemo(() => {
    if (!simpleRequestMeta?.serviceName) return t("request");
    return `${t("request_label")}: ${simpleRequestMeta.serviceName}`;
  }, [simpleRequestMeta, t]);

  const simpleModalSubtitle = useMemo(() => {
    const profileLabel = profileCountry || t("profile_country");
    return `${info.title} • ${profileLabel}`;
  }, [info.title, profileCountry, t]);

  return (
    <div className={`min-h-screen ${topBg}`}>
      <div className="mx-auto max-w-6xl px-5 py-6 pb-10">
        <div
          className="sticky z-20"
          style={{ top: "0.35rem" }}
        >
          <div
            className="relative overflow-hidden rounded-[30px] border border-white/55 bg-white/60 px-4 py-4 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/58"
          >
            <Motion.div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-8 h-32 w-32 rounded-full bg-emerald-300/14 blur-3xl"
              animate={{ x: [0, -6, 0], y: [0, 8, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />

            <div className="relative">
              <div className="min-w-0">
                <h1 className="text-[1.85rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {greetingTitle}
                </h1>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                  Choose a destination to start your journey
                </p>
              </div>

              <div className="mt-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                      <AppIcon size={ICON_MD} icon={HeaderIcon} />
                    </span>

                    <div className="min-w-0">
                      <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {info.title}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Residence: {profileLoading ? "Loading..." : profileCountry || "Not set"}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={goToTrackSelect}
                  disabled={saving}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white/82 px-3 py-1.5 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100 dark:hover:border-emerald-900/40"
                >
                  <AppIcon size={ICON_SM} icon={ArrowLeft} />
                  Tracks
                </button>
              </div>
            </div>
          </div>
        </div>

        {statusMsg ? (
          <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
            {statusMsg}
          </div>
        ) : null}

        <div className="mt-8 grid gap-10">
          <section>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className={sectionTitle}>{homeDesignModule?.title || t("top_countries")}</h2>
              <p className={sectionSubtitle}>
                {homeDesignModule?.subtitle || "Top selected countries by users"}
              </p>
            </div>

            {homeDesignLoading && !featuredCountries.length ? (
              <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-300">
                Loading featured countries...
              </div>
            ) : (
              <div className="mx-auto mt-6 max-w-4xl">
                <div className="flex gap-4 overflow-x-auto pb-3 snap-x snap-mandatory [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-zinc-200/40 dark:[&::-webkit-scrollbar-track]:bg-zinc-800/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-400/45 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600/45">
                  {featuredCountries.map((entry) => {
                    const country = safeString(entry?.country, 120);
                    const accentColor = resolveAccentColor(country);
                    const imageUrl = safeString(entry?.imageUrl, 1200);
                    return (
                      <button
                        key={entry.id || country}
                        type="button"
                        onClick={() => openCountry(country)}
                        className="relative w-[calc((100%-1rem)/2)] min-w-[17rem] flex-none shrink-0 snap-start overflow-hidden rounded-[26px] border border-zinc-200/80 p-4 text-left shadow-sm transition hover:-translate-y-[1px] active:scale-[0.99] dark:border-zinc-700/80"
                        style={buildCountryAccentSurfaceStyle(accentColor, { strong: true })}
                      >
                        {imageUrl ? (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-[0.14]"
                            style={{ backgroundImage: `url(${imageUrl})` }}
                          />
                        ) : null}
                        <span
                          className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-[26px]"
                          style={buildCountryAccentRailStyle(accentColor)}
                        />

                        <div className="relative flex aspect-[1/1.02] flex-col justify-between gap-5">
                          <div>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-300">
                                  {entry.eyebrow || "Featured"}
                                </div>
                                <div className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                  {entry.label || country}
                                </div>
                              </div>
                              <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-100">
                                {entry.flagOverride || country.slice(0, 2).toUpperCase()}
                              </span>
                            </div>

                            {entry.description ? (
                              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                                {entry.description}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex items-end justify-between gap-3">
                            <div>
                              {entry.metaLabel && entry.metaValue ? (
                                <>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                                    {entry.metaLabel}
                                  </div>
                                  <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {entry.metaValue}
                                  </div>
                                </>
                              ) : null}
                            </div>

                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/75 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100">
                              <AppIcon size={ICON_MD} icon={ChevronRight} />
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className={sectionTitle}>{t("country_selection")}</h2>
              <p className={sectionSubtitle}>Choose a destination</p>
            </div>

            {!countriesLoading && hasManagedCountries && visibleCountries.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                No active countries are available for this track right now.
              </div>
            ) : (
              <Motion.div
                className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                variants={listWrap}
                initial="hidden"
                animate="show"
              >
                {visibleCountries.map((country) => {
                  const highlighted = journeyShouldHighlightCountry(journey, {
                    track: safeTrack,
                    country,
                  });
                  const accentColor = resolveAccentColor(country);
                  return (
                    <Motion.button
                      key={country}
                      type="button"
                      onClick={() => openCountry(country)}
                      variants={listItem}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.99 }}
                      className={countryCard}
                      style={buildCountryAccentSurfaceStyle(accentColor, { strong: highlighted })}
                    >
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-3xl"
                        style={buildCountryAccentRailStyle(accentColor)}
                      />
                      <div className="relative flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {country}
                          </div>
                          {highlighted ? (
                            <div className="mt-2">
                              <span
                                className="rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                                style={buildCountryAccentBadgeStyle(accentColor)}
                              >
                                Continue journey
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100">
                          <AppIcon size={ICON_MD} icon={ChevronRight} />
                        </span>
                      </div>
                    </Motion.button>
                  );
                })}
              </Motion.div>
            )}
          </section>

          <section>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className={sectionTitle}>{t("simple_requests")}</h2>
              <p className={sectionSubtitle}>
                Direct entries that use your profile country automatically.
              </p>
            </div>

            {!profileCountry && !profileLoading ? (
              <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                Add your country of residence in your profile before using simple request types.
              </div>
            ) : simpleError ? (
              <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/35 dark:text-amber-200">
                {simpleError}
              </div>
            ) : simpleLoading ? (
              <div className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-300">
                Loading simple request types...
              </div>
            ) : simpleDefinitions.length === 0 ? (
              <div className="mt-6 rounded-3xl border border-dashed border-zinc-200 bg-white/70 px-4 py-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                No direct request types are configured yet for {profileCountry || "this profile"}.
              </div>
            ) : (
              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {simpleDefinitions.map((definition) => {
                  const icon = getSimpleRequestIcon(definition);
                  const serviceName = safeString(definition?.title, 140);
                  const isLaunching = startingType === `simple:${serviceName}`;
                  return (
                    <button
                      key={definition.definitionKey || definition.id}
                      type="button"
                      onClick={() => void launchSimpleRequest(definition)}
                      disabled={saving}
                      className="relative overflow-hidden rounded-3xl border bg-white/80 p-4 text-left shadow-sm transition hover:-translate-y-[1px] active:scale-[0.99] disabled:opacity-65 dark:border-zinc-700 dark:bg-zinc-900/65"
                      style={buildCountryAccentSurfaceStyle(profileAccentColor, { strong: true })}
                    >
                      <span
                        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-3xl"
                        style={buildCountryAccentRailStyle(profileAccentColor)}
                      />

                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {definition.tag ? (
                              <span
                                className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                                style={buildCountryAccentBadgeStyle(profileAccentColor)}
                              >
                                {definition.tag}
                              </span>
                            ) : null}
                            <span className="rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                              Direct
                            </span>
                          </div>

                          <div className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                            {definition.title}
                          </div>
                          <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                            {definition.summary ||
                              `Uses ${profileCountry} from your profile automatically.`}
                          </div>
                        </div>

                        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100">
                          <AppIcon size={ICON_MD} icon={icon} />
                        </span>
                      </div>

                      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {isLaunching ? t("opening") : t("start_request")}
                        <AppIcon size={ICON_SM} icon={ChevronRight} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <AnimatePresence>
        {showModal ? (
          <Motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 sm:items-center"
            variants={overlayMotion}
            initial="hidden"
            animate="show"
            exit="exit"
            onMouseDown={closeModal}
          >
            <Motion.div
              className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70"
              variants={sheetMotion}
              initial="hidden"
              animate="show"
              exit="exit"
              onMouseDown={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                    {t("selected_country")}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedCountry}
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    {t("choose_request_path")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/60 text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-200 dark:hover:bg-zinc-950/45"
                  aria-label="Close"
                >
                  <AppIcon size={ICON_MD} icon={X} />
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                <button
                  type="button"
                  onClick={() => void startProcessAndGo("self")}
                  disabled={saving}
                  className="group w-full rounded-3xl border border-zinc-200 bg-white/60 px-4 py-3 text-left text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-white disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/30 dark:text-zinc-100 dark:hover:bg-zinc-950/45"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900/60">
                      <AppIcon size={ICON_MD} icon={User} className="text-zinc-700 dark:text-zinc-200" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span>{saving && startingType === "self" ? "Starting..." : "Self-Help"}</span>
                        <span className="rounded-full border border-emerald-100 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-100">
                          Free
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                        Guide yourself with country resources
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void startProcessAndGo("we")}
                  disabled={saving}
                  className="group w-full rounded-3xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/75">
                      <AppIcon size={ICON_MD} icon={Users} className="text-emerald-700" />
                    </span>
                    <div className="min-w-0">
                      <div>{saving && startingType === "we" ? "Starting..." : "We-Help"}</div>
                      <div className="mt-0.5 text-xs font-medium text-white/80">
                        Follow the standard admin-routed request flow
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="w-full rounded-3xl border border-zinc-200 bg-transparent px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-950/35"
                >
                  {t("cancel")}
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <RequestModal
        open={simpleModalOpen}
        onClose={closeSimpleModal}
        onSubmit={submitSimpleRequest}
        onPay={prepareSimpleUnlockCheckout}
        title={simpleModalTitle}
        subtitle={simpleModalSubtitle}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={auth.currentUser?.email || ""}
        defaultCounty={defaultCounty}
        defaultTown={defaultTown}
        paymentContext={
          simpleRequestMeta
            ? {
                flow: "wehelp",
                track: safeTrack,
                country: profileCountry,
                countryOfResidence: profileCountry,
                partnerFilterMode: "home_country",
                requestType: simpleRequestMeta.requestType || "single",
                serviceName: simpleRequestMeta.serviceName || "",
                pricingKey: simpleRequestMeta.pricingKey || "",
                requestDefinitionKey: simpleRequestMeta.requestDefinitionKey || "",
                requestDefinitionCountry: "",
              }
            : null
        }
        initialState={simpleModalResumeState?.formState || null}
        onStateChange={setSimpleModalResumeState}
        maxPdfMb={10}
      />
    </div>
  );
}

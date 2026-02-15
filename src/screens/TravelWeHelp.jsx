// ✅ TravelWeHelp.jsx (FULL COPY-PASTE)
// CHANGE: Replace + add icons (lucide-react). No custom SVG icon components.
// Backend/logic untouched.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { motion, AnimatePresence } from "framer-motion";

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
  Filter,
  Tags,
} from "lucide-react";

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

/* ---------------- Data ---------------- */
const SINGLE_SERVICES = [
  { title: "Passport Application", note: "Guidance + document checklist", tag: "Docs" },
  { title: "Visa Application", note: "Forms + appointment + submission support", tag: "Visa" },
  { title: "IELTS Training", note: "Prep plan + resources + practice schedule", tag: "Test" },
  { title: "SOP / Motivation Letter", note: "Writing + polishing", tag: "Writing" },
  { title: "CV / Resume", note: "Professional formatting + improvements", tag: "CV" },
  { title: "Document Review", note: "Verify missing items before submission", tag: "Docs" },
];

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
  hover: { y: -2, scale: 1.01, transition: { duration: 0.16 } },
  tap: { scale: 0.985 },
};

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-extrabold transition active:scale-[0.99]",
        active
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
          : "border-zinc-200 bg-white/70 text-zinc-700 hover:bg-white",
      ].join(" ")}
    >
      {/* ✅ icon added for chips */}
      <Tags className="h-3.5 w-3.5 opacity-80" />
      {children}
    </button>
  );
}

function ServiceIcon({ tag, title }) {
  // ✅ Add icons “where appropriate” based on tag/title
  const common = "h-4.5 w-4.5";
  if (title === "Document Review") return <BadgeCheck className={common} />;
  if (tag === "Visa") return <MapPinned className={common} />;
  if (tag === "Docs") return <Package className={common} />;
  if (tag === "Writing") return <Sparkles className={common} />;
  if (tag === "Test") return <BadgeCheck className={common} />;
  if (tag === "CV") return <BadgeCheck className={common} />;
  return <Package className={common} />;
}

function ServiceTile({ s, disabled, onClick }) {
  const isDocReview = s.title === "Document Review";
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
          ? "border-zinc-200/70 bg-white/55 opacity-60 cursor-not-allowed"
          : "border-zinc-200/70 bg-white/72 hover:border-emerald-200 hover:bg-white/85",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* ✅ icon added to tag chip */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/70 px-2 py-0.5 text-[11px] font-extrabold text-zinc-700">
              <ServiceIcon tag={s.tag} title={s.title} />
              {s.tag}
            </span>

            {isDocReview ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-[11px] font-extrabold text-emerald-900">
                <BadgeCheck className="h-4 w-4" />
                Attach PDFs
              </span>
            ) : null}
          </div>

          <div className="mt-2 font-extrabold text-zinc-900">{s.title}</div>
          <div className="mt-1 text-sm text-zinc-600">{s.note}</div>
        </div>

        <span className="inline-flex h-11 w-11 items-center justify-center rounded-3xl border border-emerald-100 bg-emerald-50/70 text-emerald-800 shadow-sm">
          <ArrowRight className="h-5 w-5" />
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

  // Autofill for modal
  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");

  // Request modal (single services only)
  const [modalOpen, setModalOpen] = useState(false);
  const [requestMeta, setRequestMeta] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);

  // Full Package diagnostic state
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);

  // UI extras
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("All");
  const [toast, setToast] = useState("");

  const canUseWeHelp = missing.length === 0 && profileChecked;

  const goBackToChoice = () => {
    navigate(`/app/travel?country=${encodeURIComponent(country)}&from=choice`);
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
        console.error("TravelWeHelp getUserState error:", e);
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

    if (missing.length > 0) {
      setToast("Complete your profile first — then you can submit this request.");
      setTimeout(() => setToast(""), 2600);
      return;
    }

    setRequestMeta({ requestType: "single", serviceName: openService });
    setModalOpen(true);
    setAutoOpened(true);
  }, [autoOpened, shouldAutoOpen, openService, profileChecked, missing.length]);

  const modalTitle = useMemo(() => {
    if (!requestMeta) return "Request";
    return `Request: ${requestMeta.serviceName}`;
  }, [requestMeta]);

  const modalSubtitle = useMemo(() => `Travel Abroad • ${country}`, [country]);

  const openSingle = (serviceName) => {
    if (!canUseWeHelp) return;
    setRequestMeta({ requestType: "single", serviceName });
    setModalOpen(true);
  };

  const openFull = () => {
    if (!canUseWeHelp) return;
    setDiagnosticOpen(true);
  };

  const goToProfile = () => navigate("/app/profile");

  // ✅ Attachments ONLY on Document Review (same rule as StudyWeHelp)
  const enableAttachments =
    requestMeta?.requestType === "single" &&
    requestMeta?.serviceName === "Document Review";

  const filteredSingles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SINGLE_SERVICES.filter((s) => {
      const chipOk = chip === "All" ? true : s.tag === chip;
      const qOk = !needle
        ? true
        : `${s.title} ${s.note} ${s.tag}`.toLowerCase().includes(needle);
      return chipOk && qOk;
    });
  }, [q, chip]);

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
      const requestId = await createServiceRequest({
        uid,
        email: String(formEmail || email || "").trim(),
        track: "travel",
        country,
        requestType: requestMeta.requestType,
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
        activeTrack: "travel",
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white">
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
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white active:scale-[0.99]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-xs font-extrabold text-emerald-900">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 border border-emerald-100">
                <Plane className="h-4 w-4 text-emerald-700" />
              </span>
              Travel · We-Help
            </div>

            <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-zinc-900">
              Get help with your travel process
            </h1>

            {/* ✅ add icon near destination */}
            <p className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
              <MapPinned className="h-4 w-4 text-emerald-700" />
              Destination:{" "}
              <span className="font-semibold text-zinc-900">{country}</span>
            </p>
          </div>

          <div className="shrink-0 h-12 w-12 rounded-3xl border border-emerald-100 bg-emerald-50/80 shadow-sm" />
        </div>

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
                <div className="text-sm font-extrabold text-zinc-900">
                  Complete your profile to continue
                </div>
                <div className="mt-1 text-sm text-zinc-700">
                  Missing:{" "}
                  <span className="font-semibold">{missing.join(", ")}</span>
                </div>
              </div>

              <span className="inline-flex h-11 w-11 items-center justify-center rounded-3xl border border-amber-200 bg-white/70 text-amber-900 shadow-sm">
                <ShieldCheck className="h-5 w-5" />
              </span>
            </div>

            <button
              onClick={goToProfile}
              className="mt-4 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
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
              ? "border-emerald-200/80 bg-white/75"
              : "border-zinc-200/70 bg-white/60 opacity-70",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-extrabold text-emerald-900">
                <Sparkles className="h-4 w-4" />
                Full package · Best value
              </div>

              <h2 className="mt-3 text-lg font-extrabold text-zinc-900">
                End-to-end travel support, organized in one place
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                We help you with documents, submissions, and next steps — inside MAJUU.
              </p>
            </div>

            {/* ✅ add a “package” icon tile */}
            <span className="shrink-0 inline-flex h-12 w-12 items-center justify-center rounded-3xl border border-emerald-100 bg-emerald-50/80 text-emerald-800 shadow-sm">
              <Package className="h-6 w-6" />
            </span>
          </div>

          <ul className="mt-4 grid gap-2 text-sm text-zinc-700">
            {FULL_PACKAGE.map((item) => (
              <li key={item} className="flex items-start gap-2">
                {/* ✅ add check icon for list */}
                <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50/70 text-emerald-800">
                  <BadgeCheck className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={openFull}
            disabled={!canUseWeHelp}
            className={[
              "mt-5 w-full rounded-2xl border px-4 py-3 text-sm font-extrabold shadow-sm transition active:scale-[0.99]",
              canUseWeHelp
                ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700"
                : "border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed",
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

        {/* Single services */}
        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-zinc-900">Single packages</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Choose one service you want help with.
              </p>
            </div>
            <span className="text-xs font-semibold text-zinc-500">
              {SINGLE_SERVICES.length} options
            </span>
          </div>

          {/* Search */}
          <div className="mt-4 rounded-3xl border border-zinc-200/70 bg-white/72 p-3 shadow-sm backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-800">
                <Search className="h-5 w-5" />
              </span>

              <div className="min-w-0 flex-1">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search services… (visa, SOP, CV, documents)"
                  className="w-full bg-transparent text-sm font-semibold text-zinc-900 placeholder:text-zinc-400 outline-none"
                />
              </div>

              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 text-zinc-700 transition hover:bg-white active:scale-[0.99]"
                  aria-label="Clear search"
                  title="Clear"
                >
                  <X className="h-5 w-5" />
                </button>
              ) : null}

              {/* ✅ add filter icon */}
              <span className="hidden sm:inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white/60 text-zinc-700">
                <Filter className="h-5 w-5" />
              </span>
            </div>

            {/* Chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              {["All", "Visa", "Docs", "Writing", "Test", "CV"].map((c) => (
                <Chip key={c} active={chip === c} onClick={() => setChip(c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </div>

          {/* Tiles */}
          <div className="mt-4 grid gap-3">
            {filteredSingles.length === 0 ? (
              <div className="rounded-3xl border border-zinc-200/70 bg-white/70 p-5 text-sm text-zinc-600 shadow-sm backdrop-blur">
                No results. Try a different keyword (e.g. “visa”, “SOP”, “CV”).
              </div>
            ) : (
              filteredSingles.map((s) => (
                <ServiceTile
                  key={s.title}
                  s={s}
                  disabled={!canUseWeHelp}
                  onClick={() => openSingle(s.title)}
                />
              ))
            )}
          </div>
        </div>

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
        title={modalTitle}
        subtitle={modalSubtitle}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={auth.currentUser?.email || email || ""}
        enableAttachments={enableAttachments}
        maxPdfMb={10}
      />
    </div>
  );
}
// ✅ RequestModal.jsx (FINAL COPY-PASTE — ANDROID KEYBOARD WARM-UP + TOUCH + SCROLL FIX)
// ✅ UPDATE (Back routing support):
// - Add optional prop: returnTo (string path)
// - If returnTo is set, closing the modal (X / Cancel / overlay) will navigate there.
// - If not set, it behaves exactly like before.
//
// Everything else unchanged.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { isStandalone } from "../utils/isStandalone";
import {
  clearDummyPaymentDraft,
  clearDummyPaymentState,
  createRequestDraftId,
  getDummyPaymentDraft,
  getDummyPaymentState,
  setDummyPaymentDraft,
} from "../utils/dummyPayment";

const STANDALONE = isStandalone();
const DEFAULT_PAYMENT_AMOUNT = "KES 10,000";

/* ---------------- Icons ---------------- */
function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 7l10 10M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconUser(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 12.2a4.2 4.2 0 1 0-4.2-4.2 4.2 4.2 0 0 0 4.2 4.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.5 20.2a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPhone(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8.2 4.8h2.1c.7 0 1.3.5 1.4 1.1l.6 2.6c.1.6-.2 1.2-.8 1.5l-1.4.8a11.8 11.8 0 0 0 5.1 5.1l.8-1.4c.3-.6.9-.9 1.5-.8l2.6.6c.6.1 1.1.7 1.1 1.4v2.1c0 .8-.6 1.5-1.4 1.6-8.4.8-15.1-5.9-14.3-14.3.1-.8.8-1.4 1.6-1.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconNote(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3.8h7.8L20.2 9v11.2A1.8 1.8 0 0 1 18.4 22H7A3.2 3.2 0 0 1 3.8 18.8V7A3.2 3.2 0 0 1 7 3.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14.8 3.8V9h5.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.8 13h8M7.8 16.4h6.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMail(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M5.5 7.5h13A2 2 0 0 1 20.5 9.5v8A2 2 0 0 1 18.5 19.5h-13A2 2 0 0 1 3.5 17.5v-8A2 2 0 0 1 5.5 7.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 9l7.5 5 7.5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPin(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ---------------- Helpers ---------------- */
function normalizePhone(input) {
  return String(input || "").trim();
}

function isValidEmail(input) {
  const e = String(input || "").trim();
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isPdfFile(f) {
  const name = String(f?.name || "").toLowerCase();
  const type = String(f?.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function fileToMeta(f) {
  return {
    name: String(f?.name || "file"),
    size: Number(f?.size || 0),
    type: String(f?.type || ""),
    lastModified: Number(f?.lastModified || 0),
  };
}

function normalizeFileMeta(input) {
  if (!input || typeof input !== "object") return null;
  const name = String(input?.name || "").trim();
  if (!name) return null;
  return {
    name,
    size: Number(input?.size || 0),
    type: String(input?.type || ""),
    lastModified: Number(input?.lastModified || 0),
  };
}

// ✅ Best-practice body lock for Android PWA keyboard stability
function lockBodyScrollFixed() {
  const y = window.scrollY || 0;

  const prev = {
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyWidth: document.body.style.width,
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow,
  };

  document.documentElement.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${y}px`;
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";

  return () => {
    document.documentElement.style.overflow = prev.htmlOverflow;
    document.body.style.position = prev.bodyPosition;
    document.body.style.top = prev.bodyTop;
    document.body.style.width = prev.bodyWidth;
    document.body.style.overflow = prev.bodyOverflow;

    const top = parseInt(prev.bodyTop || "0", 10);
    const restoreY = Number.isFinite(top) && top !== 0 ? -top : y;
    window.scrollTo(0, restoreY);
  };
}

// Helps Android: ensure focused input is visible within scroll container
function scrollFieldIntoView(el, scrollContainer) {
  if (!el || !scrollContainer) return;

  setTimeout(() => {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    } catch {}

    try {
      const r1 = el.getBoundingClientRect();
      const r2 = scrollContainer.getBoundingClientRect();
      const delta = r1.top - r2.top - r2.height * 0.35;
      scrollContainer.scrollTop += delta;
    } catch {}
  }, 80);
}

/**
 * ✅ Android WebView IME warm-up (one-time per session)
 * Runs only on a real user gesture (we call it from onPointerDownCapture on inputs).
 * Then refocuses the target input.
 */
function warmUpKeyboardOnceAndRefocus(targetEl) {
  try {
    if (sessionStorage.getItem("kb_warmed") === "1") return;

    const hidden = document.createElement("input");
    hidden.type = "text";
    hidden.setAttribute("aria-hidden", "true");
    hidden.style.position = "fixed";
    hidden.style.opacity = "0";
    hidden.style.height = "1px";
    hidden.style.width = "1px";
    hidden.style.left = "-1000px";
    hidden.style.top = "0";
    hidden.style.pointerEvents = "none";

    document.body.appendChild(hidden);

    try {
      hidden.focus();
    } catch {}

    setTimeout(() => {
      try {
        hidden.blur();
      } catch {}
      try {
        document.body.removeChild(hidden);
      } catch {}

      sessionStorage.setItem("kb_warmed", "1");

      if (targetEl) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try {
              targetEl.focus({ preventScroll: true });
            } catch {
              try {
                targetEl.focus();
              } catch {}
            }
          });
        });
      }
    }, 60);
  } catch {}
}

export default function RequestModal({
  open,
  onClose,
  onSubmit,
  title,
  subtitle,
  defaultName = "",
  defaultPhone = "",
  defaultEmail = "",
  onPay,
  paymentContext = null,
  paymentAmount = "",
  maxPdfMb = 10,
  enableAttachments = true,

  // ✅ NEW: optional "where to go back to when closing"
  // Example:
  //   returnTo={`/app/work/we-help?country=${encodeURIComponent(country)}`}
  returnTo,

  // Optional resume state hooks
  initialState = null,
  onStateChange,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const wasOpenRef = useRef(false);
  const lastStateEmitRef = useRef("");

  // ✅ prevents "tap causes close + blur" on Android
  const startedInsidePanelRef = useRef(false);

  // ✅ fallback: allow returnTo via query param (?returnTo=/app/...)
  const effectiveReturnTo = useMemo(() => {
    if (returnTo) return String(returnTo);
    try {
      const qs = new URLSearchParams(location.search);
      const q = qs.get("returnTo");
      return q ? String(q) : "";
    } catch {
      return "";
    }
  }, [returnTo, location.search]);

  const handleClose = useMemo(() => {
    return () => {
      if (onClose) onClose();
      if (effectiveReturnTo) {
        // If you're already on that page, this won't break; it just re-navigates.
        navigate(effectiveReturnTo, { replace: true });
      }
    };
  }, [onClose, navigate, effectiveReturnTo]);

  const queryDraftId = useMemo(() => {
    try {
      const qs = new URLSearchParams(location.search || "");
      return String(qs.get("draft") || "").trim();
    } catch {
      return "";
    }
  }, [location.search]);

  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [email, setEmail] = useState(defaultEmail);
  const [city, setCity] = useState("");
  const [note, setNote] = useState("");
  const [requestDraftId, setRequestDraftId] = useState("");

  const [pickedFiles, setPickedFiles] = useState([]);
  const [pickedFileMetas, setPickedFileMetas] = useState([]);
  const [paid, setPaid] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const resolvedPaymentAmount = useMemo(() => {
    const clean = String(paymentAmount || "").trim();
    return clean || DEFAULT_PAYMENT_AMOUNT;
  }, [paymentAmount]);

  // Seed form state before paint on each open cycle to avoid visible field blink.
  useLayoutEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      lastStateEmitRef.current = "";
      return;
    }

    // Only seed once per open-cycle to avoid field flicker while typing.
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    const seeded = initialState && typeof initialState === "object" ? initialState : null;
    const draftId = String(seeded?.requestDraftId || queryDraftId || createRequestDraftId()).trim();
    const storedDraft = getDummyPaymentDraft(draftId);
    const storedForm = storedDraft?.formState && typeof storedDraft.formState === "object"
      ? storedDraft.formState
      : storedDraft && typeof storedDraft === "object"
        ? storedDraft
        : null;
    const seededMetasRaw = Array.isArray(seeded?.fileMetas) ? seeded.fileMetas : [];
    const storedMetasRaw = Array.isArray(storedForm?.fileMetas) ? storedForm.fileMetas : [];
    const restoredMetas = (seededMetasRaw.length ? seededMetasRaw : storedMetasRaw)
      .map(normalizeFileMeta)
      .filter(Boolean);
    const storedPayment = getDummyPaymentState(draftId);
    const paidFromStorage = String(storedPayment?.status || "").toLowerCase() === "paid";

    setRequestDraftId(draftId);
    setName(seeded?.name ?? storedForm?.name ?? defaultName ?? "");
    setPhone(seeded?.phone ?? storedForm?.phone ?? defaultPhone ?? "");
    setEmail(seeded?.email ?? storedForm?.email ?? defaultEmail ?? "");
    setCity(seeded?.city ?? storedForm?.city ?? "");
    setNote(seeded?.note ?? storedForm?.note ?? "");
    setPickedFiles([]);
    setPickedFileMetas(restoredMetas);
    setPaid(Boolean(seeded?.paid || storedForm?.paid || paidFromStorage));
    setErr("");
    setLoading(false);

    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  }, [open, defaultName, defaultPhone, defaultEmail, initialState, queryDraftId]);

  useEffect(() => {
    if (!open) {
      lastStateEmitRef.current = "";
      return;
    }
    if (typeof onStateChange !== "function") return;

    const payload = {
      open: Boolean(open),
      step: paid ? "submit" : "form",
      formState: {
        name: String(name || ""),
        phone: String(phone || ""),
        email: String(email || ""),
        city: String(city || ""),
        note: String(note || ""),
        fileMetas: Array.isArray(pickedFileMetas) ? pickedFileMetas : [],
        paid: Boolean(paid),
        requestDraftId: String(requestDraftId || ""),
      },
    };

    const serialized = JSON.stringify(payload);
    if (serialized === lastStateEmitRef.current) return;

    const timer = setTimeout(() => {
      if (serialized === lastStateEmitRef.current) return;
      lastStateEmitRef.current = serialized;
      onStateChange(payload);
    }, 90);

    return () => clearTimeout(timer);
  }, [onStateChange, open, paid, name, phone, email, city, note, pickedFileMetas, requestDraftId]);

  useEffect(() => {
    if (!open) return;
    if (!requestDraftId) return;

    setDummyPaymentDraft(requestDraftId, {
      requestDraftId: String(requestDraftId || ""),
      formState: {
        name: String(name || ""),
        phone: String(phone || ""),
        email: String(email || ""),
        city: String(city || ""),
        note: String(note || ""),
        fileMetas: Array.isArray(pickedFileMetas) ? pickedFileMetas : [],
        paid: Boolean(paid),
        requestDraftId: String(requestDraftId || ""),
      },
      paymentContext: paymentContext && typeof paymentContext === "object" ? paymentContext : null,
      amount: resolvedPaymentAmount,
      updatedAt: Date.now(),
    });
  }, [
    open,
    requestDraftId,
    name,
    phone,
    email,
    city,
    note,
    pickedFileMetas,
    paid,
    paymentContext,
    resolvedPaymentAmount,
  ]);

  // ✅ lock body scroll (ANDROID SAFE)
  useEffect(() => {
    if (!open) return;
    const unlock = lockBodyScrollFixed();
    return () => unlock();
  }, [open]);

  // Hide the app bottom nav while the request modal is open.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("request-modal-open");
    return () => {
      document.body.classList.remove("request-modal-open");
    };
  }, [open]);

  // ESC close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !loading) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, handleClose]);

  const canPay = useMemo(() => {
    return name.trim().length > 0 && phone.trim().length > 0 && isValidEmail(email) && !loading;
  }, [name, phone, email, loading]);

  const canSubmit = useMemo(() => {
    return name.trim().length > 0 && phone.trim().length > 0 && isValidEmail(email) && paid && !loading;
  }, [name, phone, email, paid, loading]);

  if (!open) return null;

  const doPay = () => {
    if (!name.trim() || !phone.trim() || !String(email || "").trim()) {
      setErr("Please fill in name, phone and email first.");
      return;
    }
    if (!isValidEmail(email)) {
      setErr("Please enter a valid email address.");
      return;
    }

    const draftId = String(requestDraftId || createRequestDraftId()).trim();
    const qs = new URLSearchParams(location.search || "");
    qs.set("autoOpen", "1");
    qs.set("draft", draftId);

    const flow = String(paymentContext?.flow || "").trim().toLowerCase();
    if (flow === "wehelp") {
      const serviceName = String(paymentContext?.serviceName || "").trim();
      if (serviceName) qs.set("open", serviceName);
    }
    if (flow === "fullpackage") {
      const selectedItem = String(paymentContext?.selectedItem || "").trim();
      const fullPackageId = String(paymentContext?.fullPackageId || "").trim();
      const track = String(paymentContext?.track || "").trim().toLowerCase();
      const country = String(paymentContext?.country || "").trim();
      if (selectedItem) qs.set("item", selectedItem);
      if (fullPackageId) qs.set("fullPackageId", fullPackageId);
      if (track) qs.set("track", track);
      if (country) qs.set("country", country);
    }

    const returnTo = qs.toString() ? `${location.pathname}?${qs.toString()}` : location.pathname;
    const amountText = resolvedPaymentAmount;

    setRequestDraftId(draftId);
    setDummyPaymentDraft(draftId, {
      requestDraftId: draftId,
      formState: {
        name: String(name || ""),
        phone: String(phone || ""),
        email: String(email || ""),
        city: String(city || ""),
        note: String(note || ""),
        fileMetas: Array.isArray(pickedFileMetas) ? pickedFileMetas : [],
        paid: Boolean(paid),
        requestDraftId: draftId,
      },
      paymentContext: paymentContext && typeof paymentContext === "object" ? paymentContext : null,
      amount: amountText,
      updatedAt: Date.now(),
    });

    setErr("");
    onPay?.({
      requestDraftId: draftId,
      returnTo,
      amount: amountText,
    });

    const paymentQs = new URLSearchParams();
    paymentQs.set("draft", draftId);
    paymentQs.set("returnTo", returnTo);
    if (amountText) paymentQs.set("amount", amountText);

    navigate(`/app/dummy-payment?${paymentQs.toString()}`, {
      state: {
        requestDraftId: draftId,
        returnTo,
        amount: amountText,
        paymentContext: paymentContext && typeof paymentContext === "object" ? paymentContext : null,
        draftForm: {
          name: String(name || ""),
          phone: String(phone || ""),
          email: String(email || ""),
          city: String(city || ""),
          note: String(note || ""),
          fileMetas: Array.isArray(pickedFileMetas) ? pickedFileMetas : [],
        },
      },
    });
  };

  const submit = async () => {
    setErr("");

    const cleanName = String(name || "").trim();
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanCity = String(city || "").trim();

    if (!cleanName) return setErr("Please enter your full name.");
    if (!cleanPhone) return setErr("Please enter your phone / WhatsApp.");
    if (!cleanEmail) return setErr("Please enter your email address.");
    if (!isValidEmail(cleanEmail)) return setErr("Please enter a valid email address.");
    if (!paid) return setErr("Please press Pay first to unlock sending.");

    let fileMetas = [];
    if (enableAttachments) {
      const maxBytes = maxPdfMb * 1024 * 1024;

      const badType = pickedFiles.find((f) => !isPdfFile(f));
      if (badType) return setErr("Only PDF files are allowed for now.");

      const tooBig = pickedFiles.find((f) => (f?.size || 0) > maxBytes);
      if (tooBig) return setErr(`One file is too large. Max size is ${maxPdfMb}MB.`);

      const liveMetas = Array.isArray(pickedFiles) ? pickedFiles.map(fileToMeta) : [];
      fileMetas = liveMetas.length ? liveMetas : (Array.isArray(pickedFileMetas) ? pickedFileMetas : []);
    } else {
      if (pickedFiles.length) setPickedFiles([]);
      if (pickedFileMetas.length) setPickedFileMetas([]);
    }

    setLoading(true);
    try {
      await onSubmit({
        name: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
        city: cleanCity,
        note: String(note || "").trim(),

        dummyFiles: enableAttachments ? pickedFiles : [],

        requestUploadMeta:
          enableAttachments && fileMetas.length > 0
            ? {
                count: fileMetas.length,
                files: fileMetas,
                note: "User selected PDF files (metadata only).",
              }
            : null,

        paid: true,
        paymentMeta: { status: "paid_gate_passed", method: "dummy", paidAt: Date.now() },
      });

      if (requestDraftId) {
        clearDummyPaymentState(requestDraftId);
        clearDummyPaymentDraft(requestDraftId);
      }
    } catch (e) {
      setErr(e?.message || "Failed to submit. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // ✅ lighter styles in standalone (no blur, no heavy shadows)
  const overlayCls = STANDALONE ? "bg-black/40" : "bg-black/35 backdrop-blur-[2px]";
  const panelCls = STANDALONE
    ? "w-full max-w-md rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 dark:border-zinc-800 dark:bg-zinc-950 flex flex-col motion-modal-panel anim-in-pop"
    : "w-full max-w-md rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/75 dark:bg-zinc-900/60 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/75 flex flex-col motion-modal-panel anim-in-pop";

  const ctaWrapCls = STANDALONE
    ? "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 dark:border-zinc-800 dark:bg-zinc-950 px-3 py-3"
    : "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/60 shadow-lg backdrop-blur px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/70";

  const fieldWrap =
    "mt-2 mx-0.5 flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3.5" +
    "transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100" +
    "dark:border-zinc-800 dark:bg-zinc-950";

  const inputBase =
    "w-full bg-transparent text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100 t-fade";

  const focusProps = {
    onFocus: (e) => scrollFieldIntoView(e.currentTarget, scrollRef.current),
    onPointerDownCapture: (e) => warmUpKeyboardOnceAndRefocus(e.currentTarget),
  };

  const textareaFocusProps = {
    onFocus: (e) => scrollFieldIntoView(e.currentTarget, scrollRef.current),
    onPointerDownCapture: (e) => warmUpKeyboardOnceAndRefocus(e.currentTarget),
  };

  return (
    <div
      className="fixed inset-0 z-50"
      aria-modal="true"
      role="dialog"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* ✅ Overlay: close ONLY if pointer started on overlay (not inside modal) */}
      <div
        className={`absolute inset-0 ${overlayCls} motion-modal-backdrop anim-in-fade`}
        aria-hidden="true"
        onPointerDown={() => {
          if (startedInsidePanelRef.current) return;
          if (!loading) handleClose();
        }}
        style={{ touchAction: "manipulation" }}
      />

      {/* panel wrapper */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div
          ref={panelRef}
          className={panelCls}
          style={{ height: "79vh", maxHeight: "79vh", overflow: "hidden" }}
          onPointerDown={(e) => {
            startedInsidePanelRef.current = true;
            e.stopPropagation();
          }}
          onPointerUp={() => {
            setTimeout(() => {
              startedInsidePanelRef.current = false;
            }, 0);
          }}
          onPointerCancel={() => {
            startedInsidePanelRef.current = false;
          }}
          onClick={(e) => e.stopPropagation()}
        >

          {/* Header */}
          <div className="px-5 pt-5 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {title}
                </h2>
                {subtitle ? (
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 p-2 text-zinc-700 dark:text-zinc-300 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
                aria-label="Close"
                title="Close"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Scroll area */}
          <div className="px-5 pt-4 flex-1 min-h-0">
            <div
              ref={scrollRef}
              className="h-full pb-4 overflow-y-auto"
              style={{
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
                touchAction: "auto",
              }}
            >
              <div className="grid gap-4">
                {/* Name */}
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Full name
                  </label>
                  <div className={fieldWrap}>
                    <IconUser className="h-5 w-5 text-zinc-500" />
                    <input
                      className={inputBase}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      disabled={loading}
                      autoComplete="name"
                      enterKeyHint="next"
                      autoCapitalize="words"
                      autoCorrect="on"
                      spellCheck={false}
                      {...focusProps}
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Phone / WhatsApp
                  </label>
                  <div className={fieldWrap}>
                    <IconPhone className="h-5 w-5 text-zinc-500" />
                    <input
                      className={inputBase}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+2547..."
                      disabled={loading}
                      inputMode="tel"
                      autoComplete="tel"
                      enterKeyHint="next"
                      {...focusProps}
                    />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Email <span className="text-rose-600">*</span>
                  </label>
                  <div className={fieldWrap}>
                    <IconMail className="h-5 w-5 text-zinc-500" />
                    <input
                      className={inputBase}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      disabled={loading}
                      inputMode="email"
                      autoComplete="email"
                      enterKeyHint="next"
                      {...focusProps}
                    />
                  </div>

                  {String(email || "").trim().length > 0 && !isValidEmail(email) ? (
                    <div className="mt-1 text-xs text-rose-600">
                      Enter a valid email (example: you@gmail.com)
                    </div>
                  ) : null}
                </div>

                {/* City */}
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    City / Town (optional)
                  </label>
                  <div className={fieldWrap}>
                    <IconPin className="h-5 w-5 text-zinc-500" />
                    <input
                      className={inputBase}
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Nairobi..."
                      disabled={loading}
                      enterKeyHint="next"
                      {...focusProps}
                    />
                  </div>
                </div>

                {/* Upload PDFs */}
                {enableAttachments ? (
                  <div>
                    <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Upload documents (optional)
                    </label>
                    <div className="mt-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950">
                      <input
                        type="file"
                        multiple
                        accept="application/pdf"
                        disabled={loading}
                        onChange={(e) => {
                          const arr = Array.from(e.target.files || []);
                          setPickedFiles(arr);
                          setPickedFileMetas(arr.map(fileToMeta));
                        }}
                        className="w-full text-sm text-zinc-900 dark:text-zinc-100"
                      />

                      <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        PDFs only. Max {maxPdfMb}MB each.
                      </div>

                      {pickedFileMetas.length ? (
                        <div className="mt-3 grid gap-2">
                          {pickedFileMetas.map((f, idx) => (
                            <div
                              key={`${f.name}-${idx}`}
                              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
                            >
                              {f.name} • {Math.round((f.size || 0) / 1024)} KB
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {/* Note */}
                <div>
                  <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Note (optional)
                  </label>
                  <div className={fieldWrap + " items-start"}>
                    <IconNote className="h-5 w-5 text-zinc-500 mt-0.5" />
                    <textarea
                      className={inputBase + " min-h-[112px] resize-none"}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Any extra details to help us assist you..."
                      disabled={loading}
                      {...textareaFocusProps}
                    />
                  </div>
                </div>

                {/* Error */}
                {err ? (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                    {err}
                  </div>
                ) : null}
              </div>
                <div className="pt-2">
                  <div className={ctaWrapCls}>
                    <div className="grid gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={doPay}
                          disabled={!canPay || loading || paid}
                          className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-60 ${
                            paid
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                          }`}
                        >
                          {paid ? "Paid ✓" : "Pay"}
                        </button>

                        <button
                          type="button"
                          onClick={submit}
                          disabled={!canSubmit}
                          className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                        >
                          {loading ? "Sending..." : "Send request"}
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleClose}
                        disabled={loading}
                        className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                      >
                        Cancel
                      </button>

                      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                        You must <span className="font-semibold">Pay</span> before sending an application.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
}


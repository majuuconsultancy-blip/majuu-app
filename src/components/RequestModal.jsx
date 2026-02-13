// ✅ RequestModal.jsx (COPY-PASTE)
// Same logic as your current modal ✅
// + Sticky CTA (Pay / Send / Cancel) always visible ✅
// + Apple-like momentum scroll on mobile ✅
// + Safer scroll behavior: body lock, overscroll containment ✅
// + enableAttachments prop: hide upload unless enabled ✅
// ✅ Email is now REQUIRED + validated ✅
// ✅ Supports auto-fill via defaultEmail prop ✅

import { useEffect, useMemo, useRef, useState } from "react";

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

function normalizePhone(input) {
  return String(input || "").trim();
}

// ✅ lightweight email validation (good enough for UI + firebase)
function isValidEmail(input) {
  const e = String(input || "").trim();
  if (!e) return false;
  // very common safe pattern (not overly strict)
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
  maxPdfMb = 10,
  enableAttachments = true, // ✅ hide upload section unless enabled
}) {
  const panelRef = useRef(null);
  const scrollRef = useRef(null);

  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [email, setEmail] = useState(defaultEmail);
  const [city, setCity] = useState("");
  const [note, setNote] = useState("");

  const [pickedFiles, setPickedFiles] = useState([]); // File[]
  const [paid, setPaid] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setName(defaultName || "");
      setPhone(defaultPhone || "");
      setEmail(defaultEmail || "");
      setCity("");
      setNote("");
      setPickedFiles([]);
      setPaid(false);
      setErr("");
      setLoading(false);

      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      });
    }
  }, [open, defaultName, defaultPhone, defaultEmail]);

  // ✅ Lock background scroll while modal open
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0)
      document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  // ESC to close (when not loading)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !loading) onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  // ✅ Email required now (so pay gate also requires it)
  const canPay = useMemo(() => {
    return (
      name.trim().length > 0 &&
      phone.trim().length > 0 &&
      isValidEmail(email) &&
      !loading
    );
  }, [name, phone, email, loading]);

  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 &&
      phone.trim().length > 0 &&
      isValidEmail(email) &&
      paid &&
      !loading
    );
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
    setErr("");
    setPaid(true);
    onPay?.();
  };

  const submit = async () => {
    setErr("");

    const cleanName = String(name || "").trim();
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanCity = String(city || "").trim();

    if (!cleanName) return setErr("Please enter your full name.");
    if (!cleanPhone) return setErr("Please enter your phone / WhatsApp.");

    // ✅ Email required
    if (!cleanEmail) return setErr("Please enter your email address.");
    if (!isValidEmail(cleanEmail))
      return setErr("Please enter a valid email address.");

    if (!paid) return setErr("Please press Pay first to unlock sending.");

    // ✅ only validate files if attachments enabled
    let fileMetas = [];
    if (enableAttachments) {
      const maxBytes = maxPdfMb * 1024 * 1024;

      const badType = pickedFiles.find((f) => !isPdfFile(f));
      if (badType) return setErr("Only PDF files are allowed for now.");

      const tooBig = pickedFiles.find((f) => (f?.size || 0) > maxBytes);
      if (tooBig)
        return setErr(`One file is too large. Max size is ${maxPdfMb}MB.`);

      fileMetas = Array.isArray(pickedFiles)
        ? pickedFiles.map(fileToMeta)
        : [];
    } else {
      if (pickedFiles.length) setPickedFiles([]);
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
        paymentMeta: {
          status: "paid_gate_passed",
          method: "dummy",
          paidAt: Date.now(),
        },
      });
    } catch (e) {
      setErr(e?.message || "Failed to submit. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const fieldWrap =
    "mt-2 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2.5 " +
    "focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100";
  const inputBase =
    "w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";

  return (
    <div
      className="fixed inset-0 z-50"
      aria-modal="true"
      role="dialog"
      style={{ overscrollBehavior: "contain" }}
    >
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        style={{ touchAction: "none" }}
        onMouseDown={() => {
          if (!loading) onClose?.();
        }}
        onTouchStart={() => {
          if (!loading) onClose?.();
        }}
      />

      {/* panel wrapper */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div
          ref={panelRef}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white/75 shadow-xl backdrop-blur flex flex-col"
          style={{
            height: "75vh",
            maxHeight: "75vh",
          }}
        >
          {/* Header */}
          <div className="px-5 pt-5 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                  {title}
                </h2>
                {subtitle ? (
                  <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="shrink-0 rounded-xl border border-zinc-200 bg-white/60 p-2 text-zinc-700 transition hover:bg-white disabled:opacity-60"
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
              className="h-full pb-[152px] md:pb-[140px] overflow-y-auto"
              style={{
                WebkitOverflowScrolling: "touch",
                overscrollBehavior: "contain",
                touchAction: "pan-y",
              }}
            >
              <div className="grid gap-4">
                {/* Name */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">
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
                    />
                  </div>
                </div>

                {/* Phone */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">
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
                    />
                  </div>
                </div>

                {/* ✅ Email (required) */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">
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
                    />
                  </div>

                  {/* tiny inline hint (only when user typed something invalid) */}
                  {String(email || "").trim().length > 0 &&
                  !isValidEmail(email) ? (
                    <div className="mt-1 text-xs text-rose-600">
                      Enter a valid email (example: you@gmail.com)
                    </div>
                  ) : null}
                </div>

                {/* City */}
                <div>
                  <label className="text-sm font-medium text-zinc-800">
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
                    />
                  </div>
                </div>

                {/* Upload PDFs — only if enabled */}
                {enableAttachments ? (
                  <div>
                    <label className="text-sm font-medium text-zinc-800">
                      Upload documents (optional)
                    </label>
                    <div className="mt-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-3">
                      <input
                        type="file"
                        multiple
                        accept="application/pdf"
                        disabled={loading}
                        onChange={(e) => {
                          const arr = Array.from(e.target.files || []);
                          setPickedFiles(arr);
                        }}
                        className="w-full text-sm text-zinc-900"
                      />

                      <div className="mt-2 text-xs text-zinc-500">
                        PDFs only. Max {maxPdfMb}MB each.
                      </div>

                      {pickedFiles.length ? (
                        <div className="mt-3 grid gap-2">
                          {pickedFiles.map((f, idx) => (
                            <div
                              key={`${f.name}-${idx}`}
                              className="rounded-xl border border-zinc-200 bg-white/60 px-3 py-2 text-xs text-zinc-700"
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
                  <label className="text-sm font-medium text-zinc-800">
                    Note (optional)
                  </label>
                  <div className={fieldWrap + " items-start"}>
                    <IconNote className="h-5 w-5 text-zinc-500 mt-0.5" />
                    <textarea
                      className={inputBase + " min-h-[96px] resize-none"}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Any extra details to help us assist you..."
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Error */}
                {err ? (
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/70 px-3 py-2 text-sm text-rose-700">
                    {err}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Sticky CTA */}
          <div className="sticky bottom-0 px-5 pb-5 pt-3 shrink-0">
            <div className="pointer-events-none -mt-6 h-6 w-full bg-gradient-to-b from-transparent to-white/80 backdrop-blur-[2px]" />

            <div className="rounded-2xl border border-zinc-200 bg-white/80 shadow-lg backdrop-blur px-3 py-3">
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={doPay}
                  disabled={!canPay || loading || paid}
                  className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
                    paid
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-zinc-200 bg-white/60 text-zinc-900 hover:bg-white"
                  }`}
                >
                  {paid ? "Payment confirmed ✓" : "Pay to unlock request"}
                </button>

                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? "Sending..." : "Send request"}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="w-full rounded-xl border border-zinc-200 bg-white/40 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                >
                  Cancel
                </button>

                <p className="text-center text-xs text-zinc-500">
                  You must <span className="font-semibold">Pay</span>{" "}
                  before sending an application.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
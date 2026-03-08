import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import {
  buildFullPackageHubPath,
  createFullPackageDraft,
  markFullPackageDepositPaid,
  normalizeFullPackageItems,
  syncFullPackageSelection,
} from "../services/fullpackageservice";
import {
  clearDummyPaymentDraft,
  clearDummyPaymentState,
  createRequestDraftId,
  getDummyPaymentDraft,
  getDummyPaymentState,
  setDummyPaymentDraft,
} from "../utils/dummyPayment";

const CHECKLIST = [
  "Passport",
  "SOP / Motivation Letter",
  "IELTS",
  "CV / Resume",
  "Offer Letter",
  "Proof of Funds",
];

const BASE_PRICE = 9999;
const MIN_PRICE = 3999;
const ITEM_CREDITS = {
  Passport: 1700,
  "SOP / Motivation Letter": 1400,
  IELTS: 2200,
  "CV / Resume": 900,
  "Offer Letter": 1600,
  "Proof of Funds": 1400,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatKES(n) {
  const x = Math.round(Number(n) || 0);
  return `KES ${x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function lockBodyScrollFixed() {
  const y = window.scrollY || 0;
  const prev = {
    bodyPosition: document.body.style.position,
    bodyTop: document.body.style.top,
    bodyLeft: document.body.style.left,
    bodyRight: document.body.style.right,
    bodyWidth: document.body.style.width,
    bodyOverflow: document.body.style.overflow,
    htmlOverflow: document.documentElement.style.overflow,
  };

  document.documentElement.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${y}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";

  return () => {
    document.documentElement.style.overflow = prev.htmlOverflow;
    document.body.style.position = prev.bodyPosition;
    document.body.style.top = prev.bodyTop;
    document.body.style.left = prev.bodyLeft;
    document.body.style.right = prev.bodyRight;
    document.body.style.width = prev.bodyWidth;
    document.body.style.overflow = prev.bodyOverflow;
    const top = parseInt(prev.bodyTop || "0", 10);
    const restoreY = Number.isFinite(top) && top !== 0 ? -top : y;
    window.scrollTo(0, restoreY);
  };
}

function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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

function IconShieldCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3.5 19 6.7v6.5c0 4.3-3 8.2-7 9.3-4-1.1-7-5-7-9.3V6.7L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m9.3 12.4 1.8 1.8 3.8-4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FullPackageDiagnosticModal({ open, onClose, track, country }) {
  const navigate = useNavigate();
  const location = useLocation();
  const listScrollRef = useRef(null);
  const resumeApplyRef = useRef("");

  const [checked, setChecked] = useState({});
  const [pricePulse, setPricePulse] = useState(false);
  const [depositPaid, setDepositPaid] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [depositPaymentMeta, setDepositPaymentMeta] = useState(null);
  const [depositDraftId, setDepositDraftId] = useState("");
  const [fullPackageId, setFullPackageId] = useState("");

  useEffect(() => {
    if (!open) return;
    resumeApplyRef.current = "";
    setChecked({});
    setPricePulse(false);
    setDepositPaid(false);
    setDepositLoading(false);
    setDepositError("");
    setDepositPaymentMeta(null);
    setDepositDraftId("");
    setFullPackageId("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unlock = lockBodyScrollFixed();
    return () => unlock();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    try {
      window.history.pushState({ __majuu_fdiag_backtrap: true }, "", window.location.href);
    } catch (error) {
      void error;
    }
    const onPopState = () => {
      onClose?.();
      try {
        window.history.pushState({ __majuu_fdiag_backtrap: true }, "", window.location.href);
      } catch (error) {
        void error;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const total = CHECKLIST.length;
  const haveCount = useMemo(
    () => CHECKLIST.reduce((a, i) => a + (checked[i] ? 1 : 0), 0),
    [checked]
  );
  const missingItems = useMemo(() => CHECKLIST.filter((i) => !checked[i]), [checked]);
  const readiness = useMemo(
    () => clamp(Math.round((haveCount / total) * 100), 0, 100),
    [haveCount, total]
  );
  const readinessLabel = useMemo(() => {
    if (readiness < 35) return { text: "Low", cls: "bg-rose-50 border-rose-200 text-rose-800" };
    if (readiness < 70) return { text: "Good", cls: "bg-amber-50 border-amber-200 text-amber-900" };
    return { text: "Strong", cls: "bg-emerald-50 border-emerald-200 text-emerald-900" };
  }, [readiness]);

  const discount = useMemo(
    () =>
      CHECKLIST.reduce(
        (acc, item) => acc + (checked[item] ? ITEM_CREDITS[item] || 0 : 0),
        0
      ),
    [checked]
  );
  const livePrice = useMemo(() => clamp(BASE_PRICE - discount, MIN_PRICE, BASE_PRICE), [discount]);
  const saved = useMemo(() => clamp(BASE_PRICE - livePrice, 0, BASE_PRICE), [livePrice]);
  const saveText = saved > 0 ? `Save ${formatKES(saved)}` : "Best value";
  const depositAmount = useMemo(
    () => clamp(Math.round(livePrice * 0.3), 1500, 3500),
    [livePrice]
  );

  useEffect(() => {
    if (!open) return;
    setPricePulse(true);
    const t = setTimeout(() => setPricePulse(false), 180);
    return () => clearTimeout(t);
  }, [livePrice, open]);

  const isCountryValid = Boolean(country && country !== "Not selected");
  const recommended = missingItems.length >= 3;
  const canPayDeposit = isCountryValid && recommended && !depositLoading;
  const canProceed = canPayDeposit && depositPaid && Boolean(fullPackageId);

  const helperText = !isCountryValid
    ? "Pick a country first."
    : recommended
      ? "Great fit for 3+ missing items."
      : "Best when 3+ items are missing.";

  useEffect(() => {
    if (!open) return;

    const resumeDeposit = location.state?.resumeWeHelp?.fullPackage?.deposit;
    const queryDraftId = String(
      new URLSearchParams(location.search || "").get("fpDraft") || ""
    ).trim();
    const stateDraftId = String(resumeDeposit?.requestDraftId || "").trim();
    const draftId = stateDraftId || queryDraftId;
    if (!draftId) return;
    if (resumeApplyRef.current === draftId) return;
    resumeApplyRef.current = draftId;
    queueMicrotask(() => setDepositDraftId(draftId));

    const storedDraft = getDummyPaymentDraft(draftId);
    const storedPayment = getDummyPaymentState(draftId);
    const context =
      resumeDeposit && typeof resumeDeposit === "object"
        ? resumeDeposit
        : storedDraft?.paymentContext || {};

    const selectedItems = normalizeFullPackageItems(context?.selectedItems || []);
    if (selectedItems.length > 0) {
      const set = new Set(selectedItems);
      const restoredChecked = {};
      for (const item of CHECKLIST) restoredChecked[item] = !set.has(item);
      queueMicrotask(() => setChecked(restoredChecked));
    }

    const ctxFullPackageId = String(context?.fullPackageId || "").trim();
    if (ctxFullPackageId) queueMicrotask(() => setFullPackageId(ctxFullPackageId));

    const status = String(storedPayment?.status || "").trim().toLowerCase();
    const paid = status === "paid" || status === "confirmed";
    if (!paid || !ctxFullPackageId) return;

    const paymentMeta = {
      status: "paid",
      method: String(storedPayment?.method || "dummy"),
      paidAt: Number(storedPayment?.paidAt || storedPayment?.confirmedAt || Date.now()),
      amount: Number(context?.depositAmount || depositAmount),
      currency: "KES",
      ref: String(storedPayment?.ref || storedPayment?.reference || ""),
    };

    setDepositLoading(true);
    setDepositError("");
    markFullPackageDepositPaid({
      fullPackageId: ctxFullPackageId,
      selectedItems: selectedItems.length ? selectedItems : missingItems,
      depositAmount: Number(context?.depositAmount || depositAmount),
      depositPaymentMeta: paymentMeta,
    })
      .then(() => {
        setDepositPaid(true);
        setDepositPaymentMeta(paymentMeta);
      })
      .catch((error) => {
        if (String(error?.code || "").toLowerCase().includes("permission-denied")) {
          setDepositError(
            "Firestore rules are blocking full package updates. Please allow fullPackages create/update for the signed-in owner."
          );
        } else {
          setDepositError(error?.message || "Failed to confirm deposit payment.");
        }
      })
      .finally(() => setDepositLoading(false));
  }, [open, location.state, location.search, depositAmount, missingItems]);

  const handlePayDeposit = async () => {
    if (!canPayDeposit) return;
    const user = auth.currentUser;
    if (!user?.uid) {
      setDepositError("Please sign in again before paying deposit.");
      return;
    }

    setDepositLoading(true);
    setDepositError("");
    try {
      let id = fullPackageId;
      if (!id) {
        id = await createFullPackageDraft({
          uid: user.uid,
          email: user.email || "",
          track,
          country,
          selectedItems: missingItems,
          depositAmount,
        });
        setFullPackageId(id);
      } else {
        await syncFullPackageSelection({ fullPackageId: id, selectedItems: missingItems });
      }

      const draftId = createRequestDraftId();
      const paymentContext = {
        flow: "fullPackageDeposit",
        track: String(track || "").trim().toLowerCase(),
        country: String(country || "").trim(),
        fullPackageId: id,
        selectedItems: missingItems,
        depositAmount,
      };
      const amountText = formatKES(depositAmount);

      setDepositDraftId(draftId);
      setDummyPaymentDraft(draftId, {
        requestDraftId: draftId,
        paymentContext,
        amount: amountText,
        updatedAt: Date.now(),
      });

      const returnQS = new URLSearchParams(location.search || "");
      returnQS.set("fpDraft", draftId);
      const returnTo = `${location.pathname}?${returnQS.toString()}`;

      const paymentQS = new URLSearchParams();
      paymentQS.set("draft", draftId);
      paymentQS.set("returnTo", returnTo);
      paymentQS.set("amount", amountText);

      navigate(`/app/dummy-payment?${paymentQS.toString()}`, {
        state: { requestDraftId: draftId, returnTo, amount: amountText, paymentContext },
      });
    } catch (error) {
      if (String(error?.code || "").toLowerCase().includes("permission-denied")) {
        setDepositError(
          "Firestore rules are blocking full package creation. Please allow fullPackages create for signed-in users."
        );
      } else {
        setDepositError(error?.message || "Failed to start deposit payment.");
      }
    } finally {
      setDepositLoading(false);
    }
  };

  const handleProceed = async () => {
    if (!canProceed) return;
    const hubPath = buildFullPackageHubPath({ fullPackageId, track });
    if (!hubPath) return;

    try {
      await syncFullPackageSelection({ fullPackageId, selectedItems: missingItems });
    } catch (error) {
      setDepositError(error?.message || "Failed to sync selected items.");
      return;
    }

    const qs = new URLSearchParams();
    qs.set("track", String(track || "").trim());
    qs.set("country", String(country || "").trim());
    qs.set("fullPackageId", fullPackageId);

    navigate(`${hubPath}&${qs.toString()}`, {
      state: {
        fullPackageId,
        missingItems,
        depositPaid: true,
        depositPaymentMeta: depositPaymentMeta || null,
      },
    });

    if (depositDraftId) {
      clearDummyPaymentState(depositDraftId);
      clearDummyPaymentDraft(depositDraftId);
    }
    onClose?.();
  };

  const toggle = (item) => {
    const el = listScrollRef.current;
    const top = el ? el.scrollTop : 0;
    setChecked((p) => ({ ...p, [item]: !p[item] }));

    queueMicrotask(() => {
      const el2 = listScrollRef.current;
      if (el2) el2.scrollTop = top;
      requestAnimationFrame(() => {
        const el3 = listScrollRef.current;
        if (el3) el3.scrollTop = top;
      });
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" onClick={(e) => e.target === e.currentTarget && onClose?.()} role="presentation">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md h-[82vh] max-h-[82vh] rounded-[22px] border border-white/40 bg-white/55 shadow-[0_12px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl ring-1 ring-white/20 flex flex-col overflow-hidden">
        <div className="shrink-0 border-b border-white/25 bg-white/45 px-5 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-emerald-900/85">Full package diagnostic</div>
              <h2 className="mt-0.5 text-[16px] font-semibold tracking-tight text-zinc-900">Let us understand where you are</h2>
              <p className="mt-0.5 text-[12px] text-zinc-600">Tick what you already have.</p>
            </div>
            <button onClick={onClose} className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/35 bg-white/55 text-zinc-700 hover:bg-white/70" aria-label="Close" type="button">
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-white/20 bg-white/40 px-5 py-2">
          <div className="rounded-3xl border border-white/35 bg-white/45 px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10.5px] font-semibold text-zinc-600">Price</div>
                <div className={["mt-0.5 text-[18px] font-semibold text-zinc-900 tabular-nums leading-none", pricePulse ? "scale-[1.02]" : "scale-100", "transition-transform duration-150 ease-out"].join(" ")}>
                  {formatKES(livePrice)}
                </div>
                <div className="mt-0.5 text-[10.5px] font-semibold text-emerald-900/70">{saveText}</div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/60 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-900">
                <IconShieldCheck className="h-4 w-4" />
                Best
              </span>
            </div>
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-semibold text-zinc-900">Readiness {readiness}%</div>
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] font-semibold text-zinc-500">{haveCount}/{total}</span>
                  <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold", readinessLabel.cls].join(" ")}>{readinessLabel.text}</span>
                </div>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200/70">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${readiness}%` }} />
              </div>
              <div className="mt-1 text-[10.5px] text-zinc-600 truncate">{helperText}</div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 px-5 pt-3 pb-4">
          <div ref={listScrollRef} className="h-full overflow-y-auto overscroll-contain">
            <div className="grid gap-3">
              {CHECKLIST.map((item) => {
                const isOn = !!checked[item];
                const credit = ITEM_CREDITS[item] || 0;
                return (
                  <button key={item} type="button" aria-pressed={isOn} onClick={() => toggle(item)} className={["w-full text-left rounded-3xl border px-4 py-3 transition active:scale-[0.99] shadow-[0_6px_16px_rgba(0,0,0,0.05)] min-h-[78px]", isOn ? "border-emerald-200 bg-white/55" : "border-white/35 bg-white/40 hover:bg-white/50 hover:border-emerald-200/60"].join(" ")}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-3">
                        <span className={["inline-flex h-9 w-9 items-center justify-center rounded-2xl border", isOn ? "border-emerald-200 bg-emerald-50/60 text-emerald-800" : "border-white/35 bg-white/45 text-zinc-700"].join(" ")}>
                          {isOn ? <IconCheck className="h-5 w-5" /> : <span className="h-2 w-2 rounded-full bg-zinc-300" />}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-900">{item}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">Tap to {isOn ? "undo" : "mark ready"}</div>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
                        -{formatKES(credit)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-3xl border border-white/35 bg-white/45 p-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-3 py-3">
                <div className="text-sm font-semibold text-emerald-900">Deposit required to unlock your Full Package</div>
                <div className="mt-1 text-xs text-emerald-800">Pay a refundable onboarding deposit before entering your full package hub.</div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">Deposit: {formatKES(depositAmount)}</div>
                <button type="button" onClick={handlePayDeposit} disabled={!canPayDeposit || depositPaid || depositLoading} className={["mt-3 w-full rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-[0.99]", depositPaid ? "border-emerald-200 bg-emerald-600 text-white cursor-default" : canPayDeposit ? "border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-100" : "border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed"].join(" ")}>
                  {depositPaid ? "Deposit Paid" : depositLoading ? "Processing..." : "Pay Deposit"}
                </button>
                {depositError ? <div className="mt-2 rounded-xl border border-rose-100 bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{depositError}</div> : null}
              </div>

              <button onClick={handleProceed} disabled={!canProceed} className={["mt-3 w-full rounded-2xl border px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99]", canProceed ? "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700" : "border-white/30 bg-white/30 text-zinc-400 cursor-not-allowed"].join(" ")} type="button">
                Continue to Full Package
              </button>

              <button onClick={onClose} className="mt-2.5 w-full rounded-2xl border border-white/35 bg-white/45 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-white/60" type="button">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


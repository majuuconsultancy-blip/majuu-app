import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listFullPackageItemCatalogByTrack } from "../constants/requestCatalog";
import { auth } from "../firebase";
import { useFullPackagePricingList } from "../hooks/useRequestPricing";
import {
  buildFullPackageHubPath,
  createFullPackageDraft,
  markFullPackageUnlockPaid,
  normalizeFullPackageItems,
  syncFullPackageSelection,
} from "../services/fullpackageservice";
import { formatPricingMoney } from "../services/pricingservice";
import {
  clearDummyPaymentDraft,
  clearDummyPaymentState,
  createRequestDraftId,
  getDummyPaymentDraft,
  getDummyPaymentState,
  setDummyPaymentDraft,
} from "../utils/dummyPayment";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function toFallbackChecklistRows(track, country) {
  return listFullPackageItemCatalogByTrack(track).map((item) => ({
    pricingKey: "",
    scope: "full_package_item",
    requestType: "full",
    track: String(track || "").trim().toLowerCase(),
    country: String(country || "").trim(),
    serviceName: item.serviceName,
    label: item.label,
    note: item.note,
    tag: item.tag,
    amount: Number(item.defaultAmount || 0),
    defaultAmount: Number(item.defaultAmount || 0),
    currency: "KES",
    sortOrder: Number(item.sortOrder || 0),
  }));
}

function buildItemListKey(items) {
  return normalizeFullPackageItems(items).slice().sort().join("||");
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
  const normalizedTrack = String(track || "").trim().toLowerCase();
  const normalizedCountry = String(country || "").trim();

  const [checked, setChecked] = useState({});
  const [pricePulse, setPricePulse] = useState(false);
  const [depositPaid, setDepositPaid] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [depositError, setDepositError] = useState("");
  const [depositPaymentMeta, setDepositPaymentMeta] = useState(null);
  const [depositDraftId, setDepositDraftId] = useState("");
  const [fullPackageId, setFullPackageId] = useState("");
  const [paidSelectionKey, setPaidSelectionKey] = useState("");
  const [paidGateAmount, setPaidGateAmount] = useState(0);
  const {
    rows: livePricingRows,
    loading: pricingLoading,
    error: pricingError,
  } = useFullPackagePricingList({
    track: normalizedTrack,
    country: normalizedCountry,
  });

  const checklistRows = useMemo(() => {
    if (livePricingRows.length) return livePricingRows;
    return toFallbackChecklistRows(normalizedTrack, normalizedCountry);
  }, [livePricingRows, normalizedCountry, normalizedTrack]);

  const checklistItemNames = useMemo(
    () => checklistRows.map((row) => row.serviceName).filter(Boolean),
    [checklistRows]
  );

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
    setPaidSelectionKey("");
    setPaidGateAmount(0);
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

  const total = checklistRows.length;
  const haveCount = useMemo(
    () => checklistItemNames.reduce((a, item) => a + (checked[item] ? 1 : 0), 0),
    [checklistItemNames, checked]
  );
  const missingRows = useMemo(
    () => checklistRows.filter((row) => !checked[row.serviceName]),
    [checklistRows, checked]
  );
  const missingItems = useMemo(
    () => missingRows.map((row) => row.serviceName),
    [missingRows]
  );
  const missingItemsKey = useMemo(() => buildItemListKey(missingItems), [missingItems]);
  const readiness = useMemo(
    () => (total > 0 ? clamp(Math.round((haveCount / total) * 100), 0, 100) : 0),
    [haveCount, total]
  );
  const readinessLabel = useMemo(() => {
    if (readiness < 35) return { text: "Low", cls: "bg-rose-50 border-rose-200 text-rose-800" };
    if (readiness < 70) return { text: "Good", cls: "bg-amber-50 border-amber-200 text-amber-900" };
    return { text: "Strong", cls: "bg-emerald-50 border-emerald-200 text-emerald-900" };
  }, [readiness]);

  const totalPrice = useMemo(
    () =>
      checklistRows.reduce((acc, row) => acc + Math.max(0, Number(row.amount || 0)), 0),
    [checklistRows]
  );
  const livePrice = useMemo(
    () => missingRows.reduce((acc, row) => acc + Math.max(0, Number(row.amount || 0)), 0),
    [missingRows]
  );
  const saved = useMemo(() => Math.max(0, totalPrice - livePrice), [livePrice, totalPrice]);
  const saveText = saved > 0 ? `Saved ${formatPricingMoney(saved, "KES")}` : "Live package total";
  const gateAmount = livePrice;

  useEffect(() => {
    if (!open) return;
    setPricePulse(true);
    const t = setTimeout(() => setPricePulse(false), 180);
    return () => clearTimeout(t);
  }, [livePrice, open]);

  const isCountryValid = Boolean(normalizedCountry && normalizedCountry !== "Not selected");
  const canPayDeposit = isCountryValid && gateAmount > 0 && !depositLoading;
  const isPaidForCurrentSelection =
    gateAmount <= 0 ||
    (depositPaid && paidGateAmount === gateAmount && paidSelectionKey === missingItemsKey);
  const canProceed =
    isCountryValid &&
    !depositLoading &&
    (gateAmount <= 0 ? true : isPaidForCurrentSelection) &&
    (gateAmount <= 0 ? true : Boolean(fullPackageId));

  const helperText = !isCountryValid
    ? "Pick a country first to load the exact package price."
    : gateAmount <= 0
      ? "Everything is already covered."
      : `${missingItems.length} item${missingItems.length === 1 ? "" : "s"} remaining in your package.`;

  useEffect(() => {
    if (!open) return;

    const resumeDeposit =
      location.state?.resumeWeHelp?.fullPackage?.unlock ||
      location.state?.resumeWeHelp?.fullPackage?.deposit;
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
      for (const item of checklistItemNames) restoredChecked[item] = !set.has(item);
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
      amount: Number(context?.unlockAmount || context?.depositAmount || gateAmount),
      currency: "KES",
      ref: String(storedPayment?.ref || storedPayment?.reference || ""),
    };

    setDepositLoading(true);
    setDepositError("");
    markFullPackageUnlockPaid({
      fullPackageId: ctxFullPackageId,
      selectedItems: selectedItems.length ? selectedItems : missingItems,
      unlockAmount: Number(context?.unlockAmount || context?.depositAmount || gateAmount),
      unlockPaymentMeta: paymentMeta,
    })
      .then(() => {
        setDepositPaid(true);
        setDepositPaymentMeta(paymentMeta);
        setPaidGateAmount(Number(paymentMeta.amount || 0));
        setPaidSelectionKey(
          buildItemListKey(selectedItems.length ? selectedItems : missingItems)
        );
      })
      .catch((error) => {
        if (String(error?.code || "").toLowerCase().includes("permission-denied")) {
          setDepositError(
            "Firestore rules are blocking full package updates. Please allow fullPackages create/update for the signed-in owner."
          );
        } else {
          setDepositError(error?.message || "Failed to confirm unlock payment.");
        }
      })
      .finally(() => setDepositLoading(false));
  }, [open, location.state, location.search, gateAmount, missingItems, checklistItemNames]);

  const handlePayDeposit = async () => {
    if (!canPayDeposit) return;
    const user = auth.currentUser;
    if (!user?.uid) {
      setDepositError("Please sign in again before paying unlock payment.");
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
          track: normalizedTrack,
          country: normalizedCountry,
          selectedItems: missingItems,
          unlockAmount: gateAmount,
        });
        setFullPackageId(id);
      } else {
        await syncFullPackageSelection({ fullPackageId: id, selectedItems: missingItems });
      }

      const draftId = createRequestDraftId();
      const paymentContext = {
        flow: "fullPackageUnlock",
        track: normalizedTrack,
        country: normalizedCountry,
        fullPackageId: id,
        selectedItems: missingItems,
        unlockAmount: gateAmount,
      };
      const amountText = formatPricingMoney(gateAmount, "KES");

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
        setDepositError(error?.message || "Failed to start unlock payment.");
      }
    } finally {
      setDepositLoading(false);
    }
  };

  const handleProceed = async () => {
    if (!canProceed) return;
    let nextFullPackageId = fullPackageId;

    if (!nextFullPackageId) {
      const user = auth.currentUser;
      if (!user?.uid) {
        setDepositError("Please sign in again before continuing.");
        return;
      }

      try {
        nextFullPackageId = await createFullPackageDraft({
          uid: user.uid,
          email: user.email || "",
          track: normalizedTrack,
          country: normalizedCountry,
          selectedItems: missingItems,
          unlockAmount: 0,
        });
        setFullPackageId(nextFullPackageId);
      } catch (error) {
        setDepositError(error?.message || "Failed to open your full package.");
        return;
      }
    }

    const hubPath = buildFullPackageHubPath({ fullPackageId: nextFullPackageId, track: normalizedTrack });
    if (!hubPath) return;

    try {
      await syncFullPackageSelection({ fullPackageId: nextFullPackageId, selectedItems: missingItems });
    } catch (error) {
      setDepositError(error?.message || "Failed to sync selected items.");
      return;
    }

    const qs = new URLSearchParams();
    qs.set("country", normalizedCountry);

    navigate(`${hubPath}&${qs.toString()}`, {
      state: {
        fullPackageId: nextFullPackageId,
        missingItems,
        unlockPaid: gateAmount <= 0 ? true : depositPaid,
        unlockPaymentMeta: depositPaymentMeta || null,
        depositPaid: gateAmount <= 0 ? true : depositPaid,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center app-overlay-safe" onClick={(e) => e.target === e.currentTarget && onClose?.()} role="presentation">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div
        className="relative w-full max-w-md rounded-[22px] border border-white/40 bg-white/55 shadow-[0_12px_30px_rgba(0,0,0,0.14)] backdrop-blur-xl ring-1 ring-white/20 flex flex-col overflow-hidden"
        style={{
          height: "min(82vh, calc(var(--app-viewport-height) - var(--app-safe-top) - var(--app-safe-bottom) - 1.5rem))",
          maxHeight: "min(82vh, calc(var(--app-viewport-height) - var(--app-safe-top) - var(--app-safe-bottom) - 1.5rem))",
        }}
      >
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
                  {formatPricingMoney(livePrice, "KES")}
                </div>
                <div className="mt-0.5 text-[10.5px] font-semibold text-emerald-900/70">{saveText}</div>
                <div className="mt-1 text-[10.5px] text-zinc-600">
                  Full package total: {formatPricingMoney(totalPrice, "KES")}
                </div>
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
            {pricingLoading && !livePricingRows.length ? (
              <div className="mb-3 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs text-zinc-600">
                Loading exact pricing...
              </div>
            ) : null}
            {pricingError ? (
              <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {pricingError}
              </div>
            ) : null}
            <div className="grid gap-3">
              {checklistRows.map((row) => {
                const item = row.serviceName;
                const isOn = !!checked[item];
                const credit = Number(row.amount || 0);
                return (
                  <button key={item} type="button" aria-pressed={isOn} onClick={() => toggle(item)} className={["w-full text-left rounded-3xl border px-4 py-3 transition active:scale-[0.99] shadow-[0_6px_16px_rgba(0,0,0,0.05)] min-h-[78px]", isOn ? "border-emerald-200 bg-white/55" : "border-white/35 bg-white/40 hover:bg-white/50 hover:border-emerald-200/60"].join(" ")}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-center gap-3">
                        <span className={["inline-flex h-9 w-9 items-center justify-center rounded-2xl border", isOn ? "border-emerald-200 bg-emerald-50/60 text-emerald-800" : "border-white/35 bg-white/45 text-zinc-700"].join(" ")}>
                          {isOn ? <IconCheck className="h-5 w-5" /> : <span className="h-2 w-2 rounded-full bg-zinc-300" />}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-zinc-900">{item}</div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {row.note || `Tap to ${isOn ? "undo" : "mark ready"}`}
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
                        -{formatPricingMoney(credit, row.currency)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-3xl border border-white/35 bg-white/45 p-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-3 py-3">
                <div className="text-sm font-semibold text-emerald-900">Payment gate for your Full Package</div>
                <div className="mt-1 text-xs text-emerald-800">
                  The payment gate uses the remaining package total after subtracting what the client already has.
                </div>
                <div className="mt-2 text-sm font-semibold text-zinc-900">
                  Remaining total: {formatPricingMoney(gateAmount, "KES")}
                </div>
                <button type="button" onClick={handlePayDeposit} disabled={!canPayDeposit || isPaidForCurrentSelection || depositLoading} className={["mt-3 w-full rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-[0.99]", isPaidForCurrentSelection ? "border-emerald-200 bg-emerald-600 text-white cursor-default" : canPayDeposit ? "border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-100" : "border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed"].join(" ")}>
                  {isPaidForCurrentSelection ? "Payment Gate Paid" : depositLoading ? "Processing..." : depositPaid ? "Pay Updated Total" : "Pay Remaining Total"}
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

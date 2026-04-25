import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";

import { db } from "../firebase";
import { buildFullPackageHubPath } from "../services/fullpackageservice";
import { reconcilePaymentReference } from "../services/paymentservice";
import {
  saveWorkflowDraft,
  WORKFLOW_DRAFT_STATUSES,
} from "../services/workflowdraftservice";
import { markDummyPaymentPaid } from "../utils/dummyPayment";
import {
  getMpesaCheckoutHeadline,
  getMpesaCheckoutMessage,
  isPendingMpesaCheckout,
  isSuccessfulMpesaCheckout,
  resolveMpesaCheckoutOutcome,
} from "../utils/mpesaCheckout";

function safeStr(value, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function normalizePaymentMethod(value = "", fallback = "mpesa") {
  const raw = safeStr(value, 80).toLowerCase();
  if (raw === "mpesa") return raw;
  return safeStr(fallback, 80).toLowerCase() === "mpesa" ? "mpesa" : "mpesa";
}

function resolveDraftIdFromReturnTo(returnTo = "") {
  const raw = safeStr(returnTo, 1200);
  if (!raw) return "";
  try {
    const url = raw.startsWith("http://") || raw.startsWith("https://")
      ? new URL(raw)
      : new URL(raw, "https://majuu.app");
    return safeStr(url.searchParams.get("draft"), 180);
  } catch {
    return "";
  }
}

function parseUrlLike(raw = "") {
  const value = safeStr(raw, 1200);
  if (!value) return null;
  try {
    return value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value)
      : new URL(value, "https://majuu.app");
  } catch {
    return null;
  }
}

function resolveTrackFromPathname(pathname = "") {
  const path = safeStr(pathname, 300).toLowerCase();
  const fromHub = path.match(/^\/app\/full-package\/(study|work|travel)(?:\/|$)/i);
  if (fromHub?.[1]) return safeStr(fromHub[1], 24).toLowerCase();
  const fromTrackScreen = path.match(/^\/app\/(study|work|travel)(?:\/|$)/i);
  if (fromTrackScreen?.[1]) return safeStr(fromTrackScreen[1], 24).toLowerCase();
  return "";
}

function buildFullPackageResumePath({ fullPackageId, track, country, draftId }) {
  const safeFullPackageId = safeStr(fullPackageId, 180);
  const safeTrack = safeStr(track, 24).toLowerCase();
  if (!safeFullPackageId || !safeTrack) return "";
  const hubPath = buildFullPackageHubPath({
    fullPackageId: safeFullPackageId,
    track: safeTrack,
  });
  if (!hubPath) return "";

  const url = parseUrlLike(hubPath);
  if (!url) return "";

  const safeCountry = safeStr(country, 120);
  const safeDraftId = safeStr(draftId, 180);
  if (safeCountry) url.searchParams.set("country", safeCountry);
  if (safeDraftId) {
    url.searchParams.set("draft", safeDraftId);
    url.searchParams.set("fpDraft", safeDraftId);
  }
  return `${url.pathname}${url.search}`;
}

function resolvePaidWorkflowDraftStatus({ verificationResult, returnTo }) {
  const flowType = safeStr(verificationResult?.flowType, 80).toLowerCase();
  if (flowType === "full_package_unlock") {
    return WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS;
  }

  const returnUrl = parseUrlLike(returnTo);
  if (safeStr(returnUrl?.pathname, 300).toLowerCase().includes("/full-package/")) {
    return WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS;
  }

  return WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION;
}

async function resolveFullPackageResumePath({
  verificationResult,
  requestId,
  draftId,
  fallbackReturnTo,
}) {
  const fallbackUrl = parseUrlLike(fallbackReturnTo);
  let flowType = safeStr(verificationResult?.flowType, 80).toLowerCase();
  let fullPackageId = safeStr(
    verificationResult?.fullPackage?.fullPackageId || verificationResult?.fullPackageId,
    180
  );
  let track = resolveTrackFromPathname(fallbackUrl?.pathname || "");
  let country = safeStr(fallbackUrl?.searchParams?.get("country"), 120);

  const safeRequestId = safeStr(requestId, 180);
  if (safeRequestId) {
    try {
      const requestSnap = await getDoc(doc(db, "serviceRequests", safeRequestId));
      if (requestSnap.exists()) {
        const requestData = requestSnap.data() || {};
        flowType = safeStr(requestData?.paymentFlowType || flowType, 80).toLowerCase();
        fullPackageId = safeStr(
          requestData?.fullPackageId || requestData?.fullPackageUnlockMeta?.fullPackageId || fullPackageId,
          180
        );
        track = safeStr(requestData?.track || track, 24).toLowerCase() || track;
        country = safeStr(requestData?.country || country, 120) || country;
      }
    } catch (error) {
      console.warn("Failed to load callback request context:", error?.message || error);
    }
  }

  if (flowType !== "full_package_unlock" || !fullPackageId) return "";
  return buildFullPackageResumePath({ fullPackageId, track, country, draftId });
}

export default function PaymentCallbackScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState("");
  const [resolvedDraftId, setResolvedDraftId] = useState("");
  const [resolvedRequestId, setResolvedRequestId] = useState("");
  const [resolvedReturnTo, setResolvedReturnTo] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  const query = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);
  const reference = safeStr(query.get("reference") || query.get("trxref"), 120);
  const requestId = safeStr(query.get("requestId"), 180);
  const returnTo = safeStr(query.get("returnTo"), 600);
  const shareToken = safeStr(query.get("share"), 400);
  const queryDraftId = safeStr(query.get("draft"), 180);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;

    const verify = async (attempt = 0) => {
      if (!cancelled) {
        if (attempt === 0) {
          setStatus("verifying");
          setMessage("");
        }
        setResolvedReturnTo(returnTo);
        setResolvedDraftId(queryDraftId || resolveDraftIdFromReturnTo(returnTo));
      }

      if (!reference) {
        if (!cancelled) {
          setStatus("failed");
          setMessage("Payment reference is missing.");
        }
        return;
      }

      try {
        const result = await reconcilePaymentReference({ reference });
        if (cancelled) return;
        const outcome = resolveMpesaCheckoutOutcome(result);
        const nextRequestId = safeStr(result?.requestId || requestId, 180);
        const rawNextReturnTo = safeStr(result?.returnTo || returnTo, 600);
        const nextDraftId =
          safeStr(result?.draftId, 180) ||
          queryDraftId ||
          resolveDraftIdFromReturnTo(rawNextReturnTo || returnTo);
        const nextReturnTo =
          (await resolveFullPackageResumePath({
            verificationResult: result,
            requestId: nextRequestId,
            draftId: nextDraftId,
            fallbackReturnTo: rawNextReturnTo || returnTo,
          })) || rawNextReturnTo;

        setResolvedRequestId(nextRequestId);
        setResolvedReturnTo(nextReturnTo);
        setResolvedDraftId(nextDraftId);

        if (isSuccessfulMpesaCheckout(result)) {
          if (nextDraftId) {
            const paidDraftStatus = resolvePaidWorkflowDraftStatus({
              verificationResult: result,
              returnTo: nextReturnTo,
            });
            const method = normalizePaymentMethod(
              result?.paymentMethod || result?.provider || result?.verificationSummary?.provider,
              "mpesa"
            );
            markDummyPaymentPaid(nextDraftId, {
              status: "paid",
              method,
              paidAtMs: Date.now(),
              transactionReference: reference,
              paymentReference: reference,
              currentReference: reference,
              checkoutStatus: "success",
              checkoutFailureReason: "",
              resultCode: 0,
              message: getMpesaCheckoutMessage(result),
              requestId: nextRequestId,
              paymentId: safeStr(result?.paymentId, 180),
            });

            void saveWorkflowDraft(nextDraftId, {
              linkedRequestId: nextRequestId,
              status: paidDraftStatus,
              paymentState: "paid",
              paymentReference: reference,
              fullPackageUnlockPaid:
                paidDraftStatus ===
                WORKFLOW_DRAFT_STATUSES.FULL_PACKAGE_PAID_PENDING_DIAGNOSTICS,
              linkedPayment: {
                requestId: nextRequestId,
                paymentId: safeStr(result?.paymentId, 180),
                paymentType: "unlock_request",
                status: "paid",
                paymentState: "paid",
                amount: Number(result?.amount || 0) || 0,
                currency: safeStr(result?.currency || "KES", 8).toUpperCase() || "KES",
                reference,
                paidAtMs: Date.now(),
                verifiedAtMs: Date.now(),
              },
            }).catch((draftError) => {
              console.warn(
                "Payment callback draft reconciliation failed:",
                draftError?.message || draftError
              );
            });
          }

          setStatus("success");
          setMessage(getMpesaCheckoutMessage(result));
          return;
        }

        if (isPendingMpesaCheckout(result)) {
          const waitingMessage = getMpesaCheckoutMessage(result);
          if (attempt < 10) {
            setStatus("verifying");
            setMessage(waitingMessage);
            retryTimer = window.setTimeout(() => {
              void verify(attempt + 1);
            }, 3000);
            return;
          }
          setStatus("pending");
          setMessage(
            waitingMessage ||
              "We are still waiting for the M-Pesa callback. You can check again in a moment."
          );
          return;
        }

        setStatus(outcome);
        setMessage(getMpesaCheckoutMessage(result));
      } catch (nextError) {
        if (!cancelled) {
          if (attempt < 10) {
            setStatus("verifying");
            setMessage(
              nextError?.message ||
                "We are still waiting for the payment callback. Trying again..."
            );
            retryTimer = window.setTimeout(() => {
              void verify(attempt + 1);
            }, 3000);
            return;
          }
          setStatus("pending");
          setMessage(
            nextError?.message ||
              "We could not confirm this payment yet. Please check again shortly."
          );
        }
      }
    };

    void verify(0);

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [reference, requestId, returnTo, queryDraftId, retryNonce]);

  const handleContinue = () => {
    if (shareToken) {
      navigate(`/pay/shared/${encodeURIComponent(shareToken)}`, { replace: true });
      return;
    }
    if (resolvedReturnTo) {
      navigate(resolvedReturnTo, { replace: true });
      return;
    }
    if (resolvedRequestId) {
      navigate(`/app/request/${resolvedRequestId}`, { replace: true });
      return;
    }
    navigate("/app/progress", { replace: true });
  };

  const headline =
    status === "verifying"
      ? "Confirming your payment"
      : getMpesaCheckoutHeadline({
          checkoutStatus: status === "insufficient" ? "failed" : status,
          checkoutFailureReason:
            status === "insufficient" ? "insufficient_balance" : "",
        });
  const summary =
    status === "verifying"
      ? message ||
        "We are verifying this transaction with the backend before updating MAJUU."
      : message;
  const showPendingActions = status === "pending";
  const showBackAction =
    status === "cancelled" ||
    status === "timeout" ||
    status === "insufficient" ||
    status === "failed" ||
    status === "pending";

  return (
    <div className="min-h-screen bg-zinc-50 px-5 py-10 dark:bg-zinc-950">
      <div className="mx-auto max-w-md rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
          Payment Callback
        </div>
        <h1 className="mt-3 text-xl font-semibold text-zinc-900">{headline}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{summary}</p>
        {status === "verifying" ? (
          <div className="mt-4 text-sm font-medium text-emerald-700">Verifying payment...</div>
        ) : null}
        {reference ? (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
            Reference: {reference}
          </div>
        ) : null}
        {status === "success" ? (
          <button
            type="button"
            onClick={handleContinue}
            className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            {resolvedDraftId ? "Continue request" : "Continue"}
          </button>
        ) : null}
        {showPendingActions || showBackAction ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {showPendingActions ? (
              <button
                type="button"
                onClick={() => setRetryNonce((value) => value + 1)}
                className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Check again
              </button>
            ) : null}
            {showBackAction && resolvedReturnTo ? (
              <button
                type="button"
                onClick={() => navigate(resolvedReturnTo, { replace: true })}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
              >
                Back to request
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

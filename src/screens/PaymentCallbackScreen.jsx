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

function safeStr(value, max = 600) {
  return String(value || "").trim().slice(0, max);
}

function isSuccessfulPaymentStatus(status = "") {
  return new Set(["success", "paid", "held", "payout_ready", "settled"]).has(
    safeStr(status, 80).toLowerCase()
  );
}

function normalizePaymentMethod(value = "", fallback = "mpesa") {
  const raw = safeStr(value, 80).toLowerCase();
  if (raw === "mpesa" || raw === "paystack") return raw;
  const fallbackValue = safeStr(fallback, 80).toLowerCase();
  return fallbackValue === "paystack" ? "paystack" : "mpesa";
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
  const [resolvedRequestId, setResolvedRequestId] = useState("");
  const [resolvedReturnTo, setResolvedReturnTo] = useState("");
  const [resolvedDraftId, setResolvedDraftId] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  const query = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);
  const reference = safeStr(query.get("reference") || query.get("trxref"), 120);
  const requestId = safeStr(query.get("requestId"), 180);
  const returnTo = safeStr(query.get("returnTo"), 600);
  const shareToken = safeStr(query.get("share"), 400);
  const queryDraftId = safeStr(query.get("draft"), 180);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!cancelled) {
        setStatus("verifying");
        setMessage("");
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
        const nextStatus = safeStr(result?.status, 80).toLowerCase();
        const confirmed = result?.ok === true || isSuccessfulPaymentStatus(nextStatus);
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

        if (!confirmed) {
          setStatus("failed");
          setMessage(
            safeStr(
              result?.message ||
                (nextStatus === "failed"
                  ? "This payment could not be verified."
                  : "We could not confirm this payment yet.")
            ) || "We could not confirm this payment yet."
          );
          return;
        }

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
        setMessage(
          safeStr(result?.message, 400) ||
            (nextDraftId
              ? "Payment verified successfully. Continue to finish your request."
              : "Payment verified successfully.")
        );
      } catch (nextError) {
        if (!cancelled) {
          setStatus("failed");
          setMessage(
            nextError?.message || "We could not confirm this payment yet. Please try again."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white px-5 py-10">
      <div className="mx-auto max-w-md rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700">
          Payment Callback
        </div>
        <h1 className="mt-3 text-xl font-semibold text-zinc-900">
          {status === "success"
            ? "Payment confirmed"
            : status === "failed"
            ? "Payment needs attention"
            : "Confirming your payment"}
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {status === "verifying"
            ? "We are verifying this transaction with the backend before updating MAJUU."
            : message}
        </p>
        {status === "verifying" ? (
          <div className="mt-4 text-sm font-medium text-emerald-700">Verifying payment...</div>
        ) : null}
        {reference ? (
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
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
        {status === "failed" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRetryNonce((value) => value + 1)}
              className="rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              Try again
            </button>
            {resolvedReturnTo ? (
              <button
                type="button"
                onClick={() => navigate(resolvedReturnTo, { replace: true })}
                className="rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700"
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

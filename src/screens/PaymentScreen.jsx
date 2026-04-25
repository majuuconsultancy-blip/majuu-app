import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { auth } from "../firebase";
import { buildLegalDocRoute, LEGAL_DOC_KEYS } from "../legal/legalRegistry";
import {
  buildPaymentDropoffDedupeKey,
  PAYMENT_DROPOFF_STEPS,
  trackPaymentDropoff,
} from "../services/paymentDropoffAnalyticsService";
import { createUnlockCheckoutSession, reconcilePaymentReference } from "../services/paymentservice";
import { getRequestPricingQuote, toRequestPricingSnapshot } from "../services/pricingservice";
import { createServiceRequest } from "../services/requestservice";
import { getUserState } from "../services/userservice";
import {
  saveWorkflowDraft,
  WORKFLOW_DRAFT_FLOW_FAMILIES,
  WORKFLOW_DRAFT_FLOW_KINDS,
  WORKFLOW_DRAFT_STATUSES,
} from "../services/workflowdraftservice";
import {
  clearDummyPaymentState,
  getDummyPaymentDraft,
  getDummyPaymentState,
  markDummyPaymentPaid,
  setDummyPaymentState,
} from "../utils/dummyPayment";
import {
  getMpesaCheckoutMessage,
  isPendingMpesaCheckout,
  isSuccessfulMpesaCheckout,
  normalizeSafaricomMpesaNumber,
  resolveMpesaCheckoutOutcome,
} from "../utils/mpesaCheckout";
import { smartBack } from "../utils/navBack";

function safeStr(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 200) {
  return safeStr(value, max).toLowerCase();
}

function roundMoney(value) {
  const next = Number(value || 0);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.round(next));
}

function parseAmountNumber(input) {
  const digits = safeStr(input, 80).replace(/[^0-9.]+/g, "");
  const amount = Number(digits || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount);
}

function normalizeCurrency(value, fallback = "KES") {
  return safeStr(value || fallback, 8).toUpperCase() || fallback;
}

function normalizePhoneInput(value = "") {
  return safeStr(value, 40);
}

function safeNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function resolveInitialPhoneValue(checkoutPayload = {}, storedDraft = {}) {
  return normalizePhoneInput(
    checkoutPayload?.phone || storedDraft?.formState?.phone || storedDraft?.phone
  );
}

function createStoredPaymentState(result = {}, extra = {}) {
  const source = result && typeof result === "object" ? result : {};
  const current = extra?.current && typeof extra.current === "object" ? extra.current : {};
  const reference = safeStr(
    source?.reference ||
      source?.paymentReference ||
      source?.currentReference ||
      source?.transactionReference ||
      current?.paymentReference ||
      current?.currentReference ||
      current?.reference ||
      current?.transactionReference,
    180
  );
  const resultCode = safeNumber(
    source?.resultCode ?? source?.checkoutResultCode ?? current?.resultCode
  );
  const checkoutFailureReason = lower(
    source?.checkoutFailureReason || current?.checkoutFailureReason,
    80
  );
  const outcome = resolveMpesaCheckoutOutcome({
    ...current,
    ...source,
    resultCode,
    checkoutFailureReason,
  });

  return {
    ...(current && typeof current === "object" ? current : {}),
    status: lower(source?.status || current?.status, 80),
    checkoutStatus:
      outcome === "insufficient"
        ? "failed"
        : lower(source?.checkoutStatus || outcome || current?.checkoutStatus, 40),
    checkoutFailureReason:
      checkoutFailureReason || (outcome === "insufficient" ? "insufficient_balance" : ""),
    resultCode,
    resultDesc: safeStr(
      source?.resultDesc || source?.checkoutResultDesc || current?.resultDesc,
      400
    ),
    message: safeStr(source?.message || current?.message, 400),
    method: "mpesa",
    phoneNumber: normalizePhoneInput(
      extra?.phoneNumber || source?.phoneNumber || current?.phoneNumber
    ),
    requestId: safeStr(source?.requestId || extra?.requestId || current?.requestId, 180),
    paymentId: safeStr(source?.paymentId || current?.paymentId, 180),
    transactionReference: reference,
    paymentReference: reference,
    currentReference: reference,
    reference,
    amount: roundMoney(source?.amount || current?.amount),
    currency: normalizeCurrency(source?.currency || current?.currency || "KES"),
    checkoutRequestId: safeStr(
      source?.checkoutRequestId || current?.checkoutRequestId,
      180
    ),
    merchantRequestId: safeStr(
      source?.merchantRequestId || current?.merchantRequestId,
      180
    ),
  };
}

function sendPaymentDropoffEvent({
  step = "",
  phoneNumber = "",
  amount = 0,
  serviceName = "",
  requestId = "",
  paymentId = "",
  reference = "",
  draftId = "",
  dedupe = false,
} = {}) {
  const safeStep = safeStr(step, 80).toLowerCase();
  if (!safeStep) return;
  const safeReference = safeStr(reference, 180);
  const safePaymentId = safeStr(paymentId, 180);
  const safeRequestId = safeStr(requestId, 180);
  void trackPaymentDropoff(
    {
      step: safeStep,
      phoneNumber: normalizeSafaricomMpesaNumber(phoneNumber),
      amount: roundMoney(amount),
      service: safeStr(serviceName, 180),
      requestId: safeRequestId,
      paymentId: safePaymentId,
      reference: safeReference,
      draftId: safeStr(draftId, 180),
    },
    {
      dedupeKey: dedupe
        ? buildPaymentDropoffDedupeKey({
            step: safeStep,
            reference: safeReference,
            paymentId: safePaymentId,
            requestId: safeRequestId,
          })
        : "",
    }
  );
}

function resolveCheckoutPayload(draft = {}, fallbackReturnTo = "") {
  const stored =
    draft?.checkoutPayload && typeof draft.checkoutPayload === "object"
      ? draft.checkoutPayload
      : null;
  if (stored) {
    return {
      ...stored,
      requestDraftId:
        safeStr(stored?.requestDraftId, 180) || safeStr(draft?.requestDraftId, 180),
      returnTo:
        safeStr(fallbackReturnTo, 1200) ||
        safeStr(stored?.returnTo, 1200) ||
        "",
    };
  }

  const formState =
    draft?.formState && typeof draft.formState === "object" ? draft.formState : {};
  return {
    requestDraftId: safeStr(draft?.requestDraftId, 180),
    returnTo: safeStr(fallbackReturnTo, 1200),
    amount: safeStr(draft?.amount, 120),
    name: safeStr(formState?.name, 140),
    phone: safeStr(formState?.phone, 40),
    email: safeStr(formState?.email, 200),
    county: safeStr(formState?.county, 120),
    town: safeStr(formState?.town || formState?.city, 120),
    city: safeStr(formState?.city || formState?.town, 120),
    note: safeStr(formState?.note, 2000),
    preferredAgentId: safeStr(formState?.preferredAgentId, 140),
    requestUploadMeta:
      draft?.requestUploadMeta && typeof draft.requestUploadMeta === "object"
        ? draft.requestUploadMeta
        : null,
    extraFieldAnswers:
      draft?.extraFieldAnswers && typeof draft.extraFieldAnswers === "object"
        ? draft.extraFieldAnswers
        : null,
    paymentContext:
      draft?.paymentContext && typeof draft.paymentContext === "object"
        ? draft.paymentContext
        : null,
  };
}

function resolveDraftFlow(paymentContext = {}) {
  const flow = lower(paymentContext?.flow, 80);
  if (flow === "fullpackage") {
    return {
      flowFamily: WORKFLOW_DRAFT_FLOW_FAMILIES.FULL_PACKAGE,
      flowKind: WORKFLOW_DRAFT_FLOW_KINDS.FULL_PACKAGE_ITEM_REQUEST,
    };
  }
  return {
    flowFamily: WORKFLOW_DRAFT_FLOW_FAMILIES.NORMAL_REQUEST,
    flowKind: WORKFLOW_DRAFT_FLOW_KINDS.WEHELP_REQUEST,
  };
}

async function persistInitiatedDraft({
  draftId,
  paymentContext,
  session,
  amountText,
} = {}) {
  const safeDraftId = safeStr(draftId, 180);
  if (!safeDraftId) return;

  const flow = resolveDraftFlow(paymentContext);
  await saveWorkflowDraft(safeDraftId, {
    flowFamily: flow.flowFamily,
    flowKind: flow.flowKind,
    status: WORKFLOW_DRAFT_STATUSES.PAYMENT_INITIATED,
    linkedRequestId: safeStr(session?.requestId, 180),
    linkedPayment: {
      requestId: safeStr(session?.requestId, 180),
      paymentId: safeStr(session?.paymentId, 180),
      paymentType: "unlock_request",
      status: lower(session?.status, 80) || "payment_session_created",
      paymentState: "pending",
      amount: roundMoney(session?.amount || parseAmountNumber(amountText)),
      currency: normalizeCurrency(session?.currency || "KES"),
      reference: safeStr(session?.reference, 180),
    },
    paymentState: "pending",
    paymentAmount: roundMoney(session?.amount || parseAmountNumber(amountText)),
    paymentCurrency: normalizeCurrency(session?.currency || "KES"),
    paymentReference: safeStr(session?.reference, 180),
  });
}

async function persistVerifiedDraft({
  draftId,
  result,
  reference,
} = {}) {
  const safeDraftId = safeStr(draftId, 180);
  if (!safeDraftId) return null;

  const requestId = safeStr(result?.requestId, 180);
  const paymentId = safeStr(result?.paymentId, 180);
  const paidState = {
    status: "paid",
    method: "mpesa",
    paidAtMs: Date.now(),
    transactionReference: safeStr(reference, 180),
    requestId,
    paymentId,
    amount: roundMoney(result?.amount),
    currency: normalizeCurrency(result?.currency || "KES"),
  };

  markDummyPaymentPaid(safeDraftId, paidState);
  await saveWorkflowDraft(safeDraftId, {
    linkedRequestId: requestId,
    status: WORKFLOW_DRAFT_STATUSES.UNLOCK_PAID_PENDING_SUBMISSION,
    paymentState: "paid",
    paymentReference: safeStr(reference, 180),
    linkedPayment: {
      requestId,
      paymentId,
      paymentType: "unlock_request",
      status: "paid",
      paymentState: "paid",
      amount: roundMoney(result?.amount),
      currency: normalizeCurrency(result?.currency || "KES"),
      reference: safeStr(reference, 180),
      paidAtMs: Date.now(),
      verifiedAtMs: Date.now(),
    },
  });

  return paidState;
}

function IconArrowLeft(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M14.5 18 8.5 12l6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PaymentScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);

  const draftId = safeStr(query.get("draft"), 180);
  const queryReturnTo = safeStr(query.get("returnTo"), 1200);
  const storedDraft = useMemo(() => getDummyPaymentDraft(draftId), [draftId]);
  const checkoutPayload = useMemo(
    () => resolveCheckoutPayload(storedDraft, queryReturnTo),
    [storedDraft, queryReturnTo]
  );
  const [phone, setPhone] = useState(() =>
    resolveInitialPhoneValue(checkoutPayload, storedDraft)
  );
  const [paymentState, setPaymentState] = useState(null);
  const paymentStateRef = useRef(null);
  const [status, setStatus] = useState("ready");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [verificationNonce, setVerificationNonce] = useState(0);

  const reference = safeStr(
    paymentState?.reference || paymentState?.transactionReference,
    180
  );
  const effectiveReturnTo =
    safeStr(checkoutPayload?.returnTo, 1200) || queryReturnTo || "/app/progress";
  const amountLabel = safeStr(checkoutPayload?.amount, 120);
  const amountValue = parseAmountNumber(checkoutPayload?.amount);
  const paymentContext =
    checkoutPayload?.paymentContext && typeof checkoutPayload.paymentContext === "object"
      ? checkoutPayload.paymentContext
      : {};
  const serviceName =
    safeStr(paymentContext?.serviceName, 180) || "Request unlock payment";
  const analyticsAmount = roundMoney(paymentState?.amount || amountValue);

  useEffect(() => {
    paymentStateRef.current = paymentState;
  }, [paymentState]);

  useEffect(() => {
    if (!draftId) {
      setPhone(resolveInitialPhoneValue(checkoutPayload, storedDraft));
      setPaymentState(null);
      setStatus("ready");
      setMessage("");
      setWorking(false);
      setVerificationNonce(0);
      return;
    }
    if (!storedDraft) {
      setPaymentState(null);
      setStatus("failed");
      setMessage("This payment draft could not be found. Please go back and start again.");
      setWorking(false);
      return;
    }

    const storedPayment = getDummyPaymentState(draftId);
    const storedReference = safeStr(
      storedPayment?.reference ||
        storedPayment?.paymentReference ||
        storedPayment?.currentReference ||
        storedPayment?.transactionReference,
      180
    );
    const storedOutcome = storedPayment ? resolveMpesaCheckoutOutcome(storedPayment) : "";

    setPhone(
      resolveInitialPhoneValue(checkoutPayload, storedDraft) ||
        normalizePhoneInput(storedPayment?.phoneNumber)
    );
    if (storedPayment && storedOutcome === "success") {
      setPaymentState(storedPayment);
      setStatus("success");
      setMessage(getMpesaCheckoutMessage(storedPayment));
    } else if (storedPayment && storedOutcome === "pending" && storedReference) {
      setPaymentState(storedPayment);
      setStatus("pending");
      setMessage(getMpesaCheckoutMessage(storedPayment));
    } else if (storedPayment && storedOutcome && storedOutcome !== "pending") {
      setPaymentState(storedPayment);
      setStatus(storedOutcome);
      setMessage(getMpesaCheckoutMessage(storedPayment));
    } else {
      if (storedPayment && !storedReference) {
        clearDummyPaymentState(draftId);
      }
      setPaymentState(null);
      setStatus("ready");
      setMessage("");
    }
    setWorking(false);
    setVerificationNonce(0);
  }, [checkoutPayload, draftId, storedDraft]);

  useEffect(() => {
    return () => {
      if (!draftId) return;
      const currentPaymentState = paymentStateRef.current || getDummyPaymentState(draftId);
      if (currentPaymentState && !isSuccessfulMpesaCheckout(currentPaymentState)) {
        clearDummyPaymentState(draftId);
      }
    };
  }, [draftId]);

  useEffect(() => {
    if (!draftId || !reference) return undefined;
    if (status !== "pending") return undefined;

    let cancelled = false;
    let retryTimer = 0;

    const verify = async (attempt = 0) => {
      try {
        const result = await reconcilePaymentReference({ reference });
        if (cancelled) return;

        const currentPaymentState =
          getDummyPaymentState(draftId) || paymentStateRef.current || {};
        const nextPaymentState = createStoredPaymentState(result, {
          current: currentPaymentState,
          phoneNumber: currentPaymentState?.phoneNumber,
        });
        const outcome = resolveMpesaCheckoutOutcome(nextPaymentState);

        if (outcome === "success") {
          const paidState = await persistVerifiedDraft({
            draftId,
            result,
            reference,
          });
          if (cancelled) return;
          const successfulPaymentState = {
            ...(paymentStateRef.current && typeof paymentStateRef.current === "object"
              ? paymentStateRef.current
              : {}),
            ...nextPaymentState,
            ...(paidState && typeof paidState === "object" ? paidState : {}),
            requestId: safeStr(result?.requestId, 180),
            paymentId: safeStr(result?.paymentId, 180),
            reference,
            transactionReference: reference,
            paymentReference: reference,
            currentReference: reference,
            checkoutStatus: "success",
            checkoutFailureReason: "",
            resultCode: 0,
          };
          setDummyPaymentState(draftId, successfulPaymentState);
          setPaymentState(successfulPaymentState);
          setStatus("success");
          setMessage(getMpesaCheckoutMessage(successfulPaymentState));
          return;
        }

        setDummyPaymentState(draftId, nextPaymentState);
        setPaymentState(nextPaymentState);

        if (outcome === "pending") {
          setMessage(getMpesaCheckoutMessage(nextPaymentState));
          if (attempt < 15) {
            setStatus("pending");
            retryTimer = window.setTimeout(() => {
              void verify(attempt + 1);
            }, 3000);
            return;
          }
          setStatus("pending");
          return;
        }

        setStatus(outcome);
        setMessage(getMpesaCheckoutMessage(nextPaymentState));
      } catch (error) {
        if (cancelled) return;
        if (attempt < 15) {
          setStatus("pending");
          setMessage(
            safeStr(error?.message, 400) ||
              "We are still waiting for the M-Pesa callback. Trying again..."
          );
          retryTimer = window.setTimeout(() => {
            void verify(attempt + 1);
          }, 3000);
          return;
        }

        setStatus("pending");
        setMessage(
          safeStr(error?.message, 400) ||
            "We could not confirm this payment yet. Please check again shortly."
        );
      }
    };

    void verify(0);

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [draftId, reference, status, verificationNonce]);

  useEffect(() => {
    if (status !== "pending" || !reference) return undefined;
    const timer = window.setTimeout(() => {
      sendPaymentDropoffEvent({
        step: PAYMENT_DROPOFF_STEPS.TIMEOUT,
        phoneNumber: paymentState?.phoneNumber || phone,
        amount: analyticsAmount,
        serviceName,
        requestId: paymentState?.requestId,
        paymentId: paymentState?.paymentId,
        reference,
        draftId,
        dedupe: true,
      });
    }, 75000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [analyticsAmount, draftId, paymentState?.paymentId, paymentState?.phoneNumber, paymentState?.requestId, phone, reference, serviceName, status]);

  useEffect(() => {
    if (!reference) return;
    if (status === "cancelled") {
      sendPaymentDropoffEvent({
        step: PAYMENT_DROPOFF_STEPS.CANCELLED,
        phoneNumber: paymentState?.phoneNumber || phone,
        amount: analyticsAmount,
        serviceName,
        requestId: paymentState?.requestId,
        paymentId: paymentState?.paymentId,
        reference,
        draftId,
        dedupe: true,
      });
      return;
    }
    if (status === "insufficient") {
      sendPaymentDropoffEvent({
        step: PAYMENT_DROPOFF_STEPS.INSUFFICIENT_BALANCE,
        phoneNumber: paymentState?.phoneNumber || phone,
        amount: analyticsAmount,
        serviceName,
        requestId: paymentState?.requestId,
        paymentId: paymentState?.paymentId,
        reference,
        draftId,
        dedupe: true,
      });
      return;
    }
    if (status === "timeout") {
      sendPaymentDropoffEvent({
        step: PAYMENT_DROPOFF_STEPS.TIMEOUT,
        phoneNumber: paymentState?.phoneNumber || phone,
        amount: analyticsAmount,
        serviceName,
        requestId: paymentState?.requestId,
        paymentId: paymentState?.paymentId,
        reference,
        draftId,
        dedupe: true,
      });
    }
  }, [analyticsAmount, draftId, paymentState?.paymentId, paymentState?.phoneNumber, paymentState?.requestId, phone, reference, serviceName, status]);

  const goBack = () => {
    if (effectiveReturnTo && effectiveReturnTo !== "/app/progress") {
      navigate(effectiveReturnTo, { replace: true });
      return;
    }
    smartBack(navigate, "/app/home");
  };

  const openLegalDoc = (docKey) => {
    navigate(buildLegalDocRoute(docKey, { scope: "app" }), {
      state: { backTo: `${location.pathname}${location.search}` },
    });
  };

  const handleContinue = () => {
    navigate(effectiveReturnTo, { replace: true });
  };

  const handleStartPayment = async () => {
    const latestDraft = getDummyPaymentDraft(draftId);
    const latestPayload = resolveCheckoutPayload(latestDraft, queryReturnTo);
    const latestContext =
      latestPayload?.paymentContext && typeof latestPayload.paymentContext === "object"
        ? latestPayload.paymentContext
        : {};

    const user = auth.currentUser;
    if (!user?.uid) {
      setStatus("failed");
      setMessage("You must be signed in to start payment.");
      return;
    }

    if (!draftId || !latestDraft || !latestPayload) {
      setStatus("failed");
      setMessage("This payment draft could not be found. Please go back and start again.");
      return;
    }

    const checkoutPhone = normalizeSafaricomMpesaNumber(phone);
    if (!checkoutPhone) {
      setStatus("failed");
      setMessage("Please enter a valid Safaricom M-Pesa number");
      return;
    }
    setPhone(checkoutPhone);

    if (
      !safeStr(latestContext?.track, 40) ||
      !safeStr(latestContext?.country, 120) ||
      !safeStr(latestContext?.serviceName, 180)
    ) {
      setStatus("failed");
      setMessage("This request is missing checkout details. Please go back and reopen it.");
      return;
    }

    const existingPaymentState = paymentStateRef.current || {};
    sendPaymentDropoffEvent({
      step: PAYMENT_DROPOFF_STEPS.INITIATED,
      phoneNumber: checkoutPhone,
      amount: parseAmountNumber(latestPayload?.amount),
      serviceName: safeStr(latestContext?.serviceName, 180) || serviceName,
      requestId: safeStr(existingPaymentState?.requestId, 180),
      draftId,
    });

    setWorking(true);
    setStatus("starting");
    setMessage("");
    clearDummyPaymentState(draftId);
    setPaymentState({
      requestId: safeStr(existingPaymentState?.requestId, 180),
      phoneNumber: checkoutPhone,
    });

    try {
      const userState = await getUserState(user.uid).catch(() => null);
      const pricingQuote = await getRequestPricingQuote({
        pricingKey: safeStr(latestContext?.pricingKey, 180),
        track: safeStr(latestContext?.track, 40),
        country: safeStr(latestContext?.country, 120),
        serviceName: safeStr(latestContext?.serviceName, 180),
        requestType: safeStr(latestContext?.requestType || "single", 40),
      });
      const appliedPricing = toRequestPricingSnapshot(pricingQuote);
      if (!appliedPricing) {
        throw new Error("Request pricing is unavailable right now. Please try again.");
      }

      let requestId = safeStr(existingPaymentState?.requestId, 180);
      if (!requestId) {
        requestId = await createServiceRequest({
          uid: user.uid,
          email: safeStr(latestPayload?.email || user.email, 200),
          track: safeStr(latestContext?.track, 40),
          country: safeStr(latestContext?.country, 120),
          requestType: safeStr(latestContext?.requestType || "single", 40),
          serviceName: safeStr(latestContext?.serviceName, 180),
          name: safeStr(latestPayload?.name, 140),
          phone: safeStr(latestPayload?.phone, 80),
          note: safeStr(latestPayload?.note, 2000),
          county: safeStr(latestPayload?.county, 120),
          town: safeStr(latestPayload?.town || latestPayload?.city, 120),
          city: safeStr(latestPayload?.city || latestPayload?.town, 120),
          countryOfResidence:
            safeStr(latestContext?.countryOfResidence, 120) ||
            safeStr(userState?.countryOfResidence, 120) ||
            safeStr(latestContext?.country, 120),
          partnerFilterMode:
            safeStr(latestContext?.partnerFilterMode, 40) || "destination_country",
          preferredAgentId: safeStr(latestPayload?.preferredAgentId, 140),
          paid: false,
          paymentMeta: null,
          pricingSnapshot: appliedPricing,
          requestUploadMeta:
            latestPayload?.requestUploadMeta &&
            typeof latestPayload.requestUploadMeta === "object"
              ? latestPayload.requestUploadMeta
              : { count: 0, files: [] },
          extraFieldAnswers:
            latestPayload?.extraFieldAnswers &&
            typeof latestPayload.extraFieldAnswers === "object"
              ? latestPayload.extraFieldAnswers
              : null,
          status: "payment_pending",
          skipAdminPush: true,
        });
      }

      const result = await createUnlockCheckoutSession({
        requestId,
        draftId,
        returnTo: effectiveReturnTo,
        appBaseUrl: typeof window !== "undefined" ? window.location.origin : "",
        phoneNumber: checkoutPhone,
      });

      const nextPaymentState = createStoredPaymentState(result, {
        current: {
          ...existingPaymentState,
          requestId,
        },
        requestId,
        phoneNumber: checkoutPhone,
      });

      setDummyPaymentState(draftId, nextPaymentState);
      setPaymentState(nextPaymentState);
      await persistInitiatedDraft({
        draftId,
        paymentContext: latestContext,
        session: {
          ...result,
          requestId: safeStr(result?.requestId || requestId, 180),
        },
        amountText: latestPayload?.amount,
      });

      if (isSuccessfulMpesaCheckout(nextPaymentState)) {
        const paidState = await persistVerifiedDraft({
          draftId,
          result: {
            ...result,
            requestId: safeStr(result?.requestId || requestId, 180),
          },
          reference: safeStr(result?.reference, 180),
        });
        const successfulPaymentState = {
          ...(paymentStateRef.current && typeof paymentStateRef.current === "object"
            ? paymentStateRef.current
            : {}),
          ...nextPaymentState,
          ...(paidState && typeof paidState === "object" ? paidState : {}),
          checkoutStatus: "success",
          checkoutFailureReason: "",
          resultCode: 0,
          paymentReference: safeStr(result?.reference, 180),
          currentReference: safeStr(result?.reference, 180),
        };
        setDummyPaymentState(draftId, successfulPaymentState);
        setPaymentState(successfulPaymentState);
        setStatus("success");
        setMessage(getMpesaCheckoutMessage(successfulPaymentState));
        return;
      }

      if (isPendingMpesaCheckout(nextPaymentState)) {
        sendPaymentDropoffEvent({
          step: PAYMENT_DROPOFF_STEPS.STK_SENT,
          phoneNumber: checkoutPhone,
          amount:
            roundMoney(nextPaymentState?.amount) || parseAmountNumber(latestPayload?.amount),
          serviceName: safeStr(latestContext?.serviceName, 180) || serviceName,
          requestId: safeStr(nextPaymentState?.requestId || requestId, 180),
          paymentId: safeStr(nextPaymentState?.paymentId, 180),
          reference: safeStr(nextPaymentState?.reference, 180),
          draftId,
          dedupe: true,
        });
        setStatus("pending");
        setMessage(getMpesaCheckoutMessage(nextPaymentState));
        setVerificationNonce((value) => value + 1);
        return;
      }

      setStatus(resolveMpesaCheckoutOutcome(nextPaymentState));
      setMessage(getMpesaCheckoutMessage(nextPaymentState));
    } catch (error) {
      setStatus("failed");
      setMessage(
        safeStr(error?.message, 400) || "Payment checkout could not start right now."
      );
    } finally {
      setWorking(false);
    }
  };

  const handleCheckAgain = async () => {
    if (!reference || status !== "pending") {
      setStatus("failed");
      setMessage("Payment reference is missing. Start payment again.");
      return;
    }
    setStatus("pending");
    setMessage("Checking payment status...");
    setVerificationNonce((value) => value + 1);
  };

  const canRetry = new Set(["failed", "cancelled", "timeout", "insufficient"]).has(status);
  const showStatusBanner = canRetry || status === "success";
  const heading =
    status === "success"
      ? "Payment successful"
      : status === "pending"
      ? "Complete payment on your phone"
      : status === "cancelled"
      ? "Payment cancelled"
      : status === "timeout"
      ? "Payment timed out"
      : status === "insufficient"
      ? "Payment needs attention"
      : status === "failed"
      ? "Payment failed"
      : status === "starting"
      ? "Starting checkout"
      : "Pay to unlock your request";
  const summary =
    status === "success"
      ? "The backend has confirmed your M-Pesa payment."
      : status === "pending"
      ? "After you approve the STK push, we will confirm the payment here automatically."
      : status === "starting"
      ? "We are preparing your M-Pesa checkout now."
      : "Enter the Safaricom M-Pesa number that should receive the STK prompt, then press Pay.";
  const bannerCls =
    status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
      : status === "insufficient"
      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200";
  const payButtonDisabled = working || status === "starting" || status === "pending";

  return (
    <div className="min-h-screen bg-zinc-50 px-5 py-6 dark:bg-zinc-950">
      <div className="mx-auto max-w-md">
        <button
          onClick={goBack}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
            M-Pesa Checkout
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {heading}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{summary}</p>

          <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/60">
            <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Service
            </div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {serviceName}
            </div>
            {amountLabel ? (
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Unlock fee: <span className="font-semibold">{amountLabel}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              M-Pesa phone number
            </label>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="e.g. 0712345678"
              className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
              inputMode="tel"
              autoComplete="tel"
              disabled={working || status === "pending"}
            />
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              This number can be different from the contact number on your request.
            </div>
          </div>

          {reference ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-300">
              Reference: {reference}
            </div>
          ) : null}

          {showStatusBanner ? (
            <div className={`mt-4 rounded-2xl border px-3 py-3 text-sm ${bannerCls}`}>
              {message}
            </div>
          ) : null}

          <div className="mt-5 grid gap-2">
            {status === "success" ? (
              <button
                type="button"
                onClick={handleContinue}
                className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Continue request
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartPayment}
                disabled={payButtonDisabled}
                className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {working
                  ? "Starting checkout..."
                  : canRetry
                  ? "Try payment again"
                  : "Pay"}
              </button>
            )}

            {status === "pending" ? (
              <button
                type="button"
                onClick={handleCheckAgain}
                disabled={working}
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
              >
                Check payment status
              </button>
            ) : null}

            <button
              type="button"
              onClick={goBack}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
            >
              Back to request
            </button>
          </div>

          <div className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
            Review{" "}
            <button
              type="button"
              onClick={() => openLegalDoc(LEGAL_DOC_KEYS.ESCROW_POLICY)}
              className="font-semibold text-emerald-700 transition hover:text-emerald-800"
            >
              Escrow Policy
            </button>{" "}
            and{" "}
            <button
              type="button"
              onClick={() => openLegalDoc(LEGAL_DOC_KEYS.REFUND_POLICY)}
              className="font-semibold text-emerald-700 transition hover:text-emerald-800"
            >
              Refund Policy
            </button>
            .
          </div>
        </div>
      </div>
    </div>
  );
}

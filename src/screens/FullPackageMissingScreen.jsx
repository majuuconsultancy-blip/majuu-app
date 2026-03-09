import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "../firebase";
import RequestModal from "../components/RequestModal";
import { createPendingAttachment } from "../services/attachmentservice";
import {
  normalizeFullPackageItems,
  syncFullPackageItemStates,
  toFullPackageItemKey,
} from "../services/fullpackageservice";
import { createServiceRequest } from "../services/requestservice";
import {
  getUserState,
  setActiveProcessDetails,
  upsertUserContact,
} from "../services/userservice";
import { getMissingProfileFields } from "../utils/profileGuard";
import { setSnapshot } from "../resume/resumeEngine";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date ? d.getTime() : 0;
  }
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRequestOutcome(req) {
  const status = String(req?.status || "").trim().toLowerCase();
  const finalDecision = String(req?.finalDecision || "").trim().toLowerCase();
  if (status === "rejected" || finalDecision === "rejected") return "rejected";
  if (status === "closed" || status === "accepted" || finalDecision === "accepted") return "accepted";
  return "submitted";
}

function mapTrack(input) {
  const t = String(input || "").trim().toLowerCase();
  return t === "study" || t === "work" || t === "travel" ? t : "study";
}

function titleForTrack(track) {
  if (track === "work") return "Work Abroad";
  if (track === "travel") return "Travel Abroad";
  return "Study Abroad";
}

function IconBack(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M15 6 9 12l6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M6 12.5 10 16.5 18 7.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconRetry(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M20 6v5h-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLock(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M7.5 11V8.8A4.5 4.5 0 0 1 12 4.3 4.5 4.5 0 0 1 16.5 8.8V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.5 11h11a2 2 0 0 1 2 2v5.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function IconSend(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M3 13.5l18-7.5-7.5 18-2.2-7.1L3 13.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M11.3 16.9 21 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function FullPackageMissingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { track: trackParam } = useParams();
  const queryParams = useMemo(() => new URLSearchParams(location.search || ""), [location.search]);

  const fullPackageId = useMemo(() => {
    const fromState = String(location.state?.fullPackageId || "").trim();
    const fromResumeState = String(location.state?.resumeFullPackage?.fullPackageId || "").trim();
    const fromQuery = String(queryParams.get("fullPackageId") || "").trim();
    return fromState || fromResumeState || fromQuery;
  }, [location.state, queryParams]);

  const fallbackTrack = useMemo(() => {
    const fromRoute = String(trackParam || "").trim();
    if (["study", "work", "travel"].includes(fromRoute.toLowerCase())) return mapTrack(fromRoute);
    return mapTrack(queryParams.get("track"));
  }, [trackParam, queryParams]);

  const [authChecked, setAuthChecked] = useState(false);
  const [uid, setUid] = useState("");
  const [email, setEmail] = useState("");
  const [userState, setUserState] = useState(null);
  const [profileMissing, setProfileMissing] = useState([]);

  const [defaultName, setDefaultName] = useState("");
  const [defaultPhone, setDefaultPhone] = useState("");
  const [defaultCounty, setDefaultCounty] = useState("");
  const [defaultTown, setDefaultTown] = useState("");

  const [fullPackageDoc, setFullPackageDoc] = useState(null);
  const [fullPackageErr, setFullPackageErr] = useState("");
  const [linkedRequests, setLinkedRequests] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [pickedNeed, setPickedNeed] = useState("");
  const [requestModalResumeState, setRequestModalResumeState] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);

  const restoreAppliedRef = useRef(false);
  const syncedItemStateRef = useRef("");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      setAuthChecked(true);
      if (!user) {
        setUid("");
        setEmail("");
        setUserState(null);
        setProfileMissing([]);
        return;
      }

      setUid(user.uid);
      setEmail(user.email || "");
      try {
        const s = await getUserState(user.uid, user.email || "");
        setUserState(s || null);
        setDefaultName(String(s?.name || ""));
        setDefaultPhone(String(s?.phone || ""));
        setDefaultCounty(String(s?.county || ""));
        setDefaultTown(String(s?.town || s?.city || ""));
        setProfileMissing(getMissingProfileFields(s || {}));
      } catch (error) {
        console.error("FullPackageMissing getUserState error:", error);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid || !fullPackageId) return;
    const ref = doc(db, "fullPackages", fullPackageId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setFullPackageDoc(null);
          setFullPackageErr("Full package not found. Please start again from We-Help.");
          return;
        }
        const data = { id: snap.id, ...snap.data() };
        if (String(data.uid || "") !== String(uid || "")) {
          setFullPackageDoc(null);
          setFullPackageErr("This full package belongs to a different account.");
          return;
        }
        setFullPackageErr("");
        setFullPackageDoc(data);
      },
      (error) => {
        setFullPackageDoc(null);
        setFullPackageErr(error?.message || "Failed to load full package.");
      }
    );
    return () => unsub();
  }, [uid, fullPackageId]);

  useEffect(() => {
    if (!uid || !fullPackageId) return;
    const reqQ = query(collection(db, "serviceRequests"), where("fullPackageId", "==", fullPackageId));
    const unsub = onSnapshot(
      reqQ,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((row) => String(row.uid || "") === uid && Boolean(row.isFullPackage));
        setLinkedRequests(rows);
      },
      (error) => {
        console.error("full package serviceRequests snapshot error:", error);
      }
    );
    return () => unsub();
  }, [uid, fullPackageId]);

  const safeTrack = useMemo(
    () => mapTrack(fullPackageDoc?.track || queryParams.get("track") || fallbackTrack),
    [fullPackageDoc?.track, queryParams, fallbackTrack]
  );
  const country = useMemo(
    () => String(fullPackageDoc?.country || queryParams.get("country") || "Not selected"),
    [fullPackageDoc?.country, queryParams]
  );
  const trackTitle = useMemo(() => titleForTrack(safeTrack), [safeTrack]);

  const selectedItems = useMemo(() => {
    const fromDoc = normalizeFullPackageItems(fullPackageDoc?.selectedItems);
    if (fromDoc.length > 0) return fromDoc;
    return normalizeFullPackageItems(location.state?.missingItems);
  }, [fullPackageDoc?.selectedItems, location.state]);

  const depositPaid = Boolean(fullPackageDoc?.depositPaid);
  const canUseRequestFlow = Boolean(uid) && profileMissing.length === 0 && depositPaid;
  const backToWeHelpHref = `/app/${safeTrack}/we-help?country=${encodeURIComponent(country)}`;

  const latestByItemKey = useMemo(() => {
    const map = new Map();
    for (const req of linkedRequests) {
      const key = String(
        req.fullPackageItemKey ||
          toFullPackageItemKey(req.fullPackageItem || req.serviceName || "")
      ).trim();
      if (!key) continue;

      const ts = Math.max(toMillis(req.updatedAt), toMillis(req.decidedAt), toMillis(req.createdAt));
      const existing = map.get(key);
      if (!existing || ts >= existing.__ts) map.set(key, { ...req, __ts: ts });
    }
    return map;
  }, [linkedRequests]);

  const itemRows = useMemo(() => {
    return selectedItems.map((item) => {
      const key = toFullPackageItemKey(item);
      const latestRequest = latestByItemKey.get(key) || null;
      const outcome = latestRequest ? normalizeRequestOutcome(latestRequest) : "not_started";

      let state = "NOT_STARTED";
      if (outcome === "accepted") state = "DONE";
      else if (outcome === "rejected") state = "RETRY";
      else if (latestRequest) state = "SUBMITTED";

      return {
        key,
        item,
        state,
        latestRequest,
        clickable: state === "NOT_STARTED" || state === "RETRY",
      };
    });
  }, [selectedItems, latestByItemKey]);

  const itemStatePayload = useMemo(() => {
    const out = {};
    for (const row of itemRows) {
      if (row.state === "DONE") out[row.key] = "accepted";
      else if (row.state === "SUBMITTED") out[row.key] = "submitted";
      else if (row.state === "RETRY") out[row.key] = "rejected";
      else out[row.key] = "not_started";
    }
    return out;
  }, [itemRows]);

  useEffect(() => {
    if (!fullPackageId || !depositPaid || !Object.keys(itemStatePayload).length) return;
    const serialized = JSON.stringify(itemStatePayload);
    if (serialized === syncedItemStateRef.current) return;
    syncedItemStateRef.current = serialized;
    syncFullPackageItemStates({ fullPackageId, itemStates: itemStatePayload }).catch((error) => {
      console.warn("Failed to sync full package item states:", error?.message || error);
    });
  }, [fullPackageId, depositPaid, itemStatePayload]);

  useEffect(() => {
    if (restoreAppliedRef.current) return;
    if (!canUseRequestFlow) return;
    const resumeState = location.state?.resumeFullPackage;
    if (!resumeState) return;

    restoreAppliedRef.current = true;
    const selectedItem = String(
      resumeState?.selectedItem || resumeState?.requestModal?.selectedItem || ""
    ).trim();
    if (selectedItem) {
      queueMicrotask(() => setPickedNeed(selectedItem));
    }

    const modalState = resumeState?.requestModal;
    if (modalState?.open) {
      const fallbackItem =
        selectedItem || itemRows.find((x) => x.clickable)?.item || itemRows[0]?.item || "";
      if (!fallbackItem) return;
      queueMicrotask(() => {
        setPickedNeed(fallbackItem);
        setRequestModalResumeState(modalState);
        setModalOpen(true);
        setAutoOpened(true);
      });
    }
  }, [location.state, canUseRequestFlow, itemRows]);

  useEffect(() => {
    if (autoOpened || !canUseRequestFlow) return;
    const shouldAutoOpen = queryParams.get("autoOpen") === "1";
    const retryItemKey = String(queryParams.get("retryItemKey") || "").trim();
    const fallbackItem = String(queryParams.get("item") || "").trim();
    if (!shouldAutoOpen && !retryItemKey && !fallbackItem) return;

    const byRetryKey = retryItemKey ? itemRows.find((row) => row.key === retryItemKey) : null;
    const byFallbackItem = fallbackItem
      ? itemRows.find((row) => row.item === fallbackItem || row.key === toFullPackageItemKey(fallbackItem))
      : null;
    const firstClickable = itemRows.find((row) => row.clickable);
    const picked = byRetryKey || byFallbackItem || firstClickable || null;
    if (!picked || !picked.clickable) return;
    queueMicrotask(() => {
      setPickedNeed(picked.item);
      setModalOpen(true);
      setAutoOpened(true);
    });
  }, [autoOpened, canUseRequestFlow, queryParams, itemRows]);

  const openNeed = (row) => {
    if (!row?.clickable || !canUseRequestFlow) return;
    setRequestModalResumeState(null);
    setPickedNeed(row.item);
    setModalOpen(true);
  };

  const submitFullPackage = async ({
    name,
    phone,
    note,
    dummyFiles,
    requestUploadMeta,
    email: formEmail,
    county,
    town,
    paid,
    paymentMeta,
  }) => {
    if (!uid || !fullPackageId || !pickedNeed) return;

    const missingNow = getMissingProfileFields(userState || {});
    if (missingNow.length > 0) {
      alert(`Please complete your profile first:\n- ${missingNow.join("\n- ")}`);
      setModalOpen(false);
      navigate("/app/profile");
      return;
    }
    if (!depositPaid) {
      throw new Error("Deposit is required before submitting full package items.");
    }

    try {
      const cleanName = String(name || "").trim();
      const cleanPhone = String(phone || "").trim();
      if (cleanName && cleanPhone) {
        await upsertUserContact(uid, { name: cleanName, phone: cleanPhone });
        setDefaultName(cleanName);
        setDefaultPhone(cleanPhone);
        setUserState((prev) => ({ ...(prev || {}), name: cleanName, phone: cleanPhone }));
      }
    } catch (error) {
      console.warn("upsertUserContact failed (continuing):", error);
    }

    const itemKey = toFullPackageItemKey(pickedNeed);
    const parentRequestId = String(latestByItemKey.get(itemKey)?.id || "");
    const finalNote = String(note || "").trim();

    const requestId = await createServiceRequest({
      uid,
      email: String(formEmail || email || "").trim(),
      track: safeTrack,
      country,
      requestType: "full",
      serviceName: "Full Package",
      missingItems: selectedItems,
      name,
      phone,
      note: finalNote,
      county: String(county || "").trim(),
      town: String(town || "").trim(),
      city: String(town || "").trim(),
      paid: Boolean(paid),
      paymentMeta: paymentMeta || null,
      requestUploadMeta: requestUploadMeta || { count: 0, files: [] },
      parentRequestId,
      isFullPackage: true,
      fullPackageId,
      fullPackageItem: pickedNeed,
      fullPackageItemKey: itemKey,
      fullPackageSelectedItems: selectedItems,
    });

    const files = Array.isArray(dummyFiles) ? dummyFiles : [];
    for (const file of files) {
      await createPendingAttachment({ requestId, file });
    }

    await setActiveProcessDetails(uid, {
      hasActiveProcess: true,
      activeTrack: safeTrack,
      activeCountry: country,
      activeHelpType: "we",
      activeRequestId: requestId,
    });

    setSnapshot({
      route: { path: `/app/request/${requestId}`, search: "" },
      weHelp: { activeRequestId: requestId },
    });

    setModalOpen(false);
    navigate(`/app/request/${requestId}`, { replace: true });
  };

  useEffect(() => {
    setSnapshot({
      route: { path: location.pathname, search: location.search || "" },
      weHelp: {
        track: safeTrack,
        country,
        fullPackage: {
          screen: "missing",
          fullPackageId: fullPackageId || "",
          selectedItem: pickedNeed || "",
          requestModal: {
            open: modalOpen,
            step: requestModalResumeState?.step || (modalOpen ? "form" : "closed"),
            formState: requestModalResumeState?.formState || null,
            selectedItem: pickedNeed || "",
          },
        },
      },
    });
  }, [
    location.pathname,
    location.search,
    safeTrack,
    country,
    fullPackageId,
    pickedNeed,
    modalOpen,
    requestModalResumeState,
  ]);

  if (!authChecked) {
    return (
      <div className="min-h-screen px-5 py-10">
        <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5">
          <div className="text-base font-semibold">Reconnecting...</div>
          <div className="mt-1 text-sm text-zinc-600">Restoring your session.</div>
        </div>
      </div>
    );
  }

  if (authChecked && !uid) {
    return (
      <div className="min-h-screen px-5 py-10">
        <div className="rounded-3xl border border-zinc-200 bg-white/80 p-5">
          <div className="text-base font-semibold">You are signed out</div>
          <div className="mt-1 text-sm text-zinc-600">Please sign in again to continue.</div>
          <button onClick={() => navigate("/login", { replace: true })} className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white active:scale-[0.99]">
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (!fullPackageId) {
    return (
      <div className="min-h-screen px-5 py-10">
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800">
          <div className="text-base font-semibold">Invalid full package link</div>
          <div className="mt-1 text-sm">Open Full Package from We-Help to continue.</div>
          <button onClick={() => navigate(backToWeHelpHref, { replace: true })} className="mt-4 w-full rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700">
            Back to We-Help
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-6">
      <button onClick={() => navigate(backToWeHelpHref, { replace: true })} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
        <IconBack className="h-5 w-5" />
        Back
      </button>

      <div className="rounded-3xl border border-zinc-200 bg-white/80 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">
              Full package hub
            </div>
            <h1 className="mt-2 text-lg font-semibold text-zinc-900">{trackTitle} - Continue your full package</h1>
            <p className="mt-1 text-sm text-zinc-600">Country: <span className="font-semibold text-zinc-900">{country}</span></p>
          </div>
          <span className={["rounded-full border px-2.5 py-1 text-xs font-semibold", depositPaid ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"].join(" ")}>
            {depositPaid ? "Deposit paid" : "Deposit required"}
          </span>
        </div>
      </div>

      {fullPackageErr ? <div className="mt-4 rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{fullPackageErr}</div> : null}

      {!depositPaid ? (
        <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-200 bg-white text-amber-900">
              <IconLock className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-semibold text-zinc-900">Deposit payment is required</div>
              <div className="mt-1 text-sm text-zinc-700">This hub is locked until the deposit is paid from the full package diagnostic modal.</div>
            </div>
          </div>
          <button onClick={() => navigate(backToWeHelpHref, { replace: true })} className="mt-4 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
            Back to Full Package
          </button>
        </div>
      ) : null}

      {profileMissing.length > 0 ? (
        <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="text-sm font-semibold text-zinc-900">Complete your profile to continue</div>
          <div className="mt-1 text-sm text-zinc-700">Missing: <span className="font-semibold">{profileMissing.join(", ")}</span></div>
          <button onClick={() => navigate("/app/profile")} className="mt-4 w-full rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white">
            Go to Profile
          </button>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {itemRows.length === 0 ? (
          <div className="rounded-3xl border border-zinc-200 bg-white/70 p-4 text-sm text-zinc-600">No selected items found for this full package.</div>
        ) : (
          itemRows.map((row) => {
            const isSubmitted = row.state === "SUBMITTED";
            const isDone = row.state === "DONE";
            const isRetry = row.state === "RETRY";
            const disabled = !canUseRequestFlow || !row.clickable;

            const badgeLabel = isDone ? "Done" : isSubmitted ? "Already applied" : isRetry ? "Try again" : "Open";
            const subLabel = isDone
              ? "Done"
              : isSubmitted
                ? "Already applied"
                : isRetry
                  ? "Last request was rejected. Try again."
                  : "Start this step.";

            return (
              <button key={row.key} type="button" disabled={disabled} onClick={() => openNeed(row)} className={["w-full rounded-3xl border p-4 text-left shadow-sm transition", disabled ? "cursor-not-allowed border-zinc-200 bg-zinc-50/70 text-zinc-500" : isRetry ? "border-rose-200 bg-rose-50/70 hover:bg-rose-50" : "border-zinc-200 bg-white/75 hover:border-emerald-200 hover:bg-white"].join(" ")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-zinc-900">{row.item}</div>
                    <div className="mt-1 text-sm text-zinc-600">{subLabel}</div>
                  </div>
                  <span className={["inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold", isDone ? "border-emerald-200 bg-emerald-50 text-emerald-900" : isSubmitted ? "border-zinc-200 bg-white text-zinc-700" : isRetry ? "border-rose-200 bg-white text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-900"].join(" ")}>
                    {isDone ? <IconCheck className="h-3.5 w-3.5" /> : null}
                    {isRetry ? <IconRetry className="h-3.5 w-3.5" /> : null}
                    {!isDone && !isRetry ? <IconSend className="h-3.5 w-3.5" /> : null}
                    {badgeLabel}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      <RequestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={submitFullPackage}
        title={pickedNeed ? `Continue: ${pickedNeed}` : "Continue Full Package"}
        subtitle={`${trackTitle} - ${country}`}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        defaultEmail={auth.currentUser?.email || email || ""}
        defaultCounty={defaultCounty}
        defaultTown={defaultTown}
        paymentContext={{
          flow: "fullPackage",
          track: safeTrack,
          country,
          selectedItem: pickedNeed || "",
          fullPackageId: fullPackageId || "",
        }}
        initialState={requestModalResumeState?.formState || null}
        onStateChange={setRequestModalResumeState}
        enableAttachments={true}
        maxPdfMb={10}
      />
    </div>
  );
}

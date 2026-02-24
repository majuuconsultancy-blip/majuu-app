// requestservice.js (REPLACE with this)
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { sendPushToAdmin } from "./pushServerClient";

function cleanStr(x, max = 500) {
  return String(x || "").trim().slice(0, max);
}

function cleanTrack(x) {
  const t = cleanStr(x, 20).toLowerCase();
  return t === "study" || t === "work" || t === "travel" ? t : "study";
}

function cleanRequestType(x) {
  const t = cleanStr(x, 20).toLowerCase();
  return t === "full" ? "full" : "single";
}

function cleanUploadMeta(meta) {
  const raw = meta && typeof meta === "object" ? meta : null;
  const files = Array.isArray(raw?.files) ? raw.files : [];

  const cleanedFiles = files
    .slice(0, 20)
    .map((f) => ({
      name: cleanStr(f?.name, 120) || "file",
      size: Number(f?.size || 0),
      type: cleanStr(f?.type, 80),
      lastModified: Number(f?.lastModified || 0),
    }))
    .filter((f) => f.name);

  const count =
    typeof raw?.count === "number"
      ? Math.max(0, Math.min(20, raw.count))
      : cleanedFiles.length;

  const note = cleanStr(raw?.note, 200);

  // ✅ keep DB clean: store null if nothing was selected
  if (count <= 0 || cleanedFiles.length === 0) return null;

  return { count, files: cleanedFiles, note };
}

function cleanPaymentMeta(meta) {
  const raw = meta && typeof meta === "object" ? meta : null;

  const cleaned = {
    status: cleanStr(raw?.status, 40),
    method: cleanStr(raw?.method, 40),
    paidAt: Number(raw?.paidAt || 0),
    ref: cleanStr(raw?.ref, 80),
  };

  // ✅ store null unless there's meaningful data
  const hasAny = cleaned.status || cleaned.method || cleaned.paidAt > 0 || cleaned.ref;

  return hasAny ? cleaned : null;
}

// Helpers for auth soft gate + safety
function requireSignedInUser() {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be logged in to send a request.");
  return user;
}

function ensureVerified(user) {
  // ✅ Soft gate: block email/password accounts until verified
  // Google accounts usually come verified, so they pass.
  if (!user.emailVerified) {
    const err = new Error("Please verify your email before sending a request.");
    err.code = "auth/email-not-verified";
    throw err;
  }
}

export async function createServiceRequest(payload) {
  // ✅ Ensure we have a signed-in user
  const user = requireSignedInUser();

  // ✅ Extra safety: payload uid must match current user
  const payloadUid = cleanStr(payload?.uid, 80);
  if (!payloadUid) throw new Error("Missing uid");
  if (payloadUid !== user.uid) {
    throw new Error("Auth mismatch. Please sign in again and retry.");
  }

  // ✅ Soft gate here (central enforcement)
  ensureVerified(user);

  const ref = collection(db, "serviceRequests");

  const requestType = cleanRequestType(payload?.requestType);
  const isSingle = requestType === "single";
  const isFull = requestType === "full";

  const cleanMissingItems = isFull
    ? Array.from(
        new Set(
          (Array.isArray(payload?.missingItems) ? payload.missingItems : [])
            .map((x) => cleanStr(x, 80))
            .filter(Boolean)
        )
      ).slice(0, 50)
    : [];

  const cleanServiceName = isSingle
    ? cleanStr(payload?.serviceName, 80)
    : isFull
    ? cleanStr(payload?.serviceName || "Full Package", 80)
    : "";

  const parentRequestId = cleanStr(payload?.parentRequestId, 64);

  const paid = Boolean(payload?.paid);
  const paymentMetaRaw = cleanPaymentMeta(payload?.paymentMeta);
  const paymentMeta = paid ? paymentMetaRaw : null;

  const requestUploadMeta = cleanUploadMeta(payload?.requestUploadMeta);

  const clean = {
    uid: user.uid,
    // prefer auth email (more trustworthy), fallback to payload
    email: cleanStr(user.email || payload?.email, 120),

    track: cleanTrack(payload?.track),
    country: cleanStr(payload?.country, 80),

    requestType,
    serviceName: cleanServiceName,

    name: cleanStr(payload?.name, 120),
    phone: cleanStr(payload?.phone, 40),
    note: cleanStr(payload?.note, 1500),

    city: cleanStr(payload?.city, 80),

    missingItems: cleanMissingItems,
    parentRequestId: parentRequestId || "",

    paid,
    paymentMeta,
    requestUploadMeta,

    status: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const docRef = await addDoc(ref, clean);
  try {
    await sendPushToAdmin({
      title: "New request",
      body: "A new service request was submitted.",
      data: {
        type: "NEW_REQUEST",
        requestId: docRef.id,
        route: `/app/admin/request/${encodeURIComponent(docRef.id)}`,
      },
    });
  } catch (error) {
    console.warn("Failed to trigger NEW_REQUEST push:", error?.message || error);
  }
  return docRef.id;
}

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

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
  const hasAny =
    cleaned.status || cleaned.method || cleaned.paidAt > 0 || cleaned.ref;

  return hasAny ? cleaned : null;
}

export async function createServiceRequest(payload) {
  if (!payload?.uid) throw new Error("Missing uid");

  const ref = collection(db, "serviceRequests");

  const requestType = cleanRequestType(payload.requestType);
  const isSingle = requestType === "single";
  const isFull = requestType === "full";

  const cleanMissingItems = isFull
    ? Array.from(
        new Set(
          (Array.isArray(payload.missingItems) ? payload.missingItems : [])
            .map((x) => cleanStr(x, 80))
            .filter(Boolean)
        )
      ).slice(0, 50)
    : [];

  const cleanServiceName = isSingle
    ? cleanStr(payload.serviceName, 80)
    : isFull
    ? cleanStr(payload.serviceName || "Full Package", 80)
    : "";

  const parentRequestId = cleanStr(payload.parentRequestId, 64);

  const paid = Boolean(payload?.paid);
  const paymentMetaRaw = cleanPaymentMeta(payload?.paymentMeta);
  const paymentMeta = paid ? paymentMetaRaw : null;

  const requestUploadMeta = cleanUploadMeta(payload?.requestUploadMeta);

  const clean = {
    uid: cleanStr(payload.uid, 80),
    email: cleanStr(payload.email, 120),

    track: cleanTrack(payload.track),
    country: cleanStr(payload.country, 80),

    requestType,
    serviceName: cleanServiceName,

    name: cleanStr(payload.name, 120),
    phone: cleanStr(payload.phone, 40),
    note: cleanStr(payload.note, 1500),

    city: cleanStr(payload.city, 80),

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
  return docRef.id;
}
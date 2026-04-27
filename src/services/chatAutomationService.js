import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

function safeStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

export function getChatAutoAccept(requestData) {
  return requestData?.chatAutoAccept === true;
}

export async function setChatAutoAccept({ requestId, enabled }) {
  const safeRequestId = safeStr(requestId, 180);
  if (!safeRequestId) {
    throw new Error("requestId is required.");
  }

  const actorUid = safeStr(auth.currentUser?.uid, 180);
  if (!actorUid) {
    throw new Error("You must be signed in.");
  }

  const nowMs = Date.now();
  await setDoc(
    doc(db, "serviceRequests", safeRequestId),
    {
      chatAutoAccept: enabled === true,
      chatAutoAcceptUpdatedAt: serverTimestamp(),
      chatAutoAcceptUpdatedAtMs: nowMs,
      chatAutoAcceptUpdatedBy: actorUid,
    },
    { merge: true }
  );

  return {
    ok: true,
    requestId: safeRequestId,
    chatAutoAccept: enabled === true,
    updatedBy: actorUid,
  };
}

// ✅ src/components/RequestChatLauncher.jsx (FULL COPY-PASTE)
// GOAL:
// ✅ When closing chat (X / back), return to the *request status* screen (service request),
// NOT ProgressScreen.
// FIX:
// - Capture the current route (pathname + search) when user opens chat
// - On close, navigate back to that saved route (replace), instead of relying on history
// - If missing, fallback to /app/request/:id

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onSnapshot, collection, doc } from "firebase/firestore";
import { useLocation, useNavigate } from "react-router-dom";

import { auth, db } from "../firebase";
import RequestChatPanel from "./RequestChatPanel";

function safeStr(x) {
  return String(x || "").trim();
}

function IconChat(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 18.2l-3 2V6.8A3 3 0 0 1 7 3.8h10A3 3 0 0 1 20 6.8v7.4a3 3 0 0 1-3 3H7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7.8 8.7h8.4M7.8 12h5.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function RequestChatLauncher({ requestId }) {
  const navigate = useNavigate();
  const location = useLocation();

  const rid = useMemo(() => safeStr(requestId), [requestId]);

  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ✅ remember where chat was opened from (request status screen route)
  const returnToRef = useRef("");

  // ✅ body-portal ready flag (SSR-safe + avoids hydration issues)
  const [canPortal, setCanPortal] = useState(false);
  useEffect(() => setCanPortal(true), []);

  useEffect(() => {
    if (!rid) return;

    const u = auth.currentUser;
    if (!u) return;

    let unsubMsgs = null;
    let unsubRead = null;

    // ✅ Must match chatservice.js markRequestChatRead docId format
    const readId = `user_${u.uid}`;
    const readRef = doc(db, "serviceRequests", rid, "readState", readId);

    let lastReadMillis = 0;

    unsubRead = onSnapshot(
      readRef,
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        const ts = d?.lastReadAt;
        lastReadMillis = ts?.toMillis ? ts.toMillis() : 0;
      },
      () => {}
    );

    const msgRef = collection(db, "serviceRequests", rid, "messages");
    unsubMsgs = onSnapshot(
      msgRef,
      (snap) => {
        let c = 0;
        snap.docs.forEach((docu) => {
          const m = docu.data() || {};
          const toRole = String(m.toRole || "").toLowerCase();
          const created = m.createdAt?.toMillis ? m.createdAt.toMillis() : 0;
          if (toRole === "user" && created > lastReadMillis) c += 1;
        });
        setUnreadCount(c);
      },
      () => {}
    );

    return () => {
      if (unsubMsgs) unsubMsgs();
      if (unsubRead) unsubRead();
    };
  }, [rid]);

  // ✅ lock scroll while modal is open (mobile-first)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const openChat = () => {
    // ✅ capture the exact current screen (service request status screen)
    // so closing chat returns here, not to ProgressScreen.
    returnToRef.current = `${location.pathname}${location.search || ""}`;
    setOpen(true);
  };

  const closeChat = () => {
    setOpen(false);

    // ✅ return to where chat was opened from
    const backTo = safeStr(returnToRef.current);
    if (backTo) {
      navigate(backTo, { replace: true });
      return;
    }

    // fallback: safe request status route
    if (rid) navigate(`/app/request/${rid}`, { replace: true });
  };

  const btn =
    "w-full inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99]";
  const btnMain = "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";

  const Modal = (
    <div className="fixed inset-0 z-[999999] pointer-events-none" aria-hidden={!open}>
      <div className="absolute inset-0 pointer-events-auto">
        <RequestChatPanel requestId={rid} role="user" onClose={closeChat} />
      </div>
    </div>
  );

  return (
    <>
      <button type="button" onClick={openChat} className={`${btn} ${btnMain}`}>
        <IconChat className="h-5 w-5" />
        CHAT
        {unreadCount > 0 ? (
          <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open && canPortal ? createPortal(Modal, document.body) : null}
    </>
  );
}
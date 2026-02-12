// ✅ src/components/RequestChatLauncher.jsx
// - Shows unread badge (published messages to user after lastReadAt)
// - Opens RequestChatPanel modal

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, collection, doc } from "firebase/firestore";
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
  const rid = useMemo(() => safeStr(requestId), [requestId]);

  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

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

  const btn =
    "w-full inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99]";
  const btnMain =
    "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${btn} ${btnMain}`}
      >
        <IconChat className="h-5 w-5" />
        Chat with MAJUU
        {unreadCount > 0 ? (
          <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <RequestChatPanel
          requestId={rid}
          role="user"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
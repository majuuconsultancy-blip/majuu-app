import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
import RequestChatPanel from "./RequestChatPanel";

function safeStr(x, max = 500) {
  return String(x || "").trim().slice(0, max);
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

export default function RequestChatLauncher({ requestId, variant = "default" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const isFloating = variant === "floating";

  const [open, setOpen] = useState(false);
  const [canPortal] = useState(() => typeof document !== "undefined");
  const returnToRef = useRef("");
  const unreadCount = useNotifsV2Store(
    (s) => (safeStr(rid) ? Number(s.unreadByRequest?.[rid]?.count || 0) || 0 : 0)
  );

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("request-modal-open");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("request-modal-open");
    };
  }, [open]);

  const openChat = useCallback(() => {
    let nextSearch = location.search || "";
    try {
      const params = new URLSearchParams(location.search || "");
      params.delete("openChat");
      const qs = params.toString();
      nextSearch = qs ? `?${qs}` : "";
    } catch {
      // ignore malformed URLSearchParams
    }
    returnToRef.current = `${location.pathname}${nextSearch}`;
    if (rid) notifsV2Store.markChatRead(rid).catch(() => {});
    setOpen(true);
  }, [location.pathname, location.search, rid]);

  useEffect(() => {
    if (!rid || open) return;
    let params = null;
    try {
      params = new URLSearchParams(location.search || "");
    } catch {
      return;
    }
    if (params.get("openChat") !== "1") return;

    const timer = window.setTimeout(() => openChat(), 0);

    params.delete("openChat");
    const qs = params.toString();
    const nextUrl = `${location.pathname}${qs ? `?${qs}` : ""}`;
    if (nextUrl !== `${location.pathname}${location.search || ""}`) {
      navigate(nextUrl, { replace: true });
    }

    return () => window.clearTimeout(timer);
  }, [rid, open, location.pathname, location.search, navigate, openChat]);

  useEffect(() => {
    if (!rid || open) return;
    try {
      const params = new URLSearchParams(location.search || "");
      if (params.get("openChat") === "1") return;
    } catch {
      // ignore malformed URLSearchParams
    }
    let shouldOpen = false;
    try {
      shouldOpen = sessionStorage.getItem(`maj_open_chat:${rid}`) === "1";
      if (shouldOpen) sessionStorage.removeItem(`maj_open_chat:${rid}`);
    } catch {
      // ignore session storage errors
    }
    if (!shouldOpen) return;
    const timer = window.setTimeout(() => openChat(), 0);
    return () => window.clearTimeout(timer);
  }, [rid, open, openChat, location.search]);

  const closeChat = useCallback(() => {
    setOpen(false);
    const backTo = safeStr(returnToRef.current);
    if (backTo) {
      navigate(backTo, { replace: true });
      return;
    }
    if (rid) navigate(`/app/request/${rid}`, { replace: true });
  }, [navigate, rid]);

  useEffect(() => {
    if (!open) return;
    const onAndroidBack = (event) => {
      event.preventDefault();
      closeChat();
    };
    window.addEventListener("majuu:back", onAndroidBack);
    return () => window.removeEventListener("majuu:back", onAndroidBack);
  }, [open, closeChat]);

  const btn =
    "w-full inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition active:scale-[0.99]";
  const btnMain = "border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const floatingBtn =
    "relative inline-flex min-h-[3.75rem] items-center justify-center gap-2 rounded-full border border-emerald-200 bg-emerald-600 px-4 text-white shadow-[0_14px_30px_rgba(5,150,105,0.34)] transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 active:scale-[0.97]";
  const floatingUnreadPerimeter =
    "pointer-events-none absolute -inset-1 rounded-full border border-rose-300/85 shadow-[0_0_0_1px_rgba(248,113,113,0.35),0_0_18px_rgba(248,113,113,0.22)] animate-[pulse_2s_ease-in-out_infinite]";

  const Modal = (
    <div className="fixed inset-0 z-[999999] pointer-events-none" aria-hidden={!open}>
      <div className="absolute inset-0 pointer-events-auto">
        <RequestChatPanel requestId={rid} role="user" onClose={closeChat} />
      </div>
    </div>
  );

  return (
    <>
      {isFloating ? (
        <button
          type="button"
          onClick={openChat}
          className={floatingBtn}
          aria-label="Open chat"
          title="Chat"
        >
          {unreadCount > 0 ? <span aria-hidden="true" className={floatingUnreadPerimeter} /> : null}
          <IconChat className="h-7 w-7" />
          <span className="text-sm font-semibold">Chat</span>
        </button>
      ) : (
        <button type="button" onClick={openChat} className={`${btn} ${btnMain}`}>
          <IconChat className="h-5 w-5" />
          CHAT
          {unreadCount > 0 ? (
            <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-zinc-900/60">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </button>
      )}

      {open && canPortal ? createPortal(Modal, document.body) : null}
    </>
  );
}

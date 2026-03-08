import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import AdminRequestChatPanel from "./AdminRequestChatPanel";

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
      <path d="M7.8 8.7h8.4M7.8 12h5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function AdminRequestChatLauncher({ requestId }) {
  const navigate = useNavigate();
  const location = useLocation();
  const rid = useMemo(() => safeStr(requestId), [requestId]);

  const [open, setOpen] = useState(false);
  const [canPortal] = useState(() => typeof document !== "undefined");
  const returnToRef = useRef("");

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
      // ignore
    }
    returnToRef.current = `${location.pathname}${nextSearch}`;
    setOpen(true);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!rid || open) return;

    let params;
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
      // ignore
    }

    try {
      const key = `maj_open_admin_chat:${rid}`;
      if (sessionStorage.getItem(key) === "1") {
        sessionStorage.removeItem(key);
        const timer = window.setTimeout(() => openChat(), 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [rid, open, openChat, location.search]);

  const closeChat = useCallback(() => {
    setOpen(false);
    const backTo = safeStr(returnToRef.current);
    if (backTo) {
      navigate(backTo, { replace: true });
      return;
    }
    if (rid) navigate(`/app/admin/request/${rid}`, { replace: true });
  }, [navigate, rid]);

  useEffect(() => {
    if (!open) return undefined;
    const onAndroidBack = (event) => {
      event.preventDefault();
      closeChat();
    };
    window.addEventListener("majuu:back", onAndroidBack);
    return () => window.removeEventListener("majuu:back", onAndroidBack);
  }, [open, closeChat]);

  const btn = "inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]";

  const modal = (
    <div className="fixed inset-0 z-[999999] pointer-events-none" aria-hidden={!open}>
      <div className="absolute inset-0 pointer-events-auto">
        <AdminRequestChatPanel requestId={rid} onClose={closeChat} />
      </div>
    </div>
  );

  return (
    <>
      <button type="button" onClick={openChat} className={btn}>
        <IconChat className="h-5 w-5" />
        Open chat
      </button>

      {open && canPortal ? createPortal(modal, document.body) : null}
    </>
  );
}

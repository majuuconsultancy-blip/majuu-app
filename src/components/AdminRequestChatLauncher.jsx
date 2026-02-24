// ✅ src/components/AdminRequestChatLauncher.jsx
// Simple launcher that opens AdminRequestChatPanel in a scrollable modal.

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminRequestChatPanel from "./AdminRequestChatPanel";

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

export default function AdminRequestChatLauncher({ requestId }) {
  const rid = useMemo(() => safeStr(requestId), [requestId]);
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!rid || open) return;
    try {
      const params = new URLSearchParams(location.search || "");
      if (params.get("openChat") === "1") return;
    } catch {}
    let shouldOpen = false;
    try {
      shouldOpen = sessionStorage.getItem(`maj_open_admin_chat:${rid}`) === "1";
      if (shouldOpen) sessionStorage.removeItem(`maj_open_admin_chat:${rid}`);
    } catch {}
    if (shouldOpen) setOpen(true);
  }, [rid, open, location.search]);

  useEffect(() => {
    if (!rid || open) return;
    let params = null;
    try {
      params = new URLSearchParams(location.search || "");
    } catch {
      return;
    }
    if (params.get("openChat") !== "1") return;

    setOpen(true);

    params.delete("openChat");
    const qs = params.toString();
    const nextUrl = `${location.pathname}${qs ? `?${qs}` : ""}`;
    if (nextUrl !== `${location.pathname}${location.search || ""}`) {
      navigate(nextUrl, { replace: true });
    }
  }, [rid, open, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!open) return;

    const onAndroidBack = (event) => {
      // Let the global Android back handler close this modal first.
      event.preventDefault();
      setOpen(false);
    };

    window.addEventListener("majuu:back", onAndroidBack);
    return () => window.removeEventListener("majuu:back", onAndroidBack);
  }, [open]);

  const btn =
    "inline-flex items-center justify-center gap-2 rounded-2xl border px-3.5 py-2 text-sm font-semibold shadow-sm transition active:scale-[0.99]";
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
        Open chat
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          {/* ✅ wrapper limits height; the panel itself already has max-h + overflow */}
          <div className="w-full max-w-xl">
            <AdminRequestChatPanel
              requestId={rid}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

// ✅ src/components/StaffRequestChatLauncher.jsx
// Staff chat launcher:
// - button opens a scrollable modal
// - modal contains StaffRequestChatPanel (the real chat UI)
// - closes cleanly, no page zoom issues

import { useState } from "react";
import StaffRequestChatPanel from "./StaffRequestChatPanel";

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

function IconX(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function StaffRequestChatLauncher({ requestId }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99]"
        title="Open chat"
      >
        <IconChat className="h-5 w-5" />
        Chat
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4">
              <div>
                <div className="text-sm font-semibold text-zinc-900">Staff chat</div>
                <div className="text-xs text-zinc-500">
                  Messages go to admin moderation first. Approved ones reach the user.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                title="Close"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            {/* ✅ Let the panel handle its own scrolling and timestamps */}
            <div className="p-4">
              <StaffRequestChatPanel requestId={requestId} onClose={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
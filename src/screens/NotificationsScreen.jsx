import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronLeft, ChevronRight, CheckCheck } from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD, ICON_LG } from "../constants/iconSizes";
import { motion } from "../utils/motionProxy";

import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
import { navigateFromPayload } from "../services/pushBridge";
import { smartBack } from "../utils/navBack";

function tsToMs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "number") return value || 0;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}

function formatAt(value) {
  const ms = tsToMs(value);
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} • ${time}`;
}

const page = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" } },
};

export default function NotificationsScreen() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");

  const role = useNotifsV2Store((s) => String(s.session?.role || "").toLowerCase());
  const items = useNotifsV2Store((s) => s.notifications || []);
  const unreadCount = useNotifsV2Store((s) => Number(s.unreadNotifCount || 0) || 0);

  const backTo = useMemo(() => {
    if (role === "staff") return "/staff/tasks";
    if (role === "admin") return "/app/home";
    return "/app/progress";
  }, [role]);

  const headingLabel = role === "staff" ? "Staff notifications" : "Notifications";

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";

  const onMarkAll = async () => {
    setBusy("all");
    try {
      await notifsV2Store.markAllNotificationsRead();
    } finally {
      setBusy("");
    }
  };

  const openItem = async (item) => {
    const nid = String(item?.id || "").trim();
    if (!nid) return;

    if (!item?.readAt) {
      setBusy(nid);
      try {
        await notifsV2Store.markNotificationRead(item);
      } finally {
        setBusy("");
      }
    }

    const opened = navigateFromPayload({
      navigate,
      payload: {
        route: item?.route,
        type: item?.type,
        requestId: item?.requestId,
      },
    });

    if (!opened && role === "staff") {
      smartBack(navigate, "/staff/tasks");
    }
  };

  return (
    <div className={pageBg}>
      <motion.div
        variants={page}
        initial="hidden"
        animate="show"
        className="max-w-xl mx-auto px-5 py-6 pb-10"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => smartBack(navigate, backTo)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-white active:scale-[0.99]"
            >
              <AppIcon size={ICON_SM} icon={ChevronLeft} />
              Back
            </button>

            <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {headingLabel}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Real notifications stored in Firestore. Tap one to open it and mark it as read.
            </p>
          </div>

          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-emerald-200">
            <AppIcon size={ICON_MD} icon={Bell} />
          </span>
        </div>

        <div className={`mt-6 ${card} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Inbox
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {items.length} {items.length === 1 ? "notification" : "notifications"} • {unreadCount} unread
              </div>
            </div>
            <button
              type="button"
              onClick={onMarkAll}
              disabled={busy === "all" || unreadCount === 0}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200"
            >
              <AppIcon size={ICON_SM} icon={CheckCheck} />
              {busy === "all" ? "Marking..." : "Mark all as read"}
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className={`mt-4 ${card} p-6 text-center`}>
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60">
              <AppIcon size={ICON_LG} className="text-emerald-700 dark:text-emerald-200" icon={Bell} />
            </div>
            <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No notifications yet
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Updates will appear here when admin actions or moderated messages reach you.
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {items.map((item) => {
              const unread = !item?.readAt;
              const rowBusy = busy === String(item.id || "");
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  disabled={rowBusy}
                  className={`${card} p-4 text-left transition hover:border-emerald-200 hover:shadow-md active:scale-[0.99] disabled:opacity-70`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            unread ? "bg-rose-500" : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        />
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {item.title || "Notification"}
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
                            unread
                              ? "border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                              : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300"
                          }`}
                        >
                          {unread ? "Unread" : "Read"}
                        </span>
                      </div>

                      {item.body ? (
                        <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                          {item.body}
                        </div>
                      ) : null}

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {item.type ? (
                          <span className="rounded-full border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-2 py-0.5">
                            {item.type}
                          </span>
                        ) : null}
                        {item.requestId ? <span className="font-mono">{item.requestId}</span> : null}
                        {item.createdAt ? <span>{formatAt(item.createdAt)}</span> : null}
                      </div>
                    </div>

                    <span className="shrink-0 inline-flex items-center gap-1 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200">
                      Open
                      <AppIcon size={ICON_SM} icon={ChevronRight} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}

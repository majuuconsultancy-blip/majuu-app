import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import { ICON_LG, ICON_MD, ICON_SM } from "../constants/iconSizes";
import { motion as Motion } from "../utils/motionproxy";
import { safeText } from "../utils/safeText";
import { notifsV2Store, useNotifsV2Store } from "../services/notifsV2Store";
import { navigateFromPayload } from "../services/pushBridge";
import { smartBack } from "../utils/navBack";

const LONG_PRESS_MS = 420;

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
  return `${date} - ${time}`;
}

const page = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" } },
};

function shouldHideStaffNotification(item) {
  const type = String(item?.type || "").trim().toUpperCase();
  if (!type) return false;
  return (
    type === "STAFF_ASSIGNED_REQUEST" ||
    type === "STAFF_UNASSIGNED_REQUEST" ||
    type.startsWith("PAYMENT_") ||
    type.startsWith("REFUND_") ||
    type.includes("MESSAGE")
  );
}

function SelectionMark({ selected = false }) {
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded-lg border ${
        selected
          ? "border-emerald-300 bg-emerald-600 text-white"
          : "border-zinc-300 bg-white text-transparent dark:border-zinc-700 dark:bg-zinc-900/60"
      }`}
      aria-hidden="true"
    >
      <AppIcon size={ICON_SM} icon={Check} />
    </span>
  );
}

export default function NotificationsScreen() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const longPressTimerRef = useRef(null);
  const longPressStateRef = useRef({ id: "", fired: false, x: 0, y: 0 });

  const role = useNotifsV2Store((s) => String(s.session?.role || "").toLowerCase());
  const items = useNotifsV2Store((s) => s.notifications || []);

  const backTo = useMemo(() => {
    if (role === "staff") return "/staff/tasks";
    if (role === "admin" || role === "assignedadmin") return "/app/home";
    return "/app/progress";
  }, [role]);

  const headingLabel =
    role === "staff"
      ? "Staff notifications"
      : role === "admin" || role === "assignedadmin"
        ? "Admin notifications"
        : "Notifications";

  const visibleItems = useMemo(() => {
    const rows = Array.isArray(items) ? items : [];
    if (role !== "staff") return rows;
    return rows.filter((item) => !shouldHideStaffNotification(item));
  }, [items, role]);
  const visibleUnreadCount = useMemo(
    () => visibleItems.filter((item) => !item?.readAt).length,
    [visibleItems]
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedSet.has(String(item?.id || "").trim())),
    [visibleItems, selectedSet]
  );
  const selectedUnreadCount = useMemo(
    () => selectedItems.filter((item) => !item?.readAt).length,
    [selectedItems]
  );

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const allowed = new Set(
      visibleItems.map((item) => String(item?.id || "").trim()).filter(Boolean)
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => allowed.has(id));
      if (next.length === 0) setSelectionMode(false);
      return next;
    });
  }, [visibleItems]);

  const pageBg =
    "min-h-screen bg-gradient-to-b from-emerald-50/45 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur";

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const resetLongPressState = () => {
    clearLongPressTimer();
    longPressStateRef.current = { id: "", fired: false, x: 0, y: 0 };
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
    resetLongPressState();
  };

  const toggleSelected = (notificationId) => {
    const nid = String(notificationId || "").trim();
    if (!nid) return;
    setSelectedIds((current) => {
      const exists = current.includes(nid);
      const next = exists ? current.filter((id) => id !== nid) : [...current, nid];
      if (next.length === 0) {
        setSelectionMode(false);
      } else {
        setSelectionMode(true);
      }
      return next;
    });
  };

  const enterSelectionMode = (notificationId) => {
    const nid = String(notificationId || "").trim();
    if (!nid) return;
    setActionErr("");
    setSelectionMode(true);
    setSelectedIds((current) => (current.includes(nid) ? current : [...current, nid]));
  };

  const onMarkAll = async () => {
    setBusy("all");
    setActionErr("");
    try {
      const result = await notifsV2Store.markAllNotificationsRead();
      if (!result?.ok) {
        throw result?.error || new Error("Failed to mark notifications as read.");
      }
    } catch (error) {
      setActionErr(error?.message || "Failed to mark notifications as read.");
    } finally {
      setBusy("");
    }
  };

  const onMarkSelectedRead = async () => {
    if (selectedUnreadCount === 0) return;
    setBusy("selected-read");
    setActionErr("");
    try {
      const unreadRows = selectedItems.filter((item) => !item?.readAt);
      const results = await Promise.all(
        unreadRows.map((item) => notifsV2Store.markNotificationRead(item))
      );
      if (results.some((result) => !result?.ok)) {
        throw new Error("Failed to mark selected notifications as read.");
      }
    } catch (error) {
      setActionErr(error?.message || "Failed to mark selected notifications as read.");
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

  const deleteSingle = async (item) => {
    const nid = String(item?.id || "").trim();
    if (!nid) return;
    setBusy(`delete:${nid}`);
    setActionErr("");
    try {
      const result = await notifsV2Store.deleteNotification(item);
      if (!result?.ok) {
        throw result?.error || new Error("Failed to delete notification.");
      }
    } catch (error) {
      setActionErr(error?.message || "Failed to delete notification.");
    } finally {
      setBusy("");
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    setBusy("delete-selected");
    setActionErr("");
    try {
      const result = await notifsV2Store.deleteNotifications(selectedIds);
      if (!result?.ok) {
        throw result?.error || new Error("Failed to delete selected notifications.");
      }
      clearSelection();
    } catch (error) {
      setActionErr(error?.message || "Failed to delete selected notifications.");
    } finally {
      setBusy("");
    }
  };

  const beginRowLongPress = (event, notificationId) => {
    const nid = String(notificationId || "").trim();
    if (!nid || selectionMode) return;
    if (event?.button != null && event.button !== 0) return;

    clearLongPressTimer();
    longPressStateRef.current = {
      id: nid,
      fired: false,
      x: Number(event?.clientX ?? 0),
      y: Number(event?.clientY ?? 0),
    };

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStateRef.current = { ...longPressStateRef.current, fired: true };
      enterSelectionMode(nid);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    }, LONG_PRESS_MS);
  };

  const cancelRowLongPress = () => {
    if (!longPressStateRef.current.fired) clearLongPressTimer();
  };

  const maybeCancelLongPressOnMove = (event) => {
    if (!longPressTimerRef.current) return;
    const { x, y } = longPressStateRef.current;
    const dx = Math.abs(Number(event?.clientX ?? 0) - x);
    const dy = Math.abs(Number(event?.clientY ?? 0) - y);
    if (dx > 10 || dy > 10) clearLongPressTimer();
  };

  const handleRowPress = async (item) => {
    const nid = String(item?.id || "").trim();
    if (!nid) return;

    if (longPressStateRef.current.fired && longPressStateRef.current.id === nid) {
      longPressStateRef.current = { id: "", fired: false, x: 0, y: 0 };
      return;
    }

    if (selectionMode) {
      toggleSelected(nid);
      return;
    }

    resetLongPressState();
    await openItem(item);
  };

  return (
    <div className={pageBg}>
      <Motion.div
        variants={page}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-xl px-5 py-6 pb-10"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => smartBack(navigate, backTo)}
              className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-emerald-200 hover:bg-white active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
            >
              <AppIcon size={ICON_SM} icon={ChevronLeft} />
              Back
            </button>

            <h1 className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {headingLabel}
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              {selectionMode
                ? `${selectedIds.length} selected`
                : "See your latest alerts, activity updates, and request notifications."}
            </p>
          </div>

          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/70 text-emerald-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-emerald-200">
            <AppIcon size={ICON_MD} icon={Bell} />
          </span>
        </div>

        {actionErr ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200">
            {actionErr}
          </div>
        ) : null}

        <div className={`mt-6 ${card} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Inbox
              </div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {visibleItems.length}{" "}
                {visibleItems.length === 1 ? "notification" : "notifications"} -{" "}
                {visibleUnreadCount} unread
              </div>
            </div>

            {selectionMode ? (
              <div className="flex flex-wrap justify-end gap-2">
                {selectedUnreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={onMarkSelectedRead}
                    disabled={busy === "selected-read"}
                    className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200"
                  >
                    <AppIcon size={ICON_SM} icon={CheckCheck} />
                    {busy === "selected-read" ? "Marking..." : "Mark read"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={busy === "delete-selected" || selectedIds.length === 0}
                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200"
                >
                  <AppIcon size={ICON_SM} icon={Trash2} />
                  {busy === "delete-selected" ? "Deleting..." : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                >
                  <AppIcon size={ICON_SM} icon={X} />
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onMarkAll}
                disabled={busy === "all" || visibleUnreadCount === 0}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200"
              >
                <AppIcon size={ICON_SM} icon={CheckCheck} />
                {busy === "all" ? "Marking..." : "Mark all as read"}
              </button>
            )}
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className={`mt-4 ${card} p-6 text-center`}>
            <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-900/60">
              <AppIcon
                size={ICON_LG}
                className="text-emerald-700 dark:text-emerald-200"
                icon={Bell}
              />
            </div>
            <div className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No notifications yet
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Updates will appear here as soon as there is an activity.
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {visibleItems.map((item) => {
              const nid = String(item?.id || "").trim();
              const unread = !item?.readAt;
              const rowBusy = busy === nid;
              const deleteBusy = busy === `delete:${nid}`;
              const selected = selectedSet.has(nid);

              return (
                <div
                  key={nid}
                  className={`${card} p-4 transition ${
                    selected
                      ? "border-emerald-300 bg-emerald-50/45 dark:border-emerald-900/45 dark:bg-emerald-950/20"
                      : "hover:border-emerald-200 hover:shadow-md"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void handleRowPress(item)}
                      onPointerDown={(event) => beginRowLongPress(event, nid)}
                      onPointerUp={cancelRowLongPress}
                      onPointerCancel={cancelRowLongPress}
                      onPointerLeave={cancelRowLongPress}
                      onPointerMove={maybeCancelLongPressOnMove}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        enterSelectionMode(nid);
                      }}
                      disabled={rowBusy || deleteBusy}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:opacity-70"
                    >
                      {selectionMode ? (
                        <SelectionMark selected={selected} />
                      ) : (
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full ${
                            unread ? "bg-rose-500" : "bg-zinc-300 dark:bg-zinc-600"
                          }`}
                        />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {safeText(item.title) || "Notification"}
                          </div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              unread
                                ? "border-rose-200 bg-rose-50/70 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                                : "border-zinc-200 bg-white/70 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
                            }`}
                          >
                            {unread ? "Unread" : "Read"}
                          </span>
                        </div>

                        {item.body ? (
                          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            {safeText(item.body)}
                          </div>
                        ) : null}

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {item.requestId ? <span className="font-mono">{item.requestId}</span> : null}
                          {item.createdAt ? <span>{formatAt(item.createdAt)}</span> : null}
                        </div>
                      </div>
                    </button>

                    {selectionMode ? null : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void deleteSingle(item)}
                          disabled={deleteBusy || rowBusy}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50/80 text-rose-700 transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200"
                          aria-label="Delete notification"
                          title="Delete notification"
                        >
                          <AppIcon size={ICON_SM} icon={Trash2} />
                        </button>

                        <button
                          type="button"
                          onClick={() => void openItem(item)}
                          disabled={rowBusy || deleteBusy}
                          className="inline-flex items-center gap-1 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 active:scale-[0.99] disabled:opacity-60 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200"
                        >
                          Open
                          <AppIcon size={ICON_SM} icon={ChevronRight} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Motion.div>
    </div>
  );
}

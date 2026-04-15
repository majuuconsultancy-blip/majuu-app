// ✅ AdminRequestsScreen.jsx (FULL COPY-PASTE)
// Stable fix:
// ✅ Filters kept (date range, assigned, staff status, staff recommendation)
// ✅ RED DOTS are now GLOBAL + CONSISTENT:
//    - Uses collectionGroup("pendingMessages") where status=="pending" to know which requests have new messages
//    - For those requestIds, listens to serviceRequests/<id> to classify the correct tab (new/assigned/closed/rejected)
// ✅ No caching based on visited tabs. No per-tab listener teardown flicker.
//
// Notes:
// - If you expect >1000 pending messages at once, increase LIMIT_PENDING.
// - This is frontend-only; your services untouched.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCountryDirectory } from "../hooks/useCountryDirectory";
import {
  adminSoftDeleteRequest,
  getRequests,
  sweepStaleAssignments,
} from "../services/adminrequestservice";
import { routeUnroutedNewRequests } from "../services/adminroutingservice";
import { setStaffAccessByEmail } from "../services/staffservice";
import { getCurrentUserRoleContext } from "../services/adminroleservice";
import { listAssignedAdmins } from "../services/assignedadminservice";
import { STAFF_SPECIALITY_OPTIONS } from "../constants/staffSpecialities";
import {
  applyUnlockAutoRefundSweep,
  listUnlockAutoRefundEligibleRequests,
} from "../services/paymentservice";
import { useNotifsV2Store } from "../services/notifsV2Store";

import {
  collection,
  collectionGroup,
  documentId,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "../firebase";
import { getRequestWorkProgress } from "../utils/requestWorkProgress";

import { motion, AnimatePresence } from "../utils/motionProxy";
import {
  RefreshCw,
  Search,
  ChevronRight,
  ChevronDown,
  UserPlus,
  UserX,
  Users,
  SlidersHorizontal,
  X,
  Calendar,
  Trash2,
  Pin,
  PinOff,
  Settings2,
} from "lucide-react";
import AppIcon from "../components/AppIcon";
import { ICON_SM, ICON_MD, ICON_LG } from "../constants/iconSizes";
import {
  buildCountryAccentRailStyle,
  buildCountryAccentSurfaceStyle,
  resolveCountryAccentColor,
} from "../utils/countryAccent";

// ✅ 4 tabs: New / Accepted / Rejected / Assigned
const TABS = [
  { key: "new", label: "New" },
  { key: "closed", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "assigned", label: "Assigned" },
];
const ACTIVE_REQUEST_STATUSES = ["new", "contacted", "active", "in_progress", "assigned"];

const LIMIT_PENDING = 1000;
const ADMIN_TAB_PINS_KEY = "majuu_admin_requests_pins_by_tab_v1";
const LONG_PRESS_MS = 420;
const SEARCH_DEBOUNCE_MS = 180;
const INITIAL_RENDER_COUNT = 7;
const PERF_TAG = "[perf][AdminRequests]";

function startPerf(label) {
  try {
    console.time(label);
  } catch {
    // no-op
  }
}

function endPerf(label) {
  try {
    console.timeEnd(label);
  } catch {
    // no-op
  }
}

function logIndexHint(scope, error) {
  const raw = String(error?.message || "");
  const match = raw.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/i);
  if (match?.[0]) {
    console.warn(`${PERF_TAG} index hint (${scope}): ${match[0]}`);
  }
}

function readAdminTabPins() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ADMIN_TAB_PINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const next = {};
    TABS.forEach((t) => {
      const arr = Array.isArray(parsed?.[t.key]) ?parsed[t.key] : [];
      next[t.key] = arr.map((v) => String(v || "").trim()).filter(Boolean);
    });
    return next;
  } catch {
    return {};
  }
}

/* ---------- UI helpers ---------- */
function pill(status) {
  const s = String(status || "new").toLowerCase();
  if (s === "new")
    return { label: "New", cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
  if (s === "contacted" || s === "active" || s === "in_progress")
    return {
      label: "In Progress",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  if (s === "closed")
    return {
      label: "Accepted",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  if (s === "rejected")
    return { label: "Rejected", cls: "bg-rose-50 text-rose-700 border border-rose-100" };
  return { label: s, cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
}

function staffPill(staffStatus) {
  const s = String(staffStatus || "assigned").toLowerCase();
  if (s === "reassignment_needed") {
    return {
      label: "Staff: Re-assignment needed",
      cls: "bg-rose-50 text-rose-700 border border-rose-200",
    };
  }
  if (s === "in_progress") {
    return {
      label: "Staff: In progress",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  }
  if (s === "done") {
    return {
      label: "Staff: Done",
      cls: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }
  return { label: "Staff: Assigned", cls: "bg-zinc-100 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800" };
}

function staffRecPill(staffDecision) {
  const d = String(staffDecision || "").toLowerCase();
  if (d === "recommend_accept") {
    return {
      label: "Recommend accept",
      cls: "bg-emerald-50 text-emerald-800 border border-emerald-100",
    };
  }
  if (d === "recommend_reject") {
    return {
      label: "Recommend reject",
      cls: "bg-rose-50 text-rose-700 border border-rose-100",
    };
  }
  return null; // none / not decided
}

function isValidTabKey(key) {
  const k = String(key || "").toLowerCase();
  return TABS.some((t) => t.key === k);
}

function formatShortTS(ts) {
  const sec = ts?.seconds;
  const ms = ts?.toMillis?.();
  const d = ms ?new Date(ms) : sec ?new Date(sec * 1000) : null;
  if (!d) return "";
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function getCreatedAtMs(r) {
  const s = r?.createdAt?.seconds;
  if (!s) return 0;
  return s * 1000;
}

function dayStartMs(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return 0;
  const [y, m, d] = String(yyyy_mm_dd).split("-").map((x) => Number(x));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function dayEndMs(yyyy_mm_dd) {
  if (!yyyy_mm_dd) return 0;
  const [y, m, d] = String(yyyy_mm_dd).split("-").map((x) => Number(x));
  if (!y || !m || !d) return 0;
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

/* ---------- ✅ stable tab classifier ---------- */
function classifyTabFromRequestDoc(data) {
  if (data?.deletedByAdmin === true || data?.adminDeletedAt) return null;

  const st = String(data?.status || "new").toLowerCase();
  const assignedTo = String(data?.assignedTo || "").trim();
  const workProgress = getRequestWorkProgress(data);

  if (st === "closed" || st === "accepted") return "closed";
  if (st === "rejected") return "rejected";

  // Assigned stays in New until staff actually starts work.
  if (assignedTo && (workProgress.isStarted || workProgress.isInProgress)) return "assigned";

  // Remaining non-final requests are treated as New.
  return "new";
}

function isAdminSoftDeletedRequest(r) {
  return r?.deletedByAdmin === true || !!r?.adminDeletedAt;
}

function AssignedAdminAccessPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const shell =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/65 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition dark:border-zinc-800 dark:bg-zinc-900/40";
  const headerBtn =
    "w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition active:scale-[0.99]";
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const assignBtn = "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const manageBtn =
    "border border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900/90";

  return (
    <div className="mt-5">
      <div className={shell}>
        <button type="button" onClick={() => setOpen((v) => !v)} className={headerBtn}>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Admin Assign System
            </div>
          </div>
          <span
            className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 ${
              open ?"rotate-180" : "rotate-0"
            }`}
          >
            <AppIcon size={ICON_MD} icon={ChevronDown} />
          </span>
        </button>

        <div className={`grid transition-all duration-300 ease-out ${open ?"grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/app/admin/assign-admin")}
                  className={`${btnBase} ${assignBtn}`}
                >
                  <AppIcon size={ICON_MD} icon={UserPlus} />
                  Assign Admin
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/app/admin/manage-admins")}
                  className={`${btnBase} ${manageBtn}`}
                >
                  <AppIcon size={ICON_MD} icon={Users} />
                  Manage Admins
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaccEntryPanel() {
  const navigate = useNavigate();

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => navigate("/app/admin/sacc")}
        className="w-full rounded-3xl border border-zinc-200 bg-white/70 px-4 py-4 text-left shadow-sm backdrop-blur transition hover:border-emerald-200 hover:bg-emerald-50/50 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-900/80"
      >
        <div className="flex items-center gap-3">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
            <AppIcon size={ICON_MD} icon={Settings2} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Superadmin Control Center
            </div>
          </div>

          <AppIcon size={ICON_MD} icon={ChevronRight} className="text-zinc-400" />
        </div>
      </button>
    </div>
  );
}

/* ---------- ✅ Staff panel (smaller + collapsible) ---------- */
function StaffAccessPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [maxActive, setMaxActive] = useState(2);
  const [selectedSpecialities, setSelectedSpecialities] = useState([]);
  const [autoApproveChatMessages, setAutoApproveChatMessages] = useState(false);
  const [specialityOpen, setSpecialityOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const specialityMenuRef = useRef(null);

  useEffect(() => {
    if (!specialityOpen) return undefined;
    const onPointerDown = (event) => {
      if (!specialityMenuRef.current) return;
      if (!specialityMenuRef.current.contains(event.target)) {
        setSpecialityOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [specialityOpen]);

  const selectedSpecialityLabels = useMemo(() => {
    const selectedSet = new Set(
      (Array.isArray(selectedSpecialities) ?selectedSpecialities : [])
        .map((key) => String(key || "").trim().toLowerCase())
        .filter(Boolean)
    );
    return STAFF_SPECIALITY_OPTIONS
      .filter((opt) => selectedSet.has(String(opt.key || "").toLowerCase()))
      .map((opt) => opt.label);
  }, [selectedSpecialities]);

  const shell =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/65 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition dark:border-zinc-800 dark:bg-zinc-900/40";
  const headerBtn =
    "w-full text-left flex items-center justify-between gap-3 px-4 py-3 transition active:scale-[0.99]";
  const smallTitle = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";
  const smallSub = "mt-0.5 text-xs text-zinc-500 dark:text-zinc-400";

  const input =
    "w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-100 dark:focus:ring-emerald-500/10";
  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.99] disabled:opacity-60";
  const grantBtn =
    "border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700";
  const revokeBtn =
    "border border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/25 dark:text-rose-200 dark:border-rose-900/40 dark:hover:bg-rose-950/35";
  const manageBtn =
    "border border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-100 dark:hover:bg-zinc-900/90";

  const toggleSpeciality = (key) => {
    const safeKey = String(key || "").trim().toLowerCase();
    if (!safeKey) return;
    setSelectedSpecialities((prev) => {
      const current = Array.isArray(prev) ?prev : [];
      if (current.includes(safeKey)) {
        return current.filter((item) => item !== safeKey);
      }
      return [...current, safeKey];
    });
  };

  const run = async (action) => {
    setErr("");
    setMsg("");

    const safeEmail = String(email || "").trim().toLowerCase();
    if (!safeEmail || !safeEmail.includes("@")) {
      setErr("Enter a valid email.");
      return;
    }

    try {
      setBusy(action);

      const res = await setStaffAccessByEmail({
        email: safeEmail,
        action, // "grant" | "revoke"
        maxActive: Number(maxActive) || 2,
        specialities: selectedSpecialities,
        autoApproveChatMessages,
      });

      setMsg(action === "grant" ?`✅ Staff enabled: ${res.email}` : `✅ Staff revoked: ${res.email}`);
      if (action === "grant") {
        setSpecialityOpen(false);
      }
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to update staff access.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mt-5">
      <div className={`${shell} relative overflow-visible ${specialityOpen ?"z-[10010]" : "z-20"}`}>
        <button type="button" onClick={() => setOpen((v) => !v)} className={headerBtn}>
          <div className="min-w-0">
            <div className={smallTitle}>Staff Hire System</div>
            <div className={smallSub}>{open ?"Add/remove staff access." : "Tap to expand"}</div>
          </div>

          <div className="shrink-0 inline-flex items-center gap-2">
            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              Staff
            </span>

            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200 ${
                open ?"rotate-180" : "rotate-0"
              }`}
            >
              <AppIcon size={ICON_MD} icon={ChevronDown} />
            </span>
          </div>
        </button>

        <div className={`grid transition-all duration-300 ease-out ${open ?"grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className={open ?"overflow-visible" : "overflow-hidden"}>
            <div className="px-4 pb-4">
              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/45">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  The staff member must already be signed up in the app to be activated.
                </div>

                {err ?(
                  <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                    {err}
                  </div>
                ) : null}

                {msg ?(
                  <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
                    {msg}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3">
                  <input
                    className={input}
                    placeholder="staff@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                      <div className="mb-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Max active
                      </div>
                      <input
                        className={input}
                        type="number"
                        min={1}
                        max={10}
                        value={maxActive}
                        onChange={(e) => setMaxActive(e.target.value)}
                        placeholder="2"
                      />
                    </div>

                    <div
                      ref={specialityMenuRef}
                      className={`relative col-span-2 ${specialityOpen ?"z-[10020]" : "z-20"}`}
                    >
                      <div className="mb-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Select specialities
                      </div>
                      <button
                        type="button"
                        onClick={() => setSpecialityOpen((v) => !v)}
                        className={`${input} text-left inline-flex items-center justify-between gap-2`}
                      >
                        <span className="min-w-0 truncate">
                          {selectedSpecialityLabels.length
                            ?selectedSpecialityLabels.join(", ")
                            : "Select speciality"}
                        </span>
                        <AppIcon
                          size={ICON_SM}
                          icon={ChevronDown}
                          className={`shrink-0 transition ${specialityOpen ?"rotate-180" : ""}`}
                        />
                      </button>

                      {specialityOpen ?(
                        <div className="absolute left-0 right-0 z-[10030] mt-2 max-h-56 overflow-y-auto rounded-2xl border border-zinc-200 bg-white/96 p-2 shadow-xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/96">
                          {STAFF_SPECIALITY_OPTIONS.map((opt) => {
                            const checked = selectedSpecialities.includes(opt.key);
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => toggleSpeciality(opt.key)}
                                className={[
                                  "mb-1 inline-flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm font-semibold transition",
                                  checked
                                    ?"border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
                                    : "border-zinc-200 bg-white/80 text-zinc-800 hover:border-emerald-200 dark:border-zinc-700 dark:bg-zinc-900/75 dark:text-zinc-100",
                                ].join(" ")}
                              >
                                <span className="truncate">{opt.label}</span>
                                <span
                                  className={`ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                                    checked
                                      ?"border-emerald-500 bg-emerald-500 text-white"
                                      : "border-zinc-300 text-transparent dark:border-zinc-600"
                                  }`}
                                >
                                  v
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <label className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white/85 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900/70">
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        Auto approve chat messages
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        ON = user and staff chat goes direct. OFF = admin moderation required.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAutoApproveChatMessages((value) => !value)}
                      className={`ml-3 inline-flex h-7 w-12 items-center rounded-full border transition ${
                        autoApproveChatMessages
                          ? "border-emerald-500 bg-emerald-500 justify-end"
                          : "border-zinc-300 bg-zinc-200 justify-start dark:border-zinc-600 dark:bg-zinc-800"
                      }`}
                      aria-pressed={autoApproveChatMessages}
                      title="Toggle auto-approve chat"
                    >
                      <span className="mx-1 inline-flex h-5 w-5 rounded-full bg-white shadow-sm" />
                    </button>
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => run("grant")}
                      disabled={busy === "grant" || busy === "revoke"}
                      className={`${btnBase} ${grantBtn}`}
                    >
                      <AppIcon size={ICON_MD} icon={UserPlus} />
                      {busy === "grant" ?"Granting…" : "Grant"}
                    </button>

                    <button
                      type="button"
                      onClick={() => run("revoke")}
                      disabled={busy === "grant" || busy === "revoke"}
                      className={`${btnBase} ${revokeBtn}`}
                    >
                      <AppIcon size={ICON_MD} icon={UserX} />
                      {busy === "revoke" ?"Revoking…" : "Revoke"}
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate("/app/admin/manage-staff")}
                      className={`${btnBase} ${manageBtn} col-span-2`}
                    >
                      <AppIcon size={ICON_MD} icon={Users} />
                      Manage Staff
                    </button>
                  </div>

                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Specialities are used to filter assignable staff by request type.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-200/70 to-transparent dark:via-emerald-500/20" />
        </div>
      </div>
    </div>
  );
}

/* ---------- Motion ---------- */
const pageIn = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: "easeOut" } },
};
const listWrap = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};
const listItem = {
  hidden: { opacity: 0, y: 10, scale: 0.995 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 520, damping: 42 } },
};

export default function AdminRequestsScreen() {
  void motion;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { countryMap } = useCountryDirectory();
  const mountAtRef = useRef(typeof performance !== "undefined" ?performance.now() : 0);
  const firstPaintLoggedRef = useRef(false);

  const tabFromUrl = searchParams.get("tab");
  const qFromUrl = searchParams.get("q") || "";

  const [status, setStatus] = useState(isValidTabKey(tabFromUrl) ?tabFromUrl : "new");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [routingBusy, setRoutingBusy] = useState(false);
  const [routingErr, setRoutingErr] = useState("");
  const [routingMsg, setRoutingMsg] = useState("");
  const [unlockRefundBusy, setUnlockRefundBusy] = useState(false);
  const [unlockRefundErr, setUnlockRefundErr] = useState("");
  const [unlockRefundMsg, setUnlockRefundMsg] = useState("");
  const [unlockRefundEligible, setUnlockRefundEligible] = useState([]);
  const [search, setSearch] = useState(String(qFromUrl));
  const [debouncedSearch, setDebouncedSearch] = useState(String(qFromUrl));
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_COUNT);
  const [roleCtx, setRoleCtx] = useState(null);

  // ✅ Filter UI (minimal popover beside search)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    from: "", // yyyy-mm-dd
    to: "", // yyyy-mm-dd
    assigned: "any", // any | assigned | unassigned
    assignedAdminUid: "any", // super-admin only
    staffDecision: "any", // any | recommend_accept | recommend_reject | none
    staffStatus: "any", // any | assigned | in_progress | done
  });
  const [assignedAdminOptions, setAssignedAdminOptions] = useState([]);
  const [assignedAdminFilterLoading, setAssignedAdminFilterLoading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [staffEmailByUid, setStaffEmailByUid] = useState({});
  const [pinsByTab, setPinsByTab] = useState(() => readAdminTabPins());
  const [requestActions, setRequestActions] = useState(null);
  const screenRef = useRef(null);
  const keyboardFocusTimeoutRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressStateRef = useRef({ id: "", fired: false, x: 0, y: 0 });
  const staleSweepAtRef = useRef(0);
  const unreadByRequest = useNotifsV2Store((s) => s.unreadByRequest || {});

  // ✅ subtle entrance
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEnter(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (firstPaintLoggedRef.current) return;
    firstPaintLoggedRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      const now = typeof performance !== "undefined" ?performance.now() : 0;
      const delta = Math.max(0, now - (mountAtRef.current || 0));
      console.log(`${PERF_TAG} mount->first-paint: ${delta.toFixed(1)}ms`);
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(String(search || "")), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getCurrentUserRoleContext();
        if (cancelled) return;
        setRoleCtx(ctx);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!roleCtx?.isSuperAdmin) {
      setAssignedAdminOptions([]);
      setAssignedAdminFilterLoading(false);
      setFilters((current) =>
        current.assignedAdminUid === "any"
          ? current
          : { ...current, assignedAdminUid: "any" }
      );
      return () => {
        cancelled = true;
      };
    }

    setAssignedAdminFilterLoading(true);
    listAssignedAdmins({ max: 200 })
      .then((rows) => {
        if (cancelled) return;
        const options = (Array.isArray(rows) ? rows : [])
          .map((row) => {
            const uid = String(row?.uid || "").trim();
            if (!uid) return null;
            const email = String(row?.email || "").trim().toLowerCase();
            const name =
              String(row?.displayName || row?.name || "").trim() || email || uid;
            return { uid, email, name };
          })
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name));
        setAssignedAdminOptions(options);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Assigned admin filter options load failed:", error?.message || error);
        setAssignedAdminOptions([]);
      })
      .finally(() => {
        if (!cancelled) setAssignedAdminFilterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [roleCtx?.isSuperAdmin]);

  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_COUNT);
  }, [status, debouncedSearch, filters]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ADMIN_TAB_PINS_KEY, JSON.stringify(pinsByTab || {}));
    } catch {
      // ignore storage failures
    }
  }, [pinsByTab]);

  useEffect(() => {
    const root = screenRef.current;
    if (!root) return;

    const isField = (el) => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const setOpen = (open) => {
      document.body.classList.toggle("app-keyboard-open", !!open);
    };

    const onFocusIn = (e) => {
      if (keyboardFocusTimeoutRef.current) {
        clearTimeout(keyboardFocusTimeoutRef.current);
        keyboardFocusTimeoutRef.current = null;
      }
      if (!root.contains(e.target)) return;
      if (!isField(e.target)) return;
      setOpen(true);
    };

    const onFocusOut = () => {
      if (keyboardFocusTimeoutRef.current) clearTimeout(keyboardFocusTimeoutRef.current);
      keyboardFocusTimeoutRef.current = setTimeout(() => {
        keyboardFocusTimeoutRef.current = null;
        const active = document.activeElement;
        if (active && root.contains(active) && isField(active)) return;
        setOpen(false);
      }, 0);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      if (keyboardFocusTimeoutRef.current) {
        clearTimeout(keyboardFocusTimeoutRef.current);
        keyboardFocusTimeoutRef.current = null;
      }
      document.body.classList.remove("app-keyboard-open");
    };
  }, []);

  // ✅ Keep URL synced (tab + q only)
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", status);

    const trimmed = String(search || "").trim();
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");

    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  const load = async () => {
    const loadTimer = `${PERF_TAG} firestore:load tab=${status}`;
    startPerf(loadTimer);
    setLoading(true);
    setMsg("");

    try {
      const now = Date.now();
      if (now - staleSweepAtRef.current > 60 * 1000) {
        staleSweepAtRef.current = now;
        try {
          await sweepStaleAssignments({ staleHours: 24, max: 350 });
        } catch (sweepErr) {
          console.warn("stale assignment sweep failed:", sweepErr?.message || sweepErr);
        }
      }

      if (status === "new" || status === "assigned") {
        const activeTabTimer = `${PERF_TAG} transform:${status} active merge/filter`;
        startPerf(activeTabTimer);

        let baseRows = [];
        if (roleCtx?.isAssignedAdmin) {
          // Assigned-admin loading is already scope-filtered in service; fetch once and classify locally.
          baseRows = await getRequests({ max: 420 }).catch(() => []);
        } else {
          const buckets = await Promise.all(
            ACTIVE_REQUEST_STATUSES.map((activeStatus) =>
              getRequests({ status: activeStatus, max: 200 }).catch(() => [])
            )
          );
          const dedupedById = new Map();
          buckets.forEach((rows) => {
            (Array.isArray(rows) ?rows : []).forEach((row) => {
              if (!row?.id) return;
              dedupedById.set(String(row.id), row);
            });
          });
          baseRows = Array.from(dedupedById.values());
        }

        const merged = (Array.isArray(baseRows) ?baseRows : [])
          .filter((r) => !isAdminSoftDeletedRequest(r))
          .filter((r) => {
            const st = String(r?.status || "").toLowerCase();
            if (st === "closed" || st === "rejected") return false;
            const tabKey = classifyTabFromRequestDoc(r);
            return status === "assigned" ?tabKey === "assigned" : tabKey === "new";
          })
          .sort((a, b) => getCreatedAtMs(b) - getCreatedAtMs(a));

        setItems(merged);
        endPerf(activeTabTimer);
        return;
      }

      const data = await getRequests({ status, max: 120 });
      setItems((Array.isArray(data) ?data : []).filter((r) => !isAdminSoftDeletedRequest(r)));
    } catch (e) {
      console.error(e);
      logIndexHint(`getRequests(${status})`, e);
      setMsg(e?.message || "Failed to load requests");
    } finally {
      endPerf(loadTimer);
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, roleCtx?.isAssignedAdmin]);

  const runBulkRouteUnrouted = async () => {
    setRoutingErr("");
    setRoutingMsg("");
    setRoutingBusy(true);
    try {
      const result = await routeUnroutedNewRequests({ max: 180 });
      const routed = Number(result?.routed || 0);
      const scanned = Number(result?.scanned || 0);
      const skipped = Number(result?.skippedAlreadyRouted || 0);
      const noCandidate = Number(result?.noCandidate || 0);
      const failed = Number(result?.failed || 0);
      const lockedSkips = Number(result?.skippedInvalidLockedOwner || 0);
      setRoutingMsg(
        `Bulk route complete. Routed ${routed}/${scanned}. ` +
          `Skipped already routed: ${skipped}. ` +
          `No candidate: ${noCandidate}. ` +
          `Locked-owner skips: ${lockedSkips}. ` +
          `Failed: ${failed}.`
      );
      await load();
    } catch (error) {
      console.error(error);
      setRoutingErr(String(error?.message || "Bulk route failed."));
    } finally {
      setRoutingBusy(false);
    }
  };

  const runUnlockRefundSweep = async () => {
    const requestIds = unlockRefundEligible
      .map((row) => String(row?.requestId || "").trim())
      .filter(Boolean);
    if (requestIds.length === 0) return;

    setUnlockRefundBusy(true);
    setUnlockRefundErr("");
    setUnlockRefundMsg("");
    try {
      const applied = await applyUnlockAutoRefundSweep({ requestIds });
      setUnlockRefundMsg(`Processed ${applied} unlock refund${applied === 1 ? "" : "s"}.`);
      const refreshed = await listUnlockAutoRefundEligibleRequests({ requestIds });
      setUnlockRefundEligible(Array.isArray(refreshed) ? refreshed : []);
      await load();
    } catch (error) {
      console.error(error);
      setUnlockRefundErr(String(error?.message || "Failed to process 48h unlock refunds."));
    } finally {
      setUnlockRefundBusy(false);
    }
  };

  useEffect(() => {
    const uids = Array.from(
      new Set(
        (items || [])
          .map((r) => String(r?.assignedTo || "").trim())
          .filter(Boolean)
      )
    ).filter((uid) => !(uid in staffEmailByUid));

    if (uids.length === 0) return;

    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        uids.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "staff", uid));
            const email = snap.exists() ?String(snap.data()?.email || "").trim() : "";
            return [uid, email];
          } catch {
            return [uid, ""];
          }
        })
      );

      if (cancelled) return;
      setStaffEmailByUid((prev) => {
        const next = { ...prev };
        entries.forEach(([uid, email]) => {
          next[uid] = email;
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [items, staffEmailByUid]);

  useEffect(() => {
    let cancelled = false;
    if (!roleCtx?.isSuperAdmin) {
      setUnlockRefundEligible([]);
      return () => {
        cancelled = true;
      };
    }

    const requestIds = (items || [])
      .map((row) => String(row?.id || "").trim())
      .filter(Boolean);
    if (requestIds.length === 0) {
      setUnlockRefundEligible([]);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const rows = await listUnlockAutoRefundEligibleRequests({ requestIds });
        if (!cancelled) {
          setUnlockRefundEligible(Array.isArray(rows) ? rows : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("unlock refund eligibility scan failed:", error?.message || error);
          setUnlockRefundEligible([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [items, roleCtx?.isSuperAdmin]);

  /* ---------- ✅ GLOBAL new-message dots (fixed) ---------- */
  const [pendingSet, setPendingSet] = useState(() => new Set()); // Set<requestId>
  const [reqMetaById, setReqMetaById] = useState({}); // { [rid]: { status, assignedTo, tabKey } }

  // 1) One global listener: collectionGroup pendingMessages (status == pending)
  useEffect(() => {
    if (roleCtx?.isAssignedAdmin) {
      setPendingSet(new Set());
      return () => {};
    }

    const cg = collectionGroup(db, "pendingMessages");
    const qy = query(cg, where("status", "==", "pending"), limit(LIMIT_PENDING));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const next = new Set();

        snap.docs.forEach((d) => {
          // path: serviceRequests/<rid>/pendingMessages/<mid>
          const parts = d.ref.path.split("/");
          const i = parts.indexOf("serviceRequests");
          const rid = i >= 0 ?String(parts[i + 1] || "") : "";
          if (rid) next.add(rid);
        });

        setPendingSet(next);
      },
      (err) => {
        console.error("pendingMessages collectionGroup listener error:", err);
        logIndexHint("collectionGroup(pendingMessages)", err);
        // keep old set rather than wiping (prevents flicker)
      }
    );

    return () => unsub();
  }, [roleCtx?.isAssignedAdmin]);

  // 2) Batch-lookup request docs for pending IDs to classify which tab gets a red dot.
  useEffect(() => {
    const ids = Array.from(
      new Set([
        ...(pendingSet ? Array.from(pendingSet) : []),
        ...Object.keys(unreadByRequest || {}).filter((rid) => unreadByRequest?.[rid]?.unread),
      ])
    )
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    let cancelled = false;

    if (ids.length === 0) {
      setReqMetaById({});
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const timer = `${PERF_TAG} firestore:classify pending request tabs (${ids.length})`;
      startPerf(timer);
      try {
        const nextMeta = {};
        const chunkSize = 30;

        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const qy = query(collection(db, "serviceRequests"), where(documentId(), "in", chunk));
          const snap = await getDocs(qy);
          snap.docs.forEach((d) => {
            const data = d.data() || {};
            const tabKey = classifyTabFromRequestDoc(data);
            if (!tabKey) return;
            const st = String(data?.status || "new").toLowerCase();
            const assignedTo = String(data?.assignedTo || "").trim();
            nextMeta[String(d.id)] = { tabKey, status: st, assignedTo };
          });
        }

        if (!cancelled) setReqMetaById(nextMeta);
      } catch (err) {
        console.error("pending request tab classification error:", err);
        logIndexHint("serviceRequests(documentId in ...)", err);
      } finally {
        endPerf(timer);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingSet, unreadByRequest]);

  const tabHasDot = useMemo(() => {
    const out = { new: false, closed: false, rejected: false, assigned: false };
    (pendingSet ?Array.from(pendingSet) : []).forEach((rid) => {
      const tk = reqMetaById?.[rid]?.tabKey;
      if (tk && out[tk] !== undefined) out[tk] = true;
    });
    Object.keys(unreadByRequest || {}).forEach((rid) => {
      if (!unreadByRequest?.[rid]?.unread) return;
      const row = (items || []).find((item) => String(item?.id || "").trim() === rid);
      const tk = row ? classifyTabFromRequestDoc(row) : reqMetaById?.[rid]?.tabKey;
      if (tk && out[tk] !== undefined) out[tk] = true;
    });
    return out;
  }, [items, pendingSet, reqMetaById, unreadByRequest]);

  /* ---------- Search + Filters ---------- */
  const searched = useMemo(() => {
    const timer = `${PERF_TAG} transform:search`;
    startPerf(timer);
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) {
      endPerf(timer);
      return items;
    }

    const out = (items || []).filter((r) =>
      [
        r.track,
        r.country,
        r.requestType,
        r.serviceName,
        r.name,
        r.phone,
        r.email,
        r.note,
        r.status,
        r.staffStatus,
        r.staffDecision,
        r.assignedTo,
        r.needsReassignment ?"reassignment needed" : "",
        r.reassignReason,
        r.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
    endPerf(timer);
    return out;
  }, [items, debouncedSearch]);

  const filtered = useMemo(() => {
    const timer = `${PERF_TAG} transform:filters+pin-sort`;
    startPerf(timer);
    const fromMs = dayStartMs(filters.from);
    const toMs = dayEndMs(filters.to);
    const base = (searched || []).filter((r) => {
      if (isAdminSoftDeletedRequest(r)) return false;

      const createdMs = getCreatedAtMs(r);

      if (fromMs && createdMs && createdMs < fromMs) return false;
      if (toMs && createdMs && createdMs > toMs) return false;

      const assignedTo = String(r?.assignedTo || "").trim();
      const staffStatus = String(r?.staffStatus || "").toLowerCase();
      const staffDecision = String(r?.staffDecision || "").toLowerCase();

      if (filters.assigned === "assigned" && !assignedTo) return false;
      if (filters.assigned === "unassigned" && assignedTo) return false;

      if (roleCtx?.isSuperAdmin && filters.assignedAdminUid !== "any") {
        const wantAdminUid = String(filters.assignedAdminUid || "").trim();
        const currentAdminUid = String(r?.currentAdminUid || "").trim();
        const assignedAdminUid = String(r?.assignedAdminId || "").trim();
        if (!wantAdminUid) return false;
        if (currentAdminUid !== wantAdminUid && assignedAdminUid !== wantAdminUid) return false;
      }

      if (filters.staffStatus !== "any") {
        if (!assignedTo) return false;
        const want = filters.staffStatus;
        const normalized = staffStatus || "assigned";
        if (normalized !== want) return false;
      }

      if (filters.staffDecision !== "any") {
        if (!assignedTo) return false;
        if (filters.staffDecision === "none") {
          if (staffDecision && staffDecision !== "none") return false;
        } else {
          if (staffDecision !== filters.staffDecision) return false;
        }
      }

      return true;
    });

    const pinList = Array.isArray(pinsByTab?.[status]) ?pinsByTab[status] : [];
    if (pinList.length === 0) {
      endPerf(timer);
      return base;
    }

    const pinIndexById = new Map(pinList.map((rid, idx) => [String(rid), idx]));
    const out = base
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const aPin = pinIndexById.get(String(a.r?.id || ""));
        const bPin = pinIndexById.get(String(b.r?.id || ""));
        const aPinned = Number.isInteger(aPin);
        const bPinned = Number.isInteger(bPin);
        if (aPinned && bPinned) return aPin - bPin;
        if (aPinned) return -1;
        if (bPinned) return 1;
        return a.idx - b.idx;
      })
      .map((x) => x.r);
    endPerf(timer);
    return out;
  }, [searched, filters, pinsByTab, roleCtx?.isSuperAdmin, status]);

  const visibleFiltered = useMemo(() => {
    const timer = `${PERF_TAG} render:list-window`;
    startPerf(timer);
    const out = filtered.slice(0, visibleCount);
    endPerf(timer);
    return out;
  }, [filtered, visibleCount]);

  const visibleRenderRows = useMemo(() => {
    const timer = `${PERF_TAG} render:list-items map`;
    startPerf(timer);
    const out = visibleFiltered.map((r) => r);
    endPerf(timer);
    return out;
  }, [visibleFiltered]);

  const activeLabel = useMemo(() => {
    return TABS.find((t) => t.key === status)?.label || String(status).toUpperCase();
  }, [status]);

  const openRequest = (id) => {
    const q = String(search || "").trim();
    const qs = new URLSearchParams();
    qs.set("tab", status);
    if (q) qs.set("q", q);
    navigate(`/app/admin/request/${id}?${qs.toString()}`);
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const closeRequestActions = () => {
    clearLongPressTimer();
    longPressStateRef.current = { id: "", fired: false, x: 0, y: 0 };
    setRequestActions(null);
  };

  const beginLongPress = (e, r) => {
    const rid = String(r?.id || "").trim();
    if (!rid) return;
    if (e?.button != null && e.button !== 0) return;

    clearLongPressTimer();
    longPressStateRef.current = {
      id: rid,
      fired: false,
      x: Number(e?.clientX ?? 0),
      y: Number(e?.clientY ?? 0),
    };

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressStateRef.current = { ...longPressStateRef.current, fired: true };
      setRequestActions({
        request: r,
        tabKey: status,
        x: Number(longPressStateRef.current?.x ?? 0),
        y: Number(longPressStateRef.current?.y ?? 0),
      });
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(10);
      }
    }, LONG_PRESS_MS);
  };

  const cancelLongPressPending = () => {
    if (!longPressStateRef.current.fired) clearLongPressTimer();
  };

  const maybeCancelLongPressOnMove = (e) => {
    if (!longPressTimerRef.current) return;
    const { x, y } = longPressStateRef.current;
    const dx = Math.abs(Number(e?.clientX ?? 0) - x);
    const dy = Math.abs(Number(e?.clientY ?? 0) - y);
    if (dx > 10 || dy > 10) clearLongPressTimer();
  };

  const handleRequestTileActivate = (r) => {
    const rid = String(r?.id || "").trim();
    if (longPressStateRef.current.fired && longPressStateRef.current.id === rid) {
      longPressStateRef.current = { id: "", fired: false, x: 0, y: 0 };
      return;
    }
    longPressStateRef.current = { id: "", fired: false, x: 0, y: 0 };
    openRequest(r.id);
  };

  const openRequestActionsFromContext = (e, r) => {
    e.preventDefault();
    e.stopPropagation();
    clearLongPressTimer();
    longPressStateRef.current = {
      id: String(r?.id || "").trim(),
      fired: true,
      x: Number(e?.clientX ?? 0),
      y: Number(e?.clientY ?? 0),
    };
    setRequestActions({
      request: r,
      tabKey: status,
      x: Number(e?.clientX ?? 0),
      y: Number(e?.clientY ?? 0),
    });
  };

  const togglePinnedForTab = ({ requestId, tabKey }) => {
    const rid = String(requestId || "").trim();
    const tk = isValidTabKey(tabKey) ?String(tabKey) : status;
    if (!rid) return;

    setPinsByTab((prev) => {
      const current = Array.isArray(prev?.[tk]) ?prev[tk] : [];
      const exists = current.includes(rid);
      const nextList = exists ?current.filter((x) => x !== rid) : [rid, ...current.filter((x) => x !== rid)];
      return { ...(prev || {}), [tk]: nextList };
    });
  };

  const handleDeleteRequest = async (r) => {
    const rid = String(r?.id || "").trim();
    if (!rid || deletingId) return;

    const label = r?.requestType === "full" ?"Full Package" : (r?.serviceName || "request");
    const ok = window.confirm(`Delete this request?\n\n${label}\nID: ${rid}\n\nScreenshot for easier retrieval later.`);
    if (!ok) return;

    try {
      setDeletingId(rid);
      setMsg("");
      await adminSoftDeleteRequest({ requestId: rid });

      setItems((prev) => (prev || []).filter((x) => String(x?.id || "") !== rid));
      setPendingSet((prev) => {
        const next = new Set(prev || []);
        next.delete(rid);
        return next;
      });
      setReqMetaById((prev) => {
        if (!prev?.[rid]) return prev;
        const next = { ...prev };
        delete next[rid];
        return next;
      });
      setPinsByTab((prev) => {
        const next = { ...(prev || {}) };
        TABS.forEach((t) => {
          const cur = Array.isArray(next?.[t.key]) ?next[t.key] : [];
          next[t.key] = cur.filter((x) => x !== rid);
        });
        return next;
      });
    } catch (e) {
      console.error(e);
      setMsg(e?.message || "Failed to delete request.");
    } finally {
      setDeletingId("");
      closeRequestActions();
    }
  };

  const softBg =
    "bg-gradient-to-b from-emerald-50/40 via-white to-white dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const enterWrap = "transition duration-500 ease-out will-change-transform will-change-opacity";
  const enterCls = enter ?"opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  const card =
    "rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 shadow-sm backdrop-blur transition duration-300 ease-out dark:border-zinc-800 dark:bg-zinc-900/45";
  const tile =
    "w-full text-left rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur transition duration-300 ease-out hover:-translate-y-[2px] hover:shadow-md hover:border-emerald-200 active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-zinc-900/45 dark:hover:border-emerald-900/40";

  const tabBtnBase =
    "rounded-2xl border px-3.5 py-2 text-sm font-semibold transition active:scale-[0.99]";
  const tabBtnOn =
    "border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700";
  const tabBtnOff =
    "border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-100 dark:hover:bg-zinc-900";

  const anyFiltersActive = useMemo(() => {
    return (
      !!filters.from ||
      !!filters.to ||
      filters.assigned !== "any" ||
      (roleCtx?.isSuperAdmin && filters.assignedAdminUid !== "any") ||
      filters.staffDecision !== "any" ||
      filters.staffStatus !== "any"
    );
  }, [filters, roleCtx?.isSuperAdmin]);

  const resetFilters = () => {
    setFilters({
      from: "",
      to: "",
      assigned: "any",
      assignedAdminUid: "any",
      staffDecision: "any",
      staffStatus: "any",
    });
  };

  const RedDot = ({ className = "" }) => (
    <span
      className={`inline-flex h-2.5 w-2.5 rounded-full bg-rose-600 shadow-[0_0_0_3px_rgba(244,63,94,0.12)] ${className}`}
      aria-hidden="true"
    />
  );

  const adminLabel = roleCtx?.isSuperAdmin
    ?"Super Admin"
    : roleCtx?.isAssignedAdmin
    ?"Assigned Admin"
    : "Admin";
  const adminLabelTone = roleCtx?.isSuperAdmin
    ?"text-rose-700 dark:text-rose-300 [text-shadow:0_0_10px_rgba(244,63,94,0.45)]"
    : roleCtx?.isAssignedAdmin
    ?"text-emerald-700 dark:text-emerald-300"
    : "text-zinc-700 dark:text-zinc-300";

  return (
    <div ref={screenRef} className={`min-h-screen ${softBg}`}>
      <motion.div variants={pageIn} initial="hidden" animate="show" className={`px-5 py-6 ${enterWrap} ${enterCls}`}>
        {/* Sticky header */}
        <div className="sticky top-0 z-20 -mx-5 px-5 pb-3 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/50 dark:supports-[backdrop-filter]:bg-zinc-950/40">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-3xl">
                Admin
              </h1>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Manage incoming requests, assignments and decisions.
              </p>
              <p className={`mt-1 text-sm sm:text-base font-semibold ${adminLabelTone}`}>
                {adminLabel}
              </p>
            </div>

            <button
              onClick={load}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.99] dark:text-zinc-200 dark:hover:bg-zinc-900"
              type="button"
              aria-label="Refresh"
              title="Refresh"
            >
              <AppIcon size={ICON_MD} className="text-emerald-700 dark:text-emerald-200" icon={RefreshCw} />
            </button>
          </div>
        </div>

        {roleCtx?.isSuperAdmin ?<AssignedAdminAccessPanel /> : null}
        {roleCtx?.isSuperAdmin ?<SaccEntryPanel /> : null}
        {roleCtx?.isSuperAdmin ?(
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runBulkRouteUnrouted}
                disabled={routingBusy}
                className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
              >
                <AppIcon size={ICON_MD} icon={RefreshCw} />
                {routingBusy ?"Routing..." : "Route Unrouted New"}
              </button>
              {unlockRefundEligible.length > 0 ?(
                <button
                  type="button"
                  onClick={runUnlockRefundSweep}
                  disabled={unlockRefundBusy}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/70 px-4 py-2.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] disabled:opacity-60"
                >
                  <AppIcon size={ICON_MD} icon={RefreshCw} />
                  {unlockRefundBusy
                    ? "Processing..."
                    : `Process 48h Unlock Refunds (${unlockRefundEligible.length})`}
                </button>
              ) : null}
            </div>
            {routingErr ?(
              <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {routingErr}
              </div>
            ) : null}
            {routingMsg ?(
              <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200">
                {routingMsg}
              </div>
            ) : null}
            {unlockRefundErr ?(
              <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/35 dark:text-rose-200">
                {unlockRefundErr}
              </div>
            ) : null}
            {unlockRefundMsg ?(
              <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/35 dark:text-emerald-200">
                {unlockRefundMsg}
              </div>
            ) : null}
          </div>
        ) : null}
        {roleCtx?.isAssignedAdmin ?<StaffAccessPanel /> : null}

        {/* Tabs */}
        <div className="mt-5 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const showDot = !!tabHasDot?.[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                className={`${tabBtnBase} ${status === t.key ?tabBtnOn : tabBtnOff}`}
                type="button"
              >
                <span className="inline-flex items-center gap-2">
                  {t.label}
                  {showDot ?<RedDot className="translate-y-[1px]" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + Filters */}
        <div className="mt-4">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Search</label>

          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2.5 shadow-sm backdrop-blur transition focus-within:border-emerald-200 focus-within:ring-2 focus-within:ring-emerald-100 dark:border-zinc-800 dark:bg-zinc-900/45 dark:focus-within:ring-emerald-500/10">
              <AppIcon size={ICON_MD} icon={Search} className="text-zinc-500 dark:text-zinc-400" />
              <input
                className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 dark:text-zinc-100"
                placeholder="Track, country, name, email, ID, staff…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={`relative inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition active:scale-[0.99]
                ${
                  anyFiltersActive
                    ?"border-rose-200 bg-rose-50/70 text-rose-700 hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200 dark:hover:bg-rose-950/35"
                    : "border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 text-zinc-800 hover:border-emerald-200 hover:bg-emerald-50/60 dark:border-zinc-800 dark:bg-zinc-900/45 dark:text-zinc-100 dark:hover:bg-zinc-900"
                }`}
              title="Filters"
            >
              <AppIcon size={ICON_MD} icon={SlidersHorizontal} />
              Filter
              {anyFiltersActive ?(
                <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
                  !
                </span>
              ) : null}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Showing{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">{filtered.length}</span>{" "}
              of{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">{items.length}</span>
            </span>

            <span className="rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:text-emerald-200">
              Tab: {activeLabel}
            </span>
          </div>

          {/* Filters popover */}
          <AnimatePresence>
            {filtersOpen ?(
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.99 }}
                transition={{ duration: 0.16 }}
                className="mt-3 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/75 dark:bg-zinc-900/60 p-4 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/55"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Filters</div>

                  <div className="flex items-center gap-2">
                    {anyFiltersActive ?(
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100"
                      >
                        Reset
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setFiltersOpen(false)}
                      className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 p-2 text-zinc-700 dark:text-zinc-300 transition hover:border-emerald-200 hover:bg-emerald-50/60 active:scale-[0.99] dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200"
                      aria-label="Close filters"
                      title="Close"
                    >
                      <AppIcon size={ICON_MD} icon={X} />
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      From
                      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/45">
                        <AppIcon size={ICON_SM} icon={Calendar} className="text-zinc-500 dark:text-zinc-400" />
                        <input
                          type="date"
                          value={filters.from}
                          onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
                          className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none dark:text-zinc-100"
                        />
                      </div>
                    </label>

                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      To
                      <div className="mt-2 flex items-center gap-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/45">
                        <AppIcon size={ICON_SM} icon={Calendar} className="text-zinc-500 dark:text-zinc-400" />
                        <input
                          type="date"
                          value={filters.to}
                          onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
                          className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 outline-none dark:text-zinc-100"
                        />
                      </div>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Assigned
                      <select
                        value={filters.assigned}
                        onChange={(e) => setFilters((p) => ({ ...p, assigned: e.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                      >
                        <option value="any">Any</option>
                        <option value="assigned">Assigned</option>
                        <option value="unassigned">Unassigned</option>
                      </select>
                    </label>

                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Staff status
                      <select
                        value={filters.staffStatus}
                        onChange={(e) => setFilters((p) => ({ ...p, staffStatus: e.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                      >
                        <option value="any">Any</option>
                        <option value="assigned">assigned</option>
                        <option value="in_progress">in_progress</option>
                        <option value="done">done</option>
                        <option value="reassignment_needed">reassignment_needed</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                      Recommendation
                      <select
                        value={filters.staffDecision}
                        onChange={(e) => setFilters((p) => ({ ...p, staffDecision: e.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                      >
                        <option value="any">Any</option>
                        <option value="recommend_accept">recommend_accept</option>
                        <option value="recommend_reject">recommend_reject</option>
                        <option value="none">none</option>
                      </select>
                    </label>

                    {roleCtx?.isSuperAdmin ? (
                      <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                        Assigned Admin
                        <select
                          value={filters.assignedAdminUid}
                          onChange={(e) =>
                            setFilters((p) => ({ ...p, assignedAdminUid: e.target.value }))
                          }
                          className="mt-2 w-full rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 shadow-sm outline-none transition focus:border-emerald-200 focus:ring-4 focus:ring-emerald-100/60 dark:border-zinc-700 dark:bg-zinc-900/45 dark:text-zinc-100 dark:focus:ring-emerald-500/10"
                        >
                          <option value="any">Any</option>
                          {assignedAdminOptions.map((admin) => (
                            <option key={admin.uid} value={admin.uid}>
                              {admin.name}
                              {admin.email ? ` (${admin.email})` : ""}
                            </option>
                          ))}
                        </select>
                        <div className="mt-1 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                          {assignedAdminFilterLoading
                            ? "Loading assigned admins..."
                            : "Filter using Manage Admins assignments."}
                        </div>
                      </label>
                    ) : (
                      <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 dark:text-zinc-200">
                        Filter scope
                        <div className="mt-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                          Filters adapt to your admin role.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* States */}
        {loading ?(
          <div className={`mt-6 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>Loading…</div>
        ) : msg ?(
          <div className="mt-6 rounded-3xl border border-rose-100 bg-rose-50/70 p-4 text-sm text-rose-700 shadow-sm dark:border-rose-900/40 dark:bg-rose-950/25 dark:text-rose-200">
            {msg}
          </div>
        ) : filtered.length === 0 ?(
          <div className={`mt-6 ${card} p-4 text-sm text-zinc-600 dark:text-zinc-300`}>No requests found.</div>
        ) : (
          <motion.div variants={listWrap} initial="hidden" animate="show" className="mt-6 grid gap-3">
            {visibleRenderRows.map((r) => {
              const p = pill(r.status);
              const left = `${String(r.track || "").toUpperCase()} • ${r.country || "-"}`;
              const right =
                r.requestType === "full"
                  ? (r.serviceName ? `Package: ${r.serviceName}` : "Package request")
                  : `Single: ${r.serviceName || "-"}`;
              const accentColor = resolveCountryAccentColor(countryMap, r?.country, "");

              const rid = String(r.id || "");
              const assignedTo = String(r?.assignedTo || "").trim();
              const assignedEmail = assignedTo ?String(staffEmailByUid?.[assignedTo] || "").trim() : "";
              const staffStatus = String(r?.staffStatus || "").trim();
              const staffDecision = String(r?.staffDecision || "").trim();
              const staffUpdatedAt = formatShortTS(r?.staffUpdatedAt);
              const requestType = String(r?.requestType || "").trim().toLowerCase();
              const isFull = Boolean(r?.isFullPackage) || requestType === "full";
              const needsReassignment =
                Boolean(r?.needsReassignment) || String(r?.staffStatus || "").toLowerCase() === "reassignment_needed";
              const urgentReassign = needsReassignment || Boolean(r?.reassignUrgent);

              const sp = assignedTo ?staffPill(staffStatus || "assigned") : null;
              const rp = assignedTo ?staffRecPill(staffDecision) : null;

              const hasNew = pendingSet?.has(rid) || Boolean(unreadByRequest?.[rid]?.unread);
              const fullAccent = isFull
                ?"border-emerald-300/80 bg-emerald-50/35 dark:border-emerald-800/60 dark:bg-emerald-950/15"
                : "";
              const urgentAccent = urgentReassign
                ?"border-rose-300/80 bg-rose-50/45 dark:border-rose-800/60 dark:bg-rose-950/20"
                : "";
              const sideAccentStyle =
                urgentReassign || hasNew
                  ? { backgroundColor: "rgba(225, 29, 72, 0.82)" }
                  : buildCountryAccentRailStyle(accentColor);

              return (
                <motion.div
                  key={r.id}
                  variants={listItem}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRequestTileActivate(r)}
                  onPointerDown={(e) => beginLongPress(e, r)}
                  onPointerUp={cancelLongPressPending}
                  onPointerCancel={cancelLongPressPending}
                  onPointerLeave={cancelLongPressPending}
                  onPointerMove={maybeCancelLongPressOnMove}
                  onContextMenu={(e) => openRequestActionsFromContext(e, r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRequestTileActivate(r);
                    }
                  }}
                  className={`${tile} ${fullAccent} ${urgentAccent} relative overflow-hidden`}
                  style={buildCountryAccentSurfaceStyle(accentColor, { strong: isFull })}
                >
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
                    style={sideAccentStyle}
                  />

                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{left}</div>
                        {hasNew ?<RedDot /> : null}
                        {urgentReassign ?(
                          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-800 dark:border-rose-800/60 dark:bg-rose-900/35 dark:text-rose-200">
                            Re-assignment needed
                          </span>
                        ) : null}
                        {(pinsByTab?.[status] || []).includes(rid) ?(
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200"
                            title="Pinned to top in this tab"
                          >
                            <AppIcon icon={Pin} size={12} />
                            Pinned
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{right}</div>

                      {isFull ?(
                        <div className="mt-2">
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/35 dark:text-emerald-200">
                            Full package
                          </span>
                        </div>
                      ) : null}

                      {assignedTo ?(
                        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                          Assigned to:{" "}
                          <span className="text-zinc-800 dark:text-zinc-100">{assignedEmail || assignedTo}</span>
                          {staffUpdatedAt ?(
                            <span className="ml-2 text-zinc-500 dark:text-zinc-400">• Updated: {staffUpdatedAt}</span>
                          ) : null}
                        </div>
                      ) : null}

                      {urgentReassign ?(
                        <div className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                          {String(r?.reassignReason || "Urgent: this request needs reassignment.")}
                        </div>
                      ) : null}

                      <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        ID: <span className="font-mono">{r.id}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 max-w-[190px]">
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${p.cls}`}>{p.label}</span>

                      {sp ?(
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${sp.cls}`}>
                          {sp.label}
                        </span>
                      ) : null}

                      {rp ?(
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${rp.cls}`}
                          title="Staff recommendation"
                        >
                          {rp.label}
                        </span>
                      ) : null}

                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 transition hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200 dark:hover:bg-zinc-900">
                        <AppIcon size={ICON_MD} icon={ChevronRight} />
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
            {visibleCount < filtered.length ?(
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + INITIAL_RENDER_COUNT)}
                className="mx-auto text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition hover:opacity-80 active:scale-[0.99]"
              >
                See more...
              </button>
            ) : null}
          </motion.div>
        )}

        <div className="h-10" />
      </motion.div>

      <AnimatePresence>
        {requestActions?.request ?(
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeRequestActions}
          >
            <div className="absolute inset-0 bg-black/18" />
            {(() => {
              const actionReq = requestActions.request;
              const actionTabKey = isValidTabKey(requestActions.tabKey) ?requestActions.tabKey : status;
              const actionRid = String(actionReq?.id || "").trim();
              const isPinned = (pinsByTab?.[actionTabKey] || []).includes(actionRid);
              const shortLabel =
                actionReq?.requestType === "full"
                  ?"Full Package"
                  : String(actionReq?.serviceName || "Request");

              const vw = typeof window !== "undefined" ?window.innerWidth : 360;
              const vh = typeof window !== "undefined" ?window.innerHeight : 640;
              const docStyle =
                typeof window !== "undefined" && typeof document !== "undefined"
                  ? window.getComputedStyle(document.documentElement)
                  : null;
              const safeTop = Math.max(0, parseFloat(docStyle?.getPropertyValue("--app-safe-top") || "0") || 0);
              const safeRight = Math.max(0, parseFloat(docStyle?.getPropertyValue("--app-safe-right") || "0") || 0);
              const safeBottom = Math.max(0, parseFloat(docStyle?.getPropertyValue("--app-safe-bottom") || "0") || 0);
              const safeLeft = Math.max(0, parseFloat(docStyle?.getPropertyValue("--app-safe-left") || "0") || 0);
              const menuW = Math.max(216, Math.min(272, vw - 20));
              const menuH = 168;
              const rawX = Number(requestActions?.x || 0);
              const rawY = Number(requestActions?.y || 0);
              const anchorX = rawX > 0 ?rawX : Math.round(vw / 2);
              const anchorY = rawY > 0 ?rawY : Math.round(vh / 2);
              const edgePad = 10;
              const leftMin = safeLeft + edgePad;
              const leftMax = Math.max(leftMin, vw - menuW - safeRight - edgePad);
              const topMin = safeTop + edgePad;
              const topMax = Math.max(topMin, vh - menuH - safeBottom - edgePad);
              const left = Math.max(leftMin, Math.min(anchorX - edgePad, leftMax));
              const top = Math.max(topMin, Math.min(anchorY - edgePad, topMax));
              const originX = Math.max(10, Math.min(anchorX - left, menuW - 10));
              const originY = Math.max(10, Math.min(anchorY - top, menuH - 10));

              return (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.12, ease: "easeOut" }}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute rounded-2xl border border-zinc-200/90 bg-white/94 p-2.5 shadow-lg backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/92"
                  style={{
                    left,
                    top,
                    width: menuW,
                    maxWidth: "calc(100vw - 20px)",
                    transformOrigin: `${originX}px ${originY}px`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2 px-2 pb-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{shortLabel}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {TABS.find((t) => t.key === actionTabKey)?.label || actionTabKey} tab actions
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closeRequestActions}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white/80 text-zinc-600 transition hover:bg-white active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      aria-label="Close actions"
                    >
                      <AppIcon icon={X} size={ICON_SM} />
                    </button>
                  </div>

                  <div className="grid gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        togglePinnedForTab({ requestId: actionRid, tabKey: actionTabKey });
                        closeRequestActions();
                      }}
                      className="inline-flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 active:scale-[0.99] dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200 dark:hover:bg-emerald-950/30"
                    >
                      <span>{isPinned ?"Unpin from top" : "Pin to top"}</span>
                      <AppIcon icon={isPinned ?PinOff : Pin} size={ICON_SM} className="text-emerald-700 dark:text-emerald-200" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteRequest(actionReq)}
                      disabled={deletingId === actionRid}
                      className="inline-flex w-full items-center justify-between rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2.5 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100 active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-200 dark:hover:bg-rose-950/30"
                    >
                      <span>{deletingId === actionRid ?"Deleting..." : "Delete request"}</span>
                      <AppIcon icon={Trash2} size={ICON_SM} />
                    </button>

                  </div>
                </motion.div>
              );
            })()}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}


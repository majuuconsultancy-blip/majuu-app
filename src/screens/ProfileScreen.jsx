import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "../utils/motionProxy";
import {
  Mail,
  Pencil,
  LogOut,
  Settings,
  ShieldCheck,
  Phone,
  Flag,
  FileText,
  MapPinned,
  ChevronRight,
} from "lucide-react";

import AppIcon from "../components/AppIcon";
import CollapsibleSection from "../components/CollapsibleSection";
import ThemeToggle from "../components/ThemeToggle";
import { ICON_SM, ICON_MD } from "../constants/iconSizes";
import { auth } from "../firebase";
import { getUserState } from "../services/userservice";
import {
  isAnyAdminRole,
  normalizeUserRole,
  resolveRoleFromUserDoc,
} from "../services/adminroleservice";
import {
  journeyDisplayCountry,
  normalizeJourney,
  normalizeJourneyTrack,
} from "../journey/journeyModel";
import { getProfileLanguageLabel } from "../utils/userProfile";

const PERF_TAG = "[perf][ProfileScreen]";
const PROFILE_CACHE_PREFIX = "majuu_profile_cache_";

function startPerf(label) {
  try {
    console.time(label);
  } catch {
    // ignore console timer issues
  }
}

function endPerf(label) {
  try {
    console.timeEnd(label);
  } catch {
    // ignore console timer issues
  }
}

function profileCacheKey(uid) {
  return `${PROFILE_CACHE_PREFIX}${String(uid || "")}`;
}

function readProfileCache(uid) {
  if (!uid || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(profileCacheKey(uid));
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      name: String(parsed?.name || ""),
      phone: String(parsed?.phone || ""),
      countryOfResidence: String(parsed?.countryOfResidence || ""),
      county: String(parsed?.county || ""),
      town: String(parsed?.town || ""),
      language: String(parsed?.language || ""),
      role: String(parsed?.role || ""),
      activeTrack: String(parsed?.activeTrack || "").toLowerCase(),
      updatedAt: Number(parsed?.updatedAt || 0) || 0,
    };
  } catch {
    return null;
  }
}

function writeProfileCache(uid, payload) {
  if (!uid || typeof window === "undefined") return;
  try {
    const safe = {
      name: String(payload?.name || ""),
      phone: String(payload?.phone || ""),
      countryOfResidence: String(payload?.countryOfResidence || ""),
      county: String(payload?.county || ""),
      town: String(payload?.town || ""),
      language: String(payload?.language || ""),
      role: String(payload?.role || ""),
      activeTrack: String(payload?.activeTrack || "").toLowerCase(),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(profileCacheKey(uid), JSON.stringify(safe));
  } catch {
    // ignore cache write issues
  }
}

const pageIn = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.14, ease: "easeOut" } },
};

const floatCard = {
  rest: { y: 0, scale: 1 },
  hover: { y: -1, scale: 1.005, transition: { duration: 0.1 } },
  tap: { scale: 0.995 },
};

export default function ProfileScreen() {
  const navigate = useNavigate();
  const mountAtRef = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const firstPaintLoggedRef = useRef(false);
  const lastHydratedUidRef = useRef("");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryOfResidence, setCountryOfResidence] = useState("");
  const [county, setCounty] = useState("");
  const [town, setTown] = useState("");
  const [language, setLanguage] = useState("");
  const [role, setRole] = useState("");
  const [activeTrack, setActiveTrack] = useState("");
  const [journey, setJourney] = useState(() => normalizeJourney(null));
  const [busy, setBusy] = useState("");

  const isAdmin = useMemo(() => isAnyAdminRole(role), [role]);
  const adminBadgeLabel = useMemo(() => {
    const normalized = normalizeUserRole(role);
    if (normalized === "superAdmin") return "Superadmin";
    if (normalized === "assignedAdmin") return "Assigned Admin";
    return "Admin";
  }, [role]);
  const showElevatedAdminTag = useMemo(
    () => adminBadgeLabel === "Superadmin" || adminBadgeLabel === "Assigned Admin",
    [adminBadgeLabel]
  );

  const initials = useMemo(() => {
    const base = (name || email || "U").trim();
    const parts = base.split(" ").filter(Boolean);
    const first = parts[0]?.[0] || base[0] || "U";
    const second = parts[1]?.[0] || "";
    return (first + second).toUpperCase();
  }, [name, email]);

  const journeyTrackLabel = useMemo(() => {
    const track = normalizeJourneyTrack(journey?.track);
    return track ? `${track.slice(0, 1).toUpperCase()}${track.slice(1)}` : "";
  }, [journey?.track]);

  const journeyCountryLabel = useMemo(() => journeyDisplayCountry(journey), [journey]);

  const journeySummary = useMemo(() => {
    if (!journeyTrackLabel) return "Not set";
    const base = journeyCountryLabel
      ? `${journeyTrackLabel} -> ${journeyCountryLabel}`
      : journeyTrackLabel;
    return journey?.stage ? `${base} - ${journey.stage}` : base;
  }, [journey?.stage, journeyCountryLabel, journeyTrackLabel]);

  useEffect(() => {
    if (firstPaintLoggedRef.current) return;
    firstPaintLoggedRef.current = true;
    const raf = window.requestAnimationFrame(() => {
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      const delta = Math.max(0, now - (mountAtRef.current || 0));
      console.log(`${PERF_TAG} mount->first-paint: ${delta.toFixed(1)}ms`);
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async (user) => {
      if (!user) return;
      const uidNow = String(user.uid || "");
      if (!uidNow) return;
      if (lastHydratedUidRef.current === uidNow) return;

      lastHydratedUidRef.current = uidNow;
      setEmail(user.email || "");
      setErr("");

      const cached = readProfileCache(uidNow);
      if (cached) {
        setName(cached.name || "");
        setPhone(cached.phone || "");
        setCountryOfResidence(cached.countryOfResidence || "");
        setCounty(cached.county || "");
        setTown(cached.town || "");
        setLanguage(cached.language || "");
        setRole(
          resolveRoleFromUserDoc({
            role: cached.role || "",
            email: user.email || "",
            hasActiveStaffAccess: false,
          })
        );
        if (
          cached.activeTrack === "study" ||
          cached.activeTrack === "work" ||
          cached.activeTrack === "travel"
        ) {
          setActiveTrack(cached.activeTrack);
        }
        setLoading(false);
      } else {
        setLoading(true);
      }

      const timer = `${PERF_TAG} firestore:getUserState`;
      try {
        startPerf(timer);
        const state = await getUserState(uidNow, user.email || "");
        endPerf(timer);
        if (cancelled) return;

        const nextName = state?.name || "";
        const nextPhone = state?.phone || "";
        const nextResidence = state?.countryOfResidence || "";
        const nextCounty = state?.county || "";
        const nextTown = state?.town || "";
        const nextLanguage = getProfileLanguageLabel(state?.profile?.language || "");
        const nextRole = resolveRoleFromUserDoc({
          role: state?.role,
          email: user.email || state?.email || "",
          adminScope: state?.adminScope,
          adminUpdatedBy: state?.adminUpdatedBy,
          adminUpdatedAt: state?.adminUpdatedAt,
          hasActiveStaffAccess: false,
        });

        setName(nextName);
        setPhone(nextPhone);
        setCountryOfResidence(nextResidence);
        setCounty(nextCounty);
        setTown(nextTown);
        setLanguage(nextLanguage);
        setRole(nextRole);
        setJourney(normalizeJourney(state?.journey));

        const nextTrack = String(state?.activeTrack || state?.selectedTrack || "").toLowerCase();
        if (nextTrack === "study" || nextTrack === "work" || nextTrack === "travel") {
          setActiveTrack(nextTrack);
        } else {
          setActiveTrack("");
        }

        writeProfileCache(uidNow, {
          name: nextName,
          phone: nextPhone,
          countryOfResidence: nextResidence,
          county: nextCounty,
          town: nextTown,
          language: nextLanguage,
          role: nextRole,
          activeTrack: nextTrack,
        });
      } catch (error) {
        endPerf(timer);
        if (cancelled) return;
        console.error(error);
        setErr(error?.message || "Failed to load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const current = auth.currentUser;
    if (current) hydrate(current);

    const unsub = onAuthStateChanged(auth, (user) => {
      if (cancelled) return;
      if (!user) {
        navigate("/login", { replace: true });
        return;
      }
      hydrate(user);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [navigate]);

  useEffect(() => {
    try {
      window.history.replaceState(
        { ...(window.history.state || {}), __majuu_profile: true },
        ""
      );
    } catch {
      // ignore history state issues
    }

    const onPopState = (event) => {
      try {
        event.preventDefault?.();
      } catch {
        // ignore
      }
      navigate(`/app/${activeTrack || "study"}`, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, activeTrack]);

  const openEdit = () => {
    navigate("/app/profile/edit");
  };

  const logout = async () => {
    try {
      setBusy("logout");
      await signOut(auth);
      navigate("/login", { replace: true });
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl p-5">
          <div className="animate-pulse rounded-3xl border border-zinc-200 bg-white/70 p-5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="h-6 w-28 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-2 h-4 w-64 rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-6 h-24 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-4 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-3 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </div>
    );
  }

  const topBg =
    "bg-gradient-to-b from-emerald-50/60 via-white to-zinc-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const glass =
    "border border-white/40 bg-white/55 backdrop-blur-xl shadow-[0_14px_40px_rgba(0,0,0,0.10)] dark:border-zinc-800/70 dark:bg-zinc-900/55";
  const tile = `rounded-2xl ${glass} transition will-change-transform`;
  const tileHover =
    "hover:shadow-[0_20px_60px_rgba(0,0,0,0.14)] hover:border-emerald-200/60 dark:hover:border-emerald-900/40";
  const actionCard = `${tile} ${tileHover} p-4 text-left`;
  const infoChip =
    "inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/82 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200";
  const adminCard =
    "rounded-2xl border border-emerald-200/70 bg-emerald-50/55 p-4 shadow-[0_14px_40px_rgba(16,185,129,0.18)] transition hover:bg-emerald-50/70 hover:shadow-[0_22px_70px_rgba(16,185,129,0.22)] active:scale-[0.99] dark:border-emerald-900/45 dark:bg-emerald-950/28";
  const logoutCard =
    "rounded-2xl border border-rose-200/70 bg-rose-50/45 p-4 shadow-[0_14px_40px_rgba(244,63,94,0.12)] transition hover:bg-rose-50/60 hover:shadow-[0_22px_70px_rgba(244,63,94,0.16)] active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/22";

  const secondaryDetails = [
    { label: "Preferred county", value: county?.trim() ? county : "Not set" },
    { label: "Preferred town/city", value: town?.trim() ? town : "Not set" },
    { label: "Language", value: language?.trim() ? language : "Not set" },
  ];

  return (
    <div className={`min-h-screen ${topBg}`}>
      <Motion.div
        variants={pageIn}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-xl px-5 pb-10 pt-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[2.25rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Profile
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Your details, preferences, and settings
            </p>
            {showElevatedAdminTag ? (
              <span className="mt-2 inline-flex rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-900/45 dark:bg-rose-950/30 dark:text-rose-200">
                {adminBadgeLabel}
              </span>
            ) : null}
          </div>

          <div className="shrink-0">
            <ThemeToggle />
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        <Motion.div
          className={`mt-6 rounded-[2rem] ${glass} p-6`}
          initial={{ opacity: 0, y: 4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.14, ease: "easeOut" },
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] border border-emerald-100/70 bg-emerald-50/70 text-xl font-bold text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                {initials}
              </div>

              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {name?.trim() ? name : "Your name"}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <AppIcon size={ICON_SM} className="text-zinc-500 dark:text-zinc-400" icon={Mail} />
                  <span className="truncate">{email || "-"}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className={infoChip}>
                    <AppIcon size={ICON_SM} icon={Flag} />
                    <span>{countryOfResidence?.trim() ? countryOfResidence : "Residence not set"}</span>
                  </span>
                  <span className={infoChip}>
                    <AppIcon size={ICON_SM} icon={Phone} />
                    <span>{phone?.trim() ? phone : "Phone not set"}</span>
                  </span>
                </div>
              </div>
            </div>

            <Motion.button
              type="button"
              onClick={openEdit}
              whileTap={{ scale: 0.995 }}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <AppIcon size={ICON_MD} icon={Pencil} />
              Edit
            </Motion.button>
          </div>
        </Motion.div>

        <Motion.div
          variants={floatCard}
          initial="rest"
          whileHover="hover"
          whileTap="tap"
          className={`${tile} mt-4 p-4`}
        >
          <CollapsibleSection
            title="Profile details"
            subtitle="Location and language preferences"
            meta={`${secondaryDetails.filter((item) => item.value !== "Not set").length}/${secondaryDetails.length}`}
            bodyClassName="mt-4 grid gap-2"
          >
            {secondaryDetails.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-white/80 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40"
              >
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</div>
                <div className="text-sm font-semibold text-right text-zinc-900 dark:text-zinc-100">
                  {item.value}
                </div>
              </div>
            ))}
          </CollapsibleSection>
        </Motion.div>

        <div className="mt-4 grid gap-2">
          <Motion.button
            type="button"
            onClick={() => navigate("/app/profile/journey")}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={actionCard}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <AppIcon size={ICON_MD} icon={MapPinned} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Journey</div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    {journeySummary === "Not set"
                      ? "Set your track and country for faster routing."
                      : journeySummary}
                  </div>
                </div>
              </div>
              <AppIcon size={ICON_MD} icon={ChevronRight} className="text-zinc-400 dark:text-zinc-500" />
            </div>
          </Motion.button>

          <Motion.button
            type="button"
            onClick={() => navigate("/app/legal")}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={actionCard}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <AppIcon size={ICON_MD} icon={FileText} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Legal Policies Help Center
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Policies, FAQs, WhatsApp help, and support contacts.
                  </div>
                </div>
              </div>
              <AppIcon size={ICON_MD} icon={ChevronRight} className="text-zinc-400 dark:text-zinc-500" />
            </div>
          </Motion.button>

          <Motion.button
            type="button"
            onClick={() => navigate("/app/settings")}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={actionCard}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-100/70 bg-emerald-50/70 text-emerald-800 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-emerald-200">
                  <AppIcon size={ICON_MD} icon={Settings} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Settings</div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Security, email, and app unlock.
                  </div>
                </div>
              </div>
              <AppIcon size={ICON_MD} icon={ChevronRight} className="text-zinc-400 dark:text-zinc-500" />
            </div>
          </Motion.button>

          {isAdmin ? (
            <Motion.button
              type="button"
              onClick={() => navigate("/app/admin")}
              variants={floatCard}
              initial="rest"
              whileHover="hover"
              whileTap="tap"
              className={`${adminCard} text-left`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200/70 bg-emerald-50/80 text-emerald-800 dark:border-emerald-900/45 dark:bg-emerald-950/28 dark:text-emerald-200">
                    <AppIcon size={ICON_MD} icon={ShieldCheck} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                      Admin tools
                    </div>
                    <div className="mt-0.5 text-xs text-emerald-900/70 dark:text-emerald-200/80">
                      Manage requests, users, and staff.
                    </div>
                  </div>
                </div>
                <AppIcon
                  size={ICON_MD}
                  icon={ChevronRight}
                  className="text-emerald-700/70 dark:text-emerald-200/80"
                />
              </div>
            </Motion.button>
          ) : null}

          <Motion.button
            type="button"
            onClick={logout}
            disabled={busy === "logout"}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={`${logoutCard} text-left`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-rose-200/80 bg-rose-50/70 text-rose-700 dark:border-rose-900/45 dark:bg-rose-950/24 dark:text-rose-200">
                  <AppIcon size={ICON_MD} icon={LogOut} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-rose-700 dark:text-rose-200">
                    {busy === "logout" ? "Logging out..." : "Logout"}
                  </div>
                  <div className="mt-0.5 text-xs text-rose-700/70 dark:text-rose-200/80">
                    Sign out of your account.
                  </div>
                </div>
              </div>
              <AppIcon size={ICON_MD} icon={ChevronRight} className="text-rose-400 dark:text-rose-300" />
            </div>
          </Motion.button>
        </div>
      </Motion.div>
    </div>
  );
}

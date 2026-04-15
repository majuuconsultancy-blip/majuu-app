import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { motion as Motion } from "../utils/motionProxy";
import {
  Pencil,
  LogOut,
  Settings,
  ShieldCheck,
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
  const [photoURL, setPhotoURL] = useState("");
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
  const isManager = useMemo(() => normalizeUserRole(role) === "manager", [role]);
  const hasAdminTools = isAdmin || isManager;
  const adminBadgeLabel = useMemo(() => {
    const normalized = normalizeUserRole(role);
    if (normalized === "superAdmin") return "Superadmin";
    if (normalized === "assignedAdmin") return "Assigned Admin";
    if (normalized === "manager") return "Manager";
    return "Admin";
  }, [role]);

  const avatarInitial = useMemo(() => {
    const base = (name || email || "U").trim();
    return (base[0] || "U").toUpperCase();
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
      setPhotoURL(user.photoURL || "");
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
    "bg-gradient-to-b from-emerald-50/45 via-zinc-50 to-zinc-100/35 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950";
  const glass =
    "border border-white/65 bg-white/72 backdrop-blur-xl shadow-[0_12px_36px_rgba(15,23,42,0.08)] dark:border-zinc-800/70 dark:bg-zinc-900/58";
  const tile = `rounded-3xl ${glass} transition will-change-transform`;
  const tileHover =
    "hover:shadow-[0_16px_44px_rgba(15,23,42,0.11)] hover:border-emerald-200/70 dark:hover:border-emerald-900/40";
  const actionCard = `${tile} ${tileHover} p-4 text-left`;
  const adminCard =
    "rounded-3xl border border-emerald-200/70 bg-emerald-50/55 p-4 shadow-[0_12px_36px_rgba(16,185,129,0.16)] transition hover:bg-emerald-50/70 hover:shadow-[0_16px_44px_rgba(16,185,129,0.2)] active:scale-[0.99] dark:border-emerald-900/45 dark:bg-emerald-950/28";
  const logoutCard =
    "rounded-3xl border border-rose-200/70 bg-rose-50/45 p-4 shadow-[0_12px_36px_rgba(244,63,94,0.12)] transition hover:bg-rose-50/60 hover:shadow-[0_16px_44px_rgba(244,63,94,0.16)] active:scale-[0.99] disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-950/22";

  const countryValue = countryOfResidence?.trim() ? countryOfResidence : "Not set";
  const phoneValue = phone?.trim() ? phone : "Not set";
  const profileDetails = [
    { label: "Full name", value: name?.trim() ? name : "Not set" },
    { label: "Email", value: email || "Not set" },
    { label: "Phone number", value: phoneValue },
    { label: "Country of residence", value: countryValue },
    ...(language?.trim() ? [{ label: "Language", value: language }] : []),
    ...(county?.trim() ? [{ label: "County", value: county }] : []),
    ...(town?.trim() ? [{ label: "Town/City", value: town }] : []),
  ];

  return (
    <div className={`min-h-screen ${topBg}`}>
      <Motion.div
        variants={pageIn}
        initial="hidden"
        animate="show"
        className="mx-auto max-w-xl px-5 pb-10 pt-6"
      >
        <Motion.div
          className={`relative mt-1 rounded-[2rem] ${glass} px-5 pb-5 pt-6 text-center`}
          initial={{ opacity: 0, y: 4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.14, ease: "easeOut" },
          }}
        >
          <div className="absolute right-4 top-4">
            <ThemeToggle />
          </div>

          <div className="mx-auto h-20 w-20 overflow-hidden rounded-full border border-zinc-200/80 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/70">
            {photoURL ? (
              <img src={photoURL} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-700 dark:text-zinc-200">
                {avatarInitial}
              </div>
            )}
          </div>

          <h1 className="mt-3 truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {name?.trim() ? name : "Your name"}
          </h1>
          <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-300">{email || "-"}</p>

          {hasAdminTools ? (
            <div className="mt-2 flex items-center justify-center">
              <span className="inline-flex rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-900/45 dark:bg-rose-950/30 dark:text-rose-200">
                {adminBadgeLabel}
              </span>
            </div>
          ) : null}

          <Motion.button
            type="button"
            onClick={openEdit}
            whileTap={{ scale: 0.99 }}
            className={`inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white/80 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100 ${
              hasAdminTools ? "mt-5" : "mt-3"
            }`}
          >
            <AppIcon size={ICON_SM} icon={Pencil} />
            Edit profile
          </Motion.button>
        </Motion.div>

        {err ? (
          <div className="mt-3 rounded-2xl border border-rose-100 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-200">
            {err}
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2.5 text-left">
          <div className="rounded-2xl border border-zinc-200/80 bg-white/85 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              Country
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {countryValue}
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-200/80 bg-white/85 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950/40">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              Phone
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {phoneValue}
            </div>
          </div>
        </div>

        <Motion.div
          variants={floatCard}
          initial="rest"
          whileHover="hover"
          whileTap="tap"
          className={`${tile} mt-4 p-4`}
        >
          <CollapsibleSection
            title="Profile details"
            subtitle="Contact, identity, and preferences"
            meta={`${profileDetails.filter((item) => item.value !== "Not set").length}/${profileDetails.length}`}
            bodyClassName="mt-3 grid gap-2.5"
          >
            {profileDetails.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200/80 bg-white/85 px-3.5 py-3 dark:border-zinc-700 dark:bg-zinc-950/40"
              >
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</div>
                <div className="text-sm font-semibold text-right text-zinc-900 dark:text-zinc-100">
                  {item.value}
                </div>
              </div>
            ))}
          </CollapsibleSection>
        </Motion.div>

        <div className="mt-4 grid gap-2.5">
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
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/85 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
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
            onClick={() => navigate("/app/profile/documents")}
            variants={floatCard}
            initial="rest"
            whileHover="hover"
            whileTap="tap"
            className={actionCard}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/85 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
                  <AppIcon size={ICON_MD} icon={FileText} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Documents
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Uploaded and received files in one place.
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
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/85 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
                  <AppIcon size={ICON_MD} icon={ShieldCheck} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Legal Policies Help Center
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Policies, FAQs and support.
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
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/85 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
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

          {hasAdminTools ? (
            <Motion.button
              type="button"
              onClick={() => navigate(isManager ? "/app/admin/sacc" : "/app/admin")}
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
                      {isManager ? "Manager tools" : "Admin tools"}
                    </div>
                    <div className="mt-0.5 text-xs text-emerald-900/70 dark:text-emerald-200/80">
                      {isManager
                        ? "Open your assigned management modules."
                        : "Manage requests, users, and staff."}
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

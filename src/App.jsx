import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

// Public
import IntroScreen from "./screens/IntroScreen";
import LoginScreen from "./screens/LoginScreen";
import SignupScreen from "./screens/SignupScreen";
import VerifyEmailScreen from "./screens/VerifyEmailScreen";
import TrackSelectScreen from "./screens/TrackSelectScreen";
import SetupProfileJourneyScreen from "./screens/SetupProfileJourneyScreen";

// App shell + core screens (non-lazy)
import AppLayout from "./components/AppLayout";
import SmartHome from "./screens/SmartHome";
import StudyScreen from "./screens/StudyScreen";
import WorkScreen from "./screens/WorkScreen";
import TravelScreen from "./screens/TravelScreen";
import ProgressScreen from "./screens/ProgressScreen";
import NewsScreen from "./screens/NewsScreen";
import ProfileScreen from "./screens/ProfileScreen";
import EditProfileScreen from "./screens/EditProfileScreen";
import EditJourneyScreen from "./screens/EditJourneyScreen";

// Gates
import AdminGate from "./components/AdminGate";
import GAPageView from "./components/GAPageView";
import StaffGate from "./components/StaffGate";
import AppLoading from "./components/AppLoading";
import { auth } from "./firebase";
import { startNotifsV2Engine, stopNotifsV2Engine } from "./services/notifsV2Engine";
import { cleanupPushBridge, initPushBridge } from "./services/pushBridge";
import { sweepStaleAssignments } from "./services/adminrequestservice";
import { getCurrentUserRoleContext } from "./services/adminroleservice";
import { hasSeenIntro } from "./utils/introFlag";
import { isResumableRoute, setSnapshot } from "./resume/resumeEngine";
import BiometricAppLock from "./components/BiometricAppLock";
import { getUserState } from "./services/userservice";
import { resolveLandingPathFromUserState } from "./journey/journeyLanding";
import { normalizeJourney } from "./journey/journeyModel";
import { ANALYTICS_EVENT_TYPES } from "./constants/analyticsEvents";
import { logAnalyticsEvent } from "./services/analyticsService";
import { useI18n } from "./lib/i18n";
import { AuthSessionProvider, useAuthSession } from "./auth/AuthSessionContext";

/* ---------------- Lazy screens ---------------- */
// Main user flows
const PaymentScreen = lazy(() => import("./screens/PaymentScreen"));
const DummyPaymentScreen = lazy(() => import("./screens/DummyPaymentScreen"));
const PaymentCallbackScreen = lazy(() => import("./screens/PaymentCallbackScreen"));
const SharedPaymentScreen = lazy(() => import("./screens/SharedPaymentScreen"));

const StudySelfHelp = lazy(() => import("./screens/StudySelfHelp"));
const StudyWeHelp = lazy(() => import("./screens/StudyWeHelp"));
const StudyMoneyTools = lazy(() => import("./screens/StudyMoneyTools"));
const StudySelfHelpDocuments = lazy(() => import("./screens/StudySelfHelpDocuments"));
const WorkSelfHelp = lazy(() => import("./screens/WorkSelfHelp"));
const WorkWeHelp = lazy(() => import("./screens/WorkWeHelp"));
const WorkMoneyTools = lazy(() => import("./screens/WorkMoneyTools"));
const WorkSelfHelpDocuments = lazy(() => import("./screens/WorkSelfHelpDocuments"));
const TravelSelfHelp = lazy(() => import("./screens/TravelSelfHelp"));
const TravelWeHelp = lazy(() => import("./screens/TravelWeHelp"));
const TravelMoneyTools = lazy(() => import("./screens/TravelMoneyTools"));
const TravelSelfHelpDocuments = lazy(() => import("./screens/TravelSelfHelpDocuments"));
const DiscoveryScreen = lazy(() => import("./screens/DiscoveryScreen"));
const DiscoveryDetailScreen = lazy(() => import("./screens/DiscoveryDetailScreen"));
const CompareCountriesScreen = lazy(() => import("./screens/CompareCountriesScreen"));
const DiscoveryMatchQuestionnaireScreen = lazy(() =>
  import("./screens/DiscoveryMatchQuestionnaireScreen")
);
const DiscoveryMatchResultsScreen = lazy(() => import("./screens/DiscoveryMatchResultsScreen"));

const FullPackageMissingScreen = lazy(() => import("./screens/FullPackageMissingScreen"));
const SettingsScreen = lazy(() => import("./screens/SettingsScreen"));
const NotificationsScreen = lazy(() => import("./screens/NotificationsScreen"));
const RequestStatusScreen = lazy(() => import("./screens/RequestStatusScreen"));
const LegalPortalScreen = lazy(() => import("./screens/LegalPortalScreen"));
const LegalDocumentScreen = lazy(() => import("./screens/LegalDocumentScreen"));

// Admin
const AdminRequestsScreen = lazy(() => import("./screens/AdminRequestsScreen"));
const AdminRequestDetailsScreen = lazy(() => import("./screens/AdminRequestDetailsScreen"));
const AdminRequestDocumentsScreen = lazy(() => import("./screens/AdminRequestDocumentsScreen"));
const AdminManageStaffScreen = lazy(() => import("./screens/AdminManageStaffScreen"));
const AdminAssignAdminScreen = lazy(() => import("./screens/AdminAssignAdminScreen"));
const AdminManageAdminsScreen = lazy(() => import("./screens/AdminManageAdminsScreen"));
const AdminSaccScreen = lazy(() => import("./screens/AdminSaccScreen"));
const AdminAnalyticsScreen = lazy(() => import("./screens/AdminAnalyticsScreen"));
const AdminNewsManagementScreen = lazy(() => import("./screens/AdminNewsManagementScreen"));
const AdminPricingControlsScreen = lazy(() => import("./screens/AdminPricingControlsScreen"));
const AdminFinancesScreen = lazy(() => import("./screens/AdminFinancesScreen"));
const AdminPartnershipsScreen = lazy(() => import("./screens/AdminPartnershipsScreen"));
const AdminCountryManagementScreen = lazy(() =>
  import("./screens/AdminCountryManagementScreen")
);
const AdminHomeDesignScreen = lazy(() => import("./screens/AdminHomeDesignScreen"));
const AdminRequestManagementScreen = lazy(() =>
  import("./screens/AdminRequestManagementScreen")
);
const AdminSelfHelpLinksManagementScreen = lazy(() =>
  import("./screens/AdminSelfHelpLinksManagementScreen")
);

// Staff
const StaffHomeScreen = lazy(() => import("./screens/StaffHomeScreen"));
const StaffOnboardingScreen = lazy(() => import("./screens/StaffOnboardingScreen"));
const StaffTasksScreen = lazy(() => import("./screens/StaffTasksScreen"));
const StaffRequestDetailsScreen = lazy(() => import("./screens/StaffRequestDetailsScreen"));
const StaffRequestDocumentsScreen = lazy(() => import("./screens/StaffRequestDocumentsScreen"));
const StaffStartWorkModalScreen = lazy(() => import("./screens/StaffStartWorkModalScreen"));
const ServicePartnerOnboardingScreen = lazy(() => import("./screens/ServicePartnerOnboardingScreen"));

const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();
const ROOT_EXIT_PATHS = new Set([
  "/app/home",
  "/app/study",
  "/app/work",
  "/app/travel",
  "/dashboard",
  "/staff",
  "/staff/tasks",
]);
const SAFE_FALLBACK_PATH = "/app/home";
const SCROLL_RESET_EXCLUDED_ROUTES = [/^\/staff\/request\/[^/]+\/start$/];

function shouldResetRouteScroll(pathname) {
  const path = String(pathname || "").trim();
  if (!path) return false;
  return !SCROLL_RESET_EXCLUDED_ROUTES.some((pattern) => pattern.test(path));
}

/* ---------------- Preload helpers ---------------- */
function preloadCriticalScreens() {
  // LAZY ONLY
  import("./screens/StudySelfHelp");
  import("./screens/StudyWeHelp");
  import("./screens/StudyMoneyTools");
  import("./screens/StudySelfHelpDocuments");
  import("./screens/WorkSelfHelp");
  import("./screens/WorkWeHelp");
  import("./screens/WorkMoneyTools");
  import("./screens/WorkSelfHelpDocuments");
  import("./screens/TravelSelfHelp");
  import("./screens/TravelWeHelp");
  import("./screens/TravelMoneyTools");
  import("./screens/TravelSelfHelpDocuments");
  import("./screens/DiscoveryScreen");
  import("./screens/DiscoveryDetailScreen");
  import("./screens/CompareCountriesScreen");
  import("./screens/DiscoveryMatchQuestionnaireScreen");
  import("./screens/DiscoveryMatchResultsScreen");

  import("./screens/FullPackageMissingScreen");
  import("./screens/RequestStatusScreen");
  import("./screens/SettingsScreen");
  import("./screens/NotificationsScreen");
  import("./screens/PaymentScreen");
  import("./screens/DummyPaymentScreen");
  import("./screens/PaymentCallbackScreen");
  import("./screens/SharedPaymentScreen");
  import("./screens/LegalPortalScreen");
  import("./screens/LegalDocumentScreen");
  import("./screens/ServicePartnerOnboardingScreen");
  import("./screens/AdminSelfHelpLinksManagementScreen");
  import("./screens/AdminRequestManagementScreen");
  import("./screens/AdminCountryManagementScreen");
  import("./screens/AdminHomeDesignScreen");
  import("./screens/AdminPartnershipsScreen");
  import("./screens/AdminFinancesScreen");
}

function runWhenIdle(fn) {
  if (typeof window === "undefined") return undefined;

  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(() => fn(), { timeout: 1500 });
    return () => window.cancelIdleCallback?.(id);
  }

  const t = window.setTimeout(() => fn(), 900);
  return () => window.clearTimeout(t);
}

function StartupRoute() {
  const { user, isAuthenticated } = useAuthSession();
  const [target, setTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let timeoutId = null;

    const finalize = (next) => {
      if (cancelled || settled) return;
      settled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      setTarget(next);
    };

    if (!hasSeenIntro()) {
      finalize("/intro");
      return () => {
        cancelled = true;
      };
    }

    if (!isAuthenticated || !user) {
      finalize("/login");
      return () => {
        cancelled = true;
      };
    }

    timeoutId = window.setTimeout(() => finalize("/dashboard"), 8000);

    void (async () => {
      try {
        const state = await getUserState(user.uid, user.email || "");
        const landing = resolveLandingPathFromUserState(state || {});

        const journey = normalizeJourney(state?.journey);
        const didHaveSavedJourney = Boolean(journey?.track);
        void logAnalyticsEvent({
          uid: user.uid,
          eventType: didHaveSavedJourney
            ? ANALYTICS_EVENT_TYPES.APP_LAUNCH_WITH_SAVED_JOURNEY
            : ANALYTICS_EVENT_TYPES.APP_LAUNCH_WITHOUT_SAVED_JOURNEY,
          trackType: journey.track,
          country: journey.country,
          countryType: journey.countryType,
          countryCustom: journey.countryCustom,
          sourceScreen: "StartupRoute",
          metadata: { landing },
        });

        finalize(landing);
      } catch (error) {
        void error;
        finalize("/dashboard");
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [isAuthenticated, user]);

  if (!target) {
    return (
      <AppLoading
        title="Preparing your dashboard..."
        subtitle="Checking your account and restoring progress"
        showAppName
        logoSrc="/icons/icon-192.png"
        logoAlt="Majuu logo"
      />
    );
  }
  return <Navigate to={target} replace />;
}

function RequireAuthRoute({ children }) {
  const { isAuthenticated } = useAuthSession();
  const location = useLocation();

  if (!isAuthenticated) {
    const from = `${location.pathname}${location.search || ""}${location.hash || ""}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return children;
}

function GuestOnlyRoute({ children }) {
  const { isAuthenticated } = useAuthSession();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function AndroidBackHandler() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!IS_NATIVE_PLATFORM) return undefined;

    let cleanedUp = false;
    let removeListener = null;

    // Android hardware back needs a single global policy to avoid random exits/logouts.
    const onBackButton = async () => {
      const modalBackEvent = new CustomEvent("majuu:back", { cancelable: true });
      window.dispatchEvent(modalBackEvent);
      if (modalBackEvent.defaultPrevented) return;

      const idx = typeof window.history.state?.idx === "number" ? window.history.state.idx : 0;
      const canGoBack = idx > 0 || window.history.length > 1;
      if (canGoBack) {
        navigate(-1);
        return;
      }

      if (ROOT_EXIT_PATHS.has(pathRef.current)) {
        await CapacitorApp.exitApp();
        return;
      }

      navigate(SAFE_FALLBACK_PATH, { replace: true });
    };

    CapacitorApp.addListener("backButton", onBackButton).then((listener) => {
      if (cleanedUp) {
        listener.remove();
        return;
      }
      removeListener = () => listener.remove();
    });

    return () => {
      cleanedUp = true;
      if (removeListener) removeListener();
    };
  }, [navigate]);

  return null;
}

function RouteScrollReset() {
  const location = useLocation();
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!shouldResetRouteScroll(location.pathname)) return undefined;

    const scrollToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    scrollToTop();
    const raf = window.requestAnimationFrame(scrollToTop);
    const timeoutId = window.setTimeout(scrollToTop, firstRunRef.current ? 120 : 40);
    firstRunRef.current = false;

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeoutId);
    };
  }, [location.pathname]);

  return null;
}

function RuntimeBridges() {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    let bootSeq = 0;
    let localEngineCleanup = () => {};
    let localPushCleanup = () => {};
    let localSweepCleanup = () => {};

    const unsub = onAuthStateChanged(auth, (user) => {
      bootSeq += 1;
      const seq = bootSeq;

      try {
        localEngineCleanup?.();
      } catch (error) {
        void error;
      }
      try {
        localPushCleanup?.();
      } catch (error) {
        void error;
      }
      try {
        localSweepCleanup?.();
      } catch (error) {
        void error;
      }
      localEngineCleanup = () => {};
      localPushCleanup = () => {};
      localSweepCleanup = () => {};

      if (!user) {
        stopNotifsV2Engine();
        cleanupPushBridge();
        return;
      }

      (async () => {
        const ctx = await getCurrentUserRoleContext(user.uid);
        const role =
          ctx.role === "superAdmin"
            ? "admin"
            : ctx.role === "assignedAdmin"
            ? "assignedAdmin"
            : ctx.role === "staff"
            ? "staff"
            : "user";

        if (disposed || seq !== bootSeq) return;
        localEngineCleanup = startNotifsV2Engine({ role, uid: user.uid });
        localPushCleanup = initPushBridge({ navigate, role, uid: user.uid }) || (() => {});
        if (role === "admin" || role === "assignedAdmin") {
          const runSweep = async () => {
            try {
              await sweepStaleAssignments({ staleHours: 24, max: 350 });
            } catch (error) {
              console.warn("admin background sweep failed:", error?.message || error);
            }
          };
          void runSweep();
          const timer = window.setInterval(runSweep, 5 * 60 * 1000);
          localSweepCleanup = () => window.clearInterval(timer);
        }
      })().catch(() => {});
    });

    return () => {
      disposed = true;
      try {
        localEngineCleanup?.();
      } catch (error) {
        void error;
      }
      try {
        localPushCleanup?.();
      } catch (error) {
        void error;
      }
      try {
        localSweepCleanup?.();
      } catch (error) {
        void error;
      }
      unsub();
      stopNotifsV2Engine();
      cleanupPushBridge();
    };
  }, [navigate]);

  return null;
}

function ResumeRouteWatcher() {
  const location = useLocation();

  useEffect(() => {
    const path = String(location.pathname || "").trim();
    if (!isResumableRoute(path)) return;

    if (path === "/dashboard") {
      setSnapshot({ trackSelect: { subStep: "dashboard" } });
      return;
    }

    if (path === "/app/progress") {
      return;
    }

    const patch = {
      route: {
        path,
        search: location.search || "",
      },
    };

    const requestMatch = path.match(/^\/app\/request\/([^/]+)$/);
    if (requestMatch?.[1]) {
      let requestId = requestMatch[1];
      try {
        requestId = decodeURIComponent(requestId);
      } catch (error) {
        void error;
      }
      patch.weHelp = { activeRequestId: requestId };
    }

    setSnapshot(patch);
  }, [location.pathname, location.search]);

  return null;
}

function AppRoutes() {
  const { authInitializing } = useAuthSession();

  if (authInitializing) {
    return (
      <AppLoading
        title="Restoring your session..."
        subtitle="Please wait while we load your account"
        showAppName
        logoSrc="/icons/icon-192.png"
        logoAlt="Majuu logo"
      />
    );
  }

  return (
    <>
      <RuntimeBridges />
      <ResumeRouteWatcher />
      <GAPageView />
      <AndroidBackHandler />
      <RouteScrollReset />
      <BiometricAppLock />

      <Suspense fallback={<AppLoading />}>
        <Routes>
          {/* Public */}
          <Route path="/intro" element={<IntroScreen />} />
          <Route path="/" element={<StartupRoute />} />

          <Route
            path="/login"
            element={
              <GuestOnlyRoute>
                <LoginScreen />
              </GuestOnlyRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <GuestOnlyRoute>
                <SignupScreen />
              </GuestOnlyRoute>
            }
          />
          <Route
            path="/verify-email"
            element={
              <RequireAuthRoute>
                <VerifyEmailScreen />
              </RequireAuthRoute>
            }
          />
          <Route
            path="/setup"
            element={
              <RequireAuthRoute>
                <SetupProfileJourneyScreen />
              </RequireAuthRoute>
            }
          />
          <Route path="/legal" element={<LegalPortalScreen />} />
          <Route path="/legal/:docKey" element={<LegalDocumentScreen />} />
          <Route path="/payment/callback" element={<PaymentCallbackScreen />} />
          <Route path="/pay/shared/:shareToken" element={<SharedPaymentScreen />} />

          {/* Track selection hub */}
          <Route
            path="/dashboard"
            element={
              <RequireAuthRoute>
                <TrackSelectScreen />
              </RequireAuthRoute>
            }
          />

          {/* Staff */}
          <Route
            path="/staff"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <StaffHomeScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/onboarding"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <StaffOnboardingScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/onboarding/legal/:docKey"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <LegalDocumentScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/tasks"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <StaffTasksScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/notifications"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <NotificationsScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/request/:requestId/start"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <StaffStartWorkModalScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/request/:requestId"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <StaffRequestDetailsScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />
          <Route
            path="/staff/request/:requestId/documents"
            element={
              <RequireAuthRoute>
                <StaffGate>
                  <StaffRequestDocumentsScreen />
                </StaffGate>
              </RequireAuthRoute>
            }
          />

          {/* App shell */}
          <Route
            path="/app"
            element={
              <RequireAuthRoute>
                <AppLayout />
              </RequireAuthRoute>
            }
          >
            <Route index element={<Navigate to="home" replace />} />

            <Route path="home" element={<SmartHome />} />
            <Route path="study" element={<StudyScreen />} />
            <Route path="work" element={<WorkScreen />} />
            <Route path="travel" element={<TravelScreen />} />
            <Route path="progress" element={<ProgressScreen />} />
            <Route path="news" element={<NewsScreen />} />

            <Route path="profile" element={<ProfileScreen />} />
            <Route path="profile/edit" element={<EditProfileScreen />} />
            <Route path="profile/journey" element={<EditJourneyScreen />} />
            <Route path="legal" element={<LegalPortalScreen mode="app" />} />
            <Route path="legal/:docKey" element={<LegalDocumentScreen />} />

            <Route path="payment" element={<PaymentScreen />} />
            <Route path="dummy-payment" element={<DummyPaymentScreen />} />
            <Route path="request/:requestId" element={<RequestStatusScreen />} />
            <Route path="service-partner/onboarding" element={<ServicePartnerOnboardingScreen />} />
            <Route path="service-partner/onboarding/legal/:docKey" element={<LegalDocumentScreen />} />

            <Route path="full-package/:track" element={<FullPackageMissingScreen />} />

            <Route path="study/self-help" element={<StudySelfHelp />} />
            <Route path="study/self-help/money-tools" element={<StudyMoneyTools />} />
            <Route path="study/self-help/documents" element={<StudySelfHelpDocuments />} />
            <Route path="study/we-help" element={<StudyWeHelp />} />
            <Route path="study/discovery" element={<DiscoveryScreen track="study" />} />
            <Route
              path="study/discovery/match"
              element={<DiscoveryMatchQuestionnaireScreen track="study" />}
            />
            <Route
              path="study/discovery/match/results"
              element={<DiscoveryMatchResultsScreen track="study" />}
            />
            <Route path="study/discovery/compare" element={<CompareCountriesScreen track="study" />} />
            <Route
              path="study/discovery/:countryParam"
              element={<DiscoveryDetailScreen track="study" />}
            />
            <Route path="work/self-help" element={<WorkSelfHelp />} />
            <Route path="work/self-help/money-tools" element={<WorkMoneyTools />} />
            <Route path="work/self-help/documents" element={<WorkSelfHelpDocuments />} />
            <Route path="work/we-help" element={<WorkWeHelp />} />
            <Route path="work/discovery" element={<DiscoveryScreen track="work" />} />
            <Route
              path="work/discovery/match"
              element={<DiscoveryMatchQuestionnaireScreen track="work" />}
            />
            <Route
              path="work/discovery/match/results"
              element={<DiscoveryMatchResultsScreen track="work" />}
            />
            <Route path="work/discovery/compare" element={<CompareCountriesScreen track="work" />} />
            <Route
              path="work/discovery/:countryParam"
              element={<DiscoveryDetailScreen track="work" />}
            />
            <Route path="travel/self-help" element={<TravelSelfHelp />} />
            <Route path="travel/self-help/money-tools" element={<TravelMoneyTools />} />
            <Route path="travel/self-help/documents" element={<TravelSelfHelpDocuments />} />
            <Route path="travel/we-help" element={<TravelWeHelp />} />
            <Route path="travel/discovery" element={<DiscoveryScreen track="travel" />} />
            <Route
              path="travel/discovery/match"
              element={<DiscoveryMatchQuestionnaireScreen track="travel" />}
            />
            <Route
              path="travel/discovery/match/results"
              element={<DiscoveryMatchResultsScreen track="travel" />}
            />
            <Route
              path="travel/discovery/compare"
              element={<CompareCountriesScreen track="travel" />}
            />
            <Route
              path="travel/discovery/:countryParam"
              element={<DiscoveryDetailScreen track="travel" />}
            />

            <Route path="settings" element={<SettingsScreen />} />
            <Route path="notifications" element={<NotificationsScreen />} />

            {/* Admin */}
            <Route
              path="admin"
              element={
                <AdminGate>
                  <AdminRequestsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/request/:requestId"
              element={
                <AdminGate>
                  <AdminRequestDetailsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/request/:requestId/documents"
              element={
                <AdminGate>
                  <AdminRequestDocumentsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/manage-staff"
              element={
                <AdminGate>
                  <AdminManageStaffScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/assign-admin"
              element={
                <AdminGate>
                  <AdminAssignAdminScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/manage-admins"
              element={
                <AdminGate>
                  <AdminManageAdminsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc"
              element={
                <AdminGate>
                  <AdminSaccScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/analytics"
              element={
                <AdminGate>
                  <AdminAnalyticsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/request-management"
              element={
                <AdminGate>
                  <AdminRequestManagementScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/home-design"
              element={
                <AdminGate>
                  <AdminHomeDesignScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/news"
              element={
                <AdminGate>
                  <AdminNewsManagementScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/partnerships"
              element={
                <AdminGate>
                  <AdminPartnershipsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/pricing"
              element={
                <AdminGate>
                  <AdminPricingControlsScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/finances"
              element={
                <AdminGate>
                  <AdminFinancesScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/selfhelp-links"
              element={
                <AdminGate>
                  <AdminSelfHelpLinksManagementScreen />
                </AdminGate>
              }
            />
            <Route
              path="admin/sacc/countries"
              element={
                <AdminGate>
                  <AdminCountryManagementScreen />
                </AdminGate>
              }
            />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

function DocumentLanguageSync() {
  const { language } = useI18n();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language || "en";
  }, [language]);

  return null;
}

export default function App() {
  useEffect(() => runWhenIdle(preloadCriticalScreens), []);

  const Router = IS_NATIVE_PLATFORM ? HashRouter : BrowserRouter;
  return (
    <Router>
      <AuthSessionProvider>
        <DocumentLanguageSync />
        <div className="app-safe-area">
          <AppRoutes />
        </div>
      </AuthSessionProvider>
    </Router>
  );
}

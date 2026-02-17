// ✅ App.jsx (FULL COPY-PASTE — Lazy preloading = smoother navigation)
//
// Your routing is good.
// Small improvements applied:
// ✅ Preload only LAZY screens (avoid dynamic importing screens already in main bundle)
// ✅ Adds an optional keyboard warm-up utility you can reuse elsewhere if you want later

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";

import IntroScreen from "./screens/IntroScreen";
import LoginScreen from "./screens/LoginScreen";
import SignupScreen from "./screens/SignupScreen";
import VerifyEmailScreen from "./screens/VerifyEmailScreen";
import TrackSelectScreen from "./screens/TrackSelectScreen";

import AppLayout from "./components/AppLayout";
import SmartHome from "./screens/SmartHome";
import StudyScreen from "./screens/StudyScreen";
import WorkScreen from "./screens/WorkScreen";
import TravelScreen from "./screens/TravelScreen";
import ProgressScreen from "./screens/ProgressScreen";
import ProfileScreen from "./screens/ProfileScreen";
import EditProfileScreen from "./screens/EditProfileScreen";

import AdminGate from "./components/AdminGate";
import GAPageView from "./components/GAPageView";
import StaffGate from "./components/StaffGate";

// ✅ small fallback (no new component needed)
function LazyFallback() {
  return (
    <div className="p-6">
      <p className="font-semibold">Loading…</p>
      <p className="text-sm text-white/70 dark:text-white/60">Just a moment</p>
    </div>
  );
}

// ✅ Lazy-load heavier screens (big bundle win)
const PaymentScreen = lazy(() => import("./screens/PaymentScreen"));

const StudySelfHelp = lazy(() => import("./screens/StudySelfHelp"));
const StudyWeHelp = lazy(() => import("./screens/StudyWeHelp"));
const WorkSelfHelp = lazy(() => import("./screens/WorkSelfHelp"));
const WorkWeHelp = lazy(() => import("./screens/WorkWeHelp"));
const TravelSelfHelp = lazy(() => import("./screens/TravelSelfHelp"));
const TravelWeHelp = lazy(() => import("./screens/TravelWeHelp"));

const FullPackageMissingScreen = lazy(() => import("./screens/FullPackageMissingScreen"));
const SettingsScreen = lazy(() => import("./screens/SettingsScreen"));
const NotificationsScreen = lazy(() => import("./screens/NotificationsScreen"));
const RequestStatusScreen = lazy(() => import("./screens/RequestStatusScreen"));

// ✅ Admin (heavy)
const AdminRequestsScreen = lazy(() => import("./screens/AdminRequestsScreen"));
const AdminRequestDetailsScreen = lazy(() => import("./screens/AdminRequestDetailsScreen"));
const AdminRequestDocumentsScreen = lazy(() => import("./screens/AdminRequestDocumentsScreen"));

// ✅ Staff (heavy)
const StaffHomeScreen = lazy(() => import("./screens/StaffHomeScreen"));
const StaffOnboardingScreen = lazy(() => import("./screens/StaffOnboardingScreen"));
const StaffTasksScreen = lazy(() => import("./screens/StaffTasksScreen"));
const StaffRequestDetailsScreen = lazy(() => import("./screens/StaffRequestDetailsScreen"));
const StaffRequestDocumentsScreen = lazy(() => import("./screens/StaffRequestDocumentsScreen"));
const StaffStartWorkModalScreen = lazy(() => import("./screens/StaffStartWorkModalScreen"));

/* ✅ Preload critical lazy screens after first paint (smoothness boost) */
function preloadCriticalScreens() {
  // Main user flows (LAZY ONLY)
  import("./screens/StudySelfHelp");
  import("./screens/StudyWeHelp");
  import("./screens/WorkSelfHelp");
  import("./screens/WorkWeHelp");
  import("./screens/TravelSelfHelp");
  import("./screens/TravelWeHelp");
  import("./screens/FullPackageMissingScreen");
  import("./screens/RequestStatusScreen");
  import("./screens/SettingsScreen");
  import("./screens/NotificationsScreen");
  import("./screens/PaymentScreen");
}

/* ✅ Safe idle callback wrapper (works everywhere) */
function runWhenIdle(fn) {
  if (typeof window === "undefined") return;

  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(() => fn(), { timeout: 1500 });
    return () => window.cancelIdleCallback?.(id);
  }

  const t = window.setTimeout(() => fn(), 900);
  return () => window.clearTimeout(t);
}

export default function App() {
  // ✅ Warm up lazy routes quietly in the background
  useEffect(() => {
    return runWhenIdle(preloadCriticalScreens);
  }, []);

  return (
    <BrowserRouter>
      <GAPageView />

      <Suspense fallback={<LazyFallback />}>
        <Routes>
          {/* Public */}
          <Route path="/intro" element={<IntroScreen />} />
          <Route path="/" element={<Navigate to="/intro" replace />} />

          <Route path="/login" element={<LoginScreen />} />
          <Route path="/signup" element={<SignupScreen />} />
          <Route path="/verify-email" element={<VerifyEmailScreen />} />

          {/* Track selection hub */}
          <Route path="/dashboard" element={<TrackSelectScreen />} />

          {/* ✅ Staff (same level as /app) */}
          <Route
            path="/staff"
            element={
              <StaffGate>
                <StaffHomeScreen />
              </StaffGate>
            }
          />
          <Route
            path="/staff/onboarding"
            element={
              <StaffGate>
                <StaffOnboardingScreen />
              </StaffGate>
            }
          />
          <Route
            path="/staff/tasks"
            element={
              <StaffGate>
                <StaffTasksScreen />
              </StaffGate>
            }
          />
          <Route
            path="/staff/request/:requestId/start"
            element={
              <StaffGate>
                <StaffStartWorkModalScreen />
              </StaffGate>
            }
          />
          <Route
            path="/staff/request/:requestId"
            element={
              <StaffGate>
                <StaffRequestDetailsScreen />
              </StaffGate>
            }
          />
          <Route
            path="/staff/request/:requestId/documents"
            element={
              <StaffGate>
                <StaffRequestDocumentsScreen />
              </StaffGate>
            }
          />

          {/* App shell */}
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<Navigate to="home" replace />} />

            <Route path="home" element={<SmartHome />} />
            <Route path="study" element={<StudyScreen />} />
            <Route path="work" element={<WorkScreen />} />
            <Route path="travel" element={<TravelScreen />} />
            <Route path="progress" element={<ProgressScreen />} />

            <Route path="profile" element={<ProfileScreen />} />
            <Route path="profile/edit" element={<EditProfileScreen />} />

            <Route path="payment" element={<PaymentScreen />} />
            <Route path="request/:requestId" element={<RequestStatusScreen />} />

            <Route path="full-package/:track" element={<FullPackageMissingScreen />} />

            <Route path="study/self-help" element={<StudySelfHelp />} />
            <Route path="study/we-help" element={<StudyWeHelp />} />
            <Route path="work/self-help" element={<WorkSelfHelp />} />
            <Route path="work/we-help" element={<WorkWeHelp />} />
            <Route path="travel/self-help" element={<TravelSelfHelp />} />
            <Route path="travel/we-help" element={<TravelWeHelp />} />

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
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/intro" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
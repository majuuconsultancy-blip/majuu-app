// ✅ App.jsx (FULL COPY-PASTE)
// Fixes:
// - ✅ Staff routes correctly added (no invalid JSX comments)
// - ✅ Keeps AdminGate routes as-is

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import IntroScreen from "./screens/IntroScreen";
import LoginScreen from "./screens/LoginScreen";
import SignupScreen from "./screens/SignupScreen";
import VerifyEmailScreen from "./screens/VerifyEmailScreen";
import PaymentScreen from "./screens/PaymentScreen";
import TrackSelectScreen from "./screens/TrackSelectScreen";

import AppLayout from "./components/AppLayout";
import SmartHome from "./screens/SmartHome";
import StudyScreen from "./screens/StudyScreen";
import WorkScreen from "./screens/WorkScreen";
import TravelScreen from "./screens/TravelScreen";
import ProgressScreen from "./screens/ProgressScreen";
import ProfileScreen from "./screens/ProfileScreen";

import StudySelfHelp from "./screens/StudySelfHelp";
import StudyWeHelp from "./screens/StudyWeHelp";
import WorkSelfHelp from "./screens/WorkSelfHelp";
import WorkWeHelp from "./screens/WorkWeHelp";
import TravelSelfHelp from "./screens/TravelSelfHelp";
import TravelWeHelp from "./screens/TravelWeHelp";

import FullPackageMissingScreen from "./screens/FullPackageMissingScreen";

import AdminRequestsScreen from "./screens/AdminRequestsScreen";
import RequestStatusScreen from "./screens/RequestStatusScreen";
import AdminGate from "./components/AdminGate";
import AdminRequestDetailsScreen from "./screens/AdminRequestDetailsScreen";
import AdminRequestDocumentsScreen from "./screens/AdminRequestDocumentsScreen";
import SettingsScreen from "./screens/SettingsScreen";

import GAPageView from "./components/GAPageView";
import NotificationsScreen from "./screens/NotificationsScreen";

// ✅ Staff
import StaffGate from "./components/StaffGate";
import StaffHomeScreen from "./screens/StaffHomeScreen";
import StaffOnboardingScreen from "./screens/StaffOnboardingScreen";
import StaffTasksScreen from "./screens/StaffTasksScreen";
import StaffRequestDetailsScreen from "./screens/StaffRequestDetailsScreen";

export default function App() {
  return (
    <BrowserRouter>
      <GAPageView />

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
          path="/staff/request/:requestId"
          element={
            <StaffGate>
              <StaffRequestDetailsScreen />
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
    </BrowserRouter>
  );
}
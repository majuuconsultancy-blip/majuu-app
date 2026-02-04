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

import AdminRequestsScreen from "./screens/AdminRequestsScreen";
import RequestStatusScreen from "./screens/RequestStatusScreen";
import AdminGate from "./components/AdminGate";
import AdminRequestDetailsScreen from "./screens/AdminRequestDetailsScreen";

import FullPackageMissingScreen from "./screens/FullPackageMissingScreen";
import AdminRequestDocumentsScreen from "./screens/AdminRequestDocumentsScreen";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/signup" element={<SignupScreen />} />
        <Route path="/verify-email" element={<VerifyEmailScreen />} />

        {/* Track selection hub */}
        <Route path="/dashboard" element={<TrackSelectScreen />} />

        {/* Protected */}
        <Route path="/app" element={<AppLayout />}>
          {/* Optional: default /app -> /app/home */}
          <Route index element={<Navigate to="home" replace />} />

          <Route path="home" element={<SmartHome />} />
          <Route path="study" element={<StudyScreen />} />
          <Route path="work" element={<WorkScreen />} />
          <Route path="travel" element={<TravelScreen />} />
          <Route path="progress" element={<ProgressScreen />} />
          <Route path="profile" element={<ProfileScreen />} />
          <Route path="/app/payment" element={<PaymentScreen />} />
          <Route path="request/:requestId" element={<RequestStatusScreen />} />

          {/* Full package missing screen */}
          <Route path="full-package/:track" element={<FullPackageMissingScreen />} />

          {/* Self-help / We-help */}
          <Route path="study/self-help" element={<StudySelfHelp />} />
          <Route path="study/we-help" element={<StudyWeHelp />} />

          <Route path="work/self-help" element={<WorkSelfHelp />} />
          <Route path="work/we-help" element={<WorkWeHelp />} />

          <Route path="travel/self-help" element={<TravelSelfHelp />} />
          <Route path="travel/we-help" element={<TravelWeHelp />} />

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
           
        {/* Default */}
        <Route path="/intro" element={<IntroScreen />} />
        <Route path="/" element={<Navigate to="/intro" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
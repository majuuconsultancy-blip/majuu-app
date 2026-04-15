import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuthSession } from "../auth/AuthSessionContext";
import { isBiometricPromptPending } from "../services/biometricLockService";
import {
  BIOMETRIC_SETUP_PATH,
  shouldBypassBiometricPromptEnforcement,
} from "../utils/postAuthLanding";

function toRouteSignature(location) {
  const key = String(location?.key || "").trim();
  const pathname = String(location?.pathname || "").trim();
  const search = String(location?.search || "").trim();
  const hash = String(location?.hash || "").trim();
  return `${key}|${pathname}${search}${hash}`;
}

function toRoutePath(location) {
  const pathname = String(location?.pathname || "").trim();
  const search = String(location?.search || "").trim();
  const hash = String(location?.hash || "").trim();
  return `${pathname}${search}${hash}`;
}

export default function BiometricSetupGate() {
  const location = useLocation();
  const { user, isAuthenticated, authInitializing } = useAuthSession();

  const [checkState, setCheckState] = useState({
    uid: "",
    route: "",
    checked: false,
    pending: false,
  });

  const routeSignature = toRouteSignature(location);
  const routePath = toRoutePath(location);
  const pathname = String(location.pathname || "").trim();
  const safeUid = String(user?.uid || "").trim();

  useEffect(() => {
    if (authInitializing || !isAuthenticated || !safeUid) return undefined;
    if (shouldBypassBiometricPromptEnforcement(pathname)) return undefined;

    let cancelled = false;

    void (async () => {
      let pending = false;
      try {
        pending = await isBiometricPromptPending(safeUid);
      } catch (error) {
        void error;
      }

      if (cancelled) return;
      setCheckState({
        uid: safeUid,
        route: routeSignature,
        checked: true,
        pending: Boolean(pending),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [authInitializing, isAuthenticated, pathname, routeSignature, safeUid]);

  if (authInitializing || !isAuthenticated || !safeUid) return null;
  if (shouldBypassBiometricPromptEnforcement(pathname)) return null;

  const checkMatches =
    checkState.checked && checkState.uid === safeUid && checkState.route === routeSignature;
  if (!checkMatches || !checkState.pending) return null;

  return (
    <Navigate
      to={BIOMETRIC_SETUP_PATH}
      replace
      state={{ from: routePath }}
    />
  );
}

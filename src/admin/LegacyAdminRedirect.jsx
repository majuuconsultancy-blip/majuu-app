import { Navigate, useLocation } from "react-router-dom";

import { mapLegacyAdminPath } from "./adminPathing";

export default function LegacyAdminRedirect() {
  const location = useLocation();
  const target = mapLegacyAdminPath({
    pathname: location.pathname,
    search: location.search,
  });

  return <Navigate to={target} replace />;
}

import { useEffect, useMemo, useState } from "react";

import { normalizeTrackType } from "../constants/migrationOptions";
import { subscribeDiscoveryPublicationsByTrack } from "../services/discoveryPublicationService";
import { toCountryLookupKey } from "../services/discoveryService";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function toCountryKey(value) {
  const safe = safeString(value, 120).toLowerCase();
  if (!safe) return "";
  return safe
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function useDiscoveryPublications({
  trackType = "",
  includeUnpublished = false,
} = {}) {
  const safeTrackType = normalizeTrackType(trackType || "study");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeDiscoveryPublicationsByTrack({
      trackType: safeTrackType,
      includeUnpublished,
      onData: (nextRows) => {
        setRows(Array.isArray(nextRows) ? nextRows : []);
        setLoading(false);
      },
      onError: (nextError) => {
        console.error("discovery publications load failed:", nextError);
        setRows([]);
        setError(nextError?.message || "Failed to load discovery publications.");
        setLoading(false);
      },
    });
  }, [includeUnpublished, safeTrackType]);

  const byCountryKey = useMemo(() => {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const countryKey = safeString(row?.countryKey, 80) || toCountryKey(row?.country);
      const countryLookupKey = toCountryLookupKey(row?.country);
      if (countryKey && !map.has(countryKey)) map.set(countryKey, row);
      if (countryLookupKey && !map.has(countryLookupKey)) map.set(countryLookupKey, row);
    });
    return map;
  }, [rows]);

  return useMemo(
    () => ({
      rows,
      byCountryKey,
      loading,
      error,
      trackType: safeTrackType,
    }),
    [rows, byCountryKey, loading, error, safeTrackType]
  );
}

import { useEffect, useMemo, useState } from "react";

import {
  APP_DESTINATION_COUNTRIES,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import { countrySupportsTrack, subscribeAllCountries } from "../services/countryService";

function safeString(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function uniqueInOrder(items = []) {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const key = safeString(item, 80);
    if (!key) return;
    const lowerKey = key.toLowerCase();
    if (seen.has(lowerKey)) return;
    seen.add(lowerKey);
    out.push(key);
  });
  return out;
}

function orderByLegacyFallback(values, fallback) {
  const list = uniqueInOrder(values);
  const fallbackList = Array.isArray(fallback) ? fallback : [];
  if (!fallbackList.length) return list;

  const remaining = new Set(list.map((item) => item.toLowerCase()));
  const ordered = fallbackList
    .map((item) => safeString(item, 120))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (!remaining.has(key)) return false;
      remaining.delete(key);
      return true;
    });

  const extras = list.filter((item) => remaining.has(item.toLowerCase())).sort((a, b) =>
    a.localeCompare(b)
  );
  return [...ordered, ...extras];
}

function toLegacyDestinationCountryOption(country) {
  const normalized = normalizeDestinationCountry(country?.name);
  return normalized || "";
}

export function useManagedDestinationCountries({
  trackType = "",
  fallbackCountries = APP_DESTINATION_COUNTRIES,
} = {}) {
  const safeTrack = trackType ? normalizeTrackType(trackType) : "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allCountries, setAllCountries] = useState([]);
  const hasManagedDocs = allCountries.length > 0;

  useEffect(() => {
    return subscribeAllCountries({
      onData: (rows) => {
        setAllCountries(Array.isArray(rows) ? rows : []);
        setLoading(false);
      },
      onError: (err) => {
        console.error(err);
        setAllCountries([]);
        setError(err?.message || "Failed to load countries.");
        setLoading(false);
      },
    });
  }, []);

  const managedActiveForTrack = useMemo(() => {
    const options = (Array.isArray(allCountries) ? allCountries : [])
      .filter((country) => country?.isActive)
      .filter((country) => (safeTrack ? countrySupportsTrack(country, safeTrack) : true))
      .map((country) => toLegacyDestinationCountryOption(country))
      .filter(Boolean);

    return orderByLegacyFallback(options, fallbackCountries);
  }, [allCountries, fallbackCountries, safeTrack]);

  const countries = hasManagedDocs ? managedActiveForTrack : fallbackCountries;

  return {
    countries: Array.isArray(countries) ? countries : [],
    managedCountries: managedActiveForTrack,
    hasManagedDocs,
    loading,
    error,
  };
}

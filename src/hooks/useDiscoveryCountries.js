import { useMemo } from "react";

import {
  APP_DESTINATION_COUNTRIES,
  normalizeDestinationCountry,
  normalizeTrackType,
} from "../constants/migrationOptions";
import { useCountryDirectory } from "./useCountryDirectory";
import { useDiscoveryPublications } from "./useDiscoveryPublications";
import { useHomeDesignModule } from "./useHomeDesignModule";
import {
  buildDiscoveryCountryView,
  resolveCountryRowFromMap,
  toCountryLookupKey,
} from "../services/discoveryService";
import { countrySupportsTrack } from "../services/countryService";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export function useDiscoveryCountries({ trackType = "study" } = {}) {
  const safeTrackType = normalizeTrackType(trackType || "study");

  const {
    countries: allCountries,
    countryMap,
    loading: countryDirectoryLoading,
    error: countryDirectoryError,
  } = useCountryDirectory();
  const {
    module: homeDesignModule,
    loading: homeDesignLoading,
    error: homeDesignError,
  } = useHomeDesignModule({
    trackType: safeTrackType,
    contextKey: "default",
  });
  const {
    byCountryKey: publicationMap,
    loading: publicationsLoading,
    error: publicationsError,
  } = useDiscoveryPublications({
    trackType: safeTrackType,
    includeUnpublished: false,
  });

  const featuredMap = useMemo(() => {
    const map = new Map();
    const rows = Array.isArray(homeDesignModule?.featuredCountries)
      ? homeDesignModule.featuredCountries
      : [];
    rows.forEach((row) => {
      const country = safeString(row?.country, 120);
      const key = toCountryLookupKey(country);
      if (!key || map.has(key)) return;
      map.set(key, row);
    });
    return map;
  }, [homeDesignModule]);

  const hasManagedDocs = useMemo(
    () => (Array.isArray(allCountries) ? allCountries.length > 0 : false),
    [allCountries]
  );

  const visibleCountries = useMemo(() => {
    if (!hasManagedDocs) return APP_DESTINATION_COUNTRIES;

    const rows = (Array.isArray(allCountries) ? allCountries : [])
      .filter((country) => country?.isActive)
      .filter((country) => countrySupportsTrack(country, safeTrackType))
      .map((country) => normalizeDestinationCountry(country?.name) || safeString(country?.name, 120))
      .filter(Boolean);

    const seen = new Set();
    const uniqueRows = [];
    rows.forEach((country) => {
      const key = toCountryLookupKey(country);
      if (!key || seen.has(key)) return;
      seen.add(key);
      uniqueRows.push(country);
    });

    const fallbackOrder = APP_DESTINATION_COUNTRIES.map((country) => toCountryLookupKey(country));
    uniqueRows.sort((left, right) => {
      const leftIndex = fallbackOrder.indexOf(toCountryLookupKey(left));
      const rightIndex = fallbackOrder.indexOf(toCountryLookupKey(right));
      const leftScore = leftIndex === -1 ? 999 : leftIndex;
      const rightScore = rightIndex === -1 ? 999 : rightIndex;
      if (leftScore !== rightScore) return leftScore - rightScore;
      return safeString(left, 120).localeCompare(safeString(right, 120));
    });

    return uniqueRows;
  }, [allCountries, hasManagedDocs, safeTrackType]);

  const countries = useMemo(() => {
    const rows = (Array.isArray(visibleCountries) ? visibleCountries : [])
      .map((countryName, index) => {
        const key = toCountryLookupKey(countryName);
        const countryRow = resolveCountryRowFromMap(countryMap, countryName);
        const featuredEntry = featuredMap.get(key) || null;
        const publication = publicationMap.get(key) || null;
        const normalized = buildDiscoveryCountryView({
          countryName,
          countryRow,
          trackType: safeTrackType,
          featuredEntry,
          publication,
        });
        if (!normalized) return null;
        return {
          ...normalized,
          listOrder: index + 1,
        };
      })
      .filter(Boolean);

    return rows.sort((left, right) => {
      const leftFeatured = Number(left?.featuredOrder || 0);
      const rightFeatured = Number(right?.featuredOrder || 0);
      if (leftFeatured > 0 && rightFeatured > 0 && leftFeatured !== rightFeatured) {
        return leftFeatured - rightFeatured;
      }
      if (leftFeatured > 0 && rightFeatured <= 0) return -1;
      if (rightFeatured > 0 && leftFeatured <= 0) return 1;
      return safeString(left?.name, 120).localeCompare(safeString(right?.name, 120));
    });
  }, [countryMap, featuredMap, publicationMap, safeTrackType, visibleCountries]);

  const loading = countryDirectoryLoading || homeDesignLoading || publicationsLoading;
  const error = countryDirectoryError || homeDesignError || publicationsError || "";

  return useMemo(
    () => ({
      countries,
      loading,
      hasManagedDocs,
      error,
      trackType: safeTrackType,
      homeDesignModule,
    }),
    [countries, error, hasManagedDocs, homeDesignModule, loading, safeTrackType]
  );
}

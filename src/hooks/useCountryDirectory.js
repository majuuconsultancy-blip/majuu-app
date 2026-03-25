import { useEffect, useMemo, useState } from "react";

import { subscribeAllCountries } from "../services/countryService";
import { buildCountryLookupMap } from "../utils/countryAccent";

export function useCountryDirectory({ activeOnly = false } = {}) {
  const [countries, setCountries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    return subscribeAllCountries({
      onData: (rows) => {
        setCountries(Array.isArray(rows) ? rows : []);
        setLoading(false);
      },
      onError: (nextError) => {
        console.error("country directory subscription failed:", nextError);
        setCountries([]);
        setError(nextError?.message || "Failed to load countries.");
        setLoading(false);
      },
    });
  }, []);

  const visibleCountries = useMemo(() => {
    const rows = Array.isArray(countries) ? countries : [];
    return activeOnly ? rows.filter((country) => country?.isActive) : rows;
  }, [activeOnly, countries]);

  const countryMap = useMemo(() => buildCountryLookupMap(visibleCountries), [visibleCountries]);

  return useMemo(
    () => ({
      countries: visibleCountries,
      countryMap,
      loading,
      error,
    }),
    [visibleCountries, countryMap, loading, error]
  );
}

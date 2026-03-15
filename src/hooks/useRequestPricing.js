import { useEffect, useMemo, useState } from "react";

import {
  findPricingRow,
  formatPricingMoney,
  listPricingCatalog,
  PRICING_SCOPE_FULL_PACKAGE_ITEM,
  PRICING_SCOPE_SINGLE_REQUEST,
  subscribePricingRows,
} from "../services/pricingservice";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export function usePricingList({
  scope = "",
  track = "",
  country = "",
  requestType = "",
} = {}) {
  const safeScope = safeString(scope, 80).toLowerCase();
  const safeTrack = safeString(track, 20).toLowerCase();
  const safeCountry = safeString(country, 120);
  const safeRequestType = safeString(requestType, 20).toLowerCase();

  const [rows, setRows] = useState(() =>
    listPricingCatalog({
      scope: safeScope,
      track: safeTrack,
      country: safeCountry,
      requestType: safeRequestType,
    })
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(
      listPricingCatalog({
        scope: safeScope,
        track: safeTrack,
        country: safeCountry,
        requestType: safeRequestType,
      })
    );
    setLoading(true);
    setError("");

    return subscribePricingRows({
      scope: safeScope,
      track: safeTrack,
      country: safeCountry,
      requestType: safeRequestType,
      onData: (nextRows) => {
        setRows(nextRows);
        setLoading(false);
      },
      onError: (nextError) => {
        setRows(
          listPricingCatalog({
            scope: safeScope,
            track: safeTrack,
            country: safeCountry,
            requestType: safeRequestType,
          })
        );
        setError(nextError?.message || "Failed to load pricing.");
        setLoading(false);
      },
    });
  }, [safeCountry, safeRequestType, safeScope, safeTrack]);

  return { rows, loading, error };
}

export function usePricingEntry({
  scope = "",
  pricingKey = "",
  track = "",
  country = "",
  serviceName = "",
  requestType = "",
} = {}) {
  const safeScope = safeString(scope, 80).toLowerCase();
  const safeTrack = safeString(track, 20);
  const safeCountry = safeString(country, 120);
  const safeRequestType = safeString(requestType, 20).toLowerCase();
  const safePricingKey = safeString(pricingKey, 180);
  const safeServiceName = safeString(serviceName, 140);

  const { rows, loading, error } = usePricingList({
    scope: safeScope,
    track: safeTrack,
    country: safeCountry,
    requestType: safeRequestType,
  });

  const row = useMemo(
    () =>
      findPricingRow(rows, {
        scope: safeScope,
        pricingKey: safePricingKey,
        track: safeTrack,
        country: safeCountry,
        serviceName: safeServiceName,
        requestType: safeRequestType,
      }),
    [
      rows,
      safeCountry,
      safePricingKey,
      safeRequestType,
      safeScope,
      safeServiceName,
      safeTrack,
    ]
  );

  const amountText = useMemo(
    () => (row ? formatPricingMoney(row.amount, row.currency) : ""),
    [row]
  );

  return { row, amountText, loading, error };
}

export function useRequestPricingList({ track = "", country = "", requestType = "single" } = {}) {
  return usePricingList({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    track,
    country,
    requestType,
  });
}

export function useRequestPricingEntry({
  pricingKey = "",
  track = "",
  country = "",
  serviceName = "",
  requestType = "single",
} = {}) {
  return usePricingEntry({
    scope: PRICING_SCOPE_SINGLE_REQUEST,
    pricingKey,
    track,
    country,
    serviceName,
    requestType,
  });
}

export function useFullPackagePricingList({ track = "", country = "" } = {}) {
  return usePricingList({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    track,
    country,
    requestType: "full",
  });
}

export function useFullPackagePricingEntry({
  pricingKey = "",
  track = "",
  country = "",
  serviceName = "",
} = {}) {
  return usePricingEntry({
    scope: PRICING_SCOPE_FULL_PACKAGE_ITEM,
    pricingKey,
    track,
    country,
    serviceName,
    requestType: "full",
  });
}

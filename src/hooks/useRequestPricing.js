import { useEffect, useMemo, useState } from "react";

import {
  findRequestPricingRow,
  formatPricingMoney,
  listRequestPricingCatalog,
  subscribeRequestPricingRows,
} from "../services/pricingservice";

function safeString(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export function useRequestPricingList({ track = "", requestType = "" } = {}) {
  const safeTrack = safeString(track, 20);
  const safeRequestType = safeString(requestType, 20);

  const [rows, setRows] = useState(() =>
    listRequestPricingCatalog({
      track: safeTrack,
      requestType: safeRequestType,
    })
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(
      listRequestPricingCatalog({
        track: safeTrack,
        requestType: safeRequestType,
      })
    );
    setLoading(true);
    setError("");

    return subscribeRequestPricingRows({
      track: safeTrack,
      requestType: safeRequestType,
      onData: (nextRows) => {
        setRows(nextRows);
        setLoading(false);
      },
      onError: (nextError) => {
        setRows(
          listRequestPricingCatalog({
            track: safeTrack,
            requestType: safeRequestType,
          })
        );
        setError(nextError?.message || "Failed to load pricing.");
        setLoading(false);
      },
    });
  }, [safeTrack, safeRequestType]);

  return { rows, loading, error };
}

export function useRequestPricingEntry({
  pricingKey = "",
  track = "",
  serviceName = "",
  requestType = "single",
} = {}) {
  const safeTrack = safeString(track, 20);
  const safeRequestType = safeString(requestType, 20) || "single";
  const safePricingKey = safeString(pricingKey, 180);
  const safeServiceName = safeString(serviceName, 140);

  const { rows, loading, error } = useRequestPricingList({
    track: safeTrack,
    requestType: safeRequestType,
  });

  const row = useMemo(
    () =>
      findRequestPricingRow(rows, {
        pricingKey: safePricingKey,
        track: safeTrack,
        serviceName: safeServiceName,
        requestType: safeRequestType,
      }),
    [rows, safePricingKey, safeTrack, safeServiceName, safeRequestType]
  );

  const amountText = useMemo(
    () => (row ? formatPricingMoney(row.amount, row.currency) : ""),
    [row]
  );

  return { row, amountText, loading, error };
}

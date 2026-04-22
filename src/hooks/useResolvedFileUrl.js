import { useEffect, useRef, useState } from "react";
import {
  buildFileAccessSignature,
  canResolveFileAccess,
  resolveExternalFileUrl,
  resolveFileAccessUrl,
} from "../services/fileAccessService";

function safeStr(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

export default function useResolvedFileUrl(fileRef, { enabled = true, ttlSeconds = 3600 } = {}) {
  const signature = buildFileAccessSignature(fileRef);
  const immediateUrl = resolveExternalFileUrl(fileRef);
  const shouldResolve = enabled && canResolveFileAccess(fileRef);
  const latestFileRef = useRef(fileRef);
  const [state, setState] = useState(() => ({
    signature,
    url: immediateUrl,
    loading: shouldResolve,
    error: "",
  }));

  useEffect(() => {
    latestFileRef.current = fileRef;
  }, [fileRef, signature]);

  useEffect(() => {
    if (!shouldResolve) return undefined;

    let cancelled = false;
    resolveFileAccessUrl(latestFileRef.current, { ttlSeconds })
      .then((url) => {
        if (cancelled) return;
        setState({
          signature,
          url: safeStr(url, 1200),
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          signature,
          url: immediateUrl,
          loading: false,
          error: safeStr(error?.message || "Failed to resolve file URL.", 240),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [shouldResolve, signature, immediateUrl, ttlSeconds]);

  const effectiveState = !shouldResolve
    ? {
        url: immediateUrl,
        loading: false,
        error: "",
      }
    : state.signature === signature
    ? state
    : {
        url: immediateUrl,
        loading: true,
        error: "",
      };

  return {
    url: safeStr(effectiveState.url, 1200),
    loading: Boolean(effectiveState.loading),
    error: safeStr(effectiveState.error, 240),
    openable: Boolean(safeStr(effectiveState.url, 1200)),
  };
}

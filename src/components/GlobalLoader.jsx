import { useMemo } from "react";
import "./globalLoader.css";

function normalizeText(value, fallback = "Loading...") {
  const text = String(value || "").trim();
  return text || fallback;
}

export default function GlobalLoader({
  isLoading = true,
  visible,
  overlay = true,
  loadingText = "",
  label = "",
  caption = "",
  appName = "MAJUU",
  showAppName = false,
  phase = "active",
} = {}) {
  const active = typeof visible === "boolean" ? visible : Boolean(isLoading);
  const resolvedText = useMemo(
    () => normalizeText(loadingText || label, "Loading..."),
    [label, loadingText]
  );
  const resolvedCaption = useMemo(() => String(caption || "").trim(), [caption]);
  const staticMark = !active || phase === "settle" || phase === "exit";

  return (
    <div
      className={[
        "global-loader-root",
        overlay ? "global-loader-root--overlay" : "global-loader-root--screen",
        active ? "" : "global-loader-root--inactive",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={!active}
    >
      <div className="global-loader-panel" role="status" aria-live="polite" aria-label={resolvedText}>
        <div className={`global-loader-mark ${staticMark ? "global-loader-mark--static" : ""}`}>
          M
        </div>
        {showAppName ? <div className="global-loader-brand">{normalizeText(appName, "MAJUU")}</div> : null}
        <div className="global-loader-text-wrap">
          <span key={resolvedText} className="global-loader-text">
            {resolvedText}
          </span>
        </div>
        {resolvedCaption ? <div className="global-loader-caption">{resolvedCaption}</div> : null}
      </div>
    </div>
  );
}

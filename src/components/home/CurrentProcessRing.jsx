import { useId } from "react";
import { motion as Motion } from "../../utils/motionProxy";

function clampPercent(value) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.min(100, next));
}

export default function CurrentProcessRing({
  percent = 0,
  size = 108,
  stroke = 10,
  label = "Progress",
  textClassName = "",
  textStyle = undefined,
}) {
  const safePercent = clampPercent(percent);
  const safeSize = Math.max(72, Math.round(Number(size) || 108));
  const safeStroke = Math.max(6, Math.min(16, Math.round(Number(stroke) || 10)));
  const radius = (safeSize - safeStroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safePercent / 100) * circumference;
  const gradientId = `journey-ring-${useId().replace(/[:]/g, "")}`;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      role="img"
      aria-label={label}
      style={{ width: safeSize, height: safeSize }}
    >
      <svg width={safeSize} height={safeSize} viewBox={`0 0 ${safeSize} ${safeSize}`}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="52%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>

        <circle
          cx={safeSize / 2}
          cy={safeSize / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={safeStroke}
          className="text-zinc-200/90 dark:text-zinc-700"
        />

        <Motion.circle
          cx={safeSize / 2}
          cy={safeSize / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={safeStroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={
            safePercent > 0
              ? {
                  strokeDashoffset: offset,
                  opacity: [0.9, 1, 0.9],
                }
              : {
                  strokeDashoffset: offset,
                  opacity: 0.86,
                }
          }
          transition={{
            strokeDashoffset: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] },
            opacity:
              safePercent > 0
                ? { duration: 3.2, repeat: 4, repeatType: "mirror", ease: "easeInOut" }
                : { duration: 0.2, ease: "linear" },
          }}
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "50% 50%",
            filter: "drop-shadow(0 0 4px rgba(16, 185, 129, 0.2))",
          }}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div
          className={`text-xl font-semibold leading-none text-zinc-900 dark:text-zinc-100 ${textClassName}`.trim()}
          style={textStyle}
        >
          {safePercent}%
        </div>
      </div>
    </div>
  );
}

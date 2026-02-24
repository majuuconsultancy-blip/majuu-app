import { ICON_LG, ICON_MD, ICON_SM } from "../constants/iconSizes";

const VARIANT_CLASSES = {
  muted: "text-zinc-500 dark:text-zinc-400 opacity-75",
  default: "text-current opacity-90",
  active: "text-emerald-600 dark:text-emerald-400 opacity-100",
  danger: "text-rose-600 dark:text-rose-400 opacity-100",
};

function cx(...parts) {
  return parts.filter(Boolean).join(" ").trim();
}

function sanitizeIconClassName(className) {
  if (typeof className !== "string") return className;
  return className
    .replace(/\b(?:h|w|size)-\[[^\]]+\]\b/g, " ")
    .replace(/\b(?:h|w|size)-(?:\d+(?:\.\d+)?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferSizeFromClassName(className) {
  if (typeof className !== "string") return null;

  const has = (token) => new RegExp(`\\b${token.replace(".", "\\.")}\\b`).test(className);

  if (has("h-6") || has("w-6")) return ICON_LG;
  if (has("h-5") || has("w-5")) return ICON_MD;
  if (has("h-4") || has("w-4")) return ICON_SM;

  // Small inline icons are often h-3.5/w-3.5 or h-3/w-3 in badges/text rows.
  if (has("h-3.5") || has("w-3.5") || has("h-3") || has("w-3")) return ICON_SM;

  return null;
}

export default function AppIcon({
  icon,
  Icon,
  size,
  strokeWidth = 1.6,
  className = "",
  variant = "default",
  ...rest
}) {
  const LucideIcon = Icon || icon;
  if (!LucideIcon) return null;

  const resolvedSize = Number(size) || inferSizeFromClassName(className) || ICON_MD;
  const cleanClassName = sanitizeIconClassName(className);
  const variantClass = VARIANT_CLASSES[variant] || VARIANT_CLASSES.default;

  return (
    <LucideIcon
      size={resolvedSize}
      strokeWidth={strokeWidth}
      className={cx("shrink-0", variantClass, cleanClassName)}
      {...rest}
    />
  );
}

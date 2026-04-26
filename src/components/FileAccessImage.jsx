import useResolvedFileUrl from "../hooks/useResolvedFileUrl";
import { openResolvedFileUrl } from "../services/fileOpenService";

export default function FileAccessImage({
  file,
  alt = "attachment",
  className = "",
  ttlSeconds = 3600,
  loading = "lazy",
  fallback = null,
  openOnClick = false,
  openTitle = "Open attachment",
  ...rest
} = {}) {
  const { url, openable } = useResolvedFileUrl(file, { ttlSeconds });

  if (!openable) return fallback;

  const interactiveProps = openOnClick
    ? {
        role: "button",
        tabIndex: 0,
        title: openTitle,
        onClick: () =>
          void openResolvedFileUrl({
            url,
            mimeType: file?.mime || file?.contentType || file?.type || "",
            title: file?.name || file?.fileName || openTitle || "Open with",
          }),
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void openResolvedFileUrl({
            url,
            mimeType: file?.mime || file?.contentType || file?.type || "",
            title: file?.name || file?.fileName || openTitle || "Open with",
          });
        },
      }
    : {};

  return (
    <img
      src={url}
      alt={alt}
      className={`${className}${openOnClick ? " cursor-pointer" : ""}`}
      loading={loading}
      {...interactiveProps}
      {...rest}
    />
  );
}

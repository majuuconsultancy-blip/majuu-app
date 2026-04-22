import useResolvedFileUrl from "../hooks/useResolvedFileUrl";

export default function FileAccessLink({
  file,
  className = "",
  children = "Open",
  fallback = null,
  ttlSeconds = 3600,
  target = "_blank",
  rel = "noreferrer",
  title = "",
} = {}) {
  const { url, openable, loading } = useResolvedFileUrl(file, { ttlSeconds });

  if (!openable) {
    if (loading) {
      return (
        <span className={className} aria-disabled="true" title={title}>
          {children}
        </span>
      );
    }
    return fallback;
  }

  return (
    <a href={url} target={target} rel={rel} className={className} title={title}>
      {children}
    </a>
  );
}

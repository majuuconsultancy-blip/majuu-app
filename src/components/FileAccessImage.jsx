import useResolvedFileUrl from "../hooks/useResolvedFileUrl";

export default function FileAccessImage({
  file,
  alt = "attachment",
  className = "",
  ttlSeconds = 3600,
  loading = "lazy",
  fallback = null,
  ...rest
} = {}) {
  const { url, openable } = useResolvedFileUrl(file, { ttlSeconds });

  if (!openable) return fallback;

  return <img src={url} alt={alt} className={className} loading={loading} {...rest} />;
}

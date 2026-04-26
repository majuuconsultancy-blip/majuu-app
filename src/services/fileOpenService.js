import { Capacitor, registerPlugin } from "@capacitor/core";
import { resolveFileAccessUrl } from "./fileAccessService";

const ExternalFileOpener = registerPlugin("ExternalFileOpener");

function safeStr(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function inferMimeType(fileRef = {}) {
  return safeStr(fileRef?.mime || fileRef?.contentType || fileRef?.type, 120);
}

function inferTitle(fileRef = {}) {
  return safeStr(fileRef?.name || fileRef?.fileName || "Open with", 160) || "Open with";
}

export async function openResolvedFileUrl({
  url = "",
  mimeType = "",
  title = "",
} = {}) {
  const cleanUrl = safeStr(url, 1200);
  if (!cleanUrl) return false;

  if (Capacitor.isNativePlatform()) {
    try {
      await ExternalFileOpener.openUrl({
        url: cleanUrl,
        mimeType: safeStr(mimeType, 120),
        title: safeStr(title, 160) || "Open with",
      });
      return true;
    } catch (error) {
      console.warn("native file opener failed; falling back to browser open:", error?.message || error);
    }
  }

  const popup = window.open(cleanUrl, "_blank", "noopener,noreferrer");
  if (popup) return true;

  try {
    window.location.assign(cleanUrl);
    return true;
  } catch {
    return false;
  }
}

export async function openFileReference(fileRef = {}, { ttlSeconds = 3600 } = {}) {
  const url = await resolveFileAccessUrl(fileRef, { ttlSeconds });
  return openResolvedFileUrl({
    url,
    mimeType: inferMimeType(fileRef),
    title: inferTitle(fileRef),
  });
}

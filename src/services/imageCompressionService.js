function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function compressImageFile(
  file,
  { maxDimension = 1600, quality = 0.82, outputMime = "image/jpeg" } = {}
) {
  const sourceFile = file instanceof File ? file : null;
  if (!sourceFile || typeof window === "undefined") {
    return {
      mime: safeStr(file?.type, 120) || outputMime,
      optimizedBytes: safeNum(file?.size, 0),
      width: 0,
      height: 0,
      blob: sourceFile || null,
    };
  }

  const objectUrl = URL.createObjectURL(sourceFile);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to read image."));
      image.src = objectUrl;
    });

    const naturalWidth = Math.max(1, safeNum(img?.naturalWidth || img?.width, 1));
    const naturalHeight = Math.max(1, safeNum(img?.naturalHeight || img?.height, 1));
    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        mime: safeStr(file?.type, 120) || outputMime,
        optimizedBytes: safeNum(file?.size, 0),
        width: naturalWidth,
        height: naturalHeight,
        blob: sourceFile,
      };
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, quality));
    const optimizedBytes = safeNum(blob?.size, safeNum(file?.size, 0));
    return {
      mime: safeStr(outputMime, 120) || "image/jpeg",
      optimizedBytes,
      width: targetWidth,
      height: targetHeight,
      blob: blob || sourceFile,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

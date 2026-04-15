function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inferAttachmentKind({ file = null, mode = "" } = {}) {
  const explicitMode = safeStr(mode, 40).toLowerCase();
  if (explicitMode === "photo") return "photo";
  if (explicitMode === "image") return "image";
  if (explicitMode === "scan") return "document";

  const mime = safeStr(file?.type, 120).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  return "document";
}

function inferAttachmentSource(mode = "") {
  const explicitMode = safeStr(mode, 40).toLowerCase();
  if (explicitMode === "photo") return "camera_photo";
  if (explicitMode === "scan") return "camera_scan";
  if (explicitMode === "image") return "image_upload";
  return "document_upload";
}

async function compressImageFile(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  const sourceFile = file instanceof File ? file : null;
  if (!sourceFile || typeof window === "undefined") {
    return {
      mime: safeStr(file?.type, 120) || "image/jpeg",
      optimizedBytes: safeNum(file?.size, 0),
      width: 0,
      height: 0,
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
        mime: safeStr(file?.type, 120) || "image/jpeg",
        optimizedBytes: safeNum(file?.size, 0),
        width: naturalWidth,
        height: naturalHeight,
      };
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const outputMime = "image/jpeg";
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, quality));
    const optimizedBytes = safeNum(blob?.size, safeNum(file?.size, 0));
    return {
      mime: outputMime,
      optimizedBytes,
      width: targetWidth,
      height: targetHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareChatAttachmentFromFile({
  file = null,
  mode = "",
} = {}) {
  if (!(file instanceof File)) {
    throw new Error("Attachment file is required.");
  }

  const attachmentKind = inferAttachmentKind({ file, mode });
  const source = inferAttachmentSource(mode);
  const modeKey = safeStr(mode, 20).toLowerCase();
  const baseName = safeStr(file.name, 220) || (attachmentKind === "document" ? "document" : "image");
  const baseMeta = {
    name: baseName,
    mime: safeStr(file.type, 120) || "",
    size: safeNum(file.size, 0),
    note: "",
    attachmentKind,
    source,
    optimizedBytes: 0,
    originalBytes: safeNum(file.size, 0),
    width: 0,
    height: 0,
  };

  if (modeKey === "scan") {
    const compressed = await compressImageFile(file, { maxDimension: 2200, quality: 0.85 });
    const optimizedBytes = safeNum(compressed?.optimizedBytes, baseMeta.size);
    const scanBaseName = baseName.replace(/\.[a-z0-9]+$/i, "") || "scan_capture";
    return {
      ...baseMeta,
      name: `${scanBaseName}.pdf`,
      mime: "application/pdf",
      size: optimizedBytes,
      optimizedBytes,
      attachmentKind: "document",
      source: "camera_scan",
      width: safeNum(compressed?.width, 0),
      height: safeNum(compressed?.height, 0),
      note:
        safeNum(baseMeta.originalBytes, 0) > optimizedBytes
          ? "scan_capture_optimized"
          : "scan_capture",
    };
  }

  if (attachmentKind === "image" || attachmentKind === "photo") {
    const compressed = await compressImageFile(file);
    const optimizedName =
      attachmentKind === "photo"
        ? baseName.replace(/\.[a-z0-9]+$/i, "") || "camera_photo"
        : baseName;
    return {
      ...baseMeta,
      name:
        compressed?.mime === "image/jpeg" && !/\.(jpe?g)$/i.test(optimizedName)
          ? `${optimizedName}.jpg`
          : optimizedName,
      mime: safeStr(compressed?.mime, 120) || baseMeta.mime || "image/jpeg",
      optimizedBytes: safeNum(compressed?.optimizedBytes, baseMeta.size),
      size: safeNum(compressed?.optimizedBytes, baseMeta.size),
      width: safeNum(compressed?.width, 0),
      height: safeNum(compressed?.height, 0),
      note:
        safeNum(baseMeta.originalBytes, 0) > safeNum(compressed?.optimizedBytes, 0)
          ? "optimized_image"
          : "",
    };
  }

  return {
    ...baseMeta,
    mime: baseMeta.mime || "application/octet-stream",
  };
}

export const CHAT_ATTACHMENT_OPTIONS = Object.freeze({
  document: {
    key: "document",
    label: "Upload Document",
    accept:
      ".pdf,.doc,.docx,.txt,.rtf,.xls,.xlsx,.ppt,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain",
    capture: "",
  },
  image: {
    key: "image",
    label: "Upload Image",
    accept: "image/*",
    capture: "",
  },
  scan: {
    key: "scan",
    label: "Scan to PDF",
    accept: "image/*",
    capture: "environment",
  },
  photo: {
    key: "photo",
    label: "Capture Photo",
    accept: "image/*",
    capture: "environment",
  },
});

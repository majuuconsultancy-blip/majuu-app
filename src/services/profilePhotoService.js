import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { uploadBinaryFile } from "./fileUploadService";
import { compressImageFile } from "./imageCompressionService";
import { buildProfileImageStoragePath } from "./storageContract";

function safeStr(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isImageFile(file) {
  const type = safeStr(file?.type, 120).toLowerCase();
  return type.startsWith("image/");
}

export function normalizeProfilePhotoRecord(value = null) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) return null;

  const storageBucket = safeStr(source?.storageBucket || source?.bucket, 160);
  const storagePath = safeStr(source?.storagePath || source?.path, 400);
  if (!storagePath) return null;

  return {
    storageKind: "bucket",
    storageBucket,
    storagePath,
    storageGeneration: safeStr(source?.storageGeneration || source?.generation, 80),
    storageChecksum: safeStr(source?.storageChecksum || source?.checksum, 120),
    storageProvider: safeStr(source?.storageProvider || source?.provider, 40).toLowerCase(),
    fileName: safeStr(source?.fileName, 180),
    contentType: safeStr(source?.contentType, 80),
    sizeBytes: safeNum(source?.sizeBytes, 0),
    updatedAtMs: safeNum(source?.updatedAtMs, 0),
  };
}

export async function uploadUserProfilePhoto(uid, file) {
  const safeUid = safeStr(uid, 120);
  if (!safeUid) throw new Error("Missing uid for profile photo upload.");
  if (!(file instanceof File)) throw new Error("Choose an image before saving.");
  if (!isImageFile(file)) throw new Error("Profile photo must be an image file.");

  const userRef = doc(db, "users", safeUid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    throw new Error("User profile is missing. Please refresh and try again.");
  }

  const compressed = await compressImageFile(file, {
    maxDimension: 1200,
    quality: 0.82,
    outputMime: "image/jpeg",
  });
  const uploadBlob = compressed?.blob || file;
  const uploadResult = await uploadBinaryFile({
    file: uploadBlob,
    storagePath: buildProfileImageStoragePath({
      uid: safeUid,
      fileName: file.name || "avatar.jpg",
      contentType: safeStr(compressed?.mime, 120) || file.type || "image/jpeg",
    }),
    contentType: safeStr(compressed?.mime, 120) || file.type || "image/jpeg",
    customMetadata: {
      ownerUid: safeUid,
      source: "profile_photo",
    },
  });

  const profilePhoto = {
    storageKind: "bucket",
    storageBucket: safeStr(uploadResult?.bucket, 160),
    storagePath: safeStr(uploadResult?.path, 400),
    storageGeneration: safeStr(uploadResult?.generation, 80),
    storageChecksum: safeStr(uploadResult?.checksum, 120),
    storageProvider: safeStr(uploadResult?.provider, 40).toLowerCase(),
    fileName: safeStr(file.name || "avatar.jpg", 180),
    contentType: safeStr(uploadResult?.contentType || compressed?.mime || file.type, 80),
    sizeBytes: safeNum(uploadResult?.sizeBytes, safeNum(file.size, 0)),
    updatedAtMs: Date.now(),
  };

  await updateDoc(userRef, {
    profilePhoto,
    updatedAt: serverTimestamp(),
  });

  return normalizeProfilePhotoRecord(profilePhoto);
}

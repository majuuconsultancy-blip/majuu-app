import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { normalizeSpecialities } from "../constants/staffSpecialities";
import { getCurrentUserRoleContext } from "./adminroleservice";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function setStaffAccessByEmail({
  email,
  action,
  maxActive = 2,
  specialities = [],
  tracks = [],
  ownerAdminUid = "",
  autoApproveChatMessages = null,
} = {}) {
  const actorUid = String(auth.currentUser?.uid || "").trim();
  if (!actorUid) throw new Error("You must be signed in.");

  const roleCtx = await getCurrentUserRoleContext(actorUid);
  if (!roleCtx?.isAdmin) {
    throw new Error("Only admins can manage staff.");
  }

  const safeEmail = normalizeEmail(email);
  if (!safeEmail || !safeEmail.includes("@")) throw new Error("Invalid email.");

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("email", "==", safeEmail), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("No user found with that email. They must sign up first.");

  const userDoc = snap.docs[0];
  const uid = userDoc.id;
  const staffRef = doc(db, "staff", uid);
  const requestedOwner = String(ownerAdminUid || "").trim();
  const effectiveOwnerUid =
    roleCtx?.isSuperAdmin && requestedOwner ? requestedOwner : roleCtx.uid;

  if (action === "grant") {
    const normalizedSpecs = normalizeSpecialities(specialities);
    if (!normalizedSpecs.length) {
      throw new Error("Select at least one speciality.");
    }
    const normalizedAutoApprove =
      typeof autoApproveChatMessages === "boolean" ? autoApproveChatMessages : null;

    const normalizedTracks = Array.isArray(tracks)
      ? tracks.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
      : [];

    const txResult = await runTransaction(db, async (transaction) => {
      const staffSnap = await transaction.get(staffRef);
      const existing = staffSnap.exists() ? staffSnap.data() || {} : {};
      const existingOwnerUid = String(existing?.ownerAdminUid || "").trim();

      if (roleCtx?.isAssignedAdmin && existingOwnerUid && existingOwnerUid !== roleCtx.uid) {
        throw new Error("This staff member belongs to another assigned admin.");
      }

      const existingAccess = existing?.access || {};
      const revokeCount = toNum(existingAccess?.revokeCount, 0);
      const rehireCount = toNum(existingAccess?.rehireCount, 0);

      const isRehire = revokeCount > rehireCount;
      const nextRehireCount = isRehire ? rehireCount + 1 : rehireCount;

      const payload = {
        uid,
        email: safeEmail,
        active: true,
        onboarded: false,
        ownerAdminUid: effectiveOwnerUid,
        ownerAdminRole: roleCtx.role,
        ownerAdminEmail: String(roleCtx.email || "").trim().toLowerCase(),
        maxActive: Math.max(1, toNum(maxActive, 2)),
        specialities: normalizedSpecs,
        tracks: normalizedTracks,
        autoApproveChatMessages:
          normalizedAutoApprove == null
            ? existing?.autoApproveChatMessages === true
            : normalizedAutoApprove,
        chatModeration: {
          ...(existing?.chatModeration || {}),
          autoApproveMessages:
            normalizedAutoApprove == null
              ? existing?.autoApproveChatMessages === true
              : normalizedAutoApprove,
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
        access: {
          revokeCount,
          rehireCount: nextRehireCount,
          lastAction: "grant",
          lastGrantedAt: serverTimestamp(),
        },
        performance: {
          ...(existing?.performance || {}),
          blocked: false,
          blockedAt: deleteField(),
          blockedReason: deleteField(),
        },
      };

      if (!staffSnap.exists()) {
        payload.createdAt = serverTimestamp();
      }

      let note = "";
      if (nextRehireCount === 2) {
        payload.stats = {
          ...(existing?.stats || {}),
          totalDone: 0,
          totalReviewed: 0,
          matchedDecisionCount: 0,
          unmatchedDecisionCount: 0,
          successCount: 0,
          failCount: 0,
          totalMinutes: 0,
          avgMinutes: null,
          successRate: 0,
          matchRate: 0,
          staffScore: 0,
          staffTier: "provisional",
          staffTierLabel: "Provisional",
          staffTierUpdatedAt: serverTimestamp(),
          lastUpdatedAt: serverTimestamp(),
        };
        payload.performance = {
          ...(existing?.performance || {}),
          blocked: false,
          blockedAt: deleteField(),
          blockedReason: deleteField(),
          tier: "provisional",
          score: 0,
          doneCount: 0,
          successCount: 0,
          reviewedCount: 0,
          matchCount: 0,
          successRate: 0,
          avgMinutes: null,
          updatedAt: serverTimestamp(),
        };
        note = "Tier reset: second revoke/rehire cycle.";
      }

      if (nextRehireCount >= 3) {
        payload.active = false;
        payload.stats = {
          ...(existing?.stats || {}),
          staffTier: "paused",
          staffTierLabel: "Paused",
          staffTierUpdatedAt: serverTimestamp(),
        };
        payload.performance = {
          ...(existing?.performance || {}),
          blocked: true,
          blockedAt: serverTimestamp(),
          blockedReason: "Auto-blocked after third revoke/rehire cycle",
          tier: "paused",
          updatedAt: serverTimestamp(),
        };
      }

      transaction.set(staffRef, payload, { merge: true });
      return {
        rehireCount: nextRehireCount,
        note,
        blocked: nextRehireCount >= 3,
      };
    });

    if (txResult?.blocked) {
      throw new Error("Staff auto-blocked after third revoke/rehire cycle.");
    }

    return {
      email: safeEmail,
      uid,
      rehireCount: toNum(txResult?.rehireCount, 0),
      note: String(txResult?.note || ""),
    };
  }

  if (action === "revoke") {
    const txResult = await runTransaction(db, async (transaction) => {
      const staffSnap = await transaction.get(staffRef);
      const existing = staffSnap.exists() ? staffSnap.data() || {} : {};
      const existingOwnerUid = String(existing?.ownerAdminUid || "").trim();
      if (
        roleCtx?.isAssignedAdmin &&
        existingOwnerUid &&
        existingOwnerUid !== roleCtx.uid
      ) {
        throw new Error("You cannot revoke staff owned by another assigned admin.");
      }

      const existingAccess = existing?.access || {};
      const revokeCount = toNum(existingAccess?.revokeCount, 0);
      const rehireCount = toNum(existingAccess?.rehireCount, 0);
      const nextRevokeCount = revokeCount + 1;

      transaction.set(
        staffRef,
        {
          uid,
          email: safeEmail,
          active: false,
          updatedAt: serverTimestamp(),
          access: {
            revokeCount: nextRevokeCount,
            rehireCount,
            lastAction: "revoke",
            lastRevokedAt: serverTimestamp(),
          },
        },
        { merge: true }
      );

      return { revokeCount: nextRevokeCount };
    });

    return { email: safeEmail, uid, revokeCount: toNum(txResult?.revokeCount, 0) };
  }

  throw new Error("Invalid action. Use 'grant' or 'revoke'.");
}

export async function setStaffChatAutoApproval({
  staffUid = "",
  enabled = false,
} = {}) {
  const actorUid = String(auth.currentUser?.uid || "").trim();
  if (!actorUid) throw new Error("You must be signed in.");

  const roleCtx = await getCurrentUserRoleContext(actorUid);
  if (!roleCtx?.isAdmin) {
    throw new Error("Only admins can manage staff.");
  }

  const safeStaffUid = String(staffUid || "").trim();
  if (!safeStaffUid) throw new Error("staffUid is required.");

  const safeEnabled = enabled === true;
  const staffRef = doc(db, "staff", safeStaffUid);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(staffRef);
    if (!snap.exists()) throw new Error("Staff record not found.");
    const existing = snap.data() || {};
    const ownerAdminUid = String(existing?.ownerAdminUid || "").trim();

    if (roleCtx?.isAssignedAdmin && ownerAdminUid && ownerAdminUid !== roleCtx.uid) {
      throw new Error("You cannot edit staff owned by another assigned admin.");
    }

    transaction.set(
      staffRef,
      {
        autoApproveChatMessages: safeEnabled,
        chatModeration: {
          ...(existing?.chatModeration || {}),
          autoApproveMessages: safeEnabled,
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { ok: true, staffUid: safeStaffUid, autoApproveChatMessages: safeEnabled };
  });
}

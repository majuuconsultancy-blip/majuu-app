const assert = require("node:assert/strict");
const test = require("node:test");

const buildFinanceFoundation = require("../../functions/finance-foundation.js");

function safeStr(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function lower(value, max = 400) {
  return safeStr(value, max).toLowerCase();
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeFoundationForTests() {
  const functions = {
    https: {
      onCall(handler) {
        return handler;
      },
    },
    region() {
      return {
        https: {
          onRequest(handler) {
            return handler;
          },
        },
      };
    },
  };

  return buildFinanceFoundation({
    functions,
    onSchedule() {
      return () => null;
    },
    onDocumentUpdated: null,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    db: {
      collection() {
        throw new Error("db.collection should not be called in pure regression tests");
      },
    },
    FieldValue: {
      serverTimestamp() {
        return "__server_timestamp__";
      },
    },
    REGION: "us-central1",
    safeStr,
    lower,
    toNum,
    clamp,
    getUserDocByUid: async () => null,
    requireAdminCallerContext: async () => ({
      callerUid: "test_uid",
      callerRole: "super_admin",
      callerDoc: {},
    }),
    normalizeAdminScope(scope = {}) {
      return scope && typeof scope === "object" ? scope : {};
    },
    fetchPartnerById: async () => null,
    claimEventLock: async () => true,
    autoRouteRequest: async () => ({ ok: true }),
    writeManagerAuditLog: async () => {},
    writeScopedNotificationDoc: async () => {},
  });
}

const foundation = makeFoundationForTests();
const utils = foundation.__test;

test("unlock visibility remains paid_held before in-progress", () => {
  const result = utils.deriveUnlockVisibilityState({
    status: "payment_pending",
    backendStatus: "new",
  });
  assert.equal(result.visibleAsPaid, false);
  assert.equal(result.paid, false);
  assert.equal(result.paymentMetaStatus, "paid_held");
  assert.equal(result.unlockState, "paid_held");
  assert.equal(result.unlockAutoRefundStatus, "pending");
});

test("unlock visibility flips to paid when request is in_progress", () => {
  const result = utils.deriveUnlockVisibilityState({
    backendStatus: "in_progress",
  });
  assert.equal(result.visibleAsPaid, true);
  assert.equal(result.paid, true);
  assert.equal(result.paymentMetaStatus, "paid");
  assert.equal(result.unlockState, "consumed");
  assert.equal(result.unlockAutoRefundStatus, "not_applicable");
});

test("payout queue stays on_hold before request enters in_progress", () => {
  const state = utils.derivePayoutQueueState({
    requestData: { backendStatus: "assigned" },
    payoutDestinationReady: true,
  });
  assert.equal(state.queueStatus, "on_hold");
  assert.equal(state.holdReason, "request_not_in_progress");
});

test("payout queue stays on_hold when destination is missing in in_progress", () => {
  const state = utils.derivePayoutQueueState({
    requestData: { backendStatus: "in_progress" },
    payoutDestinationReady: false,
  });
  assert.equal(state.queueStatus, "on_hold");
  assert.equal(state.holdReason, "missing_partner_payout_destination");
});

test("payout queue becomes ready when in_progress and destination is ready", () => {
  const state = utils.derivePayoutQueueState({
    requestData: { backendStatus: "in_progress" },
    payoutDestinationReady: true,
  });
  assert.equal(state.queueStatus, "ready");
  assert.equal(state.holdReason, "");
});


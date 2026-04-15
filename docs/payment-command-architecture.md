# Majuu Payment Command Architecture (Blaze-Ready + Dummy-Safe)

## 1) Audit Summary

### Request and role flow (existing)
- Request lifecycle is command-controlled in backend via `executeRequestCommand`:
  - `Submitted -> Assigned -> InProgress -> Completed`
  - `startWork` is already restricted to staff and only from `Assigned`.
- Routing and ownership are handled in backend and scoped by admin/staff ownership.

### Payment flow (existing)
- Finance logic is backend callable-driven in `functions/finance-foundation.js`.
- Unlock payment:
  - Checkout initialization exists.
  - Verification exists.
  - Auto-refund scheduler exists.
- Service payment:
  - Staff proposal -> admin approval -> user checkout exists.
  - Refund and payout release callables exist.

### Gaps found before hardening
- No single canonical transaction ledger collection for all payment movements.
- Payout queue readiness could be set before true work start.
- Unlock auto-refund did not stamp explicit request expiry state.
- Unlock flow used mixed semantics around `paid` vs escrow-held.

## 2) Integration Rules (safe insertion points)

- Keep request-stage authority in request commands.
- Keep payment verification authority in finance functions.
- Connect the two through backend automation only:
  - Request stage changes trigger finance state transitions.
  - Payment state changes update transaction ledger.
- No UI logic required for lifecycle transitions.

## 3) Data Model

### Canonical ledger
Collection: `financeTransactions/{transactionId}`

Fields:
- `id`
- `type`: `unlock | service`
- `status`: `pending | paid_held | released | refunded`
- `amount`
- `currency`
- `userId`
- `requestId`
- `paymentId`
- `assignedAdminId`
- `partnerId`
- `branchId`
- `payoutAccountDetails`:
  - `accountName`
  - `accountNumber`
  - `provider`
  - `branchId`
- `refundStatus`: `none | requested | approved | rejected | processed | auto_refunded`
- `transactionReference`
- `unlockState`: `unpaid | paid_held | consumed | refunded`
- `serviceState`: `not_required | pending_approval | pending_payment | paid_held | released | completed | refunded`
- `createdAt`
- `createdAtMs`
- `updatedAt`
- `updatedAtMs`
- `releasedAt`
- `releasedAtMs`

### Existing collections retained
- `serviceRequests/{requestId}/payments/{paymentId}`
- `serviceRequests/{requestId}/refundRequests/{refundId}`
- `payoutQueue/{queueId}`
- `settlementHistory/{settlementId}`
- `financialAuditLogs/{auditId}`
- `paymentShareLinks/{tokenHash}`

## 4) Command Contract (standard)

Envelope:
```json
{
  "actorUid": "uid",
  "actorRole": "user|staff|admin|super_admin",
  "requestId": "request_id",
  "command": "createPayment|approvePayment|releaseFunds|refundPayment|autoRefund",
  "payload": {}
}
```

Rules per command:
- Validate actor identity and role scope server-side.
- Validate request ownership/scope server-side.
- Validate lifecycle preconditions server-side.
- Write request/payment/transaction/audit atomically where required.
- Emit deterministic metadata (`updatedAt`, `updatedBy`, `actionType`).

## 5) Lifecycle Logic (enforced)

### Unlock
- `unpaid` -> `paid_held` on verified payment.
- `paid_held` -> `consumed` only when request enters `InProgress`.
- `paid_held` -> `refunded` via timeout auto-refund or approved refund.

### Service payment
- `not_required` -> `pending_approval` (staff prompt)
- `pending_approval` -> `pending_payment` (admin approve)
- `pending_payment` -> `paid_held` (payment success)
- `paid_held` -> `released` (super admin payout release)
- `released` -> `completed` (request complete bookkeeping)
- `paid_held`/`released` -> `refunded` (refund path, payout-safe checks)

### Request stage coupling
- `InProgress` is only staff-start driven by request command backend.
- Finance readiness transitions must key off request stage, never client flags.

## 6) Mock Handlers (dummy-mode behavior)

For non-provider testing:
- Initialize checkout with demo references.
- Mark payment verified in backend path as escrow-held.
- Keep same ledger writes and status transitions as real provider.
- Never bypass backend state checks for lifecycle transitions.

## 7) Auto-refund Job

Scheduler:
- Runs every 15 minutes.
- Scans unlock payments eligible for timeout refund.
- Preconditions:
  - Unlock type
  - Escrow-held
  - Not `InProgress` / not completed
  - Eligible timestamp passed
- Effects:
  - Refund record upsert (idempotent by deterministic refund id)
  - Payment status update
  - Transaction status/refund status update
  - Request finance expiry state update (`expired_unfulfilled`)

Idempotency:
- Deterministic refund id (`auto_${unlockPaymentId}`).
- Re-run safe when already auto-refunded.

## 8) Security Rules

- Client writes remain blocked for canonical finance collections.
- `financeTransactions` is admin/finance-manager read-only from clients.
- Critical state mutations remain server-owned.

## 9) Migration Notes

- Keep existing callable names for compatibility.
- Incrementally move UI to command wrappers while preserving old endpoints.
- Backfill historical payment rows into `financeTransactions`.
- After backfill, make ledger the reporting source of truth.

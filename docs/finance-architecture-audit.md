# MAJUU Finance/Payment Architecture Audit

Date: April 15, 2026

## Scope and baseline
- Source of truth is `functions/finance-foundation.js`.
- Existing escrow/refund/release flows were preserved and extended, not replaced.
- Frontend payment orchestration primarily flows through `src/services/paymentservice.js` and request/admin payment screens.

## Current architecture map
- Payment types:
  - `unlock_request`: unlock/escrow-style pre-work payment.
  - `in_progress`: staff-prompted and admin-approved payment.
- Core finance lifecycle:
  - `payment_session_created -> awaiting_payment -> paid/held -> payout_ready/settled -> refunded/auto_refunded` (forward-only intent preserved).
- Collections and ledgers:
  - `serviceRequests/{requestId}/payments/{paymentId}`
  - `serviceRequests/{requestId}/payments/{paymentId}/attempts/{attemptId}`
  - `paymentProviderReferences/{reference}`
  - `paymentProviderEvents/{eventId}`
  - `paymentShareLinks/{tokenHash}`
  - `payoutQueue/{queueId}`
  - `settlementHistory/{settlementId}`
  - `financialAuditLogs/{auditId}`

## Provider integration model (normalized)
- Provider abstraction now routes initialization, verification, and refunds via provider-aware wrappers:
  - `initializeProviderTransaction`
  - `verifyProviderTransaction`
  - `createProviderRefund`
  - provider summary normalizers for verification/refunds.
- Paystack and Daraja(M-PESA) are integrated behind this shared pattern where practical.
- Webhooks:
  - Paystack webhook signature verification.
  - Daraja webhook IP allowlist validation + callback dedupe lock.
- Provider references:
  - Internal reference remains canonical.
  - `providerReference` added and used consistently with legacy `paystackReference` compatibility fallback.

## Security and config management
- Superadmin provider config management added (test/live per provider, active toggles, callback URLs, credential fields).
- Secret handling:
  - encrypted-at-rest provider secrets in provider config doc.
  - requires `PAYMENT_PROVIDER_CONFIG_ENCRYPTION_KEY`.
  - env fallback retained for backward compatibility and staged rollout.
- Server-side authority:
  - amount verification remains backend-side in finalize/verify paths.
  - idempotency + duplicate detection + short-lived attempt reuse controls are active in checkout session creation.

## Pricing/cut rules currently implemented
- Global discount and per-request discount hierarchy:
  - global discount overrides request-level discount when enabled.
- Platform cut behavior:
  - global platform-cut toggle + per-request override toggle on admin flow.
  - cut percentage/value sourced from partner financial profile/settings, not editable in assigned-admin approval UI.
- User-facing payment summary:
  - one total amount shown.
  - discount shown when applicable.
  - no platform cut percentage/breakdown shown to end users.

## Shareable payment link behavior
- One-time style usage preserved via:
  - paid-state invalidation at link + payment linkage level.
  - subsequent opens return explicit already-paid reason/state.
- Link base URL uses configurable finance setting with fallback.

## Edge-case hardening completed
- Duplicate callback/webhook dedupe locks.
- Duplicate checkout detection (payer/request/payment/amount window).
- Checkout rate limiting.
- Unlock visibility and payout queue state now centralized with pure helpers:
  - `deriveUnlockVisibilityState`
  - `derivePayoutQueueState`
- Queue readiness now respects request backend stage (`in_progress`) plus destination readiness.

## Open architectural concerns (non-destructive)
- Frontend lint configuration treats `functions/` as browser scope, so Node global lint errors appear unless lint scope is split by target.
- Provider failover policy is still explicit/manual; automatic cross-provider fallback during live outages is not enabled to avoid unsafe double-charge risk.
- Reconciliation jobs are event-driven and callable-driven; a dedicated periodic provider reconciliation sweep can be added later for delayed settlement edge cases.

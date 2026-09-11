# Phase 2.4D — Production Payment Recovery, Reconciliation & Rate-Limit Hardening

## 1. Executive Summary

Phase 2.4D establishes enterprise-grade operational resilience, automated reconciliation, and rate-limiting protections for SV Hub's payment infrastructure. In prior phases (Phase 2.4B and Phase 2.4C), payment state was unified under a single authoritative fulfillment engine and hardened against webhook race conditions. However, real-world distributed payment gateways face network timeouts, browser disconnections before callback, gateway 5xx spikes, process crashes mid-fulfillment, and burst abuse.

Phase 2.4D introduces:
1. **Automated Server-Side Payment Reconciliation Engine** (`src/services/paymentReconciliationService.js`) capable of querying Razorpay server-to-server, classifying gateway responses, and reconciling stale or uncertain orders safely.
2. **Gateway Response Classification & Error Categorization**, ensuring network timeouts, resets, and 5xx errors are classified as `RETRYABLE_ERROR` and **never** falsely marked as `FAILED`.
3. **Distributed Locking for Webhook Recovery** with atomic MongoDB ownership claims (`lockedAt`, `lockOwner`) preventing split-brain execution across workers.
4. **Payment Creation De-duplication** preventing rapid click spam, browser tab races, or network retries from creating redundant Razorpay orders for the same cart checkout.
5. **Production Rate Limiting** (`src/middleware/rateLimiter.js`) with isolated buckets for payment initiation, verification, failure logging, and burst-tolerant webhook handling.
6. **Administrative On-Demand Reconciliation Endpoint** (`POST /api/admin/orders/:id/reconcile`) allowing support personnel to safely audit and synchronize payment states without exposing gateway secrets.
7. **Adversarial Test Suite** of 80 comprehensive tests (`tests/verify-phase2-4d-recovery.js`) verifying crash recovery, race conditions, classification, and backoff.

---

## 2. Before-State Risks (Addressed in Phase 2.4D)

| Risk Category | Pre-2.4D Behavior | Phase 2.4D Resolution |
|---|---|---|
| **Browser Disconnection** | Customer pays on Razorpay popup; user closes tab before `/verify` reaches backend. If webhook fails, order stays `PENDING_PAYMENT` indefinitely. | `recoverStalePayments` or admin reconcile queries Razorpay, detects captured status, and executes atomic fulfillment. |
| **Gateway Timeout on Status Check** | Gateway timeout or 500 error previously had no classification; could be swallowed or treated as failure. | Strict gateway classification: 5xx and timeouts yield `RETRYABLE_ERROR` / `UNKNOWN`. The payment remains retryable and is never marked `FAILED`. |
| **Repeated Pay Button Abuse** | Rapid clicking or multi-tab checkout generated multiple independent Razorpay orders for the same local order. | `createRazorpayOrder` enforces a mutex/lease window: reuses active unexpired Razorpay orders for the order; rejects rapid concurrent creation. |
| **Rate Limit Resource Exhaustion** | Sensitive endpoints (`/create-order`, `/verify`, `/record-failure`) had no rate limiting, vulnerable to DoS/brute force. | Strict tiered rate limiting applied per user/IP (10/min for creation, 15/min for verification, 20/min for failure recording, 120/min burst-safe for webhooks). |
| **Concurrent Webhook Recovery** | Multiple background workers could attempt to recover the same `PROCESSING` or `FAILED_RETRYABLE` webhook concurrently. | Atomic MongoDB conditional updates claim lock ownership (`lockedAt`, `lockOwner`, `staleThresholdMs`). Only the winning worker processes. |
| **Inconsistent Order States** | Unresolvable divergence (e.g. captured amount mismatch) had no explicit quarantine state. | Escalates cleanly to `REQUIRES_RECONCILIATION` without mutating financial snapshots or inventory. |

---

## 3. Architecture

```
                 ┌────────────────────────────────────────────────────────┐
                 │                   PAYMENT CLIENTS                      │
                 │   Customer Web App   │    Admin Dashboard / Support    │
                 └──────────────┬────────────────────────┬────────────────┘
                                │                        │
                         POST /verify            POST /admin/orders/:id/reconcile
                                │                        │
                                ▼                        ▼
┌──────────────────┐     ┌────────────────────────────────────────────────┐
│ Razorpay Webhook ├────►│       PAYMENT RECONCILIATION SERVICE           │
│ /payments/webhook│     │   (paymentReconciliationService.js)            │
└──────────────────┘     │                                                │
                         │  • Server-to-Server Gateway Verification       │
┌──────────────────┐     │  • Response & Error Classification             │
│ Background Stale ├────►│  • Stale Order & Webhook Event Recovery        │
│ Recovery Workers │     │  • Backoff with Jitter Calculation             │
└──────────────────┘     └───────────────────────┬────────────────────────┘
                                                 │
                                                 ▼
                                 ┌────────────────────────────────┐
                                 │   SHARED ATOMIC FULFILLMENT    │
                                 │ (paymentFulfillmentService.js) │
                                 └───────────────┬────────────────┘
                                                 │
                         ┌───────────────────────┼───────────────────────┐
                         ▼                       ▼                       ▼
                   Payment Record           Order Record          Stock / Cart
                   • PAID / SUCCESS        • CONFIRMED             • Decrement qty
                   • razorpayPaymentId     • paymentStatus: PAID   • Clear cart
```

All incoming verification paths (frontend callback, webhook delivery, background reconciliation daemon, admin on-demand action) converge on the **same single fulfillment engine**.

---

## 4. Payment State Machine

```
               ┌──────────┐
               │ CREATED  │
               └────┬─────┘
                    │
                    ▼
               ┌──────────┐
         ┌────►│ PENDING  │◄────────────┐
         │     └────┬─────┘             │
         │          │                   │
         │          ├───────────────────┼──────────────────┐
         │          │                   │                  │
         │          ▼                   ▼                  ▼
         │     ┌──────────┐       ┌──────────┐     ┌────────────────────────┐
         │     │ SUCCESS  │       │  FAILED  │     │ REQUIRES_RECONCILIATION│
         │     └────┬─────┘       └──────────┘     └────────────────────────┘
         │          │
         │          ▼
         │     ┌──────────┐
         │     │   PAID   │
         │     └──────────┘
         │
         └───── [Stale lock reset / retryable error]
```

### Transition Invariants
- `SUCCESS` / `PAID` are terminal success states. They **cannot** transition back to `PENDING`, `CREATED`, or `FAILED`.
- `CANCELLED` orders **cannot** be fulfilled or resurrected by late payment verifications.
- `FAILED` payments cannot overwrite newer `SUCCESS` records.
- Stale or ambiguous payments transition to `REQUIRES_RECONCILIATION` when amounts mismatch or unresolvable discrepancies are detected.

---

## 5. Recovery State Machine & Gateway Classification

When the reconciliation service inspects an uncertain payment against Razorpay, responses are mapped to deterministic classifications:

| Gateway State | Internal Classification | Local Action |
|---|---|---|
| Payment `captured == true` | `SUCCESS_CONFIRMED` | Fulfill atomically via `fulfillRazorpayPayment`. Transition Order to `CONFIRMED`, Payment to `SUCCESS`. |
| Payment `authorized == true` | `AUTHORIZED_UNCONFIRMED` | Remains pending capture. Does not fulfill; schedules retry. |
| Payment `failed` | `FAILED_CONFIRMED` | Mark Payment `FAILED` if no valid capture exists; update failure reason. |
| Razorpay 404 / Payment Not Found | `NOT_FOUND_CONFIRMED` | Stale order cleanup; transition to `FAILED` if expired. |
| Gateway 5xx, Network Timeout, ECONNRESET | `RETRYABLE_ERROR` | **Do not alter local payment state**. Compute exponential backoff with jitter; retry later. |
| Signature/Key/Payload Auth Error | `PERMANENT_ERROR` | Flag `REQUIRES_RECONCILIATION` for manual review. |
| Unknown / Unrecognized Status | `UNKNOWN` | Do not mark successful; log structured alert. |

---

## 6. Reconciliation Algorithm

1. **Authorize Request**: Ensure user owns order or is verified `ADMIN`.
2. **Fetch Authoritative Local State**: Load `Order` and associated `Payment` within MongoDB.
3. **Short-Circuit Terminal Success**: If `order.status` is already `CONFIRMED` and payment is `PAID`/`SUCCESS`, immediately return `{ success: true, idempotent: true }` without mutating database or issuing redundant gateway requests.
4. **Inspect Razorpay Order & Payments**:
   - Query Razorpay API for `/orders/:id/payments`.
   - Iterate through payments to find captured transaction.
5. **Verify Financial Invariants**:
   - Verify `currency === 'INR'`.
   - Verify `amount === order.totalAmount * 100`.
   - Verify payment is linked to local `razorpayOrderId`.
6. **Execute Atomic Fulfillment**:
   - Pass validated credentials to `fulfillRazorpayPayment`.
   - Run inside MongoDB session with atomic inventory decrement.
7. **Audit & Log**: Record transition, attempt count, and latency in structured log.

---

## 7. Retry Strategy & Exponential Backoff

For transient failures (network drops, MongoDB write conflicts, Razorpay 502/503/504), retries use bounded exponential backoff with full jitter:

$$t_{\text{backoff}} = \min(t_{\text{max}}, t_{\text{base}} \times 2^{\text{attempt}}) \times \text{jitter}$$

- **Base interval**: 1,000 ms (1 sec)
- **Maximum interval**: 300,000 ms (5 min)
- **Max retry attempts**: 5 attempts
- **Jitter factor**: Random multiplier between `0.8` and `1.2`

When `attempts >= maxAttempts`, the entity ceases automatic retry and transitions to `REQUIRES_RECONCILIATION` to alert operators.

---

## 8. Webhook Recovery & Distributed Locking

Webhook events stuck in `PROCESSING` (e.g. if the Node.js process crashed mid-execution) or in `FAILED_RETRYABLE` are recovered via atomic lease ownership:

```javascript
const event = await WebhookEvent.findOneAndUpdate(
  {
    _id: eventId,
    $or: [
      { status: 'FAILED_RETRYABLE' },
      { status: 'PROCESSING', lockedAt: { $lt: staleThresholdDate } }
    ]
  },
  {
    $set: {
      status: 'PROCESSING',
      lockedAt: new Date(),
      lockOwner: ownerId,
      lastAttemptAt: new Date()
    },
    $inc: { attempts: 1 }
  },
  { new: true }
);
```

- If another worker claims the record first, the query matches 0 documents and returns `null`.
- Double processing is physically prevented at the database query layer.
- Once processed, `lockedAt` is cleared to `null` and status updated to `PROCESSED`.

---

## 9. Payment Endpoint Rate Limiting

Sensitive payment routes are protected by `src/middleware/rateLimiter.js`:

| Route | Window | Max Requests | Key Generator | Response Headers |
|---|---|---|---|---|
| `POST /api/payments/razorpay/create-order` | 60 sec | 10 | User ID or IP | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` |
| `POST /api/payments/razorpay/verify` | 60 sec | 15 | User ID or IP | Standard 429 response |
| `POST /api/payments/razorpay/record-failure` | 60 sec | 20 | User ID or IP | Standard 429 response |
| `POST /api/payments/razorpay/webhook` | 60 sec | 120 | Remote IP | Burst allowance for batch gateway webhooks |

*Note for Production Scale*: The current implementation uses an in-memory sliding window rate limiter suitable for single-instance or small cluster nodes. For high-scale horizontal deployments across multiple independent containers, a Redis-backed distributed store (`rate-limiter-flexible` or Redis sliding log) should be connected.

---

## 10. Payment Creation De-duplication

To protect against duplicate order creation caused by double-clicking, multiple checkout tabs, or client network retries:
1. `createRazorpayOrder` queries for existing payments for the `orderId` in `CREATED` or `PENDING` status.
2. If an active payment exists with matching currency and amount, and was created within the lock window (<30s), the existing Razorpay order details (`razorpayOrderId`, `amount`, `currency`, `keyId`) are returned immediately.
3. If an existing order is older than the stale threshold, it is superseded safely.
4. If an order is already `PAID` or `CONFIRMED`, new payment creation is rejected with `400 order_already_paid`.

---

## 11. Crash Recovery & Idempotency Guarantees

The recovery system guarantees strict safety under arbitrary crashes:

- **Crash after Razorpay capture, before DB update**: Reconciliation queries Razorpay, detects captured status, and fulfills order.
- **Crash mid-transaction**: MongoDB transaction rolls back automatically; no partial updates or orphaned inventory deductions.
- **Crash after inventory deduction, before HTTP response**: Re-verifying calls `fulfillRazorpayPayment` which detects `order.paymentStatus === 'PAID'` and returns existing state without re-deducting stock or re-clearing cart.
- **Crash during webhook execution**: Stale lock timeout elapses; recovery worker claims lease and safely re-runs fulfillment.

---

## 12. Security Controls & Authorization

- **Customer Isolation**: Customer A cannot reconcile Customer B's order. Ownership check `order.userId.toString() === req.user.id.toString()` is enforced.
- **Admin Role Enforcement**: General administrative recovery requires `requireAuth` + `requireAdmin`.
- **Server Authoritative Invariants**: No prices, totals, currencies, or statuses sent by client are trusted.
- **Secret Scrubbing**: Gateway secrets (`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) are never logged, never returned in API payloads, and never exposed to the frontend.

---

## 13. Audit Logging & Observability

Structured lifecycle logs are emitted for all payment operations using safe, non-sensitive metadata:
- Event: `PAYMENT_RECONCILIATION_ATTEMPT`, `PAYMENT_RECONCILED`, `PAYMENT_RECONCILIATION_SKIPPED`, `GATEWAY_ERROR`
- Tracked Fields: `orderId`, `orderNumber`, `razorpayOrderId`, `razorpayPaymentId`, `classification`, `attempts`, `durationMs`
- Strictly excluded: Authorization tokens, credit card data, secret keys, customer passwords.

---

## 14. Comprehensive Failure Matrix (80 Test Cases)

| Category | Count | Scenarios Tested |
|---|---|---|
| **A. Razorpay API** | 13 | Timeouts, DNS failures, connection resets, 500/502/503 errors, malformed responses, payment not found, order not found, captured vs authorized vs failed states. |
| **B. Recovery** | 10 | Stale CREATED, stale PENDING, stale REQUIRES_RECONCILIATION, successful recovery, failed recovery, retryable recovery, permanent failure, idempotency. |
| **C. Webhooks** | 12 | Stuck PROCESSING events, retryable events, duplicate events, concurrent lock claims, out-of-order events, amount mismatches, currency mismatches. |
| **D. Fulfillment** | 10 | Duplicate fulfillment, concurrent fulfillment races, inventory exact-once, cart already cleared, confirmed orders, cancelled orders, delivered orders. |
| **E. Creation** | 7 | Repeated create-order clicks, multiple browser tabs, network retries, existing active payment reuse, stale payment superseding, paid order rejection. |
| **F. Rate Limiting** | 9 | Creation burst (429), verification burst, failure-record burst, customer isolation, 429 response headers, webhook burst tolerance. |
| **G. Database / Crash** | 9 | Crash before/during/after transaction, response lost recovery, transient DB retry, concurrent worker recovery. |
| **H. Security** | 10 | Cross-user reconciliation rejection, customer admin bypass rejection, forged amounts, forged signatures, secret leakage audit. |
| **Total** | **80** | **100% Passing** |

---

## 15. Test Results Summary

```
====================================================================
SV HUB TEST RUNNER RESULTS SUMMARY
====================================================================
Phase 2.4D Production Recovery Suite: 80 / 80 PASSED
Phase 2.4C Razorpay Webhooks Suite:   92 / 92 PASSED
Phase 2.4B Payment Core Suite:        54 / 54 PASSED
Razorpay Payments Suite:              47 / 47 PASSED
Phase 2.2 Edge Cases Suite:           63 / 63 PASSED
Phase 2.3 Delivery Lifecycle Suite:   48 / 48 PASSED
Admin Orders Suite:                   30 / 30 PASSED
E2E Commerce Suite:                  139 / 139 PASSED
QA API Audit Suite:                  108 / 108 PASSED
Frontend Production Build:           PASS (built in 1.07s)
Database Integrity Audit:            12 / 12 INVARIANTS PASSED
Secret Leakage Audit:                0 SECRETS DETECTED
====================================================================
```

---

## 16. Database Integrity Results

Audit executed directly against MongoDB Atlas via `scripts/audit-db-integrity.js`:

- Zero duplicate Razorpay payment IDs: **0**
- Zero duplicate Razorpay order IDs: **0**
- Zero duplicate webhook event IDs: **0**
- Zero negative stock counts across products/variants: **0**
- Zero invalid order statuses: **0**
- Zero invalid payment statuses: **0**
- Zero invalid webhook statuses: **0**
- Zero active products without valid variants: **0**
- Zero corrupted order snapshots: **0**
- Zero orphan payments without existing orders: **0**
- Zero orphan orders without user association: **0**
- Real existing orders remain intact: **All verified intact**

---

## 17. Remaining Limitations

1. **Rate Limiting Persistence**: The sliding-window rate limiter stores hits in Node.js process memory. In a multi-replica container environment behind an AWS ALB or Cloudflare, rate limits are per-pod rather than cluster-wide.
2. **Scheduled Recovery Execution**: The `recoverStalePayments` and `recoverStuckWebhookEvents` functions are fully implemented and unit/integration tested, but rely on an external scheduler (e.g. AWS EventBridge, cron, or agenda runner) to trigger them at periodic intervals (e.g. every 5 minutes).

---

## 18. Production Deployment Requirements

1. **Environment Variables**:
   - `RAZORPAY_KEY_ID`: Official Razorpay Key ID
   - `RAZORPAY_KEY_SECRET`: Official Razorpay Key Secret
   - `RAZORPAY_WEBHOOK_SECRET`: Secret configured in Razorpay Webhook dashboard
   - `MONGODB_URI`: Replica set connection string supporting distributed transactions
2. **Cron / Worker Setup**:
   - Set up periodic cron job calling `recoverStalePayments` and `recoverStuckWebhookEvents` every 5-15 minutes.
3. **Redis Deployment (Optional, Recommended for High Scale)**:
   - Wire Redis into `rateLimiter.js` if running >3 backend instances.

---

## 19. Items Explicitly Deferred to Phase 2.4E

Per strict project boundaries, the following refund capabilities were **not** implemented in Phase 2.4D and are deferred to Phase 2.4E:
- Customer-facing and Admin-facing refund requests
- Razorpay Refund API calls (`payments.refund()`)
- Refund webhook processing (`refund.created`, `refund.processed`, `refund.failed`)
- Restocking inventory on refund
- Customer refund status history and financial debit snapshots

# Phase 2.4H — Adversarial Payment & Security Forensic Plan

**Phase**: 2.4H — 100+ Adversarial Payment & Security Testing  
**Status**: READ-ONLY FORENSIC AUDIT COMPLETE  
**Objective**: Aggressively failure-inject, fuzz, race, and attack the SV Hub payment, refund, cancellation, webhook, inventory, auth, and recovery subsystems to discover real production vulnerabilities.

---

## 1. Attack Surface Analysis

The external and internal attack surface comprises the following trust boundaries and interfaces:

### 1.1 Ingress Points & Trust Boundaries
1. **Public Catalog & Cart**:
   - `GET /api/products`, `GET /api/products/:id`
   - Client-side manipulation of prices, variants, and stock displays in `localStorage`.
   - Client cannot be trusted for price authority.
2. **Order Placement**:
   - `POST /api/orders`
   - Inputs: `shippingAddress`, `shippingMethod`.
   - Trust Boundary: Cart items must be validated against authoritative MongoDB `Product` records (price, stock, active status). Server recalculates subtotal, shipping, and total amount.
3. **Payment Initiation**:
   - `POST /api/payments/razorpay/create-order`
   - Inputs: `orderId`.
   - Trust Boundary: Order ownership (`order.userId === req.user._id`), payable state (`PENDING_PAYMENT`), non-zero total, concurrent creation lock (`CREATING_` flag).
4. **Payment Verification**:
   - `POST /api/payments/razorpay/verify`
   - Inputs: `orderId`, `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`, `amount`.
   - Trust Boundary: HMAC-SHA256 signature verification (`serverOrderId|paymentId`), upstream gateway verification (`razorpay.payments.fetch`), currency check (`INR`), captured state check (`captured`), atomic fulfillment session.
5. **Razorpay Webhooks**:
   - `POST /api/payments/razorpay/webhook`
   - Inputs: Raw request body Buffer, `X-Razorpay-Signature`, `X-Razorpay-Event-Id`.
   - Trust Boundary: Timing-safe HMAC verification with `RAZORPAY_WEBHOOK_SECRET`, event-level idempotency via `WebhookEvent.eventId` unique index, atomic fulfillment execution.
6. **Customer & Admin Refunds**:
   - `POST /api/orders/:id/refund` (Customer), `POST /api/admin/orders/:id/refund` (Admin).
   - Inputs: `amount`, `reason`, `idempotencyKey`, `items` (line restock specifications).
   - Trust Boundary: Role enforcement, payment eligibility, refundable amount ceiling (`refundableAmount = capturedAmount - refundedAmount`), per-line restock limits (`restoredQuantity <= ordered quantity`).
7. **Order Cancellation**:
   - `POST /api/orders/:id/cancel` (Customer & Admin).
   - Inputs: `reason`.
   - Trust Boundary: Terminal states (`CANCELLED`, `DELIVERED` blocked), transit states (`SHIPPED`, `OUT_FOR_DELIVERY` blocked), exact-once inventory restoration (`restoredQuantity`), automatic customer refund initiation for paid orders.
8. **Authentication & Session Management**:
   - `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/google`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.
   - Trust Boundary: Cryptographic password hashing (bcrypt), JWT verification (`sub` claim, active user check), rate limiting.
9. **Administrative Access**:
   - `PATCH /api/admin/orders/:id/status`, `PATCH /api/admin/settings`, `/api/admin/*`.
   - Trust Boundary: Strict server-side role check (`req.user.role === 'ADMIN'`). Never trusts client-supplied role flags.

---

## 2. State Machine Models & Allowed Transitions

### 2.1 Order State Machine
```
[PENDING_PAYMENT]
    ├── (Payment captured & verified) ──> [CONFIRMED]
    ├── (Cancelled before payment) ─────> [CANCELLED]
    └── (Captured externally but conflict) ──> [REQUIRES_RECONCILIATION]

[CONFIRMED]
    ├── (Admin/System pack) ────────────> [PROCESSING]
    ├── (Admin/Customer cancel) ────────> [CANCELLED]
    └── (Gateway conflict/Out of stock) ─> [REQUIRES_RECONCILIATION]

[PROCESSING]
    ├── (Carrier pickup) ───────────────> [SHIPPED]
    └── (Admin cancel) ─────────────────> [CANCELLED]

[SHIPPED]
    └── (Local courier out) ────────────> [OUT_FOR_DELIVERY]

[OUT_FOR_DELIVERY]
    └── (Customer delivered) ───────────> [DELIVERED]

[DELIVERED] (TERMINAL)
    └── (No cancellation permitted; refund permitted)

[CANCELLED] (TERMINAL)
    └── (Resurrection strictly prohibited; late payment enters REQUIRES_RECONCILIATION)

[REQUIRES_RECONCILIATION]
    └── (Requires administrative resolution / audit reconciliation)
```

### 2.2 Payment State Machine
```
[CREATED] ──> [PENDING] ──> [SUCCESS / PAID] ──> [PARTIALLY_REFUNDED] ──> [REFUNDED]
                 ├── (Gateway failure / signature fail) ──> [FAILED]
                 └── (Gateway/State conflict) ───────────> [REQUIRES_RECONCILIATION]
```

### 2.3 Refund State Machine
```
[REQUESTED] ──> [CREATED] ──> [PROCESSING] ──> [PROCESSED]
                                   ├── (Gateway error) ──> [FAILED]
                                   └── (Timeout/Uncertain) ─> [REQUIRES_RECONCILIATION]
```

---

## 3. Core System Invariants

1. **Financial Integrity**:
   - `0 <= refundedAmount <= capturedAmount`
   - `refundableAmount = capturedAmount - refundedAmount`
   - `capturedAmount >= 0`, `refundedAmount >= 0`, `refundableAmount >= 0`
   - `order.totalAmount = order.subtotal + order.shippingFee - order.discount`
2. **Inventory Exact-Once**:
   - Product stock cannot become negative (`qty >= 0`, `variants[].qty >= 0`).
   - For every order line: `0 <= restoredQuantity <= quantity`.
   - Restoration occurs at most once per line unit across refunds and cancellations.
3. **Idempotency & Deduplication**:
   - Unique payment ID across orders: No two distinct orders can share the same Razorpay payment ID.
   - Unique Razorpay order ID across orders: No two distinct orders can share the same `razorpayOrderId`.
   - Webhook events are processed at most once (`WebhookEvent.eventId` unique constraint).
   - Duplicate client verification calls return identical success payload without duplicate inventory deduction or duplicate cart clearing.
4. **Order State Immutability**:
   - Once an order reaches `CONFIRMED`, it cannot be downgraded to `PENDING_PAYMENT`.
   - Once an order reaches `DELIVERED`, it cannot be cancelled or resurrected.
   - Once an order reaches `CANCELLED`, it cannot transition to `CONFIRMED` or `DELIVERED`.
5. **Customer Isolation**:
   - Customer A cannot view, pay for, cancel, or refund Customer B's order.
6. **Audit Trail Immutability**:
   - Audit logs are append-only. Mongoose model hooks block `updateOne`, `deleteMany`, etc.
   - Metadata is sanitized recursively to redact secrets, tokens, passwords, and card numbers.

---

## 4. Race Windows & Suspected Weaknesses

| Subsystem | Potential Race / Vulnerability | Existing Protection | Suspected Weakness to Attack |
| :--- | :--- | :--- | :--- |
| **Payment Creation** | Rapid double-click / multiple browser tabs creating multiple Razorpay orders. | `CREATING_` lock string on `order.razorpayOrderId` with 30s timeout. | Check if race between concurrent tabs can slip past lock or generate separate payments if lock clears. |
| **Verify vs Webhook** | Client `verify` and server-to-server webhook `payment.captured` fire simultaneously. | MongoDB transaction inside `fulfillRazorpayPayment`, idempotency check on `order.status === 'CONFIRMED'`. | Check if concurrent execution causes WriteConflict retry exhaustion or double inventory deduction. |
| **Payment vs Cancel** | Customer cancels order right as payment is captured by Razorpay. | Transactional check inside `fulfillRazorpayPayment`: if `CANCELLED`, moves to `REQUIRES_RECONCILIATION`. | Check if race allows stock to be restored by cancellation AND deducted by payment fulfillment simultaneously. |
| **Refund vs Cancel** | Admin initiates partial refund with restock while customer cancels order. | Per-line `restoredQuantity` accounting. | Check if full order cancellation after partial refund restores full original quantity instead of remaining unrestored quantity. |
| **Two Concurrent Refunds** | Two simultaneous refund requests with different idempotency keys. | Mongo transaction reserving refundable amount. | Check whether concurrent requests can cause negative `refundableAmount` or total refund > `capturedAmount`. |
| **Webhook Replay** | Replaying a valid webhook event 50 times. | `WebhookEvent` unique index on `eventId`. | Check if duplicate-key error handling returns HTTP 200 without reprocessing fulfillment logic. |
| **Authorization Bypass** | Customer passes role in JSON body `{ "role": "ADMIN" }` or attempts admin route. | JWT payload verified with secret; `requireAdmin` checks `req.user.role`. | Verify no route handler trusts body role or query parameters. |
| **Rate Limiting Quota** | Flooding auth, payment, refund, order, admin endpoints. | Sliding window in-memory rate limiter per category. | Verify 429 response, `Retry-After` header, audit event creation, and IP/User key separation. |

---

## 5. Adversarial Testing Plan (100+ Scenarios)

The test suite will be implemented in `tests/verify-phase2-4h-adversarial.js` spanning 18 distinct categories with 100+ substantive assertions:

- **Section A: Authentication Attacks** (Brute-force bursts, fake JWTs, expired tokens, malicious headers, case-folding)
- **Section B: Authorization & Role Attacks** (Role spoofing in body/headers, unauthenticated access, customer on admin endpoints)
- **Section C: Payment Creation Attacks** (Manipulated totals, foreign currency, paying for another user's order, cancelled order payment, concurrent order creation)
- **Section D: Payment Verification Attacks** (Forged signatures, tampered payment IDs, amount manipulation, non-INR currency, wrong customer)
- **Section E: Double Payment & Race Attacks** (Racing verification requests, verification during cancellation, two distinct payment IDs against one order)
- **Section F: Webhook Security & Tampering Attacks** (Missing/corrupted signatures, body mutation, whitespace alteration, malformed JSON, event spoofing)
- **Section G: Webhook Replay & Concurrency Attacks** (Duplicate event replay, 10x burst delivery, webhook race with client verify)
- **Section H: Webhook State Machine & Out-of-Order Events** (`payment.failed` after `payment.captured`, webhook for cancelled order, webhook for delivered order)
- **Section I: Refund Security & Boundary Attacks** (Zero/negative refunds, over-refund, refund on unpaid order, customer refund on another customer's order)
- **Section J: Refund Idempotency & Concurrency Attacks** (Duplicate idempotency keys, concurrent refunds, multiple partial refunds)
- **Section K: Cancellation & Restock Attacks** (Cancellation of delivered order, duplicate cancellation, cancellation after partial refund)
- **Section L: Inventory Exact-Once Invariant Attacks** (Simultaneous checkouts with stock=1, restock quantity exceeding purchased, negative stock prevention)
- **Section M: Order State Machine Invariant Attacks** (Illegal transitions: `PENDING` -> `DELIVERED`, `CANCELLED` -> `CONFIRMED`, `DELIVERED` -> `CANCELLED`)
- **Section N: Customer Isolation Attacks** (Cross-account order retrieval, address tampering, unauthorized refund lookup)
- **Section O: Rate Limiting & Abuse Attacks** (Boundary testing, 429 enforcement, key isolation, burst webhook immunity)
- **Section P: Request Correlation & Header Attacks** (Oversized IDs, SQL/script injection in `X-Request-Id`, propagation across responses)
- **Section Q: Security Audit Logging & Immutability Attacks** (Sensitive data scrubbing, blocking direct update/delete on `AuditLog`)
- **Section R: Failure Injection & Malformed Fuzzing** (Malformed ObjectIds, gateway 502 uncertainty, transaction abort consistency, non-crash error handling)

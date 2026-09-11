# Phase 2.4G — Production-Grade Rate Limiting & Security Audit Logging

**Status**: COMPLETED  
**Scope**: SV Hub Payment Hardening & Observability  
**Test Suite**: `tests/verify-phase2-4g-security.js` (53/53 Assertions PASS)  
**Database Audit**: 19/19 Integrity Invariants PASS  

---

## 1. Executive Summary

Phase 2.4G completes the production hardening of SV Hub by introducing:
1. **Endpoint-Categorized Rate Limiting**: Abuse prevention across Authentication, Payment Creation, Payment Verification, Refunds, Order Lifecycle, Administrative Mutations, and Public Catalog routes.
2. **Request Correlation**: Uniform `X-Request-Id` validation and propagation across all HTTP requests, structured operational logs, and durable security audit records.
3. **Durable, Append-Only Audit Logging**: A Mongoose-backed `AuditLog` model recording security-critical events (auth attempts, authorization denials, admin mutations, payment transitions, refund events, cancellations, webhook verifications, and rate limit breaches).
4. **Strict Sensitive Data Redaction**: Automatic recursive scrubbing of passwords, JWTs, Razorpay secrets, auth tokens, webhook HMAC secrets, and card/PAN numbers before persisting audit metadata.
5. **Rate-Limit Correctness & Webhook Immunity**: High burst tolerance for Razorpay webhook ingress (120 req/min) ensuring webhook deliveries and provider retries are never suppressed.
6. **Zero Side-Effects**: Guaranteed isolation ensuring rate limiting and logging never mutate financial balances, alter order statuses, restore inventory, or modify carts.

---

## 2. Request Correlation Architecture

### 2.1 Identifier Flow
- **Ingress Validation**: Handled by [`src/middleware/requestId.js`](file:///c:/Users/Venkatesh/svhub/sv/svhub-backend/src/middleware/requestId.js).
- If client supplies `X-Request-Id` or `X-Correlation-Id`:
  - Validated against `/^[a-zA-Z0-9_-]{8,64}$/`.
  - Malicious, oversized, or special-character headers are stripped.
- If missing or invalid, the server generates a unique identifier:
  `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
- Attached to `req.id` and returned in the HTTP response header `X-Request-Id`.
- Propagated to:
  - Express request logger: `[req.id] METHOD URL STATUS - DURATION`
  - Audit records: `AuditLog.requestId`

---

## 3. Rate Limiting Architecture & Threat Model

### 3.1 Rate Limiting Engine
Implemented in [`src/middleware/rateLimiter.js`](file:///c:/Users/Venkatesh/svhub/sv/svhub-backend/src/middleware/rateLimiter.js) via `InMemorySlidingWindowRateLimiter`:
- Uses timestamp arrays per key to maintain precise sliding-window rate tracking.
- Periodic 2-minute memory sweep cleans up expired sliding-window entries to prevent memory exhaustion.
- Emits standard rate limiting headers on every response:
  - `X-RateLimit-Limit`: Maximum allowable requests in window.
  - `X-RateLimit-Remaining`: Remaining capacity.
  - `X-RateLimit-Reset`: Unix timestamp when the oldest hit in window expires.
- On breach:
  - Returns `HTTP 429 Too Many Requests`.
  - Sets `Retry-After: <seconds>`.
  - Returns structured JSON `{ success: false, error: { code: 'rate_limit_exceeded', message: '...' } }`.
  - Automatically writes a durable `RATE_LIMIT_EXCEEDED` security audit record.

### 3.2 Endpoint Categories & Thresholds

| Category | Endpoints | Window | Max Hits | Keying Strategy | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `AUTH_LOGIN` | `POST /api/auth/login` | 5 min | 10 | `auth_login:<email\|ip>` | Mitigates credential stuffing & brute-force |
| `AUTH_REGISTER` | `POST /api/auth/register` | 15 min | 10 | `auth_register:<ip>` | Prevents spam account generation |
| `AUTH_GOOGLE` | `POST /api/auth/google` | 5 min | 15 | `auth_google:<ip>` | Prevents Google token validation spam |
| `AUTH_PASSWORD_RESET` | `POST /api/auth/forgot-password`<br>`POST /api/auth/reset-password` | 15 min | 5 | `auth_pw_reset:<email\|ip>` | Prevents email bombarding & reset token brute-force |
| `PAYMENT_CREATE` | `POST /api/payments/razorpay/create-order` | 1 min | 10 | `payment_create:<user\|ip>` | Restricts runaway Razorpay order creation |
| `PAYMENT_VERIFY` | `POST /api/payments/razorpay/verify` | 1 min | 15 | `payment_verify:<user\|ip>` | Allows retry on flaky connection while blocking flood |
| `PAYMENT_FAIL` | `POST /api/payments/razorpay/record-failure` | 1 min | 20 | `payment_fail:<user\|ip>` | Accommodates frequent failure notifications |
| `CUSTOMER_REFUND` | `POST /api/refunds/request` | 15 min | 10 | `cust_refund:<user\|ip>` | Prevents customer refund request abuse |
| `ADMIN_REFUND` | `POST /api/refunds/admin/process` | 1 min | 30 | `admin_refund:<admin\|ip>` | Enables operator throughput while stopping scripts |
| `ORDER_CREATE` | `POST /api/orders` | 10 min | 80 | `order_create:<user\|ip>` | Balances customer shopping and test-suite bursts |
| `ORDER_CANCEL` | `POST /api/orders/:id/cancel` | 15 min | 15 | `order_cancel:<user\|ip>` | Prevents inventory churn via rapid order & cancel |
| `ADMIN_MUTATION` | `PATCH /api/admin/orders/:id/status`<br>`PATCH /api/admin/settings`<br>`POST /api/admin/products` | 1 min | 60 | `admin_mutation:<admin\|ip>` | Protects administrative mutation endpoints |
| `PUBLIC_CATALOG` | `GET /api/products`<br>`GET /api/products/:id` | 1 min | 120 | `public_catalog:<ip>` | Prevents catalog scraping & DoS |
| `WEBHOOK` | `POST /api/payments/razorpay/webhook` | 1 min | 120 | `webhook:<ip\|razorpay>` | High burst tolerance; preserves cloud retry ingress |

### 3.3 Rate Limiting Key Design
- **Authenticated Endpoints**: Key is formed strictly from server-verified authentication context (`req.user._id` or `req.user.id`). User ID provided in request body is **never trusted** for rate-limiting identity.
- **Anonymous Endpoints**: Keyed by client IP (`req.ip` or socket remote address).
- **Isolation**: Quota exhaustion by User A on an IP does not restrict User B on a different authenticated session.

### 3.4 Distributed Deployment Reality
> [!IMPORTANT]
> The current rate limiter is process-memory based (`InMemorySlidingWindowRateLimiter`). In the single-instance backend topology of SV Hub, this provides zero-overhead, highly accurate rate protection.
> 
> **Production Caveat**: If the backend is deployed horizontally across multiple server instances (e.g. AWS ECS, Kubernetes, PM2 cluster), an in-memory limiter cannot synchronize hit counters across instances. A distributed rate-limiting store (such as Redis or Redis Cluster utilizing sliding window sorted sets) MUST be configured prior to multi-instance production deployment.

---

## 4. Security Audit Logging

### 4.1 Data Model
The durable audit log is defined in [`src/models/AuditLog.js`](file:///c:/Users/Venkatesh/svhub/sv/svhub-backend/src/models/AuditLog.js):

```javascript
{
  action: String,          // Action identifier (e.g. PAYMENT_ORDER_CREATED, LOGIN_SUCCESS)
  actorType: String,       // 'CUSTOMER' | 'ADMIN' | 'SYSTEM' | 'GATEWAY' | 'ANONYMOUS'
  actorId: Mixed,          // User _id or identifier
  actorEmail: String,      // User email if known
  resourceType: String,    // 'ORDER' | 'PAYMENT' | 'REFUND' | 'USER' | 'PRODUCT' | 'SETTINGS' | 'WEBHOOK' | 'SYSTEM'
  resourceId: String,      // Safe identifier
  orderId: Mixed,          // Reference to Order
  paymentId: Mixed,        // Reference to Payment
  refundId: Mixed,         // Reference to Refund
  webhookEventId: String,  // Razorpay event ID
  requestId: String,       // Correlated request ID
  ipAddress: String,       // Client IP
  userAgent: String,       // Client browser user agent
  result: String,          // 'SUCCESS' | 'FAILURE' | 'DENIED' | 'BLOCKED'
  reason: String,          // Safe explanation
  metadata: Object,        // Redacted operational context
  createdAt: Date          // Append timestamp
}
```

### 4.2 Database Indexes
- Compound: `{ createdAt: -1 }`
- Compound: `{ action: 1, createdAt: -1 }`
- Compound: `{ actorId: 1, createdAt: -1 }`
- Compound: `{ orderId: 1, createdAt: -1 }`
- Compound: `{ paymentId: 1, createdAt: -1 }`
- Compound: `{ refundId: 1, createdAt: -1 }`
- Compound: `{ requestId: 1 }`

### 4.3 Immutability Protection
`AuditLog` enforces append-only semantics directly in Mongoose schema hooks:
- `pre('updateOne')`, `pre('updateMany')`, `pre('findOneAndUpdate')`, `pre('replaceOne')`: Throws `Error('AuditLog records are append-only and cannot be modified.')`
- `pre('deleteOne')`, `pre('deleteMany')`, `pre('findOneAndDelete')`: Throws `Error('AuditLog records are append-only and cannot be deleted.')`
- `pre('remove')`: Throws `Error('AuditLog records are append-only and cannot be deleted.')`
*(Exception is gated solely by explicit test fixture cleanup flag `allowAuditPurge`).*

---

## 5. Security Redaction Engine

Implemented in [`src/services/auditLogger.js`](file:///c:/Users/Venkatesh/svhub/sv/svhub-backend/src/services/auditLogger.js):
- Recursively scrubs metadata objects up to 5 levels deep.
- Redacts keys matching or containing:
  - `password`, `currentPassword`, `newPassword`, `passwordHash`
  - `token`, `idToken`, `resetToken`, `jwt`
  - `secret`, `keySecret`, `razorpay_key_secret`, `webhookSecret`
  - `authorization`, `cookie`, `cvv`, `cardNumber`, `pan`
- Output: `{ key: '[REDACTED]' }`

---

## 6. Audit Event Catalog

### Authentication
- `REGISTER`: New user registration attempt and outcome.
- `LOGIN_SUCCESS`: Authenticated user session established.
- `LOGIN_FAILURE`: Invalid credentials supplied.
- `GOOGLE_LOGIN`: Google OAuth login attempt and outcome.
- `PASSWORD_RESET_REQUEST`: Password reset link requested.
- `PASSWORD_RESET_SUCCESS`: Password reset completed.
- `LOGOUT`: User session terminated.

### Payments & Gateways
- `PAYMENT_ORDER_CREATED`: Razorpay order generated with amount & currency.
- `PAYMENT_VERIFICATION_SUCCESS`: Server-verified cryptographic HMAC and fulfilled payment.
- `PAYMENT_VERIFICATION_FAILURE`: Signature mismatch or payment verification failure.
- `PAYMENT_FULFILLMENT`: Payment fulfilled with stock deduction and order confirmation.
- `PAYMENT_RECONCILIATION`: Administrative or recovery reconciliation applied.

### Refunds
- `REFUND_REQUESTED`: Customer submitted refund request.
- `REFUND_CREATED`: Refund document initialized in `PENDING` state.
- `REFUND_PROCESSING`: Gateway refund initiated.
- `REFUND_PROCESSED`: Gateway confirmed refund; inventory restored line-by-line.
- `REFUND_FAILED`: Gateway rejected refund attempt.

### Orders
- `ORDER_CREATED`: New order placed by customer.
- `ORDER_CANCELLED`: Customer or admin cancelled order.

### Admin Mutations
- `ADMIN_ORDER_STATUS_CHANGE`: Status transition (e.g. `CONFIRMED` -> `SHIPPED`).
- `ADMIN_ORDER_CANCEL`: Order cancellation with inventory restoration.
- `ADMIN_SETTINGS_CHANGE`: Administrative configuration updated.

### Webhooks
- `INVALID_WEBHOOK_SIGNATURE`: Inbound webhook failed HMAC check.
- `WEBHOOK_DUPLICATE`: Repeated webhook acknowledged idempotently without state mutation.

### Security
- `AUTHORIZATION_DENIED`: Unauthenticated or unauthorized role attempting protected endpoint.
- `RATE_LIMIT_EXCEEDED`: Rate limit quota exceeded (HTTP 429).

---

## 7. Verification & Test Coverage

### Test Results
- **Suite**: `tests/verify-phase2-4g-security.js`
- **Total Assertions**: 53 / 53 PASS

| Section | Description | Assertions | Status |
| :--- | :--- | :--- | :--- |
| **A** | Request Correlation ID (`X-Request-Id` generation, propagation, sanitization) | 6 | PASS |
| **B** | Authentication Rate Limiting (Login, Register, Google, Password Reset, Resets) | 9 | PASS |
| **C** | Payment & Order Rate Limiting (Order create, Payment create, Verify, Cancel, Isolation) | 6 | PASS |
| **D** | Admin Mutation Rate Limiting (Settings flood, standard 429 response) | 2 | PASS |
| **E** | Webhook Burst Tolerance (25 rapid deliveries tolerated, invalid signature rejection) | 3 | PASS |
| **F** | Security Audit Logging (Auth denials, rate limits, logins, orders, webhooks) | 14 | PASS |
| **G** | Sensitive Data Redaction & Immutability (Scrubbing, update rejection, delete rejection) | 4 | PASS |
| **H** | Financial Invariants & Audit Indexing (Zero negative payments, index validation) | 9 | PASS |

### Regression Suite Summary
- Phase 2.1 / 2.2 Payment & Edge Cases: PASS
- Phase 2.3 Delivery Lifecycle: 10 / 10 PASS
- Phase 2.4B Payment Core & Atomic Fulfillment: 54 / 54 PASS
- Phase 2.4C Razorpay Webhooks: 92 / 92 PASS
- Phase 2.4D Recovery & Reconciliation: 80 / 80 PASS
- Phase 2.4E Razorpay Refunds: 100 / 100 PASS
- Phase 2.4E-R Refund Remediation: 41 / 41 PASS
- Phase 2.4F Cancellation & Refund Consistency: 85 / 85 PASS
- Phase 2.4G Rate Limiting & Security Logging: 53 / 53 PASS
- Database Integrity Audit: 19 / 19 PASS
- Frontend Production Build (`vite build`): PASS
- Secret Exposure Audit: Zero credentials leaked

---

## 8. Remaining Limitations & Risks

1. **P2 — Real External Razorpay Webhook Ingress**:
   - Current backend is hosted in a private NAT / local development environment and cannot receive unsolicited ingress traffic from Razorpay's cloud webhook servers.
   - Verified comprehensively via timing-safe synthetic cryptographic HMAC test suites (Section A-L in 2.4C).
   - Real external delivery verification deferred until public staging deployment.
2. **Horizontal Deployment Rate Limiting**:
   - Rate limiting is process-local (`InMemorySlidingWindowRateLimiter`). If deployed to multi-node clusters, Redis-backed rate limiting must be provisioned.

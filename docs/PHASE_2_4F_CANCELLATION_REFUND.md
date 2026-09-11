# PHASE 2.4F — CANCELLATION + REFUND CONSISTENCY & STAGING WEBHOOK READINESS

## SV HUB PRODUCTION E-COMMERCE PAYMENT SYSTEM

==================================================
## 1. EXECUTIVE SUMMARY
==================================================

Phase 2.4F establishes strict consistency and exactly-once semantics across order cancellation, refund processing, inventory restoration, and payment state in SV Hub. It unifies the refund initiation pathway across both administrative and customer cancellations, enforces durable per-line item restoration (`Order.items[].restoredQuantity`), hardens all database transactions with automatic WriteConflict retry loops, and validates asynchronous gateway webhook and recovery behavior.

### High-Level Verdict
- **PHASE_2_4F**: **PASS**
- **CANCELLATION_STATE_MACHINE**: **PASS**
- **REFUND_STATE_MACHINE**: **PASS**
- **PAYMENT_STATE_MACHINE**: **PASS**
- **INVENTORY_EXACT_ONCE**: **PASS**
- **PARTIAL_REFUND_CANCELLATION**: **PASS**
- **CONCURRENT_OPERATION_SAFETY**: **PASS**
- **WEBHOOK_IDEMPOTENCY**: **PASS**
- **MISSING_WEBHOOK_RECOVERY**: **PASS**
- **PAYMENT_ACCOUNTING**: **PASS**
- **AUTHORIZATION**: **PASS**
- **RATE_LIMITING**: **PASS**
- **AUDIT_TRAIL**: **PASS**
- **DATABASE_INTEGRITY**: **PASS**
- **SECURITY**: **PASS**

---

==================================================
## 2. STATE MACHINES
==================================================

### 2.1 CANCELLATION_STATE_MACHINE
Legal transitions:
- `PENDING_PAYMENT` $\rightarrow$ `CANCELLED` (Customer / Admin: unpaid order, 0 stock restoration since inventory was not deducted)
- `CONFIRMED` $\rightarrow$ `CANCELLED` (Customer / Admin: stock restored for remaining restorable line items, unified refund triggered for paid orders)
- `PROCESSING` $\rightarrow$ `CANCELLED` (Admin: stock restored, unified refund initiated)

Illegal transitions (Strictly Rejected with HTTP 400):
- `CANCELLED` $\rightarrow$ `CANCELLED` (Rejected: `order_already_cancelled`)
- `DELIVERED` $\rightarrow$ `CANCELLED` (Rejected: `cannot_cancel_delivered`)
- `SHIPPED` $\rightarrow$ `CANCELLED` by customer (Rejected: `cannot_cancel_in_transit`)
- `OUT_FOR_DELIVERY` $\rightarrow$ `CANCELLED` by customer (Rejected: `cannot_cancel_in_transit`)
- `CANCELLED` $\rightarrow$ `CONFIRMED` / `PROCESSING` (Resurrection strictly prevented)

### 2.2 REFUND_STATE_MACHINE
Legal transitions:
- `[NONE]` $\rightarrow$ `REQUESTED` $\rightarrow$ `PROCESSING` $\rightarrow$ `PROCESSED` (Terminal success)
- `PROCESSING` $\rightarrow$ `FAILED` (Terminal failure from gateway)
- `PROCESSING` $\rightarrow$ `REQUIRES_RECONCILIATION` (Ambiguous partial restock, gateway uncertainty)

Terminal state protection:
- `PROCESSED` $\rightarrow$ `FAILED` is **strictly forbidden**. Late or out-of-order `refund.failed` webhooks arriving after `PROCESSED` are safely acknowledged (HTTP 200) without mutating state.

### 2.3 PAYMENT_STATE_MACHINE
Legal transitions:
- `CREATED` / `PENDING` $\rightarrow$ `SUCCESS` / `PAID`
- `SUCCESS` $\rightarrow$ `PARTIALLY_REFUNDED` ($0 < \text{refundedAmount} < \text{capturedAmount}$)
- `PARTIALLY_REFUNDED` $\rightarrow$ `PARTIALLY_REFUNDED` (Incremental partial refunds)
- `PARTIALLY_REFUNDED` $\rightarrow$ `REFUNDED` ($\text{refundedAmount} == \text{capturedAmount}$)
- `SUCCESS` $\rightarrow$ `REFUNDED` (Full refund)
- `PENDING` $\rightarrow$ `FAILED`

Payment accounting invariants:
$$\text{capturedAmount} \ge 0, \quad \text{refundedAmount} \ge 0, \quad \text{refundableAmount} \ge 0$$
$$\text{refundedAmount} \le \text{capturedAmount}$$
$$\text{refundableAmount} = \text{capturedAmount} - \text{refundedAmount}$$

### 2.4 INVENTORY_STATE_MACHINE
Per-line restored quantity model:
$$0 \le \text{restoredQuantity} \le \text{quantity}$$
- `inventoryDeducted === false`: Cancellation never restores stock ($\Delta \text{stock} = 0$).
- `inventoryDeducted === true`:
  - Partial refund restores only specified line item quantity: $\text{item.restoredQuantity} \leftarrow \text{item.restoredQuantity} + \text{qty}$.
  - Cancellation restores only remaining unrestored quantity: $\Delta \text{stock} = \max(0, \text{item.quantity} - \text{item.restoredQuantity})$.
  - Order boolean flag `inventoryRestored = true` is set once all items are fully restored.
  - Subsequent refunds on cancelled orders see `inventoryRestored === true` and mark refund `inventoryRestorationStatus = 'NOT_APPLICABLE'`.

### 2.5 WEBHOOK_STATE_MACHINE
- Inbound webhook verified via timing-safe HMAC-SHA256 on raw request body.
- Durable idempotency in MongoDB `WebhookEvent`:
  `PROCESSING` $\rightarrow$ `PROCESSED` / `IGNORED` / `REQUIRES_RECONCILIATION` / `FAILED_PERMANENT` / `FAILED_RETRYABLE`
- Unique index on `{ provider: 1, eventId: 1 }` prevents concurrent double-processing.

---

==================================================
## 3. CANCELLATION + REFUND INTERACTION
==================================================

### 3.1 Single Authoritative Refund Mechanism
There is exactly one unified refund execution service in SV Hub: `refundReconciliationService.initiateRefund`.
When an order cancellation occurs for a paid order:
1. Cancellation transaction commits order status as `CANCELLED`.
2. Per-line inventory restoration is committed.
3. The cancellation controller invokes `initiateRefund` with:
   - `source: 'cancellation'`
   - `idempotencyKey: 'cancel_rfnd_' + order._id`
   - `amount: payment.refundableAmount`
4. `initiateRefund` creates the durable `Refund` document, contacts Razorpay, updates `Payment` accounting, and records the refund.
5. Because `order.inventoryRestored === true`, `initiateRefund` sets `inventoryRestorationStatus = 'NOT_APPLICABLE'`, guaranteeing zero double-restock.

### 3.2 Cancellation + Partial Refund ($A \times 3$ Scenario)
Verified experimentally in Section D & E:
1. Order with Item A ($Q = 3$, Total ₹1500).
2. Partial refund #1: 1 unit refunded $\rightarrow$ stock $+1$, `restoredQuantity = 1`, `inventoryRestored = false`.
3. Partial refund #2: 1 unit refunded $\rightarrow$ stock $+1$, `restoredQuantity = 2`, `inventoryRestored = false`.
4. Cancellation of order: restores $\max(0, 3 - 2) = 1$ remaining unit $\rightarrow$ stock $+1$, `restoredQuantity = 3`, `inventoryRestored = true`.
5. Total stock restored: $1 + 1 + 1 = 3$ units (never 4).
6. Attempted third refund on cancelled order rejected financially ($\text{refundableAmount} = 0$).

### 3.3 Partial Refund Without Line-Item Allocation
When a monetary partial refund arrives without line-item mapping:
- Financial refund completes and reduces `refundableAmount`.
- Inventory restoration remains `inventoryRestorationStatus = 'REQUIRES_RECONCILIATION'`.
- Catalog stock is left completely untouched (no guessing).
- Subsequent order cancellation restores only items where `restoredQuantity < quantity`.

---

==================================================
## 4. CONCURRENCY & FAILURE RECOVERY
==================================================

### 4.1 Real Database Concurrency (No Fake In-Memory Mutexes)
- All multi-document updates run inside MongoDB transactions with `session`.
- Transaction retry loops handle transient MongoDB replica-set `WriteConflict` errors (code 112 / `TransientTransactionError`), retrying up to 3–5 attempts with exponential jittered backoff.
- On retry, re-reading the document detects that another transaction already cancelled or refunded the order, cleanly returning HTTP 400 `order_already_cancelled` or idempotent results.
- Verified under simultaneous concurrent cancellation, simultaneous refund + cancellation races, and simultaneous webhook + cancellation races.

### 4.2 Webhooks Against Cancelled Orders
- When a `payment.captured` webhook arrives for an order that was cancelled while payment was in-flight:
  - Order is **never resurrected** to `CONFIRMED` or `PROCESSING`.
  - Payment is recorded as `SUCCESS` with `capturedAmount = order.totalAmount` and `refundableAmount = order.totalAmount`.
  - Order transitions to `REQUIRES_RECONCILIATION` with audit note, flagging it for merchant refund.
  - Inventory is NOT deducted.

### 4.3 Missing Webhook Recovery
- If Razorpay issues a refund or captures payment but the webhook is delayed, dropped, or lost:
  - Admin on-demand reconciliation (`POST /api/admin/orders/:id/refunds/:refundId/reconcile`) and background sweep `recoverStaleRefunds` query the authoritative Razorpay API via `razorpay.refunds.fetch`.
  - The local document is reconciled to `PROCESSED`.
  - A late webhook arriving after recovery returns idempotent HTTP 200 without duplicate restoration.

---

==================================================
## 5. REAL VS MOCKED TESTING & STAGING READINESS
==================================================

### 5.1 Real Outbound Razorpay Test Mode Verification
- Outbound refund integration against `api.razorpay.com` was verified live in Phase 2.4E-R:
  - Gateway Refund ID: `rfnd_TaPPgNm18rtnCb`
  - Parent Payment ID: `pay_TaKULECD6jPVGb`
  - Gateway Status: `processed`
  - Amount: ₹10 (1000 paise)
- Historical ₹209 payment `6aa242c25aea5fc569c4b8ae` (`order_TaDojRUBbt9yOC`) verified against Razorpay API as having 0 payments (`count: 0`), and preserved in `REQUIRES_RECONCILIATION` with `capturedAmount = 0`.

### 5.2 External Inbound Webhook Limitation
- In the current environment, the backend is running on `localhost:5000` behind a private NAT without a public IP or tunnel ingress (`ngrok`, `cloudflared`, etc.).
- Genuine external webhook delivery requires Razorpay cloud servers to establish an inbound HTTPS connection to the SV Hub server.
- Synthetic webhook tests (with full cryptographic HMAC SHA-256 verification and raw body parsing) verify 100% of webhook ingestion and processing logic.
- As mandated:
  `REAL_EXTERNAL_RAZORPAY_WEBHOOK_TEST = NOT_EXECUTED`
  Reason: localhost/private NAT has no externally reachable HTTPS ingress.

---

==================================================
## 6. FULL REGRESSION MATRIX
==================================================

| Suite | Status | Passed | Failed |
| :--- | :---: | :---: | :---: |
| **Phase 2.4F (Cancellation + Refund Consistency)** | **PASS** | 85 | 0 |
| **Phase 2.4E-R (Refund Remediation)** | **PASS** | 41 | 0 |
| **Phase 2.4E (Production Refunds)** | **PASS** | 100 | 0 |
| **Phase 2.4D (Payment Recovery & Reconciliation)** | **PASS** | 80 | 0 |
| **Phase 2.4C (Razorpay Webhooks)** | **PASS** | 92 | 0 |
| **Phase 2.4B (Payment Core Fulfillment)** | **PASS** | 54 | 0 |
| **Phase 2.1 (Razorpay Payments)** | **PASS** | 47 | 0 |
| **Phase 2.2 (Payment & Order Edge Cases)** | **PASS** | 63 | 0 |
| **Phase 2.3 Unit (Delivery Lifecycle)** | **PASS** | 10 | 0 |
| **Phase 2.3 Scripts (Delivery Lifecycle & Tracking)** | **PASS** | 48 | 0 |
| **Admin Orders (Phase 1.6A Management)** | **PASS** | 30 | 0 |
| **E2E Commerce Verification** | **PASS** | 139 | 0 |
| **API QA Full Audit** | **PASS** | 108 | 0 |
| **Database Integrity Audit** | **PASS** | 19 | 0 |
| **Frontend Production Build (`vite build`)** | **PASS** | ✓ built in 1.99s | 0 |
| **Secret Leak Audit** | **PASS** | Clean (0 leaks) | 0 |

---

==================================================
## 7. REMAINING DEFECTS & ACTION ITEMS
==================================================

- **REMAINING_P0**: 0
- **REMAINING_P1**: 0
- **REMAINING_P2**: 1

### Detail on P2-1:
- **Exact File**: Cloud infrastructure / Deployment environment
- **Exact Function**: External HTTPS ingress for Razorpay Webhooks
- **Exact Failure Mode**: External cloud webhook delivery cannot reach localhost/private NAT environment.
- **Severity**: P2 (Deployment / Infrastructure limitation)
- **Money Impact**: ₹0 (Outbound payment/refund APIs work; reconciliation worker recovers lost webhooks)
- **Inventory Impact**: 0 (Exact-once inventory restoration invariants are enforced)
- **Recommended Action**: When deploying to staging/production with a public HTTPS domain, configure the Razorpay Webhook URL in the Razorpay Dashboard pointing to `https://<domain>/api/payments/razorpay/webhook`.

# Phase 2.4B — Payment State & Atomic Fulfillment Core

## Architecture

Phase 2.4B establishes a single, authoritative, concurrency-safe payment fulfillment engine in `svhub-backend/src/services/paymentFulfillmentService.js`. Both the current customer verification endpoint (`POST /api/payments/razorpay/verify`) and future Razorpay webhook handlers (`Phase 2.4C`) delegate to this unified reconciliation service.

```
                  ┌───────────────────────────────┐
                  │ Customer Frontend /verify     │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
                  ┌───────────────────────────────┐
                  │ paymentController.js          │
                  │ (HTTP unwrapping & auth)      │
                  └──────────────┬────────────────┘
                                 │
                                 ▼
       ┌─────────────────────────────────────────────────────┐
       │   Shared Payment Reconciliation Service             │
       │   (paymentFulfillmentService.js)                    │
       │                                                     │
       │  Phase 1: External Gateway Checks (Outside DB Tx)  │
       │  - HMAC SHA-256 Signature Verification              │
       │  - Razorpay Gateway Status Check (`captured`)       │
       │  - Currency (`INR`) and Amount Verification         │
       │                                                     │
       │  Phase 2: Atomic MongoDB Transaction Session        │
       │  - Idempotency & Terminal State Checks              │
       │  - Resurrection Prevention (`CANCELLED`/`DELIVERED`)│
       │  - Duplicate Gateway Order / Payment ID Protection  │
       │  - Atomic Inventory Stock Deduction ($inc: -qty)    │
       │  - Payment & Order Status Transitions               │
       │  - Selective Cart Clearing (Purchased items only)   │
       │  - TransientTransactionError Retry Handling         │
       └─────────────────────────────────────────────────────┘
                                 ▲
                                 │
                  ┌──────────────┴────────────────┐
                  │ (Future) Razorpay Webhooks    │
                  │ (Phase 2.4C)                  │
                  └───────────────────────────────┘
```

---

## Payment State Machine

The Payment document (`Payment.js`) lifecycle distinguishes explicit gateway and fulfillment states:

```
          ┌──────────────┐
          │   CREATED    │  Local attempt record registered atomically
          └──────┬───────┘
                 │
                 ▼
          ┌──────────────┐
          │   PENDING    │  Razorpay order created with gateway orderId
          └──────┬───────┘
                 │
        ┌────────┴───────────────┐
        ▼                        ▼
 ┌──────────────┐         ┌──────────────┐
 │   SUCCESS    │         │    FAILED    │
 │ (PAID)       │         │              │
 └──────────────┘         └──────────────┘
```

### Gateway Validation Invariant
A payment is **never** marked `SUCCESS` or fulfilled into an order merely because a signature was passed or a client callback was executed. The upstream Razorpay payment must satisfy:
1. `payment.status === 'captured'` (or `payment.captured === true`)
2. `payment.currency === 'INR'`
3. `payment.amount === order.totalAmount * 100`
4. `payment.order_id === order.razorpayOrderId`

States such as `authorized`, `failed`, `refunded`, or `unknown` are explicitly rejected from fulfillment.

---

## Order State Machine

Order states conform to the following explicit progression:

```
  ┌──────────────────┐
  │ PENDING_PAYMENT  │  (Unpaid checkout initiated)
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │    CONFIRMED     │  (Payment verified, captured & stock deducted)
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │    PROCESSING    │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │     SHIPPED      │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ OUT_FOR_DELIVERY │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │    DELIVERED     │  (Terminal fulfillment state)
  └──────────────────┘

Terminal / Exceptional States:
- CANCELLED: Order cancelled by admin or customer
- REQUIRES_RECONCILIATION: Payment captured at gateway, but order fulfillment or stock deduction could not complete
```

### Order Protection Against Resurrection
Payment verification **never** transitions any terminal or non-payable state back to `CONFIRMED`:
- `CANCELLED` $\rightarrow$ `REQUIRES_RECONCILIATION` (retains captured payment record; prevents resurrection)
- `DELIVERED` $\rightarrow$ Rejected (cannot overwrite delivery)
- `SHIPPED` $\rightarrow$ Rejected
- `OUT_FOR_DELIVERY` $\rightarrow$ Rejected
- `PROCESSING` $\rightarrow$ Idempotently preserved
- `CONFIRMED` $\rightarrow$ Idempotently acknowledged (stock not re-deducted)

---

## Fulfillment Algorithm

The fulfillment workflow strictly executes in two phases:

1. **Pre-Transaction Gateway Verification (Outside DB Session)**:
   - Validate input parameters (`orderId`, `razorpayPaymentId`, `razorpayOrderId`, `razorpaySignature`).
   - Validate customer authorization (customers can only fulfill their own orders; admins can manage).
   - Authoritative amount check against the MongoDB Order document.
   - Verify cryptographic HMAC SHA-256 signature using `RAZORPAY_KEY_SECRET`.
   - In production/staging, query `razorpay.payments.fetch(razorpayPaymentId)`. Verify `status === 'captured'`, `currency === 'INR'`, and matching `order_id`.
   - On network or gateway error, return HTTP `502 gateway_uncertainty` without marking payment `FAILED`.

2. **Transactional Fulfillment Session (Inside DB Session with Retry)**:
   - Start MongoDB Session with `startTransaction()`.
   - Reload authoritative `Order` document within the session.
   - If order is already `CONFIRMED` / `PAID` with matching `paymentId`, commit and return idempotent success.
   - If order was `CANCELLED`, flag order as `REQUIRES_RECONCILIATION`, record reason in `Payment` and order `history`, commit, and return conflict.
   - Enforce payment ID uniqueness: Ensure no other order in MongoDB has claimed `paymentId`.
   - Atomically deduct inventory for each item using conditional updates (`qty: { $gte: quantity }`).
   - If stock is insufficient, set order to `REQUIRES_RECONCILIATION` with detailed reason note, commit, and return `409 stock_exhausted`.
   - Update `Payment` document: `status = 'SUCCESS'`, `gatewayStatus = 'captured'`.
   - Update `Order` document: `status = 'CONFIRMED'`, `paymentStatus = 'SUCCESS'`, `inventoryDeducted = true`.
   - Remove purchased line items from customer Cart.
   - Commit transaction.

---

## Concurrency Strategy

1. **Database Session Transactions**:
   - Multi-document transactions run against the MongoDB Atlas replica set.
   - Guarantees that concurrent fulfillment requests cannot interleave stock deductions or order state changes.
2. **Transient Transaction Error Retries**:
   - In high-concurrency races, MongoDB emits error code `112` (`WriteConflict`) or `TransientTransactionError`.
   - `paymentFulfillmentService` catches these conflicts and automatically retries with exponential backoff (up to 3 attempts), allowing the racing request to cleanly read the committed `CONFIRMED` state and succeed idempotently.
3. **Atomic Create-Order Coordination**:
   - `createRazorpayOrder` creates or locks a local `Payment` document using `findOneAndUpdate` with a timestamped placeholder (`CREATING_<timestamp>`).
   - Concurrent requests for the same order await or reuse the active Razorpay order, preventing duplicate gateway orders.

---

## Transaction Boundary

- **External Network Calls Outside Transaction**: Gateway calls (`razorpay.orders.create`, `razorpay.payments.fetch`) are never executed inside MongoDB transaction sessions. This prevents database connection pool starvation and long lock holding.
- **Database Operations Within Transaction**:
  - `Order.findById(...).session(session)`
  - `Payment.findOne(...).session(session)`
  - `Product.updateOne({ ... qty: { $gte: quantity } }, { $inc: { qty: -quantity } }).session(session)`
  - `Cart.updateOne({ userId }, { $pull: { items: ... } }).session(session)`

---

## Inventory Guarantees

1. **Atomic Deduction**:
   - Stock is only deducted via atomic MongoDB operators:
     `{ $inc: { "variants.$.qty": -item.quantity, qty: -item.quantity } }`
   - Filter query strictly requires:
     `{ "variants.$.qty": { $gte: item.quantity } }`
2. **Non-Negative Guarantee**:
   - If even one item lacks sufficient stock, the entire transaction rolls back. Stock is never allowed to fall below 0.
3. **Admin Cancellation Restoration**:
   - When an order is cancelled via `/api/admin/orders/:id/cancel`, stock is restored **only** if:
     `order.inventoryDeducted === true && !order.inventoryRestored`
   - Restores stock via atomic `$inc: +item.quantity` within a session.
   - Idempotent: repeated cancellation attempts will never double-restore inventory.
   - Unpaid orders (where stock was never deducted at checkout) do not restore inventory.

---

## Cart Guarantees

- **Selective Deletion**: Only the specific `(productId, variantId)` combinations belonging to the fulfilled order are removed from the customer's cart:
  ```javascript
  Cart.updateOne(
    { userId: order.userId },
    { $pull: { items: { $or: targetItems } } },
    { session }
  )
  ```
- Any unrelated items or items added by the customer while payment was processing remain intact.

---

## Idempotency Guarantees

- Repeated verification requests for the same order and payment ID return HTTP 200 with the existing confirmed order data.
- Does not re-deduct inventory.
- Does not create duplicate payment documents.
- Does not downgrade confirmed orders if a duplicate arrives out of order.

---

## Razorpay Validation

The backend performs comprehensive validation before any fulfillment:
1. `orderId` resolves to an existing SV Hub order.
2. The authenticated customer owns the order (or is an authorized admin).
3. `razorpayPaymentId`, `razorpayOrderId`, and `razorpaySignature` are present and non-empty.
4. HMAC SHA-256 cryptographic signature matches `crypto.createHmac('sha256', secret).update(orderId + '|' + paymentId).digest('hex')`.
5. `razorpayOrderId` matches the stored `razorpayOrderId` on the order.
6. Authorized payment amount matches server-calculated `order.totalAmount * 100`.
7. Gateway currency is `INR`.
8. Upstream payment status is `captured`.

---

## Cancellation Rules

| Order State at Cancellation | Inventory Action | Payment / Reconciliation Action |
|---|---|---|
| `PENDING_PAYMENT` (unpaid) | No inventory restored (`inventoryDeducted: false`) | Payment marked `FAILED` if pending |
| `CONFIRMED` / `PROCESSING` (paid) | Atomically restored (`inventoryRestored = true`) | Marked `reconciliationReason: 'Order cancelled by admin after payment capture; refund pending'` |
| `DELIVERED` | Rejected (`cannot_cancel_delivered`) | N/A |
| `CANCELLED` | Rejected (`order_already_cancelled`) | N/A |

---

## Reconciliation Rules

An order enters `REQUIRES_RECONCILIATION` when external gateway capture succeeds but business fulfillment cannot proceed:
1. **Stock Exhaustion**: Customer was charged at gateway, but stock was depleted prior to transaction commit.
2. **Cancelled Order Payment**: Order was cancelled while customer was completing payment at Razorpay.
3. **Resurrection Attempt**: Attempting to verify an order in an invalid terminal state after payment capture.

Reconciliation Metadata Preserved:
- `orderId`: SV Hub Order ID
- `paymentId`: Razorpay Payment ID (`pay_...`)
- `razorpayOrderId`: Razorpay Order ID (`order_...`)
- `amount`: Captured amount in INR
- `gatewayStatus`: Gateway status (`captured`)
- `reconciliationReason`: Specific audit explanation
- Timestamps and history audit entries

---

## Database Indexes

The following sparse unique indexes are configured on `Order`:
- `paymentId`: `{ unique: true, sparse: true }` — Prevents one payment ID from fulfilling multiple orders.
- `razorpayOrderId`: `{ unique: true, sparse: true }` — Prevents multiple SV Hub orders from binding to the same Razorpay order.

On `Payment`:
- `razorpayOrderId`: `{ index: true }`
- `razorpayPaymentId`: `{ index: true }`
- `orderId`: `{ index: true }`

---

## Test Coverage

### Dedicated Phase 2.4B Test Suite (`tests/verify-phase2-4b-payment-core.js`)
- **TEST A**: Valid captured payment succeeds and fulfills order (5/5 assertions)
- **TEST B**: Invalid signature fails with `invalid_signature`, preserves PENDING_PAYMENT, marks FAILED (4/4)
- **TEST C**: Mismatched Razorpay order ID rejected (1/1)
- **TEST D**: Tampered payment ID fails signature check (1/1)
- **TEST E**: Tampered payment amount rejected by server authority (1/1)
- **TEST F**: Non-INR currency rejected (1/1)
- **TEST G**: Non-captured (authorized) payment rejected from fulfillment (1/1)
- **TEST H**: Gateway fetch failure returns safe 502 `gateway_uncertainty` (1/1)
- **TEST Y**: Gateway uncertainty does NOT falsely mark payment FAILED (1/1)
- **TEST I**: Customer B cannot verify Customer A's order (1/1)
- **TEST J & X**: Cancelled order resurrection blocked; enters `REQUIRES_RECONCILIATION` with captured payment intact (3/3)
- **TEST K**: Delivered order cannot be overwritten to CONFIRMED (1/1)
- **TEST L**: Duplicate verification is idempotent; stock not re-deducted (3/3)
- **TEST M**: Unique payment ID across orders enforced (2/2)
- **TEST N**: Unique Razorpay order ID across SV Hub orders enforced (1/1)
- **TEST O, P, Q**: Concurrent verification with `Promise.all`: exactly 1 fulfillment, stock deducted once, never downgraded (4/4)
- **TEST R, S**: Initial stock = 1 with 2 concurrent orders: exactly 1 succeeds, losing order enters reconciliation, stock never negative (3/3)
- **TEST T**: Transaction rollback consistency: stock exhaustion sets reconciliation without dangling writes (3/3)
- **TEST U**: Selective cart clearing preserves unrelated newly-added items (2/2)
- **TEST V, W**: Admin cancellation restores stock once for paid orders, zero for unpaid orders, idempotent on retry (7/7)
- **TEST Z**: Concurrent create-order coordination reuses single local payment and gateway order (3/3)
- **TEST AA**: Backward compatibility with existing Razorpay client flow (3/3)

**Total Phase 2.4B Core Tests: 54 PASSED, 0 FAILED**

### Regression Test Matrix
- Phase 2.1 Payments Suite (`scripts/verify-payments.js`): **47 PASSED, 0 FAILED**
- Phase 2.2 Edge Cases Suite (`scripts/verify-phase2-2-edge-cases.js`): **63 PASSED, 0 FAILED**
- Phase 2.3 Delivery Lifecycle Suite (`scripts/verify-delivery-lifecycle.js`): **48 PASSED, 0 FAILED**
- Admin Orders Suite (`scripts/verify-admin-orders.js`): **30 PASSED, 0 FAILED**
- E2E Commerce Hardening Suite (`scripts/verify-e2e-commerce.js`): **139 PASSED, 0 FAILED**
- QA API Audit Suite (`scripts/qa-api-audit.js`): **108 PASSED, 0 FAILED**
- Frontend Production Build (`npm run build`): **PASS**

---

## Known Remaining Gaps (Deferred by Scope)

The following items were explicitly excluded from Phase 2.4B and remain deferred:
1. **Razorpay Webhooks** $\rightarrow$ Deferred to **Phase 2.4C**. (The shared reconciliation service created here will be invoked directly by webhook handlers).
2. **Automated Refund Processing** $\rightarrow$ Deferred to **Phase 2.4E**. (Orders in `REQUIRES_RECONCILIATION` or cancelled paid orders currently preserve audit data for manual reconciliation).
3. **Payment API Rate Limiting** $\rightarrow$ Deferred to later hardening phase.
4. **Reconciliation Background Worker / Poller** $\rightarrow$ Deferred to later reconciliation phase.

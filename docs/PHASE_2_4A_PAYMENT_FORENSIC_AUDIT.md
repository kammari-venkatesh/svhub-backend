# Phase 2.4A — Razorpay Payment Forensic Audit

**Audit Date:** September 2026  
**Auditor:** Antigravity Payment & Security Engineering Team  
**Audit Target:** SV Hub Production E-Commerce Payment Architecture (React, Node.js, Express, MongoDB, Mongoose, Razorpay)  
**Audit Scope:** Read-Only Forensic Analysis of Payment Security, Concurrency, Idempotency, Database Invariants, State Machines, Gateways, and Failure Recovery.  
**Operating Rules Enforced:** Zero modifications to application source code, zero database modifications, zero environment variable changes, zero package installations, zero destructive actions.

---

## 1. Executive Summary

SV Hub has established an initial functional baseline for Razorpay Test Mode payments in Phase 2.1. The implementation incorporates foundational security practices:
1. **Server-Side Price Authority:** Cart totals and payment creation amounts are derived from MongoDB documents rather than client input.
2. **Cryptographic Signature Verification:** `POST /api/payments/razorpay/verify` uses HMAC SHA-256 with `crypto.timingSafeEqual` over `${serverOrderId}|${paymentId}`.
3. **Decoupled Financial Audit Trail:** Payment transactions are recorded in a dedicated `payments` collection.
4. **Isolated Cart Clearing:** The customer's cart is preserved during checkout initialization and cleared only upon verified payment confirmation.
5. **Basic Idempotency:** Re-submitting the exact same verify payload on a confirmed order returns an idempotent HTTP 200 without re-decrementing inventory.

However, forensic inspection of the codebase reveals **critical architectural gaps, concurrency race conditions, and missing distributed guarantees** that make the current payment system **UNSAFE FOR REAL-MONEY PRODUCTION TRAFFIC**:

- **P0-1: Missing Razorpay Webhook Engine (`WEBHOOK SUPPORT: MISSING`).** There is no webhook endpoint, no webhook signature verification, no event logging, and no handling for asynchronous gateway events (`payment.captured`, `payment.failed`, `refund.processed`). If a customer closes their browser, experiences a network dropout after completing a payment on UPI/Netbanking, or if the client fails to reach `POST /api/payments/razorpay/verify`, **the customer's bank account is debited, Razorpay captures the funds, but SV Hub leaves the order in `PENDING_PAYMENT` indefinitely with zero stock deducted and zero fulfillment.**
- **P0-2: Concurrent Verification Race Condition & Double Stock Deduction (TOCTOU).** `POST /api/payments/razorpay/verify` relies on an in-memory JavaScript check (`if (order.status === 'CONFIRMED')`) without atomic database-level row locking or conditional compare-and-set state transitions (`findOneAndUpdate({ _id, status: 'PENDING_PAYMENT' }, { $set: { status: 'CONFIRMING' } })`). Two concurrent requests for the same order (rapid double-click, duplicate network callback, or multi-tab submission) both pass the check, execute `deductOrderInventory`, and **double-deduct stock from the warehouse**. If stock is exhausted on the second thread, the second thread overwrites the already confirmed order to `REQUIRES_RECONCILIATION` and marks payment `FAILED`, corrupting confirmed order state!
- **P0-3: Upstream Capture Status Never Verified & Gateway Fetch Silently Swallowed.** In `paymentController.js` (lines 313–349), `razorpay.payments.fetch` is wrapped in a try/catch that silently swallows all errors unless an undocumented `STRICT_RZP_FETCH === 'true'` environment variable is set. More critically, even when the payment object is fetched, **the code NEVER checks `rzpPayment.status === 'captured'` or `rzpPayment.captured === true`**. An `authorized` (uncaptured) or pending payment is treated as fully fulfilled based solely on client callback parameters!
- **P0-4: Absence of Automated Refunds (`REFUNDS: NOT IMPLEMENTED`).** There is no refund API, no refund model, no integration with `razorpay.payments.refund()`, and no webhook listener. When an inventory conflict occurs (`REQUIRES_RECONCILIATION`) or when an admin cancels an order after payment, **funds remain trapped in the merchant's Razorpay account with zero automated mechanism to return money to the customer.**
- **P0-5: Resurrection of Cancelled or Delivered Orders via Payment Verification.** `verifyRazorpayPayment` only checks `if (order.status === 'CONFIRMED')`. It fails to validate whether `order.status === 'CANCELLED'`, `order.status === 'DELIVERED'`, or `order.status === 'PROCESSING'`. If an admin cancels an unpaid order and the customer subsequently triggers payment verification, the system verifies the signature, deducts inventory, and transitions the cancelled order back to `CONFIRMED`.
- **P0-6: Non-Atomic Distributed Multi-Document Writes without Session Coordination.** In `verifyRazorpayPayment`, inventory deduction (`deductOrderInventory`), payment record update (`payment.save()`), order confirmation (`order.save()`), and cart clearing (`Cart.updateOne()`) are executed as four separate, uncoordinated database operations. If the server process crashes or MongoDB connectivity drops between these operations, the system is left in a corrupted state (e.g., inventory deducted but order unpaid, or payment marked SUCCESS but order left in `PENDING_PAYMENT`).
- **P0-7: Complete Lack of Rate Limiting & Abuse Protection.** All payment endpoints (`/api/payments/razorpay/create-order`, `/api/payments/razorpay/verify`, `/api/payments/razorpay/record-failure`) lack rate limiting. Any authenticated user can flood upstream Razorpay APIs, exhaust connection pools, trigger gateway HTTP 429 throttling for the entire domain, or perform denial-of-service attacks against backend cryptographic HMAC routines.

---

## 2. Architecture Map

```
+---------------------------------------------------------------------------------------------------------+
|                                           CLIENT BROWSER (REACT 19)                                    |
|                                                                                                         |
|  [CartContext.jsx] <----------> [Checkout.jsx] <----------> [lib/razorpay.js]                           |
|         |                              |                           |                                    |
|   (Preserves Cart                      |                           v                                    |
|    Until Confirmed)                    |               [checkout.razorpay.com/v1/checkout.js]           |
|                                        |                           |                                    |
+----------------------------------------|---------------------------|------------------------------------+
                                         |                           |
                             HTTP REST   |                           | Gateway Modal
                              with JWT   |                           | Interactions
                                         v                           v
+--------------------------------------------------------------------+------------------------------------+
|                                    EXPRESS APPLICATION SERVER                                          |
|                                                                                                         |
|  Middleware:                                                                                            |
|   - requestLogger.js (Logs method, path, status, duration)                                              |
|   - express.json({ limit: '1mb' }) (Global JSON parser; WARNING: consumes raw body needed for webhooks) |
|   - requireAuth.js (Enforces Bearer JWT verification)                                                   |
|   - requireAdmin.js (Role-based access check for administrative routes)                                |
|                                                                                                         |
|  Routes & Controllers:                                                                                  |
|   - POST /api/orders                                    -> orderController.js:createOrder               |
|   - POST /api/payments/razorpay/create-order            -> paymentController.js:createRazorpayOrder     |
|   - POST /api/payments/razorpay/verify                   -> paymentController.js:verifyRazorpayPayment   |
|   - POST /api/payments/razorpay/record-failure          -> paymentController.js:recordPaymentFailure    |
|   - PATCH /api/admin/orders/:id                         -> adminOrderController.js:updateAdminOrder     |
|   - POST /api/admin/orders/:id/cancel                   -> adminOrderController.js:cancelAdminOrder     |
|                                                                                                         |
|  External Gateway Integration:                                                                          |
|   - config/razorpay.js (Razorpay Node.js SDK instance, HMAC SHA-256 signature verification)             |
|                                                                                                         |
|  Inventory Engine:                                                                                      |
|   - utils/inventory.js:deductOrderInventory (Atomic MongoDB update with fallback rollback loop)         |
+--------------------------------------------------------------------+------------------------------------+
                                         |                           |
                         Mongoose ODM    |                           | Upstream REST API
                          Read / Write   |                           | (orders.create, payments.fetch)
                                         v                           v
+----------------------------------------+-------------------+       +------------------------------------+
|               MONGODB DATABASE                             |       |          RAZORPAY GATEWAY          |
|                                                            |       |                                    |
|  Collections:                                              |       |  - Orders API                      |
|   - orders (Order documents, status, snapshot items)       |       |  - Payments API                    |
|   - payments (Audit records, razorpayOrderId, signatures)  |       |  - Standard Checkout Modal         |
|   - products (Product catalog, variant-level qty)          |       |  - Webhook Events (NOT CONNECTED!) |
|   - carts (Customer cart items, unique per userId)         |       |                                    |
|   - users, addresses, settings, counters                   |       +------------------------------------+
+------------------------------------------------------------+
```

---

## 3. Current Payment Flow

### 3.1 Step-by-Step Flow Trace

```
1. Customer initiates checkout in React UI (`Checkout.jsx`).
2. `handlePay()` validates delivery address and form fields.
3. Client issues `POST /api/orders` with delivery details.
   ├── Backend validates live catalog prices and stock availability.
   ├── Sequential order number `#SVH-XXXX` is generated atomically via `Counter`.
   ├── Order document created: `status: 'PENDING_PAYMENT'`, `paymentStatus: 'PENDING'`.
   └── Stock is NOT deducted; Cart is NOT cleared.
4. Client loads `https://checkout.razorpay.com/v1/checkout.js` via `loadRazorpayScript()`.
5. Client issues `POST /api/payments/razorpay/create-order` with `{ orderId }`.
   ├── Backend verifies order exists, belongs to authenticated user, and is `PENDING_PAYMENT`.
   ├── Backend checks for existing `Payment` in `CREATED` or `PENDING` state to reuse.
   ├── If none exists:
   │    ├── Computes integer paise: `Math.round(order.totalAmount * 100)`.
   │    ├── Calls upstream `razorpay.orders.create({ amount, currency: 'INR', ... })`.
   │    ├── Creates MongoDB `Payment` document: `status: 'CREATED'`, `razorpayOrderId`.
   │    └── Updates MongoDB `Order`: `order.razorpayOrderId`, `order.paymentMethod = 'razorpay'`.
   └── Returns `{ keyId, razorpayOrderId, amount, currency: 'INR', customer }` to client.
6. Client initializes `new window.Razorpay(options)` and calls `rzpInstance.open()`.
7. Customer completes payment on Razorpay modal.
8. Razorpay executes client-side callback `options.handler(response)` with:
   `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }`.
9. Client issues `POST /api/payments/razorpay/verify`.
   ├── Backend verifies user ownership of order.
   ├── Backend loads server `Payment` document matching `orderId` and `razorpay_order_id`.
   ├── Backend checks client `razorpay_order_id === payment.razorpayOrderId`.
   ├── Backend checks idempotency: if order already `CONFIRMED` and payment verified, returns 200 `{ idempotent: true }`.
   ├── Backend verifies HMAC SHA-256 signature using server-stored `payment.razorpayOrderId`.
   ├── Backend optionally fetches payment from Razorpay API (errors silently swallowed).
   ├── Backend calls `deductOrderInventory(order.items)`:
   │    ├── If stock check fails: marks `order.status = 'REQUIRES_RECONCILIATION'`, returns 409.
   │    └── If stock deducted successfully: proceeds to confirmation.
   ├── Backend updates `Payment`: `status = 'SUCCESS'`, `verified = true`, `razorpayPaymentId`.
   ├── Backend updates `Order`: `status = 'CONFIRMED'`, `paymentStatus = 'SUCCESS'`, `paymentId`.
   └── Backend clears MongoDB Cart: `Cart.updateOne({ userId }, { $set: { items: [] } })`.
10. Client receives verification response, invokes `clearCart()` in `CartContext`, writes `sessionStorage.setItem('svhub.lastOrder', ...)`, and navigates to `/order-success`.
```

### 3.2 Data Field Read/Write Matrix

| Field Name | Read Locations | Written Locations | Invariant Enforced |
| :--- | :--- | :--- | :--- |
| `razorpayOrderId` | `paymentController.js` (94, 211, 225, 251, 289, 319, 416, 462); `orderController.js` (41); `adminOrderController.js` (166); `Payment.js` (94); `Order.js` (214) | `paymentController.js` (122, 131, 134); `Payment.js` (97) | Unique in `Payment` collection; Non-unique in `Order` collection. |
| `razorpayPaymentId` | `paymentController.js` (240, 252, 417); `Payment.js` (102) | `paymentController.js` (296, 356, 387); `Payment.js` (105) | Unique sparse index in `Payment`; Sparse index in `Order`. |
| `razorpaySignature` | `paymentController.js` (288); `config/razorpay.js` (51) | `paymentController.js` (297, 357, 388) | String or null; stored for cryptographic audit trail. |
| `paymentId` | `orderController.js` (40); `adminOrderController.js` (165); `Order.js` (208) | `paymentController.js` (363, 395) | Synchronized with `razorpayPaymentId` upon verification. |
| `paymentStatus` | `paymentController.js` (65, 238); `adminOrderController.js` (160, 227); `Order.js` (194) | `paymentController.js` (302, 362, 394, 451); `adminOrderController.js` (400) | Enum `['PENDING', 'SUCCESS', 'PAID', 'FAILED', 'REFUNDED']`. Admin can arbitrarily overwrite! |
| `paymentMethod` | `orderController.js` (39); `adminOrderController.js` (163); `Order.js` (204) | `paymentController.js` (135, 396) | String; set to `'razorpay'`. |
| `status` (Order) | `paymentController.js` (55, 237, 261, 450); `orderController.js` (37); `adminOrderController.js` (158, 219); `Order.js` (168) | `paymentController.js` (361, 393); `orderController.js` (346); `adminOrderController.js` (385, 569) | Enum: `PENDING_PAYMENT`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `REQUIRES_RECONCILIATION`. |
| `status` (Payment) | `paymentController.js` (91, 249, 413); `Payment.js` (36) | `paymentController.js` (130, 295, 354, 386, 463) | Enum: `['CREATED', 'PENDING', 'SUCCESS', 'PAID', 'FAILED', 'REFUNDED']`. |
| `amount` (Payment) | `paymentController.js` (253, 418); `Payment.js` (17) | `paymentController.js` (127) | Number; authoritative snapshot from `order.totalAmount`. |
| `totalAmount` (Order) | `paymentController.js` (76, 86, 127, 272); `orderController.js` (36); `adminOrderController.js` (155) | `orderController.js` (327, 345) | Number; computed server-side in `createOrder` via live catalog. |
| `currency` | `paymentController.js` (100, 128, 254, 419); `Payment.js` (22) | `paymentController.js` (128) | String; hardcoded to `'INR'`. |
| `verified` | `paymentController.js` (239, 358, 389); `Payment.js` (65) | `paymentController.js` (358, 389) | Boolean; set to `true` upon valid signature verification. |
| `captured` | `paymentController.js` (NOT CHECKED!) | Nowhere in backend | **MISSING**: Gateway capture status is completely ignored! |
| `inventory/qty` | `utils/inventory.js` (38, 39, 75, 76); `Product.js` (41, 148) | `utils/inventory.js` (43, 44, 79, 80, 96, 97) | Integer stock level decremented via `$inc: -qtyToDeduct`. |
| `orderId` | `paymentController.js` (20, 90, 125, 170, 210, 212, 433, 462); `Payment.js` (5) | `paymentController.js` (125) | Foreign key ObjectId linking `Payment` to `Order`. |

---

## 4. Payment Creation Audit (`POST /api/payments/razorpay/create-order`)

### 4.1 Detailed Requirement Assessment

| Question | Assessment Result | Code Finding / Behavior | Security Implication | Severity |
| :--- | :--- | :--- | :--- | :--- |
| **A. Amount Source** | **SECURE (Server Authoritative)** | `order.totalAmount` loaded from MongoDB (`Order.findById(orderId)`); converted via `Math.round(order.totalAmount * 100)`. | Client cannot supply lower or higher payment amount. | None |
| **B. Client Manipulation** | **SECURE** | Controller strictly extracts `{ orderId } = req.body`. Ignores subtotal, shipping, discount, currency, product price, quantity. | Client manipulation of payment payload rejected. | None |
| **C. Order Lookup** | **SECURE** | Authoritative order document loaded from MongoDB via `Order.findById(orderId)`. Returns 404 if absent. | Nonexistent orders cannot trigger payment generation. | None |
| **D. Total Recomputed** | **PARTIALLY SECURE** | `typeof order.totalAmount !== 'number' \|\| order.totalAmount <= 0` checked. Total is NOT recomputed against live product catalog. | If catalog prices change between order placement and payment initiation, customer pays the price snapshotted at order creation. (Acceptable for short TTLs, but order has no TTL). | P2 |
| **E. Link to SV Hub Order** | **PARTIALLY SECURE** | `payment.orderId = order._id` and `order.razorpayOrderId = razorpayOrderId`. | Application links 1:1, but `Order.razorpayOrderId` lacks a unique database constraint. | P2 |
| **F. Cross-Customer Creation** | **SECURE** | Enforces `String(order.userId) !== String(req.user._id)` -> HTTP 403 `forbidden_order`. | Customer A cannot initiate payment on Customer B's order. | None |
| **G. Submitting Another's Order ID** | **SECURE** | Evaluated in verification; `create-order` only takes SV Hub `orderId`. | Gateway order ID is generated internally. | None |
| **H. Called Twice (Sequential)** | **SAFE REUSE** | Reuses existing payment where `status: { $in: ['CREATED', 'PENDING'] }`. | Idempotent reuse under sequential calls. | None |
| **I. Frontend Timeout** | **ORPHAN RISK** | Razorpay order and MongoDB `Payment` created; client times out. Subsequent retry reuses the existing order. | If client abandons checkout, `Payment` remains `CREATED` indefinitely. | P2 |
| **J. Multiple Gateway Orders** | **VULNERABLE (Concurrent Race)** | Two simultaneous requests both find `payment = null`, both call `razorpay.orders.create()`, both create `Payment` records. | Multiple active Razorpay orders created for the same SV Hub order. Customer can be double-charged. | **P0** |
| **K. Idempotency Strategy** | **PARTIAL (App Check Only)** | JavaScript `findOne` before creation. No DB unique index on `Payment(orderId, status='CREATED')`, no Razorpay idempotency key header (`X-Razorpay-Idempotency-Key`). | Concurrency window allows duplicate gateway order generation. | **P1** |
| **L. Stale Order Recovery** | **MISSING** | Existing `Payment` record reused indefinitely without checking Razorpay order expiration or creation timestamp. | Customer attempting payment 14 days later reuses expired Razorpay order ID. | P2 |
| **M. Razorpay 5xx** | **HANDLED** | Try/catch catches `rzpErr`, returns HTTP 502 with error details. | Clean server error response, no uncaught crash. | None |
| **N. Razorpay 429** | **HANDLED** | Handled via `rzpErr.statusCode || 502`. | Relays error code without crash. | None |
| **O. Backend Crash Post-Gateway** | **VULNERABLE (Orphan Creation)** | Crash between `razorpay.orders.create()` and `Payment.create()` leaves orphaned order on Razorpay servers. | Razorpay order exists on dashboard but never recorded in SV Hub database. | P2 |

---

## 5. Signature Verification Audit (`POST /api/payments/razorpay/verify`)

### 5.1 Verification Engine Details

- **Algorithm:** HMAC SHA-256 (`crypto.createHmac('sha256', keySecret)`).
- **Payload Construction:** `${serverOrderId}|${paymentId}` where `serverOrderId` is taken from `payment.razorpayOrderId` (loaded from server MongoDB document, NOT trusted client body).
- **Payment ID Source:** `req.body.razorpay_payment_id` passed as input to HMAC digest.
- **Secret Source:** Server environment `RAZORPAY_KEY_SECRET` loaded via `env.js` / `process.env`.
- **Timing Safe Check:** `Buffer.from(expectedSignature, 'utf8')` compared to `Buffer.from(String(signature), 'utf8')` using `crypto.timingSafeEqual`. Validates equal buffer byte lengths first to prevent timing side-channel leaks.
- **Missing Field Validation:** Validates `orderId`, `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`. Returns HTTP 400 `missing_payment_fields` if any are missing.
- **Type Coercion Safeguard:** `Buffer.from(String(signature), 'utf8')` ensures non-string inputs do not crash Node crypto.
- **Order ID Match:** Enforces `payment.razorpayOrderId === razorpay_order_id`. Returns HTTP 400 `mismatched_razorpay_order_id`.
- **Amount Authority:** If `amount` is provided in request body, enforces that it matches `expectedPaise` (`Math.round(order.totalAmount * 100)`) or `order.totalAmount`. Returns HTTP 400 `amount_mismatch`.
- **Customer Ownership:** Verifies `String(order.userId) === String(req.user._id)`. Returns HTTP 403 `forbidden_order`.

### 5.2 Adversarial Attack Resistance Analysis

| Attack Vector | Prevented? | Exact Code Mechanism / Vulnerability | Severity |
| :--- | :--- | :--- | :--- |
| **1. Fake Signature** | **YES** | Cryptographic HMAC SHA-256 validation fails; returns HTTP 400 `invalid_signature`. | None |
| **2. Modified Signature** | **YES** | Byte mismatch or hash divergence caught by `crypto.timingSafeEqual`. | None |
| **3. Modified Payment ID** | **YES** | Altered `razorpay_payment_id` alters payload `${serverOrderId}\|${paymentId}`, invalidating signature. | None |
| **4. Modified Order ID** | **YES** | Server strictly uses `payment.razorpayOrderId` from MongoDB as payload prefix; rejects mismatched client order ID. | None |
| **5. Payment from Another Order** | **YES** | HMAC payload binds the specific `razorpayOrderId` of the target order. | None |
| **6. Payment from Another Customer** | **YES** | Checked via `order.userId !== req.user._id` before verification starts. | None |
| **7. Replay of Valid Request** | **PARTIAL** | Sequential replay returns HTTP 200 `{ idempotent: true }`. **Concurrent replay races to deduct inventory twice!** | **P0** |
| **8. Concurrent Verification** | **NO** | Zero database locking or conditional atomic transitions. Concurrent requests execute parallel stock deductions. | **P0** |
| **9. Verification After Cancellation** | **NO** | `order.status === 'CANCELLED'` is NOT checked. Re-confirms cancelled order and deducts inventory! | **P0** |
| **10. Verification After Fulfillment** | **PARTIAL** | Idempotent for same payment ID. Rejects different payment ID with HTTP 400 without issuing a refund. | **P1** |
| **11. Verification After Failure** | **YES** | Permitted (transitions `FAILED` -> `SUCCESS` if signature and stock check succeed). | None |
| **12. Reuse of Old Payment** | **PARTIAL** | Prevented across distinct `Payment` documents via `razorpayPaymentId` unique sparse index, but vulnerable to concurrent in-flight race. | **P1** |

---

## 6. Payment Status / Capture Audit

### 6.1 Critical Gateway Status Inspection

Forensic review of `paymentController.js` (lines 313–349):

```javascript
// Section 19: Verify Payment Status with Razorpay API where appropriate
if (isRazorpayConfigured() && process.env.SKIP_RZP_FETCH !== 'true') {
  try {
    const razorpay = getRazorpayClient()
    const rzpPayment = await razorpay.payments.fetch(razorpay_payment_id)
    if (rzpPayment) {
      if (rzpPayment.order_id && rzpPayment.order_id !== payment.razorpayOrderId) {
        return res.status(400).json({ code: 'order_id_mismatch' })
      }
      if (rzpPayment.amount && rzpPayment.amount !== expectedPaise) {
        return res.status(400).json({ code: 'amount_mismatch' })
      }
    }
  } catch (rzpErr) {
    if (process.env.STRICT_RZP_FETCH === 'true') {
      return res.status(400).json({ code: 'razorpay_api_error' })
    }
  }
}
```

### 6.2 Vulnerability Findings

1. **SILENT ERROR SUPPRESSION:** Unless the environment variable `STRICT_RZP_FETCH === 'true'` is explicitly configured, any failure to fetch payment details from Razorpay (network glitch, DNS timeout, upstream 500, or invalid API key in test mode) is **completely ignored**. The system silently falls through and marks the payment verified based on signature alone.
2. **ZERO CAPTURE VERIFICATION:** Even when `rzpPayment` is successfully fetched from Razorpay, **the code NEVER inspects `rzpPayment.status` or `rzpPayment.captured`!**
   - If `rzpPayment.status === 'authorized'` (funds held by bank but not captured), SV Hub fulfills the order. If the merchant does not capture the payment within Razorpay's auto-capture window (typically 5–7 days), the authorization expires, funds return to the customer, and SV Hub suffers a complete loss!
   - If `rzpPayment.status === 'failed'` or `refunded`, the code does not block confirmation as long as `order_id` and `amount` match the record.
3. **CURRENCY VALIDATION OMITTED:** The fetch check does not verify `rzpPayment.currency === 'INR'`.

### 6.3 Exact Condition for State Transitions

The system transitions state:
- `Order` -> `CONFIRMED`
- `Payment` -> `SUCCESS`
- Inventory -> Deducted
- Cart -> Cleared

**EXCLUSIVELY WHEN:**
1. Valid HMAC SHA-256 signature matches `${payment.razorpayOrderId}|${razorpay_payment_id}`.
2. `order.status !== 'CONFIRMED'`.
3. `deductOrderInventory(order.items)` returns `success: true`.

---

## 7. Idempotency Audit

### 7.1 Database-Level vs. Application-Level Guarantees

| Invariant / Operation | Application Check | Database Guarantee | Actual Concurrency Protection | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Unique Razorpay Order ID** | `Payment.findOne` before create | `razorpayOrderId: { unique: true }` in `Payment` | Database guarantees no two Payment records have same Razorpay order ID. | **SECURE** |
| **Unique Payment ID** | None in verify handler | `razorpayPaymentId: { unique: true, sparse: true }` in `Payment` | Database blocks duplicate payment ID across different Payment documents. | **SECURE** |
| **Single Active Payment per Order** | `Payment.findOne({ orderId, status: { $in: ['CREATED', 'PENDING'] } })` | **NONE** (`orderId` is indexed, NOT unique in `Payment`) | Two concurrent requests create duplicate Payment documents for same order. | **VULNERABLE (P1)** |
| **Single Order Fulfillment** | `if (order.status === 'CONFIRMED')` | **NONE** (`Order.paymentId` is NOT unique; no conditional update) | Two concurrent verify requests both observe `PENDING_PAYMENT` and fulfill twice. | **VULNERABLE (P0)** |
| **Inventory Non-Negativity** | Checks `qty > variant.qty` at order placement | Query criteria `variants.qty: { $gte: qtyToDeduct }` | Database guarantees stock cannot drop below zero in atomic `$inc`. | **SECURE** |
| **Single Inventory Deduction** | `if (payment.verified === true)` | **NONE** (No idempotency key on product inventory ledger) | Concurrent verify requests double-deduct inventory if stock is available. | **VULNERABLE (P0)** |

---

## 8. Replay Attack Audit

### 8.1 Attack Scenarios

1. **Sequential Replay of Verify Payload:**
   - Attacker or network client re-posts exact verify payload after order is confirmed.
   - Handled cleanly via lines 236–259 of `paymentController.js`. Returns HTTP 200 `{ idempotent: true }`. Stock is not deducted again.
2. **Concurrent Replay of Verify Payload (Race Condition):**
   - Two HTTP POST requests sent simultaneously at millisecond offset $T_0$.
   - Thread 1 and Thread 2 both execute `Order.findById(orderId)`. Neither sees `CONFIRMED`.
   - Thread 1 and Thread 2 both verify HMAC signature.
   - Thread 1 and Thread 2 both execute `deductOrderInventory`.
   - **Result:** If stock was 10, stock is decremented to 8 (deducted twice for one customer).
3. **Replay of Stolen Signature on Different Order:**
   - Attacker takes signature $S = \text{HMAC}(O_1 | P_1)$ and submits on Order $O_2$.
   - Server computes $\text{HMAC}(O_2 | P_1) \neq S$. Rejected with HTTP 400 `invalid_signature`.
4. **Replay of Captured Payment ID on New Order:**
   - Attacker attempts to verify Order $O_2$ using an already captured payment ID from Order $O_1$.
   - HMAC payload mismatch rejects the request. If attacker also attempts to submit $O_1$'s Razorpay order ID, `mismatched_razorpay_order_id` rejects the request.

---

## 9. Webhook Audit

### 9.1 Repository Inspection Result

```text
===================================================================
WEBHOOK SUPPORT: MISSING
===================================================================
```

A repository-wide search confirms:
- Zero webhook routes registered in `svhub-backend/src/routes/payments.js` or `index.js`.
- Zero webhook controller functions in `paymentController.js`.
- Zero raw-body middleware configuration in `app.js` (standard `express.json()` consumes the stream, preventing raw body buffer access needed for HMAC webhook verification).
- `Payment.js` contains a dead field `rawWebhookPayload: { type: Mixed, default: null }`.
- `env.js` contains an unutilized config `RAZORPAY_WEBHOOK_SECRET`.

### 9.2 Production Failure Consequences of Missing Webhooks

1. **The "Dropped Connection" Cart Abandonment Loss (Scenario A):**
   A customer pays via UPI (Google Pay / PhonePe) or Netbanking. After the bank confirms the deduction, the customer's phone switches apps, mobile network drops, or the customer accidentally closes the browser tab. The client-side Razorpay modal never executes `options.handler`.
   **Consequence:** Razorpay captures the customer's money. SV Hub NEVER receives the verification callback. The order remains `PENDING_PAYMENT` forever. Stock is never deducted, warehouse never ships, customer files an immediate chargeback / consumer dispute.
2. **Delayed Bank Authorizations:**
   Certain payment instruments (Netbanking, NEFT/RTGS, UPI intent callbacks) experience asynchronous authorization delays of 2 to 30 minutes. Without webhooks (`payment.captured`), SV Hub cannot fulfill delayed orders.
3. **Silent Refund and Dispute Ignorance:**
   When a customer initiates a chargeback or a merchant issues a refund on the Razorpay Dashboard, Razorpay emits `refund.processed` or `payment.disputed`. SV Hub has no webhook receiver, so the internal order remains `CONFIRMED` and items are shipped for refunded payments.

---

## 10. Reconciliation Audit

### 10.1 Scenario Recovery Analysis

| Failure Scenario | System Recoverability | Resulting Order State | Resulting Payment State | Financial / Inventory Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Scenario A: Razorpay captured, frontend never reaches verify** | **UNRECOVERABLE** | `PENDING_PAYMENT` | `CREATED` | Customer charged; order never fulfilled. |
| **Scenario B: Verify succeeds, frontend times out** | **RECOVERABLE (Manual Refresh)** | `CONFIRMED` | `SUCCESS` | Order confirmed on server. Client sees success upon reloading account orders. |
| **Scenario C: Payment succeeds, MongoDB transaction fails** | **CORRUPTED** | `REQUIRES_RECONCILIATION` or `PENDING_PAYMENT` | `FAILED` or `CREATED` | Payment captured at gateway; database rollback leaves order unfulfilled. No refund issued! |
| **Scenario D: Inventory deducted, process crashes before order confirmation** | **CORRUPTED** | `PENDING_PAYMENT` | `CREATED` | Stock lost from warehouse; order unpaid; payment unverified. |
| **Scenario E: Webhook arrives before frontend verification** | **N/A (No Webhooks)** | N/A | N/A | Feature missing. |
| **Scenario F: Frontend verification arrives before webhook** | **N/A (No Webhooks)** | N/A | N/A | Feature missing. |
| **Scenario G: Webhook arrives twice** | **N/A (No Webhooks)** | N/A | N/A | Feature missing. |
| **Scenario H: Webhook arrives late** | **N/A (No Webhooks)** | N/A | N/A | Feature missing. |
| **Scenario I: Gateway and MongoDB disagree** | **UNRECOVERABLE** | Desynchronized | Desynchronized | No automated reconciliation job exists to detect or resolve discrepancies. |

### 10.2 Existing Reconciliation Tooling

- Reconciliation endpoint: **MISSING**
- Reconciliation background cron job: **MISSING**
- Webhook recovery engine: **MISSING**
- Payment status polling: **MISSING**
- Admin reconciliation dashboard / actions: **MISSING**
- Orphan payment detection: **MISSING**
- Orphan Razorpay order detection: **MISSING**

---

## 11. Inventory Consistency Audit

### 11.1 Stock = 1 Race Condition Analysis

**Scenario:** Product Variant Stock = 1.  
- Customer A places Order A for 1 unit.
- Customer B places Order B for 1 unit (allowed because stock was 1 at order time).
- Both Customer A and Customer B pay on Razorpay successfully.
- Both call `POST /api/payments/razorpay/verify`.

**Code Execution Trace:**
1. Customer A's verification executes `deductOrderInventory`:
   `Product.updateOne({ _id, 'variants.qty': { $gte: 1 } }, { $inc: { 'variants.$.qty': -1, qty: -1 } })`
   Modifies 1 document. Stock becomes 0.
   Order A transitions to `CONFIRMED`, `paymentStatus = 'SUCCESS'`.
2. Customer B's verification executes `deductOrderInventory`:
   `Product.updateOne({ _id, 'variants.qty': { $gte: 1 } }, { $inc: { 'variants.$.qty': -1, qty: -1 } })`
   Condition `$gte: 1` fails. `modifiedCount === 0`.
   Throws `Insufficient stock for item ...`.
3. Customer B enters lines 353–383 of `paymentController.js`:
   `order.status = 'REQUIRES_RECONCILIATION'`
   `order.paymentStatus = 'SUCCESS'`
   `payment.status = 'FAILED'`
   `payment.errorReason = 'Inventory deduction failed: ...'`
   Returns HTTP 409 `inventory_conflict`.

**Findings:**
- Stock **never drops below zero** thanks to MongoDB `$gte: qty` criteria.
- However, Customer B has been charged by Razorpay, but SV Hub has marked their payment `FAILED` and order `REQUIRES_RECONCILIATION`.
- **NO AUTOMATED REFUND IS ISSUED TO CUSTOMER B.** The customer's money remains captured on Razorpay with no automated recourse.

### 11.2 Standalone Fallback & Process Crash Vulnerability

In `svhub-backend/src/utils/inventory.js`:
- If replica set transactions are available, MongoDB session aborts automatically on error.
- In standalone environments or when replica set is unavailable, the fallback uses a JavaScript rollback loop:
  ```javascript
  for (const prev of successfullyDeducted) {
    await Product.updateOne({ ... }, { $inc: { 'variants.$.qty': prev.quantity, qty: prev.quantity } }).catch(() => {})
  }
  ```
- If the Node.js server process crashes, runs out of memory, or loses connection during this rollback loop, **stock remains permanently deducted for unconfirmed orders.**

---

## 12. Cart Consistency Audit

### 12.1 Cart Clearing Triggers & Isolation

1. **Trigger:** `Cart.updateOne({ userId: order.userId }, { $set: { items: [] } })` in `paymentController.js` line 405.
2. **Condition:** Executes strictly after signature verification passes AND inventory deduction succeeds.
3. **Preservation on Failure:** If signature verification fails, inventory is out of stock, or customer dismisses modal, `Cart.updateOne` is never invoked. The customer's cart remains intact.
4. **Duplicate Clearing Risk:** In `verifyRazorpayPayment`, if a duplicate verify request bypasses the initial `order.status === 'CONFIRMED'` check due to a race condition, it executes `Cart.updateOne({ userId: order.userId }, { $set: { items: [] } })`. If the user added new items to their cart after placing the first order, **the duplicate verify request wipes out the user's newly added unrelated cart items!**

---

## 13. Refund Audit

### 13.1 Repository Inspection Result

```text
===================================================================
REFUNDS: NOT IMPLEMENTED
===================================================================
```

- **Refund API:** Missing.
- **Refund Model / Collection:** Missing.
- **Razorpay Refund Gateway Call:** Zero instances of `razorpay.payments.refund()` across the repository.
- **Partial Refund Support:** Missing.
- **Refund Webhooks:** Missing.
- **Admin Refund Trigger:** Admin can PATCH `paymentStatus: 'REFUNDED'`, but this only edits a string in the database without communicating with Razorpay or issuing funds!

### 13.2 Production Consequences

1. An admin marking an order "Refunded" in the admin dashboard does NOT refund the customer's bank account.
2. Orders marked `REQUIRES_RECONCILIATION` cannot be automatically refunded.
3. Over-refund protection is completely absent.

---

## 14. Cancellation Audit

### 14.1 Cancellation States and Inconsistencies

1. **Customer Cancellation:** Customers have **no cancellation endpoint** (`/api/orders/:id/cancel` does not exist for customers).
2. **Admin Cancellation (`POST /api/admin/orders/:id/cancel`):**
   - Lines 577–580 of `adminOrderController.js`:
     ```javascript
     // INVENTORY CRITICAL INSTRUCTION:
     // Do NOT automatically restore inventory. Phase 1.5 order creation did NOT deduct
     // stock from Products, so cancelling must NOT artificially increment product inventory.
     ```
   - **CRITICAL DEFECT:** In Phase 2.1, confirmed orders **DO** deduct inventory! If an admin cancels a `CONFIRMED` order, **the inventory is NEVER restored to the product catalogue!** Stock is permanently lost.
   - **LACK OF REFUND:** Cancelling a paid order does not trigger or schedule a Razorpay refund.
3. **Cancellation / Payment Race:** If an admin cancels an order while payment is in flight, `verifyRazorpayPayment` does not verify `order.status !== 'CANCELLED'`. The payment callback confirms the cancelled order and deducts inventory again!

---

## 15. Authorization Audit

### 15.1 Horizontal Privilege Escalation (IDOR) Testing

| Attack | Target Endpoint | Code Protection | Result |
| :--- | :--- | :--- | :--- |
| Customer A accesses Customer B's order details | `GET /api/orders/:id` | `Order.findOne({ _id, userId: req.user._id })` | **PREVENTED (404)** |
| Customer A initiates payment for Customer B's order | `POST /api/payments/razorpay/create-order` | `if (String(order.userId) !== String(req.user._id))` | **PREVENTED (403)** |
| Customer A verifies payment for Customer B's order | `POST /api/payments/razorpay/verify` | `if (String(order.userId) !== String(req.user._id))` | **PREVENTED (403)** |
| Customer A records failure for Customer B's order | `POST /api/payments/razorpay/record-failure` | `if (String(order.userId) !== String(req.user._id))` | **PREVENTED (404)** |
| Customer A submits Customer B's payment ID | `POST /api/payments/razorpay/verify` | HMAC calculation binds `serverOrderId` | **PREVENTED (400)** |
| Customer tampering with payment status | `POST /api/payments/razorpay/verify` | Client cannot send `status`; derived server-side | **PREVENTED** |

---

## 16. Database Integrity Audit

### 16.1 Schema Constraints vs. Application Logic

| Invariant | Database Constraint | Application Check | Status |
| :--- | :--- | :--- | :--- |
| 1. Razorpay Order IDs unique | `unique: true` on `Payment.razorpayOrderId` | Reuses existing payment | **DATABASE GUARANTEE** |
| 2. Razorpay Payment IDs unique | `unique: true, sparse: true` on `Payment.razorpayPaymentId` | None | **DATABASE GUARANTEE** |
| 3. Order ID has 1:1 Payment link | None (`orderId` is non-unique index in `Payment`) | `Payment.findOne({ orderId })` | **APPLICATION CHECK ONLY** |
| 4. Payment amount matches order | None | Checked in verify | **APPLICATION CHECK ONLY** |
| 5. Currency matches | Default `'INR'` | Hardcoded | **APPLICATION CHECK ONLY** |
| 6. Single fulfillment per order | None (`Order.paymentId` is non-unique) | `if (order.status === 'CONFIRMED')` | **APPLICATION CHECK ONLY (RACE PRONE)** |
| 7. Stock cannot drop below zero | Query filter `variants.qty: { $gte: qty }` | Handled via update count | **DATABASE GUARANTEE** |
| 8. Cart isolation | `unique: true` on `Cart.userId` | Updated via `order.userId` | **DATABASE GUARANTEE** |
| 9. Webhook event deduplication | **NONE** (No webhook collection) | **NONE** | **MISSING** |
| 10. Audit history immutability | **NONE** (Plain array in Mongoose doc) | Pushes history objects | **APPLICATION CHECK ONLY** |

---

## 17. Network / Crash Recovery Audit

### 17.1 Failure Mode Matrix

| Failure Event | Order State | Payment State | Inventory State | Cart State | Recoverability | Data Loss Risk |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Razorpay API Timeout (create-order)** | `PENDING_PAYMENT` | None | Undeducted | Preserved | Safe retry | None |
| **Razorpay 500 (create-order)** | `PENDING_PAYMENT` | None | Undeducted | Preserved | Safe retry | None |
| **Razorpay 429 Rate Limit** | `PENDING_PAYMENT` | None | Undeducted | Preserved | Safe retry after backoff | None |
| **MongoDB Timeout during Verify** | `PENDING_PAYMENT` | `CREATED` | Rollback attempted | Preserved | High risk if stock was decremented | Moderate |
| **Process Crash after Stock Deduction** | `PENDING_PAYMENT` | `CREATED` | **Deducted** | Preserved | **CORRUPTED** (Stock lost; order unpaid) | **HIGH (P0)** |
| **Process Crash after Payment Success** | `PENDING_PAYMENT` | **SUCCESS** | Deducted | Preserved | **CORRUPTED** (Paid order marked pending) | **HIGH (P0)** |
| **Browser Crash / Drop during Payment** | `PENDING_PAYMENT` | `CREATED` | Undeducted | Preserved | **LOST MONEY** (Razorpay captured; SV Hub ignores) | **CRITICAL (P0)** |

---

## 18. Rate Limiting / Abuse Audit

- **Rate Limiting Middleware:** Completely missing. No `express-rate-limit` or Redis token-bucket limiter configured.
- **Endpoint Exposure:**
  - `POST /api/payments/razorpay/create-order`: Vulnerable to gateway order generation flooding.
  - `POST /api/payments/razorpay/verify`: Vulnerable to HMAC CPU exhaustion.
  - `POST /api/payments/razorpay/record-failure`: Vulnerable to DB write spamming.
- **Request Size Limits:** Protected globally via `express.json({ limit: '1mb' })`.

---

## 19. Secret / PCI / Logging Audit

1. **`RAZORPAY_KEY_SECRET`:** Loaded strictly on server from environment. Never included in client bundles or public API responses.
2. **`JWT_SECRET`:** Server-side only; validated in `env.js`.
3. **Cardholder Data (PCI-DSS):** SV Hub uses Razorpay Standard Checkout modal. Full credit card numbers and CVV codes never touch SV Hub servers; processed directly by Razorpay PCI-DSS Level 1 compliant iframes.
4. **Log Leakage Audit:** `requestLogger.js` logs only method, URL, status, and response time. Request bodies and headers are not logged. No secrets printed to stdout.

---

## 20. Admin Security Audit

1. **Direct Payment Status Modification:**
   - In `adminOrderController.js` (lines 389–402), an admin can issue `PATCH /api/admin/orders/:id` with `{ paymentStatus: 'PAID' }` or `{ paymentStatus: 'REFUNDED' }`.
   - **Defect:** No cryptographic verification occurs, no gateway capture/refund occurs, no `Payment` document is updated, and no status history entry is created!
2. **Lack of Audit Logging:** Administrative actions do not write to a dedicated immutable audit collection; only minimal string notes are pushed to `order.history`.

---

## 21. Frontend Trust Boundary Audit

| Field | Source | Server Classification | Current Handling |
| :--- | :--- | :--- | :--- |
| `amount` ( Paused / Paid ) | Client body | **UNTRUSTED** | Sourced from `order.totalAmount` in DB; client amount validated or ignored. |
| `orderId` | Client body | **MUST BE REVALIDATED** | Revalidated against MongoDB ownership (`order.userId === req.user._id`). |
| `razorpay_order_id` | Client body | **MUST BE REVALIDATED** | Revalidated against `payment.razorpayOrderId`. |
| `razorpay_payment_id` | Client body | **UNTRUSTED** | Validated via cryptographic HMAC SHA-256 signature. |
| `razorpay_signature` | Client body | **UNTRUSTED** | Validated via timing-safe HMAC SHA-256 computation. |
| `currency` | Client body | **UNTRUSTED** | Sourced from server default (`'INR'`). |
| `paymentStatus` | Client body | **UNTRUSTED** | Server ignores client status; set strictly by backend logic. |

---

## 22. Existing Test Coverage Audit

### 22.1 Existing Test Suite Matrix

| Security Area | Existing Test File | Covered? | Strong Enough? | Missing Critical Test |
| :--- | :--- | :--- | :--- | :--- |
| Secret Exposure | `verify-payments.js` (52-58) | **YES** | Weak (Only checks `/health`) | Check all public endpoints & client bundle |
| HMAC Validation | `verify-payments.js` (60-109) | **YES** | Strong | Edge cases with multi-byte or empty strings |
| Cross-Customer Payments | `verify-payments.js` (224, 307) | **YES** | Strong | Cross-tenant address tampering |
| Tampered Amount | `verify-payments.js` (335) | **YES** | Moderate | Omitted amount field in verify payload |
| Tampered Signature | `verify-payments.js` (353) | **YES** | Strong | Truncated / malformed base64 signatures |
| Duplicate Verify (Sequential)| `verify-payments.js` (416) | **YES** | Strong | Concurrent verify race condition |
| Inventory Exhaustion | `verify-payments.js` (438) | **YES** | Moderate | Concurrent stock exhaustion (Customer A & B) |
| Webhook Handling | None | **NO** | Missing | Entire webhook suite |
| Refund Processing | None | **NO** | Missing | Entire refund suite |
| Cancelled Order Verification | None | **NO** | Missing | Verify payment after order cancelled |
| Concurrent Verify Race | None | **NO** | Missing | Parallel `Promise.all([verify, verify])` |

---

## 23. 75+ Adversarial Test Matrix

| ID | Category | Attack / Failure Scenario | Current Behavior | Expected Secure Behavior | Current Protection | Gap | Severity | Test Needed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A01** | Amount | Client sends `amount: 1` (₹0.01) in `create-order` | Server ignores client amount; uses DB total | Server ignores client amount | App check | None | Low | Assert client amount ignored |
| **A02** | Amount | Client sends `amount: 100` (₹1) in `verify` | Server returns HTTP 400 `amount_mismatch` | Return HTTP 400 | App check | None | Med | Tampered amount test |
| **A03** | Amount | Client omits `amount` field in `verify` | Server skips amount check; verifies signature | Enforce amount check against gateway fetch | None | Gateway amount not checked | **P1** | Omit amount in verify payload |
| **A04** | Amount | Razorpay authorizes lower amount via partial capture | Server confirms order without checking gateway | Reject or flag underpaid order | None | Uncaptured partial payment accepted | **P0** | Mock partial gateway capture |
| **A05** | Amount | Order total is modified in DB while payment in-flight | Server rejects verify with `amount_mismatch` | Reject and issue automated refund | Partial | Money trapped without refund | **P1** | Modify order total mid-flow |
| **B01** | Order ID | Client sends nonexistent MongoDB `orderId` in `create-order` | Returns HTTP 404 `order_not_found` | Return HTTP 404 | App check | None | Low | Random ObjectId test |
| **B02** | Order ID | Client sends invalid string as `orderId` | Returns HTTP 400 or cast error | Return HTTP 400 | App check | None | Low | Malformed ID test |
| **B03** | Order ID | Client sends tampered `razorpay_order_id` in `verify` | Returns HTTP 400 `mismatched_razorpay_order_id` | Return HTTP 400 | App check | None | Med | Mismatched RZP order ID test |
| **B04** | Order ID | Client uses Order A's `razorpay_order_id` on Order B | Returns HTTP 400 `mismatched_razorpay_order_id` | Return HTTP 400 | App check | None | High | Cross-order RZP order ID test |
| **B05** | Order ID | Client attempts SQL/NoSQL injection in `orderId` | Handled via Mongoose cast validation | Return HTTP 400 | ODM check | None | Low | Object injection `{ $ne: null }` |
| **C01** | Payment ID | Client sends empty `razorpay_payment_id` in `verify` | Returns HTTP 400 `missing_payment_fields` | Return HTTP 400 | App check | None | Low | Empty field test |
| **C02** | Payment ID | Client reuses an old `razorpay_payment_id` on new order | HMAC mismatch; if forced, DB unique index rejects | Return HTTP 400 / 409 | HMAC + DB | None | High | Reused payment ID test |
| **C03** | Payment ID | Client sends payment ID of failed transaction | Signature fails or gateway fetch check fails | Reject uncaptured payment | Partial | Gateway status not checked | **P0** | Failed payment ID test |
| **C04** | Payment ID | Payment ID contains special characters / SQL | String sanitized; HMAC fails | Reject invalid ID | App check | None | Low | Fuzz payment ID |
| **D01** | Signature | Completely fabricated hex signature | Returns HTTP 400 `invalid_signature` | Return HTTP 400 | HMAC SHA-256 | None | High | Random signature test |
| **D02** | Signature | Signature with 1 character altered | Returns HTTP 400 `invalid_signature` | Return HTTP 400 | Timing-safe check | None | High | Bit-flip signature test |
| **D03** | Signature | Signature truncated to 10 characters | Returns HTTP 400 (buffer length mismatch) | Return HTTP 400 | Length check | None | Med | Truncated signature test |
| **D04** | Signature | Empty string signature | Returns HTTP 400 `missing_payment_fields` | Return HTTP 400 | Presence check | None | Low | Empty signature test |
| **D05** | Signature | Non-string signature (e.g. integer or array) | `String(signature)` coerces, HMAC fails | Return HTTP 400 | Type coercion | None | Low | Non-string signature test |
| **D06** | Signature | Signature signed with wrong secret | Returns HTTP 400 `invalid_signature` | Return HTTP 400 | HMAC SHA-256 | None | High | Wrong secret test |
| **E01** | Replay | Re-submitting exact verify payload after confirmation | Returns HTTP 200 `{ idempotent: true }` | Return idempotent 200 | App check | None | Med | Sequential replay test |
| **E02** | Replay | Re-submitting verify with different payment ID on confirmed order | Returns HTTP 400 `order_already_confirmed` | Return HTTP 400 and flag duplicate charge | App check | Customer charged twice without refund | **P1** | Secondary payment replay test |
| **E03** | Replay | Re-submitting verify payload on cancelled order | Confirms order and deducts inventory! | Reject verification on cancelled order | None | **RESURRECTS CANCELLED ORDER** | **P0** | Replay on cancelled order |
| **E04** | Replay | Re-submitting verify payload on delivered order | Confirms order and deducts inventory! | Reject verification on delivered order | None | **RE-DEDUCTS DELIVERED ORDER** | **P0** | Replay on delivered order |
| **F01** | Duplicate | Rapid double-click on checkout "Pay" button | Disabled in UI, but API allows concurrent calls | Reject second in-flight request | UI disabled | Backend unprotected | **P1** | Parallel create-order calls |
| **F02** | Duplicate | Concurrent `POST /create-order` requests | Creates two Razorpay orders on upstream gateway | Deduplicate via DB lock / atomic flag | None | Duplicate gateway orders | **P1** | Concurrent create-order test |
| **F03** | Duplicate | Two tabs initiating payment for same order | Both receive different Razorpay order IDs | Return same active gateway order | None | Inconsistent order ID in Order doc | **P1** | Multi-tab payment test |
| **G01** | Concurrency | 2 concurrent verify requests for same order | Both pass check; double-deduct inventory! | Atomic lock; exactly one confirms | None | **INVENTORY OVERSELL / TOCTOU** | **P0** | Concurrent verify race test |
| **G02** | Concurrency | 10 concurrent verify requests for single remaining item | One succeeds; others return 409 or corrupt state | Exactly one succeeds, 9 fail cleanly | Mongo `$gte` | Second thread corrupts order state | **P0** | High-concurrency verify test |
| **G03** | Concurrency | Concurrent verify and admin cancel | Both succeed; order confirmed AND cancelled | Deterministic state transition | None | Corrupted state history | **P0** | Verify vs cancel race test |
| **H01** | Webhook | Webhook arrives for valid payment | Returns HTTP 404 (Webhook missing) | Verify signature, confirm order | None | **WEBHOOK MISSING** | **P0** | Webhook route test |
| **H02** | Webhook | Fake webhook signature sent to server | Endpoint doesn't exist | Verify HMAC with webhook secret | None | Feature missing | **P0** | Webhook spoofing test |
| **H03** | Webhook | Webhook arrives before client verify | Endpoint doesn't exist | Confirm order, deduct stock | None | Feature missing | **P0** | Asynchronous webhook test |
| **H04** | Webhook | Webhook arrives after client verify | Endpoint doesn't exist | Acknowledge idempotently (200 OK) | None | Feature missing | **P0** | Duplicate webhook test |
| **H05** | Webhook | Webhook arrives for refund event | Endpoint doesn't exist | Transition order/payment to REFUNDED | None | Feature missing | **P0** | Refund webhook test |
| **I01** | State Mismatch | Razorpay status is `authorized` (not captured) | Backend confirms order based on signature | Block confirmation until captured | None | **UNEARNED FULFILLMENT** | **P0** | Authorized uncaptured test |
| **I02** | State Mismatch | Razorpay payment status is `failed` | Backend confirms order if signature matches | Reject failed payment | None | Gateway status ignored | **P0** | Failed status fetch test |
| **I03** | State Mismatch | Razorpay payment status is `refunded` | Backend confirms order if signature matches | Reject refunded payment | None | Gateway status ignored | **P0** | Refunded status fetch test |
| **I04** | State Mismatch | Razorpay currency is `USD` instead of `INR` | Backend confirms order without currency check | Enforce currency === 'INR' | None | Currency spoofing | **P1** | Currency mismatch test |
| **J01** | Inventory Race | Stock = 1; User A & B pay concurrently | User A confirms; User B gets 409 REQUIRES_REC | User A confirms; User B flagged for refund | Mongo `$gte` | User B money trapped | **P0** | Two-buyer stock=1 test |
| **J02** | Inventory Race | Stock = 0 at payment time | Returns 409 `inventory_conflict` | Flag reconciliation & schedule refund | App check | Money trapped | **P1** | Zero stock payment test |
| **J03** | Inventory Race | Multi-item order: item 1 in stock, item 2 out | Item 1 rolled back; returns 409 | Rollback all items cleanly | Rollback loop | Standalone crash leaves stock lost | **P1** | Partial stock failure test |
| **K01** | Cart Race | User modifies cart while payment modal is open | Cart cleared after payment | Clear only items present in the order | None | Unrelated cart items wiped | **P2** | Cart edit during payment |
| **K02** | Cart Race | Duplicate verify request arrives | Cart cleared again | Safe no-op | App check | None | Low | Double cart clear test |
| **K03** | Cart Race | Payment fails; user returns to cart | Cart preserved with all items | Cart preserved intact | App check | None | Low | Cart preservation test |
| **L01** | Authorization | Customer A calls `/create-order` for Customer B | Returns HTTP 403 `forbidden_order` | Return HTTP 403 | App check | None | High | Cross-customer create test |
| **L02** | Authorization | Customer A calls `/verify` for Customer B | Returns HTTP 403 `forbidden_order` | Return HTTP 403 | App check | None | High | Cross-customer verify test |
| **L03** | Authorization | Customer A calls `/record-failure` for Customer B | Returns HTTP 404 `order_not_found` | Return HTTP 404 | App check | None | Med | Cross-customer failure test |
| **L04** | Authorization | Unauthenticated request to payment routes | Returns HTTP 401 `unauthenticated` | Return HTTP 401 | `requireAuth` | None | High | Unauthenticated payment test |
| **L05** | Authorization | Expired JWT token submitted to payment route | Returns HTTP 401 `token_expired` | Return HTTP 401 | `requireAuth` | None | Med | Expired token test |
| **M01** | Network Failure | Razorpay API times out during `create-order` | Returns HTTP 502 gateway error | Return HTTP 502 gracefully | Try/catch | None | Med | Gateway timeout mock |
| **M02** | Network Failure | Razorpay API returns 500 during `payments.fetch` | Error swallowed unless STRICT mode | Log warning, verify via webhook | Try/catch | Silent swallowing | **P1** | Gateway 500 mock |
| **M03** | Network Failure | Client drops connection before `verify` response | Order confirmed on server; client unaware | Client recovers on next load / webhook | Server DB | Client UX desync | **P1** | Network drop mock |
| **N01** | DB Failure | MongoDB disconnects during `create-order` | Handled by global errorHandler (500) | Return HTTP 500 cleanly | ErrorHandler | None | Med | DB down mock |
| **N02** | DB Failure | MongoDB disconnects during inventory deduction | Rollback fails; returns error | Atomically roll back transaction | Mongoose | Standalone leaves stock lost | **P0** | DB disconnect during update |
| **N03** | DB Failure | Duplicate key error on `Payment.razorpayPaymentId` | Handled via errorHandler (409 duplicate_key) | Return HTTP 409 cleanly | ErrorHandler | None | Med | Duplicate key collision test |
| **O01** | Crash Recovery | Process killed between stock deduction & order save | Stock deducted; order remains PENDING | Rollback transaction on startup | None | **ORPHANED STOCK LOSS** | **P0** | Crash injection test |
| **O02** | Crash Recovery | Process killed between payment success & cart clear | Order confirmed; cart NOT cleared | Reconcile cart on next user load | None | Minor UX desync | P3 | Crash before cart clear |
| **P01** | Refund | Customer requests refund | Feature missing | Process refund via Razorpay API | None | **REFUNDS MISSING** | **P0** | Refund endpoint test |
| **P02** | Refund | Admin attempts refund in dashboard | Modifies string in DB; no money returned | Trigger `razorpay.payments.refund()` | None | **FAKE REFUND IN ADMIN** | **P0** | Admin refund trigger test |
| **P03** | Refund | Duplicate refund trigger | Feature missing | Idempotent refund with gateway | None | Feature missing | **P0** | Duplicate refund test |
| **Q01** | Cancellation | Customer attempts to cancel order | Endpoint missing | Allow cancellation before shipment | None | Customer cannot cancel | **P1** | Customer cancel test |
| **Q02** | Cancellation | Admin cancels confirmed paid order | Stock is NOT restored to catalogue | Restore inventory atomically | None | **PERMANENT STOCK LOSS** | **P0** | Cancel paid order test |
| **Q03** | Cancellation | Admin cancels order; money is not refunded | Status set to CANCELLED; money kept | Trigger automated refund | None | **MONEY TRAPPED ON CANCEL** | **P0** | Refund on cancel test |
| **R01** | Admin Abuse | Admin manually sets `paymentStatus: 'PAID'` | Direct DB overwrite; no gateway check | Require financial audit trail | None | False paid status | **P1** | Admin manual override test |
| **R02** | Admin Abuse | Admin changes total amount of paid order | Succeeded without integrity check | Immutable totals on confirmed orders | None | Accounting fraud vulnerability | **P1** | Admin total tamper test |
| **S01** | Rate Limiting | 10,000 requests/min to `/create-order` | Server processes all; triggers RZP 429 | Rate limit to 10 req/min per user | None | **DOS / GATEWAY BLACKLIST** | **P1** | Load test payment endpoint |
| **S02** | Rate Limiting | Flooding invalid verify payloads | Server computes HMAC on all; CPU spike | Rate limit to 20 req/min per IP | None | CPU exhaustion | **P1** | HMAC flood test |
| **T01** | Data Integrity | Order total is negative | Validation rejects `totalAmount < 0` | Reject negative amount | Mongoose min | None | Low | Negative total test |
| **T02** | Data Integrity | Currency is not 'INR' | Rejected by schema default | Enforce 'INR' | Schema | None | Low | Foreign currency test |
| **T03** | Data Integrity | Payment record missing `orderId` | Rejected by Mongoose validation | Reject record | Mongoose req | None | Low | Missing orderId test |
| **T04** | Data Integrity | Modifying product price alters historical order | Historical snapshot preserved | Preserve price snapshot | Schema embed | None | Low | Catalog mutation test |
| **T05** | Data Integrity | Modifying address alters historical order | Historical address snapshot preserved | Preserve address snapshot | Schema embed | None | Low | Address mutation test |

---

## 24. Current State Machine

### 24.1 Order State Transitions

```
[ PENDING_PAYMENT ] ─── (Signature Verified + Stock Deducted) ───> [ CONFIRMED ]
         │                                                               │
         ├── (Inventory Deduction Failed) ──> [ REQUIRES_RECONCILIATION ]│
         │                                                               │
         ├── (Admin Cancellation) ──────────> [ CANCELLED ]              ├── (Admin Dispatch) ──> [ PROCESSING ]
         │                                                               │                               │
         v                                                               │                               v
[ PENDING_PAYMENT ] <── (VULNERABILITY: Verify on Cancelled) ────────────┘                        [ SHIPPED ]
                                                                                                         │
                                                                                                         v
                                                                                                [ OUT_FOR_DELIVERY ]
                                                                                                         │
                                                                                                         v
                                                                                                  [ DELIVERED ]
```

### 24.2 Payment Document State Transitions

```
[ CREATED ] ─── (Client Verification Success) ───> [ SUCCESS ] (or PAID)
     │
     ├── (Signature Invalid / Client Modal Dismissed) ──> [ FAILED ]
     │                                                         │
     └── (VULNERABILITY: Retry from FAILED) ───────────────────┘
```

### 24.3 Invalid Transitions Currently Permitted by Code

1. `CANCELLED` -> `CONFIRMED`: In `verifyRazorpayPayment`, cancelled orders are confirmed upon payment callback.
2. `DELIVERED` -> `CONFIRMED`: Calling verify on a delivered order sets status back to `CONFIRMED`.
3. `CONFIRMED` -> `REQUIRES_RECONCILIATION`: In a concurrent verify race, the second thread fails stock and sets an already confirmed order to reconciliation!
4. `SUCCESS` -> `FAILED`: In a concurrent verify race, the second thread overwrites payment status to `FAILED`.

---

## 25. Critical Invariants Evaluation

| Invariant ID | Invariant Statement | Audit Verdict | Detailed Finding |
| :--- | :--- | :--- | :--- |
| **INVARIANT 1** | A customer can only pay for their own order. | **PASS** | Enforced via `order.userId !== req.user._id` check in both create-order and verify. |
| **INVARIANT 2** | The browser cannot determine the authoritative payment amount. | **PASS** | Authoritative amount sourced strictly from MongoDB `order.totalAmount`. |
| **INVARIANT 3** | A Razorpay payment can fulfill only the intended SV Hub order. | **PASS** | HMAC SHA-256 payload binds server-stored `payment.razorpayOrderId` with `paymentId`. |
| **INVARIANT 4** | A payment cannot fulfill two orders. | **PARTIAL** | `Payment.razorpayPaymentId` is unique in DB, but `Order.paymentId` is not unique. |
| **INVARIANT 5** | Inventory is deducted at most once. | **FAIL** | Concurrent verify requests race to double-deduct stock due to lack of atomic row lock. |
| **INVARIANT 6** | Cart is cleared only after successful fulfillment. | **PASS** | Cart cleared strictly in verify after successful stock deduction. |
| **INVARIANT 7** | Duplicate callbacks cannot duplicate fulfillment. | **PARTIAL** | Sequential duplicates are idempotent. Concurrent duplicates race and double-fulfill. |
| **INVARIANT 8** | Replay of a successful payment cannot create another fulfillment. | **PASS** | Prevented by cryptographic HMAC payload binding and payment ID uniqueness. |
| **INVARIANT 9** | Payment status cannot be manually forged by the customer. | **PASS** | Server-derived; client inputs for status are discarded. |
| **INVARIANT 10**| Payment secrets never reach the frontend. | **PASS** | `RAZORPAY_KEY_SECRET` remains server-side. Only public `keyId` returned to browser. |
| **INVARIANT 11**| Webhook events cannot be forged or replayed. | **NOT IMPLEMENTED**| Webhook support is 100% missing. |
| **INVARIANT 12**| A captured payment cannot silently become an unpaid order. | **FAIL** | Client drop after payment capture leaves order in `PENDING_PAYMENT` forever. |

---

## 26. Priority Classification (P0 / P1 / P2 / P3 Gaps)

### P0 — Critical (Must Fix Before Production Launch)

1. **P0-1: Missing Razorpay Webhook Infrastructure.** Complete absence of webhook receiver (`POST /api/payments/razorpay/webhook`). Captured payments where browser drops are permanently orphaned.
2. **P0-2: Concurrent Verification Race & Double Inventory Deduction.** Lack of atomic conditional transition (`findOneAndUpdate({ _id, status: 'PENDING_PAYMENT' }, { $set: { status: 'CONFIRMING' } })`) allows parallel requests to double-deduct inventory.
3. **P0-3: Failure to Verify Gateway Capture Status.** Backend never validates `rzpPayment.status === 'captured'` or `rzpPayment.captured === true`, and silently swallows fetch errors.
4. **P0-4: Absence of Automated Refunds.** Zero refund implementation for inventory conflicts, stockouts, or cancellations.
5. **P0-5: Resurrection of Cancelled Orders.** Payment verification does not check `order.status !== 'CANCELLED'`, allowing paid confirmation of cancelled orders.
6. **P0-6: Non-Atomic Distributed Multi-Collection Updates.** Inventory deduction, payment status, order confirmation, and cart clearing run as uncoordinated writes; server crash creates permanent data corruption.
7. **P0-7: Lost Inventory on Admin Cancellation.** Cancelling a confirmed order does not restore deducted stock to the product catalogue.

### P1 — High Priority

1. **P1-1: Complete Lack of Rate Limiting on Payment Endpoints.** No protection against brute-force, gateway quota exhaustion, or DoS attacks.
2. **P1-2: Concurrent Payment Creation Duplication.** Parallel `create-order` requests spawn multiple active Razorpay orders for a single SV Hub order.
3. **P1-3: Admin Status Modification Without Audit.** Admin can manually mark orders `PAID` or `REFUNDED` with zero gateway verification or payment record updates.
4. **P1-4: Customer Cart Items Wiped on Retried Checkout.** Retrying checkout generates new orders while leaving previous orders orphaned in `PENDING_PAYMENT`.

### P2 — Important

1. **P2-1: Lack of Razorpay Order Expiration Handling.** Stale `CREATED` payment records reused indefinitely without checking TTL.
2. **P2-2: Missing Non-Unique Index on `Order.razorpayOrderId`.** Lacks DB constraint preventing duplicate association.
3. **P2-3: Customer Self-Cancellation Missing.** Customers cannot cancel orders from their account portal.

### P3 — Optional / Minor

1. **P3-1: Order History Immutability.** Order history is stored as a mutable array within MongoDB document rather than an append-only collection.
2. **P3-2: Gateway Payment Method Detail Synchronization.** Exact instrument (UPI VPA, card brand, netbanking bank) not parsed and stored on `Payment` document.

---

## 27. Production Readiness Scores

```text
===================================================================
SV HUB PAYMENT PRODUCTION READINESS SCORECARD
===================================================================
Payment Correctness:       5 / 10  (Happy path works; edge cases fail)
Payment Security:          6 / 10  (HMAC verified; capture status ignored)
Idempotency:               4 / 10  (Sequential works; concurrent races fail)
Webhook Reliability:       0 / 10  (COMPLETELY MISSING)
Inventory Consistency:     4 / 10  (Atomic $inc works; crash & race vulnerable)
Refund Readiness:          0 / 10  (COMPLETELY MISSING)
Failure Recovery:          2 / 10  (No reconciliation, no polling, drops lost)
Authorization:             8 / 10  (Strong customer isolation on API)
Database Integrity:        5 / 10  (Unique indexes on payment, but no trans lock)
Observability:             4 / 10  (Request logger present; payment audit missing)
-------------------------------------------------------------------
OVERALL PAYMENT PRODUCTION READINESS: 38 / 100
VERDICT: UNSAFE FOR REAL-MONEY PRODUCTION TRAFFIC
===================================================================
```

---

## 28. Recommended Phase 2.4B Implementation Plan

### Step 1: Webhook Infrastructure & Asynchronous Confirmation
- Create `POST /api/payments/razorpay/webhook` with dedicated raw-body buffer parsing (`express.raw({ type: 'application/json' })`).
- Verify webhook signature using `crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)` against `req.headers['x-razorpay-signature']`.
- Store every event in a dedicated `WebhookEvent` collection with unique constraint on `eventId` to ensure idempotency.
- Handle `payment.captured`, `payment.failed`, `refund.processed`, and `refund.failed`.

### Step 2: Concurrency Hardening & Atomic State Transitions
- Implement atomic compare-and-set state locking:
  ```javascript
  const lockedOrder = await Order.findOneAndUpdate(
    { _id: orderId, status: 'PENDING_PAYMENT' },
    { $set: { status: 'CONFIRMING' } },
    { new: true }
  )
  if (!lockedOrder) {
    // Already confirming or confirmed; return idempotent state or reject
  }
  ```
- Wrap inventory deduction, payment update, order confirmation, and cart clearing in a unified MongoDB replica set transaction session.

### Step 3: Upstream Gateway Status Enforcement
- Enforce strict payment fetch verification:
  - Verify `rzpPayment.status === 'captured'` and `rzpPayment.captured === true`.
  - Verify `rzpPayment.amount === expectedPaise`.
  - Verify `rzpPayment.currency === 'INR'`.
  - Verify `rzpPayment.order_id === payment.razorpayOrderId`.
- Throw and halt verification if gateway fetch fails; do not silently swallow errors.

### Step 4: Automated Refund Engine
- Create `services/refundService.js` integrating `razorpay.payments.refund(paymentId, { amount, notes })`.
- Automate instant refunds when inventory deduction fails (`REQUIRES_RECONCILIATION`).
- Automate full refunds when an admin cancels a paid order.

### Step 5: Inventory Restoration on Cancellation
- Update `cancelAdminOrder` to inspect `order.status` and `order.paymentStatus`. If order was `CONFIRMED`, atomically increment product variant stock back to the catalogue via `$inc`.

### Step 6: Rate Limiting & Abuse Prevention
- Mount `express-rate-limit` on all payment endpoints:
  - `/api/payments/razorpay/create-order`: 10 requests / minute per user.
  - `/api/payments/razorpay/verify`: 15 requests / minute per IP/user.

### Step 7: Automated Reconciliation Background Worker
- Implement a scheduled worker (e.g. running every 15 minutes) scanning for orders in `PENDING_PAYMENT` older than 30 minutes.
- Query Razorpay API for order status; if captured upstream, trigger reconciliation fulfillment or refund.

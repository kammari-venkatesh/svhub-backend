# PHASE 2.1 — SV HUB RAZORPAY TEST PAYMENT INTEGRATION

## 1. Executive Summary
Phase 2.1 introduces end-to-end Razorpay Test Mode payments to the SV Hub commerce platform. The integration preserves backend authority over pricing, cart totals, and inventory management, enforcing strict separation of concerns between our internal MongoDB SV Hub orders and external Razorpay payment provider entities.

---

## 2. Architecture Overview
- **Frontend Layer (React 19 + Vite)**: Standard Checkout modal integration via `checkout.razorpay.com/v1/checkout.js` dynamic script loader (`src/lib/razorpay.js`). Zero visual or layout alterations. Cart is strictly preserved during checkout initialization and only cleared after successful cryptographic payment verification.
- **Backend Layer (Node.js + Express + Mongoose)**:
  - `POST /api/payments/razorpay/create-order`: Validates order ownership and payable status, computes integer paise from authoritative MongoDB total, creates Razorpay Order, and records a `Payment` transaction document.
  - `POST /api/payments/razorpay/verify`: Validates HMAC SHA-256 signature using `RAZORPAY_KEY_SECRET`, matches server-stored order ID, enforces amount authority, atomically deducts stock with automatic rollback, marks Payment `SUCCESS` / `PAID`, marks Order `CONFIRMED`, and clears the customer's cart.
  - `POST /api/payments/razorpay/record-failure`: Logs client checkout dismissals or payment gateway rejections, preserving cart items and preventing premature order confirmation.

---

## 3. Environment Variables
Server-side credentials must be provided in `svhub-backend/.env` (documented in `.env.example`):

```env
# Razorpay Test Mode Credentials
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

### Security Compliance
- `RAZORPAY_KEY_SECRET`, `MONGO_URI`, `JWT_SECRET`, and `FIREBASE_PRIVATE_KEY` remain strictly server-side.
- Public client bundle receives only `keyId`, `razorpayOrderId`, `amount` (in paise), `currency` (`INR`), and customer prefill snapshots.
- Public security scans verify zero secrets are exposed in build artifacts or public API responses.

---

## 4. Payment Flow & State Transitions

```text
Customer Checkout
        ↓
POST /api/orders
        ↓
SV Hub Order created (status: PENDING_PAYMENT, paymentStatus: PENDING)
        ↓
POST /api/payments/razorpay/create-order
        ↓
Backend loads SV Hub Order & verifies customer ownership
        ↓
Backend computes authoritative integer paise (order.totalAmount * 100)
        ↓
Razorpay Order created & Payment record created (status: CREATED)
        ↓
Frontend opens Razorpay Checkout modal
        ↓
Customer completes payment
        ↓
Razorpay returns: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
        ↓
POST /api/payments/razorpay/verify
        ↓
Backend verifies HMAC-SHA256 signature against server-stored razorpayOrderId
        ↓
Backend verifies amount & payment status
        ↓
Atomic inventory deduction (variants.qty >= requested and qty >= requested)
        ↓
Payment = SUCCESS (or PAID)
Order = CONFIRMED
Cart = CLEARED
```

### State Matrix
| Stage | Order Status | Payment Status | Inventory State | Customer Cart |
| :--- | :--- | :--- | :--- | :--- |
| **Order Placement** | `PENDING_PAYMENT` | `PENDING` | Undeducted | Preserved |
| **Razorpay Order Created**| `PENDING_PAYMENT` | `CREATED` | Undeducted | Preserved |
| **Modal Dismissed / Cancelled**| `PENDING_PAYMENT` | `FAILED` / `PENDING` | Undeducted | Preserved |
| **Signature Failure** | `PENDING_PAYMENT` | `FAILED` | Undeducted | Preserved |
| **Stock Conflict (Out of Stock)**| `REQUIRES_RECONCILIATION`| `FAILED` | Rolled back / intact | Preserved |
| **Verified Payment** | `CONFIRMED` | `SUCCESS` / `PAID` | Atomically deducted | Cleared |

---

## 5. Security & Verification Engine

### 5.1 Server-Side Cryptographic Signature Verification
To prevent forged frontend confirmations, the backend strictly verifies the HMAC SHA-256 signature using our server-stored Razorpay order ID:

```javascript
const payload = `${serverOrderId}|${paymentId}`;
const expectedSignature = crypto
  .createHmac('sha256', keySecret)
  .update(payload)
  .digest('hex');

const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
const clientBuffer = Buffer.from(String(signature), 'utf8');
const isSignatureValid = expectedBuffer.length === clientBuffer.length &&
  crypto.timingSafeEqual(expectedBuffer, clientBuffer);
```

### 5.2 Server-Stored Order ID & Amount Authority
- The server checks `frontend.razorpay_order_id === payment.razorpayOrderId`. Tampered or mismatched order IDs are rejected with HTTP 400 (`mismatched_razorpay_order_id`).
- Authoritative order totals are sourced from MongoDB (`order.totalAmount`). Any client attempt to submit a lower amount (e.g. ₹1 instead of ₹1000) is rejected with HTTP 400 (`amount_mismatch`).

---

## 6. Inventory Atomicity & Idempotency

### 6.1 Atomic Stock Deduction with Rollback
Stock is never deducted upon order creation or payment initiation. It is deducted atomically only after signature verification:

```javascript
Product.updateOne(
  {
    _id: item.productId,
    'variants.variantId': item.variantId,
    'variants.qty': { $gte: item.quantity },
    qty: { $gte: item.quantity },
  },
  {
    $inc: {
      'variants.$.qty': -item.quantity,
      qty: -item.quantity,
    },
  }
);
```

- When replica set sessions are available, deductions run within an ACID MongoDB transaction.
- If transactions are unavailable or any line item fails stock check, any previous line deductions in the order are automatically rolled back, order status transitions to `REQUIRES_RECONCILIATION`, and HTTP 409 (`inventory_conflict`) is returned.

### 6.2 Idempotency & Duplicate Protection
If a customer or network glitch re-submits `POST /api/payments/razorpay/verify`:
- The system checks if `order.status === 'CONFIRMED'`, `payment.verified === true`, and `payment.razorpayPaymentId === req.body.razorpay_payment_id`.
- If already confirmed, it immediately returns HTTP 200 with `{ idempotent: true }` without re-deducting stock or modifying totals.

---

## 7. Automated Test Suite

The automated suite `svhub-backend/scripts/verify-payments.js` validates 44 test assertions across 8 categories:

1. **Configuration & Security**:
   - Health endpoint leaks zero payment secrets.
   - Cryptographic HMAC SHA-256 validation unit tests.
   - Tampered signature rejection.
   - Mismatched order ID signature rejection.
   - Missing secret rejection.
   - Public Key ID exposure safety.
2. **Fixture Setup & Order Pre-Payment State**:
   - Multi-user registration & test catalog provisioning.
   - Cart population and initial order creation.
   - Stock remains undeducted upon order creation.
3. **Authorization & Access Control**:
   - Unauthenticated requests rejected with HTTP 401.
   - Cross-customer payment initiation rejected with HTTP 403.
   - Invalid order ID handling (HTTP 400/404).
   - Nonexistent order ID handling (HTTP 404).
4. **Create Order API**:
   - Safe API handling without unhandled crashes.
   - MongoDB `Payment` record created with status `CREATED`.
   - Authoritative amount strictly matched to SV Hub order.
5. **Payment Verification**:
   - Cross-customer verification rejected with HTTP 403.
   - Mismatched Razorpay order ID rejected with HTTP 400.
   - Tampered payment amount rejected with HTTP 400.
   - Invalid cryptographic signature rejected with HTTP 400.
   - Unverified payments leave order as `PENDING_PAYMENT`.
   - Valid cryptographic signature confirms payment (HTTP 200).
   - Order transitions to `CONFIRMED`, paymentStatus `SUCCESS`.
   - Inventory deducted exactly once.
   - Customer cart cleared in MongoDB upon confirmation.
6. **Idempotency**:
   - Re-submitting verification returns idempotent HTTP 200.
   - Zero double-deduction of inventory.
7. **Inventory Conflict & Reconciliation**:
   - Concurrent inventory exhaustion returns HTTP 409.
   - Order marked as `REQUIRES_RECONCILIATION`.
8. **Checkout Cancellation / Failure UX**:
   - Modal dismissal returns HTTP 200.
   - Order remains `PENDING_PAYMENT`.
   - Cart remains preserved.

---

## 8. Regression Verification
All regression suites remain 100% green:
- `scripts/verify-foundation.js`: 13 PASSED
- `scripts/verify-models.js`: 30 PASSED
- `scripts/verify-canonical-products.js`: 230 PASSED
- `scripts/verify-catalog.js`: 23 PASSED
- `scripts/verify-cart-address.js`: 38 PASSED
- `scripts/verify-orders.js`: 21 PASSED
- `scripts/verify-admin-orders.js`: 30 PASSED
- `scripts/verify-admin-catalog.js`: 32 PASSED
- `scripts/verify-admin-management.js`: 43 PASSED
- `scripts/qa-api-audit.js`: 108 PASSED
- `scripts/verify-e2e-commerce.js`: 139 PASSED
- `scripts/verify-payments.js`: 44 PASSED
- **Total Automated Assertions**: **721 PASSED / 0 FAILED**
- **Frontend Production Build**: **PASS** (`vite build` in 751ms)

---

## 9. Remaining Limitations
- Live mode credentials and real financial transactions are strictly deferred.
- Automated refunds and partial capture workflows are deferred to future operational phases.

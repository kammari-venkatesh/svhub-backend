# PHASE 2.4I — REAL RAZORPAY TEST MODE E2E FORENSIC PLAN & ARCHITECTURE AUDIT

SV HUB PRODUCTION PAYMENT SYSTEM

## 1. Executive Summary

This forensic audit analyzes the production payment implementation in SV Hub prior to executing real Razorpay Test Mode end-to-end customer checkout validations.
All components inspected are read-only:
- Frontend: Checkout flow, Razorpay script loader, OrderSuccess, Orders, OrderDetail
- Backend: Payment endpoints (`/create-order`, `/verify`, `/record-failure`, `/webhook`), fulfillment engine, models (`Order`, `Payment`, `Refund`, `Cart`, `AuditLog`, `WebhookEvent`), inventory mutation logic, rate limiting, and audit logging
- Gateway: Razorpay Test Mode integration, configuration, and API connectivity

---

## 2. Component-by-Component Forensic Audit

### 2.1 Frontend Checkout & Payment Flow
- **Component**: `svhub-frontend/src/pages/Checkout/Checkout.jsx`
- **Execution Lifecycle**:
  1. Customer fills out or selects delivery address.
  2. Submits order via `createOrder(orderPayload)`, creating an authoritative `Order` document in MongoDB with status `PENDING_PAYMENT` and `paymentStatus: 'PENDING'`.
  3. Loads Razorpay Standard Checkout SDK dynamically via `loadRazorpayScript()` (`https://checkout.razorpay.com/v1/checkout.js`).
  4. Requests backend payment creation via `createRazorpayOrder(orderData.id)` (`POST /api/payments/razorpay/create-order`).
  5. Receives `keyId`, `amount` (in paise), `currency` (`INR`), and `razorpayOrderId`.
  6. Initializes `new window.Razorpay(options)` with configured callbacks:
     - `handler(response)`: Receives `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`, sends to `verifyRazorpayPayment(...)`, awaits confirmation, clears cart via `clearCart()`, stores snapshot in `sessionStorage`, and navigates to `/order-success`.
     - `modal.ondismiss()`: Flags cancellation, records client failure via `recordPaymentFailure({ orderId, razorpay_order_id, errorReason: 'Customer closed payment checkout modal' })`, and leaves cart preserved.
     - `rzpInstance.on('payment.failed')`: Captures failure details and reports via `recordPaymentFailure(...)` while safely preserving cart and items.

### 2.2 Razorpay Script Loader
- **Component**: `svhub-frontend/src/lib/razorpay.js`
- **Mechanism**: Checks `window.Razorpay`; if not present, dynamically injects `<script src="https://checkout.razorpay.com/v1/checkout.js">` with `async: true` and resolves upon `script.onload`. Rejects with clear message on network failure.

### 2.3 Payment Creation Endpoint
- **Component**: `svhub-backend/src/controllers/paymentController.js` (`createRazorpayOrder`)
- **Route**: `POST /api/payments/razorpay/create-order`
- **Security & Integrity Rules**:
  - `requireAuth` middleware enforces authenticated customer JWT.
  - Ownership check: `String(order.userId) === String(req.user._id)`.
  - Order status must be `PENDING_PAYMENT` and `paymentStatus !== 'SUCCESS'`.
  - Authoritative amount loaded from `order.totalAmount` (converted to INR paise: `Math.round(totalAmount * 100)`).
  - Concurrency lock: Uses atomic `CREATING_${timestamp}` lock on `order.razorpayOrderId` to avoid race conditions.
  - Invokes `razorpay.orders.create({ amount, currency: 'INR', receipt, notes })`.
  - Creates or links `Payment` document with status `CREATED`.
  - Emits audit log `PAYMENT_ORDER_CREATED`.

### 2.4 Payment Verification Endpoint & Shared Fulfillment Service
- **Component**: `svhub-backend/src/controllers/paymentController.js` (`verifyRazorpayPayment`)
- **Engine**: `svhub-backend/src/services/paymentFulfillmentService.js` (`fulfillRazorpayPayment`)
- **Route**: `POST /api/payments/razorpay/verify`
- **Verification Pipeline**:
  1. Validates presence of `orderId`, `razorpayOrderId`, `razorpayPaymentId`, `razorpaySignature`.
  2. Enforces customer ownership (`order.userId === req.user._id`).
  3. Verifies HMAC SHA-256 signature against server secret using timing-safe buffer comparison (`crypto.timingSafeEqual`).
  4. Queries upstream Razorpay API (`razorpay.payments.fetch(razorpayPaymentId)`) to confirm:
     - Gateway payment exists and is associated with the exact `razorpayOrderId`.
     - Payment status is `captured` (or authorized with successful capture).
     - Gateway currency is `INR` and gateway amount matches server authoritative amount.
  5. Enforces State Machine:
     - Orders in `CANCELLED` or `DELIVERED` cannot be resurrected to `CONFIRMED`; captured funds are placed into `REQUIRES_RECONCILIATION`.
     - If order is already `CONFIRMED` and payment `SUCCESS`, returns safe idempotent response (`idempotent: true`) without re-deducting stock or duplicating transactions.
  6. Executes Atomic MongoDB Session/Transaction:
     - Deducts inventory exactly once for each order item variant.
     - Transitions order to `CONFIRMED` and `paymentStatus: 'SUCCESS'`.
     - Updates `Payment` document to `status: 'SUCCESS'`, `capturedAmount: payment.amount`, `refundableAmount: payment.amount`.
     - Selectively removes ordered items from customer's `Cart` document while leaving unrelated items intact.
     - Writes comprehensive `PAYMENT_FULFILLMENT` audit log.

### 2.5 Payment Failure Endpoint
- **Component**: `svhub-backend/src/controllers/paymentController.js` (`recordPaymentFailure`)
- **Route**: `POST /api/payments/razorpay/record-failure`
- **Integrity**:
  - Updates order history with reason note.
  - Updates order `paymentStatus` to `FAILED` (if not already `CONFIRMED`).
  - Updates `Payment` document status to `FAILED`.
  - Leaves order status as `PENDING_PAYMENT` so customer can retry checkout.
  - Never mutates product inventory or empties customer cart.

### 2.6 Razorpay Webhook Ingress
- **Component**: `svhub-backend/src/controllers/webhookController.js`
- **Route**: `POST /api/payments/razorpay/webhook`
- **Integrity**:
  - Validates `X-Razorpay-Signature` over raw request buffer.
  - Deduplicates via `WebhookEvent` model with unique index on `eventId`.
  - Executes shared `fulfillRazorpayPayment({ ..., isWebhook: true })`.
  - Acknowledges with HTTP 200 OK.
  - Known environment limitation: Cloud webhook ingress cannot reach localhost/private NAT without an external tunnel.

### 2.7 Data Models & Integrity Constraints
- **`Order`**: `status` enum (`PENDING_PAYMENT`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `REQUIRES_RECONCILIATION`), `paymentStatus` enum (`PENDING`, `SUCCESS`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`), per-item `restoredQuantity`, and immutable address/item snapshots.
- **`Payment`**: Financial invariants: `capturedAmount >= 0`, `refundedAmount >= 0`, `refundableAmount = capturedAmount - refundedAmount`, `refundedAmount <= capturedAmount`.
- **`Refund`**: Authoritative gateway refund tracking, unique `idempotencyKey` index, and line-item restoration linkage.
- **`Cart`**: Atomic selective item pull by product/variant IDs.
- **`AuditLog`**: Append-only security log with recursive redaction of credentials/tokens and immutable Mongoose middleware hooks.

### 2.8 Customer Post-Order Experiences
- **`OrderSuccess.jsx`**: Reads order state from navigation state or fetches fresh order by ID/number from `/api/orders/:id`. Refreshing or reloading does not trigger duplicate mutations.
- **`Orders.jsx`**: Lists all customer orders with statuses, dates, item counts, and totals.
- **`OrderDetail.jsx`**: Displays real-time timeline, items, delivery tracking, and payment breakdown.

---

## 3. Plan of Execution for Phase 2.4I

1. **Test Mode Configuration Verification**: Confirm `rzp_test_` key ID prefix, test secret validity, and absence of `rzp_live_`.
2. **Database Baseline Capture**: Record pre-test counts for Orders, Payments, Refunds, WebhookEvents, product inventory, and customer cart.
3. **Controlled Real Test Mode Payment**:
   - Customer authentication & cart creation.
   - Real backend order creation (`PENDING_PAYMENT`).
   - Real Razorpay Test Mode order creation via `api.razorpay.com`.
   - Real Razorpay payment capture via official Test Mode flow.
   - Verification submission (`/api/payments/razorpay/verify`).
   - Confirmation of exact-once fulfillment, inventory deduction, and cart cleanup.
   - OrderSuccess page verification and duplicate verification idempotency check.
4. **Controlled Real Test Mode Failed Payment**:
   - Trigger official Test Mode failure.
   - Confirm safe preservation of inventory, cart, and payable order state.
5. **Controlled Checkout Dismissal / Abandonment**:
   - Modal closed without payment.
   - Confirm zero inventory deduction, cart preserved, and order remaining payable.
6. **Database Integrity & Financial Invariant Audit**:
   - Re-run `scripts/audit-db-integrity.js`.
   - Validate financial balance equations across all payments.
7. **Full Regression Execution**:
   - Run complete suite (Phase 2.1 through 2.4H-R, frontend build, secret audit).
8. **Final Reporting & Documentation**:
   - Produce `docs/PHASE_2_4I_REAL_RAZORPAY_E2E.md` and `tests/verify-phase2-4i-real-razorpay.js`.

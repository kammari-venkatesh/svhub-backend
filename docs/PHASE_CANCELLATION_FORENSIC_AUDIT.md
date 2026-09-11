# Phase — Customer + Admin Order Cancellation Forensic Audit
**Document**: `docs/PHASE_CANCELLATION_FORENSIC_AUDIT.md`  
**Application**: SV Hub E-Commerce Platform (Nutri-Hub & Self-Care)  
**Date**: September 2026  
**Status**: READ-ONLY FORENSIC AUDIT COMPLETE  

---

## 1. Executive Summary

A comprehensive forensic audit of the SV Hub repository was conducted to inspect all customer and admin order cancellation, payment, refund, inventory restoration, state machine, and concurrency logic.

The codebase already contains robust building blocks:
1. Razorpay webhook reconciliation, atomic inventory reservation/deduction via MongoDB transactions, and durable refund ledgering (`Refund` model with `idempotencyKey`).
2. Dual existing cancellation controllers: `cancelCustomerOrder` in `src/controllers/orderController.js` and `cancelAdminOrder` in `src/controllers/adminOrderController.js`.
3. Inventory accounting fields on order items (`quantity`, `restoredQuantity`) and order flags (`inventoryDeducted`, `inventoryRestored`).
4. Resurrection protection in `paymentFulfillmentService.js` preventing `CANCELLED` orders from being resurrected into `CONFIRMED` upon late payment capture.

However, several critical architectural defects, inconsistencies, and loopholes were discovered that compromise production safety:
* **Duplicate Business Logic**: Customer and admin cancellations have duplicate 180-line transaction blocks with divergent refund behaviors.
* **Bypass via Admin PATCH**: `PATCH /api/admin/orders/:id` permits setting `status: 'CANCELLED'` directly, which mutates the status without restoring inventory, without initiating refunds, and without transaction locks.
* **Idempotency Violation**: Both customer and admin cancel endpoints return HTTP 400 `order_already_cancelled` on repeated calls instead of an idempotent, deterministic safe response.
* **Missing Customer Frontend Action**: `src/pages/Account/OrderDetail.jsx` has no cancellation UI or button; `src/api/orders.js` lacks a client API method.

---

## 2. Current Architecture & Endpoints

### 2.1 Existing Endpoints

| Endpoint | Method | Middleware | Controller Handler | Purpose |
|---|---|---|---|---|
| `/api/orders/:id/cancel` | `POST` | `requireAuth`, `orderCancelRateLimiter` | `cancelCustomerOrder` (`orderController.js:448`) | Customer self-service cancellation |
| `/api/admin/orders/:id/cancel` | `POST` | `requireAuth`, `requireAdmin`, `adminMutationRateLimiter` | `cancelAdminOrder` (`adminOrderController.js:598`) | Administrative order cancellation |
| `/api/admin/orders/:id` | `PATCH` | `requireAuth`, `requireAdmin`, `adminMutationRateLimiter` | `updateAdminOrder` (`adminOrderController.js:379`) | General order update (status, courier, etc.) |

---

## 3. Current State Machine & Transition Rules

### 3.1 Order Status Enums (`Order.js`)
* `PENDING_PAYMENT` (initial created state)
* `CONFIRMED` (payment captured, inventory deducted)
* `PROCESSING` (kitchen/warehouse packing)
* `SHIPPED` (dispatched with courier/tracking)
* `OUT_FOR_DELIVERY` (last-mile delivery)
* `DELIVERED` (terminal fulfillment)
* `CANCELLED` (terminal cancellation)
* `REQUIRES_RECONCILIATION` (ambiguous / conflict state)

### 3.2 Existing Allowed Transitions in `adminOrderController.js`
```javascript
const ALLOWED_ORDER_TRANSITIONS = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'REQUIRES_RECONCILIATION'],
  PROCESSING: ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REQUIRES_RECONCILIATION: ['CANCELLED'],
}
```

### 3.3 Cancellation Rules in Controllers
* **Customer**:
  - `PENDING_PAYMENT` &rarr; `CANCELLED` (Allowed)
  - `CONFIRMED` &rarr; `CANCELLED` (Allowed)
  - `PROCESSING` &rarr; `CANCELLED` (Allowed)
  - `SHIPPED`, `OUT_FOR_DELIVERY` &rarr; Blocked (`cannot_cancel_in_transit`)
  - `DELIVERED` &rarr; Blocked (`cannot_cancel_delivered`)
  - `CANCELLED` &rarr; Rejects with HTTP 400 (`order_already_cancelled`)
* **Admin**:
  - Same as customer, except reason is strictly required (`cancellation_reason_required`).
  - Rejects with HTTP 400 if already `CANCELLED` or `DELIVERED`.

---

## 4. Current Payment & Refund Interaction

### 4.1 Unpaid Orders (`PENDING_PAYMENT`)
* Inventory was never deducted (`inventoryDeducted === false`).
* Cancellation simply marks `status = 'CANCELLED'`.
* No refund is attempted or created.
* Invariant holds.

### 4.2 Paid Orders (`CONFIRMED`, `PROCESSING`)
* `Payment.status` is `SUCCESS` or `PAID`.
* `livePayment.refundableAmount` holds remaining balance.
* **Customer controller**: Immediately invokes `initiateRefund` with `source: 'cancellation'`, `idempotencyKey: 'cust_cancel_rfnd_<orderId>'`, and `amount = livePayment.refundableAmount`.
* **Admin controller**: Only invokes `initiateRefund` if `req.body.autoRefund === true || req.body.refund === true`. If absent, payment is simply marked with `reconciliationReason: 'Order cancelled by admin after payment capture; refund pending'`, but no refund is queued or processed.

### 4.3 Refund Accounting & Gateway Integration
* `initiateRefund` (`refundReconciliationService.js`) checks `livePayment.refundableAmount`, decrements balance atomically within a transaction, creates a `Refund` record (`status: 'CREATED'`), and calls `razorpay.payments.refund(...)`.
* On gateway success, `Refund.status` becomes `PROCESSED`.
* On gateway timeout/uncertainty, `Refund.status` becomes `REQUIRES_RECONCILIATION`.
* Invariant: Real money is never marked refunded unless Razorpay API or webhook confirms.

---

## 5. Current Inventory Interaction & Exact-Once Invariant

### 5.1 Deduction Model
* Inventory is deducted atomically upon successful payment verification (`paymentFulfillmentService.js:450`) using `deductOrderInventory`.
* When deducted, `order.inventoryDeducted = true`.

### 5.2 Restoration Accounting
* Each line item in `Order.items` tracks:
  - `item.quantity`: Original ordered units.
  - `item.restoredQuantity`: Total units already restored back to stock.
* During cancellation:
  ```javascript
  const ordered = Number(item.quantity) || 0
  const alreadyRestored = Number(item.restoredQuantity) || 0
  const remainingRestorable = Math.max(0, ordered - alreadyRestored)
  if (remainingRestorable > 0) {
    itemsToRestore.push({ ... item, quantity: remainingRestorable })
    item.restoredQuantity = ordered
  }
  ```
* Stock is restored using MongoDB `$inc` in `restoreOrderInventory`.
* `order.inventoryRestored = true`.

### 5.3 Conflict with Refunds
* When `initiateRefund` runs after cancellation, it checks:
  ```javascript
  if (!liveOrder.inventoryDeducted || liveOrder.inventoryRestored) {
    liveRefund.inventoryRestorationStatus = 'NOT_APPLICABLE'
  }
  ```
  This prevents double-restoration if cancellation runs before refund.
* Similarly, if a partial refund previously restored 1 unit out of 3, `item.restoredQuantity` is 1, so cancellation only restores `3 - 1 = 2` units.
* The invariant `restoredQuantity <= ordered` holds per item.

---

## 6. Concurrency & Race Condition Behavior

### 6.1 Cancellation vs Cancellation Race
* Handled via MongoDB transactions with up to 3 retry attempts on `WriteConflict` or `TransientTransactionError`.
* Inside the transaction, the order is re-queried (`Order.findById(id).session(session)`).
* If the first request commits `CANCELLED`, the second request reads `liveOrder.status === 'CANCELLED'`.
* **Defect**: The second request currently throws an HTTP 400 error (`order_already_cancelled`) instead of returning an idempotent success response.

### 6.2 Cancellation vs Payment Verification Race
* Handled via `paymentFulfillmentService.js:366` ("Resurrection Protection"):
  - If payment succeeds on Razorpay but the order was already `CANCELLED`, the order is NOT resurrected into `CONFIRMED`.
  - Instead, the payment is recorded as `SUCCESS`, `refundableAmount` is preserved, and the order status is transitioned to `REQUIRES_RECONCILIATION` with an audit trail.

### 6.3 Cancellation vs Webhook Race
* Razorpay webhooks invoke `paymentFulfillmentService.fulfillPayment`.
* Because of resurrection protection, a late webhook cannot overwrite a `CANCELLED` order into `CONFIRMED`.

---

## 7. Identified Defects & Vulnerabilities

| # | Severity | Defect | Root Cause | Impact |
|---|---|---|---|---|
| **D1** | **High** | Admin `PATCH /api/admin/orders/:id` status bypass | `updateAdminOrder` allows setting `status: 'CANCELLED'` directly without invoking cancellation logic. | Bypasses inventory restoration, refund initiation, and payment reconciliation. Stock remains deducted; customer is not refunded. |
| **D2** | **Medium** | Lack of Centralized Cancellation Service | Duplicate ~180-line cancellation logic in `orderController.js` and `adminOrderController.js`. | Divergent behavior between customer and admin cancellation; duplicate maintenance; code drift risk. |
| **D3** | **Medium** | Idempotency Failure on Repeated Cancellation | Both controllers abort transaction and return HTTP 400 `order_already_cancelled`. | Fails Phase 11 idempotency requirement: repeated cancellation must return a deterministic safe response without error. |
| **D4** | **Medium** | Missing Customer Cancellation UI | `src/pages/Account/OrderDetail.jsx` has no Cancel button, modal, or action handler. | Customers cannot cancel orders from the account portal. |
| **D5** | **Low** | Missing Customer API Method | `src/api/orders.js` has no `cancelOrder(id, reason)` client function. | Frontend has no standardized client helper. |
| **D6** | **Low** | Admin Auto-Refund Inconsistency | Customer cancellation auto-initiates refund on paid orders; admin cancellation only does so if `autoRefund: true` is explicitly passed in body. | Inconsistent financial defaults; admins cancelling paid orders via UI may forget to trigger refund. |

---

## 8. Recommended Implementation Plan

1. **Centralize Cancellation Engine (`src/services/orderCancellationService.js`)**:
   - Create one canonical service `cancelOrder({ orderId, user, role, reason, autoRefund, req })`.
   - Manage transaction, concurrency retry, inventory restoration accounting, payment status coordination, refund dispatch, and audit logging in this single service.
2. **Refactor Controllers**:
   - `orderController.js:cancelCustomerOrder` delegates entirely to `orderCancellationService.cancelOrder`.
   - `adminOrderController.js:cancelAdminOrder` delegates entirely to `orderCancellationService.cancelOrder`.
   - `adminOrderController.js:updateAdminOrder` catches `status === 'CANCELLED'` and routes through `orderCancellationService` (or rejects with redirect to cancel endpoint).
3. **Enforce Idempotency**:
   - If `order.status === 'CANCELLED'`, return `{ success: true, idempotent: true, message: 'Order is already cancelled.', data: formatPublicOrder(order) }`.
4. **Integrate Customer Cancellation UI**:
   - Add a "Cancel Order" button in `Account/OrderDetail.jsx` (visible when order is eligible: `PENDING_PAYMENT`, `CONFIRMED`, or `PROCESSING`).
   - Confirmation dialog with optional reason selection.
   - Refresh order state from backend on success.
5. **Update Admin Order UI**:
   - Ensure the cancellation dialog and actions properly trigger the centralized flow and display refund/reconciliation outcomes clearly.
6. **Comprehensive Automated Test Suite**:
   - Create `scripts/verify-order-cancellation.js` covering all 44+ test cases outlined in Phase 17.

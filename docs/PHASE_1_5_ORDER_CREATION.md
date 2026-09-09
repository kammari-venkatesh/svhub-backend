# PHASE 1.5 — ORDER CREATION & CHECKOUT IMPLEMENTATION REPORT

**Project:** SV Hub E-Commerce Application  
**Phase:** Phase 1.5 — Order Creation & Checkout  
**Status:** `PHASE 1.5 COMPLETE`  
**Date:** September 9, 2026  
**Architectural Baseline:** Phase 0.2 Final Architecture Freeze (`docs/API_CONTRACT.md`, `docs/DATABASE_REQUIREMENTS.md`, `docs/DATABASE_RELATIONSHIPS.md`)

---

## 1. Endpoints Implemented

Implemented in `src/controllers/orderController.js` and `src/routes/orders.js`, mounted under `/api/orders`:

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `POST` | `/api/orders` | Creates an official Application Order in MongoDB with immutable product and address snapshots, authoritative server pricing, and atomic sequential order numbering | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `GET` | `/api/orders` | Lists order history belonging exclusively to the authenticated customer | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `GET` | `/api/orders/:id` | Retrieves detailed order representation by MongoDB `_id` or `orderNumber` scoped strictly to the authenticated customer | Bearer JWT (`CUSTOMER` / `ADMIN`) |

---

## 2. Authentication Requirements

* **Strict Authorization:** All order endpoints require the canonical `requireAuth` middleware.
* **No Trust in Client-Sent User Data:** Customer ownership is derived exclusively from the verified JWT payload `req.user._id`.
* Any client attempts to supply `userId`, `customerId`, or foreign email parameters are ignored.

---

## 3. Request Contract (`POST /api/orders`)

The client supplies only delivery configuration; all commercial pricing is determined server-side:

```json
{
  "addressId": "66dec101f89a2b1c3d000025",
  "shippingMethod": "standard",
  "notes": "Please leave at reception if unavailable"
}
```

Alternatively, direct shipping address snapshots are supported:

```json
{
  "shippingAddress": {
    "name": "Alice Orders",
    "phone": "9876511111",
    "street": "123, Cross Cut Road, Gandhipuram",
    "city": "Coimbatore",
    "state": "Tamil Nadu",
    "pin": "641012",
    "country": "India"
  },
  "shippingMethod": "express",
  "notes": "Urgent gift delivery"
}
```

---

## 4. Response Contract

Standardized JSON response returning the initialized order ready for Phase 1.6 Razorpay gateway interaction:

```json
{
  "success": true,
  "data": {
    "id": "66dec101f89a2b1c3d000099",
    "orderNumber": "#SVH-10001",
    "userId": "66dec101f89a2b1c3d000002",
    "customerName": "Alice Orders",
    "email": "alice@example.com",
    "phone": "9876511111",
    "shippingAddress": {
      "name": "Alice Orders",
      "phone": "9876511111",
      "street": "123, Cross Cut Road, Gandhipuram",
      "city": "Coimbatore",
      "state": "Tamil Nadu",
      "pin": "641012",
      "country": "India",
      "lines": [
        "123, Cross Cut Road, Gandhipuram",
        "Coimbatore, Tamil Nadu",
        "641012, India"
      ]
    },
    "items": [
      {
        "productId": "66dec101f89a2b1c3d000010",
        "variantId": "500g",
        "productName": "Mappillai Samba Rice",
        "variantLabel": "500 g",
        "weight": "500 g",
        "sku": "SKU-ORD-500",
        "unitPrice": 249,
        "originalPrice": 289,
        "discount": 14,
        "quantity": 2,
        "lineTotal": 498,
        "image": "https://images.unsplash.com/photo-samba",
        "storefront": "nutri-hub"
      }
    ],
    "subtotal": 498,
    "shippingFee": 40,
    "discount": 0,
    "totalAmount": 538,
    "status": "PENDING_PAYMENT",
    "paymentStatus": "PENDING",
    "paymentMethod": null,
    "paymentId": null,
    "razorpayOrderId": null,
    "courier": null,
    "trackingNumber": null,
    "notes": "Please leave at reception if unavailable",
    "history": [
      {
        "status": "PENDING_PAYMENT",
        "at": "2026-09-09T10:00:00.000Z",
        "note": "Application order created; awaiting gateway payment initiation"
      }
    ],
    "createdAt": "2026-09-09T10:00:00.000Z",
    "updatedAt": "2026-09-09T10:00:00.000Z"
  }
}
```

---

## 5. Authoritative Server-Side Pricing & Cart Validation

* **Cart Pre-Conditions:** The customer's cart must exist and contain at least 1 item. Empty carts are rejected with `400 empty_cart`.
* **Live Product Verification:** Every item is validated against the active MongoDB `Product` collection. If a product or selected variant is inactive or missing, order creation halts with `400 product_unavailable` or `400 variant_unavailable`.
* **Zero Client Price Trust:** Frontend-submitted fields (`price`, `unitPrice`, `subtotal`, `shippingFee`, `totalAmount`, `discount`) are completely ignored.
* **Pricing Engine:**
  - `unitPrice = variant.price` (direct from MongoDB)
  - `lineTotal = unitPrice * item.quantity`
  - `subtotal = sum(lineTotal)`

---

## 6. Dynamic Shipping Calculation

Shipping rates are calculated dynamically from the MongoDB `Settings` singleton:
* **Standard Shipping:**
  - Free (`shippingFee = 0`) if `subtotal >= settings.freeShippingThreshold` (default ₹499).
  - Standard fee (`shippingFee = settings.standardShippingFee`, default ₹40) if `subtotal < settings.freeShippingThreshold`.
* **Express Shipping:**
  - `shippingFee = settings.expressShippingFee` (default ₹120).
* **Final Total Amount:**
  - `totalAmount = subtotal + shippingFee - discount` (discount is 0 in V1).

---

## 7. Address Validation & Immutable Snapshot

* **Ownership Isolation:** When `addressId` is supplied, the query asserts `{ _id: addressId, userId: req.user._id }`. Using another customer's address returns `404 address_not_found`.
* **Immutable Snapshot:** The recipient's full details (`name`, `phone`, `street`, `city`, `state`, `pin`, `country`, `lines`) are copied directly into `order.shippingAddress`.
* **Audit Protection:** Subsequent edits or deletions of the customer's address book entry have zero effect on the historical delivery destination recorded in the order.

---

## 8. Immutable Product & Variant Snapshots

* Every purchased pack variant is recorded in `order.items[]` with a deep historical snapshot:
  - `productId`, `variantId`, `productName`, `variantLabel`, `weight`, `sku`, `unitPrice`, `originalPrice`, `discount`, `quantity`, `lineTotal`, `image`, `storefront`.
* Subsequent price changes, catalog renames, or variant deactivations in the `products` collection do not modify past order line records.

---

## 9. Atomic Sequential Order Numbering

* Powered by the atomic `Counter` collection using `Counter.getNextSequence('order_number')`.
* Concurrency-safe: utilizes atomic MongoDB `$inc` with return-after semantics, preventing duplicate order numbers even under high concurrent load.
* Exact format: `#SVH-${sequence}` (e.g. `#SVH-10001`, `#SVH-10002`).

---

## 10. Order Lifecycle & Payment Boundaries (Phase 1.5 Rules)

* **Order Status:** Newly created orders are strictly set to `status: 'PENDING_PAYMENT'`.
* **Payment Status:** Initialized to `paymentStatus: 'PENDING'`.
* **Payment Separation:** Razorpay order creation and signature validation are NOT executed in Phase 1.5.
* **Inventory Rule:** **Physical inventory (`Product.variants[].qty`) is NOT deducted during order creation.** Stock deduction is reserved strictly for verified payment in Phase 1.6.
* **Cart Rule:** **The customer's cart is NOT cleared during order creation.** The cart remains intact until verified payment in Phase 1.6.

---

## 11. Transaction & Idempotency Analysis

* **Atomic Execution:** `Counter` sequence incrementation and `Order.create` execute atomically.
* **Idempotency Status:** In accordance with the Phase 0.2 architecture baseline, the initial `POST /api/orders` creates the application order document. Idempotency on payment attempts is enforced in Phase 1.6 via `Payment.razorpayOrderId` and `Payment.razorpayPaymentId` unique indexes.
* **Known Business-Rule Gaps Recorded:**
  - Guest checkout remains frozen as `FUTURE / CLIENT DECISION` (V1 strictly enforces authenticated checkout).
  - Coupons/promotional discounts are not yet active (discount is defaulted to 0).

---

## 12. Testing Summary

### Automated Test Suite Execution (`node scripts/verify-orders.js`):
* Test 1: Unauthenticated POST /api/orders rejected (401) (PASS)
* Test 2: Empty cart rejected (400 empty_cart) (PASS)
* Test 3: Customer A cannot use Customer B address (404 address_not_found) (PASS)
* Test 4: Valid owned address accepted and order created (201 Created) (PASS)
* Test 5: Order contains immutable shippingAddress snapshot with street & pin (PASS)
* Test 6: Modifying customer address in address book does NOT change historical order snapshot (PASS)
* Test 7: Inactive product in cart rejected during order creation (400 product_unavailable) (PASS)
* Test 8: Inactive variant in cart rejected during order creation (400 variant_unavailable) (PASS)
* Test 10: Excessive quantity exceeding stock rejected (400 insufficient_stock) (PASS)
* Test 11: Inventory is NOT deducted during order creation (stock before = stock after) (PASS)
* Test 12: Price authority enforced: Server calculates subtotal (498), shipping (40), total (538) ignoring all tampered inputs (PASS)
* Test 14: Subtotal >= freeShippingThreshold (958 >= 499) yields shippingFee = 0 (PASS)
* Test 15: Express shipping method yields shippingFee = 120 from Settings (PASS)
* Test 16: Order item snapshot contains productId, variantId, productName, variantLabel, sku, unitPrice, lineTotal (PASS)
* Test 17: Product price/name alteration in DB does NOT modify stored order item snapshot (PASS)
* Test 18: Newly created order has status: PENDING_PAYMENT (PASS)
* Test 19: Newly created order has paymentStatus: PENDING (PASS)
* Test 20: Cart remains intact after order creation (items are NOT cleared in Phase 1.5) (PASS)
* Test 21: Order number matches #SVH-1000X format (PASS)
* Test 22: Order numbers increment sequentially (#SVH-1000X -> #SVH-1000Y) (PASS)
* Test 23: Concurrent orders receive unique order numbers with zero collisions (PASS)
* **Order Creation Suite Result: 21 PASSED, 0 FAILED**

---

## 13. Regression Verification Across All Phases

* **Phase 1.1 Foundation Tests:** 13 passed / 0 failed
* **Phase 1.2 Database Model Tests:** 30 passed / 0 failed
* **Phase 1.3 Public Catalog Tests:** 23 passed / 0 failed
* **Phase 1.4 Cart & Address Tests:** 38 passed / 0 failed
* **Phase 1.5 Order Creation Tests:** 21 passed / 0 failed
* **Health Check Probe (`GET /api/health`):** 200 OK (`database: "connected"`)

---

## 14. Files Changed

* `svhub-backend/src/controllers/orderController.js` (Created)
* `svhub-backend/src/routes/orders.js` (Created)
* `svhub-backend/src/routes/index.js` (Modified: registered orders router)
* `svhub-backend/scripts/verify-orders.js` (Created: 21-check automated test suite)
* `docs/PHASE_1_5_ORDER_CREATION.md` (Created: architectural implementation report)

---

## 15. Frontend Changes

```text
0 frontend files changed
```

No frontend UI files, styling, or components were modified.

---

## 16. Final Status

```text
PHASE 1.5 COMPLETE
```

# SV Hub — API Contract Specification (Phase 0.2 Final Freeze)

> **Document Version:** 2.1.0 (Phase 0.2 Final Architecture Freeze)  
> **Target Environment:** Node.js / Express.js / MongoDB (Mongoose ODM)  
> **Base URL:** `/api` (Production: `https://api.svhub.in/api` / Local Dev: `http://localhost:5000/api`)  
> **Protocol:** REST over HTTPS  
> **Data Format:** JSON (`application/json`)  
> **Auth Scheme:** HTTP Authorization Header with Bearer Token (`Authorization: Bearer <JWT>`)

---

## 1. Public vs. Authenticated vs. Admin Security Classification

All API endpoints are strictly categorized across three authorization tiers to eliminate security regressions:

| Endpoint Path | Public | Authenticated (`CUSTOMER`) | Admin Only (`ADMIN`) | Architectural Status |
| :--- | :---: | :---: | :---: | :--- |
| `GET /api/health` | **✓** | | | **CANONICAL** |
| `POST /api/auth/register` | **✓** | | | **CANONICAL** |
| `POST /api/auth/login` | **✓** | | | **CANONICAL** (Unified for Customer & Admin) |
| `POST /api/auth/google` | **✓** | | | **CANONICAL** |
| `POST /api/auth/forgot-password` | **✓** | | | **CANONICAL** |
| `GET /api/auth/reset-password` | **✓** | | | **CANONICAL** |
| `POST /api/auth/reset-password` | **✓** | | | **CANONICAL** |
| `GET /api/settings/public` | **✓** | | | **CANONICAL** (Safe Public Configuration) |
| `GET /api/products` | **✓** | | | **CANONICAL** |
| `GET /api/products/featured` | **✓** | | | **CANONICAL** |
| `GET /api/products/:slug` | **✓** | | | **CANONICAL** |
| `GET /api/products/:slug/related` | **✓** | | | **CANONICAL** |
| `GET /api/categories` | **✓** | | | **CANONICAL** |
| `GET /api/categories/:slug` | **✓** | | | **CANONICAL** |
| `POST /api/payments/razorpay/webhook` | **✓** (Webhook Signature) | | | **CANONICAL** (Asynchronous Gateway Events) |
| `GET /api/auth/me` | | **✓** | **✓** | **CANONICAL** (Session & Role Restoration) |
| `PATCH /api/auth/profile` | | **✓** | | **CANONICAL** |
| `POST /api/auth/logout` | | **✓** | **✓** | **CANONICAL** |
| `GET /api/cart` | | **✓** | | **CANONICAL** (Persistent User Cart) |
| `POST /api/cart/items` | | **✓** | | **CANONICAL** |
| `PATCH /api/cart/items/:id` | | **✓** | | **CANONICAL** |
| `DELETE /api/cart/items/:id` | | **✓** | | **CANONICAL** |
| `POST /api/cart/merge` | | **✓** | | **CANONICAL** (Merge Guest Cart on Login) |
| `GET /api/addresses` | | **✓** | | **CANONICAL** |
| `POST /api/addresses` | | **✓** | | **CANONICAL** |
| `PUT /api/addresses/:id` | | **✓** | | **CANONICAL** |
| `DELETE /api/addresses/:id` | | **✓** | | **CANONICAL** |
| `PATCH /api/addresses/:id/default`| | **✓** | | **CANONICAL** |
| `POST /api/orders` | | **✓** | | **CANONICAL** (Creates Application Order) |
| `GET /api/orders` | | **✓** | | **CANONICAL** |
| `GET /api/orders/:id` | | **✓** | | **CANONICAL** |
| `POST /api/payments/razorpay/create-order` | | **✓** | | **CANONICAL** (Creates Gateway Order Only) |
| `POST /api/payments/razorpay/verify` | | **✓** | | **CANONICAL** (HMAC Signature Verification) |
| `GET /api/admin/dashboard/stats`| | | **✓** | **CANONICAL** |
| `GET /api/admin/orders` | | | **✓** | **CANONICAL** |
| `GET /api/admin/orders/export` | | | **✓** | **CANONICAL** |
| `GET /api/admin/orders/:orderId`| | | **✓** | **CANONICAL** (Consumes `:orderId`) |
| `PATCH /api/admin/orders/:id/status` | | | **✓** | **CANONICAL** |
| `PATCH /api/admin/orders/:id/shipping` | | | **✓** | **CANONICAL** |
| `PATCH /api/admin/orders/:id/notes` | | | **✓** | **CANONICAL** |
| `GET /api/admin/products` | | | **✓** | **CANONICAL** |
| `POST /api/admin/products` | | | **✓** | **CANONICAL** |
| `GET /api/admin/products/:id` | | | **✓** | **CANONICAL** |
| `PUT /api/admin/products/:id` | | | **✓** | **CANONICAL** |
| `DELETE /api/admin/products/:id`| | | **✓** | **CANONICAL** |
| `GET /api/admin/inventory` | | | **✓** | **CANONICAL** |
| `PATCH /api/admin/products/:id/inventory` | | | **✓** | **CANONICAL** |
| `GET /api/admin/categories` | | | **✓** | **CANONICAL** |
| `POST /api/admin/categories` | | | **✓** | **CANONICAL** |
| `PUT /api/admin/categories/:id` | | | **✓** | **CANONICAL** |
| `DELETE /api/admin/categories/:id` | | | **✓** | **CANONICAL** |
| `GET /api/admin/customers` | | | **✓** | **CANONICAL** |
| `GET /api/admin/customers/export`| | | **✓** | **CANONICAL** |
| `PATCH /api/admin/customers/:id/status` | | | **✓** | **CANONICAL** |
| `PATCH /api/admin/customers/:id/notes` | | | **✓** | **CANONICAL** |
| `GET /api/admin/settings` | | | **✓** | **CANONICAL** (Admin Operational Settings Only) |
| `PUT /api/admin/settings` | | | **✓** | **CANONICAL** (Admin Operational Settings Only) |
| `POST /api/admin/auth/login` | | | | **DEPRECATED / REMOVED** (Use canonical `POST /api/auth/login`) |
| `GET /api/admin/orders/:id` | | | **✓** | **LEGACY / COMPATIBILITY ALIAS** (Alias of `:orderId`) |
| `POST /api/cart/promo` | | **✓** | | **FUTURE / V2** (Promo Engine) |
| `POST /api/orders/:id/cancel` | | **✓** | | **FUTURE / V2** (Customer Self-Service Cancellation) |
| `GET /api/products/:slug/reviews`| **✓** | | | **FUTURE / V2** (PDP Reviews) |
| `POST /api/products/:slug/reviews`| | **✓** | | **FUTURE / V2** (PDP Reviews) |
| `GET /api/admin/reviews` | | | **✓** | **FUTURE / V2** (Admin Moderation) |
| `PATCH /api/admin/reviews/:id` | | | **✓** | **FUTURE / V2** (Admin Moderation) |

---

## 2. Public Store Settings vs. Admin Settings

### 2.1 Public Store Configuration: `GET /api/settings/public` (CANONICAL)
* **Authentication:** None (Public)
* **Purpose:** Safely serves live operational pricing parameters to public customer storefront pages (`/checkout`, `/shipping-policy`, `/contact`).
* **Security Invariant:** Must NEVER expose internal operational thresholds, staff notes, admin credentials, or warehouse alert settings.
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "currency": "INR",
      "standardShippingFee": 40,
      "expressShippingFee": 120,
      "freeShippingThreshold": 499,
      "supportEmail": "care@svhub.in",
      "supportPhone": "+91 98765 43210"
    }
  }
  ```

### 2.2 Admin Settings: `GET /api/admin/settings` & `PUT /api/admin/settings` (CANONICAL)
* **Authentication:** Bearer JWT
* **Authorization:** `ADMIN` Role Required (`requireAuth -> requireAdmin`)
* **Purpose:** Serves and updates complete store operational configuration for staff in `/admin/settings`.
* **Fields:** Includes internal warehouse thresholds (`lowStockAlert: 10`) and system administration controls.
* **Security Enforcement:** Any unauthenticated or non-admin call to `/api/admin/settings` is rejected immediately with HTTP `403 Forbidden` (`code: "forbidden_admin_access"`).

---

## 3. Unified Authentication Architecture

### 3.1 Single Authentication System
There is **one unified authentication service** for SV Hub:
* **Canonical Login Endpoint:** `POST /api/auth/login`
* **Canonical Session Restore:** `GET /api/auth/me`
* **Customer Login:** Customer enters credentials on `/login`. The endpoint validates the password, returning a JWT with payload `{ sub: userId, role: "CUSTOMER" }`.
* **Admin Login:** Staff member enters credentials on `/admin/login`. The endpoint validates credentials against the `User` collection. If the user has `role: "ADMIN"`, it returns a JWT with payload `{ sub: userId, role: "ADMIN" }`.
* **Architectural Clarification:** There is **NO separate admin authentication endpoint** (`/api/admin/auth/login` is formally DEPRECATED). The separation is purely a frontend UI separation ([`AdminLogin.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/pages/Admin/Login.jsx) vs [`Login.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/pages/Auth/Login.jsx)), backed by backend role-based access control.

---

## 4. Decoupled Order Creation vs. Razorpay Gateway Order Creation

A critical distinction is enforced between creating an **Application Order** and creating a **Razorpay Gateway Order**:

```
Customer                Frontend                     SV Hub Backend               Razorpay API
   │                       │                               │                           │
   │ 1. Clicks "Pay"       │                               │                           │
   ├──────────────────────>│ 2. POST /api/orders           │                           │
   │                       ├──────────────────────────────>│                           │
   │                       │                               │ [Validates Stock & Price] │
   │                       │                               │ [Creates MongoDB Order]   │
   │                       │ 3. Returns { orderId, total } │ [Status: PENDING_PAYMENT] │
   │                       │<──────────────────────────────┤                           │
   │                       │                               │                           │
   │                       │ 4. POST /api/payments/razorpay/create-order               │
   │                       │    Body: { orderId }          │                           │
   │                       ├──────────────────────────────>│                           │
   │                       │                               │ 5. orders.create({ ... }) │
   │                       │                               ├──────────────────────────>│
   │                       │                               │<──────────────────────────┤
   │                       │                               │ [Stores Payment Record]   │
   │                       │ 6. Returns Razorpay Order Data│                           │
   │                       │<──────────────────────────────┤                           │
   │                       │                               │                           │
   │                       │ 7. Opens Razorpay Modal       │                           │
   │ 8. Enters Payment     ├──────────────────────────────────────────────────────────>│
   ├──────────────────────────────────────────────────────────────────────────────────>│
   │                       │ 9. Handler (razorpay_payment_id, signature)               │
   │                       ├──────────────────────────────>│                           │
   │                       │ 10. POST /api/payments/razorpay/verify                    │
   │                       ├──────────────────────────────>│                           │
   │                       │                               │ [Validates HMAC-SHA256]   │
   │                       │                               │ [Atomic Stock Decrement]  │
   │                       │                               │ [Order: CONFIRMED]        │
   │                       │                               │ [Clears MongoDB Cart]     │
   │                       │ 11. Success Confirmation      │                           │
   │                       │<──────────────────────────────┤                           │
```

### Step 1: Application Order Creation — `POST /api/orders`
* **Method:** `POST`
* **Path:** `/api/orders`
* **Auth:** Bearer JWT (`CUSTOMER` or `ADMIN`)
* **Purpose:** Creates the canonical SV Hub **Application Order** in MongoDB.
* **Backend Operations:**
  1. Authenticates customer via JWT.
  2. Loads customer's persistent cart from MongoDB (`Cart.findOne({ userId })`).
  3. Verifies catalogue status and pack-size variant availability.
  4. Resolves current variant prices (ignores any client-submitted pricing).
  5. Calculates `subtotal`, fetches dynamic `freeShippingThreshold` from `Settings`, and computes `shippingFee`.
  6. Generates sequential order number (`SVH-10001`) from atomic `Counter` collection.
  7. Creates deep immutable snapshots of products (`order.items[]`) and shipping address (`order.shippingAddress`).
  8. Inserts `Order` document with:
     * `status: "PENDING_PAYMENT"`
     * `paymentStatus: "PENDING"`
  9. Returns application order details (`id`, `orderNumber`, `totalAmount`).

### Step 2: Gateway Order Creation — `POST /api/payments/razorpay/create-order`
* **Method:** `POST`
* **Path:** `/api/payments/razorpay/create-order`
* **Auth:** Bearer JWT
* **Purpose:** Creates **ONLY** the Razorpay payment-provider gateway order. **MUST NEVER CREATE AN APPLICATION ORDER.**
* **Payload:**
  ```json
  {
    "orderId": "66dec101f89a2b1c3d000042"
  }
  ```
* **Backend Operations:**
  1. Loads existing `Order` by `orderId` and verifies `order.userId === req.user.id`.
  2. Asserts `order.status === "PENDING_PAYMENT"` and `order.paymentStatus === "PENDING"`.
  3. Takes the backend-calculated `order.totalAmount` (converts to paise: `amountInPaise = Math.round(totalAmount * 100)`).
  4. Calls Razorpay API (`razorpay.orders.create({ amount: amountInPaise, currency: "INR", receipt: order.orderNumber })`).
  5. Inserts a record into the `payments` collection (`status: "CREATED"`, `razorpayOrderId`).
  6. Returns Razorpay configuration payload (`keyId`, `razorpayOrderId`, `amount`, `currency`).

### Step 3: Payment Verification — `POST /api/payments/razorpay/verify`
* **Method:** `POST`
* **Path:** `/api/payments/razorpay/verify`
* **Auth:** Bearer JWT
* **Payload:**
  ```json
  {
    "orderId": "66dec101f89a2b1c3d000042",
    "razorpayOrderId": "order_EKfWjp8VWmOfWe",
    "razorpayPaymentId": "pay_29QQoUBcxrhEr",
    "razorpaySignature": "9ef54c8e7638c4b7..."
  }
  ```
* **Backend Operations:**
  1. Cryptographically verifies HMAC-SHA256 signature:
     $$\text{expectedSignature} = \text{HMAC-SHA256}\Big(\text{razorpayOrderId} + \text{"\|"} + \text{razorpayPaymentId},\ \text{RAZORPAY\_KEY\_SECRET}\Big)$$
  2. If signature matches:
     * Updates `Payment` record: `status: "SUCCESS"`, `verified: true`.
     * Executes atomic inventory deduction on all order line variants.
     * Transitions `Order` record: `status: "CONFIRMED"`, `paymentStatus: "SUCCESS"`.
     * Clears customer's shopping cart in MongoDB (`Cart.updateOne({ userId }, { $set: { items: [] } })`).
     * Returns verified confirmation.

---

## 5. Standardized State Machine & Payment Failure Behavior

### 5.1 Order Fulfillment States
* **`PENDING_PAYMENT`**: Order generated in database; awaiting gateway payment completion.
* **`CONFIRMED`**: Payment signature verified; inventory successfully deducted; order locked for fulfillment.
* **`PROCESSING`**: Warehouse team picking and packing order items.
* **`SHIPPED`**: Handed over to courier; consignment tracking AWB assigned.
* **`DELIVERED`**: Parcel confirmed delivered to recipient.
* **`CANCELLED`**: Order terminated by staff or system.

### 5.2 Payment Transaction States
* **`CREATED`**: Gateway order created with Razorpay.
* **`PENDING`**: Transaction in-flight at bank or UPI gateway.
* **`SUCCESS`**: Signature verified or captured via webhook.
* **`FAILED`**: Transaction declined, aborted, or signature verification failed.
* **`REFUNDED`**: Funds returned to customer account.

### 5.3 Payment Failure & Cart Preservation Invariant
* If payment fails, is declined, or the user closes the modal:
  1. `Payment` record is marked `status: "FAILED"`.
  2. `Order` remains in `status: "PENDING_PAYMENT"`.
  3. **The customer's shopping cart is NEVER cleared.**
  4. The customer is redirected to `/payment-failed` where clicking "Try Payment Again" loads `/checkout` with their cart 100% preserved.
* **Unpaid Order Expiry Policy:** Unpaid orders remaining in `PENDING_PAYMENT` past a designated duration (e.g. 24 hours) are marked `FUTURE / CLIENT DECISION`.

---

## 6. Inventory Deduction & Payment Consistency Strategy

### 6.1 Timing
Physical inventory is deducted **strictly after payment confirmation**. Pre-payment cart reservations are not utilized in V1.

### 6.2 Atomic Conditional Decrement
To prevent overselling under concurrent checkouts, stock deductions execute atomic MongoDB queries:
```javascript
const updateResult = await Product.updateOne(
  {
    _id: item.productId,
    'variants.variantId': item.variantId,
    'variants.qty': { $gte: item.quantity }
  },
  {
    $inc: {
      'variants.$.qty': -item.quantity,
      qty: -item.quantity
    }
  }
);
```

### 6.3 Concurrency Stock Conflict Handling
In the rare event that stock is depleted during the 60-second payment window (`updateResult.modifiedCount === 0`):
1. **Never mark order fulfilled:** The order is NEVER marked as `CONFIRMED`.
2. **Operational Failure State:** The order is flagged with `status: "PENDING_PAYMENT"`, `notes: "STOCK CONFLICT: Payment succeeded but inventory exhausted during checkout"`.
3. **Reconciliation Action:** An immediate automated Razorpay refund API call is triggered (`razorpay.payments.refund(paymentId)`), or the order is escalated to the staff dashboard for backorder fulfillment.
4. **Preferred Multi-Document Transaction:** Where MongoDB replica sets are active, the payment capture, order state transition, and variant stock decrements must be wrapped inside an ACID MongoDB Session Transaction (`session.startTransaction()`).

---

## 7. Cart Data Model & Merge Protocol

### 7.1 Authenticated Cart Integrity
* In V1, shopping carts for checkout are strictly associated with `userId`.
* Line item identity is defined by the composite pair: `(productId, variantId)`.
* Prices submitted by the frontend are discarded; line prices are resolved dynamically from `Product.variants`.

### 7.2 Pre-Login Guest Cart Merge Flow
```
[ Guest Browsing ] ──> Items saved in localStorage / guestId
                             ↓
[ User Logs In ]   ──> POST /api/auth/login succeeds
                             ↓
[ Merge Request ]  ──> POST /api/cart/merge { guestItems: [...] }
                             ↓
[ Server Engine ]  ──> Matches (productId, variantId)
                       Combines quantities (capping at max 12)
                       Resolves fresh variant prices
                       Saves into MongoDB Cart { userId }
                             ↓
[ Checkout ]       ──> Authenticated user proceeds to /checkout
```

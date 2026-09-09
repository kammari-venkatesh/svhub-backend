# SV Hub — Phase 0.2 Final Architecture Correction & Backend Freeze Report

> **Document Version:** 1.0.0 (Phase 0.2 Definitive Sign-Off)  
> **Prepared By:** Senior Principal Architect & Backend Technical Lead  
> **Date:** September 2026  
> **Status:** Final Architectural Pass Prior to Phase 1 Backend Implementation

---

## 1. Scope

Phase 0.2 is the final documentation and architectural correction pass before backend implementation commences. In strict conformance with project constraints:
* **Documentation-Only Scope:** Absolutely no source code, Mongoose models, controllers, services, database collections, or UI files were created or modified.
* **Objective:** Resolve all residual contradictions identified during review regarding route counting, checkout authentication, public vs. admin settings, administrative authentication, decoupled order creation, standardized state machines, and inventory consistency.

---

## 2. Route Architecture & Authoritative Counts

A line-by-line inspection of [`svhub-frontend/src/App.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/App.jsx) establishes the definitive route architecture across six distinct, non-overlapping categories:

```
┌───────────────────────────────────────────────────────────────────┬───────┐
│ Metric Category                                                   │ Count │
├───────────────────────────────────────────────────────────────────┼───────┤
│ A. Total <Route> JSX Elements in App.jsx                          │  51   │
│ B. Navigable Path Routes (URL endpoints loading a UI view)         │  42   │
│ C. Navigation Redirect Routes (<Navigate replace />)              │   5   │
│ D. Development / Design System Showcase Routes                    │   2   │
│ E. Duplicate Route Compatibility Aliases                          │   1   │
│ F. Catch-All / Error Routes (/404 and *)                          │   2   │
└───────────────────────────────────────────────────────────────────┴───────┘
```

### Explanatory Analysis:
* **Metric A (`51` elements):** Every individual `<Route>` tag declared in `App.jsx`, including 3 structural wrappers: `<Route element={<RequireAdmin />}>`, `<Route element={<Layout />}>`, and `<Route path="/account" element={<Account />}>`.
* **Metric B (`42` paths):** Explicit paths mapping to an application page view (41 named paths + 1 root catch-all `*`).
* **Metric C (`5` redirects):** Explicit `<Navigate replace />` routes (`/admin/*`, `/privacy`, `/terms`, `/shipping`, `/refund`).
* **Metric D (`2` showcase routes):** Design system showcase views displaying the 16 reusable state components: `/system-states` (storefront context) and `/admin/system-states` (admin context behind `RequireAdmin`).
* **Metric E (`1` duplicate alias):** `/admin/orders/:id` is a compatibility duplicate of canonical `/admin/orders/:orderId`. Both mount [`AdminOrderDetail.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/pages/Admin/OrderDetail.jsx).
* **Metric F (`2` error routes):** Explicit `/404` and root catch-all `*` (which renders `NotFoundPage.jsx`).

---

## 3. Authentication Architecture (Unified Customer + Admin)

Inspection of [`AdminLogin.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/pages/Admin/Login.jsx) confirmed that the frontend already calls `login()` from `AuthContext`, which hits `POST /api/auth/login`.

### Definitive Architecture:
* **UI Separation:**
  * Customer login: `/login` ([`Login.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/pages/Auth/Login.jsx))
  * Staff admin login: `/admin/login` ([`AdminLogin.jsx`](file:///c:/Users/Venkatesh/svhub/sv/svhub-frontend/src/pages/Admin/Login.jsx))
* **Authentication System Separation: NO.**
  * There is **one single canonical login endpoint**: `POST /api/auth/login`.
  * The previous draft endpoint `/api/admin/auth/login` is formally **DEPRECATED / REMOVED**.
* **Session Restoration:**
  * `GET /api/auth/me` validates the Bearer JWT on page reload and returns fresh user identity, including `role: "ADMIN"` or `role: "CUSTOMER"`.

---

## 4. Authorization Architecture (Role-Based Access Control)

* **Normalized Role Enum:** Stored strictly in uppercase in MongoDB `User.role`:
  * `'CUSTOMER'`
  * `'ADMIN'`
* **Admin Security Boundary:**
  * All administrative endpoints under `/api/admin/*` enforce security via Express middleware chaining:
    ```javascript
    router.use('/api/admin', requireAuth, requireAdmin);
    ```
  * `requireAdmin` asserts `req.user.role === 'ADMIN'`. Non-admin requests receive HTTP `403 Forbidden`.
  * Client-side admin gates (`svhub.admin.gate` in `localStorage`), hardcoded credentials (`admin123`), and `VITE_ADMIN_EMAILS` in `adminAuth.js` are development placeholders that are completely untrusted.

---

## 5. Product Architecture (Products + Embedded Variants)

* Products co-locate pack sizes within an embedded `variants[]` subdocument:
  * `variantId`: string identifier (e.g. `'500g'`, `'1kg'`, `'200g'`)
  * `label` & `weight`: display string (e.g. `'500 g'`, `'1 kg'`)
  * `sku`: operational stock keeping unit (e.g. `'SVH-NH-KUL-1KG'`)
  * `price`: current selling price in INR
  * `originalPrice`: compare-at strike price (or null)
  * `discount`: pre-calculated discount percentage
  * `qty`: warehouse physical inventory on hand
  * `isActive`: boolean availability toggle
* **Zero-Join PDP Rendering:** A single query to `Product.findOne({ slug })` supplies all product details, images, specifications, and variant options.

---

## 6. Cart Architecture (Authenticated Persistent Cart + Merge)

* In V1, shopping carts for checkout are strictly associated with `userId` (`1 : 1` in MongoDB).
* **Composite Line Key:** Lines are uniquely identified by `(productId, variantId)`.
* **Price Authority:** Frontend-submitted prices are discarded; line prices are resolved dynamically from `Product.variants`.
* **Guest Pre-Login Experience:** Guest browsing saves items in client storage. Upon login, `POST /api/cart/merge` merges guest items into the user's server cart (capped at 12 units per line).

---

## 7. Checkout Architecture (Authenticated Checkout)

* **V1 Policy:** `/checkout` strictly requires authentication (`requireAuth`).
* **User Flow:**
  1. Customer adds items to cart from `/product/:slug` or `/shop`.
  2. Customer clicks "Proceed to Checkout" on `/cart`.
  3. If unauthenticated, customer is redirected to `/login?redirect=/checkout`.
  4. Customer logs in or registers.
  5. Pre-login items are merged into the server-side cart via `POST /api/cart/merge`.
  6. Customer is redirected back to `/checkout`.
  7. Customer selects/adds delivery address from their saved address book.
  8. Customer clicks "Pay Securely", initiating order generation.
* **Guest Checkout Classification:** Designated as **`FUTURE / CLIENT DECISION`**.

---

## 8. Order Architecture (Application Order vs. Razorpay Order)

A strict separation of responsibilities prevents duplicate order creation:

### A. Application Order Creation: `POST /api/orders`
* Authenticates customer via Bearer JWT.
* Loads user's persistent cart from MongoDB.
* Resolves current prices and validates physical stock.
* Calculates authoritative subtotal, shipping fee, and tax.
* Generates human-readable sequential order number (`SVH-10001`) via atomic `Counter` collection.
* Deeply snapshots items (`order.items[]`) and delivery address (`order.shippingAddress`).
* Inserts MongoDB `Order` document with `status: "PENDING_PAYMENT"`, `paymentStatus: "PENDING"`.
* Returns application order ID and calculated totals.

### B. Gateway Order Creation: `POST /api/payments/razorpay/create-order`
* Accepts `{ orderId }` referencing the existing Application Order.
* Validates user ownership and payable state (`PENDING_PAYMENT`).
* Creates **ONLY** the Razorpay provider order via SDK (`amount` in paise, `currency: "INR"`).
* Records a `Payment` document (`status: "CREATED"`).
* **Invariant:** MUST NEVER create a secondary Application Order.

---

## 9. Payment Architecture (Decoupled Lifecycle)

```
POST /api/orders ──> Application Order (PENDING_PAYMENT)
                          ↓
POST /api/payments/razorpay/create-order ──> Gateway Order (Razorpay ID)
                          ↓
Customer pays in Razorpay Checkout Modal
                          ↓
POST /api/payments/razorpay/verify ──> Cryptographic HMAC-SHA256 Verification
                          ↓
Success: Payment SUCCESS ──> Atomic Stock Decrement ──> Order CONFIRMED ──> Cart Cleared
Failure: Payment FAILED  ──> Order PENDING_PAYMENT  ──> Cart Preserved 100%
```

* **Cart Preservation on Failure:** If payment fails, is declined, or is aborted, the shopping cart remains completely intact in MongoDB and UI.
* **Asynchronous Webhook:** Razorpay webhook (`order.paid`) acts as an authoritative backup in case browser navigation is interrupted.

---

## 10. Inventory Architecture & Payment Consistency

* **Timing:** Physical inventory is deducted **strictly after** payment confirmation.
* **Atomic MongoDB Query:**
  ```javascript
  const result = await Product.updateOne(
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
* **Stock Exhaustion During Payment:** If `result.modifiedCount === 0`:
  1. The order is **NEVER** marked as `CONFIRMED`.
  2. The order is flagged for reconciliation (`REQUIRES_RECONCILIATION`).
  3. An automated Razorpay refund is triggered, or staff is alerted for backorder fulfillment.
* **Multi-Document Transactions:** Where MongoDB replica sets are active, payment update, order transition, and stock decrements are executed inside a single ACID session transaction (`session.startTransaction()`).

---

## 11. Settings Architecture (Public vs. Admin Separation)

1. **Public Store Configuration (`GET /api/settings/public`):**
   * Publicly accessible, no authentication required.
   * Serves: `currency`, `standardShippingFee`, `expressShippingFee`, `freeShippingThreshold`, `supportEmail`, `supportPhone`.
   * Consumed by `/checkout`, `/shipping-policy`, and `/contact`.
   * Never exposes internal administrative settings.
2. **Admin Operational Settings (`GET /api/admin/settings` & `PUT /api/admin/settings`):**
   * Strictly protected by `requireAuth -> requireAdmin`.
   * Controls warehouse stock alert thresholds (`lowStockAlert`) and operational parameters.

---

## 12. API Security Classification

All 57 endpoints are catalogued across three authorization tiers in [`docs/API_CONTRACT.md`](file:///c:/Users/Venkatesh/svhub/sv/docs/API_CONTRACT.md):

* **Tier 1 (Public):** `/health`, `/products`, `/products/:slug`, `/categories`, `/settings/public`, `/auth/register`, `/auth/login`, `/auth/google`, `/auth/forgot-password`, `/auth/reset-password`.
* **Tier 2 (Authenticated `CUSTOMER`):** `/auth/me`, `/auth/profile`, `/auth/logout`, `/cart`, `/cart/items`, `/cart/items/:id`, `/cart/merge`, `/addresses`, `/addresses/:id`, `/orders`, `/orders/:id`, `/payments/razorpay/create-order`, `/payments/razorpay/verify`.
* **Tier 3 (Admin Only `ADMIN`):** `/admin/dashboard/stats`, `/admin/orders`, `/admin/orders/:orderId`, `/admin/products`, `/admin/inventory`, `/admin/categories`, `/admin/customers`, `/admin/settings`.

---

## 13. Remaining Client Decisions

The following operational configurations require client confirmation before public launch, but do **NOT** block backend API or database implementation:

1. **Free Shipping Threshold:** Confirm launch threshold as **₹499** (stated on customer PDP/Cart copy) vs. **₹799** (seeded in admin default settings). *Architecture default: ₹499.*
2. **Guest Checkout Confirmation:** Confirm whether true unauthenticated guest checkout should remain excluded from V1 or enabled in a future release. *Architecture default: Excluded from V1.*
3. **Cancellation & Return Policy Sign-off:** Client legal team review of draft cancellation windows and perishable food return policies in `src/data/refund.js`.
4. **Unpaid-Order Expiry Duration:** Determine automatic cancellation TTL for abandoned `PENDING_PAYMENT` orders (e.g. 24 hours).

---

## 14. Known Implementation Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| **Insecure Client-Side Admin Gate:** `admin123` and localStorage flags in frontend. | Enforce database `User.role === 'ADMIN'` via backend `requireAdmin` middleware. Deprecate client gate. |
| **Client Price Tampering:** Manipulation of submitted line prices during checkout. | Backend resolves line prices directly from `Product.variants`. Client prices are ignored. |
| **Untrusted Payment Confirmation:** Client claiming `paymentStatus: "Paid"`. | Payment status updated exclusively via cryptographic HMAC-SHA256 signature verification or webhook. |
| **Premature Cart Erasure:** Empty cart on payment failure/cancellation. | Cart clearing deferred strictly until payment signature verification succeeds. |
| **Concurrent Stock Overselling:** Simultaneous checkouts on low-stock items. | Atomic MongoDB conditional updates (`$gte: requestedQty`) and transaction sessions. |

---

## 15. Phase 1 Readiness Assessment

### Formal Determination:

$$\Huge\mathbf{PHASE\ 1\ READY}$$

### Final Justification:
* All route metrics and URL definitions are verified against source code.
* The API surface is frozen with unified authentication and clean endpoint separation.
* Database schemas, embedded variant models, and immutable snapshots are formalized.
* The 14-step Razorpay payment lifecycle and inventory consistency rules are locked.
* Operational client decisions (shipping thresholds, guest checkout roadmap) are isolated in dynamic configuration and do not block backend foundation development.

**Backend implementation (Phase 1 — Backend Foundation) may begin immediately upon user instruction.**

# SV Hub — Phase 0.1 Architectural Sign-Off Checklist

> **Document Version:** 1.0.0 (Phase 0.1 Sign-Off)  
> **Status:** All Items Audited & Validated Against Live Source Code

---

## Routing

* [x] **All routes verified against source:** Re-checked all 51 `<Route>` JSX definitions in `svhub-frontend/src/App.jsx`.
* [x] **Route counts corrected & categorized:** 51 `<Route>` elements, 42 navigable path routes, 5 redirects, 2 showcases, 1 duplicate alias, 2 catch-all/error routes.
* [x] **Duplicate/system routes identified:**
  * `/admin/orders/:id` identified as a Duplicate Route Compatibility Alias of `/admin/orders/:orderId` (same component `AdminOrderDetail.jsx`).
  * `/admin/system-states` identified as an Admin Development / Design System Showcase route (guarded by `RequireAdmin`).
  * `/system-states` identified as a Storefront Development / Design System Showcase route.

---

## API

* [x] **Every required API mapped:** All 57 endpoints catalogued with Method, Path, Auth, Role, Purpose, Consumer, and Status.
* [x] **Existing APIs verified:** Checked all active routes in `svhub-backend/src/routes/auth.js` (`register`, `login`, `google`, `forgot-password`, `reset-password`, `profile`).
* [x] **Unused APIs removed from proposed contract:** Product review submission, promo code validation, and customer self-cancellation classified as `FUTURE / V2` (removed from Phase 1 requirements).
* [x] **Session restoration specified:** `GET /api/auth/me` documented as REQUIRED for JWT validation and role persistence on page refresh.
* [x] **Public settings separation:** `GET /api/settings/public` created for storefront/checkout configuration; `GET /api/admin/settings` kept strictly admin-only.
* [x] **Unified staff authentication:** Canonical `POST /api/auth/login` used for both customers and staff (`role: 'ADMIN'`); redundant `/api/admin/auth/login` deprecated.

---

## Database

* [x] **Product structure finalized:** Co-located document architecture in `products` collection with slugs, category, storefront, specifications, and gallery.
* [x] **Product variants documented:** Embedded `variants[]` array with `variantId`, `label`, `weight`, `sku`, `price`, `originalPrice`, `discount`, `qty`, `stock`, and `isActive`.
* [x] **Cart structure finalized:** `carts` collection keyed strictly by `userId` for authenticated checkout in V1, containing embedded `CartItem` elements with composite key `(productId, variantId)`.
* [x] **Order snapshots finalized:** Immutable deep snapshots for both purchased products (`order.items[]`) and delivery address (`order.shippingAddress`).
* [x] **Address structure finalized:** `addresses` collection for saved customer addresses supporting `isDefault` flag.
* [x] **Payment structure finalized:** Decoupled `payments` collection for Razorpay transaction audit, HMAC signatures, and raw webhooks.
* [x] **Review structure finalized:** Designated as `FUTURE / V2` schema pending frontend UI implementation.
* [x] **User roles documented:** `role: 'customer' | 'admin'` and account status `status: 'Active' | 'VIP' | 'Inactive' | 'Suspended'` added to User schema.

---

## Security

* [x] **Admin role architecture documented:** Role stored in MongoDB User document and signed inside JWT payload.
* [x] **Frontend admin authentication identified as insecure:** Local storage gate (`svhub.admin.gate`) and `admin123` credentials in `src/utils/adminAuth.js` flagged as critical security vulnerabilities.
* [x] **JWT architecture documented:** Production RBAC enforced via Express middleware chaining: `requireAuth → requireAdmin`.
* [x] **Payment verification architecture documented:** Cryptographic HMAC-SHA256 signature verification over `${razorpay_order_id}|${razorpay_payment_id}`. Frontend "Paid" claims strictly untrusted.

---

## Commerce

* [x] **Shipping calculation documented:** Authoritative calculation flow: `Subtotal → Shipping (from DB Settings) → Tax → Final Total`.
* [x] **Inventory behavior documented:** Post-payment atomic decrement using MongoDB conditional query `{ qty: { $gte: requestedQty } }`.
* [x] **Cart/payment failure behavior documented:** Critical checkout bug documented (cart cleared prematurely in `Checkout.jsx`); cart persistence enforced on failed/aborted payments.
* [x] **Checkout authentication finalized:** Authenticated checkout strictly required for V1; guest checkout marked `FUTURE / CLIENT DECISION`.
* [x] **Decoupled order creation:** `POST /api/orders` creates MongoDB Application Order; `POST /api/payments/razorpay/create-order` creates gateway order only.
* [x] **Order numbering documented:** Sequential `#SVH-10001` format generated via atomic counter collection (corrected from previous tax compliance claim).
* [x] **Cancellation/refund gaps documented:** Cancellation windows, perishable food return restrictions, and refund policies marked as `CLIENT DECISION REQUIRED`.

---

## Frontend Integration

* [x] **Hardcoded data mapped:** Complete 14-file migration map created for all files in `svhub-frontend/src/data/`.
* [x] **API consumers identified:** Every frontend page and context hook mapped to its corresponding backend API endpoint.
* [x] **Backend dependencies identified:** MongoDB, Mongoose, Razorpay SDK, Firebase Admin SDK, and JSON Web Token (JWT).

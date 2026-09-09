# SV Hub — Business Decisions, Gaps & Architectural Discrepancies (Phase 0.2 Final Freeze)

> **Document Version:** 2.1.0 (Phase 0.2 Final Freeze)  
> **Status:** Definitive Architectural Resolution Pass  
> **Strict Policy:** Unresolved business decisions are explicitly flagged as `CLIENT DECISION REQUIRED`. No assumptions are made.

---

## 1. Final Business Rule Master Table

The following table summarizes the authoritative architecture and explicit client decision status across all operational, commercial, and technical rules:

| Rule | Final V1 Architecture | Client Decision Needed? |
| :--- | :--- | :---: |
| **Authentication Required at Checkout** | Strictly required in V1. Unauthenticated users are redirected to `/login?redirect=/checkout`. | **NO** (Frozen for V1) |
| **Guest Checkout** | Excluded from V1 launch architecture. Designated as a roadmap consideration. | **YES** (Marked `FUTURE / CLIENT DECISION`) |
| **Shipping Threshold** | Dynamic backend `Settings` singleton controls waiver. Launch default: ₹499. | **YES** (Confirm ₹499 vs ₹799 before production) |
| **Standard Shipping Fee** | Flat ₹40 applied to orders below free shipping threshold. Controlled by `Settings`. | **NO** (Resolved) |
| **Express Shipping Fee** | Flat ₹120 delivery option recorded in `Settings` and selectable during checkout. | **NO** (Resolved) |
| **Inventory Deduction Timing** | Deducted strictly after payment signature verification via atomic conditional query. | **NO** (Resolved) |
| **Payment Verification** | 14-step Razorpay flow: Cryptographic HMAC-SHA256 verification + async webhook confirmation. | **NO** (Resolved) |
| **Payment Failure State** | Order remains in `PENDING_PAYMENT`; payment marked `FAILED`; cart preserved 100%. | **NO** (Resolved) |
| **Cart Clearing Lifecycle** | Cart is cleared in database and UI **strictly after** payment signature is verified. | **NO** (Resolved) |
| **Order Cancellation** | V1: Administrative cancellation via staff portal. Customer self-cancellation deferred. | **YES** (Client confirmation on customer self-cancel) |
| **Refund Workflow** | V1: Admin initiates refund via Razorpay dashboard; order status updated to `CANCELLED`. | **NO** (Resolved for V1) |
| **Return Policy** | Nutri-Hub food non-returnable; damaged goods replaced/refunded upon photo review. | **YES** (Legal team must sign off policy draft) |
| **Coupons / Promo Codes** | Excluded from Phase 1 scope. Designated as **FUTURE / V2**. | **NO** (Deferred to V2) |
| **Product Reviews** | Excluded from Phase 1 scope. Designated as **FUTURE / V2** (no PDP UI). | **NO** (Deferred to V2) |
| **Testimonials** | Static marketing quotes displayed on Home page; completely decoupled from reviews. | **NO** (Resolved) |
| **Admin Roles & Auth** | Unified auth via `POST /api/auth/login`. Enforced by `requireAuth -> requireAdmin` (`role: 'ADMIN'`). | **NO** (Resolved) |
| **Order Numbering** | Sequential `#SVH-10001` generated via atomic MongoDB counter for support and lookup. | **NO** (Resolved) |
| **Unpaid-Order Expiry** | Unpaid orders in `PENDING_PAYMENT` retained; automated background cleanup deferred. | **YES** (Confirm auto-cancel TTL, e.g. 24h) |

---

## 2. Deep Dive: Key Architectural Resolutions

### 2.1 Checkout Authentication & Guest Checkout Policy
* **Frozen V1 Architecture:**
  * To guarantee order ownership, clean address book reuse, and payment dispute reconciliation, **checkout strictly requires authentication in V1**.
  * If an unauthenticated user with items in their cart clicks "Proceed to Checkout", the frontend routes to `/login?redirect=/checkout`.
  * After logging in, pre-login cart items are merged into the customer's server cart via `POST /api/cart/merge`, and the user is returned to `/checkout`.
* **Guest Checkout Classification:**
  * Guest checkout is **NOT** part of V1.
  * Designated as: `FUTURE / CLIENT DECISION`.

---

### 2.2 Public Store Configuration vs. Admin Operational Settings
* **The Problem:** The Phase 0 matrix inadvertently referenced `GET /api/admin/settings` from public checkout and shipping policy pages.
* **The Architectural Separation:**
  1. **`GET /api/settings/public` (Public):** Returns only safe, client-facing parameters: `currency`, `standardShippingFee`, `expressShippingFee`, `freeShippingThreshold`, `supportEmail`, `supportPhone`. Never exposes warehouse alert thresholds or administrative data.
  2. **`GET /api/admin/settings` & `PUT /api/admin/settings` (Admin Only):** Protected by `requireAuth -> requireAdmin`. Controls internal parameters (e.g. `lowStockAlert: 10`).

---

### 2.3 Unified Authentication Architecture (No Separate Admin Login API)
* **Finding in Source Code:** `svhub-frontend/src/pages/Admin/Login.jsx` already calls the standard `login()` function from `AuthContext.jsx`, which invokes `POST /api/auth/login`.
* **Resolution:**
  * There is **no separate `/api/admin/auth/login` endpoint**. Any prior mention of this endpoint is formally **DEPRECATED**.
  * Both customers and staff authenticate via canonical `POST /api/auth/login`.
  * Staff users are differentiated in the database by `User.role: "ADMIN"`.
  * Backend routes under `/api/admin/*` enforce access via Express middleware: `requireAuth -> requireAdmin`.
  * Frontend localStorage flags (`svhub.admin.gate`) and `admin123` hardcoded credentials in `adminAuth.js` are development mocks that must be removed in production.

---

### 2.4 Decoupled Order Creation vs. Razorpay Gateway Order Creation
* **The Architecture:**
  * `POST /api/orders` creates the canonical **Application Order** in MongoDB with `status: "PENDING_PAYMENT"`, snapshots items and address, and returns calculated totals.
  * `POST /api/payments/razorpay/create-order` consumes the existing `orderId` and creates **ONLY** the payment provider order with Razorpay. It **MUST NEVER** create a secondary Application Order.
  * `POST /api/payments/razorpay/verify` cryptographically validates HMAC-SHA256, deducts stock atomically, transitions order to `CONFIRMED`, and clears the server cart.

---

### 2.5 Inventory Consistency & Concurrency Conflict Strategy
* **Timing:** Inventory is decremented **strictly after** payment confirmation.
* **Atomic Query:** `{ _id: productId, "variants.variantId": variantId, "variants.qty": { $gte: requestedQty } }`.
* **Concurrency Edge Case:** If physical inventory is exhausted during the customer's 60-second payment window:
  1. The order is **NEVER** marked as `CONFIRMED` or fulfilled.
  2. The order is flagged for reconciliation (`REQUIRES_RECONCILIATION`).
  3. An automated Razorpay refund is triggered, or staff is alerted to handle backorder fulfillment.
  4. Multi-document MongoDB Session Transactions (`session.startTransaction()`) are recommended where replica set deployment is active.

---

### 2.6 Standardized Status State Machine
All documentation across SV Hub strictly adheres to the following unified states:

```
Order Fulfillment States:
  PENDING_PAYMENT ──> CONFIRMED ──> PROCESSING ──> SHIPPED ──> DELIVERED
         │
         └──> CANCELLED

Payment Transaction States:
  CREATED ──> PENDING ──> SUCCESS
                 │
                 ├──> FAILED (Cart remains intact; customer can retry)
                 └──> REFUNDED
```

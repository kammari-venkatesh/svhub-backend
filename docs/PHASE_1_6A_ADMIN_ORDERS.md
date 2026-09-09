# PHASE 1.6A — ADMIN ORDER MANAGEMENT (REAL MONGODB INTEGRATION)

## EXECUTIVE SUMMARY

Phase 1.6A establishes the first operational Admin capability in SV Hub: **Admin Order Management backed directly by MongoDB**.

Prior to this phase, the Admin Orders pages (`/admin/orders` and `/admin/orders/:id`) relied entirely on mock client-side state (`AdminStore`, `localStorage`, and `src/data/admin.js`). 

In Phase 1.6A:
- The order management portion of the Admin UI was fully disconnected from `localStorage` and connected to live MongoDB APIs.
- The existing visual design, layout, table styles, status badges, drawers, and modal dialogs were **100% preserved**.
- Strict server-side authentication (`requireAuth`) and admin authorization (`requireAdmin`) were enforced across all operational order routes.
- Historic order snapshots (`items`, `shippingAddress`, pricing totals) were safeguarded against administrative mutation.
- Order cancellations strictly preserve inventory without artificial incrementing (in compliance with Phase 1.5 order creation rules).

---

## 1. IMPLEMENTED APIS & ROUTE REGISTRATION

All routes are mounted under `/api/admin/orders` and protected by `requireAuth` + `requireAdmin`.

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/orders` | List real orders with pagination, search, filters & sort | JWT + Role: ADMIN |
| `GET` | `/api/admin/orders/:id` | Retrieve complete administrative order view | JWT + Role: ADMIN |
| `PATCH` | `/api/admin/orders/:id` | Update operational fields (status, courier, tracking, notes) | JWT + Role: ADMIN |
| `POST` | `/api/admin/orders/:id/cancel` | Cancel order with mandatory reason | JWT + Role: ADMIN |

---

## 2. API REQUEST & RESPONSE CONTRACTS

### 1. GET `/api/admin/orders`

#### Query Parameters Supported:
- `page` (integer, default: 1)
- `limit` (integer, default: 10, max: 100)
- `search` (string: matches `orderNumber`, `customerName`, `email`, `phone`)
- `status` (`PENDING_PAYMENT`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED` or Title Case equivalents)
- `paymentStatus` (`PENDING`, `SUCCESS`, `PAID`, `FAILED`, `REFUNDED` or Title Case equivalents)
- `storefront` (`nutri-hub`, `self-care`)
- `dateRange` (`all`, `7d`, `30d`, `month`, `custom`)
- `dateFrom` & `dateTo` (ISO date strings, e.g. `2026-09-01`)
- `sort` (`createdAt: -1` default, `date_asc`, `total_desc`, `total_asc`)

#### Response (`200 OK`):
```json
{
  "success": true,
  "orders": [
    {
      "id": "6aa1...",
      "_id": "6aa1...",
      "orderNumber": "#SVH-1001",
      "number": "#SVH-1001",
      "customerName": "Priya Venkatesh",
      "email": "priya.venkatesh@email.com",
      "phone": "9876543210",
      "user": {
        "id": "6aa1...",
        "name": "Priya Venkatesh",
        "email": "priya.venkatesh@email.com",
        "phone": "9876543210",
        "role": "CUSTOMER"
      },
      "shippingAddress": {
        "name": "Priya Venkatesh",
        "phone": "9876543210",
        "street": "12 Heritage Lane, RS Puram",
        "city": "Coimbatore",
        "state": "Tamil Nadu",
        "pin": "641002",
        "country": "India",
        "lines": ["12 Heritage Lane, RS Puram", "Coimbatore, Tamil Nadu - 641002"]
      },
      "items": [
        {
          "id": "var-samba-500g",
          "productId": "6aa1...",
          "productName": "Mappillai Samba Rice",
          "variantLabel": "500g",
          "weight": "500g",
          "sku": "SKU-SAMBA-500",
          "unitPrice": 249,
          "quantity": 2,
          "lineTotal": 498,
          "storefront": "nutri-hub"
        }
      ],
      "subtotal": 650,
      "shippingFee": 0,
      "totalAmount": 650,
      "status": "CONFIRMED",
      "displayStatus": "Confirmed",
      "paymentStatus": "PAID",
      "displayPaymentStatus": "Paid",
      "courier": null,
      "trackingNumber": null,
      "notes": "Please pack in eco-friendly carton.",
      "history": [
        {
          "status": "PENDING_PAYMENT",
          "at": "2026-09-09T09:27:00.000Z",
          "note": "Order placed by customer"
        },
        {
          "status": "CONFIRMED",
          "at": "2026-09-09T10:27:00.000Z",
          "note": "Payment captured and verified"
        }
      ],
      "createdAt": "2026-09-09T09:27:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

---

### 2. GET `/api/admin/orders/:id`

Accepts MongoDB ObjectId or canonical orderNumber (`#SVH-1001`).

#### Response (`200 OK`):
```json
{
  "success": true,
  "order": {
    "id": "6aa1...",
    "orderNumber": "#SVH-1001",
    "customerName": "Priya Venkatesh",
    "subtotal": 650,
    "totalAmount": 650,
    "status": "CONFIRMED",
    "paymentStatus": "PAID",
    "history": [...]
  }
}
```

#### Error Responses:
- `401 Unauthorized`: Token missing or invalid.
- `403 Forbidden`: Authenticated user is not an `ADMIN`.
- `404 Not Found`: Order does not exist (`{ "success": false, "error": { "code": "order_not_found", "message": "Order not found." } }`).

---

### 3. PATCH `/api/admin/orders/:id`

Whitelisted editable fields only:
```json
{
  "status": "PROCESSING",
  "paymentStatus": "PAID",
  "courier": "BlueDart Express",
  "trackingNumber": "BLU-SVH10001",
  "notes": "Packed and queued for dispatch."
}
```

#### Behavior & Invariants:
1. **Status Validation**: Validated against `['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']` (or UI Title Case aliases). Invalid status returns `400 invalid_order_status`.
2. **Payment Validation**: Validated against `['PENDING', 'SUCCESS', 'PAID', 'FAILED', 'REFUNDED']`. Invalid payment status returns `400 invalid_payment_status`.
3. **Status History Transition**: Appends a history record `{ status, at, note }` **only** if the status actually changed. Updating notes or courier without altering status does not produce duplicate history transitions.
4. **Snapshot Immutability**: Any incoming mutations to `items`, `shippingAddress`, `subtotal`, `shippingFee`, or `totalAmount` are strictly ignored.

---

### 4. POST `/api/admin/orders/:id/cancel`

#### Request Body:
```json
{
  "reason": "Customer requested cancellation prior to dispatch"
}
```

#### Behavior & Invariants:
1. **Mandatory Reason**: An empty or missing reason is rejected with `400 cancellation_reason_required`.
2. **Already Cancelled Guard**: If `order.status === 'CANCELLED'`, request is rejected with `400 order_already_cancelled`.
3. **History Record**: Appends `{ status: 'CANCELLED', at: new Date(), note: reason }`.
4. **Inventory Preservation**: Does **not** restore/increment stock, maintaining parity with Phase 1.5 order creation.

---

## 3. SECURITY & PRIVACY CONTROLS

1. **Authentication**: All endpoints verify Bearer JWT via `requireAuth`.
2. **Role Authorization**: All endpoints enforce `req.user.role === 'ADMIN'` via `requireAdmin`. Customers receive `403 forbidden_admin_access`.
3. **Sensitive Field Stripping**: When populating customer identity on orders, `passwordHash`, `resetPasswordToken`, `resetPasswordExpires`, and third-party Firebase tokens are explicitly omitted.
4. **Injection Safety**: Regex queries for `search` parameter use character escaping to prevent ReDoS or NoSQL regex injections.

---

## 4. INVENTORY RULES (CRITICAL ARCHITECTURE NOTE)

> **Phase 1.5 Architecture Parity Guarantee:**
> Order creation in Phase 1.5 does not deduct inventory from `Product.variants[].qty`.
> Therefore, cancelling an order in Phase 1.6A strictly does **NOT** increment or restore inventory, preventing artificial inflation of stock numbers.

---

## 5. AUTOMATED TEST SUITE (`verify-admin-orders.js`)

A dedicated 30-test suite was created in `svhub-backend/scripts/verify-admin-orders.js`. All 30 tests pass cleanly:

```text
====================================================
SV HUB — PHASE 1.6A ADMIN ORDER MANAGEMENT VERIFICATION
====================================================

[PASS] 1. No token → rejected (401 unauthorized)
[PASS] 2. Invalid token → rejected (401 invalid_token)
[PASS] 3. Normal customer JWT → rejected with 403 (forbidden_admin_access)
[PASS] 4. Admin JWT → allowed (200)
[PASS] 5. Admin can list orders with array response
[PASS] 6. Pagination works (limit, page, total, totalPages)
[PASS] 7. Search works by orderNumber
[PASS] 8. Status filter works
[PASS] 9. Payment status filter works
[PASS] 10. Admin can retrieve single order details
[PASS] 11. Invalid ObjectId handled properly (400 or 404)
[PASS] 12. Nonexistent order handled (404 order_not_found)
[PASS] 13. Admin can update status to PROCESSING
[PASS] 14. Admin can update trackingNumber
[PASS] 15. Admin can update courier
[PASS] 16. Admin can update notes
[PASS] 17. Invalid status rejected (400 invalid_order_status)
[PASS] 18. Unknown/immutable fields cannot be mutated (subtotal & items preserved)
[PASS] 19. Status history created on status change
[PASS] 20. Same-status update does not duplicate history entries
[PASS] 21. Admin can cancel valid order (status CANCELLED)
[PASS] 22. Empty cancellation reason rejected (400 cancellation_reason_required)
[PASS] 23. Already cancelled order rejected (400 order_already_cancelled)
[PASS] 24. Cancellation history created with status CANCELLED and reason note
[PASS] 25. Inventory is NOT increased upon order cancellation
[PASS] 26. Historical product snapshot unchanged (name, price, SKU, lineTotal preserved)
[PASS] 27. Historical shipping address snapshot unchanged
[PASS] 28. Order financial totals unchanged by operational updates
[PASS] 29. User credentials and password hashes stripped from admin order response
[PASS] 30. Customer cannot access admin order detail endpoint (403 forbidden_admin_access)

VERIFICATION SUMMARY: 30 PASSED, 0 FAILED
```

---

## 6. REGRESSION TEST MATRIX

| Verification Suite | Tests | Result | Status |
| :--- | :--- | :--- | :--- |
| `verify-foundation.js` | 13 | 13/13 PASS | **PASS** |
| `verify-models.js` | 30 | 30/30 PASS | **PASS** |
| `verify-catalog.js` | 23 | 23/23 PASS | **PASS** |
| `verify-cart-address.js` | 38 | 38/38 PASS | **PASS** |
| `verify-orders.js` | 21 | 21/21 PASS | **PASS** |
| `verify-admin-orders.js` | 30 | 30/30 PASS | **PASS** |
| `qa-api-audit.js` | 108 | 108/108 PASS | **PASS** |
| `GET /api/health` | - | `{ "status": "ok", "database": "connected" }` | **PASS** |

---

## 7. FILES CHANGED

### Backend:
- `src/controllers/adminOrderController.js` [NEW]
- `src/routes/adminOrders.js` [NEW]
- `src/routes/index.js` [MODIFY - registered `/api/admin/orders`]
- `scripts/verify-admin-orders.js` [NEW]
- `scripts/seed-demo-order.js` [NEW]

### Frontend:
- `src/api/adminOrders.js` [NEW]
- `src/pages/Admin/Orders.jsx` [MODIFY - wired to `getAdminOrders()`, `updateAdminOrder()`, `cancelAdminOrder()`]
- `src/pages/Admin/OrderDetail.jsx` [MODIFY - wired to `getAdminOrder()`, `updateAdminOrder()`, `cancelAdminOrder()`]

### Documentation:
- `docs/PHASE_1_6A_ADMIN_ORDERS.md` [NEW]

---

## 8. MANUAL BROWSER VERIFICATION INSTRUCTIONS

To verify the integration manually in any browser:
1. Open `http://localhost:5173/admin/login` or `http://localhost:5173/auth/login`.
2. Log in with admin credentials: `admin@svhub.in` / `Admin@123`.
3. Open `http://localhost:5173/admin/orders`. Verify orders `#SVH-1001` and `#SVH-1002` are displayed from MongoDB.
4. Click order `#SVH-1001`. Verify customer name (Priya Venkatesh), line items, amount (₹650), and address match MongoDB.
5. In the Fulfillment Stage dropdown or timeline, change status from `Confirmed` to `Processing`.
6. Refresh the browser page (`F5`). Verify the order continues to display `Processing` (confirming MongoDB persistence).
7. Advance status to `Shipped`. In the confirmation modal, enter Courier `BlueDart Express` and Tracking Number `BLU-SVH1001-AWB`, then confirm.
8. Refresh the browser page again. Verify the order displays `Shipped`, with courier and tracking number accurately displayed.

# Phase 1.9 — SV Hub Admin Customers, Dashboard & Settings Documentation

## 1. Executive Summary

Phase 1.9 completes the genuine MongoDB and Express API integration for all administrative areas of SV Hub:
1. **Admin Customers Directory & Detail**: Real buyer profiles, order history, spending metrics, address books, status management, and internal operational notes.
2. **Admin Dashboard**: Real-time business KPIs, recent orders, live revenue tracking, inventory alerts, sales trajectory charts, and storefront performance aggregations.
3. **Admin Settings**: Authoritative operational defaults (shipping rates, free shipping thresholds, low-stock thresholds, contact channels, currency) with strict server-side validation.

**Authoritative Source of Truth**: MongoDB via authenticated Express APIs.  
**Frontend Aesthetics**: 100% preserved with zero UI redesign, identical layouts, and zero CSS changes.  
**localStorage Authority**: Completely eliminated for all business data.

---

## 2. Implemented Backend Endpoints

### 2.1 Admin Customer Management
Mounted at `/api/admin/customers` in `src/routes/adminCustomers.js` and handled by `src/controllers/adminCustomerController.js`:
- `GET /api/admin/customers`:
  - **Auth**: `requireAuth`, `requireAdmin`.
  - **Parameters**: `q` / `search`, `status` (`ACTIVE`, `VIP`, `INACTIVE`, `SUSPENDED`), `tier` (`high`, `repeat`, `single`, `none`), `sort` (`spent`, `orders`, `joined`, `name`), `dir` (`asc`, `desc`), `page`, `limit`.
  - **Aggregation**: Joins `orders` and `addresses` via `$lookup` to compute `orderCount`, lifetime `spent`, `lastOrder`, `lastOrderId`, `city`, and `state`.
  - **Security**: Strips password hashes, reset tokens, and secrets.
- `GET /api/admin/customers/:id`:
  - **Auth**: `requireAuth`, `requireAdmin`.
  - **Returns**: Full customer profile, order history with line item snapshots, address book, lifetime spending, and average order value.
- `PATCH /api/admin/customers/:id`:
  - **Auth**: `requireAuth`, `requireAdmin`.
  - **Allowed Fields**: `name`, `phone`, `status`, `notes`.
  - **Validation**: Enforces status enum (`ACTIVE`, `VIP`, `INACTIVE`, `SUSPENDED`) and minimum name length. Blocks credential tampering.

### 2.2 Admin Dashboard API
Mounted at `/api/admin/dashboard` in `src/routes/adminDashboard.js` and handled by `src/controllers/adminDashboardController.js`:
- `GET /api/admin/dashboard`:
  - **Auth**: `requireAuth`, `requireAdmin`.
  - **Parameters**: `range` (7, 30, 90 days; default 7).
  - **Aggregated Metrics**:
    - `totalCustomers`, `activeCustomers`
    - `totalProducts`, `activeProducts`
    - `totalOrders`, `pendingOrders`, `processingOrders`, `shippedOrders`, `deliveredOrders`, `cancelledOrders`
    - `revenue`: Authoritative sum of `totalAmount` for paid orders (`paymentStatus: 'SUCCESS'` or `'PAID'`, excluding `CANCELLED`)
    - `lowStockProducts`: Products with stock below `lowStockThreshold` (from settings)
    - `salesChart`: Chronological daily revenue trajectory points for the SVG chart
    - `recentOrders`: 6 latest orders with customer name, amounts, and storefront chips
    - `topItem`: Most ordered product by units
    - `topHouse`: Top performing storefront (`nutri-hub` vs `self-care`)

### 2.3 Admin Settings API
Mounted at `/api/admin/settings` in `src/routes/adminSettings.js` and handled by `src/controllers/adminSettingsController.js`:
- `GET /api/admin/settings`:
  - **Auth**: `requireAuth`, `requireAdmin`.
  - **Returns**: Live store settings singleton from `Settings` collection.
- `PATCH /api/admin/settings`:
  - **Auth**: `requireAuth`, `requireAdmin`.
  - **Validation**: Strict checks for email format (`supportEmail`), non-empty phone (`supportPhone`), non-negative shipping fees (`standardShippingFee`, `expressShippingFee`), non-negative thresholds (`freeShippingThreshold`, `lowStockThreshold`).
  - **Public Compatibility**: Public settings endpoint `GET /api/settings/public` automatically reflects updated public configuration while exposing zero secrets.

---

## 3. Frontend Integration

### 3.1 API Client Modules
- `src/api/adminCustomers.js`: `getAdminCustomers()`, `getAdminCustomer()`, `updateAdminCustomer()`.
- `src/api/adminDashboard.js`: `getAdminDashboard()`.
- `src/api/adminSettings.js`: `getAdminSettings()`, `updateAdminSettings()`.

### 3.2 Page Integrations
- `src/pages/Admin/Customers.jsx`:
  - Connects to `getAdminCustomers`, `getAdminCustomer`, and `updateAdminCustomer`.
  - Real-time search, status filter, tier filter, and sorting.
  - Complete loading skeletons, error states, and empty states.
  - Modal displays live order history and address details from MongoDB.
- `src/pages/Admin/Dashboard.jsx`:
  - Connects to `getAdminDashboard({ range })`.
  - Displays real-time metric cards, recent orders table, low stock table, and SVG revenue chart.
  - Interactive date range selector (7 / 30 / 90 days) re-fetches from backend.
- `src/pages/Admin/Settings.jsx`:
  - Connects to `getAdminSettings` and `updateAdminSettings`.
  - Form validation with feedback toasts.
  - Direct persistence to MongoDB; reload button re-reads from database.
- `src/context/AdminStore.jsx`:
  - Eliminated mock `CUSTOMERS`, mock `ORDER_SEEDS`, and `localStorage` persistence.
  - Syncs live product, category, and order data via APIs for `AdminLayout` components (`GlobalSearch` and `AlertMenu`).

---

## 4. Security & Access Control

- **Role-Based Authorization**:
  - Unauthenticated requests to `/api/admin/*` return HTTP `401 unauthorized`.
  - Customer JWT requests to `/api/admin/*` return HTTP `403 forbidden_admin_access`.
  - Admin JWT requests return HTTP `200 OK`.
- **Multi-Account Isolation**:
  - Customers cannot view other customers' cart, address book, or orders.
  - Administrator endpoints provide centralized oversight without exposing private authentication secrets (e.g. password hashes, Firebase UIDs, tokens).

---

## 5. Verification & Test Results

### 5.1 Verification Script (`verify-admin-management.js`)
A comprehensive verification script was executed covering 43 independent assertions across customers, dashboard, settings, and regression:
- Customer list, search, status filter, tier filter, detail, and updates: **PASS**
- Dashboard real-time metrics, counts against MongoDB, sales charts, and insights: **PASS**
- Settings GET, PATCH validation, persistence, and public settings compatibility: **PASS**
- Canonical 37 products, 4 categories, and multi-account isolation: **PASS**

**Result**: **43 / 43 PASSED** (0 FAILED).

### 5.2 Full Test Suite Summary

| Test Suite | Result | Passed | Failed |
|---|---|---|---|
| `scripts/verify-foundation.js` | **PASS** | 13 | 0 |
| `scripts/verify-models.js` | **PASS** | 30 | 0 |
| `scripts/verify-canonical-products.js` | **PASS** | 230 | 0 |
| `scripts/verify-catalog.js` | **PASS** | 23 | 0 |
| `scripts/verify-cart-address.js` | **PASS** | 38 | 0 |
| `scripts/verify-orders.js` | **PASS** | 21 | 0 |
| `scripts/verify-admin-orders.js` | **PASS** | 30 | 0 |
| `scripts/verify-admin-catalog.js` | **PASS** | 32 | 0 |
| `scripts/verify-admin-management.js` | **PASS** | 43 | 0 |
| `scripts/qa-api-audit.js` | **PASS** | 108 | 0 |

### 5.3 Production Build
- Vite production build (`npm run build` in `svhub-frontend`): **PASS** (220 modules transformed, 0 errors).

---

## 6. Remaining Systems & Next Steps

- **Remaining Mock Systems**:
  - Payment Gateway (Razorpay): Intentionally deferred as specified in the Phase 1.9 constraints.
- **Next Recommended Phase**:
  - **Phase 2.0 — Razorpay Payment Gateway Integration**: Webhooks, payment order creation, signature verification, and automated order confirmation.

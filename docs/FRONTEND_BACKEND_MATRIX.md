# SV Hub — Frontend ↔ Backend Traceability Matrix & Definitive Route Inventory (Phase 0.2 Freeze)

> **Document Version:** 2.1.0 (Phase 0.2 Final Freeze)  
> **Target Environment:** Node.js / Express.js / MongoDB (Mongoose) / React Router v6  
> **Source Verification:** Re-audited directly against `svhub-frontend/src/App.jsx` and all page components.

---

## 1. Authoritative Route-Count Architecture

To eliminate any ambiguity across documentation passes, the route structure of `svhub-frontend/src/App.jsx` is defined below with strict mathematical precision. Each count reflects a distinct syntactic or functional concept:

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

### Explanation of Each Metric:
* **A. `<Route>` JSX Elements (`51`):** Every individual `<Route ... />` tag present in the JSX tree of `App.jsx`. This includes layout and guard wrappers, index routes, parameterized routes, redirects, and error catch-alls.
* **B. Navigable Path Routes (`42`):** Routes that correspond to an actual URL path and render an application component (excludes redirect tags and pure structural wrappers). Consists of 41 explicit paths + 1 root catch-all `*`.
* **C. Redirect Routes (`5`):** Explicit redirect declarations using React Router's `<Navigate to="..." replace />`:
  1. `/admin/*` → redirects to `/admin`
  2. `/privacy` → redirects to `/privacy-policy`
  3. `/terms` → redirects to `/terms-and-conditions`
  4. `/shipping` → redirects to `/shipping-policy`
  5. `/refund` → redirects to `/refund-policy`
* **D. Development / Showcase Routes (`2`):** Routes mounting the 16-state system preview component (`SystemStatesPage.jsx`):
  1. `/system-states` (Mounted within storefront `Layout`)
  2. `/admin/system-states` (Mounted within `AdminLayout` behind `RequireAdmin`)
* **E. Duplicate Route Aliases (`1`):** `/admin/orders/:id` is a compatibility alias for `/admin/orders/:orderId`. Both mount `AdminOrderDetail.jsx` which reads `const paramId = id || orderId;`.
* **F. Catch-All / Error Routes (`2`):** `/404` and `*` (which renders `NotFoundPage.jsx`).
* **Layout / Shell Route Wrappers (`3`):** `<Route element={<RequireAdmin />}>`, `<Route element={<Layout />}>`, and `<Route path="/account" element={<Account />}>` (which host nested sub-routes without rendering standalone content).

---

## 2. Targeted & Aliased Routes Classification

| Route Path | Mounted Component | Access Level | Exact Classification | Architectural Resolution |
| :--- | :--- | :--- | :--- | :--- |
| `/admin/orders/:orderId` | `AdminOrderDetail.jsx` | Admin Only (`RequireAdmin`) | **CANONICAL Parameterized Route** | Canonical route for viewing an admin order detail view. Consumes `:orderId`. |
| `/admin/orders/:id` | `AdminOrderDetail.jsx` | Admin Only (`RequireAdmin`) | **LEGACY / COMPATIBILITY ALIAS** | Mounts the exact same component as `:orderId`. Retained to protect internal links. |
| `/admin/system-states` | `SystemStatesPage.jsx` | Admin Only (`RequireAdmin`) | **Admin Development / Showcase Route** | Mounted inside `AdminLayout` behind `RequireAdmin` to QA the 16 system states in admin theme context. |
| `/system-states` | `SystemStatesPage.jsx` | Public (`Layout`) | **Storefront Development / Showcase Route** | Mounted inside customer `Layout` to demonstrate the design system states for storefront theme context. |

---

## 3. Comprehensive Route-by-Route Specification

### 3.1 Public Content Routes (13 Routes)

| Route Path | Mounted Component | Access | Auth Required? | Frontend Purpose | Dynamic Params | Backend Dependency / API Expected |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/` | `Home.jsx` | Public | No | Storefront landing page, hero banners, brand story, featured products strip, testimonials. | None | `GET /api/products/featured`, `GET /api/categories` |
| `/shop` | `Shop.jsx` | Public | No | Complete catalogue view with house filters (`nutri-hub`, `self-care`), category pills, price range, and sort controls. | Query: `?house=`, `?cat=`, `?sort=`, `?min=`, `?max=` | `GET /api/products` |
| `/nutri-hub` | `NutriHub.jsx` | Public | No | Dedicated house landing page for traditional food, native rice, thokku, and spices. | None | `GET /api/products?house=nutri-hub`, `GET /api/categories?house=nutri-hub` |
| `/self-care` | `SelfCare.jsx` | Public | No | Dedicated house landing page for herbal skincare and cold-processed soaps. | None | `GET /api/products?house=self-care`, `GET /api/categories?house=self-care` |
| `/category/:slug` | `Category.jsx` | Public | No | Specific category catalogue grid with category header banner. | `:slug` (e.g. `native-rice`, `pickles`, `handmade-soaps`) | `GET /api/categories/:slug`, `GET /api/products?category=:slug` |
| `/product/:slug` | `Product.jsx` | Public | No | Product Detail Page (PDP): image gallery, pack-size/weight variant selector, ingredients, accordion specs, related products. | `:slug` (e.g. `kullakar-rice`, `vettiver-soap`) | `GET /api/products/:slug`, `GET /api/products/:slug/related` |
| `/search` | `Search.jsx` | Public | No | Keyword search results page with category and house facet filters. | Query: `?q=`, `?house=`, `?cat=` | `GET /api/products?q=:query` |
| `/about` | `About.jsx` | Public | No | SV Hub brand heritage, farm philosophy, and artisanal production values. | None | None (Static editorial content) |
| `/contact` | `Contact.jsx` | Public | No | Customer care phone, email, physical address, and enquiry guidance. | None | `GET /api/settings/public` (Public store configuration) |
| `/privacy-policy` | `PrivacyPolicy.jsx` | Public | No | Legal privacy policy draft and customer data handling rights. | None | None (Static legal text) |
| `/terms-and-conditions` | `Terms.jsx` | Public | No | Terms of service, ordering policies, and legal warranties. | None | None (Static legal text) |
| `/shipping-policy` | `ShippingPolicy.jsx` | Public | No | Delivery areas, standard dispatch timelines (2–4 days), and shipping rates. | None | `GET /api/settings/public` (Public shipping thresholds) |
| `/refund-policy` | `RefundPolicy.jsx` | Public | No | Refund, cancellation, and damaged product return rules. | None | None (Static policy text) |

### 3.2 Public Authentication Routes (4 Routes)

| Route Path | Mounted Component | Access | Auth Required? | Frontend Purpose | Dynamic Params | Backend Dependency / API Expected |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/login` | `Login.jsx` | Public | No (Redirects if logged in) | Email/Phone + password login form, "Continue with Google" OAuth trigger. | Query: `?redirect=` | `POST /api/auth/login`, `POST /api/auth/google` |
| `/register` | `Register.jsx` | Public | No (Redirects if logged in) | Account registration form (Name, Email, Phone, Password) and Google registration. | None | `POST /api/auth/register`, `POST /api/auth/google` |
| `/forgot-password` | `ForgotPassword.jsx` | Public | No | Password recovery request form (sends email reset link). | None | `POST /api/auth/forgot-password` |
| `/reset-password` | `ResetPassword.jsx` | Public | No | Validates reset token and sets new password. | Query: `?token=` | `GET /api/auth/reset-password?token=`, `POST /api/auth/reset-password` |

### 3.3 Customer Commerce & Account Routes (9 Routes)

> [!IMPORTANT]
> **V1 CHECKOUT AUTHENTICATION RULE:**  
> In Phase 1 launch, `/checkout` requires authentication (`requireAuth`). Unauthenticated visitors clicking "Proceed to Checkout" from `/cart` are redirected to `/login?redirect=/checkout`. Guest checkout is strictly designated as `FUTURE / CLIENT DECISION`.

| Route Path | Mounted Component | Access | Auth Required? | Frontend Purpose | Dynamic Params | Backend Dependency / API Expected |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/cart` | `CartPage.jsx` | Public / Customer | No | Shopping cart review, line quantity +/- controls, remove line item, subtotal calculation. | None | `GET /api/cart`, `PATCH /api/cart/items/:id`, `DELETE /api/cart/items/:id` |
| `/checkout` | `Checkout.jsx` | Customer | **Yes (Required in V1)** | Delivery address selection, shipping method (Standard/Express), order creation, payment trigger. | None | `GET /api/settings/public`, `POST /api/orders`, `POST /api/payments/razorpay/create-order` |
| `/order-success` | `OrderSuccess.jsx` | Customer | Yes (Via navigation state / auth) | Order confirmation splash, display order number, delivery summary, invoice reference. | State: `order` object | `GET /api/orders/:id` (Fallback) |
| `/payment-failed` | `PaymentFailed.jsx` | Customer | Yes (Via navigation state / auth) | Payment failure notification with retry button (cart preserved). | State: `error`, `orderId` | `POST /api/payments/razorpay/create-order` (Retry payment) |
| `/account` | `Account.jsx` + `Overview.jsx` | Customer | Yes (Redirects to `/login`) | Account overview dashboard: recent orders, default address snippet, quick navigation. | None | `GET /api/orders?limit=3`, `GET /api/addresses` |
| `/account/profile` | `Profile.jsx` | Customer | Yes (Redirects to `/login`) | Edit name, email, phone, and change account password. | None | `GET /api/auth/me`, `PATCH /api/auth/profile` |
| `/account/orders` | `Orders.jsx` | Customer | Yes (Redirects to `/login`) | Full order history table with filter tabs (All, Processing, Delivered, Cancelled). | None | `GET /api/orders` |
| `/account/orders/:orderId` | `OrderDetail.jsx` | Customer | Yes (Redirects to `/login`) | Detailed customer order timeline, line items, delivery address, and price breakdown. | `:orderId` (e.g. `SVH-10001`) | `GET /api/orders/:orderId` |
| `/account/addresses` | `Addresses.jsx` | Customer | Yes (Redirects to `/login`) | Customer address book: add, edit, delete, and set default delivery address. | None | `GET /api/addresses`, `POST /api/addresses`, `PUT /api/addresses/:id`, `DELETE /api/addresses/:id`, `PATCH /api/addresses/:id/default` |

### 3.4 Admin Portal Routes (13 Routes)

*All admin portal routes (except `/admin/login`) are protected by `<RequireAdmin />` wrapper which checks role authorization (`role: 'ADMIN'`).*

| Route Path | Mounted Component | Access | Auth Required? | Frontend Purpose | Dynamic Params | Backend Dependency / API Expected |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/admin/login` | `AdminLogin.jsx` | Public | No (Unauthenticated Admin Portal Login) | Dedicated admin sign-in portal. Authenticates via canonical `/api/auth/login`. | None | `POST /api/auth/login` (Canonical Auth) |
| `/admin` | `AdminLayout.jsx` + `Dashboard.jsx` | Admin | Yes (`role: 'ADMIN'`) | KPI metrics (Revenue, Orders, Low Stock, Customers), sales trend charts, recent orders. | None | `GET /api/admin/dashboard/stats` |
| `/admin/orders` | `AdminOrders.jsx` | Admin | Yes (`role: 'ADMIN'`) | Filterable, searchable table of all orders with status filter chips and CSV export. | Query: `?status=`, `?q=`, `?page=` | `GET /api/admin/orders`, `GET /api/admin/orders/export` |
| `/admin/orders/:orderId` | `AdminOrderDetail.jsx` | Admin | Yes (`role: 'ADMIN'`) | Canonical order detail view: line items, customer details, fulfillment status updater, courier, notes. | `:orderId` | `GET /api/admin/orders/:id`, `PATCH /api/admin/orders/:id/status`, `PATCH /api/admin/orders/:id/shipping`, `PATCH /api/admin/orders/:id/notes` |
| `/admin/orders/:id` | `AdminOrderDetail.jsx` | Admin | Yes (`role: 'ADMIN'`) | Compatibility duplicate route alias of `:orderId` to ensure link resilience. | `:id` | Same as `/admin/orders/:orderId` |
| `/admin/products` | `AdminProducts.jsx` | Admin | Yes (`role: 'ADMIN'`) | Product catalogue manager: list, search, filter by house/category, quick stock adjust, delete product. | Query: `?q=`, `?house=`, `?cat=` | `GET /api/admin/products`, `DELETE /api/admin/products/:id` |
| `/admin/products/new` | `AdminProductNew.jsx` | Admin | Yes (`role: 'ADMIN'`) | Multi-section product creation workspace: basic info, variants, pricing, inventory, gallery, SEO. | None | `POST /api/admin/products`, `GET /api/admin/categories` |
| `/admin/products/:id/edit` | `AdminProductEdit.jsx` | Admin | Yes (`role: 'ADMIN'`) | Product editing workspace: edit existing product fields, variants, image gallery, and toggle active status. | `:id` (Product ID or slug) | `GET /api/admin/products/:id`, `PUT /api/admin/products/:id` |
| `/admin/inventory` | `AdminInventory.jsx` | Admin | Yes (`role: 'ADMIN'`) | Dedicated warehouse inventory manager: view stock on hand, low-stock alerts, inline batch quantity updates. | Query: `?status=low-stock` | `GET /api/admin/inventory`, `PATCH /api/admin/products/:id/inventory` |
| `/admin/categories` | `AdminCategories.jsx` | Admin | Yes (`role: 'ADMIN'`) | Manage category hierarchy, add new category, edit description, upload banner image. | None | `GET /api/admin/categories`, `POST /api/admin/categories`, `PUT /api/admin/categories/:id`, `DELETE /api/admin/categories/:id` |
| `/admin/customers` | `AdminCustomers.jsx` | Admin | Yes (`role: 'ADMIN'`) | Customer management directory: view customer metrics, order history, VIP tag, notes, CSV export. | Query: `?q=`, `?status=` | `GET /api/admin/customers`, `GET /api/admin/customers/export`, `PATCH /api/admin/customers/:id/status`, `PATCH /api/admin/customers/:id/notes` |
| `/admin/settings` | `AdminSettings.jsx` | Admin | Yes (`role: 'ADMIN'`) | Configure operational parameters: standard shipping fee, free shipping threshold, low stock threshold, support email/phone. | None | `GET /api/admin/settings`, `PUT /api/admin/settings` (Admin Only) |
| `/admin/system-states` | `SystemStatesPage.jsx` | Admin | Yes (`role: 'ADMIN'`) | Admin design system showcase displaying 16 system state components. | None | None (Dev / Showcase) |

### 3.5 System, Test, Error & Redirect Routes (9 Entries)

| Route Path | Mounted Element | Classification | Target / Behavior | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `/system-states` | `SystemStatesPage.jsx` | Dev / Showcase | Render inside `Layout` | Interactive gallery of 16 system states (empty cart, network error, 404, loading, modals). |
| `/404` | `NotFoundPage.jsx` | Error Page | Render inside `Layout` | Explicit 404 error page. |
| `*` (Root) | `NotFoundPage.jsx` | Catch-All Route | Render inside `Layout` | Catches any unmatched customer route and renders 404 page. |
| `/admin/*` | `<Navigate to="/admin" replace />` | Redirect | `/admin` | Catches any unmatched route inside the admin branch and redirects to admin dashboard. |
| `/privacy` | `<Navigate to="/privacy-policy" replace />` | URL Alias / Redirect | `/privacy-policy` | Standard URL alias redirection for convenience. |
| `/terms` | `<Navigate to="/terms-and-conditions" replace />` | URL Alias / Redirect | `/terms-and-conditions` | Standard URL alias redirection for convenience. |
| `/shipping` | `<Navigate to="/shipping-policy" replace />` | URL Alias / Redirect | `/shipping-policy` | Standard URL alias redirection for convenience. |
| `/refund` | `<Navigate to="/refund-policy" replace />` | URL Alias / Redirect | `/refund-policy` | Standard URL alias redirection for convenience. |

---

## 4. Frontend Action to Backend API Traceability Matrix

| Frontend Page / Component | Frontend User Action / Trigger | Backend Endpoint | Target Entity | Auth Header | Status in Backend |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Global / App Load** | Session restoration on page refresh | `GET /api/auth/me` | `User` | Bearer JWT | **REQUIRED (Missing)** |
| **Global / App Load** | Health ping | `GET /api/health` | None | Public | **EXISTING** |
| **Login (`/login`)** | Form submit (email/phone + password) | `POST /api/auth/login` | `User` | Public | **EXISTING** |
| **Login (`/login`)** | "Continue with Google" popup | `POST /api/auth/google` | `User` | Public | **EXISTING** |
| **Register (`/register`)** | Form submit (name, email, phone, pass) | `POST /api/auth/register` | `User` | Public | **EXISTING** |
| **Forgot Password (`/forgot-password`)** | Form submit (email) | `POST /api/auth/forgot-password` | `User` | Public | **EXISTING** |
| **Reset Password (`/reset-password`)** | Page load token inspection | `GET /api/auth/reset-password` | `User` | Public | **EXISTING** |
| **Reset Password (`/reset-password`)** | Form submit (token + new password) | `POST /api/auth/reset-password` | `User` | Public | **EXISTING** |
| **Profile (`/account/profile`)** | Form submit (personal details) | `PATCH /api/auth/profile` | `User` | Bearer JWT | **EXISTING** |
| **Home (`/`)** | Featured products strip fetch | `GET /api/products/featured` | `Product` | Public | **REQUIRED** |
| **Home / Nav (`/`)** | Category list fetch | `GET /api/categories` | `Category` | Public | **REQUIRED** |
| **Shop (`/shop`)** | Catalogue query & filter | `GET /api/products` | `Product` | Public | **REQUIRED** |
| **Category (`/category/:slug`)** | Category detail & products | `GET /api/categories/:slug` | `Category` | Public | **REQUIRED** |
| **Product Detail (`/product/:slug`)** | Single product & variant data fetch | `GET /api/products/:slug` | `Product` | Public | **REQUIRED** |
| **Product Detail (`/product/:slug`)** | Related products strip fetch | `GET /api/products/:slug/related` | `Product` | Public | **REQUIRED** |
| **Cart (`/cart`)** | Fetch live user cart | `GET /api/cart` | `Cart` | Bearer JWT | **REQUIRED** |
| **Cart (`/cart`)** | Add pack/variant item to cart | `POST /api/cart/items` | `Cart` | Bearer JWT | **REQUIRED** |
| **Cart (`/cart`)** | Update item quantity (+/- pill) | `PATCH /api/cart/items/:id` | `Cart` | Bearer JWT | **REQUIRED** |
| **Cart (`/cart`)** | Remove line item (X button) | `DELETE /api/cart/items/:id` | `Cart` | Bearer JWT | **REQUIRED** |
| **Cart (`/cart`)** | Merge pre-login guest cart on login | `POST /api/cart/merge` | `Cart` | Bearer JWT | **REQUIRED** |
| **Checkout (`/checkout`)** | Fetch safe public shipping rules & fees | `GET /api/settings/public` | `Settings` | Public | **REQUIRED** |
| **Checkout (`/checkout`)** | Create Application Order (MongoDB) | `POST /api/orders` | `Order` | Bearer JWT | **REQUIRED** |
| **Checkout (`/checkout`)** | Create Razorpay Gateway Order | `POST /api/payments/razorpay/create-order` | `Payment` | Bearer JWT | **REQUIRED** |
| **Checkout (`/checkout`)** | Verify signature & confirm order | `POST /api/payments/razorpay/verify` | `Payment` / `Order` | Bearer JWT | **REQUIRED** |
| **Account Overview (`/account`)** | Fetch recent orders | `GET /api/orders?limit=3` | `Order` | Bearer JWT | **REQUIRED** |
| **Account Orders (`/account/orders`)** | Fetch full order history | `GET /api/orders` | `Order` | Bearer JWT | **REQUIRED** |
| **Account Order Detail (`/account/orders/:id`)** | Fetch single order details | `GET /api/orders/:id` | `Order` | Bearer JWT | **REQUIRED** |
| **Account Addresses (`/account/addresses`)** | List customer addresses | `GET /api/addresses` | `Address` | Bearer JWT | **REQUIRED** |
| **Account Addresses (`/account/addresses`)** | Add new address | `POST /api/addresses` | `Address` | Bearer JWT | **REQUIRED** |
| **Account Addresses (`/account/addresses`)** | Update address | `PUT /api/addresses/:id` | `Address` | Bearer JWT | **REQUIRED** |
| **Account Addresses (`/account/addresses`)** | Delete address | `DELETE /api/addresses/:id` | `Address` | Bearer JWT | **REQUIRED** |
| **Account Addresses (`/account/addresses`)** | Set default address | `PATCH /api/addresses/:id/default` | `Address` | Bearer JWT | **REQUIRED** |
| **Admin Login (`/admin/login`)** | Staff authentication (Canonical) | `POST /api/auth/login` | `User` | Public | **EXISTING** |
| **Admin Dashboard (`/admin`)** | KPI metrics & sales stats | `GET /api/admin/dashboard/stats` | Multi-entity | Admin JWT | **REQUIRED** |
| **Admin Orders (`/admin/orders`)** | List, filter, search orders | `GET /api/admin/orders` | `Order` | Admin JWT | **REQUIRED** |
| **Admin Orders (`/admin/orders`)** | Export orders to CSV | `GET /api/admin/orders/export` | `Order` | Admin JWT | **REQUIRED** |
| **Admin Order Detail (`/admin/orders/:id`)** | Single order view (Canonical: `:orderId`)| `GET /api/admin/orders/:id` | `Order` | Admin JWT | **REQUIRED** |
| **Admin Order Detail (`/admin/orders/:id`)** | Update order status | `PATCH /api/admin/orders/:id/status` | `Order` | Admin JWT | **REQUIRED** |
| **Admin Order Detail (`/admin/orders/:id`)** | Update courier & tracking | `PATCH /api/admin/orders/:id/shipping` | `Order` | Admin JWT | **REQUIRED** |
| **Admin Order Detail (`/admin/orders/:id`)** | Save internal staff note | `PATCH /api/admin/orders/:id/notes` | `Order` | Admin JWT | **REQUIRED** |
| **Admin Products (`/admin/products`)** | List catalogue products | `GET /api/admin/products` | `Product` | Admin JWT | **REQUIRED** |
| **Admin Product New (`/admin/products/new`)** | Create product with variants | `POST /api/admin/products` | `Product` | Admin JWT | **REQUIRED** |
| **Admin Product Edit (`/admin/products/:id/edit`)** | Fetch product for editing | `GET /api/admin/products/:id` | `Product` | Admin JWT | **REQUIRED** |
| **Admin Product Edit (`/admin/products/:id/edit`)** | Update product & variants | `PUT /api/admin/products/:id` | `Product` | Admin JWT | **REQUIRED** |
| **Admin Products (`/admin/products`)** | Delete / deactivate product | `DELETE /api/admin/products/:id` | `Product` | Admin JWT | **REQUIRED** |
| **Admin Inventory (`/admin/inventory`)** | List stock on hand | `GET /api/admin/inventory` | `Product` | Admin JWT | **REQUIRED** |
| **Admin Inventory (`/admin/inventory`)** | Adjust physical stock level | `PATCH /api/admin/products/:id/inventory`| `Product` | Admin JWT | **REQUIRED** |
| **Admin Categories (`/admin/categories`)** | List categories with product counts | `GET /api/admin/categories` | `Category` | Admin JWT | **REQUIRED** |
| **Admin Categories (`/admin/categories`)** | Create category | `POST /api/admin/categories` | `Category` | Admin JWT | **REQUIRED** |
| **Admin Categories (`/admin/categories`)** | Update category | `PUT /api/admin/categories/:id` | `Category` | Admin JWT | **REQUIRED** |
| **Admin Categories (`/admin/categories`)** | Delete category | `DELETE /api/admin/categories/:id` | `Category` | Admin JWT | **REQUIRED** |
| **Admin Customers (`/admin/customers`)** | List customers & lifetime value | `GET /api/admin/customers` | `User` | Admin JWT | **REQUIRED** |
| **Admin Customers (`/admin/customers`)** | Export customers to CSV | `GET /api/admin/customers/export` | `User` | Admin JWT | **REQUIRED** |
| **Admin Customers (`/admin/customers`)** | Update customer status (VIP/Active)| `PATCH /api/admin/customers/:id/status` | `User` | Admin JWT | **REQUIRED** |
| **Admin Customers (`/admin/customers`)** | Save customer notes | `PATCH /api/admin/customers/:id/notes` | `User` | Admin JWT | **REQUIRED** |
| **Admin Settings (`/admin/settings`)** | Fetch store configuration (Admin) | `GET /api/admin/settings` | `Settings` | Admin JWT | **REQUIRED** |
| **Admin Settings (`/admin/settings`)** | Save store configuration (Admin) | `PUT /api/admin/settings` | `Settings` | Admin JWT | **REQUIRED** |
| **Shipping Policy (`/shipping-policy`)** | Dynamic shipping threshold blurb | `GET /api/settings/public` | `Settings` | Public | **REQUIRED** |
| **Contact Page (`/contact`)** | Public customer support phone/email | `GET /api/settings/public` | `Settings` | Public | **REQUIRED** |

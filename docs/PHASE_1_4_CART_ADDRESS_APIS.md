# PHASE 1.4 — CUSTOMER CART & ADDRESS APIs IMPLEMENTATION REPORT

**Project:** SV Hub E-Commerce Application  
**Phase:** Phase 1.4 — Customer Cart & Address APIs  
**Status:** `PHASE 1.4 COMPLETE`  
**Date:** September 9, 2026  
**Architectural Baseline:** Phase 0.2 Final Architecture Freeze (`docs/API_CONTRACT.md`, `docs/DATABASE_REQUIREMENTS.md`, `docs/DATABASE_RELATIONSHIPS.md`)

---

## 1. Cart Endpoints

Implemented in `src/controllers/cartController.js` and `src/routes/cart.js`, mounted under `/api/cart`. Every endpoint strictly requires `requireAuth`:

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/cart` | Retrieves authenticated customer's shopping cart with live resolved product/variant details, dynamic pricing, and stock status | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `POST` | `/api/cart/items` | Adds a product pack variant to the customer cart, validates live catalog stock, and enforces line uniqueness `(productId, variantId)` | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `PATCH` | `/api/cart/items/:id` | Updates quantity of a specific cart line (supports `:id` as line ObjectId or `variantId`). Setting `quantity: 0` removes line | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `DELETE` | `/api/cart/items/:id` | Removes an item line from the customer cart (supports `:id` as line ObjectId or `variantId`) | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `DELETE` | `/api/cart` | Clears all items from the customer's cart | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `POST` | `/api/cart/merge` | Merges pre-login guest cart items into the authenticated customer's server cart | Bearer JWT (`CUSTOMER` / `ADMIN`) |

---

## 2. Address Endpoints

Implemented in `src/controllers/addressController.js` and `src/routes/addresses.js`, mounted under `/api/addresses`. Every endpoint strictly requires `requireAuth`:

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :---: |
| `GET` | `/api/addresses` | Lists all saved delivery addresses for the authenticated customer ordered by default flag and creation date | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `POST` | `/api/addresses` | Creates a new delivery address for the authenticated customer. First address automatically becomes default | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `PATCH` | `/api/addresses/:id` | Updates delivery address fields for an address owned by the authenticated customer | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `PUT` | `/api/addresses/:id` | Idempotent update alias for customer address | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `DELETE` | `/api/addresses/:id` | Deletes a customer-owned address. If deleted address was default, automatically promotes another address | Bearer JWT (`CUSTOMER` / `ADMIN`) |
| `PATCH` | `/api/addresses/:id/default`| Sets a specific address as primary default, automatically unsetting default on other addresses of the user | Bearer JWT (`CUSTOMER` / `ADMIN`) |

---

## 3. Ownership Enforcement

* **No Trust in Client-Supplied Identifiers:** Neither Cart nor Address endpoints accept `userId` from `req.body`, `req.params`, or `req.query`.
* **Authoritative Identity:** Customer identity is extracted exclusively from verified JWT payload `req.user._id`.
* **Complete User Isolation:**
  - `Cart.findOne({ userId: req.user._id })`: Customer A can only access and modify their own cart document. Customer B's cart operations never touch Customer A's cart.
  - `Address.findOne({ _id: addressId, userId: req.user._id })`: Queries and mutations require matching both address `_id` and owner `userId`. Customer B attempting to read, update, or delete Customer A's address receives HTTP `404 address_not_found`.
  - Spoofing attempts where Customer A sends `{ userId: CustomerB_Id }` during address creation are overridden by the controller, which strictly forces `userId: req.user._id`.

---

## 4. Cart Pricing Authority

* **Zero Trust in Frontend Pricing:** Frontend-submitted pricing fields (`price`, `originalPrice`, `discount`, `subtotal`, `total`) are discarded and never stored in the database.
* **Live Product Resolution:** When a cart is fetched or updated (`populateCart()`), unit prices and line totals are dynamically computed from `Product.variants[].price` in MongoDB.
* **Tamper Prevention:** If a client attempts to submit `price: 1` on an item costing ₹249, the server ignores the parameter and records only `{ productId, variantId, quantity }`. Line totals and subtotals returned are calculated strictly from the database source of truth.

---

## 5. Stock Handling & Variant Uniqueness

* **Composite Line Uniqueness `(productId, variantId)`:**
  - Product A + 500g variant creates Line 1.
  - Product A + 1kg variant creates Line 2.
  - Adding Product A + 500g again increments Line 1's quantity instead of creating a duplicate line.
* **Stock Validation without Permanent Inventory Deduction:**
  - Before adding or increasing quantity, `cartController` queries `variant.qty` from the live product document.
  - If requested quantity exceeds available physical inventory, the operation is rejected with HTTP `400 insufficient_stock` (`"Only X units available in stock"`).
  - No permanent inventory deduction occurs during cart manipulation (inventory deduction is reserved strictly for verified payment in Phase 1.5).
* **Quantity Boundaries:** Quantities are validated strictly as integers between `1` and `99`. Values of `0`, negative numbers, strings, or numbers > 99 are rejected with `400 invalid_quantity`.
* **Stale Reference Resilience:** If an item in a cart references a deleted or deactivated product (`isActive: false`) or deactivated variant (`v.isActive === false`), `populateCart()` safely omits or marks the line without crashing the API.

---

## 6. Default Address Behavior

* **First Address Rule:** If a customer has no saved addresses, creating their first address automatically sets `isDefault: true`.
* **Single Default Per Customer:** Setting an address as default (`PATCH /api/addresses/:id/default` or creating/updating with `isDefault: true`) unsets `isDefault: false` across all other addresses belonging exclusively to that customer (`{ userId: req.user._id, _id: { $ne: address._id } }`).
* **Tenant Isolation for Defaults:** Unsetting default addresses is strictly scoped to `req.user._id`, guaranteeing Customer A changing defaults never modifies Customer B's default address.
* **Deletion Promotion:** If a customer deletes their default address and other addresses exist, the next most recent address is automatically promoted to `isDefault: true`.

---

## 7. Testing Summary

### Automated Test Suite Execution:
Executed `node scripts/verify-cart-address.js`:

#### Cart Tests (1 - 25):
* Test 1: Unauthenticated GET /api/cart returns 401 (PASS)
* Test 2: Invalid token GET /api/cart returns 401 (PASS)
* Test 3: Customer A reads own cart (PASS)
* Test 4: Customer B reads own cart isolated from Customer A (PASS)
* Test 5: Customer A adds valid product/variant to cart (PASS)
* Test 6: Non-existent product ID rejected (404 product_not_found) (PASS)
* Test 7: Non-existent variantId rejected (404 variant_not_found) (PASS)
* Test 8: Inactive product rejected (404 product_not_found) (PASS)
* Test 9: Inactive variant rejected (404 variant_not_found) (PASS)
* Test 10: Quantity 0 rejected (400 invalid_quantity) (PASS)
* Test 11: Negative quantity rejected (400 invalid_quantity) (PASS)
* Test 12: Quantity > 99 rejected (400 invalid_quantity) (PASS)
* Test 13: Quantity exceeding available stock rejected (400 insufficient_stock) (PASS)
* Test 14: Product A + Variant 1 creates exactly 1 line (PASS)
* Test 15: Product A + Variant 2 creates a separate line (PASS)
* Test 16: Adding Variant 1 again increments quantity with no duplicate line (PASS)
* Test 17: Price authority enforced: Server resolves DB price and ignores client price (PASS)
* Test 18: Valid quantity update via PATCH /api/cart/items/:id works (PASS)
* Test 19: Negative quantity update rejected (400 invalid_quantity) (PASS)
* Test 20: Quantity update exceeding stock rejected (400 insufficient_stock) (PASS)
* Test 21: Customer removes own item from cart (PASS)
* Test 22: Customer B cannot remove Customer A cart item (404 item_not_found) (PASS)
* Test 23: Customer A clears own cart successfully (PASS)
* Test 24: Customer B clearing cart leaves Customer A cart intact (PASS)
* Test 25: Stale/inactive products in cart safely handled without crashing (PASS)

#### Address Tests (26 - 38):
* Test 26: Unauthenticated GET /api/addresses returns 401 (PASS)
* Test 27: Customer A reads own address book (PASS)
* Test 28: Customer B cannot read Customer A address (PASS)
* Test 29: Customer B updating Customer A address rejected (404 address_not_found) (PASS)
* Test 30: Customer B deleting Customer A address rejected (404 address_not_found) (PASS)
* Test 31: Customer A creates valid address (first address isDefault: true) (PASS)
* Test 32: Invalid 4-digit PIN code rejected (400 invalid_pin) (PASS)
* Test 33: Customer A updates own address successfully (PASS)
* Test 34: Customer A deletes own address successfully (PASS)
* Test 35: Customer A creates second address with isDefault: true (PASS)
* Test 36: Setting second address as default automatically unsets first address isDefault (PASS)
* Test 37: Customer A default change never modifies Customer B default address (PASS)
* Test 38: Client cannot forge userId: Address assigned to authenticated token user (PASS)
* **Cart & Address Suite Result: 38 PASSED, 0 FAILED**

---

## 8. Regression Verification Across All Phases

* Foundation Test Suite (`node scripts/verify-foundation.js`): **13 PASSED, 0 FAILED**
* Database Models Suite (`node scripts/verify-models.js`): **30 PASSED, 0 FAILED**
* Catalog APIs Suite (`node scripts/verify-catalog.js`): **23 PASSED, 0 FAILED**
* Cart & Address APIs Suite (`node scripts/verify-cart-address.js`): **38 PASSED, 0 FAILED**
* Health Check Probe (`GET /api/health`): **200 OK (`database: "connected"`)**

---

## 9. Files Changed

* `svhub-backend/src/controllers/cartController.js` (Created)
* `svhub-backend/src/controllers/addressController.js` (Created)
* `svhub-backend/src/routes/cart.js` (Created)
* `svhub-backend/src/routes/addresses.js` (Created)
* `svhub-backend/src/routes/index.js` (Modified: registered cart and addresses routers)
* `svhub-backend/scripts/verify-cart-address.js` (Created: 38-check automated test suite)
* `docs/PHASE_1_4_CART_ADDRESS_APIS.md` (Created: architectural implementation report)

---

## 10. Frontend Changes

```text
0 frontend files changed
```

No frontend UI files, styling, or client-side storage mechanisms were altered.

---

## 11. Known Issues

* None. All Cart and Address endpoints, ownership isolation checks, stock limits, and default address mechanics are operating with zero errors.

---

## 12. Final Status

```text
PHASE 1.4 COMPLETE
```

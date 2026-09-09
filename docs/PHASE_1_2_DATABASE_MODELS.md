# PHASE 1.2 — DATABASE MODELS IMPLEMENTATION REPORT

**Project:** SV Hub E-Commerce Application  
**Phase:** Phase 1.2 — Database Models Implementation  
**Status:** `PHASE 1.2 COMPLETE`  
**Date:** September 9, 2026  
**Architectural Baseline:** Phase 0.2 Final Architecture Freeze (`docs/DATABASE_REQUIREMENTS.md`, `docs/DATABASE_RELATIONSHIPS.md`, `docs/API_CONTRACT.md`)

---

## 1. Models Implemented

All 9 frozen database entities established in the Phase 0.2 architecture specification were implemented using Mongoose ODM in `svhub-backend/src/models/`:

1. **`User` (`src/models/User.js`)**: Authentication and RBAC model for customers and administrative staff. Strictly enforces uppercase roles (`CUSTOMER`, `ADMIN`) and account statuses (`ACTIVE`, `VIP`, `INACTIVE`, `SUSPENDED`). Includes sanitized `toPublic()` method excluding sensitive hashes and reset tokens.
2. **`Product` (`src/models/Product.js`)**: Master catalog items across both houses (`nutri-hub`, `self-care`) with co-located embedded pack-size variants (`Product.variants[]`), editorial copy, hero image, and gallery.
3. **`Category` (`src/models/Category.js`)**: Product categories grouped by brand house with URL slug indexing, description blurb, display sort order, and active visibility flags.
4. **`Cart` (`src/models/Cart.js`)**: 1:1 persistent shopping cart for authenticated customers storing canonical line item identifiers (`productId`, `variantId`, `quantity`). Allows multiple variants of the same product as separate lines.
5. **`Address` (`src/models/Address.js`)**: Customer address book entries with label classification (`Home`, `Work`, `Other`), standard Indian address components, PIN validation, and default address flag.
6. **`Order` (`src/models/Order.js`)**: Commercial contract preserving deep immutable snapshots of purchased items and shipping destinations, server-calculated totals, fulfillment states, and operational audit history.
7. **`Payment` (`src/models/Payment.js`)**: Decoupled financial transaction audit trail designed for idempotent payment gateway tracking (Razorpay order IDs, payment IDs, verification signatures, and raw webhook payloads).
8. **`Settings` (`src/models/Settings.js`)**: Operational singleton storing site-wide shipping fees, free shipping thresholds, low stock alerts, and customer support contacts.
9. **`Counter` (`src/models/Counter.js`)**: Atomic sequential sequence generator powering deterministic human-readable order numbers (e.g. `#SVH-10001`).
10. **`index.js` (`src/models/index.js`)**: Clean barrel export for all models.

---

## 2. Schema Relationships

The data architecture adheres strictly to the separation of **Live Dynamic References** and **Historical Immutable Snapshots**:

| Relationship | Cardinality | Storage Strategy | Integrity Behavior |
| :--- | :--- | :--- | :--- |
| **`User` ↔ `Cart`** | `1 : 1` | Live reference (`userId` on Cart, `unique: true`) | Exactly one cart per customer; cleared upon order payment confirmation |
| **`User` ↔ `Address`** | `1 : N` | Live reference (`userId` on Address, indexed) | Reusable address book entries for checkout selection |
| **`User` ↔ `Order`** | `1 : N` | Live reference (`userId` on Order, indexed) | Links historical orders to customer account |
| **`Category` ↔ `Product`** | `1 : N` | Live reference (`Product.category` → `Category.slug`) | Dynamic category filtering across storefronts |
| **`Product` ↔ `Variant`** | `1 : N` | **Embedded subdocuments** (`Product.variants[]`) | Co-located pack sizes (500g, 1kg) for zero-join PDP reads and atomic inventory updates |
| **`Cart` ↔ `CartItem`** | `1 : N` | Embedded subdocuments | Composite line uniqueness `(productId, variantId)` |
| **`Order` ↔ `Product Snapshot`** | `1 : N` | **IMMUTABLE SNAPSHOT** (`Order.items[]`) | Deep copy of product title, SKU, variant label, unit price, quantity, and line total |
| **`Order` ↔ `Address Snapshot`** | `1 : 1` | **IMMUTABLE SNAPSHOT** (`Order.shippingAddress`) | Deep copy of recipient name, phone, street, city, state, and PIN |
| **`Order` ↔ `Payment`** | `1 : N` | Decoupled live reference (`Payment.orderId` → `Order._id`) | Enables multiple payment attempts for an order until one succeeds |

---

## 3. Important Indexes

Indexes were deliberately created to optimize query performance and enforce unique business constraints:

* **User**:
  - `email`: Unique (`unique: true`)
  - `firebaseUid`: Sparse unique (`sparse: true, unique: true`)
  - `role`: Standard index (for staff queries)
  - `status`: Standard index (for status filtering)
* **Product**:
  - `slug`: Unique (`unique: true`)
  - `sku`: Unique (`unique: true`)
  - `storefront`: Standard index (storefront filtering)
  - `category`: Standard index (category filtering)
  - `price`: Standard index (price sorting)
  - `isActive`, `isFeatured`: Standard indexes (catalog filtering)
  - `variants.sku`: Subdocument index
  - Text search: Compound text index on `{ name: 'text', description: 'text', type: 'text' }`
* **Category**:
  - `slug`: Unique (`unique: true`)
  - `storefront`: Standard index
  - `active`: Standard index
* **Cart**:
  - `userId`: Unique (`unique: true`, enforces 1:1 user cart constraint)
* **Address**:
  - `userId`: Standard index (user address book lookups)
* **Order**:
  - `orderNumber`: Unique (`unique: true`)
  - `userId`: Standard index (customer order history)
  - `email`: Standard index (customer lookup)
  - `status`: Standard index (admin fulfillment dashboard)
  - `paymentStatus`: Standard index (payment auditing)
  - `paymentId`, `razorpayOrderId`: Sparse indexes
  - `createdAt`: Standard index (chronological sorting)
* **Payment**:
  - `orderId`: Standard index
  - `razorpayOrderId`: Unique (`unique: true`)
  - `razorpayPaymentId`: Sparse unique (`sparse: true, unique: true`)
  - `status`: Standard index
* **Settings**:
  - `key`: Unique (`unique: true`, enforces singleton)
* **Counter**:
  - `key`: Unique (`unique: true`)

---

## 4. Validation Rules

Integrity validations implemented at the schema level:
* **Non-Negative Numerics**: Prices, stocks, shipping fees, thresholds, and totals enforce `min: 0`.
* **Percentage Ranges**: Product and order variant discounts enforce `min: 0, max: 100`.
* **Pack Size Integrity**: Every `Product` document requires at least one variant (`variants.length > 0`).
* **Cart Quantity Bounds**: Cart item quantity enforces `min: 1, max: 99`.
* **Order Snapshot Bounds**: Orders require at least one line item snapshot (`items.length > 0`).
* **Format & String Sanitization**: Trimmed strings and lowercased email slugs prevent whitespace and case collisions.
* **Role & Status Protection**: User `role` strictly restricts to `['CUSTOMER', 'ADMIN']`; account `status` strictly restricts to `['ACTIVE', 'VIP', 'INACTIVE', 'SUSPENDED']`.

---

## 5. Historical Snapshots Design

To prevent future catalog edits, price increases, variant deprecations, or customer address changes from corrupting financial and logistics audits, historical snapshots are implemented:

1. **Order Item Snapshot (`Order.items[]`)**:
   ```json
   {
     "productId": "ObjectId",
     "variantId": "1kg",
     "productName": "Kullakar Rice",
     "variantLabel": "1 kg",
     "weight": "1 kg",
     "sku": "SVH-NH-KUL-1KG",
     "unitPrice": 460,
     "originalPrice": 520,
     "discount": 12,
     "quantity": 2,
     "lineTotal": 920,
     "image": "https://images.unsplash.com/...",
     "storefront": "nutri-hub"
   }
   ```
2. **Shipping Address Snapshot (`Order.shippingAddress`)**:
   ```json
   {
     "name": "Priya Venkatesh",
     "phone": "9876543210",
     "street": "142, Trichy Road, Singanallur",
     "city": "Coimbatore",
     "state": "Tamil Nadu",
     "pin": "641005",
     "country": "India",
     "lines": ["142, Trichy Road, Singanallur", "Coimbatore, Tamil Nadu", "641005"]
   }
   ```

---

## 6. Status Enums

The exact enums implemented in the Mongoose schemas:

* **User Role:**
  `['CUSTOMER', 'ADMIN']`
* **User Status:**
  `['ACTIVE', 'VIP', 'INACTIVE', 'SUSPENDED']`
* **Order Fulfillment Status:**
  `['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REQUIRES_RECONCILIATION']`
* **Order Payment Status:**
  `['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']`
* **Payment Transaction Status:**
  `['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']`
* **Address Label:**
  `['Home', 'Work', 'Other']`
* **Storefront House:**
  `['nutri-hub', 'self-care']`

---

## 7. Migration Requirements

* **Existing Development User Data:**
  - Existing user documents in MongoDB are fully compatible.
  - The schema's case-normalizing setters gracefully normalize lowercase roles/statuses (`'customer'` → `'CUSTOMER'`, `'active'` → `'ACTIVE'`) on read/write.
  - No destructive migrations or database resets are needed.

---

## 8. Tests & Verification

### Test Commands Executed:
1. `node scripts/verify-models.js`
2. `node scripts/verify-foundation.js`
3. `curl.exe -s http://localhost:5000/api/health`

### Test Results:
* **Database Models Verification (`scripts/verify-models.js`)**:
  - `User`: Valid CUSTOMER accepted (PASS)
  - `User`: Valid ADMIN accepted (PASS)
  - `User`: Invalid role rejected (PASS)
  - `User`: Invalid status rejected (PASS)
  - `User`: `toPublic()` strips passwordHash and reset tokens (PASS)
  - `Product`: Valid product with variants accepted (PASS)
  - `Product`: Negative base price rejected (PASS)
  - `Product`: Negative variant price rejected (PASS)
  - `Product`: Negative stock rejected (PASS)
  - `Product`: Empty variants array rejected (PASS)
  - `Category`: Valid category accepted (PASS)
  - `Category`: `isActive` virtual works (PASS)
  - `Category`: Duplicate slug prevented via unique index (PASS)
  - `Cart`: Valid cart with multiple variants of same product accepted (PASS)
  - `Cart`: Zero/negative quantity rejected (PASS)
  - `Address`: Valid address accepted (PASS)
  - `Address`: Aliases (`addressLine1`, `postalCode`) match (PASS)
  - `Address`: Missing required recipient fields rejected (PASS)
  - `Order`: Valid order with item & address snapshots accepted (PASS)
  - `Order`: Invalid fulfillment status rejected (PASS)
  - `Order`: Invalid payment status rejected (PASS)
  - `Order`: Duplicate `orderNumber` prevented via unique index (PASS)
  - `Payment`: Valid payment record accepted (PASS)
  - `Payment`: Invalid payment status rejected (PASS)
  - `Payment`: Duplicate `razorpayOrderId` prevented via unique index (PASS)
  - `Settings`: Valid settings structure accepted (PASS)
  - `Settings`: Negative shipping fee rejected (PASS)
  - `Settings`: `Settings.getSettings()` retrieves/creates singleton (PASS)
  - `Counter`: Atomic `getNextSequence` increments sequentially (PASS)
  - **Summary: 30 PASSED, 0 FAILED**

* **Foundation Security & Auth Suite (`scripts/verify-foundation.js`)**:
  - **Summary: 13 PASSED, 0 FAILED**

* **Health Check Probe (`/api/health`)**:
  - `{"success":true,"service":"svhub-backend","status":"ok","database":"connected"}` (200 OK)

---

## 9. Files Changed

### Created / Modified Files:
* `svhub-backend/src/models/User.js` (Updated: strict role and status enum validation)
* `svhub-backend/src/models/Product.js` (Created: Product and embedded Variant schemas)
* `svhub-backend/src/models/Category.js` (Created: Category schema)
* `svhub-backend/src/models/Cart.js` (Created: Cart and canonical CartItem schemas)
* `svhub-backend/src/models/Address.js` (Created: Address schema with alias virtuals)
* `svhub-backend/src/models/Order.js` (Created: Order schema with immutable snapshots)
* `svhub-backend/src/models/Payment.js` (Created: Decoupled Payment audit schema)
* `svhub-backend/src/models/Settings.js` (Created: Store operations singleton schema)
* `svhub-backend/src/models/Counter.js` (Created: Atomic sequential counter schema)
* `svhub-backend/src/models/index.js` (Created: Barrel export for all models)
* `svhub-backend/scripts/verify-models.js` (Created: Automated model test suite)
* `docs/PHASE_1_2_DATABASE_MODELS.md` (Created: Architectural implementation report)

---

## 10. Frontend Changes

```text
0 frontend files changed
```

No frontend UI, components, or configurations were modified.

---

## 11. Final Status

```text
PHASE 1.2 COMPLETE
```

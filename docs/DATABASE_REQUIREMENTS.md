# SV Hub — Database Requirements Specification (Phase 0.2 Final Freeze)

> **Document Version:** 2.1.0 (Phase 0.2 Final Freeze)  
> **Database Engine:** MongoDB 7.0+ (via Mongoose ODM)  
> **Architecture Pattern:** Document-oriented with co-located embedded subdocuments (variants, snapshots) and decoupled transaction audit logs.

---

## 1. Entity: `User`

* **Collection Name:** `users`
* **Purpose:** Stores customer and staff credentials, authentication methods, contact details, role-based access control, and account statuses.

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `name` | `String` | Yes | No | No | None | User's full name (min 2 characters, trimmed). |
| `email` | `String` | Yes | No | Yes | Indexed (`unique: true`) | Primary email address (lowercased, trimmed). |
| `phone` | `String` | No | Yes | No | Indexed (`sparse: true`) | 10-digit Indian mobile number (e.g. `9876543210`). Not globally unique to support Google accounts initialized without phone numbers. |
| `passwordHash` | `String` | No | Yes | No | None | Bcrypt password hash (12 salt rounds). Empty for Google-only users. |
| `firebaseUid` | `String` | No | Yes | Yes | Indexed (`sparse: true, unique: true`) | Firebase OAuth UID for Google-authenticated users. |
| `provider` | `String` | Yes | No | No | None | Sign-in provider: enum `['PASSWORD', 'GOOGLE']`. Default `'PASSWORD'`. |
| `role` | `String` | Yes | No | No | Indexed | Access control role: enum `['CUSTOMER', 'ADMIN']`. Default `'CUSTOMER'`. |
| `status` | `String` | Yes | No | No | Indexed | Account status: enum `['ACTIVE', 'VIP', 'INACTIVE', 'SUSPENDED']`. Default `'ACTIVE'`. |
| `resetTokenHash`| `String` | No | Yes | No | None | SHA-256 hash of random password reset token. |
| `resetTokenExpires`| `Date`| No | Yes | No | None | Timestamp when the reset token expires (TTL: 30 minutes). |
| `notes` | `String` | No | Yes | No | None | Internal staff notes about this customer (viewed in admin customer CRM). |
| `createdAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |
| `updatedAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |

### Role-Based Access Control (RBAC) Integrity Rules:
* **Normalized Role Enum:** Role is strictly uppercase: `'CUSTOMER'` or `'ADMIN'`. (Existing code using lowercase `'customer'`/`'admin'` must be normalized during Mongoose validation).
* **Single User Collection:** Both customers and administrative staff reside in the `users` collection.
* **Admin Provisioning:** Admin accounts cannot self-register. `role: 'ADMIN'` is granted exclusively via database administrator CLI seed scripts.
* **Suspended Accounts:** If `status === 'SUSPENDED'` or `'INACTIVE'`, authentication middleware halts requests with HTTP `403 Forbidden` (`code: "account_inactive"`).

---

## 2. Entity: `Product` & Embedded `Variant` Architecture

* **Collection Name:** `products`
* **Purpose:** Stores complete catalogue items across both houses (Nutri-Hub and Self-Care), rich editorial descriptions, image galleries, and embedded pack-size/weight variants.

### 2.1 Product Schema (Parent Document)

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `slug` | `String` | Yes | No | Yes | Indexed (`unique: true`) | URL slug used in routes (e.g. `kullakar-rice`, `vettiver-soap`). |
| `name` | `String` | Yes | No | No | Text Indexed | Display name of the product. |
| `type` | `String` | Yes | No | No | None | Sub-type classification (e.g., `Native Rice`, `Pickle / Thokku`, `Handmade Soap`). |
| `storefront` | `String` | Yes | No | No | Indexed | Brand house: enum `['nutri-hub', 'self-care']`. |
| `category` | `String` | Yes | No | No | References `Category.slug` (Indexed) | Category identifier (e.g. `native-rice`, `pickles`, `handmade-soaps`). |
| `description` | `String` | Yes | No | No | None | Editorial and marketing description text. |
| `ingredients` | `[String]` | No | No | No | None | Array of pure ingredients (e.g. `["Kullakar rice"]`). |
| `specifications` | `[Object]` | No | No | No | None | Key-value accordion items: `[{ label: "Origin", value: "Tamil Nadu" }]`. |
| `image` | `String` | Yes | No | No | None | Hero image URL. |
| `gallery` | `[String]` | No | No | No | None | Additional image URLs for PDP carousel. |
| `price` | `Number` | Yes | No | No | Indexed | Base/display price in INR (used for sorting and shop grid display). |
| `originalPrice`| `Number` | No | Yes | No | None | Base strike-through compare price in INR. |
| `discount` | `Number` | No | Yes | No | None | Discount percentage (e.g. `12` for 12% off). |
| `weight` | `String` | Yes | No | No | None | Base pack weight label (e.g. `500 g`, `200 g`). |
| `sku` | `String` | Yes | No | Yes | Indexed (`unique: true`) | Base operational SKU code. |
| `qty` | `Number` | Yes | No | No | None | Aggregate physical stock across all variants. |
| `isActive` | `Boolean` | Yes | No | No | Indexed | Catalog visibility toggle. Default `true`. |
| `isFeatured` | `Boolean` | Yes | No | No | Indexed | Featured product ribbon toggle for Home page strip. Default `false`. |
| `variants` | `[Variant]`| Yes | No | No | Embedded Array | Array of pack-size/weight variant subdocuments. |
| `createdAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |
| `updatedAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |

### 2.2 Embedded `Variant` Schema (Subdocument)

```json
{
  "variantId": "1kg",
  "label": "1 kg",
  "weight": "1 kg",
  "sku": "SVH-NH-KUL-1KG",
  "price": 460,
  "originalPrice": 520,
  "discount": 12,
  "qty": 35,
  "isActive": true
}
```

| Field | Type | Required? | Purpose |
| :--- | :--- | :--- | :--- |
| `variantId` | `String` | Yes | Identifier for pack size (e.g. `'500g'`, `'1kg'`, `'200g'`, `'400g'`). Unique within product. |
| `label` | `String` | Yes | Display label shown in pack selector pill (e.g. `'500 g'`, `'1 kg'`). |
| `weight` | `String` | Yes | Standardized weight string (e.g. `'1 kg'`). |
| `sku` | `String` | Yes | Warehouse inventory SKU (e.g. `'SVH-NH-KUL-1KG'`). |
| `price` | `Number` | Yes | Variant selling price in INR (e.g. `460`). |
| `originalPrice`| `Number` | No | Strike-through compare price in INR (e.g. `520`). Null if no discount. |
| `discount` | `Number` | No | Discount percentage (`Math.round(((originalPrice - price) / originalPrice) * 100)`). |
| `qty` | `Number` | Yes | Physical inventory on hand for this specific pack size. |
| `isActive` | `Boolean` | Yes | Whether this pack size is available for purchase. Default `true`. |

---

## 3. Entity: `Cart` & Embedded `CartItem` Data Model

* **Collection Name:** `carts`
* **Purpose:** Maintains shopping cart persistence for authenticated users.

### 3.1 Cart Schema

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `userId` | `ObjectId` | Yes | No | Yes | References `User._id` (`unique: true`) | Associated authenticated customer ID. |
| `items` | `[CartItem]`| Yes | No | No | Embedded Array | Array of shopping cart items. |
| `createdAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |
| `updatedAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |

### 3.2 Embedded `CartItem` Schema

```json
{
  "productId": "66dec101f89a2b1c3d000001",
  "slug": "kullakar-rice",
  "variantId": "1kg",
  "name": "Kullakar Rice",
  "weight": "1 kg",
  "sku": "SVH-NH-KUL-1KG",
  "price": 460,
  "originalPrice": 520,
  "quantity": 2,
  "image": "https://images.unsplash.com/...",
  "storefront": "nutri-hub"
}
```

* **Composite Line Key:** Cart line items are uniquely identified by `(productId, variantId)`.
* **Authoritative Price Resolution:** Frontend submitted prices are ignored. When cart items are fetched or modified, prices are resolved directly from `Product.variants`.
* **Cart Merge on Login:** Pre-login guest items stored in browser storage are sent to `POST /api/cart/merge` upon authentication, reconciling into the user's server cart (capped at 12 units per line).

---

## 4. Entity: `Order` (Immutable Snapshot Architecture)

* **Collection Name:** `orders`
* **Purpose:** Legal, financial, and commercial contract representing a customer's purchase.

> [!IMPORTANT]
> **IMMUTABLE SNAPSHOT PRINCIPLE:**
> Historical orders must NEVER link dynamically to live `products` or `addresses` collections. Once an order is created, product prices, descriptions, and delivery addresses are immutably preserved in deep snapshots.

### 4.1 Order Schema

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `orderNumber` | `String` | Yes | No | Yes | Indexed (`unique: true`) | Sequential order code (e.g. `SVH-10001`). |
| `userId` | `ObjectId` | Yes | No | No | References `User._id` (Indexed)| Customer account ID (V1 requires authenticated checkout). |
| `customerName`| `String` | Yes | No | No | None | Customer full name. |
| `email` | `String` | Yes | No | No | Indexed | Customer email address for notifications. |
| `phone` | `String` | Yes | No | No | None | 10-digit delivery contact phone number. |
| `shippingAddress`| `Object`| Yes | No | No | None (Deep Immutable Snapshot)| Complete snapshot of delivery address. |
| `items` | `[Object]` | Yes | No | No | None (Deep Immutable Snapshot)| Array of purchased items with immutable pricing. |
| `subtotal` | `Number` | Yes | No | No | None | Authoritative sum of line totals (`sum(unitPrice * quantity)`). |
| `shippingFee` | `Number` | Yes | No | No | None | Delivery charge calculated by backend rules (e.g. `0`, `40`, `120`). |
| `discount` | `Number` | Yes | No | No | None | Promotional discount deducted (default `0`). |
| `totalAmount` | `Number` | Yes | No | No | None | Final payable total in INR (`subtotal + shippingFee - discount`). |
| `status` | `String` | Yes | No | No | Indexed | Fulfillment state: enum `['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']`. Default `'PENDING_PAYMENT'`. |
| `paymentStatus`| `String`| Yes | No | No | Indexed | Payment state: enum `['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']`. Default `'PENDING'`. |
| `paymentMethod`| `String`| No | Yes | No | None | Payment instrument label (e.g. `'Razorpay UPI'`, `'Razorpay Card'`). |
| `paymentId` | `String` | No | Yes | No | Indexed | Razorpay payment ID (e.g. `pay_29QQoUBcxrhEr`). |
| `razorpayOrderId`| `String`| No | Yes | No | Indexed | Razorpay order ID (e.g. `order_EKfWjp8VWmOfWe`). |
| `courier` | `String` | No | Yes | No | None | Logistics courier partner (e.g. `'BlueDart Express'`). |
| `trackingNumber`| `String`| No | Yes | No | None | Consignment / AWB tracking code. |
| `notes` | `String` | No | Yes | No | None | Internal staff operational notes. |
| `history` | `[Object]` | Yes | No | No | None | Audit log of fulfillment transitions: `[{ status, at: Date, note: String }]`. |
| `createdAt` | `Date` | Yes | No | No | Indexed | Timestamp of order creation. |
| `updatedAt` | `Date` | Yes | No | No | None | Timestamp of last order update. |

### 4.2 Immutable Product Snapshot Schema (`order.items[]`)
```json
{
  "productId": "66dec101f89a2b1c3d000001",
  "variantId": "1kg",
  "productName": "Kullakar Rice",
  "variantLabel": "1 kg",
  "weight": "1 kg",
  "sku": "SVH-NH-KUL-1KG",
  "unitPrice": 460,
  "quantity": 2,
  "lineTotal": 920,
  "image": "https://images.unsplash.com/...",
  "storefront": "nutri-hub"
}
```

### 4.3 Immutable Delivery Address Snapshot Schema (`order.shippingAddress`)
```json
{
  "name": "Priya Venkatesh",
  "phone": "9876543210",
  "street": "142, Trichy Road, Singanallur",
  "city": "Coimbatore",
  "state": "Tamil Nadu",
  "pin": "641005",
  "lines": [
    "142, Trichy Road, Singanallur,",
    "Coimbatore, Tamil Nadu,",
    "641005"
  ]
}
```

---

## 5. Entity: `Payment` (Decoupled Financial Audit Trail)

* **Collection Name:** `payments`
* **Purpose:** Complete transactional record of all Razorpay payment attempts, cryptographic verification signatures, webhook events, and refunds.

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `orderId` | `ObjectId` | Yes | No | No | References `Order._id` (Indexed)| Associated application order document ID. |
| `userId` | `ObjectId` | Yes | No | No | References `User._id` | Associated customer ID. |
| `amount` | `Number` | Yes | No | No | None | Transaction amount in paise (e.g. `53800` for ₹538.00). |
| `currency` | `String` | Yes | No | No | None | Currency code (strictly `'INR'`). |
| `gateway` | `String` | Yes | No | No | None | Payment gateway provider (`'razorpay'`). |
| `status` | `String` | Yes | No | No | Indexed | State: enum `['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED']`. |
| `razorpayOrderId`| `String` | Yes | No | Yes | Indexed (`unique: true`) | Gateway order ID generated by Razorpay. |
| `razorpayPaymentId`| `String`| No | Yes | Yes | Indexed (`sparse: true, unique: true`)| Gateway transaction ID generated by Razorpay upon payment. |
| `razorpaySignature`| `String`| No | Yes | No | None | HMAC-SHA256 signature string for verification. |
| `verified` | `Boolean` | Yes | No | No | None | Whether signature was cryptographically validated. Default `false`. |
| `errorReason` | `String` | No | Yes | No | None | Detailed failure reason returned by Razorpay API or webhook. |
| `rawWebhookPayload`| `Object` | No | Yes | No | None | Raw JSON webhook payload received for compliance and audit. |
| `createdAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |

---

## 6. Entity: `Address` (Customer Address Book)

* **Collection Name:** `addresses`
* **Purpose:** Stores customer saved delivery addresses in `/account/addresses` for fast reuse during checkout.

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `userId` | `ObjectId` | Yes | No | No | References `User._id` (Indexed)| Account owner. |
| `label` | `String` | Yes | No | No | None | Tag: enum `['Home', 'Work', 'Other']`. Default `'Home'`. |
| `name` | `String` | Yes | No | No | None | Recipient's full name. |
| `phone` | `String` | Yes | No | No | None | 10-digit Indian delivery mobile phone. |
| `street` | `String` | Yes | No | No | None | Flat/house number, apartment name, street address. |
| `city` | `String` | Yes | No | No | None | City name (e.g. `Coimbatore`, `Chennai`). |
| `state` | `String` | Yes | No | No | None | Indian State/UT (e.g. `Tamil Nadu`, `Kerala`). |
| `pin` | `String` | Yes | No | No | None | 6-digit postal PIN code (e.g. `641002`). |
| `country` | `String` | Yes | No | No | None | Country name. Default `'India'`. |
| `isDefault` | `Boolean` | Yes | No | No | None | Whether this is the customer's primary address. |
| `createdAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |
| `updatedAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |

---

## 7. Entity: `Category`

* **Collection Name:** `categories`
* **Purpose:** Defines product categories grouped under each brand house with metadata and visual assets.

| Field | Type | Required? | Nullable? | Unique? | Relationship / Index | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Yes | Primary Key | MongoDB document identifier. |
| `slug` | `String` | Yes | No | Yes | Indexed (`unique: true`) | URL slug (e.g. `native-rice`, `pickles`, `handmade-soaps`). |
| `name` | `String` | Yes | No | No | None | Category display name (e.g. `Native Rice`, `Handmade Soaps`). |
| `storefront` | `String` | Yes | No | No | Indexed | Brand house: enum `['nutri-hub', 'self-care']`. |
| `description` | `String` | Yes | No | No | None | Category summary blurb displayed on Category and Shop pages. |
| `image` | `String` | No | Yes | No | None | Banner/card image URL. |
| `active` | `Boolean` | Yes | No | No | Indexed | Category visibility toggle. Default `true`. |
| `sortOrder` | `Number` | No | No | No | None | Numeric order for display sorting. |
| `createdAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |
| `updatedAt` | `Date` | Yes | No | No | None | Auto-generated timestamp. |

---

## 8. Entity: `Settings` (Store Operations Singleton)

* **Collection Name:** `settings`
* **Purpose:** Singleton configuration document storing site-wide operational shipping rules, thresholds, and customer care contacts.

| Field | Type | Required? | Nullable? | Default | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `_id` | `ObjectId` | Yes | No | Auto | Singleton document ID. |
| `supportEmail` | `String` | Yes | No | `'care@svhub.in'` | Storefront customer support email. |
| `supportPhone` | `String` | Yes | No | `'+91 98765 43210'` | Storefront customer care phone. |
| `standardShippingFee` | `Number` | Yes | No | `40` | Default standard shipping cost in INR. |
| `expressShippingFee` | `Number` | Yes | No | `120` | Express delivery charge in INR. |
| `freeShippingThreshold`| `Number` | Yes | No | `499` | Subtotal threshold above which standard shipping is free (INR). |
| `lowStockThreshold` | `Number` | Yes | No | `10` | Inventory threshold for flagging "low stock" badge in admin inventory. |
| `currency` | `String` | Yes | No | `'INR'` | Store currency ISO code. |
| `updatedAt` | `Date` | Yes | No | Auto | Timestamp of last configuration change. |

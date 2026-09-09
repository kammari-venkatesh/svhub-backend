# PHASE 1.7 — SV HUB CANONICAL 37-PRODUCT CATALOG & CATEGORY MIGRATION

## Executive Summary
Phase 1.7 establishes the canonical 37-product catalog and 4 product categories as authoritative in MongoDB, completely replacing all legacy mock/placeholder data across the backend database, category API layer, and customer frontend components.

All legacy/invented products (21 items) have been safely deactivated (`isActive: false`), while all 37 canonical products and 4 canonical categories are active (`isActive: true` / `active: true`), verified, and tested across all catalog, cart, order, and admin verification suites with zero regressions.

---

## 1. Canonical Categories

MongoDB now contains exactly 4 active canonical categories:

| Category Name | Category Slug | House / Storefront | Active Products | Sort Order |
| :--- | :--- | :--- | :--- | :--- |
| **Pickles & Thokku** | `pickles-thokku` | `nutri-hub` | 17 | 1 |
| **Spice Powders & Masalas** | `spice-powders-masalas` | `nutri-hub` | 12 | 2 |
| **Idli Podi** | `idli-podi` | `nutri-hub` | 5 | 3 |
| **Health & Wellness** | `health-wellness` | `nutri-hub` | 3 | 4 |

**Total Active Categories**: 4  
**Total Inactive Categories**: 0

---

## 2. Canonical 37-Product Catalog Inventory

All 37 canonical products are seeded and active in MongoDB with real variants, weights, prices, and stock:

### Category 1: Pickles & Thokku (`pickles-thokku`) — 17 Products
1. **CUT MANGO PICKLE** (`cut-mango-pickle`) — 300g (₹160), 500g (₹250), 1kg (₹480)
2. **AVAKKAI MANGO PICKLE** (`avakkai-mango-pickle`) — 300g (₹160), 500g (₹250), 1kg (₹480)
3. **LEMON PICKLE** (`lemon-pickle`) — 300g (₹140), 500g (₹220), 1kg (₹420)
4. **GARLIC PICKLE** (`garlic-pickle`) — 300g (₹190), 500g (₹300), 1kg (₹580)
5. **TOMATO PICKLE** (`tomato-pickle`) — 300g (₹150), 500g (₹240), 1kg (₹460)
6. **GREEN CHILLI PICKLE** (`green-chilli-pickle`) — 300g (₹150), 500g (₹240), 1kg (₹460)
7. **RED CHILLI PICKLE** (`red-chilli-pickle`) — 300g (₹170), 500g (₹270), 1kg (₹520)
8. **GINGER PICKLE** (`ginger-pickle`) — 300g (₹170), 500g (₹270), 1kg (₹520)
9. **PIRANDAI THOKKU** (`pirandai-thokku`) — 300g (₹190), 500g (₹300), 1kg (₹580)
10. **GONCURA THOKKU** (`goncura-thokku`) — 300g (₹160), 500g (₹250), 1kg (₹480)
11. **CORIANDER THOKKU** (`coriander-thokku`) — 300g (₹160), 500g (₹250), 1kg (₹480)
12. **CURRY LEAVES THOKKU** (`curry-leaves-thokku`) — 300g (₹160), 500g (₹250), 1kg (₹480)
13. **MINT THOKKU** (`mint-thokku`) — 300g (₹160), 500g (₹250), 1kg (₹480)
14. **MANGO GINGER THOKKU** (`mango-ginger-thokku`) — 300g (₹180), 500g (₹290), 1kg (₹560)
15. **MANGO THOKKU** (`mango-thokku`) — 300g (₹160), 500g (₹250), 1kg (₹480)
16. **PULIKAICHAL** (`pulikaichal`) — 300g (₹170), 500g (₹270), 1kg (₹520)
17. **SMALL ONION THOKKU** (`small-onion-thokku`) — 300g (₹190), 500g (₹300), 1kg (₹580)
*(GINGER GARLIC PASTE: 300g ₹150, 500g ₹240, 1kg ₹460)*

### Category 2: Spice Powders & Masalas (`spice-powders-masalas`) — 12 Products
1. **Turmeric Powder** (`turmeric-powder`) — 100g (₹45), 250g (₹105), 500g (₹200)
2. **Chilli Powder** (`chilli-powder`) — 100g (₹55), 250g (₹130), 500g (₹250)
3. **Coriander Powder** (`coriander-powder`) — 100g (₹50), 250g (₹120), 500g (₹230)
4. **Sambar Powder** (`sambar-powder`) — 100g (₹65), 250g (₹155), 500g (₹300)
5. **Rasam Powder** (`rasam-powder`) — 100g (₹65), 250g (₹155), 500g (₹300)
6. **Paneer Butter Masala** (`paneer-butter-masala`) — 50g (₹40), 100g (₹75)
7. **Peri Peri Snack Seasoning** (`peri-peri-snack-seasoning`) — 50g (₹45), 100g (₹85)
8. **Chat Masala** (`chat-masala`) — 50g (₹40), 100g (₹75)
9. **Kulambu Chilli Powder** (`kulambu-chilli-powder`) — 100g (₹60), 250g (₹145), 500g (₹280)
10. **Garam Masala** (`garam-masala`) — 50g (₹45), 100g (₹85), 250g (₹200)
11. **Briyani Masala** (`briyani-masala`) — 50g (₹50), 100g (₹95), 250g (₹225)
12. **Cumin Powder** (`cumin-powder`) — 50g (₹45), 100g (₹85), 250g (₹200)

### Category 3: Idli Podi (`idli-podi`) — 5 Products
1. **Idli Podi – Regular** (`idli-podi-regular`) — 100g (₹50), 250g (₹120), 500g (₹230)
2. **Paruppu Podi** (`paruppu-podi`) — 100g (₹55), 250g (₹130), 500g (₹250)
3. **Murungai Idli Podi** (`murungai-idli-podi`) — 100g (₹60), 250g (₹145), 500g (₹280)
4. **Karuveppilai Idli Podi** (`karuveppilai-idli-podi`) — 100g (₹60), 250g (₹145), 500g (₹280)
5. **Ellu Idli Podi** (`ellu-idli-podi`) — 100g (₹60), 250g (₹145), 500g (₹280)

### Category 4: Health & Wellness (`health-wellness`) — 3 Products
1. **Multimillet Muesli** (`multimillet-muesli`) — 250g (₹180), 500g (₹340)
2. **Beetroot Nutrimix** (`beetroot-nutrimix`) — 250g (₹195), 500g (₹370)
3. **Healthmix** (`healthmix`) — 250g (₹175), 500g (₹330), 1kg (₹640)

---

## 3. Database Statistics
- **Total active canonical products**: 37
- **Total inactive legacy products**: 21
- **Total active categories**: 4
- **Total inactive categories**: 0
- **Zero active duplicate slugs**
- **Zero active legacy/mock products**

---

## 4. Backend Enhancements
1. **`svhub-backend/scripts/seed-products.js`**:
   - Seeded all 4 categories with active status, descriptions, and sortOrder.
   - Seeded all 37 canonical products with variants, prices, inventory, specifications, ingredients, and hero images.
   - Deactivated all legacy products (`isActive: false`).
2. **`svhub-backend/src/controllers/categoryController.js`**:
   - Added live product aggregation to `getCategories()` and `getCategoryByIdOrSlug()`.
   - Now includes `count` property representing the number of active products in each category.
3. **`svhub-backend/scripts/verify-canonical-products.js`**:
   - Automated verification suite testing all 37 canonical products, category associations, variant prices, stock, image presence, and legacy isolation.
   - Result: 230 / 230 tests passed.

---

## 5. Frontend Integration
1. **`svhub-frontend/src/api/categories.js`**:
   - Created public categories API client (`getCategories`, `getCategory`).
2. **`svhub-frontend/src/pages/Account/Overview.jsx`**:
   - Removed `getAccountOrders` and `getAccountAddresses` imports from `src/data/account.js`.
   - Replaced with async calls to `getOrders()` and `getAddresses()`.
   - Normalised data to preserve all existing visual cards, counters, and links.
3. **`svhub-frontend/src/pages/Shop/ShopFilters.jsx`**:
   - Replaced static `categoryCounts()` from `src/data/shop.js` with live `getCategories()` call.
   - Preserved all filter behaviors, badge counts, and reset logic.
4. **Vite Production Build**:
   - `npm run build` completed cleanly with 0 errors.

---

## 6. Verification Results
- `scripts/verify-canonical-products.js`: **230 / 230 PASSED**
- `scripts/verify-catalog.js`: **23 / 23 PASSED**
- `scripts/verify-cart-address.js`: **38 / 38 PASSED**
- `scripts/verify-orders.js`: **21 / 21 PASSED**
- `scripts/verify-admin-orders.js`: **30 / 30 PASSED**
- `scripts/verify-foundation.js`: **13 / 13 PASSED**
- `scripts/verify-models.js`: **30 / 30 PASSED**
- `scripts/qa-api-audit.js`: **108 / 108 PASSED**
- Frontend Vite build: **PASSED (0 errors)**

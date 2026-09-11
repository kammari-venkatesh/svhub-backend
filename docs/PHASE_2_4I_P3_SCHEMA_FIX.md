# PHASE 2.4I-P3 — PAYMENT SCHEMA DEFAULT HARDENING

**SV Hub — Production Payment Hardening**  
**Classification:** PASS (CONDITIONAL)  
**Date:** 2026-09-11  
**Scope:** Hardening `Payment.capturedAmount` schema default to unconditional `0` and validating full payment lifecycle integrity.

---

## 1. Executive Summary

During Phase 2.4I-R, a latent P3 defect was identified in the Mongoose schema for `Payment` (`src/models/Payment.js`): the schema defined a dynamic default function that derived `capturedAmount` from `this.amount` if `capturedAmount` was omitted.

Because a newly created payment has not yet succeeded or been captured by Razorpay, setting `capturedAmount` equal to `amount` at inception is semantically incorrect and represents a potential financial accounting hazard if any code path creates a payment without an explicit `capturedAmount`.

In Phase 2.4I-P3:
1. **Schema Fix Applied:** Changed `Payment.capturedAmount` schema default unconditionally to `0`.
2. **Behavior Preserved:** All existing application logic (payment fulfillment, refunds, webhooks, orders, inventory, frontend) was preserved without functional regressions.
3. **Focused Verification:** Created and executed `tests/verify-phase2-4i-p3-schema.js` (22/22 PASS).
4. **Full Regression Executed:** Ran Payment Core (54/54), Refunds (100/100), Cancellation/Refund Consistency (85/85), Adversarial Security (138/138), Real Razorpay Test Mode E2E (55/55), and Database Integrity (19/19) — totaling **473/473 PASS**.
5. **Zero Historical Modifications:** Historical financial records (including the ₹209 payment `6aa242c25aea5fc569c4b8ae` and production order #SVH-10265) were verified untouched.
6. **Frontend & Secret Scans:** Frontend built cleanly in 1.26s; secret scan confirmed 0 exposed credentials.

---

## 2. Root Cause Analysis (P3 Finding)

### File: `src/models/Payment.js`

### Pre-Fix Implementation:
```javascript
// BEFORE (Lines 22-29)
capturedAmount: {
  type: Number,
  default: function () {
    const val = this.capturedAmount !== undefined ? this.capturedAmount : this.amount
    return Number.isFinite(val) ? val : 0
  },
  min: [0, 'Captured amount cannot be negative'],
},
```

### Problem & Impact:
- If a caller instantiated `new Payment({ amount: 500, ... })` without providing `capturedAmount`, Mongoose evaluated the default function, returning `500`.
- The uncaptured, pending payment would immediately record `capturedAmount: 500`.
- Consequently, before any funds had cleared or were captured at the gateway, the system's financial invariants would treat the payment as if ₹500 were captured.
- **Why production was not corrupted:** In all existing service creation sites (`paymentController.js:195`, `paymentFulfillmentService.js:126, 321`), developers had explicitly supplied `capturedAmount: 0`. However, relying on caller diligence rather than model schema enforcement left a latent vulnerability for future features or scripts.

---

## 3. The Fix Applied

### File: `src/models/Payment.js` (Lines 22-26)

```javascript
// AFTER (Lines 22-26)
capturedAmount: {
  type: Number,
  default: 0,
  min: [0, 'Captured amount cannot be negative'],
},
```

### Diff:
```diff
     amount: {
       type: Number,
       required: [true, 'Payment amount is required'],
       min: [0, 'Payment amount cannot be negative'],
     },
     capturedAmount: {
       type: Number,
-      default: function () {
-        const val = this.capturedAmount !== undefined ? this.capturedAmount : this.amount
-        return Number.isFinite(val) ? val : 0
-      },
+      default: 0,
       min: [0, 'Captured amount cannot be negative'],
     },
     refundedAmount: {
```

### Invariants Maintained:
- `default: 0` ensures every new `Payment` document unconditionally starts with `capturedAmount = 0` unless explicitly provided.
- `min: [0, 'Captured amount cannot be negative']` prevents any negative amounts from being saved.
- No database migration was required because existing documents already had valid numeric values.

---

## 4. Payment Lifecycle Accounting Verification

Every stage of the payment lifecycle was tested against the hardened schema:

| Stage | Trigger / Action | Expected `capturedAmount` | Observed | Result |
|---|---|---|---|---|
| **Creation (Implicit)** | `new Payment({ amount: 500 })` without `capturedAmount` | `0` | `0` | ✅ PASS |
| **Creation (Explicit)** | `new Payment({ amount: 500, capturedAmount: 0 })` | `0` | `0` | ✅ PASS |
| **Fulfillment (Success)** | Razorpay signature verified / webhook processed | `= payment.amount` (e.g. 750) | `750` | ✅ PASS |
| **Payment Failure** | Gateway error or user decline | `0` | `0` | ✅ PASS |
| **Partial Refund** | Refund processed via service | Unchanged (`1000`) | `1000` | ✅ PASS |
| **Full Refund** | Full refund processed | Unchanged (`1000`) | `1000` | ✅ PASS |
| **Invalid Schema Input** | `capturedAmount: -50` | Validation Error | `Captured amount cannot be negative` | ✅ PASS |

---

## 5. Test Suites & Verification Results

### A. Focused P3 Regression (`tests/verify-phase2-4i-p3-schema.js`)
- **A.1–A.4:** In-memory and persisted default `capturedAmount === 0` (not derived from `amount`)
- **B.1–B.2:** Explicit `capturedAmount: 0` preserved in memory and DB
- **C.1–C.5:** Successful fulfillment sets `capturedAmount = amount`, `refundableAmount = capturedAmount - refundedAmount`
- **D.1–D.3:** Failed payment keeps `capturedAmount === 0`
- **E.1–E.5:** Refund execution never alters `capturedAmount`; updates `refundedAmount` and `refundableAmount` accurately
- **F.1:** Schema `min: 0` constraint rejects negative amounts
- **G.1–G.2:** Global DB financial invariants verified across all payments; historical ₹209 payment unmodified
- **Result: 22/22 PASSED (100%)**

### B. Database Integrity Audit (`scripts/audit-db-integrity.js`)
- 19 integrity checks executed across collections:
  - Zero duplicate Razorpay payment IDs, order IDs, refund IDs, webhook event IDs
  - Zero negative stock counts across all products/variants
  - Zero invalid order/payment/refund/webhook statuses
  - Zero orphan payments, refunds, or orders
  - Real existing orders (#SVH-10265) and payments intact
  - Invariant `refundableAmount = capturedAmount - refundedAmount` holds for all settled payments
- **Result: 19/19 PASSED (100%)**

### C. Full Regression Suite

| Suite | File | Assertions | Status |
|---|---|---|---|
| **Phase 2.4B Payment Core** | `tests/verify-phase2-4b-payment-core.js` | 54 / 54 | ✅ PASS |
| **Phase 2.4E Refunds** | `tests/verify-phase2-4e-refunds.js` | 100 / 100 | ✅ PASS |
| **Phase 2.4F Cancellation & Refund** | `tests/verify-phase2-4f-cancellation-refund.js` | 85 / 85 | ✅ PASS |
| **Phase 2.4H Adversarial Security** | `tests/verify-phase2-4h-adversarial.js` | 138 / 138 | ✅ PASS |
| **Phase 2.4I Real Razorpay E2E** | `tests/verify-phase2-4i-real-razorpay.js` | 55 / 55 | ✅ PASS |
| **Phase 2.4I-P3 Focused Schema** | `tests/verify-phase2-4i-p3-schema.js` | 22 / 22 | ✅ PASS |
| **DB Integrity Audit** | `scripts/audit-db-integrity.js` | 19 / 19 | ✅ PASS |
| **Total Assertions** | | **473 / 473** | **100% PASS** |

---

## 6. Frontend Build & Secret Audit

### Frontend Build
- **Command:** `npm run build` in `svhub-frontend`
- **Output:** `✓ built in 1.26s` with all assets emitted to `dist/`
- **Exit Code:** 0 (Clean build)

### Secret Audit
- **Scope:** All `.js`, `.ts`, `.env*` files across repository (excluding `node_modules`, `.git`, `dist`)
- **Query:** `rzp_live_`, `rzp_test_[A-Za-z0-9]{20}`
- **Findings:**
  - Zero live Razorpay credentials (`rzp_live_`) in any code or config.
  - Zero hardcoded test secrets in application code.
  - Only expected occurrence of `rzp_live_` is in the negative assertion test line `verify-phase2-4i-real-razorpay.js:108`.

---

## 7. Historical Data Protection Audit

| Historical Entity | ID / Reference | Expected State | Actual State | Modified? |
|---|---|---|---|---|
| Historical Payment | `6aa242c25aea5fc569c4b8ae` | ₹209, REQUIRES_RECONCILIATION, `capturedAmount: 0` | ₹209, REQUIRES_RECONCILIATION, `capturedAmount: 0` | **NO** |
| Production Order | `#SVH-10265` | PROCESSING, ₹209, intact items snapshot | PROCESSING, ₹209, intact items snapshot | **NO** |
| General DB Records | Collections: orders, payments, refunds, products | Invariants preserved, zero negative stock | All invariants intact | **NO** |

**Historical Financial Records Modified:** NO  
**Historical Financial Records Deleted:** NO  

---

## 8. Defect & Remediation Tracker

| Defect ID | Severity | Description | Status | Verification |
|---|---|---|---|---|
| **P1-1** | P1 | `capturedAmount` initialization in `paymentFulfillmentService.js` | RESOLVED | Verified in 2.4I-R (55/55 PASS) |
| **P2-1** | P2 | Real external Razorpay cloud webhook delivery (localhost/NAT) | REMAINING (KNOWN) | Marked CONDITIONAL — requires public ingress URL/tunnel |
| **P3-1** | P3 | `Payment.capturedAmount` schema default deriving from `this.amount` | **RESOLVED** | Schema hardened to `default: 0`; 22/22 PASS |

- **Remaining P0:** 0
- **Remaining P1:** 0
- **Remaining P2:** 1 (External Razorpay webhook delivery on localhost/NAT)
- **Remaining P3:** 0

---

## 9. Final Structured Result

```
PHASE_2_4I_P3_SCHEMA_FIX:               PASS (CONDITIONAL)

CAPTURED_AMOUNT_SCHEMA_DEFAULT:        PASS
NEW_PAYMENT_DEFAULT:                   0
SUCCESSFUL_PAYMENT_ACCOUNTING:         PASS
FAILED_PAYMENT_ACCOUNTING:             PASS
REFUND_ACCOUNTING:                     PASS
DATABASE_INTEGRITY:                    PASS (19/19)

HISTORICAL_FINANCIAL_RECORDS_MODIFIED: NO
HISTORICAL_FINANCIAL_RECORDS_DELETED:  NO

REGRESSION:                            PASS (473/473 assertions across 7 test suites)
FRONTEND_BUILD:                        PASS
SECRET_AUDIT:                          PASS

REMAINING_P0:                          0
REMAINING_P1:                          0
REMAINING_P2:                          1 (REAL_EXTERNAL_RAZORPAY_WEBHOOK — localhost/NAT)
REMAINING_P3:                          0

FINAL_VERDICT:                         PASS (CONDITIONAL)
```

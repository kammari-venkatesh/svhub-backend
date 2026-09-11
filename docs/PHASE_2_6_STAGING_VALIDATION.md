# PHASE 2.6 — SV HUB STAGING DEPLOYMENT & REAL EXTERNAL RAZORPAY WEBHOOK VALIDATION
**STAGING READINESS & VALIDATION REPORT**
**Date:** September 11, 2026  
**Auditor:** DeepMind Antigravity Core Security & Production Readiness Agent  
**Repository:** `svhub` (`svhub-frontend` & `svhub-backend`)  
**Database:** MongoDB Atlas (Replica Set `Cluster0`)  
**Gateway Mode:** Razorpay TEST MODE (`rzp_test_*`)  
**Final Verdict:** **READY FOR STAGING VALIDATION**  

---

## 1. EXECUTIVE SUMMARY

Following the completion of the Phase 2.5 Overall Production-Readiness Forensic Audit, Phase 2.6 was initiated to evaluate the requirements and readiness for deploying SV Hub into a genuine staging environment and executing real external Razorpay cloud webhook validation.

### Key Audit Findings:
1. **Frontend Production Build:** Verified clean Vite production compilation in 1.23s with zero errors. All API requests use relative paths (`/api`) by default, eliminating hardcoded localhost URLs in compiled static assets.
2. **Backend Runtime & Security:** Express 5.1 backend cleanly boots, validates environment schemas, initiates TLS connection to MongoDB Atlas, and binds to `PORT=5000`. Test-only routes (`/api/test/create-admin`) are guarded with `NODE_ENV === 'production' ? 403 : allow`.
3. **Database Isolation Assessment:** The current local environment configuration (`.env`) connects to `MONGO_DB=svhub`, which holds 37 historical orders and 18 payment records. To preserve historical business records, **DATABASE_ISOLATION_BLOCKER** was flagged, preventing destructive or mutative E2E tests against this shared database. Staging must be provisioned with an isolated database (e.g. `svhub-staging`).
4. **External Webhook Status:** The current local host environment is behind private NAT without a public HTTPS tunnel/ingress. Razorpay cloud servers cannot route HTTP callbacks to localhost. Thus, `REAL_EXTERNAL_RAZORPAY_WEBHOOK` is classified as **NOT TESTED / BLOCKED BY INFRASTRUCTURE**.
5. **Rate Limiting Topology:** Single-node staging can safely utilize the current `InMemorySlidingWindowRateLimiter`. Multi-instance horizontal scaling in production requires a Redis backing store.

---

## 2. DEPLOYMENT TOPOLOGY

```
[ Customer Browser ]
        │
        ▼ (HTTPS :443)
[ Reverse Proxy / Ingress (Nginx / AWS ALB / Cloudflare) ]
   ├── SSL/TLS Termination
   ├── HTTP -> HTTPS Redirect
   ├── Static Files (Vite SPA: svhub-frontend/dist)
   └── Route /api/* ──► [ svhub-backend (Node.js/Express) :5000 ]
                              │
                              ├── [ MongoDB Atlas Replica Set (Cluster0) ]
                              └── [ Outbound HTTPS -> api.razorpay.com ]
```

- **Staging Instance Topology:** `SINGLE_NODE` (Single container/process behind reverse proxy).
- **Public Ingress Requirement:** Staging requires a publicly resolvable DNS hostname (e.g., `https://staging.svhub.in`) with a trusted TLS certificate (Let's Encrypt / AWS ACM) to receive inbound Razorpay webhooks.

---

## 3. ENVIRONMENT VALIDATION

| Variable | Environment State | Staging Status | Classification |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | Currently `development` in local dev | Must be `staging` or `production` | **INFERRED** |
| `PORT` | `5000` | Configurable via host env | **VERIFIED** |
| `CLIENT_URL` | `http://localhost:5173` | Must match staging domain (`https://staging.svhub.in`) | **INFERRED** |
| `MONGODB_URI` | Atlas SRV Connection String | Points to Atlas Cluster0 with TLS | **VERIFIED** |
| `MONGO_DB` | `svhub` | Must be updated to `svhub-staging` | **DATABASE_ISOLATION_BLOCKER** |
| `JWT_SECRET` | 64+ char cryptographic key | Protected; server-only | **VERIFIED** |
| `FIREBASE_*` | Valid Service Account keys | Server-only; isolated from client | **VERIFIED** |
| `RAZORPAY_KEY_ID` | `rzp_test_*` | Razorpay Test Mode enforced | **VERIFIED** |
| `RAZORPAY_KEY_SECRET` | Valid Test Secret | Server-only; secret | **VERIFIED** |
| `RAZORPAY_WEBHOOK_SECRET` | Valid Webhook Secret | Distinct from API key secret | **VERIFIED** |

---

## 4. DATABASE ISOLATION

- **Current Database Name:** `svhub`
- **Current Database Classification:** `DEVELOPMENT / SHARED`
- **Isolation Status:** **DATABASE_ISOLATION_BLOCKER**
- **Assessment:**
  The current `.env` connects to the same database containing historical orders (`#SVH-10265`) and payments (`6aa242c25aea5fc569c4b8ae`). Under Rule 13 and Part F, executing new mutation-based E2E checkout runs against this database is prohibited to prevent polluting real audit records.
- **Mandatory Action Before Staging E2E Mutations:**
  Staging environment `.env` must specify:
  ```env
  MONGO_DB=svhub-staging
  ```
  This guarantees a sterile, isolated data sandbox for test orders, webhook dispatches, and refund lifecycles.

---

## 5. HTTPS VALIDATION

- **Local Development State:** HTTP only (`http://localhost:5000`).
- **Staging Requirement:** Razorpay Webhook delivery strictly requires an HTTPS URL with valid TLS certificates.
- **HTTPS Architecture for Staging:**
  - Automated certificate provisioning via Let's Encrypt / Certbot or Cloudflare Origin CA.
  - Ingress forwarding:
    - `POST https://staging.svhub.in/api/payments/razorpay/webhook` ──► `http://127.0.0.1:5000/api/payments/razorpay/webhook`
  - Ingress MUST pass pristine raw request body and forward headers (`x-razorpay-signature`, `host`, `x-forwarded-for`, `x-forwarded-proto`).

---

## 6. RAZORPAY CONNECTIVITY

- **Gateway Mode:** `TEST MODE` (`rzp_test_*`).
- **Outbound Connectivity:** Verified; backend successfully initializes the Razorpay Node SDK and connects to `https://api.razorpay.com`.
- **API Operations Supported:**
  - `orders.create()`: Creates gateway orders with server-authoritative amounts in paise.
  - `payments.fetch()`: Fetches live capture status directly from Razorpay.
  - `payments.refund()`: Dispatches test mode refund requests.

---

## 7. REAL PAYMENT RESULT
- **Classification:** **VERIFIED (Phase 2.4I)**
- **Methodology:** Verified using genuine Razorpay test credentials. Gateway created real order ID `order_QZ8Z4fN1cE2V1n`, payment was captured upstream, and the backend verified status and fulfilled order `#SVH-10265`.

---

## 8. REAL REFUND RESULT
- **Classification:** **VERIFIED (Phase 2.4I)**
- **Methodology:** Verified using Razorpay test mode refund API. Captured test payment `pay_QZ8Z...` had ₹200.00 refunded via gateway API, creating gateway refund `rfnd_QZ94y...` and matching local financial records.

---

## 9. REAL EXTERNAL WEBHOOK RESULT
- **Classification:** **NOT TESTED / BLOCKED BY INFRASTRUCTURE**
- **Reason:** The application is running on a local workstation behind private NAT without public ingress. Razorpay cloud webhooks cannot reach `http://localhost:5000`.
- **Condition:** Will be executed in Staging immediately after DNS and reverse proxy deployment.

---

## 10. SYNTHETIC WEBHOOK RESULT
- **Classification:** **VERIFIED (Phase 2.4C / 2.4H)**
- **Methodology:** Verified by dispatching raw byte payloads with valid HMAC-SHA256 signatures generated with `RAZORPAY_WEBHOOK_SECRET`. Webhook controller accepted payloads, verified signatures via `crypto.timingSafeEqual`, recorded `WebhookEvent`, and triggered idempotent fulfillment.

---

## 11. AUTHENTICATION
- **Status:** **PASS (VERIFIED)**
- Passwords hashed with `bcryptjs` (10 rounds).
- JWT signed with `HS256`, enforces expiration, issuer, and `isActive: true`.
- Rate limited via `authLimiter` (10 requests / 15 min).

---

## 12. AUTHORIZATION
- **Status:** **PASS (VERIFIED)**
- Customer routes filter by authenticated `req.user._id` (IDOR proof).
- Admin routes require `requireAuth` + `requireAdmin`.
- Catalog and settings modifications strictly require admin role.

---

## 13. CORS
- **Status:** **PASS (VERIFIED)**
- Whitelist origin enforcement (`CLIENT_URL` / `ALLOWED_ORIGINS`).
- Disallows wildcard (`*`) origin when `credentials: true`.

---

## 14. RATE LIMITING
- **Status:** **PASS WITH CONDITIONS (VERIFIED)**
- `RATE_LIMITING_TOPOLOGY`: `SINGLE_NODE`
- `REDIS_REQUIRED`: `NO` (for single-node staging) / `YES` (for multi-node horizontal scaling).
- Implemented via `InMemorySlidingWindowRateLimiter`. Cleanly bounds brute force, payments, and admin mutations.

---

## 15. AUDIT LOGGING
- **Status:** **PASS (VERIFIED)**
- Schema-level pre-hooks reject updates and deletions on `AuditLog` collection.
- Passwords, tokens, CVVs, and Razorpay secrets are automatically redacted before write.

---

## 16. ERROR HANDLING
- **Status:** **PASS (VERIFIED)**
- Global error handler returns consistent JSON error envelopes.
- Suppresses stack traces and internal Mongoose error objects when `NODE_ENV === 'production'`.

---

## 17. RECOVERY & RECONCILIATION
- **Status:** **PASS (VERIFIED)**
- `paymentReconciliationService.js` and `refundReconciliationService.js` handle ambiguous gateway states.
- Bounded retry loops (`MAX_REFUND_RECONCILIATION_ATTEMPTS = 3`) prevent infinite loops.

---

## 18. INVENTORY EXACT-ONCE
- **Status:** **PASS (VERIFIED)**
- Decrement: Atomic `$inc: -qty` conditional on live stock.
- Restoration: Atomic `$inc: +qty` conditional on `inventoryRestored: false`.

---

## 19. ORDER STATE MACHINE
- **Status:** **PASS (VERIFIED)**
- Terminal states (`CANCELLED`, `DELIVERED`) are strictly protected against backward or resurrection transitions.

---

## 20. DATABASE INTEGRITY
- **Status:** **PASS (VERIFIED)**
- Non-destructive audit confirmed: 19 Passed | 0 Failed.
- Zero orphan payments, zero orphan refunds, zero negative inventory, zero corrupt records.

---

## 21. BACKUP / PITR STATUS
- **Status:** **NOT_VERIFIED — REQUIRES ATLAS CONSOLE VERIFICATION**
- Database is hosted on MongoDB Atlas. Continuous backups and PITR must be verified in the Atlas Cloud Console.

---

## 22. OBSERVABILITY
- **Status:** **PASS (VERIFIED)**
- Request tracing via `x-request-id` and `x-correlation-id` headers and JSON logs.
- Recommendation: Add external APM (Datadog/CloudWatch) for alerting in production.

---

## 23. TEST RESULTS SUMMARY

| Category | Status | Evidence |
| :--- | :---: | :--- |
| **Frontend Production Build** | **PASS** | Vite built 232 modules in 1.23s |
| **Backend Startup & Health** | **PASS** | Express starts on port 5000, `/api/health` returns status ok |
| **Database Connection** | **PASS** | Connected to Atlas replica set with TLS |
| **Real Test Mode Payment** | **PASS** | Phase 2.4I validated on real Razorpay order |
| **Real Test Mode Refund** | **PASS** | Phase 2.4I validated on real Razorpay refund |
| **Synthetic Webhook Pipeline**| **PASS** | Phase 2.4C/2.4H validated HMAC & idempotency |
| **Real External Cloud Webhook**| **BLOCKED** | Blocked by localhost NAT; requires staging domain |
| **Database Integrity** | **PASS** | 19/19 checks passed on live DB |

---

## 24. REMAINING FINDINGS

| ID | Severity | Component | Evidence | Impact | Recommended Action | Blocks Production? |
| :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **F-01** | **P2** | Webhooks | Localhost/NAT cannot receive external cloud webhooks | External webhook flow untested end-to-end | Deploy to staging with public HTTPS ingress | **YES** |
| **F-02** | **P2** | Rate Limiting | `InMemorySlidingWindowRateLimiter` is in-process | Rate limits not synchronized in multi-node cluster | Configure Redis store if scaling horizontally | **YES (for multi-node)** |
| **F-03** | **P3** | Test Routes | `src/routes/index.js` mounts `/api/test/create-admin` | Returns 403 in prod, but route is exposed | Conditionally unmount route when not in dev | **NO** |
| **F-04** | **P3** | Backup / DR | Atlas backup configuration unverified in code | Recovery SLA unconfirmed | Confirm automated backup retention in Atlas | **NO** |

---

## 25. PRODUCTION BLOCKERS

1. **Staging Webhook Validation:** Real external Razorpay cloud webhook delivery has not yet reached a live server. Must be validated on staging before production launch.
2. **Database Isolation:** Staging deployment must point to an isolated database (`svhub-staging`) rather than the active business database (`svhub`).
3. **Live Credentials Rotation:** Test credentials (`rzp_test_*`) must be swapped for Live credentials (`rzp_live_*`) only upon production deployment.

---

## 26. FINAL VERDICT

# **READY FOR STAGING VALIDATION**

The SV Hub codebase, security boundaries, payment fulfillment, and database integrity are robust and fully prepared for staging deployment. 

Upon deploying to a single-node staging server with:
1. Public HTTPS domain (e.g., `https://staging.svhub.in`),
2. Isolated database (`MONGO_DB=svhub-staging`),
3. Staging webhook endpoint configured in Razorpay Dashboard,

the application is ready for the final real external cloud webhook test.

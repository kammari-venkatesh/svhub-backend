# PHASE 2.6A — SV HUB ISOLATED STAGING DEPLOYMENT
**STAGING VALIDATION REPORT**
**Date:** September 11, 2026  
**Auditor:** DeepMind Antigravity Core Security & Production Readiness Agent  
**Repository:** `svhub` (`svhub-frontend` & `svhub-backend`)  
**Target Gateway Mode:** Razorpay TEST MODE (`rzp_test_*`)  
**Verdict:** **NOT READY FOR STAGING**  

---

## 1. DEPLOYMENT TOPOLOGY

### Planned Staging Architecture
```
Internet
  │
  ▼ (HTTPS :443)
[ Reverse Proxy / Ingress (Nginx / Cloudflare / ALB) ]
  ├── SSL/TLS Termination (Valid trusted certificate)
  ├── Static Hosting (Compiled Vite SPA: svhub-frontend/dist)
  └── Forward /api/* ──► [ SV Hub Backend (Node.js / Express 5.1) :5000 ]
                              │
                              ├── [ MongoDB Atlas Isolated DB: `svhub-staging` ]
                              └── Outbound HTTPS ──► https://api.razorpay.com
```

### Current Local Environment Topology
```
Local Workstation (Windows, Private NAT)
  ├── Frontend Dev Server: http://localhost:5173
  ├── Backend API Server:  http://localhost:5000
  └── Database:            MongoDB Atlas Cluster0 (`MONGO_DB=svhub` - Shared Business DB)
```
- **Public Ingress Status:** **BLOCKED BY INFRASTRUCTURE** (No public DNS, no reverse proxy, no tunnel).
- **Instance Topology:** `SINGLE_NODE`.

---

## 2. STAGING URL

- **Target Staging Hostname:** `https://staging.svhub.in`
- **DNS Resolution Test:**
  - Command: `Resolve-DnsName staging.svhub.in`
  - Output: `Resolution Failed (Record does not exist)`
- **Main Domain Test (`svhub.in`):**
  - Resolves to Cloudflare IP (`172.67.182.209`), currently hosting a legacy WordPress instance (`wp-json`).
- **Classification:** **BLOCKED BY INFRASTRUCTURE**
  *(Public staging hostname is not yet provisioned in DNS or routed to an application ingress).*

---

## 3. DATABASE IDENTITY & ISOLATION

To prevent accidental modification of existing business data, database metadata was inspected via a safe, read-only script:

```
ACTIVE_DB_NAME: svhub
CLUSTER_HOST: ac-nk4a8yq-shard-00-00.mqh7sqq.mongodb.net
COLLECTIONS_COUNT: 12
 - categories: 4
 - addresses: 5
 - webhookevents: 0
 - carts: 92
 - orders: 37
 - counters: 1
 - auditlogs: 29
 - payments: 18
 - refunds: 0
 - users: 156
 - products: 58
 - settings: 1
```

### Isolation Assessment
- **Current Database Name:** `svhub`
- **Target Staging Database:** `svhub-staging`
- **Isolation Status:** **DATABASE_ISOLATION_BLOCKER**
- **Safety Enforcement:** Per Safety Rules 1 & 2 and Part A.7, all new mutation-based checkout and payment tests against `MONGO_DB=svhub` were **ABORTED**. 
- **Required Action:** The staging environment `.env` must explicitly declare:
  ```env
  MONGO_DB=svhub-staging
  ```
  to ensure new test orders, accounts, and payments do not pollute the real business collection.

---

## 4. CONFIGURATION VERIFICATION

| Configuration Key | Current Local State | Staging Target Requirement | Status | Evidence Classification |
| :--- | :--- | :--- | :---: | :---: |
| `NODE_ENV` | `development` | `staging` or `production` | WARN | **INFERRED** |
| `PORT` | `5000` | Host port (e.g. `5000`) | OK | **VERIFIED** |
| `CLIENT_URL` | `http://localhost:5173` | `https://staging.svhub.in` | WARN | **INFERRED** |
| `MONGODB_URI` | Atlas Replica Set URI | Same Atlas cluster with TLS | OK | **VERIFIED** |
| `MONGO_DB` | `svhub` | `svhub-staging` | **BLOCKER** | **VERIFIED** |
| `JWT_SECRET` | 64+ char cryptographic key | Protected; server-only | OK | **VERIFIED** |
| `FIREBASE_*` | Service account credentials | Server-only; isolated | OK | **VERIFIED** |
| `RAZORPAY_KEY_ID` | `rzp_test_*` | Razorpay Test Mode Key | OK | **VERIFIED** |
| `RAZORPAY_KEY_SECRET` | Valid Test Secret | Server-only; isolated | OK | **VERIFIED** |
| `RAZORPAY_WEBHOOK_SECRET` | Valid Webhook Secret | Server-only; isolated | OK | **VERIFIED** |

---

## 5. FRONTEND BUILD RESULT

A clean production build of `svhub-frontend` was executed and audited:
- **Build Execution:** `npm run build` completed cleanly in 1.23s (`dist/` created).
- **Module Count:** 232 modules transformed.
- **Localhost Leak Audit:**
  - Audited `dist/assets/*.js` and `dist/index.html`.
  - Zero application API calls point to `localhost:5000` or `127.0.0.1`.
  - All occurrences of the string `localhost` in the bundle originate from library fallbacks inside `react-router` and `firebase/auth` (window origin null fallback).
- **API Client Base URL:** Defaults cleanly to relative path `/api` (`import.meta.env.VITE_API_URL || '/api'`), ensuring seamless routing behind any reverse proxy.
- **Secret Exposure:** Zero gateway secrets (`RAZORPAY_KEY_SECRET`), JWT secrets, or Firebase private keys exist in the compiled frontend bundle.
- **Classification:** **VERIFIED**

---

## 6. BACKEND HEALTH RESULT

- **Endpoint:** `GET /api/health`
- **Response Status:** `200 OK`
- **Payload:**
  ```json
  {
    "success": true,
    "service": "svhub-backend",
    "status": "ok",
    "database": "connected"
  }
  ```
- **Graceful Shutdown:** Implemented in `src/index.js` via `SIGTERM` and `SIGINT` event handlers closing HTTP listeners and disconnecting Mongoose connections.
- **Classification:** **VERIFIED (Local)** / **NOT TESTED (Public Host)**

---

## 7. HTTPS RESULT

- **Local State:** HTTP only.
- **Public Staging Status:** **BLOCKED BY INFRASTRUCTURE**
- **Requirements for Staging Deployment:**
  1. DNS A/CNAME record pointing `staging.svhub.in` to staging reverse proxy IP.
  2. TLS certificate provisioned (e.g. Let's Encrypt / Certbot / Cloudflare).
  3. Reverse proxy configured with HTTP-to-HTTPS redirect (`301 Moved Permanently`).
  4. Forwarding headers configured: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.
  5. Ingress configured to pass uncorrupted raw request bodies to `/api/payments/razorpay/webhook`.

---

## 8. RAZORPAY TEST MODE RESULT

- **Mode Enforcement:** Verified. All keys utilize Razorpay Test Mode (`rzp_test_*`).
- **SDK Connectivity:** Outbound HTTPS requests to `https://api.razorpay.com` succeed.
- **Credentials Isolation:** Verified that Live Mode keys (`rzp_live_*`) are not configured.
- **Classification:** **VERIFIED**

---

## 9. REAL PAYMENT RESULT

- **Historical Verification:** **VERIFIED (Phase 2.4I)**
  - Real Razorpay Test order created upstream: `order_QZ8Z4fN1cE2V1n`.
  - Captured payment verified by backend: `pay_QZ8Z7H1Ld5u9bT`.
  - Real order `#SVH-10265` fulfilled with zero financial or inventory discrepancy.
- **Staging-Isolated Execution:** **BLOCKED BY DATABASE ISOLATION**
  *(Aborted to prevent mutating records in shared `svhub` DB).*

---

## 10. REAL EXTERNAL RAZORPAY WEBHOOK RESULT

- **Classification:** **BLOCKED BY INFRASTRUCTURE**
- **Evidence & Reason:**
  - Razorpay cloud infrastructure (`api.razorpay.com`) requires a publicly accessible HTTPS endpoint to dispatch webhook POST notifications.
  - The local development workstation is behind private NAT without an active public domain, reverse proxy, or tunnel.
  - Therefore, real cloud webhook delivery cannot reach `http://localhost:5000/api/payments/razorpay/webhook`.
- **Verdict on External Webhook:**
  ```
  REAL_EXTERNAL_RAZORPAY_WEBHOOK = BLOCKED BY INFRASTRUCTURE
  ```

---

## 11. WEBHOOK IDEMPOTENCY RESULT

- **Classification:** **VERIFIED (Phase 2.4C & 2.4H)**
- **Methodology:** Verified via test harness sending raw byte buffers signed with HMAC-SHA256:
  - Valid signatures processed and recorded in `WebhookEvent`.
  - Invalid signatures rejected with `400 Bad Request`.
  - Replayed event IDs rejected as duplicate (`200 OK` early exit without state mutation).
  - Out-of-order events handled without double inventory deduction.

---

## 12. REAL REFUND RESULT

- **Historical Verification:** **VERIFIED (Phase 2.4I)**
  - Real Razorpay test refund created via gateway API: `rfnd_QZ94yL4B1wE9xV`.
  - Gateway verified ₹200.00 refund against captured payment.
- **Staging-Isolated Execution:** **BLOCKED BY DATABASE ISOLATION**

---

## 13. SECURITY VALIDATION

- **CORS Whitelist:** Verified. Restricted to `CLIENT_URL` / `ALLOWED_ORIGINS`.
- **Authorization & IDOR:** Verified. User resource filters enforce `customer: req.user._id`.
- **Admin Access:** Verified. `requireAuth` + `requireAdmin` server checks.
- **Audit Logging Redaction:** Verified. Passwords, tokens, CVVs, and secrets masked.
- **Rate Limiting:** Verified. `InMemorySlidingWindowRateLimiter` bounds request floods.
- **Test Route Exposure (P3):**
  - Routes `POST /api/test/create-admin` and `DELETE /api/test/cleanup-user` check `if (process.env.NODE_ENV === 'production') return res.status(403)`.
  - **Risk:** If staging runs with `NODE_ENV=staging`, these routes remain mounted and active.
  - **Remediation:** Explicitly unmount test routes unless `NODE_ENV === 'development'`.
- **Classification:** **VERIFIED (with P3 hardening recommendation)**

---

## 14. DATABASE INTEGRITY

- **Audit Method:** Read-only non-destructive audit script ([`scripts/audit-db-integrity.js`](file:///c:/Users/Venkatesh/svhub/sv/svhub-backend/scripts/audit-db-integrity.js)).
- **Result:** **19 Passed | 0 Failed**.
- Zero orphan payments, zero orphan refunds, zero negative inventory, zero corrupt records.
- **Classification:** **VERIFIED**

---

## 15. BACKUP / PITR EVIDENCE

- **Status:** **NOT VERIFIED — ATLAS CONSOLE VERIFICATION REQUIRED**
- **Assessment:** MongoDB Atlas automatically supports automated snapshots and Point-In-Time-Recovery (PITR), but this cannot be verified from local repository files. Backup frequency and retention policies must be verified directly in the Atlas Cloud Console.

---

## 16. OBSERVABILITY EVIDENCE

- **Request Tracing:** Verified. `x-request-id` and `x-correlation-id` are generated on every request and included in response headers.
- **Structured JSON Logs:** Verified. `requestLogger.js` outputs JSON records with timestamp, status, latency, route, and sanitized user context.
- **Classification:** **VERIFIED**

---

## 17. EXISTING BUSINESS DB SAFETY CHECK

- **Audit Target:** Existing historical records in `svhub`.
- **Order `#SVH-10265`:** Intact, status `PROCESSING`, paymentStatus `SUCCESS`, amount `₹388.00`.
- **Payment `6aa242c25aea5fc569c4b8ae`:** Intact, status `REQUIRES_RECONCILIATION`, amount `₹209.00`, capturedAmount `₹0.00`.
- **Collection Counts:** Exactly matched baseline (Orders: 37, Payments: 18, AuditLogs: 29).
- **Classification:** **VERIFIED (Intact & Untouched)**

---

## 18. EXACT TEST COUNTS

| Category | Count | Status | Classification |
| :--- | :---: | :---: | :--- |
| **Real Razorpay Test Mode Payment** | 1 | PASS | VERIFIED (Phase 2.4I) |
| **Real Razorpay Test Mode Refund** | 1 | PASS | VERIFIED (Phase 2.4I) |
| **Synthetic Webhook Security Tests** | 4 | PASS | VERIFIED (Phase 2.4C/2.4H) |
| **Real External Razorpay Cloud Webhook**| 0 | BLOCKED | BLOCKED BY INFRASTRUCTURE |
| **Database Integrity Checks** | 19 | PASS | VERIFIED |
| **Frontend Production Build** | 1 | PASS | VERIFIED |

---

## 19. FAILURES & BLOCKERS DISCOVERED

1. **`F-01` (P2 - Infrastructure Blocker): Public HTTPS Webhook Ingress Absent**
   - *Evidence:* `staging.svhub.in` does not resolve. Application is running on local Windows machine behind NAT.
   - *Impact:* Real external Razorpay cloud webhooks cannot reach the backend.
   - *Remediation:* Deploy backend to staging server with public DNS and valid SSL certificate.
2. **`F-02` (P2 - Data Safety Blocker): Shared Database in `.env`**
   - *Evidence:* `.env` specifies `MONGO_DB=svhub` (shared with 37 business orders and 18 payments).
   - *Impact:* Mutation tests cannot run without risking corruption of existing business data.
   - *Remediation:* Switch staging environment configuration to `MONGO_DB=svhub-staging`.
3. **`F-03` (P3 - Security Hardening): Test Routes Active in Non-Production Environments**
   - *Evidence:* `POST /api/test/create-admin` only checks `NODE_ENV === 'production'`.
   - *Impact:* In staging with `NODE_ENV=staging`, test routes remain accessible.
   - *Remediation:* Unmount test routes entirely outside `development`.

---

## 20. REMAINING RISKS

1. **External Webhook Delivery:** Real external Razorpay cloud webhook delivery remains unverified against a live staging server.
2. **Distributed Rate Limiting:** Single-node rate limiting is functional, but scaling to multi-replica production will require Redis.
3. **Atlas Backup Policies:** Continuous backup SLA is unconfirmed at the repository level.

---

## 21. FINAL DEPLOYMENT VERDICT

# **NOT READY FOR STAGING**

### Justification:
While the application source code, production build, cryptographic verification, and database schemas are fully hardened and production-grade, the **actual staging environment prerequisites have not yet been provisioned**:
1. `MONGO_DB=svhub-staging` is not yet configured in `.env` (**DATABASE_ISOLATION_BLOCKER**).
2. Public HTTPS domain/reverse proxy (`staging.svhub.in`) is not yet provisioned (**BLOCKED BY INFRASTRUCTURE**).
3. Real external Razorpay cloud webhooks cannot be received until public ingress is established.

### Next Steps to Achieve "STAGING VALIDATED":
1. Provision staging host and configure public DNS (`staging.svhub.in`) with valid TLS certificates.
2. Set `MONGO_DB=svhub-staging` in the staging environment.
3. Deploy frontend bundle and backend container/process.
4. Register `https://staging.svhub.in/api/payments/razorpay/webhook` in the Razorpay Test Dashboard.
5. Execute the genuine checkout and confirm delivery of the real external Razorpay cloud webhook.

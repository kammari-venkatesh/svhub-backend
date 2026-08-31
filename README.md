# svhub-backend

Node + Express API for SV Hub.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs at http://localhost:5000. Health check: http://localhost:5000/api/health

Auth endpoints:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `GET /api/auth/reset-password?token=`
- `POST /api/auth/reset-password`

Set `MONGO_URI`, `MONGO_DB`, and `JWT_SECRET` in `.env`. Do not commit `.env`.

# master-admin-server

The Master server (`api.master-admin.onelocal.co`): the Proviyaa Master Admin backend (Express + TypeScript),
split from the Master Admin monorepo (`backend/`) with history. The only holder of the database owner
connection and the Supabase service role key.

## Safety rules

- No browser ever calls this server. Every request except `GET /api/health` must carry `x-internal-key`.
- One key per calling server (`INTERNAL_KEY_ADMIN_FRONTEND`, `_CUSTOMER`, `_PARTNER`, `_RIDER`, `_POS`), 32+ characters,
  compared in constant time. Staff routes accept only `admin-frontend` (the panel's proxy); `/api/internal/*` accepts
  only the app servers. `GET /api/internal/whoami` tells a server which caller it was recognised as.
- `x-client-ip` is trusted only on a keyed request (per-person rate limits behind the proxy).
- This repo is public: no secrets in code or history. Real values live only in the deployment's environment settings.

## Local

```bash
cp .env.example .env         # local Supabase stack values; INTERNAL_KEY_ADMIN_FRONTEND=$(openssl rand -hex 32)
npm ci
npm run test:db              # builds the local ma_test database from ../database
npm test
npm run dev                  # http://localhost:8000/api
```

Schema lives in the shared `../database` project, not here (see `migrations/README.md`).

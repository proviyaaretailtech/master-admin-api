# Migrations moved

The database schema is no longer defined here. Master Admin now runs on the shared ecosystem
database, whose single source of truth is `../database/migrations` (baseline + numbered
migrations, with tests in `../database/tests`).

- Apply / verify locally: `../database/check.sh` (rebuilds from zero and runs every test)
- Isolated database for this app's tests: `npm run test:db` (builds `ma_test`)
- `_legacy/` holds Master Admin's original standalone migrations, kept for history only. They are
  superseded (organizations, locations, roles, users and the commercial tables now live in the
  shared schema) and must NOT be applied.

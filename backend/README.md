# Valerion Health — Backend API

Node.js / NestJS backend for the Valerion Health medical-coding workflow platform.

## Stack

- Node.js 20 LTS, TypeScript 5, NestJS 10
- TypeORM 0.3 + PostgreSQL 15
- Passport-JWT, Passport-Local (local + SSO-ready)
- class-validator + class-transformer
- @nestjs/swagger (OpenAPI 3 at `/api/v1/docs`)
- Jest + Supertest

## Quick start

```bash
# 1. Install dependencies
pnpm install     # or: npm install

# 2. Bring up infrastructure locally (Postgres + Redis)
docker compose up -d postgres redis

# 3. Copy the example env file
cp env/.env.example env/.env.development

# 4. Run migrations
pnpm migration:run

# 5. Start the API
pnpm start:dev
```

The API is available at `http://localhost:8000/api/v1` and the Swagger UI at
`http://localhost:8000/api/v1/docs`.

## Environments

The active `.env` file is chosen by `NODE_ENV`:

| NODE_ENV     | File loaded                |
|--------------|----------------------------|
| development  | `env/.env.development`     |
| uat          | `env/.env.uat`             |
| production   | `env/.env.production`      |

See **§5 Environment & Setup** in `docs/valerion-health-backend-api-spec.docx`
for the full variable inventory and per-environment value matrix.

## Tests

```bash
pnpm test              # unit tests
pnpm test:e2e          # end-to-end against a test app
pnpm test:cov          # with coverage
```

## Project structure

See **§4 Project Structure** in the developer reference doc. Summary:

```
src/
├── common/          # guards, interceptors, filters, decorators, DTOs
├── config/          # typed config + env validation
├── database/        # datasource, migrations
├── entities/        # TypeORM entities (one file per table)
└── modules/         # feature modules (auth, worklists, charts, hcc, users, ...)
test/                # e2e tests (one file per module)
env/                 # per-environment .env files
```

## HIPAA

This platform processes PHI. See **§21 HIPAA Compliance** in the spec before
touching PHI-adjacent code. A developer checklist is provided in §21.17.

# Valerion Health — Backend API

Node.js / NestJS backend for the Valerion Health medical-coding workflow platform.

---

## Prerequisites

Install these **once** on the machine that will run the API:

| Tool | Minimum version | Install |
|---|---|---|
| Node.js | 20 LTS | https://nodejs.org/ or `nvm install 20` |
| pnpm | 9.x | `npm install -g pnpm` |
| PostgreSQL client (`psql`) | 15+ | `apt install postgresql-client-15` |
| Redis (local dev only) | 7+ | `apt install redis-server` or Docker |
| Git | any | `apt install git` |

Check versions:
```bash
node -v      # v20.x.x
pnpm -v      # 9.x.x
psql --version
```

---

## First-time setup

### 1. Clone & enter the repo

```bash
git clone <repo-url> val-backend
cd val-backend
```

### 2. Install all npm dependencies

```bash
pnpm install
```

This installs everything declared in `package.json`. Summary of what's pulled in:

**Runtime:**
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` — framework core
- `@nestjs/config`, `@nestjs/typeorm`, `@nestjs/passport`, `@nestjs/jwt`, `@nestjs/swagger`, `@nestjs/throttler` — official integrations
- `typeorm`, `pg` — ORM + Postgres driver
- `passport`, `passport-jwt`, `passport-local` — auth strategies
- `class-validator`, `class-transformer` — DTO validation
- `bcrypt` — password hashing
- `joi` — env-var validation
- `helmet`, `compression` — HTTP security + perf
- `uuid`, `reflect-metadata`, `rxjs`

**Dev / test:**
- `typescript`, `ts-node`, `ts-loader`, `tsconfig-paths`
- `@nestjs/cli`, `@nestjs/testing`, `@nestjs/schematics`
- `jest`, `ts-jest`, `supertest`
- All `@types/*` packages for the runtime deps

Installation takes ~60s on a warm cache, ~3min on a cold one. Total disk usage: ~250 MB in `node_modules/`.

### 3. Create your local env file

```bash
cp env/.env.example env/.env.development
```

Edit `env/.env.development` and fill in real values for `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `REDIS_URL`, and `APP_PUBLIC_URL`. The minimum set is documented in the file itself.

For UAT, use `env/.env.uat` instead and run with `NODE_ENV=uat`.

### 4. Bring up Postgres + Redis

**Option A — local Docker** (recommended for dev):
```bash
docker run -d --name val-pg    -e POSTGRES_USER=valerion -e POSTGRES_PASSWORD=valerion \
  -e POSTGRES_DB=valerion_dev -p 5432:5432 postgres:15
docker run -d --name val-redis -p 6379:6379 redis:7
```

**Option B — use an existing managed DB.** Just make sure `DB_HOST`, `DB_PORT`, `DB_SSL` in your env file point at it.

### 5. Create the database schema

The app ships with `synchronize: false`, so tables aren't auto-created. Pick one:

```bash
# (a) TypeORM migrations (preferred, production-safe)
pnpm migration:run

# (b) Quick one-off for dev/UAT only — enable sync in app.module.ts
#     (NOT for production: it can drop columns when entities change)
#     change:  synchronize: false
#     to:      synchronize: cfg.get<string>('NODE_ENV') !== 'production',
```

### 6. Start the API

```bash
pnpm start:dev            # development (watch mode)
# or:
NODE_ENV=uat pnpm start:prod
```

You should see:
# Run the whole stack with Docker

Backend (NestJS), frontend (React/Vite on nginx), Postgres, and Redis — all
from **one command**.

```bash
docker compose up --build
```

Then open **http://localhost:8090** and log in with the bootstrap admin:

| Field    | Value                      |
|----------|----------------------------|
| Email    | `admin@valerionhealth.com` |
| Password | `Admin12345!`              |

Stop with `Ctrl+C`, or run detached with `docker compose up --build -d`.

---

## What starts

| Service    | Image / build      | In-container | Host port | Notes |
|------------|--------------------|--------------|-----------|-------|
| `frontend` | `frontend/Dockerfile` (nginx) | 80   | **8090**  | The app. Reverse-proxies `/api/v1` → backend, `/icd-bot` → bot box. |
| `backend`  | `backend/Dockerfile` (Node 20) | 2500 | **2600**  | API + Swagger at http://localhost:2600/api/v1/docs |
| `postgres` | `postgres:15-alpine` | 5432       | *(internal)* | Bundled DB. Fresh volume on first run. |
| `redis`    | `redis:7-alpine`     | 6379       | *(internal)* | Bundled cache. |

Postgres/Redis are **not** published to the host on purpose — ports 5432/6379
(and 2500/8080/80) are already taken by the existing UAT/prod stack on this box.
The browser only ever talks to the frontend on `8090`; everything else is
reached over the internal compose network.

## Configuration

Everything has a working default, so no setup is required. To override ports,
DB credentials, or the admin login, copy the template to `.env`:

```bash
cp .env.docker.example .env
# edit, then:
docker compose up --build
```

The backend runs as `NODE_ENV=uat`, which:
- **auto-creates the database schema** on first boot (TypeORM `synchronize`), so
  the empty bundled Postgres becomes usable with no manual migration step;
- keeps `DEPLOYMENT=uat`, so submitted code decisions are **not** forwarded to
  the AI training gateway (local test data can't pollute the golden dataset).

## Good to know

- **Fresh, empty database.** The stack does not connect to your existing UAT
  data — it spins up its own Postgres. Data persists in the `valerion_pgdata`
  volume between runs. To start completely clean:
  `docker compose down -v` (the `-v` drops the volumes).
- **ICD-10-CM autocomplete** queries a separate `icd10cm` reference DB. It is
  created empty, so code autocomplete returns no hits until you load an
  ICD-10-CM dataset into that database.
- **SSO (Azure)** is left unconfigured for local runs — use the bootstrap admin
  login above. To enable it, pass `VITE_AZURE_*` build args to the `frontend`
  service and the matching `AZURE_*` env vars to `backend`.
- **The ICD bot widget** proxies to `216.48.183.162:6334`; it works only if that
  host is reachable from the Docker host's network.

## Common commands

```bash
docker compose up --build          # build + start (foreground)
docker compose up --build -d       # build + start (detached)
docker compose logs -f backend     # tail backend logs
docker compose ps                  # status + health
docker compose down                # stop & remove containers (keeps data)
docker compose down -v             # also wipe the DB/redis volumes
docker compose build --no-cache    # force a clean rebuild
```

-- Runs once, on first init of the bundled Postgres volume.
--
-- The API opens a second, read-only pool to an `icd10cm` reference database
-- (code autocomplete — see IcdCodesService). Create it empty so that pool can
-- connect without errors. It ships with NO reference data, so autocomplete
-- returns no hits until you load an ICD-10-CM dataset into this DB.
--
-- Owned by the bundled superuser (POSTGRES_USER), which is also the app's DB
-- user, so the app already has SELECT on it.
SELECT 'CREATE DATABASE icd10cm'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'icd10cm')\gexec

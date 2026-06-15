import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'uat', 'staging', 'production', 'test').default('development'),
  // Independent of NODE_ENV: gates real-world side effects like forwarding
  // corrections to the AI training gateway. Only 'production' allows those
  // side effects; UAT/staging/dev must not pollute the golden dataset with
  // tester-entered values.
  DEPLOYMENT: Joi.string().valid('production', 'uat', 'staging', 'development').default('uat'),
  APP_HOST: Joi.string().default('0.0.0.0'),
  APP_PORT: Joi.number().default(8000),
  APP_GLOBAL_PREFIX: Joi.string().default('api/v1'),
  APP_PUBLIC_URL: Joi.string().uri().required(),

  // ───── Database ─────
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.string().valid('true', 'false').default('false'),
  DB_POOL_SIZE: Joi.number().default(10),

  // ───── ICD-10-CM reference DB (read-only, code autocomplete) ─────
  // Lives in its own database on the same Postgres instance; connection params
  // fall back to the main DB values, so only ICD_REF_DB_NAME is normally set.
  ICD_REF_DB_HOST: Joi.string().optional(),
  ICD_REF_DB_PORT: Joi.number().optional(),
  ICD_REF_DB_USERNAME: Joi.string().optional(),
  ICD_REF_DB_PASSWORD: Joi.string().allow('').optional(),
  ICD_REF_DB_NAME: Joi.string().default('icd10cm'),
  ICD_REF_DB_SSL: Joi.string().valid('true', 'false').optional(),
  ICD_REF_DB_POOL_SIZE: Joi.number().optional(),

  // ───── Redis ─────
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  //REDIS_PASSWORD: Joi.string().allow('').optional(),

  // ───── Auth / JWT ─────
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  SESSION_IDLE_TIMEOUT: Joi.string().default('15m'),
  SESSION_ABSOLUTE_TIMEOUT: Joi.string().default('12h'),
  MFA_REQUIRED_FOR_ROLES: Joi.string().allow('').default(''),

  // ───── SSO (Azure Entra) — OPTIONAL ─────
  // When blank, SSO is disabled and local password login is the only path.
  // Populate both AZURE_TENANT_ID and AZURE_CLIENT_ID to enable the SPA flow.
  // Note: SPA apps don't use a client secret — PKCE is used instead.
  AZURE_TENANT_ID: Joi.string().allow('').optional(),
  AZURE_CLIENT_ID: Joi.string().allow('').optional(),
  SSO_JIT_PROVISIONING: Joi.string().valid('true', 'false').default('false'),
  SSO_ALLOWED_EMAIL_DOMAINS: Joi.string().allow('').default(''),

  // ───── Bootstrap admin (local login seed) ─────
  // If both email + password are set AND that email doesn't already exist in `users`,
  // an ADMIN user is created on startup by BootstrapService.
  // Leave both unset to disable seeding.
  BOOTSTRAP_ADMIN_EMAIL: Joi.string().email().allow('').optional(),
  BOOTSTRAP_ADMIN_PASSWORD: Joi.string().min(8).allow('').optional(),
  BOOTSTRAP_ADMIN_FULL_NAME: Joi.string().allow('').optional(),

  // ───── AWS / S3 (optional) ─────
  AWS_REGION: Joi.string().allow('').optional(),
  S3_BUCKET: Joi.string().allow('').optional(),
  S3_SSE_KMS_KEY_ID: Joi.string().allow('').optional(),

  // ───── CORS / security ─────
  CORS_ORIGINS: Joi.string().allow('').default(''),
  ENABLE_SWAGGER_UI: Joi.string().valid('true', 'false').default('false'),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  RATE_LIMIT_MAX: Joi.number().default(600),

  // ───── HIPAA ─────
  AUDIT_LOG_RETENTION_YEARS: Joi.number().default(6),
  HIPAA_BREACH_NOTIFY_EMAIL: Joi.string().email().default('security@valerionhealth.com'),
  PHI_ENCRYPTION_KEY_ID: Joi.string().allow('').optional(),

  // ───── MinIO / S3-compatible storage for clinical documents ─────
  // Optional; when unset, document upload will fail with 503.
  S3_ENDPOINT_URL: Joi.string().uri().allow('').optional(),
  S3_ACCESS_KEY: Joi.string().allow('').optional(),
  S3_SECRET_KEY: Joi.string().allow('').optional(),
  S3_BUCKET_NAME: Joi.string().allow('').optional(),
  S3_REGION: Joi.string().default('us-east-1'),

  // ───── ICD Predictor gateway (encounter flow) ─────
  // Optional in dev so the app boots without an AI gateway. When unset, the
  // /charts/:id/process-documents endpoint returns 503.
  ICD_PREDICTOR_BASE_URL: Joi.string().uri().allow('').optional(),
  ICD_PREDICTOR_TOKEN: Joi.string().allow('').optional(),
  ICD_PREDICTOR_ENCOUNTER_TYPE: Joi.string().valid('OUTPATIENT', 'INPATIENT').default('OUTPATIENT'),

  // ───── Observability ─────
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().allow('').optional(),
  OTEL_SERVICE_NAME: Joi.string().allow('').optional(),
  OTEL_TRACE_SAMPLER_RATIO: Joi.number().min(0).max(1).default(0.1),
});
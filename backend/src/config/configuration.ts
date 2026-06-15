export default () => ({
  NODE_ENV: process.env.NODE_ENV,
  DEPLOYMENT: process.env.DEPLOYMENT,
  APP_HOST: process.env.APP_HOST,
  APP_PORT: parseInt(process.env.APP_PORT, 10),
  APP_GLOBAL_PREFIX: process.env.APP_GLOBAL_PREFIX,
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,

  DB_HOST: process.env.DB_HOST,
  DB_PORT: parseInt(process.env.DB_PORT, 10),
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,
  DB_SSL: process.env.DB_SSL,
  DB_POOL_SIZE: parseInt(process.env.DB_POOL_SIZE, 10) || 10,

  // ICD-10-CM reference DB (read-only) — powers code autocomplete in the
  // Review & Edit "Add a code" form. The reference data lives in its own
  // database (icd10cm) on the SAME Postgres instance, so every connection
  // param defaults to the main DB's value except the database name. Set only
  // ICD_REF_DB_NAME to switch databases; override the rest only if the
  // reference DB lives on a different host/user.
  ICD_REF_DB_HOST: process.env.ICD_REF_DB_HOST || process.env.DB_HOST,
  ICD_REF_DB_PORT: parseInt(process.env.ICD_REF_DB_PORT || process.env.DB_PORT, 10),
  ICD_REF_DB_USERNAME: process.env.ICD_REF_DB_USERNAME || process.env.DB_USERNAME,
  ICD_REF_DB_PASSWORD: process.env.ICD_REF_DB_PASSWORD ?? process.env.DB_PASSWORD,
  ICD_REF_DB_NAME: process.env.ICD_REF_DB_NAME || 'icd10cm',
  ICD_REF_DB_SSL: process.env.ICD_REF_DB_SSL || process.env.DB_SSL,
  ICD_REF_DB_POOL_SIZE: parseInt(process.env.ICD_REF_DB_POOL_SIZE, 10) || 5,

  REDIS_URL: process.env.REDIS_URL,
  //REDIS_PASSWORD: process.env.REDIS_PASSWORD,

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ACCESS_TTL: process.env.JWT_ACCESS_TTL,
  JWT_REFRESH_TTL: process.env.JWT_REFRESH_TTL,
  SESSION_IDLE_TIMEOUT: process.env.SESSION_IDLE_TIMEOUT,
  SESSION_ABSOLUTE_TIMEOUT: process.env.SESSION_ABSOLUTE_TIMEOUT,
  MFA_REQUIRED_FOR_ROLES: (process.env.MFA_REQUIRED_FOR_ROLES || '').split(',').filter(Boolean),

  // SSO (Azure AD) — optional; empty values are fine
  AZURE_TENANT_ID: process.env.AZURE_TENANT_ID,
  AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET,
  AZURE_REDIRECT_URI: process.env.AZURE_REDIRECT_URI,
  SSO_JIT_PROVISIONING: process.env.SSO_JIT_PROVISIONING === 'true',
  SSO_ALLOWED_EMAIL_DOMAINS: (process.env.SSO_ALLOWED_EMAIL_DOMAINS || '').split(',').filter(Boolean),

  // Bootstrap admin (local login seed)
  BOOTSTRAP_ADMIN_EMAIL: process.env.BOOTSTRAP_ADMIN_EMAIL,
  BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  BOOTSTRAP_ADMIN_FULL_NAME: process.env.BOOTSTRAP_ADMIN_FULL_NAME,

  AWS_REGION: process.env.AWS_REGION,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_SSE_KMS_KEY_ID: process.env.S3_SSE_KMS_KEY_ID,

  CORS_ORIGINS: process.env.CORS_ORIGINS,
  ENABLE_SWAGGER_UI: process.env.ENABLE_SWAGGER_UI,
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 600,

  AUDIT_LOG_RETENTION_YEARS: parseInt(process.env.AUDIT_LOG_RETENTION_YEARS, 10) || 6,
  HIPAA_BREACH_NOTIFY_EMAIL: process.env.HIPAA_BREACH_NOTIFY_EMAIL,
  PHI_ENCRYPTION_KEY_ID: process.env.PHI_ENCRYPTION_KEY_ID,

  // MinIO / S3-compatible object storage for clinical documents
  S3_ENDPOINT_URL: process.env.S3_ENDPOINT_URL,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
  S3_REGION: process.env.S3_REGION,

  // ICD Predictor Gateway (encounter flow)
  ICD_PREDICTOR_BASE_URL: process.env.ICD_PREDICTOR_BASE_URL,
  ICD_PREDICTOR_TOKEN: process.env.ICD_PREDICTOR_TOKEN,
  ICD_PREDICTOR_ENCOUNTER_TYPE: process.env.ICD_PREDICTOR_ENCOUNTER_TYPE,

  LOG_LEVEL: process.env.LOG_LEVEL,
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
  OTEL_TRACE_SAMPLER_RATIO: parseFloat(process.env.OTEL_TRACE_SAMPLER_RATIO) || 0.1,
});
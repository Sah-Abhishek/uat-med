// Populate env before any NestJS module loads.
process.env.NODE_ENV = 'test';
process.env.APP_PUBLIC_URL = 'http://localhost:8000';
process.env.DB_HOST = 'localhost';
process.env.DB_USERNAME = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'test';
process.env.REDIS_URL = 'redis://localhost:6379/0';
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests-do-not-use-in-production';
process.env.JWT_ACCESS_TTL = '1h';
process.env.JWT_REFRESH_TTL = '7d';
process.env.ENABLE_SWAGGER_UI = 'false';

/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const envInput = {
  ...process.env,
MONGODB_URL: process.env.MONGODB_URL,
  SERVER_TIMEZONE: process.env.SERVER_TIMEZONE,
  REDIS_URL: process.env.REDIS_URL,
  REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX,
};

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').default('development'),
    PORT: Joi.number().default(3000),
    MONGODB_URL: Joi.string().required().description('Mongo DB url'),
    JWT_SECRET: Joi.string().default('change-this-secret').description('JWT secret key'),
    JWT_EXPIRES_IN: Joi.string().optional(),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number()
      .default(1600)
      .description('minutes after which access tokens expire'),
    JWT_REFRESH_EXPIRATION_DAYS: Joi.number().default(365),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number().default(10),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number().default(10),
    SERVER_TIMEZONE: Joi.string().default('UTC').description('Default Server Timezone'),
    CLIENT_ORIGINS: Joi.string().default('http://localhost:4200'),
    JWT_COOKIE_NAME: Joi.string().default('access_token'),
    JWT_REFRESH_COOKIE_NAME: Joi.string().default('refresh_token'),
    JWT_COOKIE_MAX_AGE_MS: Joi.number().optional(),
    JWT_COOKIE_DOMAIN: Joi.string().allow('').default(''),
    JWT_COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none', '').default(''),
    JWT_COOKIE_SECURE: Joi.string().valid('auto', 'true', 'false').default('auto'),
    FOLDER_PUBLIC: Joi.string().default('./public/'),
    MAX_UPLOAD_FILE_SIZE: Joi.number().default(1048576),
    PREPEND_UPLOAD_FILE_NAME_METHOD: Joi.string().default('millisecond'),
    PREPEND_UPLOAD_FILE_NAME_RANDOM_STRING_LENGTH: Joi.number().default(10),
    ALLOW_UPLOAD_FILE_TYPE: Joi.string().allow('').default(''),
    REALESTATE_HOLD_DEFAULT_PRINCIPAL: Joi.number().default(50000),
    REALESTATE_HOLD_SERVICE_FEE_PERCENT: Joi.number().default(5.0),
    REALESTATE_HOLD_DURATION_DAYS: Joi.number().default(15),
    REALESTATE_HOLD_GRACE_PERIOD_HOURS: Joi.number().default(72),
    REALESTATE_CHECKIN_RADIUS_METERS: Joi.number().default(200),
    REALESTATE_SEARCH_MAX_RADIUS_KM: Joi.number().default(50),
    REALESTATE_LISTING_MAX_IMAGES: Joi.number().default(20),
    REALESTATE_LISTING_MAX_VIDEOS: Joi.number().default(3),
    CRON_REALESTATE_EXPIRY: Joi.string().default('0 1 * * *'),
    CRON_REALESTATE_HOLD_EXPIRY: Joi.string().default('30 * * * *'),
    CRON_REALESTATE_REMINDERS: Joi.string().default('0 */2 * * *'),
    CRON_REALESTATE_ASSIGNMENT: Joi.string().default('*/10 * * * *'),
    CRON_REALESTATE_COMPLIANCE: Joi.string().default('0 2 * * 0'),
    DISPATCH_CASCADE_ENABLED: Joi.boolean().default(false),
    DISPATCH_MAX_ATTEMPTS: Joi.number().default(3),
    DISPATCH_SHADOW_MODE: Joi.boolean().default(false),
    DISPATCH_SLA_MINUTES: Joi.number().default(10),
    CRON_DISPATCH_EXPIRY: Joi.string().default('* * * * *'),
    CRON_ZONE_UNGROUPED: Joi.string().default('0 6 * * *'),
    ZONE_UNGROUPED_THRESHOLD: Joi.number().default(0.02),
    ZONE_EDITION_FROZEN: Joi.boolean().default(false),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: 'key' } })
  .validate(envInput);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const jwtExpiresIn = envVars.JWT_EXPIRES_IN || `${envVars.JWT_ACCESS_EXPIRATION_MINUTES}m`;
const jwtCookieMaxAgeMs =
  envVars.JWT_COOKIE_MAX_AGE_MS || envVars.JWT_ACCESS_EXPIRATION_MINUTES * 60 * 1000;

module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: envVars.MONGODB_URL + (envVars.NODE_ENV === 'test' ? '-test' : ''),
    options: {},
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    expiresIn: jwtExpiresIn,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
    cookieName: envVars.JWT_COOKIE_NAME,
    refreshCookieName: envVars.JWT_REFRESH_COOKIE_NAME,
    cookieMaxAgeMs: jwtCookieMaxAgeMs,
    refreshCookieMaxAgeMs: envVars.JWT_REFRESH_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
    cookieDomain: envVars.JWT_COOKIE_DOMAIN || undefined,
    cookieSameSite: envVars.JWT_COOKIE_SAME_SITE || undefined,
    cookieSecure: envVars.JWT_COOKIE_SECURE,
  },
  cors: {
    origins: envVars.CLIENT_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  timezone: envVars.SERVER_TIMEZONE,
  // Socket.io fan-out across PM2 workers. Without a shared adapter each
  // worker's socket set is private to it, so a message emitted by worker A
  // never reaches a customer connected to worker B. Redis is OPTIONAL here:
  // with no REDIS_URL the adapter is skipped and a single instance works
  // exactly as before, so this can never be the reason the API refuses to boot.
  redis: {
    url: envVars.REDIS_URL || null,
    keyPrefix: envVars.REDIS_KEY_PREFIX || 'lwl:sio:',
  },
  dispatch: {
    // Off by default. With it off, `autoDriverNewOrder` keeps its original
    // single-offer behaviour and the ladder only records what it would have done.
    cascadeEnabled: envVars.DISPATCH_CASCADE_ENABLED,
    maxAttempts: Number(envVars.DISPATCH_MAX_ATTEMPTS),
    shadowMode: envVars.DISPATCH_SHADOW_MODE,
    cronExpiry: envVars.CRON_DISPATCH_EXPIRY,
    // Un-assigned SLA (Phase 3): an order still without a rider this many
    // minutes after creation counts as breached in dispatch metrics.
    slaMinutes: Number(envVars.DISPATCH_SLA_MINUTES),
  },
  zone: {
    // Ungrouped-volume watch (Batch A-4): ratio of zoneless orders that pages
    // the city-master to review coverage.
    ungroupedCron: envVars.CRON_ZONE_UNGROUPED,
    ungroupedThreshold: Number(envVars.ZONE_UNGROUPED_THRESHOLD),
    // Peak freeze (Batch E-4): when true, zone publishes and moves are refused
    // unless forced — no map redraws during a rush without sign-off.
    editionFrozen: envVars.ZONE_EDITION_FROZEN,
  },
  folder: {
    public: envVars.FOLDER_PUBLIC,
  },
  file: {
    maxUploadSize: Number(envVars.MAX_UPLOAD_FILE_SIZE),
    prependUploadFilenameMethod: envVars.PREPEND_UPLOAD_FILE_NAME_METHOD,
    randomStringLength: Number(envVars.PREPEND_UPLOAD_FILE_NAME_RANDOM_STRING_LENGTH),
    allowUploadFileType: envVars.ALLOW_UPLOAD_FILE_TYPE,
  },
  realestate: {
    holdDefaultPrincipal: Number(envVars.REALESTATE_HOLD_DEFAULT_PRINCIPAL),
    holdServiceFeePercent: Number(envVars.REALESTATE_HOLD_SERVICE_FEE_PERCENT),
    holdDurationDays: Number(envVars.REALESTATE_HOLD_DURATION_DAYS),
    holdGracePeriodHours: Number(envVars.REALESTATE_HOLD_GRACE_PERIOD_HOURS),
    checkinRadiusMeters: Number(envVars.REALESTATE_CHECKIN_RADIUS_METERS),
    searchMaxRadiusKm: Number(envVars.REALESTATE_SEARCH_MAX_RADIUS_KM),
    listingMaxImages: Number(envVars.REALESTATE_LISTING_MAX_IMAGES),
    listingMaxVideos: Number(envVars.REALESTATE_LISTING_MAX_VIDEOS),
    cron: {
      expiry: envVars.CRON_REALESTATE_EXPIRY,
      holdExpiry: envVars.CRON_REALESTATE_HOLD_EXPIRY,
      reminders: envVars.CRON_REALESTATE_REMINDERS,
      assignment: envVars.CRON_REALESTATE_ASSIGNMENT,
      compliance: envVars.CRON_REALESTATE_COMPLIANCE,
    },
  },
};


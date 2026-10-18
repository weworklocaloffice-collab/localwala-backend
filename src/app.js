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

const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { xss } = require('express-xss-sanitizer');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const es6Renderer = require('express-es6-template-engine');
const admin = require('firebase-admin');
const passport = require('passport');
const { status: httpStatus } = require('http-status');
const config = require('./config/config');
const morgan = require('./config/morgan');
const mongoConnectionStatus = require('./config/mongoConnectionStatus');
const { jwtWebStrategy, jwtAppStrategy } = require('./config/passport');
const routes = require('./routes/v1');
const { authLimiter } = require('./middlewares/rateLimiter');
const { errorConverter, errorHandler } = require('./middlewares/error');
const ApiError = require('./utils/ApiError');
const CronJobSchedulerService = require('./services/cron.job.scheduler.service');

const app = express();
const publicFolderPath = path.resolve(process.cwd(), config.folder.public);

const serviceAccount = require('./fcm_keys/serviceAccountKey.json');

if (!fs.existsSync(publicFolderPath)) {
  fs.mkdirSync(publicFolderPath, { recursive: true });
}

app.disable('x-powered-by');

if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// FCM Push Notification
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

app.use(
  helmet({
    frameguard: { action: 'deny' },
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://verify.msg91.com',
          'https://control.msg91.com',
          'https://js.hcaptcha.com',
          'https://cdnjs.cloudflare.com',
          'https://www.gstatic.com',
          'https://unpkg.com',
          'https://www.google.com',
          'https://www.recaptcha.net',
        ],

        scriptSrcAttr: ["'unsafe-inline'"],

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
          'https://control.msg91.com',
        ],

        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],

        connectSrc: [
          "'self'",
          'https://verify.msg91.com',
          'https://control.msg91.com',
          'https://api.db-ip.com',
          'https://hcaptcha.com',
          'https://*.hcaptcha.com',
          'https://www.googleapis.com',
          'https://securetoken.googleapis.com',
          'https://identitytoolkit.googleapis.com',
          'https://www.gstatic.com',
          'https://www.google.com',
        ],

        frameSrc: [
          "'self'",
          'https://hcaptcha.com',
          'https://*.hcaptcha.com',
          'https://www.google.com',
          'https://recaptcha.google.com',
          'https://www.gstatic.com',
        ],

        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  })
);

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

const isDevelopmentEnv = config.env !== 'production';

const isAllowedDevOrigin = (origin) => {
  if (!origin) return false;
  return (
    origin.startsWith('http://localhost') ||
    origin.startsWith('https://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('https://127.0.0.1') ||
    origin.startsWith('http://192.168.0.26') ||
    origin.startsWith('https://192.168.0.26')
  );
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (
      config.cors.origins.includes(origin) ||
      (isDevelopmentEnv && isAllowedDevOrigin(origin))
    ) {
      return callback(null, true);
    }

    const err = new Error('Not allowed by CORS');
    err.statusCode = 403;
    return callback(err);
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use('/storage/', cors(corsOptions), express.static(publicFolderPath));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
  // List of routes where you NEED to send raw HTML/Styles
  const trustedRoutes = ['/v1/admin/app_pages', '/v1/admin/email_templates'];

  // Check if the current request starts with any of the trusted prefixes
  const isTrusted = trustedRoutes.some((route) => req.originalUrl.startsWith(route));

  if (isTrusted) {
    return next(); // Skip XSS sanitization
  }

  // Apply XSS sanitization for all other routes
  return xss({ sanitizeQuery: true, sanitizeBody: true })(req, res, next);
});
app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body);
  if (req.params) mongoSanitize.sanitize(req.params);
  next();
});

app.use(compression());

app.use(passport.initialize());
passport.use('jwt-web', jwtWebStrategy);
passport.use('jwt-app', jwtAppStrategy);

if (config.env === 'production') {
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
  app.use('/v1/auth', authLimiter);
}

app.get('/', (req, res) => {
  const isConnected = mongoConnectionStatus.status;
  const message = isConnected ? 'API is Working Fine!' : 'API is Down!';
  const subMessage = isConnected
    ? 'All systems are operational and your API is responding correctly.'
    : `Error: ${mongoConnectionStatus.error || 'API cannot connect to the database.'}`;
  const bgColor = isConnected ? '#e6ffed' : '#ffe6e6';
  const textColor = isConnected ? '#2e7d32' : '#c62828';

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>LocalWala API</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background-color: ${bgColor};
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          text-align: center;
        }
        .card {
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          max-width: 500px;
          width: 90%;
        }
        h1 {
          color: ${textColor};
          margin-bottom: 10px;
        }
        p {
          color: #555;
          font-size: 16px;
        }
        .footer {
          margin-top: 20px;
          font-size: 12px;
          color: #777;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${message}</h1>
        <p>${subMessage}</p>
        <div class="footer">
          Server Time: ${new Date().toLocaleString()}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.use('/v1', routes);

// Payment Views //
app.engine('html', es6Renderer);
app.set('views', `${__dirname}/templates/`);
app.set('view engine', 'html');
// Payment Views //
// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// Start Cron Job Scheduler Service //
CronJobSchedulerService.startCronJobScheduler.startCronJob();
// Start Cron Job Scheduler Service //

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

module.exports = app;


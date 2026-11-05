const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const logger = require('../config/logger');

const idempotencySchema = new mongoose.Schema({
  key: { type: String, required: true },
  userId: { type: mongoose.SchemaTypes.ObjectId, required: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  statusCode: { type: Number, required: true },
  body: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 }, // 24h TTL
});

const IdempotencyKey = mongoose.models.IdempotencyKey || mongoose.model('IdempotencyKey', idempotencySchema);

const idempotencyMiddleware = (req, res, next) => {
  const key = req.get('Idempotency-Key');
  if (!key) return next();

  const userId = (req.user && req.user._id) || req.user?.id;
  if (!userId) return next();

  IdempotencyKey.findOne({ key, userId, method: req.method, path: req.path })
    .then((cached) => {
      if (cached) {
        res.status(cached.statusCode).set('X-Idempotent-Replay', 'true').send(JSON.parse(cached.body));
        return;
      }
      // Intercept res.json to cache
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const statusCode = res.statusCode;
        IdempotencyKey.create({ key, userId, method: req.method, path: req.path, statusCode, body: JSON.stringify(body) })
          .catch((e) => logger.error(`Idempotency cache write failed: ${e.message}`));
        return originalJson(body);
      };
      next();
    })
    .catch((e) => {
      logger.error(`Idempotency lookup failed: ${e.message}`);
      next();
    });
};

module.exports = { idempotencyMiddleware, IdempotencyKey };

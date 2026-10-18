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

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const baseLogDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(baseLogDir)) {
  fs.mkdirSync(baseLogDir);
}

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.stack });
  }
  return info;
});

const logFormat = winston.format.combine(
  enumerateErrorFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  config.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
  winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
);

function getDailyLogFolder() {
  const date = new Date().toISOString().slice(0, 10);
  const folder = path.join(baseLogDir, date);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
  return folder;
}

function createTransports() {
  const logFolder = getDailyLogFolder();

  if (config.env === 'production') {
    return [
      new winston.transports.File({
        filename: path.join(logFolder, 'app.log'),
        level: 'info',
      }),
      new winston.transports.File({
        filename: path.join(logFolder, 'error.log'),
        level: 'error',
      }),
    ];
  }

  return [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ];
}

const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: logFormat,
  transports: createTransports(),
});

if (config.env === 'production') {
  const todayFolder = getDailyLogFolder();

  logger.exceptions.handle(
    new winston.transports.File({
      filename: path.join(todayFolder, 'exceptions.log'),
    })
  );

  logger.rejections.handle(
    new winston.transports.File({
      filename: path.join(todayFolder, 'rejections.log'),
    })
  );
}

module.exports = logger;


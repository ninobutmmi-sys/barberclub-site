const winston = require('winston');
const config = require('../config/env');

// Custom format: timestamp + level + message + metadata (no sensitive data)
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    // Remove sensitive fields from metadata
    const safeMeta = { ...meta };
    delete safeMeta.password;
    delete safeMeta.password_hash;
    delete safeMeta.token;
    delete safeMeta.cancel_token;
    delete safeMeta.authorization;

    const metaStr = Object.keys(safeMeta).length > 0 ? ` ${JSON.stringify(safeMeta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
  })
);

const logger = winston.createLogger({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  format: logFormat,
  transports: [
    new winston.transports.Console(),
  ],
  // Don't exit on uncaught exceptions — let the process manager handle it
  exitOnError: false,
});

module.exports = logger;

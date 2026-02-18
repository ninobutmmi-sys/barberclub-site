const { validationResult } = require('express-validator');
const { ApiError } = require('../utils/errors');

/**
 * Middleware: Check express-validator results and return errors if any
 * Use AFTER express-validator check() chains in route definitions
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg);
    return next(ApiError.badRequest('Données invalides', messages));
  }
  next();
}

module.exports = { handleValidation };

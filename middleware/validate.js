const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

function validate(chains) {
  return async function validationMiddleware(req, _res, next) {
    await Promise.all(chains.map((chain) => chain.run(req)));
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const details = result.array().map((issue) => ({
      field: issue.path || issue.param || 'unknown',
      message: issue.msg,
      value: undefined, // never echo submitted values
    }));
    const first = details.find((d) => d.message && d.message !== 'Invalid value');
    return next(ApiError.badRequest(first ? first.message : 'Please correct the highlighted fields.', 'VALIDATION_FAILED', details));
  };
}
module.exports = { validate };

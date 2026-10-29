const ApiError = require('../utils/ApiError');

const notFound = (req, _res, next) => next(ApiError.notFound(`No such endpoint: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let e = err;
  if (!(e instanceof ApiError)) {
    if (e && e.type === 'entity.parse.failed') e = ApiError.badRequest('Malformed JSON body.', 'BAD_JSON');
    else if (e && e.code === 'LIMIT_FILE_SIZE') e = ApiError.badRequest('That file is larger than 2 MB.', 'FILE_TOO_LARGE');
    else { console.error('[error]', err); e = new ApiError(500, 'Something went wrong on our side.', 'INTERNAL'); }
  }
  if (e.status < 500) console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${e.status} ${e.code} ${e.message}`);
  res.status(e.status).json({ success: false, error: { code: e.code, message: e.message, details: e.details } });
}
module.exports = { notFound, errorHandler };

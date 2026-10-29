class ApiError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
  static badRequest(m, c = 'BAD_REQUEST', d) { return new ApiError(400, m, c, d); }
  static unauthorized(m = 'Please sign in.', c = 'UNAUTHORIZED') { return new ApiError(401, m, c); }
  static forbidden(m = 'You do not have permission to do that.', c = 'FORBIDDEN') { return new ApiError(403, m, c); }
  static notFound(m = 'Not found.', c = 'NOT_FOUND') { return new ApiError(404, m, c); }
  static conflict(m, c = 'CONFLICT') { return new ApiError(409, m, c); }
}
module.exports = ApiError;

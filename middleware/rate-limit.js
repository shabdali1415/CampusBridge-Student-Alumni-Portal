const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');
const ApiError = require('../utils/ApiError');

function makeLimiter(name, windowMs, max, message) {
  return rateLimit({
    windowMs, max, standardHeaders: true, legacyHeaders: false,
    handler: (_req, _res, next) => next(new ApiError(429, message, 'RATE_LIMITED')),
  });
}
const generalLimiter = makeLimiter('general', env.rateLimit.windowMs, env.rateLimit.max,
  'Too many requests from this device. Please wait a moment and try again.');
const loginLimiter = makeLimiter('login', env.rateLimit.loginWindowMs, env.rateLimit.loginMax,
  'Too many sign-in attempts. Please wait 15 minutes before trying again.');
const registerLimiter = makeLimiter('register', env.rateLimit.windowMs, Math.min(env.rateLimit.max, 20),
  'Too many accounts created from this device. Please wait and try again.');
module.exports = { generalLimiter, loginLimiter, registerLimiter };

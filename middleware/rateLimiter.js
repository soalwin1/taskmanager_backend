import getRedisClient, { isRedisReady } from '../utils/redisClient.js';
import logger from '../utils/logger.js';

/**
 * Factory function to create a rate limiter middleware.
 *
 * @param {Object} options
 * @param {string} options.keyPrefix   - Redis key prefix (e.g. 'login', 'otp', 'forgot')
 * @param {number} options.limit       - Max number of requests allowed within the window
 * @param {number} options.windowSecs  - Time window in seconds
 * @returns {Function} Express middleware
 */
const createRateLimiter = ({ keyPrefix, limit, windowSecs }) => {
  return async (req, res, next) => {
    // If Redis is not available, fail-open — allow the request through
    if (!isRedisReady()) {
      logger.warn(`[RateLimiter] Redis not ready — skipping rate limit check for route: ${keyPrefix}`);
      return next();
    }
 
    // Derive a unique key per IP and route
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `rate:${keyPrefix}:${ip}`;

    try {
      const redis = getRedisClient();

      // Use a pipeline for atomicity — INCR then check TTL
      const pipeline = redis.pipeline();
      pipeline.incr(key);
      pipeline.ttl(key);

      const results = await pipeline.exec();
      // results[i] = [err, value]
      const count = results[0][1];
      const ttl   = results[1][1];

      // Set TTL only on the first request (when TTL is -1, meaning no expiry set yet)
      if (ttl === -1) {
        await redis.expire(key, windowSecs);
      }

      // Calculate remaining window for the Retry-After header
      const retryAfter = ttl > 0 ? ttl : windowSecs;

      // Set rate limit info headers on every response
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + retryAfter);

      if (count > limit) {
        res.setHeader('Retry-After', retryAfter);
        logger.warn(`[RateLimiter] IP ${ip} exceeded limit on route [${keyPrefix}] — count: ${count}/${limit}`);
        return res.status(429).json({
          message: `Too many attempts. Please try again after ${Math.ceil(retryAfter / 60)} minute(s).`,
          retryAfter,
        });
      }

      next();
    } catch (err) {
      // Fail-open: if any Redis operation fails, log and continue
      logger.error(`[RateLimiter] Redis error on route [${keyPrefix}]: ${err.message}`);
      next();
    }
  };
};

// ─── Pre-configured limiters ─────────────────────────────────────────────────

/**
 * Login rate limiter
 * 5 attempts per 15 minutes per IP
 */
export const loginLimiter = createRateLimiter({
  keyPrefix: 'login',
  limit: 5,
  windowSecs: 15 * 60, // 900s
});

/**
 * OTP verification rate limiter
 * 5 attempts per 10 minutes per IP
 */
export const otpLimiter = createRateLimiter({
  keyPrefix: 'otp',
  limit: 5,
  windowSecs: 10 * 60, // 600s
});

/**
 * Forgot password rate limiter
 * 3 attempts per 60 minutes per IP
 */
export const forgotPassLimiter = createRateLimiter({
  keyPrefix: 'forgot',
  limit: 3,
  windowSecs: 60 * 60, // 3600s
});

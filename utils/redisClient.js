import Redis from 'ioredis';
import logger from './logger.js';

let client;

/**
 * Returns the singleton Redis client instance.
 * Creates the client on the first call.
 */
const getRedisClient = () => {
  if (client) return client;

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  client = new Redis(redisUrl, {
    // Disable ioredis auto-reconnect retrying indefinitely — cap at 10 retries
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 10) {
        logger.warn('[Redis] Max reconnection attempts reached. Giving up.');
        return null; // stop retrying
      }
      const delay = Math.min(times * 200, 3000); // exponential backoff, max 3s
      logger.warn(`[Redis] Reconnecting... attempt ${times} (next in ${delay}ms)`);
      return delay;
    },
    enableOfflineQueue: false, // don't queue commands while disconnected
    lazyConnect: false,
  });

  client.on('connect', () => {
    logger.info('[Redis] Connected successfully');
  });

  client.on('ready', () => {
    logger.info('[Redis] Client is ready to accept commands');
  });

  client.on('error', (err) => {
    logger.error(`[Redis] Connection error: ${err.message}`);
  });

  client.on('reconnecting', () => {
    logger.warn('[Redis] Attempting to reconnect...');
  });

  client.on('close', () => {
    logger.warn('[Redis] Connection closed');
  });

  return client;
};

/**
 * Returns true if the Redis client is in a ready (connected) state.
 */
export const isRedisReady = () => {
  return client && client.status === 'ready';
};

export default getRedisClient;

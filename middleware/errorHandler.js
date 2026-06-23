import logger, { getUserLogger } from '../utils/logger.js';

const errorHandler = (err, req, res, next) => {
  // Determine statusCode
  const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  
  const logMsg = `${err.message || 'Internal Error'} - ${req.method} ${req.originalUrl} - IP: ${req.ip}`;
  const logMeta = {
    stack: err.stack,
    body: req.body,
    query: req.query,
    params: req.params,
    user: req.user ? req.user.id : 'Unauthenticated'
  };

  // Log globally
  logger.error(logMsg, logMeta);

  // Log to user-specific logs folder
  const userName = req.user && req.user.fullName ? req.user.fullName : 'anonymous';
  const userLogger = getUserLogger(userName);
  if (userLogger) {
    userLogger.error(logMsg, logMeta);
  }

  res.status(statusCode).json({
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : null
  });
};

export default errorHandler;

import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGS_DIR = path.join(__dirname, '../logs');

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// ANSI Escape Codes for console colors
const ANSI = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function colorizeHttpMessage(message) {
  const parts = message.split(' ');
  if (parts.length < 5) return message;

  const method = parts[0];
  const url = parts[1];
  const status = parts[4]; // In 'GET /url | Status: 200...', status is at index 4
  
  // Colorize HTTP Method
  let coloredMethod = method;
  if (method === 'GET') coloredMethod = `${ANSI.blue}${method}${ANSI.reset}`;
  else if (method === 'POST') coloredMethod = `${ANSI.green}${method}${ANSI.reset}`;
  else if (method === 'PUT') coloredMethod = `${ANSI.yellow}${method}${ANSI.reset}`;
  else if (method === 'DELETE') coloredMethod = `${ANSI.red}${method}${ANSI.reset}`;
  
  // Colorize HTTP Status Code
  let coloredStatus = status;
  const statusNum = parseInt(status, 10);
  if (statusNum >= 200 && statusNum < 300) coloredStatus = `${ANSI.green}${status}${ANSI.reset}`;
  else if (statusNum >= 300 && statusNum < 400) coloredStatus = `${ANSI.cyan}${status}${ANSI.reset}`;
  else if (statusNum >= 400 && statusNum < 500) coloredStatus = `${ANSI.yellow}${status}${ANSI.reset}`;
  else if (statusNum >= 500) coloredStatus = `${ANSI.red}${ANSI.bright}${status}${ANSI.reset}`;

  parts[0] = coloredMethod;
  parts[1] = `${ANSI.cyan}${url}${ANSI.reset}`;
  parts[4] = coloredStatus;

  // Colorize "User: ..." part if present
  const userIdx = parts.indexOf('User:');
  if (userIdx !== -1 && userIdx + 1 < parts.length) {
    parts[userIdx] = `${ANSI.dim}User:`;
    for (let i = userIdx + 1; i < parts.length; i++) {
      parts[i] = `${ANSI.white}${ANSI.bright}${parts[i]}${ANSI.reset}`;
    }
  }

  return parts.join(' ');
}

const coloredFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.printf((info) => {
    const levelColorizer = winston.format.colorize();
    const coloredLevel = levelColorizer.colorize(info.level, info.level.toUpperCase());
    
    let message = info.message;
    if (info.level === 'http') {
      message = colorizeHttpMessage(message);
    } else if (info.level === 'error') {
      message = `${ANSI.red}${message}${ANSI.reset}`;
    } else if (info.level === 'info') {
      message = `${ANSI.green}${message}${ANSI.reset}`;
    } else if (info.level === 'warn') {
      message = `${ANSI.yellow}${message}${ANSI.reset}`;
    }
    
    return `${ANSI.dim}${info.timestamp}${ANSI.reset} [${coloredLevel}]: ${message}${info.stack ? `\n${ANSI.red}${info.stack}${ANSI.reset}` : ''}`;
  })
);

// Strips ANSI escape codes to output clean text for stored log files
const plainFormat = winston.format.combine(
  coloredFormat,
  winston.format.uncolorize()
);

const transports = [
  new winston.transports.Console({
    format: coloredFormat
  }),
  new winston.transports.DailyRotateFile({
    filename: path.join(LOGS_DIR, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: plainFormat
  }),
  new winston.transports.DailyRotateFile({
    filename: path.join(LOGS_DIR, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    format: plainFormat
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  format: coloredFormat,
  transports,
});

// Cache for user loggers
const userLoggers = new Map();

export const getUserLogger = (userName) => {
  const safeDirName = userName ? String(userName).trim().toLowerCase() : 'anonymous';
  
  if (userLoggers.has(safeDirName)) {
    return userLoggers.get(safeDirName);
  }

  const userLogDir = path.join(LOGS_DIR, `users/${safeDirName}`);
  
  // Ensure the user directory exists
  if (!fs.existsSync(userLogDir)) {
    fs.mkdirSync(userLogDir, { recursive: true });
  }

  const userLogger = winston.createLogger({
    level: level(),
    levels,
    format: coloredFormat,
    transports: [
      new winston.transports.DailyRotateFile({
        filename: path.join(userLogDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error',
        format: plainFormat
      }),
      new winston.transports.DailyRotateFile({
        filename: path.join(userLogDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        format: plainFormat
      }),
    ],
  });

  userLoggers.set(safeDirName, userLogger);
  return userLogger;
};

export default logger;

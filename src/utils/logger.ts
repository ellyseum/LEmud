import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const PLAYER_LOGS_DIR = path.join(LOGS_DIR, 'players');

// --- Ensure log directories exist ---
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
if (!fs.existsSync(PLAYER_LOGS_DIR)) {
  fs.mkdirSync(PLAYER_LOGS_DIR, { recursive: true });
}
// Note: winston-daily-rotate-file handles the archive rotation automatically based on config.

// --- Define Log Format ---
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }), // Log stack traces for errors
  winston.format.splat(),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    logFormat // Reuse the base format but add color
);

// --- System Logger ---
const systemLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // Default to 'info', can be overridden by env var
  format: logFormat,
  transports: [
    // Console Transport (for development/debugging)
    new winston.transports.Console({
      format: consoleFormat, // Use the colorful format for the console
      level: 'debug' // Show more detailed logs in the console
    }),
    // System File Transport (Info Level)
    new winston.transports.DailyRotateFile({
      filename: path.join(LOGS_DIR, 'system-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true, // Compress rotated files
      maxSize: '20m',     // Rotate when file reaches 20MB
      maxFiles: '14d',    // Keep logs for 14 days
      level: 'info',      // Log info, warn, error to this file
      utc: true           // Use UTC time for file rotation
    }),
    // Error File Transport (Error Level Only)
    new winston.transports.DailyRotateFile({
        filename: path.join(LOGS_DIR, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '30d',
        level: 'error', // Only log errors and above to this file
        utc: true       // Use UTC time for file rotation
      })
  ],
  exceptionHandlers: [ // Catch and log unhandled exceptions
    new winston.transports.DailyRotateFile({
        filename: path.join(LOGS_DIR, 'exceptions-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '30d',
        utc: true       // Use UTC time for file rotation
      }),
    new winston.transports.Console({ // Also log exceptions to console
        format: consoleFormat
    })
  ],
  rejectionHandlers: [ // Catch and log unhandled promise rejections
    new winston.transports.DailyRotateFile({
        filename: path.join(LOGS_DIR, 'rejections-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '10m',
        maxFiles: '30d',
        utc: true       // Use UTC time for file rotation
      }),
    new winston.transports.Console({ // Also log rejections to console
        format: consoleFormat
    })
  ],
  exitOnError: false // Prevent Winston from exiting on handled exceptions/rejections
});

// --- Player Logger Management ---
const playerLoggers = new Map<string, winston.Logger>();

function getPlayerLogger(username: string): winston.Logger {
  // Sanitize username to prevent path traversal issues and invalid characters
  const sanitizedUsername = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!playerLoggers.has(sanitizedUsername)) {
    const logger = winston.createLogger({
      level: 'info',
      format: logFormat,
      transports: [
        new winston.transports.DailyRotateFile({
          filename: path.join(PLAYER_LOGS_DIR, `${sanitizedUsername}-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '5m', // Smaller size for individual player logs
          maxFiles: '7d', // Keep player logs for 7 days
          level: 'info',
          utc: true     // Use UTC time for file rotation
        })
      ]
    });
    playerLoggers.set(sanitizedUsername, logger);
    systemLogger.debug(`Created logger for player: ${sanitizedUsername}`);
  }
  return playerLoggers.get(sanitizedUsername)!;
}

// --- Context-Aware Logging Helpers ---

/**
 * Creates a context-aware logger with predefined metadata
 * Useful for consistently logging from a specific component
 */
function createContextLogger(context: string) {
  return {
    debug: (message: string, metadata?: any) => 
      systemLogger.debug(`[${context}] ${message}`, metadata),
    info: (message: string, metadata?: any) => 
      systemLogger.info(`[${context}] ${message}`, metadata),
    warn: (message: string, metadata?: any) => 
      systemLogger.warn(`[${context}] ${message}`, metadata),
    error: (message: string, metadata?: any) => 
      systemLogger.error(`[${context}] ${message}`, metadata)
  };
}

/**
 * Creates a specific logger for game mechanics like combat, movement, etc.
 * Adds both system logging and player-specific logging
 */
function createMechanicsLogger(mechanicName: string) {
  const mechLogger = createContextLogger(mechanicName);
  
  return {
    ...mechLogger,
    // Log both to system and to player logs
    playerAction: (username: string, message: string, level: 'info' | 'warn' | 'error' = 'info') => {
      const playerLogger = getPlayerLogger(username);
      mechLogger[level](`Player ${username}: ${message}`);
      playerLogger[level](`[${mechanicName}] ${message}`);
    }
  };
}

// Example usage:
// const combatLogger = createMechanicsLogger('Combat');
// combatLogger.playerAction('player1', 'Attacked goblin for 5 damage');

export { 
  systemLogger, 
  getPlayerLogger,
  createContextLogger,
  createMechanicsLogger
};
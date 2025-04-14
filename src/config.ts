// Configuration file for the MUD game server
import path from 'path';
import os from 'os';

// Server ports
export const TELNET_PORT = 8023; // Standard TELNET port is 23, using 8023 to avoid requiring root privileges
export const WS_PORT = 8080; // WebSocket port for the web client and admin interface

// Authentication
export const JWT_SECRET = process.env.JWT_SECRET || 'mud-admin-secret-key';
export const MIN_PASSWORD_LENGTH = 6;
export const maxPasswordAttempts = 3; // Max failed password attempts before disconnection

// File paths
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');
export const ADMIN_DIR = path.join(DATA_DIR, 'admin');

// Message formatting
export const MAX_MESSAGE_LINE_LENGTH = 50; // For admin and system messages

// Timeouts and intervals
export const SERVER_STATS_UPDATE_INTERVAL = 5000; // Update server statistics every 5 seconds
export const IDLE_CHECK_INTERVAL = 60000; // Check for idle clients every minute
export const COMMAND_DELAY_MS = 50; // Delay for processing commands

// System defaults
export const DEFAULT_SHUTDOWN_MINUTES = 5;
export const USERNAME_MAX_LENGTH = 12;
export const USERNAME_MIN_LENGTH = 3;

// Environment detection
export const IS_TTY = process.stdin.isTTY;
export const HOST_NAME = os.hostname();

// Export all configuration as a single object for convenience
export default {
  TELNET_PORT,
  WS_PORT,
  JWT_SECRET,
  MIN_PASSWORD_LENGTH,
  maxPasswordAttempts,
  DATA_DIR,
  PUBLIC_DIR,
  ADMIN_DIR,
  MAX_MESSAGE_LINE_LENGTH,
  SERVER_STATS_UPDATE_INTERVAL,
  IDLE_CHECK_INTERVAL,
  COMMAND_DELAY_MS,
  DEFAULT_SHUTDOWN_MINUTES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  IS_TTY,
  HOST_NAME
};

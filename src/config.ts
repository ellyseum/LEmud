// Configuration file for the MUD game server
import path from 'path';
import os from 'os';
import { parseCommandLineArgs } from './config/cliConfig';

// Parse command line arguments
const cliConfig = parseCommandLineArgs();

// Server ports
export const TELNET_PORT = cliConfig.port;

// Port synchronization logic:
// 1. If httpPort is explicitly provided, use it for HTTP_PORT
// 2. If httpPort is not provided but wsPort is, use wsPort for HTTP_PORT
// 3. If neither is provided, use the default wsPort
export const HTTP_PORT = cliConfig.httpPort || cliConfig.wsPort;
export const WS_PORT = cliConfig.wsPort;

// Authentication
export const JWT_SECRET = process.env.JWT_SECRET || 'mud-admin-secret-key';
export const MIN_PASSWORD_LENGTH = 6;
export const maxPasswordAttempts = 3; // Max failed password attempts before disconnection

// Security settings
export const DISABLE_REMOTE_ADMIN = cliConfig.disableRemoteAdmin;
export const RESTRICTED_USERNAMES = ['admin', 'administrator', 'mod', 'moderator', 'root', 'system', 'console', 'server'];

// File paths
export const DATA_DIR = cliConfig.dataDir;
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');
export const ADMIN_DIR = path.join(DATA_DIR, 'admin');

// File locations
export const ROOMS_FILE = cliConfig.roomsFile;
export const USERS_FILE = cliConfig.usersFile;
export const ITEMS_FILE = cliConfig.itemsFile;
export const NPCS_FILE = cliConfig.npcsFile;
export const MUD_CONFIG_FILE = cliConfig.mudConfigFile;

// Session flags
export const AUTO_ADMIN_SESSION = cliConfig.adminSession;
export const AUTO_USER_SESSION = cliConfig.userSession;
export const FORCE_SESSION_USERNAME = cliConfig.forceSession;

// Direct data
export const DIRECT_ROOMS_DATA = cliConfig.rooms;
export const DIRECT_USERS_DATA = cliConfig.users;
export const DIRECT_ITEMS_DATA = cliConfig.items;
export const DIRECT_NPCS_DATA = cliConfig.npcs;

// Message formatting
export const MAX_MESSAGE_LINE_LENGTH = 50;

// Timeouts and intervals
export const SERVER_STATS_UPDATE_INTERVAL = 5000;
export const IDLE_CHECK_INTERVAL = 60000;
export const COMMAND_DELAY_MS = 50; // Delay for processing commands

// System defaults
export const DEFAULT_SHUTDOWN_MINUTES = 5;
export const USERNAME_MAX_LENGTH = 12;
export const USERNAME_MIN_LENGTH = 3;

// Environment detection
export const IS_WINDOWS = os.platform() === 'win32';

// Check for console mode - should be true if we're in a TTY, not running with auto-session,
// and not running with noConsole flag
export const CONSOLE_MODE = process.stdout.isTTY && 
                         !cliConfig.adminSession && 
                         !cliConfig.userSession &&
                         !cliConfig.noConsole;

// Use previous IS_TTY value for backward compatibility
export const IS_TTY = CONSOLE_MODE;

// Disable colors if requested
export const USE_COLORS = !cliConfig.noColor;

// Set log level from CLI
export const LOG_LEVEL = cliConfig.logLevel;

// Silence console output if requested
export const SILENT_MODE = cliConfig.silent;

// Disable console commands if requested
export const NO_CONSOLE = cliConfig.noConsole;

// Export all configuration as a single object for convenience
export default {
  TELNET_PORT,
  WS_PORT,
  HTTP_PORT,
  JWT_SECRET,
  MIN_PASSWORD_LENGTH,
  maxPasswordAttempts,
  DATA_DIR,
  PUBLIC_DIR,
  ADMIN_DIR,
  ROOMS_FILE,
  USERS_FILE,
  ITEMS_FILE,
  NPCS_FILE,
  MUD_CONFIG_FILE,
  AUTO_ADMIN_SESSION,
  AUTO_USER_SESSION,
  FORCE_SESSION_USERNAME,
  DIRECT_ROOMS_DATA,
  DIRECT_USERS_DATA,
  DIRECT_ITEMS_DATA,
  DIRECT_NPCS_DATA,
  MAX_MESSAGE_LINE_LENGTH,
  SERVER_STATS_UPDATE_INTERVAL,
  IDLE_CHECK_INTERVAL,
  COMMAND_DELAY_MS,
  DEFAULT_SHUTDOWN_MINUTES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  IS_WINDOWS,
  IS_TTY,
  CONSOLE_MODE,
  USE_COLORS,
  LOG_LEVEL,
  SILENT_MODE,
  NO_CONSOLE,
  DISABLE_REMOTE_ADMIN,
  HOST_NAME: os.hostname()
};

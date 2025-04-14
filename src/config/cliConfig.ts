import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';

// Define the configuration interface
export interface CLIConfig {
  // Session flags
  adminSession: boolean;
  userSession: boolean;
  
  // Data directory flags
  dataDir: string;
  roomsFile: string;
  usersFile: string;
  itemsFile: string;
  npcsFile: string;
  mudConfigFile: string;
  
  // Direct data input
  rooms: string | null;
  users: string | null;
  items: string | null;
  npcs: string | null;
  
  // Additional server options
  port: number;
  wsPort: number;
  logLevel: string;
  noColor: boolean;
  silent: boolean;
  noConsole: boolean;
}

// Parse command line arguments
export function parseCommandLineArgs(): CLIConfig {
  const defaultDataDir = path.join(__dirname, '..', '..', 'data');
  
  const argv = yargs(hideBin(process.argv))
    // Session flags
    .option('adminSession', {
      type: 'boolean',
      description: 'Start and immediately connect to an admin session',
      default: false,
      alias: 'a'
    })
    .option('userSession', {
      type: 'boolean',
      description: 'Start and immediately connect to a user session',
      default: false,
      alias: 'u'
    })
    
    // Data directory flags
    .option('dataDir', {
      type: 'string',
      description: 'Base directory for data files',
      default: defaultDataDir,
      alias: 'd'
    })
    .option('roomsFile', {
      type: 'string',
      description: 'Path to rooms file'
    })
    .option('usersFile', {
      type: 'string',
      description: 'Path to users file'
    })
    .option('itemsFile', {
      type: 'string',
      description: 'Path to items file'
    })
    .option('npcsFile', {
      type: 'string',
      description: 'Path to npcs file'
    })
    .option('mudConfigFile', {
      type: 'string',
      description: 'Path to MUD configuration file'
    })
    
    // Direct data input
    .option('rooms', {
      type: 'string',
      description: 'JSON string with room data'
    })
    .option('users', {
      type: 'string',
      description: 'JSON string with user data'
    })
    .option('items', {
      type: 'string',
      description: 'JSON string with item data'
    })
    .option('npcs', {
      type: 'string',
      description: 'JSON string with NPC data'
    })
    
    // Additional server options
    .option('port', {
      type: 'number',
      description: 'Telnet server port',
      default: 8023,
      alias: 'p'
    })
    .option('wsPort', {
      type: 'number',
      description: 'WebSocket server port',
      default: 8080,
      alias: 'w'
    })
    .option('logLevel', {
      type: 'string',
      description: 'Log level (debug, info, warn, error)',
      default: 'info',
      alias: 'l'
    })
    .option('noColor', {
      type: 'boolean',
      description: 'Disable colored output',
      default: false,
      alias: 'n'
    })
    .option('silent', {
      type: 'boolean',
      description: 'Suppress all console logging',
      default: false,
      alias: 's'
    })
    .option('noConsole', {
      type: 'boolean',
      description: 'Disable interactive console commands and help messages',
      default: false,
      alias: 'c'
    })
    .help()
    .alias('help', 'h')
    .parseSync();
  
  // Set default file paths if not provided
  const config: CLIConfig = {
    adminSession: argv.adminSession,
    userSession: argv.userSession,
    dataDir: argv.dataDir,
    roomsFile: argv.roomsFile || path.join(argv.dataDir, 'rooms.json'),
    usersFile: argv.usersFile || path.join(argv.dataDir, 'users.json'),
    itemsFile: argv.itemsFile || path.join(argv.dataDir, 'items.json'),
    npcsFile: argv.npcsFile || path.join(argv.dataDir, 'npcs.json'),
    mudConfigFile: argv.mudConfigFile || path.join(argv.dataDir, 'mud-config.json'),
    rooms: argv.rooms || null,
    users: argv.users || null,
    items: argv.items || null,
    npcs: argv.npcs || null,
    port: argv.port,
    wsPort: argv.wsPort,
    logLevel: argv.logLevel,
    noColor: argv.noColor,
    // Auto-enable silent and noConsole if an auto-session is requested
    silent: argv.silent || argv.adminSession || argv.userSession,
    noConsole: argv.noConsole || argv.adminSession || argv.userSession
  };
  
  // Ensure data directory exists
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
  
  return config;
}
import { GameServer } from './app';
import * as config from './config';
import { JsonValidationError } from './utils/jsonUtils';
import { systemLogger } from './utils/logger';

// This file now acts as a simple entry point that creates and starts the game server
let gameServer: GameServer;

// Run the main function
try {
  main();
} catch (error) {
  handleUnexpectedError(error);
}

async function main() {
  try {
    // Create the game server - wrap this in try/catch to handle construction errors
    gameServer = new GameServer();
    
    // Start the server
    await gameServer.start();
    
    // If auto sessions are enabled, start them after server initialization
    if (config.AUTO_ADMIN_SESSION) {
      await gameServer.startAutoAdminSession();
    } else if (config.AUTO_USER_SESSION) {
      await gameServer.startAutoUserSession();
    } else if (config.FORCE_SESSION_USERNAME) {
      // Start forced session with auto-exit behavior
      await gameServer.startAutoForcedSession(config.FORCE_SESSION_USERNAME);
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * Start a session as a specific user
 */
async function startForcedUserSession(server: GameServer, username: string): Promise<void> {
  console.log(`Starting forced session as user: ${username}`);
  
  // Suppress normal console output for a cleaner experience
  const originalConsole = console.log;
  console.log = () => {}; // No-op function
  
  try {
    // Use the new specialized method for forced sessions
    await server.startForcedSession(server.getTelnetPort(), username);
    
    // Add auto-exit handler for when the session ends
    process.on('SIGINT', () => {
      process.exit(0);
    });
  } catch (error) {
    // Restore console for error reporting
    console.log = originalConsole;
    console.error(`Error starting forced session as ${username}:`, error);
    process.exit(1);
  }
}

/**
 * Handle errors including validation errors with user-friendly messages
 */
function handleError(error: any): void {
  // Check if this is a validation error
  if (error instanceof JsonValidationError || error?.name === 'JsonValidationError') {
    // Display a user-friendly error message
    console.error('\x1b[31m✗ DATA VALIDATION ERROR\x1b[0m');
    console.error('\x1b[31mCannot start server: Invalid data format detected.\x1b[0m');
    
    // Show the specific validation failures
    if (error.errors && error.errors.length > 0) {
      console.error('\nProblems that need to be fixed:');
      error.errors.forEach((err: any) => {
        const path = err.instancePath || 'root';
        console.error(`- ${path}: ${err.message}`);
      });
      
      // Suggest which file likely needs fixing based on the error message
      const fileHint = getFileHintFromError(error.message);
      if (fileHint) {
        console.error(`\nLikely location: Check the ${fileHint} file`);
      }
    } else {
      // Generic message if detailed errors aren't available
      console.error(error.message);
    }
    
    console.error('\nFix the data files according to the schema and try again.');
    
    // Log to system log but don't show the stack trace to the user
    systemLogger.error(`Server startup aborted: ${error.message}`);
    process.exit(1);
  } else {
    // For other types of errors, show a simpler message
    console.error('\x1b[31m✗ ERROR STARTING SERVER\x1b[0m');
    console.error(error instanceof Error ? error.message : String(error));
    systemLogger.error('Failed to start game server:', error);
    process.exit(1);
  }
}

/**
 * Handle unexpected errors at the top level
 */
function handleUnexpectedError(error: any): void {
  console.error('\x1b[31m✗ Unhandled error in application\x1b[0m');
  systemLogger.error('Unhandled error:', error);
  process.exit(1);
}

/**
 * Helper function to suggest which file might contain the error based on error message
 */
function getFileHintFromError(errorMessage: string): string | null {
  if (!errorMessage) return null;
  
  const lowerMsg = errorMessage.toLowerCase();
  if (lowerMsg.includes('room') || lowerMsg.includes('exit')) {
    return 'data/rooms.json';
  } else if (lowerMsg.includes('user') || lowerMsg.includes('player')) {
    return 'data/users.json';
  } else if (lowerMsg.includes('item') || lowerMsg.includes('weapon') || lowerMsg.includes('armor')) {
    return 'data/items.json';
  } else if (lowerMsg.includes('npc') || lowerMsg.includes('monster') || lowerMsg.includes('creature')) {
    return 'data/npcs.json';
  }
  
  return null;
}

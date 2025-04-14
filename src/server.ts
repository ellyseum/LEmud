import { GameServer } from './app';
import * as config from './config';

// This file now acts as a simple entry point that creates and starts the game server
const gameServer = new GameServer();

async function main() {
  // Start the server
  await gameServer.start();
  
  // If auto sessions are enabled, start them after server initialization
  if (config.AUTO_ADMIN_SESSION) {
    gameServer.startAutoAdminSession();
  } else if (config.AUTO_USER_SESSION) {
    gameServer.startAutoUserSession();
  }
}

// Run the main function
main().catch(error => {
  console.error('Failed to start game server:', error);
  process.exit(1);
});

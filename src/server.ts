import { GameServer } from './app';

// This file now acts as a simple entry point that creates and starts the game server
const gameServer = new GameServer();

// Start the server
gameServer.start().catch(error => {
  console.error('Failed to start game server:', error);
  process.exit(1);
});

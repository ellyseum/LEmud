import net from 'net';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import jwt from 'jsonwebtoken'; // Add this import
import { ConnectedClient, ClientStateType, ServerStats } from './types';
import { UserManager } from './user/userManager';
import { CommandHandler } from './command/commandHandler';
import { StateMachine } from './state/stateMachine';
import { colorize } from './utils/colors';
import { stopBuffering, writeMessageToClient } from './utils/socketWriter';
import { TelnetConnection } from './connection/telnet.connection';
import { SocketIOConnection } from './connection/socketio.connection';
import { IConnection } from './connection/interfaces/connection.interface';
import { formatUsername } from './utils/formatters';
import { RoomManager } from './room/roomManager';
import * as AdminApi from './admin/adminApi';
import { getPromptText } from './utils/promptFormatter';
import { GameTimerManager } from './timer/gameTimerManager';
import { getMUDConfig, updateMUDConfig, loadMUDConfig } from './admin/adminApi';

const TELNET_PORT = 8023; // Standard TELNET port is 23, using 8023 to avoid requiring root privileges
const WS_PORT = 8080; // WebSocket port

// Initialize server components
const userManager = new UserManager();
const clients = new Map<string, ConnectedClient>();
const roomManager = RoomManager.getInstance(clients);
const commandHandler = new CommandHandler(clients, userManager);
const stateMachine = new StateMachine(userManager, clients);

// Initialize the game timer manager with userManager and roomManager
const gameTimerManager = GameTimerManager.getInstance(userManager, roomManager);

// Secret key for JWT tokens - same as in adminApi.ts
const JWT_SECRET = process.env.JWT_SECRET || 'mud-admin-secret-key';

// Create server statistics
const serverStats: ServerStats = {
  startTime: new Date(),
  uptime: 0,
  connectedClients: 0,
  authenticatedUsers: 0,
  totalConnections: 0,
  totalCommands: 0,
  memoryUsage: {
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0
  }
};

// Update server stats every 5 seconds
setInterval(() => {
  serverStats.uptime = Math.floor((Date.now() - serverStats.startTime.getTime()) / 1000);
  serverStats.connectedClients = clients.size;
  serverStats.authenticatedUsers = Array.from(clients.values()).filter(c => c.authenticated).length;
  serverStats.memoryUsage = process.memoryUsage();
}, 5000);

// Create the Express app for the HTTP server
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Admin API routes
app.post('/api/admin/login', AdminApi.login);
app.get('/api/admin/stats', AdminApi.validateToken, AdminApi.getServerStats(serverStats));
app.get('/api/admin/players', AdminApi.validateToken, AdminApi.getConnectedPlayers(clients, userManager));
app.post('/api/admin/players/:clientId/kick', AdminApi.validateToken, AdminApi.kickPlayer(clients));
app.post('/api/admin/players/:clientId/monitor', AdminApi.validateToken, AdminApi.monitorPlayer(clients));

// Add new player management endpoints
app.get('/api/admin/players/all', AdminApi.validateToken, AdminApi.getAllPlayers(userManager));
app.get('/api/admin/players/details/:username', AdminApi.validateToken, AdminApi.getPlayerDetailsById(userManager));
app.post('/api/admin/players/update/:username', AdminApi.validateToken, AdminApi.updatePlayer(userManager, roomManager));
app.post('/api/admin/players/reset-password/:username', AdminApi.validateToken, AdminApi.resetPlayerPassword(userManager));
app.delete('/api/admin/players/delete/:username', AdminApi.validateToken, AdminApi.deletePlayer(userManager, roomManager, clients));

// Add new game timer system endpoints
app.get('/api/admin/gametimer-config', AdminApi.validateToken, AdminApi.getGameTimerConfig(gameTimerManager));
app.post('/api/admin/gametimer-config', AdminApi.validateToken, AdminApi.updateGameTimerConfig(gameTimerManager));
app.post('/api/admin/force-save', AdminApi.validateToken, AdminApi.forceSave(gameTimerManager));

// Add new MUD config endpoints
app.get('/api/admin/mud-config', AdminApi.validateToken, AdminApi.getMUDConfig());
app.post('/api/admin/mud-config', AdminApi.validateToken, AdminApi.updateMUDConfig());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Create the HTTP server with the Express app
const httpServer = http.createServer(app);

// Create Socket.IO server for WebSocket connections
const io = new SocketIOServer(httpServer);

// Add Socket.IO handler
io.on('connection', (socket) => {
  console.log(`Socket.IO client connected: ${socket.id}`);
  
  // Create our custom connection wrapper
  const connection = new SocketIOConnection(socket);
  setupClient(connection);
  
  // Track total connections
  serverStats.totalConnections++;
  
  // Handle monitoring requests
  socket.on('monitor-user', (data) => {
    const { clientId, token } = data;
    
    // Verify admin token
    jwt.verify(token, JWT_SECRET, (err: jwt.VerifyErrors | null, decoded: any) => {
      if (err) {
        socket.emit('monitor-error', { message: 'Authentication failed' });
        return;
      }
      
      const client = clients.get(clientId);
      if (!client) {
        socket.emit('monitor-error', { message: 'Client not found' });
        return;
      }
      
      // Store the admin socket for this client and set monitoring flag
      client.adminMonitorSocket = socket;
      client.isBeingMonitored = true;
      
      console.log(`Admin is now monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
      
      // Send initial data to the admin
      socket.emit('monitor-connected', { 
        username: client.user ? client.user.username : 'Unknown',
        message: 'Monitoring session established'
      });
      
      // Send current room description if user is authenticated
      if (client.authenticated && client.user) {
        const roomManager = RoomManager.getInstance(clients);
        const room = roomManager.getRoom(client.user.currentRoomId);
        if (room) {
          socket.emit('monitor-output', { 
            data: `\r\n${colorize(`Current location: ${client.user.currentRoomId}`, 'cyan')}\r\n${room.getDescription()}\r\n` 
          });
        }
      }
      
      // Set up handler for admin commands
      socket.on('admin-command', (commandData) => {
        if (commandData.clientId === clientId && client.authenticated) {
          // Process the command as if it came from the user
          const commandStr = commandData.command;
          
          // Echo the command to admin's terminal
          socket.emit('monitor-output', { data: `${colorize('> ' + commandStr, 'green')}\r\n` });
          
          // If the user is currently typing something, clear their input first
          if (client.buffer.length > 0) {
            // Get the current prompt length
            const promptText = getPromptText(client);
            const promptLength = promptText.length;
            
            // Clear the entire line and return to beginning
            client.connection.write('\r' + ' '.repeat(promptLength + client.buffer.length) + '\r');
            
            // Redisplay the prompt (since we cleared it as well)
            client.connection.write(promptText);
            
            // Clear the buffer
            client.buffer = '';
          }
          
          // Pause briefly to ensure the line is cleared
          setTimeout(() => {
            // Simulate the user typing this command by sending each character
            for (const char of commandStr) {
              handleClientData(client, char);
            }
            // Send enter key to execute the command
            handleClientData(client, '\r');
          }, 50);
        }
      });
      
      // Handle admin disconnect
      socket.on('disconnect', () => {
        if (client && client.adminMonitorSocket === socket) {
          delete client.adminMonitorSocket;
          client.isBeingMonitored = false;
        }
      });
    });
  });

  // Explicitly handle the stop-monitoring event
  socket.on('stop-monitoring', (data) => {
    const clientId = data.clientId;
    if (!clientId) return;
    
    const client = clients.get(clientId);
    if (client && client.adminMonitorSocket === socket) {
      console.log(`Admin stopped monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
      client.isBeingMonitored = false;
      client.adminMonitorSocket = undefined;
    }
  });
});

// Create TELNET server
const telnetServer = net.createServer(socket => {
  console.log(`TELNET client connected: ${socket.remoteAddress}`);
  
  // Create our custom connection wrapper
  const connection = new TelnetConnection(socket);
  
  // TelnetConnection class now handles all the TELNET negotiation
  setupClient(connection);
  
  // Track total connections
  serverStats.totalConnections++;
});

// Shared client setup function
function setupClient(connection: IConnection): void {
  // Set up the client
  const client: ConnectedClient = {
    id: crypto.randomUUID(), // Add unique ID using Node.js crypto module
    connection,
    user: null,
    authenticated: false,
    buffer: '',
    state: ClientStateType.CONNECTING,
    stateData: {},
    isTyping: false,
    outputBuffer: [],
    connectedAt: Date.now(), // Add connectedAt property
    lastActivity: Date.now(),  // Add lastActivity property
    isBeingMonitored: false // Add default for monitoring flag
  };
  
  const clientId = connection.getId();
  clients.set(clientId, client);
  
  // Start the state machine
  stateMachine.transitionTo(client, ClientStateType.CONNECTING);
  
  // Handle data from client
  connection.on('data', (data) => {
    client.lastActivity = Date.now(); // Update lastActivity on data received
    handleClientData(client, data);
  });
  
  // Handle client disconnect
  connection.on('end', () => {
    console.log(`Client disconnected: ${clientId}`);
    
    // Check if client was in a pending transfer
    if (client.user && client.stateData.waitingForTransfer) {
      userManager.cancelTransfer(client.user.username);
    }
    
    // Only unregister if the client is still authenticated
    if (client.user && client.authenticated) {
      // Remove player from all rooms when they disconnect
      const username = client.user.username;
      const roomManager = RoomManager.getInstance(clients);
      roomManager.removePlayerFromAllRooms(username);
      
      // Unregister the user session
      userManager.unregisterUserSession(username);
      
      // Notify other users with formatted username
      const formattedUsername = formatUsername(username);
      broadcastSystemMessage(`${formattedUsername} has left the game.`, client);
    }
    clients.delete(clientId);
  });
  
  // Handle connection errors similarly
  connection.on('error', (err) => {
    console.error(`Error with client ${clientId}:`, err);
    
    // Check if client was in a pending transfer
    if (client.user && client.stateData.waitingForTransfer) {
      userManager.cancelTransfer(client.user.username);
    }
    
    // Only unregister if the client is still authenticated
    if (client.user && client.authenticated) {
      // Remove player from all rooms when they disconnect due to error
      const username = client.user.username;
      const roomManager = RoomManager.getInstance(clients);
      roomManager.removePlayerFromAllRooms(username);
      
      // Unregister the user session
      userManager.unregisterUserSession(username);
    }
    
    clients.delete(clientId);
  });
}

// Unified handler for client data (both TELNET and WebSocket)
function handleClientData(client: ConnectedClient, data: string): void {
  // Start buffering output when user begins typing
  if (client.buffer.length === 0 && !client.isTyping) {
    client.isTyping = true;
  }
  
  // Debugging - uncomment if needed
  // console.log('Input data:', data.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));
  
  // Handle Ctrl+U (ASCII code 21) - clear entire input line
  if (data === '\u0015') {
    if (client.buffer.length > 0) {
      // Calculate how many backspaces are needed to clear the current input
      const backspaces = '\b \b'.repeat(client.buffer.length);
      
      // Send backspaces to clear the user's current input
      client.connection.write(backspaces);
      
      // Clear the buffer
      
      client.buffer = '';
      
      // If buffer becomes empty, flush any buffered output
      stopBuffering(client);
    }
    return;
  }
  
  // Handle backspace - check for both BS char and DEL char since clients may send either
  if (data === '\b' || data === '\x7F') {
    if (client.buffer.length > 0) {
      // Remove the last character from the buffer
      client.buffer = client.buffer.slice(0, -1);
      
      // Update the terminal display (backspace, space, backspace)
      client.connection.write('\b \b');
      
      // If buffer becomes empty, flush any buffered output
      if (client.buffer.length === 0) {
        stopBuffering(client);
      }
    }
    return;
  }
  
  // Handle Enter (CR+LF, CR, or LF)
  if (data === '\r\n' || data === '\r' || data === '\n') {
    // Echo a newline
    client.connection.write('\r\n');
    
    // Process the completed line
    const line = client.buffer;
    client.buffer = ''; // Reset the buffer
    
    // Stop buffering and flush any buffered output before processing command
    stopBuffering(client);
    
    // Process the input
    processInput(client, line);
    return;
  }
  
  // Handle up arrow (various possible formats)
  if (data === '\u001b[A' || data === '[A' || data === '\u001bOA' || data === 'OA') {
    handleUpArrow(client);
    return;
  }
  
  // Handle down arrow (various possible formats)
  if (data === '\u001b[B' || data === '[B' || data === '\u001bOB' || data === 'OB') {
    handleDownArrow(client);
    return;
  }
  
  // Handle normal input (excluding special sequences)
  client.buffer += data;
  
  // Echo the character if not in mask mode - this is where all echoing should occur
  if (!client.stateData.maskInput) {
    client.connection.write(data);
  } else {
    // For masked input (passwords), echo an asterisk
    client.connection.write('*');
  }
  
  // Update mask input state
  client.connection.setMaskInput(!!client.stateData.maskInput);

  // After processing input, check for forced transitions
  if (client.stateData.forcedTransition) {
    stopBuffering(client);
    const forcedState = client.stateData.forcedTransition;
    delete client.stateData.forcedTransition;
    stateMachine.transitionTo(client, forcedState);
    return;
  }
}

// Handle up arrow key press
function handleUpArrow(client: ConnectedClient): void {
  if (!client.user) return;
  
  // Initialize command history if necessary
  if (!client.user.commandHistory) {
    client.user.commandHistory = [];
  }
  
  if (client.user.currentHistoryIndex === undefined) {
    client.user.currentHistoryIndex = -1;
  }
  
  // Save current command if we're just starting to browse history
  if (client.user.currentHistoryIndex === -1 && client.buffer) {
    client.user.savedCurrentCommand = client.buffer;
  }
  
  // Move up in history if possible
  if (client.user.commandHistory.length > 0 && 
      client.user.currentHistoryIndex < client.user.commandHistory.length - 1) {
    
    // Increment history index first
    client.user.currentHistoryIndex++;
    
    // Get the command from history
    const historyCommand = client.user.commandHistory[client.user.commandHistory.length - 1 - client.user.currentHistoryIndex];
    
    // If telnet, do a full line rewrite
    if (client.connection.getType() === 'telnet') {
      // Clear line and return to beginning with escape sequence (works better than backspaces)
      client.connection.write('\r\x1B[K');
      
      // Write the prompt
      const promptText = getPromptText(client);
      client.connection.write(promptText);
      
      // Write the command from history
      client.connection.write(historyCommand);
    } else {
      // For websocket: standard clear and rewrite
      client.connection.write('\r\x1B[K');
      client.connection.write(historyCommand);
    }
    
    // Update the buffer
    client.buffer = historyCommand;
  }
}

// Handle down arrow key press
function handleDownArrow(client: ConnectedClient): void {
  if (!client.user) return;
  
  // Initialize history if necessary
  if (!client.user.commandHistory) {
    client.user.commandHistory = [];
  }
  
  if (client.user.currentHistoryIndex === undefined || client.user.currentHistoryIndex < 0) {
    return;
  }
  
  // Decrement history index
  client.user.currentHistoryIndex--;
  
  let newCommand = '';
  
  // If we've moved past the first command, restore the saved current command
  if (client.user.currentHistoryIndex === -1) {
    newCommand = client.user.savedCurrentCommand || '';
  } else {
    // Otherwise, get the command from history
    newCommand = client.user.commandHistory[client.user.commandHistory.length - 1 - client.user.currentHistoryIndex];
  }
  
  // If telnet, do a full line rewrite
  if (client.connection.getType() === 'telnet') {
    // Clear line and return to beginning with escape sequence (works better than backspaces)
    client.connection.write('\r\x1B[K');
    
    // Write the prompt
    const promptText = getPromptText(client);
    client.connection.write(promptText);
    
    // Write the command 
    client.connection.write(newCommand);
  } else {
    // For websocket: standard clear and rewrite
    client.connection.write('\r\x1B[K');
    client.connection.write(newCommand);
  }
  
  // Update the buffer
  client.buffer = newCommand;
}

function processInput(client: ConnectedClient, input: string): void {
  // Command tracking for stats
  serverStats.totalCommands++;
  
  // Trim whitespace from beginning and end of input
  const trimmedInput = input.trim();
  
  console.log(`Processing input from client in state ${client.state}: "${trimmedInput}"`);

  // Check for forced transitions (like transfer requests)
  if (client.stateData.forcedTransition) {
    const forcedState = client.stateData.forcedTransition;
    delete client.stateData.forcedTransition;
    stateMachine.transitionTo(client, forcedState);
    return;
  }
  
  // Check if user is authenticated AND not in confirmation state
  if (client.authenticated && client.state !== ClientStateType.CONFIRMATION && 
      client.state !== ClientStateType.TRANSFER_REQUEST) {
    // Process command from authenticated user
    commandHandler.handleCommand(client, trimmedInput);
    // Note: CommandHandler now handles displaying the prompt after commands
  } else {
    // Handle authentication via state machine
    stateMachine.handleInput(client, trimmedInput);
    
    // Check if client should be disconnected (due to too many failed attempts)
    if (client.stateData.disconnect) {
      setTimeout(() => {
        console.log(`Disconnecting client due to too many failed password attempts`);
        client.connection.end();
      }, 1000); // Brief delay to ensure the error message is sent
    }
    
    // If user just became authenticated, show the command prompt
    if (client.authenticated && 
        client.state === ClientStateType.AUTHENTICATED &&
        !client.stateData.showedInitialPrompt) {
      client.stateData.showedInitialPrompt = true;
      // The authenticated state will handle the initial prompt
    }
  }
}

function broadcastSystemMessage(message: string, excludeClient?: ConnectedClient): void {
  clients.forEach(client => {
    if (client.authenticated && client !== excludeClient) {
      // Use the new message writing function that handles prompt management
      writeMessageToClient(client, colorize(message + '\r\n', 'bright'));
    }
  });
}

// Modify the writeToClient function to also send output to monitoring admins
function writeToClient(client: ConnectedClient, data: string): void {
  // Always write to the actual client
  client.connection.write(data);
  
  // If this client is being monitored, also send to the admin
  if (client.isBeingMonitored && client.adminMonitorSocket) {
    client.adminMonitorSocket.emit('monitor-output', { data });
  }
}

// After gameTimerManager initialization, set up idle timeout checker
const IDLE_CHECK_INTERVAL = 60000; // Check for idle clients every minute

// Function to check for and disconnect idle clients
function checkForIdleClients() {
  // Load the current configuration to get the idle timeout
  const config = loadMUDConfig();
  const idleTimeoutMinutes = config.game.idleTimeout;
  
  // If idle timeout is 0 or negative, idle timeout is disabled
  if (!idleTimeoutMinutes || idleTimeoutMinutes <= 0) {
    return;
  }
  
  // Convert minutes to milliseconds
  const idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
  const now = Date.now();
  
  // Check each connected client
  clients.forEach((client, clientId) => {
    // Skip clients who aren't authenticated yet (in login process)
    if (!client.authenticated) return;
    
    // Skip clients that are being monitored by an admin
    if (client.isBeingMonitored) {
      console.log(`Skipping idle check for monitored client: ${client.user?.username || 'anonymous'}`);
      return;
    }
    
    // Calculate how long the client has been idle
    const idleTime = now - client.lastActivity;
    
    // If client has exceeded the idle timeout
    if (idleTime > idleTimeoutMs) {
      console.log(`Client ${clientId} idle for ${Math.floor(idleTime / 1000)}s, disconnecting (timeout: ${idleTimeoutMinutes}m)`);
      
      // Send a message to the client explaining the disconnection
      if (client.connection) {
        writeMessageToClient(client, colorize('\r\n\r\nYou have been disconnected due to inactivity.\r\n', 'brightRed'));
        
        // Give them a moment to see the message, then disconnect
        setTimeout(() => {
          client.connection.end();
        }, 1000);
      }
    }
  });
}

// Set up periodic checking for idle clients
const idleCheckTimer = setInterval(checkForIdleClients, IDLE_CHECK_INTERVAL);

// Start the servers
telnetServer.listen(TELNET_PORT, () => {
  console.log(`TELNET server running on port ${TELNET_PORT}`);
});

httpServer.listen(WS_PORT, () => {
  console.log(`HTTP and Socket.IO server running on port ${WS_PORT}`);
  console.log(`Admin interface available at http://localhost:${WS_PORT}/admin`);
});

// Start the game timer system
gameTimerManager.start();

// Setup graceful shutdown to save data and properly clean up
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  // Stop the game timer system
  gameTimerManager.stop();
  
  // Clear the idle check interval
  clearInterval(idleCheckTimer);
  
  // Force a final save
  gameTimerManager.forceSave();
  
  // Reset the singleton instances if needed
  GameTimerManager.resetInstance();
  
  // Exit the process
  console.log('Server shutdown complete');
  process.exit(0);
});

console.log(`Make sure you have the following state files configured correctly:`);
console.log(` - connecting.state.ts`);
console.log(` - login.state.ts`);
console.log(` - signup.state.ts`);
console.log(` - authenticated.state.ts`);

import net from 'net';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import readline from 'readline';
import fs from 'fs';
import * as crypto from 'crypto';
import winston from 'winston'; // Add winston import
import { ConnectedClient, ClientStateType, ServerStats } from './types';
import { UserManager } from './user/userManager';
import { CommandHandler } from './command/commandHandler';
import { StateMachine } from './state/stateMachine';
import { colorize } from './utils/colors';
import { stopBuffering, writeMessageToClient, writeFormattedMessageToClient } from './utils/socketWriter';
import { TelnetConnection } from './connection/telnet.connection';
import { SocketIOConnection } from './connection/socketio.connection';
import { IConnection } from './connection/interfaces/connection.interface';
import { formatUsername } from './utils/formatters';
import { RoomManager } from './room/roomManager';
import * as AdminApi from './admin/adminApi';
import { getPromptText } from './utils/promptFormatter';
import { GameTimerManager } from './timer/gameTimerManager';
import { CombatSystem } from './combat/combatSystem';
import { AdminLevel } from './command/commands/adminmanage.command';
import { SnakeGameState } from './states/snake-game.state';
import { systemLogger, getPlayerLogger } from './utils/logger'; // Import loggers
const { SudoCommand } = require('./command/commands/sudo.command');

const TELNET_PORT = 8023; // Standard TELNET port is 23, using 8023 to avoid requiring root privileges
const WS_PORT = 8080; // WebSocket port
let actualTelnetPort = TELNET_PORT; // Store the actual port used

// --- Local Client Connection State ---
let isLocalClientConnected = false;
let localClientSocket: net.Socket | null = null;
let originalConsoleTransport: winston.transport | null = null;
let isAdminLoginPending = false; // Flag for direct admin login

// Initialize server components
const userManager = UserManager.getInstance();
const clients = new Map<string, ConnectedClient>();
const roomManager = RoomManager.getInstance(clients);
const stateMachine = new StateMachine(userManager, clients);
const commandHandler = new CommandHandler(clients, userManager, roomManager, undefined, stateMachine);

// Initialize the game timer manager with userManager and roomManager
const gameTimerManager = GameTimerManager.getInstance(userManager, roomManager);

// Share the global clients map with SnakeGameState
SnakeGameState.setGlobalClients(clients);

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

// Serve xterm.js files from node_modules
app.use('/node_modules', express.static(path.join(__dirname, '..', 'node_modules')));

// Create the HTTP server with the Express app
const httpServer = http.createServer(app);

// Create Socket.IO server for WebSocket connections
const io = new SocketIOServer(httpServer);

// Add Socket.IO handler
io.on('connection', (socket) => {
  systemLogger.info(`Socket.IO client connected: ${socket.id}`);
  
  // Create our custom connection wrapper
  const connection = new SocketIOConnection(socket);
  setupClient(connection);
  
  // Track total connections
  serverStats.totalConnections++;
  
  // Handle monitoring requests
  socket.on('monitor-user', (data) => {
    const { clientId, token } = data;
    
    // Verify admin token
    jwt.verify(token, JWT_SECRET, (err: jwt.VerifyErrors | null) => {
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
      
      systemLogger.info(`Admin is now monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
      
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
            // When input is blocked, bypass the normal input handler and directly process the command
            if (client.isInputBlocked === true) {
              // Write the command to the client's console so they can see what the admin is doing
              client.connection.write(`\r\n\x1b[33mAdmin executed: ${commandStr}\x1b[0m\r\n`);
              
              // Process the command directly without going through handleClientData
              const line = commandStr.trim();
              
              // Echo a newline to ensure clean output
              client.connection.write('\r\n');
              
              // Process the input directly
              processInput(client, line);
            } else {
              // Normal flow - simulate the user typing this command by sending each character
              for (const char of commandStr) {
                handleClientData(client, char);
              }
              // Send enter key to execute the command
              handleClientData(client, '\r');
            }
          }, 50);
        }
      });
      
      // Handle block user input toggle button
      socket.on('block-user-input', (blockData) => {
        if (blockData.clientId === clientId && client.authenticated) {
          // Set the input blocking state on the client
          client.isInputBlocked = blockData.blocked;
          
          systemLogger.info(`Admin has ${blockData.blocked ? 'blocked' : 'unblocked'} input for client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
          
          // Notify the user that their input has been blocked/unblocked
          if (client.authenticated) {
            if (blockData.blocked) {
              client.connection.write('\r\n\x1b[33mAn admin has temporarily disabled your input ability.\x1b[0m\r\n');
            } else {
              client.connection.write('\r\n\x1b[33mAn admin has re-enabled your input ability.\x1b[0m\r\n');
            }
            
            // Re-display the prompt
            const promptText = getPromptText(client);
            client.connection.write(promptText);
            if (client.buffer.length > 0) {
              client.connection.write(client.buffer);
            }
          }
        }
      });

      // Handle admin message
      socket.on('admin-message', (messageData) => {
        if (messageData.clientId === clientId && client.authenticated) {
          // Log the message being sent
          systemLogger.info(`Admin sent message to client ${clientId}${client.user ? ` (${client.user.username})` : ''}: ${messageData.message}`);
          
          // Create a 3D box with the message inside
          const boxedMessage = createAdminMessageBox(messageData.message);
          
          // Send the boxed message to the client
          writeMessageToClient(client, boxedMessage);

                  // Re-display the prompt
            const promptText = getPromptText(client);
            client.connection.write(promptText);
            if (client.buffer.length > 0) {
              client.connection.write(client.buffer);
            }

            // Echo to the admin that the message was sent
            socket.emit('monitor-output', { 
              data: `\r\n\x1b[36mAdmin message sent successfully\x1b[0m\r\n` 
            });
        }
      });
      
      // Handle admin disconnect
      socket.on('disconnect', () => {
        if (client && client.adminMonitorSocket === socket) {
          delete client.adminMonitorSocket;
          client.isBeingMonitored = false;
          client.isInputBlocked = false; // Make sure to unblock input when admin disconnects
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
      systemLogger.info(`Admin stopped monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
      client.isBeingMonitored = false;
      client.isInputBlocked = false; // Also unblock input when monitoring stops
      client.adminMonitorSocket = undefined;
    }
  });
});

// Create TELNET server
const telnetServer = net.createServer((socket) => {
  // Check if this connection is the pending admin login
  if (isAdminLoginPending) {
    isAdminLoginPending = false; // Reset flag immediately
    systemLogger.info(`Incoming connection flagged as direct admin login.`);
    
    // Create the connection wrapper
    const connection = new TelnetConnection(socket);
    
    // Setup client normally first
    setupClient(connection);
    
    // Get the client ID
    const clientId = connection.getId();
    const client = clients.get(clientId);
    
    if (client) {
      // Set a special flag in stateData for the state machine to handle
      client.stateData.directAdminLogin = true;
      
      // Have the state machine transition immediately to CONNECTING first
      // to ensure everything is initialized properly
      stateMachine.transitionTo(client, ClientStateType.CONNECTING);
      
      systemLogger.info(`Direct admin login initialized for connection: ${clientId}`);
      
      // Send welcome banner
      connection.write('========================================\r\n');
      connection.write('       DIRECT ADMIN LOGIN\r\n');
      connection.write('========================================\r\n\r\n');
      
      // Delay slightly to allow telnet negotiation to complete
      setTimeout(() => {
        // Login as admin user bypassing normal flow
        // This simulates the user typing "admin" at the login prompt
        processInput(client, 'admin');
        
        // Force authentication immediately, bypassing password check
        client.authenticated = true;
        
        // Set up admin user data
        const adminData = userManager.getUser('admin');
        if (adminData) {
          client.user = adminData;
          userManager.registerUserSession('admin', client);
          
          // Transition to authenticated state
          stateMachine.transitionTo(client, ClientStateType.AUTHENTICATED);
          
          // Log the direct admin login
          systemLogger.info(`Admin user directly logged in via console shortcut.`);
          
          // Notify admin of successful login
          connection.write('\r\nDirectly logged in as admin. Welcome!\r\n\r\n');
          
          // Execute the "look" command to help admin orient
          setTimeout(() => {
            processInput(client, 'look');
          }, 500);
        } else {
          // This should never happen as we check for admin at startup
          systemLogger.error('Failed to load admin user data for direct login.');
          connection.write('Error loading admin user data. Disconnecting.\r\n');
          connection.end();
        }
      }, 1000);
    }
  } else {
    // Normal connection flow
    systemLogger.info(`TELNET client connected: ${socket.remoteAddress}`);
    
    // Create our custom connection wrapper
    const connection = new TelnetConnection(socket);
    
    // TelnetConnection class now handles all the TELNET negotiation
    setupClient(connection);
    
    // Track total connections
    serverStats.totalConnections++;
  }
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
    isBeingMonitored: false, // Add default for monitoring flag
    isInputBlocked: false // Add default for input blocking flag
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
    systemLogger.info(`Client disconnected: ${clientId}`);
    handleClientDisconnect(client, clientId, true);
  });
  
  // Handle connection errors similarly
  connection.on('error', (err) => {
    systemLogger.error(`Error with client ${clientId}: ${err.message}`, { error: err });
    handleClientDisconnect(client, clientId, false);
  });

  connection.on('close', () => {
    systemLogger.info(`Client disconnected: ${clientId}`);
    handleClientDisconnect(client, clientId, true);
  });
}

// New function to handle client disconnection cleanup
function handleClientDisconnect(client: ConnectedClient, clientId: string, broadcastMessage: boolean): void {
  const disconnectingUsername = client.user?.username;

  // Check if client was being monitored and handle properly
  if (client.isBeingMonitored) {
    systemLogger.info(`User ${disconnectingUsername || clientId} disconnected while being monitored - properly terminating monitoring session`);
    
    // For web-based monitoring (admin panel)
    if (client.adminMonitorSocket) {
      // Notify the admin that the user has disconnected
      client.adminMonitorSocket.emit('monitor-ended', { 
        message: `The user ${disconnectingUsername || 'Unknown'} has disconnected. Monitoring session ended.` 
      });
      
      // Send a final output message to the admin's terminal for visual feedback
      client.adminMonitorSocket.emit('monitor-output', { 
        data: `\r\n\x1b[31mUser has disconnected. Monitoring session ended.\x1b[0m\r\n` 
      });
      
      // Clean up monitoring state in client
      client.isBeingMonitored = false;
      client.isInputBlocked = false;
      
      // Force disconnect the admin socket from this specific monitoring session
      if (client.adminMonitorSocket.connected) {
        try {
          // Emit a forced disconnect event to the admin client
          client.adminMonitorSocket.emit('force-disconnect', {
            message: 'User disconnected from server'
          });
        } catch (error) {
          systemLogger.error(`Error notifying admin of disconnection: ${error}`);
        }
      }
      
      // Clear the admin socket reference
      client.adminMonitorSocket = undefined;
    } else {
      // For console-based monitoring, we need to clean up the monitoring state
      client.isBeingMonitored = false;
      client.isInputBlocked = false;
      
      // For console monitoring, log a clear message
      systemLogger.info(`User ${disconnectingUsername || clientId} disconnected during console monitoring session.`);
      
      // Output a message to the console (this will appear in the admin's console)
      console.log(`\r\n\x1b[31mUser ${disconnectingUsername || 'Unknown'} has disconnected. Monitoring session ended.\x1b[0m\r\n`);
      
      // Since we're not in the monitorKeyHandler scope, we can't directly access closeMonitoring
      // Instead, we'll emit a 'c' key to the process.stdin, which will be caught by any active monitorKeyHandler
      try {
        // Only attempt to simulate the keypress if we're in a TTY environment
        if (process.stdin.isTTY) {
          process.stdin.emit('data', 'c');
        }
      } catch (error) {
        systemLogger.error(`Error attempting to end console monitoring session: ${error}`);
      }
    }
  }
  
  // Check if client was in a pending transfer
  if (client.user && client.stateData.waitingForTransfer) {
    userManager.cancelTransfer(client.user.username);
  }
  
  // Only unregister if the client is still authenticated
  if (client.user && client.authenticated) {
    // First get the roomManager
    const roomManager = RoomManager.getInstance(clients);
    
    // Then get the combat system instance to clean up any active combat
    const combatSystem = CombatSystem.getInstance(userManager, roomManager);
    
    // End combat for this player if they're in combat
    if (client.user.inCombat) {
      combatSystem.handlePlayerDisconnect(client);
    }
    
    // Remove player from all rooms when they disconnect
    const username = client.user.username;
    roomManager.removePlayerFromAllRooms(username);
    
    // Force disconnect any other clients that might still be using this username
    // This prevents the "two copies of character online" issue
    const userSessionsToCleanup: ConnectedClient[] = [];
    
    // Find any other clients that might have the same username
    clients.forEach((otherClient, otherClientId) => {
      if (otherClientId !== clientId && 
          otherClient.user && 
          otherClient.user.username === username) {
        // Add to our cleanup list
        userSessionsToCleanup.push(otherClient);
      }
    });
    
    // Disconnect any orphaned sessions with the same username
    if (userSessionsToCleanup.length > 0) {
      systemLogger.warn(`Found ${userSessionsToCleanup.length} additional sessions for user ${username}. Cleaning up orphaned sessions.`);
      
      userSessionsToCleanup.forEach(orphanedClient => {
        try {
          // Send a message to any orphaned clients
          orphanedClient.connection.write('\r\n\x1b[31mYour session has been terminated because you have logged in from another location.\x1b[0m\r\n');
          
          // End the connection
          orphanedClient.connection.end();
        } catch (error) {
          systemLogger.error(`Error cleaning up orphaned session: ${error}`);
        }
      });
    }
    
    // Unregister the user session
    userManager.unregisterUserSession(username);
    
    // Notify other users with formatted username if requested
    if (broadcastMessage) {
      const formattedUsername = formatUsername(username);
      broadcastSystemMessage(`${formattedUsername} has left the game.`, client);
    }
  }
  
  // Finally, remove this client from the clients map
  clients.delete(clientId);
}

// Unified handler for client data (both TELNET and WebSocket)
function handleClientData(client: ConnectedClient, data: string): void {
  // Check if input is blocked by an admin - strict implementation
  if (client.isInputBlocked === true && client.authenticated) {
    // Silently block ALL input when input is disabled by admin, including:
    // - Printable characters
    // - Control characters (backspace, enter)
    // - Navigation keys (arrow keys)
    // This prevents any user interaction with the terminal
    
    // Only allow Ctrl+C to work for emergency exit
    if (data === '\u0003') { // Ctrl+C
      return; // Let it pass through for terminal safety
    }
    
    // Block everything else silently, no messages, no processing
    return;
  }
  
  // Start buffering output when user begins typing
  if (client.buffer.length === 0 && !client.isTyping) {
    client.isTyping = true;
  }

  // If the client is in the Snake game state, route all input to the state machine
  if (client.state === ClientStateType.SNAKE_GAME) {
    stateMachine.handleInput(client, data);
    return; // Prevent further processing
  }

  // If the client is moving, don't process input directly
  // Instead, buffer it to be processed after movement completes
  if (client.stateData?.isMoving) {
    // Only buffer if it's not a control character (e.g., backspace)
    if (data === '\r' || data === '\n' || data === '\r\n') {
      // For enter key, if there's something in the buffer, add it to the movement command queue
      if (client.buffer.length > 0) {
        // Initialize the movement command queue if it doesn't exist
        if (!client.stateData.movementCommandQueue) {
          client.stateData.movementCommandQueue = [];
        }
        
        // Add the command to the queue
        client.stateData.movementCommandQueue.push(client.buffer);
        
        // Clear the buffer silently (we don't want to echo during movement)
        client.buffer = '';
        
        // Initialize cursor position if not defined
        if (client.cursorPos === undefined) {
          client.cursorPos = 0;
        } else {
          client.cursorPos = 0;
        }
      }
    } else if (data === '\b' || data === '\x7F') {
      // Handle backspace silently during movement
      if (client.buffer.length > 0) {
        // Initialize cursor position if not defined
        if (client.cursorPos === undefined) {
          client.cursorPos = client.buffer.length;
        }
        
        if (client.cursorPos > 0) {
          client.buffer = client.buffer.slice(0, -1);
          client.cursorPos--;
        }
      }
    } else if (data.length === 1 && !data.startsWith('\u001b')) {
      // Add printable characters to buffer silently (no echo) during movement
      client.buffer += data;
      
      // Initialize cursor position if not defined
      if (client.cursorPos === undefined) {
        client.cursorPos = client.buffer.length;
      } else {
        client.cursorPos = client.buffer.length;
      }
    }
    
    // Don't process anything else during movement
    return;
  }
  
  // Debugging - uncomment if needed
  // console.log('Input data:', data.split('').map(c => c.charCodeAt(0).toString(16)).join(' '));
  
  // Initialize cursor position if not set
  if (client.cursorPos === undefined) {
    client.cursorPos = client.buffer.length;
  }
  
  // Handle Ctrl+U (ASCII code 21) - clear entire input line
  if (data === '\u0015') {
    if (client.buffer.length > 0) {
      // Calculate how many backspaces are needed to clear the current input
      const backspaces = '\b \b'.repeat(client.buffer.length);
      
      // Send backspaces to clear the user's current input
      client.connection.write(backspaces);
      
      // Clear the buffer
      client.buffer = '';
      client.cursorPos = 0;
      
      // If buffer becomes empty, flush any buffered output
      stopBuffering(client);
    }
    return;
  }
  
  // Handle backspace - check for both BS char and DEL char since clients may send either
  if (data === '\b' || data === '\x7F') {
    if (client.buffer.length > 0 && client.cursorPos > 0) {
      if (client.cursorPos === client.buffer.length) {
        // Cursor at the end - simple backspace
        // Remove the last character from the buffer
        client.buffer = client.buffer.slice(0, -1);
        client.cursorPos--;
        
        // Update the terminal display (backspace, space, backspace)
        client.connection.write('\b \b');
      } else {
        // Cursor in the middle - need to redraw the whole line
        const newBuffer = client.buffer.slice(0, client.cursorPos - 1) + client.buffer.slice(client.cursorPos);
        redrawInputLine(client, newBuffer, client.cursorPos - 1);
      }
      
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
    client.cursorPos = 0; // Reset cursor position
    
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
  
  // Handle left arrow (various possible formats)
  if (data === '\u001b[D' || data === '[D' || data === '\u001bOD' || data === 'OD') {
    handleLeftArrow(client);
    return;
  }
  
  // Handle right arrow (various possible formats)
  if (data === '\u001b[C' || data === '[C' || data === '\u001bOC' || data === 'OC') {
    handleRightArrow(client);
    return;
  }

  // Handle Shift+Left Arrow (various possible formats)
  if (data === '\u001b[1;2D' || data === '[1;2D') {
    // Move cursor to the beginning of the input
    if (client.cursorPos > 0) {
      const moveLeft = client.cursorPos;
      client.cursorPos = 0;
      client.connection.write(`\u001b[${moveLeft}D`); // Move cursor to the start
    }
    return;
  }

  // Handle Shift+Right Arrow (various possible formats)
  if (data === '\u001b[1;2C' || data === '[1;2C') {
    // Move cursor to the end of the input
    if (client.cursorPos < client.buffer.length) {
      const moveRight = client.buffer.length - client.cursorPos;
      client.cursorPos = client.buffer.length;
      client.connection.write(`\u001b[${moveRight}C`); // Move cursor to the end
    }
    return;
  }

  // Handle Shift+Up Arrow (various possible formats)
  if (data === '\u001b[1;2A' || data === '[1;2A') {
    // Move to the beginning of the command history
    if (client.user && client.user.commandHistory && client.user.commandHistory.length > 0) {
      client.user.currentHistoryIndex = client.user.commandHistory.length - 1;
      const firstCommand = client.user.commandHistory[0];
      redrawInputLine(client, firstCommand, firstCommand.length);
    }
    return;
  }

  // Handle Shift+Down Arrow (various possible formats)
  if (data === '\u001b[1;2B' || data === '[1;2B') {
    // Move to the end of the command history
    if (client.user && client.user.commandHistory) {
      client.user.currentHistoryIndex = -1;
      const currentCommand = client.user.savedCurrentCommand || '';
      redrawInputLine(client, currentCommand, currentCommand.length);
    }
    return;
  }
  
  // Handle normal input (excluding special sequences)
  if (client.cursorPos === client.buffer.length) {
    // Cursor at the end - simply append
    client.buffer += data;
    client.cursorPos++;
    
    // Check if input should be masked (for password entry)
    if (client.stateData.maskInput) {
      // Show asterisk instead of the actual character
      client.connection.write('*');
    } else {
      // Normal echo of the character
      client.connection.write(data);
    }
  } else {
    // Cursor in the middle - insert and redraw
    const newBuffer = client.buffer.slice(0, client.cursorPos) + data + client.buffer.slice(client.cursorPos);
    
    // If password masking is enabled, we need to redraw with asterisks
    if (client.stateData.maskInput) {
      // Get prompt and create a string of asterisks with the same length as the buffer
      const promptText = getPromptText(client);
      const maskedText = '*'.repeat(newBuffer.length);
      
      // Clear the current line
      client.connection.write('\r\x1B[K');
      
      // Write the prompt and masked text
      client.connection.write(promptText);
      client.connection.write(maskedText);
      
      // Move cursor back to the correct position if needed
      if (client.cursorPos + 1 < newBuffer.length) {
        client.connection.write('\u001b[' + (newBuffer.length - (client.cursorPos + 1)) + 'D');
      }
      
      // Update client state
      client.buffer = newBuffer;
      client.cursorPos = client.cursorPos + 1;
    } else {
      // Normal redraw for non-masked input
      redrawInputLine(client, newBuffer, client.cursorPos + 1);
    }
  }
}

// Redraw the entire input line when making edits in the middle of the line
function redrawInputLine(client: ConnectedClient, newBuffer: string, newCursorPos: number): void {
  const promptText = getPromptText(client);
  
  // Clear the current line using escape sequence
  client.connection.write('\r\x1B[K');
  
  // Write the prompt
  client.connection.write(promptText);
  
  // Write the new buffer content
  client.connection.write(newBuffer);
  
  // If the cursor is not at the end, we need to move it back
  if (newCursorPos < newBuffer.length) {
    // Move cursor back to the right position
    client.connection.write('\u001b[' + (newBuffer.length - newCursorPos) + 'D');
  }
  
  // Update client state
  client.buffer = newBuffer;
  client.cursorPos = newCursorPos;
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
    
    // Update the buffer and cursor position
    client.buffer = historyCommand;
    client.cursorPos = historyCommand.length;
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
  
  // Update the buffer and cursor position
  client.buffer = newCommand;
  client.cursorPos = newCommand.length;
}

// Handle left arrow key press
function handleLeftArrow(client: ConnectedClient): void {
  // Make sure we have a cursor position
  if (client.cursorPos === undefined) {
    client.cursorPos = client.buffer.length;
  }
  
  // Only move cursor if it's not already at the beginning
  if (client.cursorPos > 0) {
    client.cursorPos--;
    
    // Move cursor backward
    client.connection.write('\u001b[D'); // ESC[D is the escape sequence for cursor left
  }
}

// Handle right arrow key press
function handleRightArrow(client: ConnectedClient): void {
  // Make sure we have a cursor position
  if (client.cursorPos === undefined) {
    client.cursorPos = client.buffer.length;
  }
  
  // Only move cursor if it's not already at the end
  if (client.cursorPos < client.buffer.length) {
    client.cursorPos++;
    
    // Move cursor forward
    client.connection.write('\u001b[C'); // ESC[C is the escape sequence for cursor right
  }
}

function processInput(client: ConnectedClient, input: string): void {
  // Command tracking for stats
  serverStats.totalCommands++;
  
  // Trim whitespace from beginning and end of input
  const trimmedInput = input.trim();
  
  // Check for forced transitions (like transfer requests)
  if (client.stateData.forcedTransition) {
    const forcedState = client.stateData.forcedTransition;
    delete client.stateData.forcedTransition;
    stateMachine.transitionTo(client, forcedState);
    return;
  }
  
  // Different handling based on the current state
  if (client.state === ClientStateType.SNAKE_GAME) {
    // When in Snake game, only pass input to the state machine, not to command handler
    stateMachine.handleInput(client, trimmedInput);
  } else if (client.authenticated && 
             client.state !== ClientStateType.CONFIRMATION && 
             client.state !== ClientStateType.TRANSFER_REQUEST) {
    // Process command from authenticated user in normal game states
    commandHandler.handleCommand(client, trimmedInput);
    // Note: CommandHandler now handles displaying the prompt after commands
  } else {
    // Handle authentication via state machine for non-authenticated users
    stateMachine.handleInput(client, trimmedInput);
    
    // Check if client should be disconnected (due to too many failed attempts)
    if (client.stateData.disconnect) {
      setTimeout(() => {
        systemLogger.info(`Disconnecting client due to too many failed password attempts`);
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
      writeFormattedMessageToClient(client, colorize(message + '\r\n', 'bright'));
    }
  });
}

// Modify the writeToClient function to also send output to monitoring admins
// Rename to writeToClientWithMonitoring to avoid conflict with the imported function
function writeToClientWithMonitoring(client: ConnectedClient, data: string): void {
  // Always write to the actual client
  client.connection.write(data);
  
  // If this client is being monitored, also send to the admin
  if (client.isBeingMonitored && client.adminMonitorSocket) {
    client.adminMonitorSocket.emit('monitor-output', { data });
  }
}

// Function to create a 3D boxed message for admin messages
function createAdminMessageBox(message: string): string {
  // Create an array of lines from the message, breaking at proper word boundaries
  const lines = [];
  const words = message.split(' ');
  let currentLine = '';
  
  // Max length for each line inside the box (adjust for box padding)
  const maxLineLength = 50;
  
  for (const word of words) {
    // Check if adding this word would exceed the max line length
    if ((currentLine + ' ' + word).length <= maxLineLength) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      // Add the current line to our lines array and start a new line
      lines.push(currentLine);
      currentLine = word;
    }
  }
  
  // Don't forget to add the last line
  if (currentLine) {
    lines.push(currentLine);
  }
  
  // ANSI color for a bright magenta
  const color = '\x1b[95m';
  const reset = '\x1b[0m';
  
  // Unicode box drawing characters for a 3D effect
  const topLeft = '╔';
  const topRight = '╗';
  const bottomLeft = '╚';
  const bottomRight = '╝';
  const horizontal = '═';
  const vertical = '║';
  
  // Calculate box width based on the longest line
  const boxWidth = Math.max(...lines.map(line => line.length), 'MESSAGE FROM ADMIN:'.length) + 4; // Add padding
  
  // Build the box
  let result = '\r\n'; // Start with a new line
  
  // Top border with 3D effect
  result += color + topLeft + horizontal.repeat(boxWidth - 2) + topRight + reset + '\r\n';
  
  // Add the "MESSAGE FROM ADMIN:" header
  result += color + vertical + reset + ' ' + color + 'MESSAGE FROM ADMIN:' + reset + ' '.repeat(boxWidth - 'MESSAGE FROM ADMIN:'.length - 3) + color + vertical + reset + '\r\n';
  
  // Add a separator line
  result += color + vertical + reset + ' ' + horizontal.repeat(boxWidth - 4) + ' ' + color + vertical + reset + '\r\n';
  
  // Content lines
  for (const line of lines) {
    const padding = ' '.repeat(boxWidth - line.length - 4);
    result += color + vertical + reset + ' ' + line + padding + ' ' + color + vertical + reset + '\r\n';
  }
  
  // Bottom border with 3D effect
  result += color + bottomLeft + horizontal.repeat(boxWidth - 2) + bottomRight + reset + '\r\n';
  
  return result;
}

// Function to create a 3D boxed message for system messages
function createSystemMessageBox(message: string): string {
  // Create an array of lines from the message, breaking at proper word boundaries
  const lines = [];
  const words = message.split(' ');
  let currentLine = '';
  
  // Max length for each line inside the box (adjust for box padding)
  const maxLineLength = 50;
  
  for (const word of words) {
    // Check if adding this word would exceed the max line length
    if ((currentLine + ' ' + word).length <= maxLineLength) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      // Add the current line to our lines array and start a new line
      lines.push(currentLine);
      currentLine = word;
    }
  }
  
  // Don't forget to add the last line
  if (currentLine) {
    lines.push(currentLine);
  }
  
  // ANSI color for a bright cyan
  const color = '\x1b[96m';
  const reset = '\x1b[0m';
  
  // Unicode box drawing characters for a 3D effect
  const topLeft = '╔';
  const topRight = '╗';
  const bottomLeft = '╚';
  const bottomRight = '╝';
  const horizontal = '═';
  const vertical = '║';
  
  // Calculate box width based on the longest line
  const boxWidth = Math.max(...lines.map(line => line.length), 'SYSTEM MESSAGE:'.length) + 4; // Add padding
  
  // Build the box
  let result = '\r\n'; // Start with a new line
  
  // Top border with 3D effect
  result += color + topLeft + horizontal.repeat(boxWidth - 2) + topRight + reset + '\r\n';
  
  // Add the "SYSTEM MESSAGE:" header
  result += color + vertical + reset + ' ' + color + 'SYSTEM MESSAGE:' + reset + ' '.repeat(boxWidth - 'SYSTEM MESSAGE:'.length - 3) + color + vertical + reset + '\r\n';
  
  // Add a separator line
  result += color + vertical + reset + ' ' + horizontal.repeat(boxWidth - 4) + ' ' + color + vertical + reset + '\r\n';
  
  // Content lines
  for (const line of lines) {
    const padding = ' '.repeat(boxWidth - line.length - 4);
    result += color + vertical + reset + ' ' + line + padding + ' ' + color + vertical + reset + '\r\n';
  }
  
  // Bottom border with 3D effect
  result += color + bottomLeft + horizontal.repeat(boxWidth - 2) + bottomRight + reset + '\r\n';
  
  return result;
}

// Function to start a monitoring session for a user
function startMonitoringSession(
  targetClient: ConnectedClient, 
  targetClientId: string, 
  username: string, 
  monitorConsoleTransport: winston.transport | null, 
  mainKeyListener: (key: string) => void
): void {
  let userSudoEnabled = false; // Track if sudo access is enabled
  
  console.log('=== Monitoring Session Controls ===');
  console.log('a: Send admin command');
  console.log('s: Toggle stop user input');
  console.log('m: Send admin message');
  console.log('k: Kick user');
  console.log('u: Toggle sudo access');
  console.log('c: Cancel monitoring');
  console.log('Ctrl+C: Cancel monitoring');
  console.log('===============================\n');
  
  // Flag the client as being monitored
  targetClient.isBeingMonitored = true;
  
  // Function to close the monitoring session
  const closeMonitoring = () => {
    // Remove monitoring status
    targetClient.isBeingMonitored = false;
    
    // Ensure user input is re-enabled
    if (targetClient.isInputBlocked) {
      targetClient.isInputBlocked = false;
      targetClient.connection.write('\r\n\x1b[33mYour input ability has been restored.\x1b[0m\r\n');
      
      // Redisplay the prompt for the user
      const promptText = getPromptText(targetClient);
      targetClient.connection.write(promptText);
      if (targetClient.buffer.length > 0) {
        targetClient.connection.write(targetClient.buffer);
      }
    }
    
    // Remove sudo access if it was granted
    if (userSudoEnabled && targetClient.user) {
      // Use the static activeAdmins Set directly since setUserAdminStatus doesn't exist
      (SudoCommand as any).activeAdmins.delete(targetClient.user.username.toLowerCase());
      systemLogger.info(`Removed temporary sudo access from user: ${username}`);
    }
    
    // Clean up console and event listeners
    console.log('\nMonitoring session ended.');
    
    // Restore console logging
    if (monitorConsoleTransport) {
      systemLogger.add(monitorConsoleTransport);
      systemLogger.info('Console logging restored. Monitoring session ended.');
    }
    
    // Restore the main key listener
    process.stdin.removeAllListeners('data');
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', mainKeyListener);
  };
  
  // Create a hook to intercept and display client output for the admin
  const originalWrite = targetClient.connection.write;
  targetClient.connection.write = function(data) {
    // Call the original write function
    originalWrite.call(this, data);
    
    // Also write to the console
    process.stdout.write(data);
    
    // Return the original result
    return true;
  };
  
  // Set up handler for monitoring session keys
  const monitorKeyHandler = (key: string) => {
    // Handle Ctrl+C or 'c' to cancel monitoring
    if (key === '\u0003' || key.toLowerCase() === 'c') {
      // Restore the original write function
      targetClient.connection.write = originalWrite;
      
      // Close the monitoring session
      closeMonitoring();
      return;
    }
    
    // Handle 's' to toggle blocking user input
    if (key.toLowerCase() === 's') {
      // Toggle the input blocking state
      targetClient.isInputBlocked = !targetClient.isInputBlocked;
      
      // Notify admin of the change
      console.log(`\nUser input ${targetClient.isInputBlocked ? 'disabled' : 'enabled'}.`);
      
      // Notify the user
      if (targetClient.isInputBlocked) {
        targetClient.connection.write('\r\n\x1b[33mAn admin has temporarily disabled your input ability.\x1b[0m\r\n');
      } else {
        targetClient.connection.write('\r\n\x1b[33mAn admin has re-enabled your input ability.\x1b[0m\r\n');
      }
      
      // Re-display the prompt for the user
      const promptText = getPromptText(targetClient);
      targetClient.connection.write(promptText);
      if (targetClient.buffer.length > 0) {
        targetClient.connection.write(targetClient.buffer);
      }
      
      return;
    }
    
    // Handle 'a' to send admin command
    if (key.toLowerCase() === 'a') {
      // Temporarily remove the key handler to allow command input
      process.stdin.removeListener('data', monitorKeyHandler);
      
      // Set input mode to line input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      // Create readline interface for command input
      console.log('\n=== Admin Command ===');
      console.log('Enter command to execute as user (Ctrl+C to cancel):');
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      // Get the command
      rl.question('> ', (command) => {
        rl.close();
        
        if (command.trim()) {
          console.log(`Executing command: ${command}`);
          
          // Execute the command as the user
          
          // If the user is currently typing something, clear their input first
          if (targetClient.buffer.length > 0) {
            // Get the current prompt length
            const promptText = getPromptText(targetClient);
            const promptLength = promptText.length;
            
            // Clear the entire line and return to beginning
            targetClient.connection.write('\r' + ' '.repeat(promptLength + targetClient.buffer.length) + '\r');
            
            // Redisplay the prompt (since we cleared it as well)
            targetClient.connection.write(promptText);
            
            // Clear the buffer
            targetClient.buffer = '';
          }
          
          // Notify user of admin command
          targetClient.connection.write(`\r\n\x1b[33mAdmin executed: ${command}\x1b[0m\r\n`);
          
          // Execute the command directly
          processInput(targetClient, command);
        } else {
          console.log('Command was empty, not executing.');
        }
        
        // Restore raw mode and the key handler
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.on('data', monitorKeyHandler);
      });
      
      return;
    }
    
    // Handle 'm' to send admin message
    if (key.toLowerCase() === 'm') {
      // Temporarily remove the key handler to allow message input
      process.stdin.removeListener('data', monitorKeyHandler);
      
      // Set input mode to line input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      // Create readline interface for message input
      console.log('\n=== Admin Message ===');
      console.log('Enter message to send to user (Ctrl+C to cancel):');
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      // Get the message
      rl.question('> ', (message) => {
        rl.close();
        
        if (message.trim()) {
          console.log(`Sending message to user: ${message}`);
          
          // Create a boxed message
          const boxedMessage = createAdminMessageBox(message);
          
          // Send the message to the user
          writeMessageToClient(targetClient, boxedMessage);
          
          // Log the admin message
          systemLogger.info(`Admin sent message to user ${username}: ${message}`);
        } else {
          console.log('Message was empty, not sending.');
        }
        
        // Restore raw mode and the key handler
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.on('data', monitorKeyHandler);
      });
      
      return;
    }
    
    // Handle 'k' to kick the user
    if (key.toLowerCase() === 'k') {
      // Ask for confirmation
      // Temporarily remove the key handler to allow confirmation input
      process.stdin.removeListener('data', monitorKeyHandler);
      
      // Set input mode to line input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      
      // Create readline interface for confirmation
      console.log(`\n=== Kick User ===`);
      console.log(`Are you sure you want to kick ${username}? (y/n)`);
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      // Get confirmation
      rl.question('> ', (answer) => {
        rl.close();
        
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          console.log(`Kicking user: ${username}`);
          
          // Notify the user they're being kicked
          targetClient.connection.write('\r\n\x1b[31mYou are being disconnected by an administrator.\x1b[0m\r\n');
          
          // Log the kick
          systemLogger.info(`Admin kicked user: ${username}`);
          
          // Restore the original write function before disconnecting
          targetClient.connection.write = originalWrite;
          
          // Disconnect the user (with slight delay to ensure they see the message)
          setTimeout(() => {
            targetClient.connection.end();
          }, 1000);
          
          // Close the monitoring session
          closeMonitoring();
          return;
        } else {
          console.log('Kick cancelled.');
          
          // Restore raw mode and the key handler
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();
          process.stdin.on('data', monitorKeyHandler);
        }
      });
      
      return;
    }
    
    // Handle 'u' to toggle sudo access
    if (key.toLowerCase() === 'u') {
      if (!targetClient.user) {
        console.log('\nCannot grant sudo access: user not authenticated.');
        return;
      }
      
      // Toggle sudo access
      userSudoEnabled = !userSudoEnabled;
      
      if (userSudoEnabled) {
        // Grant temporary sudo access using SudoCommand system
        (SudoCommand as any).activeAdmins.add(targetClient.user.username.toLowerCase());
        console.log(`\nGranted temporary sudo access to ${username}.`);
        targetClient.connection.write('\r\n\x1b[33mAn admin has granted you temporary sudo access.\x1b[0m\r\n');
        
        // Log the action
        systemLogger.info(`Admin granted temporary sudo access to user: ${username}`);
      } else {
        // Remove sudo access using SudoCommand system
        // Use the static activeAdmins Set directly since setUserAdminStatus doesn't exist
        (SudoCommand as any).activeAdmins.delete(targetClient.user.username.toLowerCase());
        console.log(`\nRemoved sudo access from ${username}.`);
        targetClient.connection.write('\r\n\x1b[33mYour temporary sudo access has been revoked.\x1b[0m\r\n');
        
        // Log the action
        systemLogger.info(`Admin removed sudo access from user: ${username}`);
      }
      
      // Re-display the prompt for the user
      const promptText = getPromptText(targetClient);
      targetClient.connection.write(promptText);
      if (targetClient.buffer.length > 0) {
        targetClient.connection.write(targetClient.buffer);
      }
      
      return;
    }
  };
  
  // Start listening for admin key presses
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', monitorKeyHandler);
  
  // Log the monitoring session
  systemLogger.info(`Console admin started monitoring user: ${username}`);
}

// After gameTimerManager initialization, set up idle timeout checker
const IDLE_CHECK_INTERVAL = 60000; // Check for idle clients every minute

// Function to check for and disconnect idle clients
function checkForIdleClients() {
  // Load the current configuration to get the idle timeout
  const config = AdminApi.loadMUDConfig();
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
      systemLogger.debug(`Skipping idle check for monitored client: ${client.user?.username || 'anonymous'}`);
      return;
    }
    
    // Calculate how long the client has been idle
    const idleTime = now - client.lastActivity;
    
    // If client has exceeded the idle timeout
    if (idleTime > idleTimeoutMs) {
      systemLogger.info(`Client ${clientId} idle for ${Math.floor(idleTime / 1000)}s, disconnecting (timeout: ${idleTimeoutMinutes}m)`);
      
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

// Check for admin user on startup and create if needed
async function checkAndCreateAdminUser(): Promise<boolean> {
  systemLogger.info('Checking for admin user...');
  
  // Check if admin user exists
  if (!userManager.userExists('admin')) {
    systemLogger.warn('No admin user found. Creating admin account...');
    systemLogger.warn('Server startup will halt until admin setup is complete.');
    
    let adminCreated = false;
    
    // Keep trying until the admin is successfully created
    while (!adminCreated) {
      try {
        // Use custom password input that masks the password
        const password = await readPasswordFromConsole('Enter password for new admin user: ');
        
        // Validate password
        if (password.length < 6) {
          systemLogger.warn('Password must be at least 6 characters long. Please try again.');
          continue; // Skip the rest of this iteration and try again
        }
        
        // Confirm password with masking
        const confirmPassword = await readPasswordFromConsole('Confirm password: ');
        
        // Check if passwords match
        if (password !== confirmPassword) {
          systemLogger.warn('Passwords do not match. Please try again.');
          continue; // Skip the rest of this iteration and try again
        }
        
        // Create admin user
        const success = userManager.createUser('admin', password);
        
        if (success) {
          systemLogger.info('Admin user created successfully!');
          
          // Create admin directory if it doesn't exist
          const adminDir = path.join(DATA_DIR, 'admin');
          if (!fs.existsSync(adminDir)) {
            fs.mkdirSync(adminDir, { recursive: true });
          }
          
          // Create admin.json file with admin user as super admin
          const adminFilePath = path.join(DATA_DIR, 'admin.json');
          const adminData = {
            admins: [
              {
                username: 'admin',
                level: AdminLevel.SUPER,
                addedBy: 'system',
                addedOn: new Date().toISOString()
              }
            ]
          };
          
          try {
            fs.writeFileSync(adminFilePath, JSON.stringify(adminData, null, 2), 'utf8');
            systemLogger.info('Admin privileges configured.');
            adminCreated = true; // Mark as successfully created so we exit the loop
          } catch (error) {
            systemLogger.error('Error creating admin.json file:', error);
            systemLogger.warn('Failed to create admin configuration. Please try again.');
            // Continue the loop to try again
          }
        } else {
          systemLogger.warn('Error creating admin user. Please try again.');
          // Continue the loop to try again
        }
      } catch (error) {
        systemLogger.error('Error during admin setup:', error);
        systemLogger.warn('An error occurred during setup. Please try again.');
        // Continue the loop to try again
      }
    }
    
    return true; // Return true since we don't exit the loop until admin is created
  } else {
    systemLogger.info('Admin user already exists.');
    
    // Ensure admin.json exists with the admin user
    const adminFilePath = path.join(DATA_DIR, 'admin.json');
    if (!fs.existsSync(adminFilePath)) {
      systemLogger.warn('Creating admin.json file...');
      
      // Create admin directory if it doesn't exist
      const adminDir = path.join(DATA_DIR, 'admin');
      if (!fs.existsSync(adminDir)) {
        fs.mkdirSync(adminDir, { recursive: true });
      }
      
      // Create admin.json with admin user as super admin
      const adminData = {
        admins: [
          {
            username: 'admin',
            level: AdminLevel.SUPER,
            addedBy: 'system',
            addedOn: new Date().toISOString()
          }
        ]
      };
      
      try {
        fs.writeFileSync(adminFilePath, JSON.stringify(adminData, null, 2), 'utf8');
        systemLogger.info('Admin privileges configured.');
      } catch (error) {
        systemLogger.error('Error creating admin.json file:', error);
        return false;
      }
    }
    return true;
  }
}

// Function to read password with masking characters
function readPasswordFromConsole(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    // Save the current settings
    const originalStdinIsTTY = stdin.isTTY;
    
    // Write the prompt first
    stdout.write(colorize(prompt, 'green'));
    
    let password = '';
    
    // Create a raw mode handler function
    const onData = (key: Buffer) => {
      const keyStr = key.toString();
      
      // Handle Ctrl+C
      if (keyStr === '\u0003') {
        stdout.write('\n');
        if (originalStdinIsTTY) {
          stdin.setRawMode(false);
        }
        stdin.removeListener('data', onData);
        process.exit(1);
      }
      
      // Handle Enter key
      if (keyStr === '\r' || keyStr === '\n') {
        stdout.write('\n');
        if (originalStdinIsTTY) {
          stdin.setRawMode(false);
        }
        stdin.removeListener('data', onData);
        resolve(password);
        return;
      }
      
      // Handle backspace
      if (keyStr === '\b' || keyStr === '\x7F') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b'); // erase the last character
        }
        return;
      }
      
      // Ignore non-printable characters
      if (keyStr.length === 1 && keyStr.charCodeAt(0) >= 32 && keyStr.charCodeAt(0) <= 126) {
        // Add to password and show asterisk
        password += keyStr;
        stdout.write('*');
      }
    };
    
    // Enable raw mode to prevent terminal echo
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    // Listen for keypress events
    stdin.on('data', onData);
  });
}

// Define the path to the data directory
const DATA_DIR = path.join(__dirname, '..', 'data');

// Function to end the local client/admin session and restore logging
function endLocalSession() {
  if (!isLocalClientConnected) return;

  systemLogger.info('Ending local session...');

  // Clean up socket
  if (localClientSocket) {
    localClientSocket.removeAllListeners();
    localClientSocket.destroy();
    localClientSocket = null;
  }

  // Restore console logging
  if (originalConsoleTransport && !systemLogger.transports.includes(originalConsoleTransport)) {
    systemLogger.add(originalConsoleTransport);
    systemLogger.info('Console logging restored.');
    originalConsoleTransport = null; // Clear stored transport
  }

  // Remove the specific listener for the session
  process.stdin.removeAllListeners('data');

  // Set stdin back to normal mode (important!)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause(); // Allow node to exit if this was the only thing keeping it alive
  }

  isLocalClientConnected = false;
  isAdminLoginPending = false; // Ensure flag is reset
  console.log("\nLocal session ended. Log output resumed.");

  // Re-enable the listener for the keys
  setupKeyListener();
}

// Function to pause logging and prepare for local connection
function prepareLocalSessionStart() {
  if (isLocalClientConnected || !process.stdin.isTTY) return false;

  isLocalClientConnected = true;
  systemLogger.info("Attempting to start local session...");

  // Pause the main key listener
  process.stdin.removeAllListeners('data');

  // Find and remove the console transport
  const consoleTransport = systemLogger.transports.find(t => t instanceof winston.transports.Console);
  if (consoleTransport) {
    originalConsoleTransport = consoleTransport;
    systemLogger.remove(consoleTransport);
    console.log("\nConsole logging paused. Connecting to local server...");
    console.log("Press Ctrl+C to disconnect the local client and resume logging.");
    console.log('========================================');
    console.log('       CONNECTING LOCALLY...');
    console.log('========================================');
  } else {
    console.log("\nCould not find console transport to pause logging.");
  }
  return true;
}

// Function to start the standard local client session
function startLocalClientSession(port: number) {
  if (!prepareLocalSessionStart()) return;

  localClientSocket = new net.Socket();

  // Set up listeners for the new socket
  localClientSocket.on('data', (data) => {
    process.stdout.write(data); // Write server output directly to console
  });

  localClientSocket.on('close', () => {
    console.log('\nConnection to local server closed.');
    endLocalSession();
  });

  localClientSocket.on('error', (err) => {
    console.error(`\nLocal connection error: ${err.message}`);
    endLocalSession();
  });

  // Connect to the server
  localClientSocket.connect(port, 'localhost', () => {
    systemLogger.info(`Local client connected to localhost:${port}`);
    console.log(`\nConnected to MUD server on port ${port}.`);

    // Set up stdin for the session AFTER connection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true); // Need raw mode for direct key capture
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      process.stdin.on('data', (key) => {
        // Ctrl+C check specifically for the local client session
        if (key.toString() === '\u0003') {
          console.log('\nCtrl+C detected. Disconnecting local client...');
          endLocalSession();
        } else if (localClientSocket && localClientSocket.writable) {
          localClientSocket.write(key); // Send other keys to the server
        }
      });
    }
  });
}

// Function to start the direct admin session
function startLocalAdminSession(port: number) {
  if (!prepareLocalSessionStart()) return;

  isAdminLoginPending = true; // Set the flag BEFORE connecting
  localClientSocket = new net.Socket();

  // Set up listeners (same as standard local client)
  localClientSocket.on('data', (data) => {
    process.stdout.write(data);
  });

  localClientSocket.on('close', () => {
    console.log('\nAdmin session connection closed.');
    endLocalSession();
  });

  localClientSocket.on('error', (err) => {
    console.error(`\nLocal admin connection error: ${err.message}`);
    isAdminLoginPending = false; // Reset flag on error too
    endLocalSession();
  });

  // Connect to the server
  localClientSocket.connect(port, 'localhost', () => {
    systemLogger.info(`Local admin client connected to localhost:${port}`);
    console.log(`\nConnected directly as admin on port ${port}.`);

    // Set up stdin (same as standard local client)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      process.stdin.on('data', (key) => {
        if (key.toString() === '\u0003') {
          console.log('\nCtrl+C detected. Disconnecting admin session...');
          endLocalSession();
        } else if (localClientSocket && localClientSocket.writable) {
          localClientSocket.write(key);
        }
      });
    }
  });
}

// Add shutdown timer state variables
let shutdownTimerActive = false;
let shutdownTimer: NodeJS.Timeout | null = null;
let shutdownMinutes = 5;

// Function to set up the initial key listener
function setupKeyListener() {
  if (process.stdin.isTTY && !isLocalClientConnected) {
    systemLogger.info(`Press 'c' to connect locally, 'a' for admin session, 'u' to list users, 'm' to monitor user, 's' for system message, 'q' to shutdown.`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const keyListener = (key: string) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'c') {
        process.stdin.removeListener('data', keyListener);
        startLocalClientSession(actualTelnetPort);
      } else if (lowerKey === 'a') {
        process.stdin.removeListener('data', keyListener);
        startLocalAdminSession(actualTelnetPort);
      } else if (lowerKey === 'u') {
        // List all connected users
        console.log("\n=== Connected Users ===");
        let userCount = 0;
        
        clients.forEach(client => {
          if (client.authenticated && client.user) {
            const idleTime = Math.floor((Date.now() - client.lastActivity) / 1000);
            console.log(`${client.user.username}: connected for ${Math.floor((Date.now() - client.connectedAt) / 1000)}s, idle for ${idleTime}s`);
            userCount++;
          }
        });
        
        if (userCount === 0) {
          console.log("No authenticated users currently connected.");
        }
        console.log(`Total connections: ${clients.size}`);
        console.log("======================\n");
      } else if (lowerKey === 'm') {
        // Monitor a user session
        process.stdin.removeListener('data', keyListener);
        
        // Pause console logging
        let monitorConsoleTransport: winston.transport | null = null;
        const consoleTransport = systemLogger.transports.find(t => t instanceof winston.transports.Console);
        if (consoleTransport) {
          monitorConsoleTransport = consoleTransport;
          systemLogger.remove(consoleTransport);
          console.log("\nConsole logging paused. Starting user monitoring...");
        }
        
        // Get authenticated users for monitoring
        const authenticatedUsers: string[] = [];
        clients.forEach((client => {
          if (client.authenticated && client.user) {
            authenticatedUsers.push(client.user.username);
          }
        }));
        
        if (authenticatedUsers.length === 0) {
          console.log("\n=== Monitor User ===");
          console.log("No authenticated users available to monitor.");
          
          // Restore console logging
          if (monitorConsoleTransport) {
            systemLogger.add(monitorConsoleTransport);
            systemLogger.info('Console logging restored.');
          }
          
          // Restore raw mode and key listener
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();
          process.stdin.on('data', keyListener);
          return;
        }
        
        console.log("\n=== Monitor User ===");
        
        // Set up user selection menu
        let selectedIndex = 0;
        
        // Function to display the user selection menu
        const displayUserSelectionMenu = () => {
          // Display list of connected users with the selected one highlighted
          for (let i = 0; i < authenticatedUsers.length; i++) {
            process.stdout.write(`${i+1}. ${authenticatedUsers[i]}\n`);
          }
          
          // Display the selection prompt with highlighted username
          process.stdout.write(`\rWhich user will you monitor? `);
          
          // Add background highlight to selected user
          process.stdout.write(`\x1b[47m\x1b[30m${authenticatedUsers[selectedIndex]}\x1b[0m`);
        };
        
        // Display the initial menu
        displayUserSelectionMenu();
        
        // Handle user selection
        const userSelectionHandler = (selectionKey: string) => {
          // Handle Ctrl+C - cancel and return to main menu
          if (selectionKey === '\u0003') {
            console.log('\n\nUser monitoring cancelled.');
            
            // Restore console logging
            if (monitorConsoleTransport) {
              systemLogger.add(monitorConsoleTransport);
              systemLogger.info('Console logging restored.');
            }
            
            // Restore raw mode and key listener
            process.stdin.removeListener('data', userSelectionHandler);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
            }
            process.stdin.resume();
            process.stdin.on('data', keyListener);
            return;
          }
          
          // Handle arrow keys for selection
          if (selectionKey === '\u001b[A' || selectionKey === '[A' || selectionKey === '\u001bOA' || selectionKey === 'OA') {
            // Up arrow - move selection up
            selectedIndex = (selectedIndex > 0) ? selectedIndex - 1 : authenticatedUsers.length - 1;
            
            // Clear the line and redraw
            process.stdout.write('\r\x1B[K'); // Clear the line
            process.stdout.write(`Which user will you monitor? \x1b[47m\x1b[30m${authenticatedUsers[selectedIndex]}\x1b[0m`);
          }
          else if (selectionKey === '\u001b[B' || selectionKey === '[B' || selectionKey === '\u001bOB' || selectionKey === 'OB') {
            // Down arrow - move selection down
            selectedIndex = (selectedIndex < authenticatedUsers.length - 1) ? selectedIndex + 1 : 0;
            
            // Clear the line and redraw
            process.stdout.write('\r\x1B[K'); // Clear the line
            process.stdout.write(`Which user will you monitor? \x1b[47m\x1b[30m${authenticatedUsers[selectedIndex]}\x1b[0m`);
          }
          // Handle Enter - start monitoring selected user
          else if (selectionKey === '\r' || selectionKey === '\n') {
            const selectedUsername = authenticatedUsers[selectedIndex];
            console.log(`\n\nStarting monitoring session for user: ${selectedUsername}\n`);
            
            // Find the client object for the selected user
            let targetClient: ConnectedClient | undefined;
            let targetClientId: string | undefined;
            
            clients.forEach((client, clientId) => {
              if (client.authenticated && client.user && client.user.username === selectedUsername) {
                targetClient = client;
                targetClientId = clientId;
              }
            });
            
            if (!targetClient || !targetClientId) {
              console.log(`\nERROR: Could not find client for user ${selectedUsername}`);
              
              // Restore console logging
              if (monitorConsoleTransport) {
                systemLogger.add(monitorConsoleTransport);
                systemLogger.info('Console logging restored.');
              }
              
              // Restore raw mode and key listener
              process.stdin.removeListener('data', userSelectionHandler);
              if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
              }
              process.stdin.resume();
              process.stdin.on('data', keyListener);
              return;
            }
            
            // Remove the user selection handler
            process.stdin.removeListener('data', userSelectionHandler);
            
            // Start the monitoring session
            startMonitoringSession(targetClient, targetClientId, selectedUsername, monitorConsoleTransport, keyListener);
          }
        };
        
        // Listen for user selection input
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.on('data', userSelectionHandler);
      } else if (lowerKey === 's') {
        // Remove the key listener temporarily
        process.stdin.removeListener('data', keyListener);
        
        // Pause console logging temporarily like we do for local client sessions
        let messageConsoleTransport: winston.transport | null = null;
        const consoleTransport = systemLogger.transports.find(t => t instanceof winston.transports.Console);
        if (consoleTransport) {
          messageConsoleTransport = consoleTransport;
          systemLogger.remove(consoleTransport);
          console.log("\nConsole logging paused. Enter your system message:");
        }
        
        // Temporarily remove raw mode to get text input
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        
        console.log("\n=== System Message ===");
        console.log("Enter message to broadcast to all users (press Enter when done):");
        
        // Create a readline interface for getting user input
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        // Get the system message
        rl.question('> ', (message) => {
          rl.close();
          
          if (message.trim()) {
            console.log("\nSending system message to all users...");
            
            // Create the boxed system message
            const boxedMessage = createSystemMessageBox(message);
            
            // Send to all connected users
            let sentCount = 0;
            clients.forEach(client => {
              if (client.authenticated) {
                writeMessageToClient(client, boxedMessage);
                sentCount++;
              }
            });
            
            console.log(`Message sent to ${sentCount} users.`);
            
            // Log after we restore the transport so it will appear in the log file
            if (messageConsoleTransport) {
              systemLogger.add(messageConsoleTransport);
              systemLogger.info('Console logging restored.');
              systemLogger.info(`System message broadcast: "${message}"`);
            } else {
              systemLogger.info(`System message broadcast: "${message}"`);
            }
          } else {
            console.log("Message was empty, not sending.");
            
            // Restore console logging
            if (messageConsoleTransport) {
              systemLogger.add(messageConsoleTransport);
              systemLogger.info('Console logging restored.');
            }
          }
          
          // Restore raw mode and key listener
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();
          process.stdin.on('data', keyListener);
          
          // Display options again
          console.log(); // Add a blank line for better readability
          systemLogger.info(`Press 'c' to connect locally, 'a' for admin session, 'u' to list users, 'm' to monitor user, 's' for system message, 'q' to shutdown.`);
        });
      } else if (lowerKey === 'q') {
        // Rather than immediate shutdown, show shutdown options
        process.stdin.removeListener('data', keyListener);
        
        // Pause console logging
        let shutdownConsoleTransport: winston.transport | null = null;
        const consoleTransport = systemLogger.transports.find(t => t instanceof winston.transports.Console);
        if (consoleTransport) {
          shutdownConsoleTransport = consoleTransport;
          systemLogger.remove(consoleTransport);
        }
        
        console.log("\n=== Shutdown Options ===");
        console.log("  q: Shutdown immediately");
        console.log("  m: Shutdown with message");
        console.log("  t: Shutdown timer");
        // Show abort option only if a shutdown timer is active
        if (shutdownTimerActive && shutdownTimer) {
          console.log("  a: Abort current shutdown");
        }
        console.log("  c: Cancel");
        
        // Create a special key handler for the shutdown menu
        const shutdownMenuHandler = (shutdownKey: string) => {
          const shutdownOption = shutdownKey.toLowerCase();
          
          if (shutdownOption === 'q') {
            // Immediate shutdown - original behavior
            console.log("\nShutting down server by request...");
            process.kill(process.pid, 'SIGINT');
          } 
          else if (shutdownOption === 't') {
            // Remove the shutdown menu handler
            process.stdin.removeListener('data', shutdownMenuHandler);
            
            // Set initial timer value
            shutdownMinutes = 5;
            
            // Show timer input
            showShutdownTimerPrompt(shutdownMinutes);
            
            // Handle timer value changes
            const timerInputHandler = (timerKey: string) => {
              if (timerKey === '\u0003') {
                // Ctrl+C cancels and returns to regular operation
                cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
              }
              else if (timerKey.toLowerCase() === 'c') {
                // Cancel timer
                cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
              }
              else if (timerKey === '\r' || timerKey === '\n') {
                // Enter confirms the timer
                process.stdin.removeListener('data', timerInputHandler);
                
                // Start the shutdown timer
                startShutdownTimer(shutdownMinutes);
                
                // Restore logging and main key listener
                if (shutdownConsoleTransport) {
                  systemLogger.add(shutdownConsoleTransport);
                  systemLogger.info(`Console logging restored. Server will shutdown in ${shutdownMinutes} minutes.`);
                }
                
                // Restore regular key listener
                process.stdin.on('data', keyListener);
                if (process.stdin.isTTY) {
                  process.stdin.setRawMode(true);
                }
              }
              // Handle arrow keys for adjusting the time value
              else if (timerKey === '\u001b[A' || timerKey === '[A' || timerKey === '\u001bOA' || timerKey === 'OA') {
                // Up arrow - increment by 1
                shutdownMinutes = Math.max(1, shutdownMinutes + 1);
                showShutdownTimerPrompt(shutdownMinutes);
              }
              else if (timerKey === '\u001b[B' || timerKey === '[B' || timerKey === '\u001bOB' || timerKey === 'OB') {
                // Down arrow - decrement by 1
                shutdownMinutes = Math.max(1, shutdownMinutes - 1);
                showShutdownTimerPrompt(shutdownMinutes);
              }
              else if (timerKey === '\u001b[1;2A' || timerKey === '[1;2A') {
                // Shift+Up arrow - increment by 10
                shutdownMinutes = Math.max(1, shutdownMinutes + 10);
                showShutdownTimerPrompt(shutdownMinutes);
              }
              else if (timerKey === '\u001b[1;2B' || timerKey === '[1;2B') {
                // Shift+Down arrow - decrement by 10
                shutdownMinutes = Math.max(1, shutdownMinutes - 10);
                showShutdownTimerPrompt(shutdownMinutes);
              }
            };
            
            // Listen for timer input
            process.stdin.on('data', timerInputHandler);
          }
          else if (shutdownOption === 'm') {
            // Remove the shutdown menu handler
            process.stdin.removeListener('data', shutdownMenuHandler);
            
            // Temporarily remove raw mode to get text input
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(false);
            }
            
            console.log("\n=== Shutdown with Message ===");
            console.log("Enter message to send to all users before shutdown:");
            
            // Create a readline interface for getting user input
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout
            });
            
            // Get the shutdown message
            rl.question('> ', (message) => {
              rl.close();
              
              if (message.trim()) {
                console.log("\nSending message and shutting down server...");
                
                // Create the boxed system message
                const boxedMessage = createSystemMessageBox(message);
                
                // Send to all connected users
                let sentCount = 0;
                clients.forEach(client => {
                  if (client.authenticated) {
                    writeMessageToClient(client, boxedMessage);
                    sentCount++;
                  }
                });
                
                console.log(`Message sent to ${sentCount} users.`);
                
                // Log the message
                systemLogger.info(`Shutdown message broadcast: "${message}"`);
                
                // Give users a moment to read the message, then shutdown
                console.log("Shutting down in 5 seconds...");
                setTimeout(() => {
                  process.kill(process.pid, 'SIGINT');
                }, 5000);
              } else {
                console.log("Message was empty. Proceeding with immediate shutdown...");
                process.kill(process.pid, 'SIGINT');
              }
            });
          }
          else if (shutdownOption === 'a' && shutdownTimerActive && shutdownTimer) {
            // Abort the current shutdown timer
            console.log("\nAborting current shutdown timer...");
            
            // Cancel the active shutdown timer
            if (shutdownTimer) {
              clearTimeout(shutdownTimer);
              shutdownTimer = null;
            }
            
            // Send message to all users that shutdown has been aborted
            const abortMessage = "The scheduled server shutdown has been aborted.";
            const boxedMessage = createSystemMessageBox(abortMessage);
            
            clients.forEach(client => {
              if (client.authenticated) {
                writeMessageToClient(client, boxedMessage);
              }
            });
            
            // Reset shutdown state
            shutdownTimerActive = false;
            
            // Restore console logging
            if (shutdownConsoleTransport) {
              systemLogger.add(shutdownConsoleTransport);
              systemLogger.info('Console logging restored. Shutdown timer aborted.');
            }
            
            // Clean up and restore main key listener
            process.stdin.removeListener('data', shutdownMenuHandler);
            process.stdin.on('data', keyListener);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
            }
            
            // Log the abort action
            systemLogger.info('Scheduled shutdown aborted by console command.');
          }
          else if (shutdownOption === 'c') {
            // Cancel shutdown
            cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
          }
          else if (shutdownKey === '\u0003') {
            // Ctrl+C cancels and returns to regular operation
            cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
          }
          else {
            // Any other key - just redisplay the options
            console.log(`\nUnrecognized option (${shutdownOption})`);
            console.log("\n=== Shutdown Options ===");
            console.log("  q: Shutdown immediately");
            console.log("  m: Shutdown with message");
            console.log("  t: Shutdown timer");
            // Show abort option only if a shutdown timer is active
            if (shutdownTimerActive && shutdownTimer) {
              console.log("  a: Abort current shutdown");
            }
            console.log("  c: Cancel");
          }
        };
        
        // Listen for shutdown menu input
        process.stdin.on('data', shutdownMenuHandler);
      } else if (key === '\u0003') {
        systemLogger.info('Ctrl+C detected. Shutting down server...');
        process.kill(process.pid, 'SIGINT');
      } else {
        // Show menu options again for unrecognized keys
        // Only show for printable characters, not control sequences
        if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
          console.log(`\nUnrecognized option: '${key}'`);
          console.log("Available options:");
          console.log("  c: Connect locally");
          console.log("  a: Admin session");
          console.log("  u: List connected users");
          console.log("  m: Monitor user");
          console.log("  s: Send system message");
          console.log("  q: Shutdown server");
          console.log("  Ctrl+C: Shutdown server");
        }
      }
    };

    process.stdin.on('data', keyListener);
  } else if (!process.stdin.isTTY) {
    systemLogger.info('Not running in a TTY, local client connection disabled.');
  }
}

// Helper function to display the shutdown timer prompt with highlighted value
function showShutdownTimerPrompt(minutes: number): void {
  // Clear the line and return to the beginning using ANSI codes
  process.stdout.write('\r\x1B[2K'); // \r: carriage return, \x1B[2K: clear entire line
  process.stdout.write(`Shutdown when? In \x1b[47m\x1b[30m${minutes}\x1b[0m minute${minutes === 1 ? '' : 's'}. (Enter to confirm, 'c' to cancel)`);
}

// Helper function to start the shutdown timer
function startShutdownTimer(minutes: number): void {
  // Cancel any existing timer
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
  }
  
  // Set the flag
  shutdownTimerActive = true;
  
  // Send a system message to all users notifying them of the shutdown
  const shutdownMessage = `The server will be shutting down in ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
  const boxedMessage = createSystemMessageBox(shutdownMessage);
  
  // Send to all connected users
  clients.forEach(client => {
    if (client.authenticated) {
      writeMessageToClient(client, boxedMessage);
    }
  });
  
  // Log the scheduled shutdown
  systemLogger.info(`Server shutdown scheduled in ${minutes} minutes.`);
  
  // Create a countdown that sends updates every minute
  let remainingMinutes = minutes;
  
  const updateCountdown = () => {
    remainingMinutes--;
    
    if (remainingMinutes > 0) {
      // Send a reminder if at least one minute remains
      if (remainingMinutes === 1 || remainingMinutes === 2 || remainingMinutes === 5 || 
          remainingMinutes === 10 || remainingMinutes === 15 || remainingMinutes === 30) {
        const reminderMessage = `The server will be shutting down in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`;
        const boxedReminder = createSystemMessageBox(reminderMessage);
        
        clients.forEach(client => {
          if (client.authenticated) {
            writeMessageToClient(client, boxedReminder);
          }
        });
        
        systemLogger.info(`Shutdown reminder: ${remainingMinutes} minutes remaining.`);
      }
      
      // Schedule the next update
      shutdownTimer = setTimeout(updateCountdown, 60000); // 1 minute
    } else {
      // Time's up, shut down
      const finalMessage = "The server is shutting down now. Thank you for playing!";
      const boxedFinal = createSystemMessageBox(finalMessage);
      
      clients.forEach(client => {
        if (client.authenticated) {
          writeMessageToClient(client, boxedFinal);
        }
      });
      
      systemLogger.info("Shutdown timer completed. Shutting down server...");
      
      // Give users a moment to see the final message
      setTimeout(() => {
        process.kill(process.pid, 'SIGINT');
      }, 2000);
    }
  };
    
  // Start the countdown updates if more than 1 minute
  if (minutes > 0) {
    shutdownTimer = setTimeout(updateCountdown, 60000); // Start after 1 minute
  }
  
  console.log(`Shutdown timer set for ${minutes} minutes.`);
}
function cancelShutdownAndRestoreLogging(consoleTransport: winston.transport | null, keyListener: (key: string) => void): void {
  // Cancel any active shutdown timer
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
  
  shutdownTimerActive = false;
  
  console.log("\nShutdown cancelled.");
  
  // Restore console logging
  if (consoleTransport) {
    systemLogger.add(consoleTransport);
    systemLogger.info('Console logging restored. Shutdown cancelled.');
  }
  
  // If a shutdown was in progress, notify users
  if (shutdownTimerActive) {
    const cancelMessage = "The scheduled server shutdown has been cancelled.";
    const boxedMessage = createSystemMessageBox(cancelMessage);
    
    clients.forEach(client => {
      if (client.authenticated) {
        writeMessageToClient(client, boxedMessage);
      }
    });
  }
  
  // Clean up input handlers and restore main key listener
  process.stdin.removeAllListeners('data');
  process.stdin.on('data', keyListener);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  
  // Display options again
  systemLogger.info(`Press 'c' to connect locally, 'a' for admin session, 'u' to list users, 'm' to monitor user, 's' for system message, 'q' to shutdown.`);
}

const startServer = async () => {
  // First check and create admin user if needed
  const adminSetupSuccess = await checkAndCreateAdminUser();
  if (!adminSetupSuccess) {
    systemLogger.error('Admin setup failed. Server startup aborted.');
    process.exit(1);
  }
  
  systemLogger.info('Admin user verified. Continuing with server startup...');
  
  // Try to create the TELNET server with error handling
  const telnetServer = net.createServer((socket) => {
    // Check if this connection is the pending admin login
    if (isAdminLoginPending) {
      isAdminLoginPending = false; // Reset flag immediately
      systemLogger.info(`Incoming connection flagged as direct admin login.`);
      
      // Create the connection wrapper
      const connection = new TelnetConnection(socket);
      
      // Setup client normally first
      setupClient(connection);
      
      // Get the client ID
      const clientId = connection.getId();
      const client = clients.get(clientId);
      
      if (client) {
        // Set a special flag in stateData for the state machine to handle
        client.stateData.directAdminLogin = true;
        
        // Have the state machine transition immediately to CONNECTING first
        // to ensure everything is initialized properly
        stateMachine.transitionTo(client, ClientStateType.CONNECTING);
        
        systemLogger.info(`Direct admin login initialized for connection: ${clientId}`);
        
        // Send welcome banner
        connection.write('========================================\r\n');
        connection.write('       DIRECT ADMIN LOGIN\r\n');
        connection.write('========================================\r\n\r\n');
        
        // Delay slightly to allow telnet negotiation to complete
        setTimeout(() => {
          // Login as admin user bypassing normal flow
          // This simulates the user typing "admin" at the login prompt
          processInput(client, 'admin');
          
          // Force authentication immediately, bypassing password check
          client.authenticated = true;
          
          // Set up admin user data
          const adminData = userManager.getUser('admin');
          if (adminData) {
            client.user = adminData;
            userManager.registerUserSession('admin', client);
            
            // Transition to authenticated state
            stateMachine.transitionTo(client, ClientStateType.AUTHENTICATED);
            
            // Log the direct admin login
            systemLogger.info(`Admin user directly logged in via console shortcut.`);
            
            // Notify admin of successful login
            connection.write('\r\nDirectly logged in as admin. Welcome!\r\n\r\n');
            
            // Execute the "look" command to help admin orient
            setTimeout(() => {
              processInput(client, 'look');
            }, 500);
          } else {
            // This should never happen as we check for admin at startup
            systemLogger.error('Failed to load admin user data for direct login.');
            connection.write('Error loading admin user data. Disconnecting.\r\n');
            connection.end();
          }
        }, 1000);
      }
    } else {
      // Normal connection flow
      systemLogger.info(`TELNET client connected: ${socket.remoteAddress}`);
      
      // Create our custom connection wrapper
      const connection = new TelnetConnection(socket);
      
      // TelnetConnection class now handles all the TELNET negotiation
      setupClient(connection);
      
      // Track total connections
      serverStats.totalConnections++;
    }
  });

  telnetServer.on('error', (err: Error & {code?: string}) => {
    if (err.code === 'EADDRINUSE') {
      systemLogger.error(`Port ${TELNET_PORT} is already in use. Is another instance running?`);
      systemLogger.info(`Trying alternative port ${TELNET_PORT + 1}...`);
      telnetServer.listen(TELNET_PORT + 1);
    } else {
      systemLogger.error('TELNET server error:', err);
    }
  });

  telnetServer.listen(TELNET_PORT, () => {
    const address = telnetServer.address();
    if (address && typeof address !== 'string') {
      systemLogger.info(`TELNET server running on port ${address.port}`);
    } else {
      systemLogger.info(`TELNET server running`);
    }
  });

  // Similar approach for WebSocket server
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer);
  
  httpServer.on('error', (err: Error & {code?: string}) => {
    if (err.code === 'EADDRINUSE') {
      systemLogger.error(`Port ${WS_PORT} is already in use. Is another instance running?`);
      systemLogger.info(`Trying alternative port ${WS_PORT + 1}...`);
      httpServer.listen(WS_PORT + 1);
    } else {
      systemLogger.error('HTTP server error:', err);
    }
  });
  
  // Add Socket.IO handler
  io.on('connection', (socket) => {
    systemLogger.info(`Socket.IO client connected: ${socket.id}`);
    
    // Create our custom connection wrapper
    const connection = new SocketIOConnection(socket);
    setupClient(connection);
    
    // Track total connections
    serverStats.totalConnections++;
    
    // Handle monitoring requests
    socket.on('monitor-user', (data) => {
      const { clientId, token } = data;
      
      // Verify admin token
      jwt.verify(token, JWT_SECRET, (err: jwt.VerifyErrors | null) => {
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
        
        systemLogger.info(`Admin is now monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
        
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
              // When input is blocked, bypass the normal input handler and directly process the command
              if (client.isInputBlocked === true) {
                // Write the command to the client's console so they can see what the admin is doing
                client.connection.write(`\r\n\x1b[33mAdmin executed: ${commandStr}\x1b[0m\r\n`);
                
                // Process the command directly without going through handleClientData
                const line = commandStr.trim();
                
                // Echo a newline to ensure clean output
                client.connection.write('\r\n');
                
                // Process the input directly
                processInput(client, line);
              } else {
                // Normal flow - simulate the user typing this command by sending each character
                for (const char of commandStr) {
                  handleClientData(client, char);
                }
                // Send enter key to execute the command
                handleClientData(client, '\r');
              }
            }, 50);
          }
        });
        
        // Handle block user input toggle button
        socket.on('block-user-input', (blockData) => {
          if (blockData.clientId === clientId && client.authenticated) {
            // Set the input blocking state on the client
            client.isInputBlocked = blockData.blocked;
            
            systemLogger.info(`Admin has ${blockData.blocked ? 'blocked' : 'unblocked'} input for client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
            
            // Notify the user that their input has been blocked/unblocked
            if (client.authenticated) {
              if (blockData.blocked) {
                client.connection.write('\r\n\x1b[33mAn admin has temporarily disabled your input ability.\x1b[0m\r\n');
              } else {
                client.connection.write('\r\n\x1b[33mAn admin has re-enabled your input ability.\x1b[0m\r\n');
              }
              
              // Re-display the prompt
              const promptText = getPromptText(client);
              client.connection.write(promptText);
              if (client.buffer.length > 0) {
                client.connection.write(client.buffer);
              }
            }
          }
        });

        // Handle admin message
        socket.on('admin-message', (messageData) => {
          if (messageData.clientId === clientId && client.authenticated) {
            // Log the message being sent
            systemLogger.info(`Admin sent message to client ${clientId}${client.user ? ` (${client.user.username})` : ''}: ${messageData.message}`);
            
            // Create a 3D box with the message inside
            const boxedMessage = createAdminMessageBox(messageData.message);
            
            // Send the boxed message to the client
            writeMessageToClient(client, boxedMessage);

                  // Re-display the prompt
            const promptText = getPromptText(client);
            client.connection.write(promptText);
            if (client.buffer.length > 0) {
              client.connection.write(client.buffer);
            }

            // Echo to the admin that the message was sent
            socket.emit('monitor-output', { 
              data: `\r\n\x1b[36mAdmin message sent successfully\x1b[0m\r\n` 
            });
          }
        });
        
        // Handle admin disconnect
        socket.on('disconnect', () => {
          if (client && client.adminMonitorSocket === socket) {
            delete client.adminMonitorSocket;
            client.isBeingMonitored = false;
            client.isInputBlocked = false; // Make sure to unblock input when admin disconnects
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
        systemLogger.info(`Admin stopped monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
        client.isBeingMonitored = false;
        client.isInputBlocked = false; // Also unblock input when monitoring stops
        client.adminMonitorSocket = undefined;
      }
    });
  });
  
  httpServer.listen(WS_PORT, () => {
    const address = httpServer.address();
    if (address && typeof address !== 'string') {
      systemLogger.info(`HTTP and Socket.IO server running on port ${address.port}`);
      systemLogger.info(`Admin interface available at http://localhost:${address.port}/admin`);
    } else {
      systemLogger.info(`HTTP and Socket.IO server running`);
      systemLogger.info(`Admin interface available`);
    }
  });
};

// Start server and game timer
async function init() {
  // First start the server (which will handle admin user creation)
  await startServer();
  
  // Only start the game timer after server is up and admin is created
  systemLogger.info('Starting game timer system...');
  gameTimerManager.start();
  
  // Setup the key listener after server starts and ports are confirmed
  setupKeyListener();
  
  // Setup graceful shutdown to save data and properly clean up
  process.on('SIGINT', () => {
    systemLogger.info('Shutting down server...');
    
    // End any local session if active
    endLocalSession();
    
    // Stop the game timer system
    gameTimerManager.stop();
    
    // Clear the idle check interval
    clearInterval(idleCheckTimer);
    
    // Force a final save
    gameTimerManager.forceSave();
    
    // Reset the singleton instances if needed
    GameTimerManager.resetInstance();
    
    // Also reset CommandRegistry instance
    const { CommandRegistry } = require('./command/commandRegistry');
    CommandRegistry.resetInstance();
    
    // Exit the process
    systemLogger.info('Server shutdown complete');
    process.exit(0);
  });
}

init();

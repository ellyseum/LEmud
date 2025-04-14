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
    
    // Unregister the user session
    userManager.unregisterUserSession(username);
    
    // Notify other users with formatted username if requested
    if (broadcastMessage) {
      const formattedUsername = formatUsername(username);
      broadcastSystemMessage(`${formattedUsername} has left the game.`, client);
    }
  }
  clients.delete(clientId);
}

// Unified handler for client data (both TELNET and WebSocket)
function handleClientData(client: ConnectedClient, data: string): void {
  // Check if input is blocked by an admin - stricter implementation
  if (client.isInputBlocked === true && client.authenticated) {
    // Allow only special terminal control commands for UI responsiveness
    // Ctrl+C, Ctrl+Z and other essential control sequences should still work
    
    // For all normal input, show message and prevent further processing
    if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
      // Only show the message for printable characters, not for every control sequence
      client.connection.write('\r\n\x1b[33mYour input has been disabled by an admin.\x1b[0m\r\n');
      
      // Re-display the prompt
      const promptText = getPromptText(client);
      client.connection.write(promptText);
      if (client.buffer.length > 0) {
        client.connection.write(client.buffer);
      }
      
      return; // Block further processing
    }
    
    // For Enter key, still notify but don't process commands
    if (data === '\r' || data === '\n' || data === '\r\n') {
      if (client.buffer.length > 0) {
        client.connection.write('\r\n\x1b[33mYour input has been disabled by an admin.\x1b[0m\r\n');
        
        // Clear the buffer
        client.buffer = '';
        client.cursorPos = 0;
        
        // Re-display prompt
        const promptText = getPromptText(client);
        client.connection.write(promptText);
        
        return; // Block further processing
      }
    }
    
    // Allow backspace to clear input buffer, but don't run commands
    if (data === '\b' || data === '\x7F') {
      // Let backspace work normally to provide responsive terminal feel
      if (client.buffer.length > 0) {
        // Initialize cursor position if not defined
        if (client.cursorPos === undefined) {
          client.cursorPos = client.buffer.length;
        }
        
        if (client.cursorPos > 0) {
          if (client.cursorPos === client.buffer.length) {
            client.buffer = client.buffer.slice(0, -1);
            client.cursorPos--;
            client.connection.write('\b \b');
          } else {
            const newBuffer = client.buffer.slice(0, client.cursorPos - 1) + client.buffer.slice(client.cursorPos);
            redrawInputLine(client, newBuffer, client.cursorPos - 1);
          }
        }
      }
      return; // Block further processing
    }
    
    // Allow arrow keys and other navigation controls for better UX
    if (data.startsWith('\u001b[') || data.startsWith('\u001bO')) {
      // Process navigation keys normally
      // They won't execute commands, just improve UX
    } else {
      // Block all other input when input is disabled
      return;
    }
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

// Function to set up the initial key listener
function setupKeyListener() {
  if (process.stdin.isTTY && !isLocalClientConnected) {
    systemLogger.info(`Press 'c' to connect locally, 'a' for admin session, 'u' to list users, 's' for system message, 'q' to shutdown.`);
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
          systemLogger.info(`Press 'c' to connect locally, 'a' for admin session, 'u' to list users, 's' for system message, 'q' to shutdown.`);
        });
      } else if (lowerKey === 'q') {
        console.log("\nShutting down server by request...");
        process.kill(process.pid, 'SIGINT');
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

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
    handleClientDisconnect(client, clientId, true);
  });
  
  // Handle connection errors similarly
  connection.on('error', (err) => {
    console.error(`Error with client ${clientId}:`, err);
    handleClientDisconnect(client, clientId, false);
  });

  connection.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
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
  // Start buffering output when user begins typing
  if (client.buffer.length === 0 && !client.isTyping) {
    client.isTyping = true;
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
  
  // Handle normal input (excluding special sequences)
  if (client.cursorPos === client.buffer.length) {
    // Cursor at the end - simply append
    client.buffer += data;
    client.cursorPos++;
    client.connection.write(data);
  } else {
    // Cursor in the middle - insert and redraw
    const newBuffer = client.buffer.slice(0, client.cursorPos) + data + client.buffer.slice(client.cursorPos);
    redrawInputLine(client, newBuffer, client.cursorPos + 1);
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

// Check for admin user on startup and create if needed
async function checkAndCreateAdminUser(): Promise<boolean> {
  console.log('\nChecking for admin user...');
  
  // Check if admin user exists
  if (!userManager.userExists('admin')) {
    console.log(colorize('No admin user found. Creating admin account...', 'yellow'));
    console.log(colorize('Server startup will halt until admin setup is complete.', 'yellow'));
    
    let adminCreated = false;
    
    // Keep trying until the admin is successfully created
    while (!adminCreated) {
      try {
        // Use custom password input that masks the password
        const password = await readPasswordFromConsole('Enter password for new admin user: ');
        
        // Validate password
        if (password.length < 6) {
          console.log(colorize('Password must be at least 6 characters long. Please try again.', 'red'));
          continue; // Skip the rest of this iteration and try again
        }
        
        // Confirm password with masking
        const confirmPassword = await readPasswordFromConsole('Confirm password: ');
        
        // Check if passwords match
        if (password !== confirmPassword) {
          console.log(colorize('Passwords do not match. Please try again.', 'red'));
          continue; // Skip the rest of this iteration and try again
        }
        
        // Create admin user
        const success = userManager.createUser('admin', password);
        
        if (success) {
          console.log(colorize('Admin user created successfully!', 'green'));
          
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
            console.log(colorize('Admin privileges configured.', 'green'));
            adminCreated = true; // Mark as successfully created so we exit the loop
          } catch (error) {
            console.error('Error creating admin.json file:', error);
            console.log(colorize('Failed to create admin configuration. Please try again.', 'red'));
            // Continue the loop to try again
          }
        } else {
          console.log(colorize('Error creating admin user. Please try again.', 'red'));
          // Continue the loop to try again
        }
      } catch (error) {
        console.error('Error during admin setup:', error);
        console.log(colorize('An error occurred during setup. Please try again.', 'red'));
        // Continue the loop to try again
      }
    }
    
    return true; // Return true since we don't exit the loop until admin is created
  } else {
    console.log(colorize('Admin user already exists.', 'green'));
    
    // Ensure admin.json exists with the admin user
    const adminFilePath = path.join(DATA_DIR, 'admin.json');
    if (!fs.existsSync(adminFilePath)) {
      console.log(colorize('Creating admin.json file...', 'yellow'));
      
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
        console.log(colorize('Admin privileges configured.', 'green'));
      } catch (error) {
        console.error('Error creating admin.json file:', error);
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

const startServer = async () => {
  // First check and create admin user if needed
  const adminSetupSuccess = await checkAndCreateAdminUser();
  if (!adminSetupSuccess) {
    console.log(colorize('Admin setup failed. Server startup aborted.', 'red'));
    process.exit(1);
  }
  
  console.log(colorize('Admin user verified. Continuing with server startup...', 'green'));
  
  // Try to create the TELNET server with error handling
  const telnetServer = net.createServer((socket) => {
    // Create our custom connection wrapper
    const connection = new TelnetConnection(socket);
  
    // TelnetConnection class now handles all the TELNET negotiation
    setupClient(connection);
  
    // Track total connections
    serverStats.totalConnections++;
  });

  telnetServer.on('error', (err: Error & {code?: string}) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${TELNET_PORT} is already in use. Is another instance running?`);
      console.log(`Trying alternative port ${TELNET_PORT + 1}...`);
      telnetServer.listen(TELNET_PORT + 1);
    } else {
      console.error('TELNET server error:', err);
    }
  });

  telnetServer.listen(TELNET_PORT, () => {
    const address = telnetServer.address();
    if (address && typeof address !== 'string') {
      console.log(`TELNET server running on port ${address.port}`);
    } else {
      console.log(`TELNET server running`);
    }
  });

  // Similar approach for WebSocket server
  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer);
  
  httpServer.on('error', (err: Error & {code?: string}) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${WS_PORT} is already in use. Is another instance running?`);
      console.log(`Trying alternative port ${WS_PORT + 1}...`);
      httpServer.listen(WS_PORT + 1);
    } else {
      console.error('HTTP server error:', err);
    }
  });
  
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
  
  httpServer.listen(WS_PORT, () => {
    const address = httpServer.address();
    if (address && typeof address !== 'string') {
      console.log(`HTTP and Socket.IO server running on port ${address.port}`);
      console.log(`Admin interface available at http://localhost:${address.port}/admin`);
    } else {
      console.log(`HTTP and Socket.IO server running`);
      console.log(`Admin interface available`);
    }
  });
};

// Start server and game timer
async function init() {
  // First start the server (which will handle admin user creation)
  await startServer();
  
  // Only start the game timer after server is up and admin is created
  console.log(colorize('Starting game timer system...', 'green'));
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
}

init();

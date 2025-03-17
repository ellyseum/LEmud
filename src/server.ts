import net from 'net';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConnectedClient, ClientStateType } from './types';
import { UserManager } from './user/userManager';
import { CommandHandler } from './command/commandHandler';
import { StateMachine } from './state/stateMachine';
import { colorize } from './utils/colors';
import { flushClientBuffer, stopBuffering } from './utils/socketWriter';
import { TelnetConnection } from './connection/telnet.connection';
import { WebSocketConnection } from './connection/websocket.connection';
import { IConnection } from './connection/interfaces/connection.interface';

const TELNET_PORT = 8023; // Standard TELNET port is 23, using 8023 to avoid requiring root privileges
const WS_PORT = 8080; // WebSocket port
const userManager = new UserManager();
const clients = new Map<string, ConnectedClient>();
const commandHandler = new CommandHandler(clients, userManager);
const stateMachine = new StateMachine(userManager);

// Create the HTTP server for WebSockets
const httpServer = http.createServer((req, res) => {
  // Serve static files from the public directory
  const publicPath = path.join(__dirname, '..', 'public');
  let filePath = path.join(publicPath, req.url === '/' ? 'index.html' : req.url || '');
  
  // Get file extension
  const extname = String(path.extname(filePath)).toLowerCase();
  
  // Map file extensions to MIME types
  const mimeTypes: {[key: string]: string} = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  // Set default content type
  let contentType = mimeTypes[extname] || 'application/octet-stream';

  // Read file and serve it
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if(error.code === 'ENOENT') {
        // Page not found
        res.writeHead(404);
        res.end('404 Not Found');
      } else {
        // Server error
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      // Success
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Create the WebSocket server
const wsServer = new WebSocketServer({ server: httpServer });

// Handle WebSocket connections
wsServer.on('connection', (ws) => {
  const clientId = uuidv4();
  console.log(`WebSocket client connected: ${clientId}`);
  
  const connection = new WebSocketConnection(ws, clientId);
  setupClient(connection);
});

// Create the TELNET server
const telnetServer = net.createServer((socket) => {
  const connection = new TelnetConnection(socket);
  console.log(`TELNET client connected: ${connection.getId()}`);
  
  // TelnetConnection class now handles all the TELNET negotiation
  setupClient(connection);
});

// Shared client setup function
function setupClient(connection: IConnection): void {
  // Set up the client
  const client: ConnectedClient = {
    connection,
    user: null,
    authenticated: false,
    buffer: '',
    state: ClientStateType.CONNECTING,
    stateData: {},
    isTyping: false,
    outputBuffer: []
  };
  
  const clientId = connection.getId();
  clients.set(clientId, client);
  
  // Start the state machine
  stateMachine.transitionTo(client, ClientStateType.CONNECTING);
  
  // Handle data from client
  connection.on('data', (data) => {
    // All connections should use the buffered approach, regardless of type
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
    // This prevents unregistering a session that was already handed over via transfer
    if (client.user && client.authenticated) {
      // Unregister the user session
      userManager.unregisterUserSession(client.user.username);
      
      // Notify other users
      broadcastSystemMessage(`${client.user.username} has left the server.`, client);
    }
    clients.delete(clientId);
  });
  
  connection.on('error', (err) => {
    console.error(`Error with client ${clientId}:`, err);
    
    // Check if client was in a pending transfer
    if (client.user && client.stateData.waitingForTransfer) {
      userManager.cancelTransfer(client.user.username);
    }
    
    // Only unregister if the client is still authenticated
    // This prevents unregistering a session that was already handed over via transfer
    if (client.user && client.authenticated) {
      userManager.unregisterUserSession(client.user.username);
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
  
  // Handle backspace
  if (data === '\b') {
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
  
  // Handle Enter (CR+LF or just CR)
  if (data === '\r\n' || data === '\r') {
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

function processInput(client: ConnectedClient, input: string): void {
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
  }
}

function broadcastSystemMessage(message: string, excludeClient?: ConnectedClient): void {
  clients.forEach(client => {
    if (client.authenticated && client !== excludeClient) {
      client.connection.write(colorize(`>>> ${message}\r\n`, 'yellow'));
    }
  });
}

// Start the servers
telnetServer.listen(TELNET_PORT, () => {
  console.log(`TELNET server running on port ${TELNET_PORT}`);
});

httpServer.listen(WS_PORT, () => {
  console.log(`WebSocket server running on port ${WS_PORT}`);
});

console.log(`Make sure you have the following state files configured correctly:`);
console.log(` - connecting.state.ts`);
console.log(` - login.state.ts`);
console.log(` - signup.state.ts`);
console.log(` - authenticated.state.ts`);

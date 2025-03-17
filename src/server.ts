import net from 'net';
import http from 'http';
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
  // We could serve a simple HTML client page here
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server for game connections');
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
  
  // Configure TELNET options: disable local echo
  socket.write(Buffer.from([255, 251, 1])); // IAC WILL ECHO - server will handle echo
  
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
    // For TELNET, data will be pre-processed by TelnetConnection
    // For WebSocket, data will be the actual input message
    
    // For telnet-specific processing
    if (connection.getType() === 'telnet') {
      handleTelnetData(client, data);
    } else {
      // For WebSocket, we can process the input directly
      // WebSocket clients will send complete commands
      processInput(client, data);
    }
  });
  
  // Handle client disconnect
  connection.on('end', () => {
    console.log(`Client disconnected: ${clientId}`);
    if (client.user && client.authenticated) {
      // Notify other users
      broadcastSystemMessage(`${client.user.username} has left the server.`, client);
    }
    clients.delete(clientId);
  });
  
  connection.on('error', (err) => {
    console.error(`Error with client ${clientId}:`, err);
    clients.delete(clientId);
  });
}

// Handle TELNET-specific data processing
function handleTelnetData(client: ConnectedClient, data: string): void {
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
  
  // Handle Enter (already normalized to \r\n by TelnetConnection)
  if (data.includes('\r\n')) {
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
  
  // Update mask input state
  if (client.stateData.maskInput) {
    client.connection.setMaskInput(true);
  } else {
    client.connection.setMaskInput(false);
  }
}

function processInput(client: ConnectedClient, input: string): void {
  // Trim whitespace from beginning and end of input
  const trimmedInput = input.trim();
  
  console.log(`Processing input from client in state ${client.state}: "${trimmedInput}"`);
  
  // Check if user is authenticated AND not in confirmation state
  if (client.authenticated && client.state !== ClientStateType.CONFIRMATION) {
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

import net from 'net';
import { ConnectedClient, ClientStateType } from './types';
import { UserManager } from './user/userManager';
import { CommandHandler } from './command/commandHandler';
import { StateMachine } from './state/stateMachine';
import { colorize } from './utils/colors';
import { flushClientBuffer, stopBuffering } from './utils/socketWriter';

const PORT = 8023; // Standard TELNET port is 23, using 8023 to avoid requiring root privileges
const userManager = new UserManager();
const clients = new Map<string, ConnectedClient>();
const commandHandler = new CommandHandler(clients, userManager);
const stateMachine = new StateMachine(userManager);

// Create the server
const server = net.createServer((socket) => {
  const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`Client connected: ${clientId}`);
  
  // Set up the client
  const client: ConnectedClient = {
    socket,
    user: null,
    authenticated: false,
    buffer: '',
    state: ClientStateType.CONNECTING,
    stateData: {},
    isTyping: false,
    outputBuffer: []
  };
  
  clients.set(clientId, client);
  
  // Configure TELNET options: disable local echo
  socket.write(Buffer.from([255, 251, 1])); // IAC WILL ECHO - server will handle echo
  
  // Start the state machine
  stateMachine.transitionTo(client, ClientStateType.CONNECTING);
  
  // Handle client data with better echo management
  socket.on('data', (data) => {
    // Start buffering output when user begins typing
    if (client.buffer.length === 0 && !client.isTyping) {
      client.isTyping = true;
    }
    
    // Process data byte by byte to handle backspace properly
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      
      // Skip TELNET command sequences
      if (byte === 255) { // IAC (Interpret As Command)
        // Skip command and its parameters (at least 2 more bytes)
        if (i + 2 < data.length) {
          i += 2;
        }
        continue;
      }
      
      // Handle backspace (ASCII 8) or delete (ASCII 127) key
      if (byte === 8 || byte === 127) {
        if (client.buffer.length > 0) {
          // Remove the last character from the buffer
          client.buffer = client.buffer.slice(0, -1);
          
          // Update the terminal display (backspace, space, backspace)
          socket.write('\b \b');
          
          // If buffer becomes empty, flush any buffered output
          if (client.buffer.length === 0) {
            stopBuffering(client);
          }
        }
        // Do nothing if buffer is empty
      }
      // Handle Enter key (carriage return)
      else if (byte === 13) {
        // Check if this is a CR+LF sequence
        if (i + 1 < data.length && data[i + 1] === 10) {
          i++; // Skip the LF part
        }
        
        // Process the completed line
        const line = client.buffer;
        client.buffer = ''; // Reset the buffer
        socket.write('\r\n'); // Echo newline
        
        // Stop buffering and flush any buffered output before processing command
        stopBuffering(client);
        
        // Process the input
        processInput(client, line);
      }
      // Handle normal printable characters
      else if (byte >= 32 && byte < 127) {
        const char = String.fromCharCode(byte);
        client.buffer += char;
        
        // Echo based on whether we're in a masked input state
        if (client.stateData.maskInput) {
          // For passwords, echo asterisk or bullet
          socket.write('*');
        } else {
          // For normal input, echo the character
          socket.write(char);
        }
      }
      // Ignore other control characters
    }
  });
  
  // Handle client disconnect
  socket.on('end', () => {
    console.log(`Client disconnected: ${clientId}`);
    if (client.user && client.authenticated) {
      // Notify other users
      broadcastSystemMessage(`${client.user.username} has left the server.`, client);
    }
    clients.delete(clientId);
  });
  
  socket.on('error', (err) => {
    console.error(`Error with client ${clientId}:`, err);
    clients.delete(clientId);
  });
});

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
        client.socket.end();
      }, 1000); // Brief delay to ensure the error message is sent
    }
  }
}

function broadcastSystemMessage(message: string, excludeClient?: ConnectedClient): void {
  clients.forEach(client => {
    if (client.authenticated && client !== excludeClient) {
      client.socket.write(colorize(`>>> ${message}\r\n`, 'yellow'));
    }
  });
}

// Start the server
server.listen(PORT, () => {
  console.log(`TELNET server running on port ${PORT}`);
  console.log(`Make sure you have the following state files configured correctly:`);
  console.log(` - connecting.state.ts`);
  console.log(` - login.state.ts`);
  console.log(` - signup.state.ts`);
  console.log(` - authenticated.state.ts`);
});

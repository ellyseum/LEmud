import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import jwt from 'jsonwebtoken';
import { systemLogger } from '../utils/logger';
import { SocketIOConnection } from '../connection/socketio.connection';
import { ConnectedClient, ServerStats } from '../types';
import { RoomManager } from '../room/roomManager';
import { colorize } from '../utils/colors';
import { getPromptText } from '../utils/promptFormatter';
import { writeMessageToClient } from '../utils/socketWriter';
import config from '../config';

export class WebSocketServer {
  private io: SocketIOServer;
  private httpServer: http.Server;
  private clients: Map<string, ConnectedClient>;
  private serverStats: ServerStats;
  private jwtSecret: string;
  private actualPort: number = config.WS_PORT;

  constructor(
    httpServer: http.Server,
    clients: Map<string, ConnectedClient>,
    serverStats: ServerStats,
    setupClientFn: (connection: any) => void,
    handleClientDataFn: (client: ConnectedClient, data: string) => void,
    processInputFn: (client: ConnectedClient, input: string) => void
  ) {
    this.httpServer = httpServer;
    this.clients = clients;
    this.serverStats = serverStats;
    this.jwtSecret = config.JWT_SECRET;

    // Create Socket.IO server for WebSocket connections
    this.io = new SocketIOServer(httpServer);

    // Add Socket.IO handler
    this.io.on('connection', (socket) => {
      systemLogger.info(`Socket.IO client connected: ${socket.id}`);
      
      // Create our custom connection wrapper
      const connection = new SocketIOConnection(socket);
      setupClientFn(connection);
      
      // Track total connections
      this.serverStats.totalConnections++;
      
      // Handle monitoring requests
      socket.on('monitor-user', (data) => {
        const { clientId, token } = data;
        
        // Verify admin token
        jwt.verify(token, this.jwtSecret, (err: jwt.VerifyErrors | null) => {
          if (err) {
            socket.emit('monitor-error', { message: 'Authentication failed' });
            return;
          }
          
          const client = this.clients.get(clientId);
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
            const roomManager = RoomManager.getInstance(this.clients);
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
                  processInputFn(client, line);
                } else {
                  // Normal flow - simulate the user typing this command by sending each character
                  for (const char of commandStr) {
                    handleClientDataFn(client, char);
                  }
                  // Send enter key to execute the command
                  handleClientDataFn(client, '\r');
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
        
        const client = this.clients.get(clientId);
        if (client && client.adminMonitorSocket === socket) {
          systemLogger.info(`Admin stopped monitoring client ${clientId}${client.user ? ` (${client.user.username})` : ''}`);
          client.isBeingMonitored = false;
          client.isInputBlocked = false; // Also unblock input when monitoring stops
          client.adminMonitorSocket = undefined;
        }
      });
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      // HTTP server should already be configured in the APIServer class
      // We just need to track when it's listening
      const address = this.httpServer.address();
      if (address && typeof address !== 'string') {
        this.actualPort = address.port;
        systemLogger.info(`Socket.IO server running on port ${address.port}`);
      } else {
        systemLogger.info(`Socket.IO server running`);
      }
      resolve();
    });
  }

  public getSocketIOServer(): SocketIOServer {
    return this.io;
  }

  public getActualPort(): number {
    return this.actualPort;
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        systemLogger.info('Socket.IO server stopped');
        resolve();
      });
    });
  }
}

// Helper function to create admin message
function createAdminMessageBox(message: string): string {
  const maxLineLength = config.MAX_MESSAGE_LINE_LENGTH;
  const horizontalBorder = '┏' + '━'.repeat(maxLineLength + 2) + '┓\r\n';
  const bottomBorder = '┗' + '━'.repeat(maxLineLength + 2) + '┛\r\n';
  
  // Wrap the message text
  const words = message.split(' ');
  let lines: string[] = [];
  let currentLine = '';
  
  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxLineLength) {
      currentLine += (currentLine.length > 0 ? ' ' : '') + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  
  // Build the message box
  let boxedMessage = horizontalBorder;
  
  // Add a blank line at the top
  boxedMessage += '┃ ' + ' '.repeat(maxLineLength) + ' ┃\r\n';
  
  // Add title line
  const titleText = 'Message from Admin';
  const titlePadding = Math.floor((maxLineLength - titleText.length) / 2);
  boxedMessage += '┃ ' + ' '.repeat(titlePadding) + '\x1b[1;33m' + titleText + '\x1b[0m' + ' '.repeat(maxLineLength - titleText.length - titlePadding) + ' ┃\r\n';
  
  // Add a separating line
  boxedMessage += '┃ ' + '─'.repeat(maxLineLength) + ' ┃\r\n';
  
  // Add message content with line wrapping
  for (const line of lines) {
    const padding = maxLineLength - line.length;
    boxedMessage += '┃ ' + line + ' '.repeat(padding) + ' ┃\r\n';
  }
  
  // Add a blank line at the bottom
  boxedMessage += '┃ ' + ' '.repeat(maxLineLength) + ' ┃\r\n';
  
  // Complete the box
  boxedMessage += bottomBorder;
  
  return boxedMessage;
}
import * as crypto from 'crypto';
import { systemLogger, getPlayerLogger } from '../utils/logger';
import { ConnectedClient, ClientStateType } from '../types';
import { IConnection } from '../connection/interfaces/connection.interface';
import { CombatSystem } from '../combat/combatSystem';
import { UserManager } from '../user/userManager';
import { RoomManager } from '../room/roomManager';
import { formatUsername } from '../utils/formatters';
import { getPromptText } from '../utils/promptFormatter';
import { stopBuffering } from '../utils/socketWriter';

export class ClientManager {
  private static instance: ClientManager;
  private clients: Map<string, ConnectedClient>;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private stateMachine: any; // Will be set later to avoid circular dependency
  private processInputFn: (client: ConnectedClient, input: string) => void = () => {}; // Initialize with no-op

  private constructor(
    userManager: UserManager,
    roomManager: RoomManager
  ) {
    this.clients = new Map<string, ConnectedClient>();
    this.userManager = userManager;
    this.roomManager = roomManager;
  }

  public static getInstance(
    userManager?: UserManager,
    roomManager?: RoomManager
  ): ClientManager {
    if (!ClientManager.instance) {
      if (!userManager || !roomManager) {
        throw new Error('UserManager and RoomManager must be provided when creating ClientManager instance');
      }
      ClientManager.instance = new ClientManager(userManager, roomManager);
    }
    return ClientManager.instance;
  }

  public setStateMachine(stateMachine: any): void {
    this.stateMachine = stateMachine;
  }

  public setProcessInputFunction(fn: (client: ConnectedClient, input: string) => void): void {
    this.processInputFn = fn;
  }

  public getClients(): Map<string, ConnectedClient> {
    return this.clients;
  }

  public setupClient(connection: IConnection): ConnectedClient {
    // Set up the client
    const client: ConnectedClient = {
      id: crypto.randomUUID(),
      connection,
      user: null,
      authenticated: false,
      buffer: '',
      state: ClientStateType.CONNECTING,
      stateData: {},
      isTyping: false,
      outputBuffer: [],
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      isBeingMonitored: false,
      isInputBlocked: false,
      // Set connection type and origin information
      isConsoleClient: connection.getType() === 'console', // True if this is a local console connection
      ipAddress: connection.getType() === 'telnet' ? 
        (connection as any).remoteAddress || 'unknown' : 
        'web-client' // Get IP for telnet connections
    };
    
    const clientId = connection.getId();
    this.clients.set(clientId, client);
    
    // Start the state machine
    this.stateMachine.transitionTo(client, ClientStateType.CONNECTING);
    
    // Handle data from client
    connection.on('data', (data) => {
      client.lastActivity = Date.now(); // Update lastActivity on data received
      this.handleClientData(client, data);
    });
    
    // Handle client disconnect
    connection.on('end', () => {
      systemLogger.info(`Client disconnected: ${clientId}`);
      this.handleClientDisconnect(client, clientId, true);
    });
    
    // Handle connection errors similarly
    connection.on('error', (err) => {
      systemLogger.error(`Error with client ${clientId}: ${err.message}`, { error: err });
      this.handleClientDisconnect(client, clientId, false);
    });

    connection.on('close', () => {
      systemLogger.info(`Client disconnected: ${clientId}`);
      this.handleClientDisconnect(client, clientId, true);
    });

    return client;
  }

  public handleClientDisconnect(client: ConnectedClient, clientId: string, broadcastMessage: boolean): void {
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
      this.userManager.cancelTransfer(client.user.username);
    }
    
    // Only unregister if the client is still authenticated
    if (client.user && client.authenticated) {
      // Then get the combat system instance to clean up any active combat
      const combatSystem = CombatSystem.getInstance(this.userManager, this.roomManager);
      
      // End combat for this player if they're in combat
      if (client.user.inCombat) {
        combatSystem.handlePlayerDisconnect(client);
      }
      
      // Remove player from all rooms when they disconnect
      const username = client.user.username;
      this.roomManager.removePlayerFromAllRooms(username);
      
      // Force disconnect any other clients that might still be using this username
      // This prevents the "two copies of character online" issue
      const userSessionsToCleanup: ConnectedClient[] = [];
      
      // Find any other clients that might have the same username
      this.clients.forEach((otherClient, otherClientId) => {
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
      this.userManager.unregisterUserSession(username);
      
      // Notify other users with formatted username if requested
      if (broadcastMessage) {
        const formattedUsername = formatUsername(username);
        this.broadcastSystemMessage(`${formattedUsername} has left the game.`, client);
      }
    }
    
    // Finally, remove this client from the clients map
    this.clients.delete(clientId);
  }

  public handleClientData(client: ConnectedClient, data: string): void {
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
      this.stateMachine.handleInput(client, data);
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
          this.redrawInputLine(client, newBuffer, client.cursorPos - 1);
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
      this.processInputFn(client, line);
      return;
    }
    
    // Handle up arrow (various possible formats)
    if (data === '\u001b[A' || data === '[A' || data === '\u001bOA' || data === 'OA') {
      this.handleUpArrow(client);
      return;
    }
    
    // Handle down arrow (various possible formats)
    if (data === '\u001b[B' || data === '[B' || data === '\u001bOB' || data === 'OB') {
      this.handleDownArrow(client);
      return;
    }
    
    // Handle left arrow (various possible formats)
    if (data === '\u001b[D' || data === '[D' || data === '\u001bOD' || data === 'OD') {
      this.handleLeftArrow(client);
      return;
    }
    
    // Handle right arrow (various possible formats)
    if (data === '\u001b[C' || data === '[C' || data === '\u001bOC' || data === 'OC') {
      this.handleRightArrow(client);
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
        this.redrawInputLine(client, firstCommand, firstCommand.length);
      }
      return;
    }
  
    // Handle Shift+Down Arrow (various possible formats)
    if (data === '\u001b[1;2B' || data === '[1;2B') {
      // Move to the end of the command history
      if (client.user && client.user.commandHistory) {
        client.user.currentHistoryIndex = -1;
        const currentCommand = client.user.savedCurrentCommand || '';
        this.redrawInputLine(client, currentCommand, currentCommand.length);
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
        this.redrawInputLine(client, newBuffer, client.cursorPos + 1);
      }
    }
  }

  private redrawInputLine(client: ConnectedClient, newBuffer: string, newCursorPos: number): void {
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

  private handleUpArrow(client: ConnectedClient): void {
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

  private handleDownArrow(client: ConnectedClient): void {
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

  private handleLeftArrow(client: ConnectedClient): void {
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

  private handleRightArrow(client: ConnectedClient): void {
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

  public broadcastSystemMessage(message: string, excludeClient?: ConnectedClient): void {
    this.clients.forEach(client => {
      if (client.authenticated && client !== excludeClient) {
        client.connection.write('\r\n' + message + '\r\n');
        
        // Re-display the prompt if the user is authenticated
        if (client.authenticated) {
          const promptText = getPromptText(client);
          client.connection.write(promptText);
          if (client.buffer.length > 0) {
            client.connection.write(client.buffer);
          }
        }
      }
    });
  }

  public checkForIdleClients(idleTimeoutMinutes: number): void {
    // If idle timeout is 0 or negative, idle timeout is disabled
    if (!idleTimeoutMinutes || idleTimeoutMinutes <= 0) {
      return;
    }
    
    // Convert minutes to milliseconds
    const idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
    const now = Date.now();
    
    // Check each connected client
    this.clients.forEach((client, clientId) => {
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
          client.connection.write('\r\n\r\n\x1b[31mYou have been disconnected due to inactivity.\x1b[0m\r\n');
          
          // Give them a moment to see the message, then disconnect
          setTimeout(() => {
            client.connection.end();
          }, 1000);
        }
      }
    });
  }

  /**
   * Find a client by username
   * @param username The username to search for
   * @returns The client if found, otherwise undefined
   */
  public getClientByUsername(username: string): ConnectedClient | undefined {
    for (const client of this.clients.values()) {
      if (client.user && client.user.username.toLowerCase() === username.toLowerCase()) {
        return client;
      }
    }
    return undefined;
  }
}
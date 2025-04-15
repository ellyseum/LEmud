import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { systemLogger } from './utils/logger';
import { ConnectedClient, ServerStats } from './types';
import { UserManager } from './user/userManager';
import { CommandHandler } from './command/commandHandler';
import { StateMachine } from './state/stateMachine';
import { RoomManager } from './room/roomManager';
import { GameTimerManager } from './timer/gameTimerManager';
import { TelnetServer } from './server/telnetServer';
import { WebSocketServer } from './server/webSocketServer';
import { APIServer } from './server/apiServer';
import { ClientManager } from './client/clientManager';
import { readPasswordFromConsole } from './utils/consoleUtils';
import { AdminLevel } from './command/commands/adminmanage.command';
import { createSystemMessageBox, createAdminMessageBox } from './utils/messageFormatter';
import { getPromptText } from './utils/promptFormatter'; // Import the getPromptText function
import { SnakeGameState } from './states/snake-game.state';
import config from './config';
import net from 'net';

export class GameServer {
  private telnetServer: TelnetServer;
  private webSocketServer: WebSocketServer;
  private apiServer: APIServer;
  private clientManager: ClientManager;
  private userManager: UserManager;
  private roomManager: RoomManager;
  private commandHandler: CommandHandler;
  private stateMachine: StateMachine;
  private gameTimerManager: GameTimerManager;
  private serverStats: ServerStats;
  private idleCheckInterval: NodeJS.Timeout;
  private isAdminLoginPending: boolean = false;
  private shutdownTimerActive: boolean = false;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private isLocalClientConnected: boolean = false;
  private localClientSocket: net.Socket | null = null;
  private originalConsoleTransport: any = null;

  constructor() {
    // Initialize server stats
    this.serverStats = {
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

    // Set up update interval for server stats
    setInterval(() => {
      this.serverStats.uptime = Math.floor((Date.now() - this.serverStats.startTime.getTime()) / 1000);
      this.serverStats.connectedClients = this.clientManager.getClients().size;
      this.serverStats.authenticatedUsers = Array.from(this.clientManager.getClients().values()).filter(c => c.authenticated).length;
      this.serverStats.memoryUsage = process.memoryUsage();
    }, config.SERVER_STATS_UPDATE_INTERVAL);

    // Initialize core components
    this.userManager = UserManager.getInstance();
    
    // Create client manager with empty clients map first
    this.clientManager = new ClientManager(this.userManager, RoomManager.getInstance(new Map<string, ConnectedClient>()));
    
    // Now that clientManager exists, get roomManager with client map from it
    this.roomManager = RoomManager.getInstance(this.clientManager.getClients());
    
    this.stateMachine = new StateMachine(this.userManager, this.clientManager.getClients());
    this.commandHandler = new CommandHandler(
      this.clientManager.getClients(),
      this.userManager,
      this.roomManager,
      undefined,
      this.stateMachine
    );
    
    // Set up the state machine and process input function in client manager
    this.clientManager.setStateMachine(this.stateMachine);
    this.clientManager.setProcessInputFunction(this.processInput.bind(this));

    // Initialize game timer manager
    this.gameTimerManager = GameTimerManager.getInstance(this.userManager, this.roomManager);

    // Share the global clients map with SnakeGameState
    SnakeGameState.setGlobalClients(this.clientManager.getClients());

    // Create the API server first (since WebSocket server needs its HTTP server)
    this.apiServer = new APIServer(
      this.clientManager.getClients(),
      this.userManager,
      this.roomManager,
      this.gameTimerManager,
      this.serverStats
    );

    // Create the WebSocket server using the HTTP server from API server
    this.webSocketServer = new WebSocketServer(
      this.apiServer.getHttpServer(),
      this.clientManager.getClients(),
      this.serverStats,
      this.setupClient.bind(this),
      this.clientManager.handleClientData.bind(this.clientManager),
      this.processInput.bind(this)
    );

    // Create the Telnet server
    this.telnetServer = new TelnetServer(
      this.clientManager.getClients(),
      this.userManager,
      this.stateMachine,
      this.commandHandler,
      this.serverStats,
      this.setupClient.bind(this),
      this.processInput.bind(this)
    );

    // Set up idle client check interval
    this.idleCheckInterval = setInterval(() => {
      const config = this.loadMUDConfig();
      const idleTimeoutMinutes = config.game.idleTimeout;
      this.clientManager.checkForIdleClients(idleTimeoutMinutes);
    }, config.IDLE_CHECK_INTERVAL);

    // Setup keyboard listeners for console commands after server is started
    this.setupKeyListener();
  }

  private setupClient(connection: any): void {
    this.clientManager.setupClient(connection);
  }

  private processInput(client: ConnectedClient, input: string): void {
    // Command tracking for stats
    this.serverStats.totalCommands++;
    
    // Trim whitespace from beginning and end of input
    const trimmedInput = input.trim();
    
    // Check for forced transitions (like transfer requests)
    if (client.stateData.forcedTransition) {
      const forcedState = client.stateData.forcedTransition;
      delete client.stateData.forcedTransition;
      this.stateMachine.transitionTo(client, forcedState);
      return;
    }
    
    // Different handling based on the current state
    if (client.authenticated && client.user) {
      // Process command from authenticated user in normal game states
      this.commandHandler.handleCommand(client, trimmedInput);
    } else {
      // Handle authentication via state machine for non-authenticated users
      this.stateMachine.handleInput(client, trimmedInput);
      
      // Check if client should be disconnected (due to too many failed attempts)
      if (client.stateData.disconnect) {
        setTimeout(() => {
          systemLogger.info(`Disconnecting client due to too many failed password attempts`);
          client.connection.end();
        }, 1000); // Brief delay to ensure the error message is sent
      }
    }
  }

  private loadMUDConfig(): any {
    const configPath = path.join(config.DATA_DIR, 'mud-config.json');
    if (fs.existsSync(configPath)) {
      try {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
      } catch (error) {
        systemLogger.error(`Error loading MUD config: ${error}`);
        return {
          game: {
            idleTimeout: 30 // Default idle timeout in minutes
          }
        };
      }
    } else {
      // Create default config
      const defaultConfig = {
        game: {
          idleTimeout: 30 // Default idle timeout in minutes
        }
      };
      
      try {
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
      } catch (error) {
        systemLogger.error(`Error creating default MUD config: ${error}`);
      }
      
      return defaultConfig;
    }
  }

  private async checkAndCreateAdminUser(): Promise<boolean> {
    systemLogger.info('Checking for admin user...');
    
    // Check if admin user exists
    if (!this.userManager.userExists('admin')) {
      // These messages should be shown even in silent mode
      console.log('No admin user found. Creating admin account...');
      console.log('Server startup will halt until admin setup is complete.');
      
      let adminCreated = false;
      
      // Keep trying until the admin is successfully created
      while (!adminCreated) {
        try {
          // Use custom password input that masks the password
          const password = await readPasswordFromConsole('Enter password for new admin user: ');
          
          // Validate password - show this message even in silent mode
          if (password.length < config.MIN_PASSWORD_LENGTH) {
            console.log(`Password must be at least ${config.MIN_PASSWORD_LENGTH} characters long. Please try again.`);
            continue; // Skip the rest of this iteration and try again
          }
          
          // Confirm password with masking
          const confirmPassword = await readPasswordFromConsole('Confirm password: ');
          
          // Check if passwords match - show this message even in silent mode
          if (password !== confirmPassword) {
            console.log('Passwords do not match. Please try again.');
            continue; // Skip the rest of this iteration and try again
          }
          
          // Create admin user
          const success = this.userManager.createUser('admin', password);
          
          if (success) {
            console.log('Admin user created successfully!');
            
            // Create admin directory if it doesn't exist
            const adminDir = path.join(config.DATA_DIR, 'admin');
            if (!fs.existsSync(adminDir)) {
              fs.mkdirSync(adminDir, { recursive: true });
            }
            
            // Create admin.json file with admin user as super admin
            const adminFilePath = path.join(config.DATA_DIR, 'admin.json');
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
              console.log('Admin privileges configured.');
              systemLogger.info('Admin privileges configured.');
              adminCreated = true; // Mark as successfully created so we exit the loop
            } catch (error) {
              console.log('Error creating admin.json file:', error);
              console.log('Failed to create admin configuration. Please try again.');
              systemLogger.error('Error creating admin.json file:', error);
              systemLogger.warn('Failed to create admin configuration. Please try again.');
              // Continue the loop to try again
            }
          } else {
            console.log('Error creating admin user. Please try again.');
            systemLogger.warn('Error creating admin user. Please try again.');
            // Continue the loop to try again
          }
        } catch (error) {
          console.log('Error during admin setup:', error);
          console.log('An error occurred during setup. Please try again.');
          systemLogger.error('Error during admin setup:', error);
          systemLogger.warn('An error occurred during setup. Please try again.');
          // Continue the loop to try again
        }
      }
      
      return true; // Return true since we don't exit the loop until admin is created
    } else {
      systemLogger.info('Admin user already exists.');
      
      // Ensure admin.json exists with the admin user
      const adminFilePath = path.join(config.DATA_DIR, 'admin.json');
      if (!fs.existsSync(adminFilePath)) {
        systemLogger.warn('Creating admin.json file...');
        
        // Create admin directory if it doesn't exist
        const adminDir = path.join(config.DATA_DIR, 'admin');
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

  public setAdminLoginPending(isPending: boolean): void {
    this.isAdminLoginPending = isPending;
    this.telnetServer.setAdminLoginPending(isPending);
  }

  public isShutdownActive(): boolean {
    return this.shutdownTimerActive;
  }

  public scheduleShutdown(minutes: number, reason?: string): void {
    // Cancel any existing timer
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
    }
    
    // Set the flag
    this.shutdownTimerActive = true;
    
    // Send a system message to all users notifying them of the shutdown
    const shutdownMessage = reason
      ? `The server will be shutting down in ${minutes} minute${minutes !== 1 ? 's' : ''}: ${reason}`
      : `The server will be shutting down in ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
      
    const boxedMessage = createSystemMessageBox(shutdownMessage);
    
    // Send to all connected users
    for (const client of this.clientManager.getClients().values()) {
      if (client.authenticated) {
        client.connection.write(boxedMessage);
      }
    }
    
    // Log the scheduled shutdown
    systemLogger.info(`Server shutdown scheduled in ${minutes} minutes${reason ? ': ' + reason : ''}.`);
    
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
          
          for (const client of this.clientManager.getClients().values()) {
            if (client.authenticated) {
              client.connection.write(boxedReminder);
            }
          }
          
          systemLogger.info(`Shutdown reminder: ${remainingMinutes} minutes remaining.`);
        }
        
        // Schedule the next update
        this.shutdownTimer = setTimeout(updateCountdown, 60000); // 1 minute
      } else {
        // Time's up, shut down
        const finalMessage = "The server is shutting down now. Thank you for playing!";
        const boxedFinal = createSystemMessageBox(finalMessage);
        
        for (const client of this.clientManager.getClients().values()) {
          if (client.authenticated) {
            client.connection.write(boxedFinal);
          }
        }
        
        systemLogger.info("Shutdown timer completed. Shutting down server...");
        
        // Give users a moment to see the final message
        setTimeout(() => {
          this.shutdown();
        }, 2000);
      }
    };
      
    // Start the countdown updates if more than 1 minute
    if (minutes > 0) {
      this.shutdownTimer = setTimeout(updateCountdown, 60000); // Start after 1 minute
    } else {
      // Immediate shutdown if minutes is 0
      updateCountdown();
    }
  }

  public cancelShutdown(): void {
    if (!this.shutdownTimerActive) return;
    
    // Cancel the active shutdown timer
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    
    this.shutdownTimerActive = false;
    
    // Send message to all users that shutdown has been aborted
    const abortMessage = "The scheduled server shutdown has been cancelled.";
    const boxedMessage = createSystemMessageBox(abortMessage);
    
    for (const client of this.clientManager.getClients().values()) {
      if (client.authenticated) {
        client.connection.write(boxedMessage);
      }
    }
    
    // Log the abort action
    systemLogger.info('Scheduled shutdown cancelled.');
  }

  public async start(): Promise<void> {
    try {
      // First check and create admin user if needed
      const adminSetupSuccess = await this.checkAndCreateAdminUser();
      if (!adminSetupSuccess) {
        systemLogger.error('Admin setup failed. Server startup aborted.');
        process.exit(1);
      }
      
      systemLogger.info('Admin user verified. Starting server components...');

      // Start the API server first
      await this.apiServer.start();
      
      // Start WebSocket server
      await this.webSocketServer.start();
      
      // Start Telnet server last
      await this.telnetServer.start();
      
      // Start game timer
      this.gameTimerManager.start();
      
      systemLogger.info('Game server started successfully!');
      systemLogger.info(`TELNET: port ${this.telnetServer.getActualPort()}, API/WS: port ${this.apiServer.getActualPort()}`);
      systemLogger.info(`Admin interface: http://localhost:${this.apiServer.getActualPort()}/admin`);
      
      // Setup graceful shutdown handler
      this.setupShutdownHandler();
      
      // Log welcome message with keyboard shortcuts
      this.logWelcomeMessage();
      
      return Promise.resolve();
    } catch (error) {
      systemLogger.error('Error starting game server:', error);
      return Promise.reject(error);
    }
  }

  private logWelcomeMessage(): void {
    if (config.IS_TTY) {
      systemLogger.info('========================================');
      systemLogger.info('           MUD SERVER STARTED          ');
      systemLogger.info('========================================');
      systemLogger.info(`Press 'c' to connect locally, 'a' for admin session`);
      systemLogger.info(`Press 'u' to list users, 'm' to monitor user`);
      systemLogger.info(`Press 's' for system message, 'q' to shutdown`);
      systemLogger.info('========================================');
    }
  }

  private setupShutdownHandler(): void {
    // Setup graceful shutdown to save data and properly clean up
    process.on('SIGINT', () => {
      this.shutdown();
    });
  }

  public shutdown(): void {
    systemLogger.info('Shutting down server...');
    
    // Stop the game timer system
    this.gameTimerManager.stop();
    
    // Clear the idle check interval
    clearInterval(this.idleCheckInterval);
    
    try {
      // Save the data directly instead of using gameTimerManager.forceSave()
      // This avoids the error with this.roomManager.forceSave not being a function
      this.userManager.forceSave();
      this.roomManager.forceSave();
      
      // Log successful save
      systemLogger.info('Game data saved successfully during shutdown');
    } catch (error) {
      systemLogger.error('Error saving data during shutdown:', error);
    }
    
    // Stop server components
    this.telnetServer.stop();
    this.webSocketServer.stop();
    this.apiServer.stop();
    
    // Reset singleton instances
    GameTimerManager.resetInstance();
    
    // Also reset CommandRegistry instance
    const { CommandRegistry } = require('./command/commandRegistry');
    CommandRegistry.resetInstance();
    
    // Exit the process
    systemLogger.info('Server shutdown complete');
    process.exit(0);
  }

  private setupKeyListener(): void {
    // Only set up keyboard shortcuts if we're in a TTY, not in a local session,
    // and console mode isn't explicitly disabled via the --noConsole flag
    if (config.CONSOLE_MODE && !this.isLocalClientConnected) {
      systemLogger.info(`Press 'c' to connect locally, 'a' for admin session, 'u' to list users, 'm' to monitor user, 's' for system message, 'q' to shutdown.`);
      
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
  
        const keyListener = (key: string) => {
          const lowerKey = key.toLowerCase();
          if (lowerKey === 'c') {
            process.stdin.removeListener('data', keyListener);
            this.startLocalClientSession(this.telnetServer.getActualPort());
          } else if (lowerKey === 'a') {
            process.stdin.removeListener('data', keyListener);
            this.startLocalAdminSession(this.telnetServer.getActualPort());
          } else if (lowerKey === 'u') {
            // List all connected users
            console.log("\n=== Connected Users ===");
            let userCount = 0;
            
            this.clientManager.getClients().forEach(client => {
              if (client.authenticated && client.user) {
                const idleTime = Math.floor((Date.now() - client.lastActivity) / 1000);
                console.log(`${client.user.username}: connected for ${Math.floor((Date.now() - client.connectedAt) / 1000)}s, idle for ${idleTime}s`);
                userCount++;
              }
            });
            
            if (userCount === 0) {
              console.log("No authenticated users currently connected.");
            }
            console.log(`Total connections: ${this.clientManager.getClients().size}`);
            console.log("======================\n");
          } else if (lowerKey === 'm') {
            this.startMonitorUserSession(keyListener);
          } else if (lowerKey === 's') {
            this.sendSystemMessage(keyListener);
          } else if (lowerKey === 'q') {
            this.showShutdownOptions(keyListener);
          } else if (key === '\u0003') { // Ctrl+C
            systemLogger.info('Ctrl+C detected. Shutting down server...');
            this.shutdown();
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
      } else {
        systemLogger.info('Not running in a TTY, local client connection disabled.');
      }
    } else if (config.NO_CONSOLE && process.stdout.isTTY) {
      // If console commands are explicitly disabled, set up only a minimal Ctrl+C handler
      // for graceful shutdown, but no other keyboard shortcuts
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      const minimalKeyListener = (key: string) => {
        // Only handle Ctrl+C
        if (key === '\u0003') {
          systemLogger.info('Ctrl+C detected. Shutting down server...');
          this.shutdown();
        }
      };
      
      process.stdin.on('data', minimalKeyListener);
    }
  }

  private startLocalClientSession(port: number): void {
    if (!this.prepareLocalSessionStart()) return;

    this.localClientSocket = new net.Socket();

    // Set up listeners for the new socket
    this.localClientSocket.on('data', (data) => {
      process.stdout.write(data); // Write server output directly to console
    });

    this.localClientSocket.on('close', () => {
      console.log('\nConnection to local server closed.');
      this.endLocalSession();
    });

    this.localClientSocket.on('error', (err) => {
      console.error(`\nLocal connection error: ${err.message}`);
      this.endLocalSession();
    });

    // Connect to the server
    this.localClientSocket.connect(port, 'localhost', () => {
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
            this.endLocalSession();
          } else if (this.localClientSocket && this.localClientSocket.writable) {
            this.localClientSocket.write(key); // Send other keys to the server
          }
        });
      }
    });
  }

  private startLocalAdminSession(port: number): void {
    if (!this.prepareLocalSessionStart()) return;

    this.telnetServer.setAdminLoginPending(true);
    this.localClientSocket = new net.Socket();

    // Set up listeners
    this.localClientSocket.on('data', (data) => {
      process.stdout.write(data);
    });

    this.localClientSocket.on('close', () => {
      console.log('\nAdmin session connection closed.');
      this.endLocalSession();
    });

    this.localClientSocket.on('error', (err) => {
      console.error(`\nLocal admin connection error: ${err.message}`);
      this.telnetServer.setAdminLoginPending(false);
      this.endLocalSession();
    });

    // Connect to the server
    this.localClientSocket.connect(port, 'localhost', () => {
      systemLogger.info(`Local admin client connected to localhost:${port}`);
      console.log(`\nConnected directly as admin on port ${port}.`);

      // Set up stdin
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.on('data', (key) => {
          if (key.toString() === '\u0003') {
            console.log('\nCtrl+C detected. Disconnecting admin session...');
            this.endLocalSession();
          } else if (this.localClientSocket && this.localClientSocket.writable) {
            this.localClientSocket.write(key);
          }
        });
      }
    });
  }

  private prepareLocalSessionStart(): boolean {
    if (this.isLocalClientConnected || !process.stdin.isTTY) return false;

    this.isLocalClientConnected = true;
    systemLogger.info("Attempting to start local session...");

    // Pause the main key listener
    process.stdin.removeAllListeners('data');

    // Find and remove the console transport
    const winston = require('winston');
    const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
    if (consoleTransport) {
      this.originalConsoleTransport = consoleTransport;
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

  private endLocalSession(): void {
    if (!this.isLocalClientConnected) return;

    systemLogger.info('Ending local session...');

    // Clean up socket
    if (this.localClientSocket) {
      this.localClientSocket.removeAllListeners();
      this.localClientSocket.destroy();
      this.localClientSocket = null;
    }

    // Restore console logging
    const winston = require('winston');
    if (this.originalConsoleTransport && !systemLogger.transports.some((t: any) => t === this.originalConsoleTransport)) {
      systemLogger.add(this.originalConsoleTransport);
      systemLogger.info('Console logging restored.');
      this.originalConsoleTransport = null;
    }

    // Remove the specific listener for the session
    process.stdin.removeAllListeners('data');

    // Set stdin back to normal mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    this.isLocalClientConnected = false;
    this.telnetServer.setAdminLoginPending(false);
    
    // Only show the message if we're not in silent mode
    if (!config.SILENT_MODE) {
      console.log("\nLocal session ended. Log output resumed.");
    }

    // Re-enable the listener for the keys
    this.setupKeyListener();
  }

  private startMonitorUserSession(keyListener: (key: string) => void): void {
    // Remove the key listener temporarily
    process.stdin.removeListener('data', keyListener);
    
    // Pause console logging
    const winston = require('winston');
    let monitorConsoleTransport: any = null;
    const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
    if (consoleTransport) {
      monitorConsoleTransport = consoleTransport;
      systemLogger.remove(consoleTransport);
      console.log("\nConsole logging paused. Starting user monitoring...");
    }
    
    // Get authenticated users for monitoring
    const authenticatedUsers: string[] = [];
    this.clientManager.getClients().forEach((client => {
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
        
        this.clientManager.getClients().forEach((client, clientId) => {
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
        this.startMonitoringSession(targetClient, targetClientId, selectedUsername, monitorConsoleTransport, keyListener);
      }
    };
    
    // Listen for user selection input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('data', userSelectionHandler);
  }

  private startMonitoringSession(
    targetClient: ConnectedClient, 
    targetClientId: string, 
    username: string, 
    monitorConsoleTransport: any, 
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
        const promptText = this.getPromptText(targetClient);
        targetClient.connection.write(promptText);
        if (targetClient.buffer.length > 0) {
          targetClient.connection.write(targetClient.buffer);
        }
      }
      
      // Remove sudo access if it was granted
      if (userSudoEnabled && targetClient.user) {
        // Use the static activeAdmins Set directly since setUserAdminStatus doesn't exist
        const { SudoCommand } = require('./command/commands/sudo.command');
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
        const promptText = this.getPromptText(targetClient);
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
              const promptText = this.getPromptText(targetClient);
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
            this.processInput(targetClient, command);
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
            targetClient.connection.write(boxedMessage);
            
            // Re-display the prompt
            const promptText = this.getPromptText(targetClient);
            targetClient.connection.write(promptText);
            if (targetClient.buffer.length > 0) {
              targetClient.connection.write(targetClient.buffer);
            }
            
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
          const { SudoCommand } = require('./command/commands/sudo.command');
          (SudoCommand as any).activeAdmins.add(targetClient.user.username.toLowerCase());
          console.log(`\nGranted temporary sudo access to ${username}.`);
          targetClient.connection.write('\r\n\x1b[33mAn admin has granted you temporary sudo access.\x1b[0m\r\n');
          
          // Log the action
          systemLogger.info(`Admin granted temporary sudo access to user: ${username}`);
        } else {
          // Remove sudo access using SudoCommand system
          const { SudoCommand } = require('./command/commands/sudo.command');
          (SudoCommand as any).activeAdmins.delete(targetClient.user.username.toLowerCase());
          console.log(`\nRemoved sudo access from ${username}.`);
          targetClient.connection.write('\r\n\x1b[33mYour temporary sudo access has been revoked.\x1b[0m\r\n');
          
          // Log the action
          systemLogger.info(`Admin removed sudo access from user: ${username}`);
        }
        
        // Re-display the prompt for the user
        const promptText = this.getPromptText(targetClient);
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

  private sendSystemMessage(keyListener: (key: string) => void): void {
    // Remove the key listener temporarily
    process.stdin.removeListener('data', keyListener);
    
    // Pause console logging temporarily like we do for local client sessions
    const winston = require('winston');
    let messageConsoleTransport: any = null;
    const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
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
        this.clientManager.getClients().forEach(client => {
          if (client.authenticated) {
            client.connection.write(boxedMessage);
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
  }

  private showShutdownOptions(keyListener: (key: string) => void): void {
    // Rather than immediate shutdown, show shutdown options
    process.stdin.removeListener('data', keyListener);
    
    // Pause console logging
    const winston = require('winston');
    let shutdownConsoleTransport: any = null;
    const consoleTransport = systemLogger.transports.find((t: any) => t instanceof winston.transports.Console);
    if (consoleTransport) {
      shutdownConsoleTransport = consoleTransport;
      systemLogger.remove(consoleTransport);
    }
    
    console.log("\n=== Shutdown Options ===");
    console.log("  q: Shutdown immediately");
    console.log("  m: Shutdown with message");
    console.log("  t: Shutdown timer");
    // Show abort option only if a shutdown timer is active
    if (this.shutdownTimerActive && this.shutdownTimer) {
      console.log("  a: Abort current shutdown");
    }
    console.log("  c: Cancel");
    
    // Create a special key handler for the shutdown menu
    const shutdownMenuHandler = (shutdownKey: string) => {
      const shutdownOption = shutdownKey.toLowerCase();
      
      if (shutdownOption === 'q') {
        // Immediate shutdown - original behavior
        console.log("\nShutting down server by request...");
        this.shutdown();
      } 
      else if (shutdownOption === 't') {
        // Remove the shutdown menu handler
        process.stdin.removeListener('data', shutdownMenuHandler);
        
        // Set initial timer value
        let shutdownMinutes = 5;
        
        // Show timer input
        this.showShutdownTimerPrompt(shutdownMinutes);
        
        // Handle timer value changes
        const timerInputHandler = (timerKey: string) => {
          if (timerKey === '\u0003') {
            // Ctrl+C cancels and returns to regular operation
            this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
          }
          else if (timerKey.toLowerCase() === 'c') {
            // Cancel timer
            this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
          }
          else if (timerKey === '\r' || timerKey === '\n') {
            // Enter confirms the timer
            process.stdin.removeListener('data', timerInputHandler);
            
            // Start the shutdown timer
            this.scheduleShutdown(shutdownMinutes);
            
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
            this.showShutdownTimerPrompt(shutdownMinutes);
          }
          else if (timerKey === '\u001b[B' || timerKey === '[B' || timerKey === '\u001bOB' || timerKey === 'OB') {
            // Down arrow - decrement by 1
            shutdownMinutes = Math.max(1, shutdownMinutes - 1);
            this.showShutdownTimerPrompt(shutdownMinutes);
          }
          else if (timerKey === '\u001b[1;2A' || timerKey === '[1;2A') {
            // Shift+Up arrow - increment by 10
            shutdownMinutes = Math.max(1, shutdownMinutes + 10);
            this.showShutdownTimerPrompt(shutdownMinutes);
          }
          else if (timerKey === '\u001b[1;2B' || timerKey === '[1;2B') {
            // Shift+Down arrow - decrement by 10
            shutdownMinutes = Math.max(1, shutdownMinutes - 10);
            this.showShutdownTimerPrompt(shutdownMinutes);
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
            this.clientManager.getClients().forEach(client => {
              if (client.authenticated) {
                client.connection.write(boxedMessage);
                sentCount++;
              }
            });
            
            console.log(`Message sent to ${sentCount} users.`);
            
            // Log the message
            systemLogger.info(`Shutdown message broadcast: "${message}"`);
            
            // Give users a moment to read the message, then shutdown
            console.log("Shutting down in 5 seconds...");
            setTimeout(() => {
              this.shutdown();
            }, 5000);
          } else {
            console.log("Message was empty. Proceeding with immediate shutdown...");
            this.shutdown();
          }
        });
      }
      else if (shutdownOption === 'a' && this.shutdownTimerActive && this.shutdownTimer) {
        // Abort the current shutdown timer
        console.log("\nAborting current shutdown timer...");
        this.cancelShutdown();
        
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
      }
      else if (shutdownOption === 'c') {
        // Cancel shutdown
        this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
      }
      else if (shutdownKey === '\u0003') {
        // Ctrl+C cancels and returns to regular operation
        this.cancelShutdownAndRestoreLogging(shutdownConsoleTransport, keyListener);
      }
      else {
        // Any other key - just redisplay the options
        console.log(`\nUnrecognized option (${shutdownOption})`);
        console.log("\n=== Shutdown Options ===");
        console.log("  q: Shutdown immediately");
        console.log("  m: Shutdown with message");
        console.log("  t: Shutdown timer");
        // Show abort option only if a shutdown timer is active
        if (this.shutdownTimerActive && this.shutdownTimer) {
          console.log("  a: Abort current shutdown");
        }
        console.log("  c: Cancel");
      }
    };
    
    // Listen for shutdown menu input
    process.stdin.on('data', shutdownMenuHandler);
  }

  private showShutdownTimerPrompt(minutes: number): void {
    // Clear the line and return to the beginning using ANSI codes
    process.stdout.write('\r\x1B[2K'); // \r: carriage return, \x1B[2K: clear entire line
    process.stdout.write(`Shutdown when? In \x1b[47m\x1b[30m${minutes}\x1b[0m minute${minutes === 1 ? '' : 's'}. (Enter to confirm, 'c' to cancel)`);
  }

  private cancelShutdownAndRestoreLogging(consoleTransport: any, keyListener: (key: string) => void): void {
    // Cancel any active shutdown timer
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    
    this.shutdownTimerActive = false;
    
    console.log("\nShutdown cancelled.");
    
    // Restore console logging
    if (consoleTransport) {
      systemLogger.add(consoleTransport);
      systemLogger.info('Console logging restored. Shutdown cancelled.');
    }
    
    // If a shutdown was in progress, notify users
    if (this.shutdownTimerActive) {
      const cancelMessage = "The scheduled server shutdown has been cancelled.";
      const boxedMessage = createSystemMessageBox(cancelMessage);
      
      this.clientManager.getClients().forEach(client => {
        if (client.authenticated) {
          client.connection.write(boxedMessage);
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
  
  // Helper to get prompt text function now just forwards to the imported function
  private getPromptText(client: ConnectedClient): string {
    return getPromptText(client);
  }

  public async startAutoAdminSession(): Promise<void> {
    // Suppress normal console output for automated sessions
    this.suppressNormalOutput();
    
    // Allow the server a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Start an admin session
    this.startLocalAdminSession(this.telnetServer.getActualPort());
    
    // Set up auto-exit when the session ends
    this.setupAutoExit();
  }

  public async startAutoUserSession(): Promise<void> {
    // Suppress normal console output for automated sessions
    this.suppressNormalOutput();
    
    // Allow the server a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Start a local client session
    this.startLocalClientSession(this.telnetServer.getActualPort());
    
    // Set up auto-exit when the session ends
    this.setupAutoExit();
  }

  private suppressNormalOutput(): void {
    // Don't show the welcome message or keyboard instructions
    // Need to preserve the original method structure for type compatibility
    const originalInfo = systemLogger.info;
    systemLogger.info = function() {
      // No-op function that maintains the return type
      return systemLogger;
    };
  }

  private setupAutoExit(): void {
    // Override the endLocalSession method to exit when session ends
    const originalEndLocalSession = this.endLocalSession.bind(this);
    this.endLocalSession = () => {
      originalEndLocalSession();
      
      // Give time for cleanup before exit
      setTimeout(() => {
        systemLogger.info('Auto-session ended, shutting down server');
        process.exit(0);
      }, 100);
    };
  }
}

// When this file is run directly, start the server
if (require.main === module) {
  const gameServer = new GameServer();
  gameServer.start().catch(error => {
    systemLogger.error('Failed to start game server:', error);
    process.exit(1);
  });
}

export default GameServer;
import path from 'path';
import fs from 'fs';
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
import { getPromptText } from './utils/promptFormatter'; // Import the getPromptText function
import { SnakeGameState } from './states/snake-game.state';
import { WaitingState } from './states/waiting.state';
import { LocalSessionManager } from './console/localSessionManager';
import { ConsoleManager } from './console/consoleManager';
import { UserMonitor } from './console/userMonitor';
import { UserAdminMenu } from './console/userAdminMenu';
import { ShutdownManager } from './server/shutdownManager';
import { isDebugMode } from './utils/debugUtils'; // Import the isDebugMode function
import { clearSessionReferenceFile } from './utils/fileUtils'; // Import the clearSessionReferenceFile function
import config from './config';

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
  private shutdownTimerActive: boolean = false;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private consoleManager: ConsoleManager;
  private localSessionManager: LocalSessionManager;
  private userMonitor: UserMonitor;
  private userAdminMenu: UserAdminMenu;
  private shutdownManager: ShutdownManager;

  constructor() {
    try {
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
        this.serverStats.connectedClients = this.clientManager?.getClients().size || 0;
        this.serverStats.authenticatedUsers = Array.from(this.clientManager?.getClients().values() || []).filter(c => c.authenticated).length;
        this.serverStats.memoryUsage = process.memoryUsage();
      }, config.SERVER_STATS_UPDATE_INTERVAL);

      // Initialize core components
      this.userManager = UserManager.getInstance();
      
      // Create client manager with empty clients map first
      this.clientManager = ClientManager.getInstance(this.userManager, RoomManager.getInstance(new Map<string, ConnectedClient>()));
      
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
      
      // Share the global clients map with WaitingState
      WaitingState.setGlobalClients(this.clientManager.getClients());

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

      // Create the ShutdownManager
      this.shutdownManager = new ShutdownManager(
        this.clientManager,
        this
      );

      // Create the ConsoleManager with all required parameters
      this.consoleManager = new ConsoleManager(
        this,
        this.telnetServer,
        this.clientManager,
        this.userManager,
        this.commandHandler,
        this.shutdownManager
      );

      // Create the LocalSessionManager
      this.localSessionManager = new LocalSessionManager(
        this.consoleManager,
        this.telnetServer
      );

      // Create UserMonitor with correct parameters
      this.userMonitor = new UserMonitor(
        this.clientManager,
        () => this.consoleManager.setupKeyListener(),
        this.commandHandler
      );

      // Create UserAdminMenu with correct parameters
      this.userAdminMenu = new UserAdminMenu(
        this.userManager,
        this.clientManager,
        this.commandHandler,
        this.localSessionManager,
        this.telnetServer,
        this,
        () => this.consoleManager.setupKeyListener()
      );

      // Set up idle client check interval
      this.idleCheckInterval = setInterval(() => {
        const config = this.loadMUDConfig();
        const idleTimeoutMinutes = config.game.idleTimeout;
        this.clientManager.checkForIdleClients(idleTimeoutMinutes);
      }, config.IDLE_CHECK_INTERVAL);

      // Setup keyboard listeners for console commands after server is started
      // We delegate this now to the ConsoleManager
    } catch (error) {
      // Log the full error details to system log but not to console
      systemLogger.error('Fatal error during GameServer initialization:', error);
      
      // Re-throw the error to be handled by the main function's catch block
      // This ensures we have a centralized place for user-friendly error messages
      throw error;
    }
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
    this.telnetServer.setAdminLoginPending(isPending);
  }

  public isShutdownActive(): boolean {
    return this.shutdownManager.isShutdownActive();
  }

  public scheduleShutdown(minutes: number, reason?: string): void {
    this.shutdownManager.scheduleShutdown(minutes, reason);
  }

  public cancelShutdown(): void {
    this.shutdownManager.cancelShutdown();
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

      // Clear the last-session.md file if debug mode is enabled
      if (isDebugMode()) {
        // clearSessionReferenceFile is now statically imported at the top
        clearSessionReferenceFile();
        systemLogger.info('Cleared last-session.md file (debug mode enabled)');
      }

      // Start the API server first
      await this.apiServer.start();
      
      // Start WebSocket server
      await this.webSocketServer.start();
      
      // Start Telnet server last
      await this.telnetServer.start();
      
      // Start game timer
      this.gameTimerManager.start();
      
      // Initialize the ConsoleManager - this replaces the direct setupKeyListener call
      if (config.CONSOLE_MODE) {
        this.consoleManager.setupKeyListener();
      }
      
      systemLogger.info('Game server started successfully!');
      systemLogger.info(`TELNET: port ${this.telnetServer.getActualPort()}, API/WS: port ${this.apiServer.getActualPort()}`);
      systemLogger.info(`Admin interface: http://localhost:${this.apiServer.getActualPort()}/admin`);
      
      // Setup graceful shutdown handler
      this.setupShutdownHandler();
      
      // Log welcome message with keyboard shortcuts using ConsoleManager
      this.consoleManager.logWelcomeMessage();
      
      return Promise.resolve();
    } catch (error) {
      systemLogger.error('Error starting game server:', error);
      return Promise.reject(error);
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

  // Redirect console interface methods to the appropriate modules
  // These act as pass-through methods to maintain compatibility with
  // any code that might be calling these methods directly on GameServer

  public startLocalClientSession(port: number): void {
    this.localSessionManager.startLocalClientSession(port);
  }

  public startLocalAdminSession(port: number): void {
    this.localSessionManager.startLocalAdminSession(port);
  }

  public startLocalUserSession(port: number, username?: string): void {
    this.localSessionManager.startLocalUserSession(port, username);
  }

  public startForcedSession(port: number, username: string): Promise<void> {
    return this.localSessionManager.startForcedSession(port, username);
  }

  public endLocalSession(): void {
    this.localSessionManager.endLocalSession();
  }

  public startMonitorUserSession(): void {
    this.userMonitor.startMonitorUserSession();
  }

  public startUserAdminMenu(): void {
    this.userAdminMenu.startUserAdminMenu();
  }

  public sendSystemMessage(): void {
    this.consoleManager.sendSystemMessage();
  }

  public showShutdownOptions(): void {
    this.consoleManager.showShutdownOptions();
  }

  /**
   * Get the actual Telnet port the server is running on
   */
  public getTelnetPort(): number {
    return this.telnetServer.getActualPort();
  }

  // For automated sessions - delegate to LocalSessionManager
  public async startAutoAdminSession(): Promise<void> {
    // Suppress normal console output for automated sessions
    this.suppressNormalOutput();
    
    // Allow the server a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Start an admin session
    this.localSessionManager.startLocalAdminSession(this.telnetServer.getActualPort());
    
    // Set up auto-exit when the session ends
    this.setupAutoExit();
  }

  public async startAutoUserSession(): Promise<void> {
    // Suppress normal console output for automated sessions
    this.suppressNormalOutput();
    
    // Allow the server a moment to initialize
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Start a local client session
    this.localSessionManager.startLocalClientSession(this.telnetServer.getActualPort());
    
    // Set up auto-exit when the session ends
    this.setupAutoExit();
  }

  /**
   * Start a forced session as a specific user via CLI --forceSession, with auto-exit on quit or Ctrl+C
   */
  public async startAutoForcedSession(username: string): Promise<void> {
    // Suppress normal console output for automated sessions
    this.suppressNormalOutput();

    // Brief delay to let the server initialize
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start the forced session
    await this.localSessionManager.startForcedSession(this.telnetServer.getActualPort(), username);

    // Auto-exit when the session ends
    this.setupAutoExit();
  }

  private suppressNormalOutput(): void {
    // Don't show the welcome message or keyboard instructions
    // Need to preserve the original method structure for type compatibility
    systemLogger.info = function() {
      // No-op function that maintains the return type
      return systemLogger;
    };
  }

  private setupAutoExit(): void {
    // Override the endLocalSession method to exit when session ends
    const originalEndLocalSession = this.localSessionManager.endLocalSession.bind(this.localSessionManager);
    this.localSessionManager.endLocalSession = () => {
      originalEndLocalSession();
      
      // Give time for cleanup before exit
      setTimeout(() => {
        systemLogger.info('Auto-session ended, shutting down server');
        process.exit(0);
      }, 100);
    };
  }

  // Helper to get prompt text function now just forwards to the imported function
  public getPromptText(client: ConnectedClient): string {
    return getPromptText(client);
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
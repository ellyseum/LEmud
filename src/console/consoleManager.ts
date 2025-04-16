import { GameServer } from '../app';
import { TelnetServer } from '../server/telnetServer';
import { ClientManager } from '../client/clientManager';
import { UserManager } from '../user/userManager';
import { CommandHandler } from '../command/commandHandler';
import { ShutdownManager } from '../server/shutdownManager';
import { systemLogger } from '../utils/logger';
import { LocalSessionManager } from './localSessionManager';
import { UserMonitor } from './userMonitor';
import { UserAdminMenu } from './userAdminMenu';
import { ConsoleInterface } from './consoleInterface';
import { AutoSessionHandler } from './autoSessionHandler';
import config from '../config';

/**
 * ConsoleManager orchestrates all console-related functionality
 * This class has been refactored to delegate specific tasks to specialized components
 */
export class ConsoleManager {
  // Core game components
  private gameServer: GameServer;
  private telnetServer: TelnetServer;
  private clientManager: ClientManager;
  private userManager: UserManager;
  private commandHandler: CommandHandler;
  private shutdownManager: ShutdownManager;
  
  // Specialized console components - initialize with default values to satisfy TypeScript
  private localSessionManager!: LocalSessionManager;
  private userMonitor!: UserMonitor; 
  private userAdminMenu!: UserAdminMenu;
  private consoleInterface!: ConsoleInterface;
  private autoSessionHandler!: AutoSessionHandler;

  constructor(
    gameServer: GameServer,
    telnetServer: TelnetServer,
    clientManager: ClientManager,
    userManager: UserManager,
    commandHandler: CommandHandler,
    shutdownManager: ShutdownManager
  ) {
    this.gameServer = gameServer;
    this.telnetServer = telnetServer;
    this.clientManager = clientManager;
    this.userManager = userManager;
    this.commandHandler = commandHandler;
    this.shutdownManager = shutdownManager;
    
    // Initialize components immediately in the constructor
    this.initializeComponents();
  }

  private initializeComponents(): void {
    // Initialize all specialized components
    
    // LocalSessionManager - handles local client sessions
    this.localSessionManager = new LocalSessionManager(this, this.telnetServer);
    
    // ConsoleInterface - handles keyboard shortcuts and main menu
    this.consoleInterface = new ConsoleInterface(
      this.gameServer,
      this.shutdownManager,
      this.clientManager,
      this.handleKeyCommand.bind(this)
    );
    
    // UserMonitor - handles monitoring user sessions
    this.userMonitor = new UserMonitor(
      this.clientManager,
      this.gameServer,
      () => this.consoleInterface.setupKeyListener(),
      this.commandHandler
    );
    
    // UserAdminMenu - handles user administration
    this.userAdminMenu = new UserAdminMenu(
      this.userManager,
      this.clientManager,
      this.commandHandler,
      this.localSessionManager,
      this.telnetServer,
      this.gameServer,
      () => this.consoleInterface.setupKeyListener()
    );
    
    // AutoSessionHandler - handles CLI auto-sessions
    this.autoSessionHandler = new AutoSessionHandler(
      this.localSessionManager,
      this.telnetServer
    );
  }

  /**
   * Set up the main keyboard shortcuts listener
   */
  public setupKeyListener(): void {
    this.consoleInterface.setupKeyListener();
  }

  /**
   * Remove the main key listener (to be used by components temporarily)
   */
  public removeMainKeyListener(): void {
    this.consoleInterface.removeMainKeyListener();
  }

  /**
   * Handle key commands from the console interface
   */
  private handleKeyCommand(command: string): void {
    switch(command) {
      case 'c':
        this.localSessionManager.startLocalClientSession(this.telnetServer.getActualPort());
        break;
      case 'a':
        this.removeMainKeyListener();
        this.localSessionManager.startLocalAdminSession(this.telnetServer.getActualPort());
        break;
      case 'u':
        this.removeMainKeyListener();
        this.userAdminMenu.startUserAdminMenu();
        break;
      case 'm':
        this.removeMainKeyListener();
        this.userMonitor.startMonitorUserSession();
        break;
      case 's':
        this.removeMainKeyListener();
        this.consoleInterface.sendSystemMessage();
        break;
      case 'q':
        this.removeMainKeyListener();
        this.consoleInterface.showShutdownOptions();
        break;
    }
  }

  /**
   * Start a local user session (for regular users)
   */
  public startLocalUserSession(port: number, username?: string): void {
    this.localSessionManager.startLocalUserSession(port, username);
  }

  /**
   * Start a local admin session
   */
  public startLocalAdminSession(port: number): void {
    this.localSessionManager.startLocalAdminSession(port);
  }

  /**
   * Start an auto-admin session (for CLI mode)
   */
  public async startAutoAdminSession(): Promise<void> {
    return this.autoSessionHandler.startAutoAdminSession();
  }

  /**
   * Start an auto-user session (for CLI mode)
   */
  public async startAutoUserSession(): Promise<void> {
    return this.autoSessionHandler.startAutoUserSession();
  }

  /**
   * Start an auto-forced session (for CLI mode)
   */
  public async startAutoForcedSession(username: string): Promise<void> {
    return this.autoSessionHandler.startAutoForcedSession(username);
  }

  /**
   * Send a system message to all users
   */
  public sendSystemMessage(): void {
    this.consoleInterface.sendSystemMessage();
  }

  /**
   * Show shutdown options menu
   */
  public showShutdownOptions(): void {
    this.consoleInterface.showShutdownOptions();
  }

  /**
   * Display welcome message
   */
  public logWelcomeMessage(): void {
    this.consoleInterface.logWelcomeMessage();
  }
}

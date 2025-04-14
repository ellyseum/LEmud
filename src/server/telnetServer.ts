import net from 'net';
import { systemLogger } from '../utils/logger';
import { TelnetConnection } from '../connection/telnet.connection';
import { ConnectedClient, ServerStats } from '../types';
import { UserManager } from '../user/userManager';
import { StateMachine } from '../state/stateMachine';
import { CommandHandler } from '../command/commandHandler';
import { ClientStateType } from '../types';
import config from '../config';

export class TelnetServer {
  private server: net.Server;
  private clients: Map<string, ConnectedClient>;
  private userManager: UserManager;
  private stateMachine: StateMachine;
  private commandHandler: CommandHandler;
  private serverStats: ServerStats;
  private isAdminLoginPending: boolean = false;
  private actualPort: number = config.TELNET_PORT;

  constructor(
    clients: Map<string, ConnectedClient>,
    userManager: UserManager,
    stateMachine: StateMachine,
    commandHandler: CommandHandler,
    serverStats: ServerStats,
    setupClientFn: (connection: any) => void,
    processInputFn: (client: ConnectedClient, input: string) => void
  ) {
    this.clients = clients;
    this.userManager = userManager;
    this.stateMachine = stateMachine;
    this.commandHandler = commandHandler;
    this.serverStats = serverStats;

    // Create TELNET server
    this.server = net.createServer((socket) => {
      // Check if this connection is the pending admin login
      if (this.isAdminLoginPending) {
        this.isAdminLoginPending = false; // Reset flag immediately
        systemLogger.info(`Incoming connection flagged as direct admin login.`);
        
        // Create the connection wrapper
        const connection = new TelnetConnection(socket);
        
        // Setup client normally first
        setupClientFn(connection);
        
        // Get the client ID
        const clientId = connection.getId();
        const client = this.clients.get(clientId);
        
        if (client) {
          // Set a special flag in stateData for the state machine to handle
          client.stateData.directAdminLogin = true;
          
          // Have the state machine transition immediately to CONNECTING first
          // to ensure everything is initialized properly
          this.stateMachine.transitionTo(client, ClientStateType.CONNECTING);
          
          systemLogger.info(`Direct admin login initialized for connection: ${clientId}`);
          
          // Send welcome banner
          connection.write('========================================\r\n');
          connection.write('       DIRECT ADMIN LOGIN\r\n');
          connection.write('========================================\r\n\r\n');
          
          // Delay slightly to allow telnet negotiation to complete
          setTimeout(() => {
            // Login as admin user bypassing normal flow
            // This simulates the user typing "admin" at the login prompt
            processInputFn(client, 'admin');
            
            // Force authentication immediately, bypassing password check
            client.authenticated = true;
            
            // Set up admin user data
            const adminData = this.userManager.getUser('admin');
            if (adminData) {
              client.user = adminData;
              this.userManager.registerUserSession('admin', client);
              
              // Transition to authenticated state
              this.stateMachine.transitionTo(client, ClientStateType.AUTHENTICATED);
              
              // Log the direct admin login
              systemLogger.info(`Admin user directly logged in via console shortcut.`);
              
              // Notify admin of successful login
              connection.write('\r\nDirectly logged in as admin. Welcome!\r\n\r\n');
              
              // Execute the "look" command to help admin orient
              setTimeout(() => {
                processInputFn(client, 'look');
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
        setupClientFn(connection);
        
        // Track total connections
        this.serverStats.totalConnections++;
      }
    });

    // Add error handler
    this.server.on('error', (err: Error & {code?: string}) => {
      if (err.code === 'EADDRINUSE') {
        systemLogger.error(`Port ${config.TELNET_PORT} is already in use. Is another instance running?`);
        systemLogger.info(`Trying alternative port ${config.TELNET_PORT + 1}...`);
        this.actualPort = config.TELNET_PORT + 1;
        this.server.listen(this.actualPort);
      } else {
        systemLogger.error('TELNET server error:', err);
      }
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(config.TELNET_PORT, () => {
        const address = this.server.address();
        if (address && typeof address !== 'string') {
          this.actualPort = address.port;
          systemLogger.info(`TELNET server running on port ${address.port}`);
        } else {
          systemLogger.info(`TELNET server running`);
        }
        resolve();
      });
    });
  }

  public setAdminLoginPending(isPending: boolean): void {
    this.isAdminLoginPending = isPending;
  }

  public getActualPort(): number {
    return this.actualPort;
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        systemLogger.info('TELNET server stopped');
        resolve();
      });
    });
  }
}
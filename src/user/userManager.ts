import fs from 'fs';
import path from 'path';
import { User, ConnectedClient, ClientStateType } from '../types';
import { writeToClient, flushClientBuffer } from '../utils/socketWriter';
import { colorize } from '../utils/colors';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export class UserManager {
  private users: User[] = [];
  private activeUserSessions: Map<string, ConnectedClient> = new Map();
  private pendingTransfers: Map<string, ConnectedClient> = new Map();

  constructor() {
    this.loadUsers();
  }

  private loadUsers(): void {
    try {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      // Create users file if it doesn't exist
      if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
        return;
      }

      const data = fs.readFileSync(USERS_FILE, 'utf8');
      this.users = JSON.parse(data);
      
      // Ensure dates are properly parsed
      this.users.forEach(user => {
        if (typeof user.joinDate === 'string') {
          user.joinDate = new Date(user.joinDate);
        }
        if (typeof user.lastLogin === 'string') {
          user.lastLogin = new Date(user.lastLogin);
        }
      });
    } catch (error) {
      console.error('Error loading users:', error);
      this.users = [];
    }
  }

  private saveUsers(): void {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Error saving users:', error);
    }
  }

  public getUser(username: string): User | undefined {
    return this.users.find(user => user.username.toLowerCase() === username.toLowerCase());
  }

  public userExists(username: string): boolean {
    return this.users.some(user => user.username.toLowerCase() === username.toLowerCase());
  }

  public authenticateUser(username: string, password: string): boolean {
    const user = this.getUser(username);
    return user !== undefined && user.password === password;
  }

  public isUserActive(username: string): boolean {
    return this.activeUserSessions.has(username.toLowerCase());
  }

  public getActiveUserSession(username: string): ConnectedClient | undefined {
    return this.activeUserSessions.get(username.toLowerCase());
  }

  public registerUserSession(username: string, client: ConnectedClient): void {
    this.activeUserSessions.set(username.toLowerCase(), client);
    // Clear any pending transfers for this user
    this.pendingTransfers.delete(username.toLowerCase());
  }

  public unregisterUserSession(username: string): void {
    this.activeUserSessions.delete(username.toLowerCase());
    // Also clean up any pending transfers
    this.pendingTransfers.delete(username.toLowerCase());
  }

  // Request a transfer of the session for the user
  public requestSessionTransfer(username: string, newClient: ConnectedClient): boolean {
    const lowerUsername = username.toLowerCase();
    
    // Get the existing client session
    const existingClient = this.activeUserSessions.get(lowerUsername);
    if (!existingClient) return false;
    
    // Store the pending transfer request
    this.pendingTransfers.set(lowerUsername, newClient);
    
    // Save the current state and previous state for restoring if denied
    newClient.stateData.previousState = newClient.state;
    newClient.stateData.waitingForTransfer = true;
    newClient.stateData.transferUsername = username;
    
    // Interrupt the existing client with a transfer request through the state machine
    existingClient.stateData.forcedTransition = ClientStateType.TRANSFER_REQUEST;
    existingClient.stateData.transferClient = newClient;
    
    // Send an immediate notification to the existing client to check for state changes
    this.notifyClient(existingClient);
    
    return true;
  }
  
  // Helper method to notify a client to check their state
  private notifyClient(client: ConnectedClient): void {
    // Force the client to process the output buffer, which will trigger state checks
    writeToClient(client, '');
    flushClientBuffer(client);
  }

  // Approve or deny a session transfer
  public resolveSessionTransfer(username: string, approved: boolean): void {
    const lowerUsername = username.toLowerCase();
    const newClient = this.pendingTransfers.get(lowerUsername);
    const existingClient = this.activeUserSessions.get(lowerUsername);
    
    if (!newClient || !existingClient) return;
    
    if (approved) {
      // Inform the existing client they're being disconnected
      writeToClient(existingClient, colorize('\r\n\r\nYou approved the session transfer. Disconnecting...\r\n', 'yellow'));
      
      // Save the user state before disconnecting
      if (existingClient.user) {
        this.updateUserStats(username, { lastLogin: new Date() });
      }
      
      // IMPORTANT: Explicitly unregister the existing session first
      this.unregisterUserSession(username);
      
      // Get the user object
      const user = this.getUser(username);
      if (user) {
        // Set up the new client
        newClient.user = user;
        newClient.authenticated = true;
        newClient.stateData.waitingForTransfer = false;
        
        // Update last login time
        this.updateLastLogin(username);
        
        // Register the new session (will replace the existing one)
        this.registerUserSession(username, newClient);
        
        // Inform the new client they can proceed
        writeToClient(newClient, colorize('\r\n\r\nSession transfer approved. Logging in...\r\n', 'green'));
        
        // Transition the new client to authenticated state
        newClient.stateData.transitionTo = ClientStateType.AUTHENTICATED;
      }
      
      // Disconnect the existing client after a brief delay
      setTimeout(() => {
        // Mark the client as no longer authenticated to prevent re-registration on disconnect
        existingClient.authenticated = false;
        existingClient.user = null;
        existingClient.connection.end();
      }, 1000);
      
    } else {
      // Transfer denied - restore the new client to previous state
      newClient.stateData.waitingForTransfer = false;
      writeToClient(newClient, colorize('\r\n\r\nSession transfer was denied by the active user.\r\n', 'red'));
      newClient.stateData.transitionTo = ClientStateType.LOGIN;
      
      // Restore the existing client
      existingClient.state = existingClient.stateData.returnToState || ClientStateType.AUTHENTICATED;
      delete existingClient.stateData.interruptedBy;
      delete existingClient.stateData.transferClient;
      writeToClient(existingClient, colorize('\r\n\r\nYou denied the session transfer. Continuing your session.\r\n', 'green'));
    }
    
    // Clean up the pending transfer
    this.pendingTransfers.delete(lowerUsername);
  }

  // Cancel a pending transfer (e.g., if one of the clients disconnects)
  public cancelTransfer(username: string): void {
    const lowerUsername = username.toLowerCase();
    const newClient = this.pendingTransfers.get(lowerUsername);
    const existingClient = this.activeUserSessions.get(lowerUsername);
    
    if (newClient) {
      newClient.stateData.waitingForTransfer = false;
      writeToClient(newClient, colorize('\r\n\r\nSession transfer was cancelled.\r\n', 'red'));
      newClient.stateData.transitionTo = ClientStateType.LOGIN;
    }
    
    if (existingClient && existingClient.state === ClientStateType.TRANSFER_REQUEST) {
      // Restore the existing client to its previous state
      existingClient.state = existingClient.stateData.returnToState || ClientStateType.AUTHENTICATED;
      delete existingClient.stateData.interruptedBy;
      delete existingClient.stateData.transferClient;
      writeToClient(existingClient, colorize('\r\n\r\nTransfer request cancelled.\r\n', 'yellow'));
    }
    
    this.pendingTransfers.delete(lowerUsername);
  }

  public createUser(username: string, password: string): boolean {
    if (this.userExists(username)) {
      return false;
    }

    const now = new Date();
    const newUser: User = {
      username,
      password,
      health: 100,
      maxHealth: 100,
      experience: 0,
      level: 1,
      joinDate: now,
      lastLogin: now
    };

    this.users.push(newUser);
    this.saveUsers();
    return true;
  }

  public updateLastLogin(username: string): void {
    const user = this.getUser(username);
    if (user) {
      user.lastLogin = new Date();
      this.saveUsers();
    }
  }

  public updateUserStats(username: string, stats: Partial<User>): boolean {
    const user = this.getUser(username);
    if (!user) return false;
    
    Object.assign(user, stats);
    this.saveUsers();
    return true;
  }

  public deleteUser(username: string): boolean {
    const index = this.users.findIndex(user => user.username.toLowerCase() === username.toLowerCase());
    if (index === -1) return false;
    
    this.users.splice(index, 1);
    this.saveUsers();
    return true;
  }
}

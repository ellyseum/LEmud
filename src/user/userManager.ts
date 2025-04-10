import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { User, ConnectedClient, ClientStateType } from '../types';
import { writeToClient, stopBuffering, writeMessageToClient } from '../utils/socketWriter';
import { colorize } from '../utils/colors';
import { standardizeUsername } from '../utils/formatters';
import { CombatSystem } from '../combat/combatSystem';
import { RoomManager } from '../room/roomManager';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export class UserManager {
  private users: User[] = [];
  private activeUserSessions: Map<string, ConnectedClient> = new Map();
  private pendingTransfers: Map<string, ConnectedClient> = new Map();

  private static instance: UserManager | null = null;

  public static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
  }

  constructor() {
    this.loadUsers();
  }

  // Generate a random salt
  private generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  // Hash password with salt
  private hashPassword(password: string, salt: string): string {
    return crypto
      .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
      .toString('hex');
  }

  // Verify password against stored hash
  private verifyPassword(password: string, salt: string, storedHash: string): boolean {
    const hash = this.hashPassword(password, salt);
    return hash === storedHash;
  }

  // Migrate existing users to use hash+salt
  private migrateUsersToHashedPasswords(): void {
    let hasChanges = false;

    this.users.forEach(user => {
      if (user.password && !user.passwordHash) {
        const salt = this.generateSalt();
        const passwordHash = this.hashPassword(user.password, salt);

        // Update user object
        user.passwordHash = passwordHash;
        user.salt = salt;
        delete user.password;

        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.saveUsers();
    }
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

      // Ensure dates are properly parsed and inventory structures exist
      this.users.forEach(user => {
        if (typeof user.joinDate === 'string') {
          user.joinDate = new Date(user.joinDate);
        }
        if (typeof user.lastLogin === 'string') {
          user.lastLogin = new Date(user.lastLogin);
        }

        // Ensure inventory structure exists
        if (!user.inventory) {
          user.inventory = {
            items: [],
            currency: { gold: 0, silver: 0, copper: 0 }
          };
        }

        if (!user.inventory.items) {
          user.inventory.items = [];
        }

        if (!user.inventory.currency) {
          user.inventory.currency = { gold: 0, silver: 0, copper: 0 };
        }
      });

      // Migrate any users with plain text passwords
      this.migrateUsersToHashedPasswords();

      // Save after migration to ensure all users have the correct structure
      this.saveUsers();
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

  /**
   * Force saving users data
   * Public method for tick system to call
   */
  public forceSave(): void {
    this.saveUsers();
  }

  public getUser(username: string): User | undefined {
    const standardized = standardizeUsername(username);
    return this.users.find(user => user.username === standardized);
  }

  public userExists(username: string): boolean {
    const standardized = standardizeUsername(username);
    return this.users.some(user => user.username === standardized);
  }

  public authenticateUser(username: string, password: string): boolean {
    const user = this.getUser(username);

    if (!user) {
      return false;
    }

    // Handle legacy users with plain text passwords
    if (user.password) {
      if (user.password === password) {
        // Migrate this user to the new password system
        const salt = this.generateSalt();
        const passwordHash = this.hashPassword(password, salt);

        user.passwordHash = passwordHash;
        user.salt = salt;
        delete user.password;

        this.saveUsers();
        return true;
      }
      return false;
    }

    // Verify using hash and salt
    if (user.passwordHash && user.salt) {
      return this.verifyPassword(password, user.salt, user.passwordHash);
    }

    return false;
  }

  public isUserActive(username: string): boolean {
    const standardized = standardizeUsername(username);
    return this.activeUserSessions.has(standardized);
  }

  public getActiveUserSession(username: string): ConnectedClient | undefined {
    const standardized = standardizeUsername(username);
    return this.activeUserSessions.get(standardized);
  }

  public registerUserSession(username: string, client: ConnectedClient): void {
    const standardized = standardizeUsername(username);
    this.activeUserSessions.set(standardized, client);
    // Clear any pending transfers for this user
    this.pendingTransfers.delete(standardized);
  }

  public unregisterUserSession(username: string): void {
    const standardized = standardizeUsername(username);
    this.activeUserSessions.delete(standardized);
    // Also clean up any pending transfers
    this.pendingTransfers.delete(standardized);
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
    // For notifications, use the message writer that handles prompt management
    if (client.authenticated && client.state === ClientStateType.AUTHENTICATED) {
      writeMessageToClient(client, '');
    } else {
      writeToClient(client, '');
    }
    stopBuffering(client);
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

      // Mark both clients as being in a transfer
      existingClient.stateData.transferInProgress = true;
      newClient.stateData.isSessionTransfer = true;
      
      // CRITICAL FIX: Keep references to both clients temporarily
      // This helps prevent combat from seeing "no valid clients" during transfer
      
      if (existingClient.user) {
        // Capture if user is in combat BEFORE making any changes
        const inCombat = existingClient.user.inCombat || false;
        console.log(`[UserManager] User ${username} inCombat status: ${inCombat}`);
        
        // Clone the user from existing client
        const user = this.getUser(username);
        if (user) {
          // Setup the new client
          newClient.user = {...user}; // Clone to avoid reference issues
          newClient.authenticated = true;
          newClient.stateData.waitingForTransfer = false;
          
          // CRITICAL: Always register the new session FIRST
          this.registerUserSession(username, newClient);
          
          // Transfer combat state if needed
          if (inCombat) {
            // Explicitly preserve combat flag
            if (newClient.user) {
              newClient.user.inCombat = true;
              // Update user data store immediately
              this.updateUserStats(username, { inCombat: true });
            }
            
            // Notify combat system to transfer combat state
            try {
              const roomManager = RoomManager.getInstance(this.activeUserSessions);
              const combatSystem = CombatSystem.getInstance(this, roomManager);
              combatSystem.handleSessionTransfer(existingClient, newClient);
            } catch (error) {
              console.error('Error transferring combat state:', error);
            }
          }
          
          // Save user stats
          this.updateUserStats(username, { lastLogin: new Date() });
          
          // Inform new client they can proceed
          writeToClient(newClient, colorize('\r\n\r\nSession transfer approved. Logging in...\r\n', 'green'));
          
          // Transition new client to authenticated state
          newClient.stateData.transitionTo = ClientStateType.AUTHENTICATED;
        }
      }

      // Disconnect existing client after a longer delay
      // This ensures all combat processing has a chance to complete
      setTimeout(() => {
        console.log(`[UserManager] Disconnecting old client for ${username} after transfer`);
        // Only now mark the client as not authenticated
        existingClient.authenticated = false;
        existingClient.user = null;
        existingClient.connection.end();
      }, 7000); // Increased to 7 seconds
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
    // Standardize the username to lowercase
    const standardized = standardizeUsername(username);

    if (this.userExists(standardized)) {
      return false;
    }

    // Validate username before creating
    if (!/^[a-zA-Z]+$/.test(standardized) ||
      standardized.length >= 13 ||
      standardized.length < 3) {
      return false;
    }

    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(password, salt);

    const now = new Date();
    const newUser: User = {
      username: standardized,
      passwordHash,
      salt,
      health: 100,
      maxHealth: 100,
      experience: 0,
      level: 1,
      // Initialize character statistics
      strength: 10,
      dexterity: 10,
      agility: 10,
      constitution: 10, // New stat for physical endurance
      wisdom: 10,
      intelligence: 10,
      charisma: 10,
      joinDate: now,
      lastLogin: now,
      currentRoomId: 'start', // Set default starting room
      inventory: {
        items: [],
        currency: { gold: 0, silver: 0, copper: 0 }
      }
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

    // Handle isUnconscious property specially
    if (stats.hasOwnProperty('isUnconscious')) {
      user.isUnconscious = stats.isUnconscious;
    }

    Object.assign(user, stats);
    this.saveUsers();
    return true;
  }

  public updateUserInventory(username: string, inventory: User['inventory']): boolean {
    const user = this.getUser(username);
    if (!user) return false;

    user.inventory = inventory;
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

  /**
   * Get all users
   * Used by admin API to get a list of all players
   */
  public getAllUsers(): User[] {
    return [...this.users];
  }

  // Add method to change password
  public changeUserPassword(username: string, newPassword: string): boolean {
    const user = this.getUser(username);

    if (!user) {
      return false;
    }

    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(newPassword, salt);

    user.passwordHash = passwordHash;
    user.salt = salt;

    // Remove plain text password if it exists
    if (user.password) {
      delete user.password;
    }

    this.saveUsers();
    return true;
  }
}

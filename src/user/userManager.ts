import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { User, ConnectedClient, ClientStateType } from '../types';
import { writeToClient, stopBuffering, writeMessageToClient } from '../utils/socketWriter';
import { colorize } from '../utils/colors';
import { standardizeUsername } from '../utils/formatters';
import { CombatSystem } from '../combat/combatSystem';
import { RoomManager } from '../room/roomManager';
import { systemLogger, getPlayerLogger } from '../utils/logger';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SNAKE_SCORES_FILE = path.join(DATA_DIR, 'snake-scores.json');

// Interface for snake score entries
interface SnakeScore {
  username: string;
  score: number;
  date: Date;
}

export class UserManager {
  private users: User[] = [];
  private activeUserSessions: Map<string, ConnectedClient> = new Map();
  private pendingTransfers: Map<string, ConnectedClient> = new Map();
  private snakeScores: SnakeScore[] = [];

  private static instance: UserManager | null = null;

  public static getInstance(): UserManager {
    if (!UserManager.instance) {
      UserManager.instance = new UserManager();
    }
    return UserManager.instance;
  }

  private constructor() {
    this.loadUsers();
    this.loadSnakeScores();
    this.migrateSnakeScores();
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

      // Ensure snakeHighScore is initialized if missing
      this.users.forEach(user => {
        if (user.snakeHighScore === undefined) {
          user.snakeHighScore = 0;
        }
      });

      // Migrate any users with plain text passwords
      this.migrateUsersToHashedPasswords();

      // Save after migration to ensure all users have the correct structure
      this.saveUsers();
    } catch (error) {
      systemLogger.error('Error loading users:', error);
      this.users = [];
    }
  }

  private saveUsers(): void {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.users, null, 2));
    } catch (error) {
      systemLogger.error('Error saving users:', error);
    }
  }

  /**
   * Force saving users data
   * Public method for tick system to call
   */
  public forceSave(): void {
    this.saveUsers();
  }

  // Load snake scores from the dedicated file
  private loadSnakeScores(): void {
    try {
      // Create snake scores file if it doesn't exist
      if (!fs.existsSync(SNAKE_SCORES_FILE)) {
        fs.writeFileSync(SNAKE_SCORES_FILE, JSON.stringify({ scores: [] }, null, 2));
        return;
      }

      const data = fs.readFileSync(SNAKE_SCORES_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      // Ensure scores is an array
      if (!Array.isArray(parsed.scores)) {
        this.snakeScores = [];
        return;
      }
      
      // Convert date strings back to Date objects
      this.snakeScores = parsed.scores.map((score: any) => ({
        username: score.username,
        score: score.score,
        date: new Date(score.date)
      }));
      
      systemLogger.info(`[UserManager] Loaded ${this.snakeScores.length} snake scores from file`);
    } catch (error) {
      systemLogger.error('Error loading snake scores:', error);
      this.snakeScores = [];
    }
  }

  // Save snake scores to the dedicated file
  private saveSnakeScores(): void {
    try {
      const data = {
        scores: this.snakeScores
      };
      fs.writeFileSync(SNAKE_SCORES_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      systemLogger.error('Error saving snake scores:', error);
    }
  }

  // Migrate any existing snake scores from users.json to snake-scores.json
  private migrateSnakeScores(): void {
    let migrationCount = 0;
    
    // Check each user for a snakeHighScore
    this.users.forEach(user => {
      if (user.snakeHighScore && user.snakeHighScore > 0) {
        const username = user.username;
        const score = user.snakeHighScore;
        
        // Check if we already have this score in the new system
        const existingScoreIndex = this.snakeScores.findIndex(s => s.username === username);
        
        if (existingScoreIndex === -1) {
          // Add as a new score
          this.snakeScores.push({
            username,
            score,
            date: new Date() // We don't know the original date, so use current
          });
          migrationCount++;
        } else if (score > this.snakeScores[existingScoreIndex].score) {
          // Update existing score if higher
          this.snakeScores[existingScoreIndex].score = score;
          migrationCount++;
        }
        
        // Clear the score from the user object
        delete user.snakeHighScore;
      }
    });
    
    if (migrationCount > 0) {
      systemLogger.info(`[UserManager] Migrated ${migrationCount} snake scores from users.json to snake-scores.json`);
      // Save both files
      this.saveUsers();
      this.saveSnakeScores();
    }
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

    systemLogger.info(`User ${username} logged in`);
    const playerLogger = getPlayerLogger(username);
    playerLogger.info(`Logged in successfully`);
  }

  public unregisterUserSession(username: string): void {
    const standardized = standardizeUsername(username);
    this.activeUserSessions.delete(standardized);
    // Also clean up any pending transfers
    this.pendingTransfers.delete(standardized);

    systemLogger.info(`User ${username} disconnected`);
    getPlayerLogger(username).info(`Disconnected from server`);
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
        systemLogger.info(`[UserManager] User ${username} inCombat status: ${inCombat}`);
        
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
              systemLogger.error('Error transferring combat state:', error);
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
        systemLogger.info(`[UserManager] Disconnecting old client for ${username} after transfer`);
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
      constitution: 10, 
      wisdom: 10,
      intelligence: 10,
      charisma: 10,
      // Initialize combat stats (will be recalculated based on equipment)
      attack: 5, // Base attack (strength/2)
      defense: 5, // Base defense (constitution/2)
      // Initialize empty equipment
      equipment: {},
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

    // Handle flags array properly
    if (stats.flags !== undefined) {
      // Ensure flags is an array
      if (!Array.isArray(stats.flags)) {
        systemLogger.warn(`[UserManager] Attempted to update flags with non-array value for ${username}. Ignoring.`);
        delete stats.flags; // Remove invalid flags from stats to avoid overwriting
      } else {
        // If the user doesn't have a flags array yet, initialize it
        if (!user.flags) {
          user.flags = [];
        }
        // Use the provided flags array
        user.flags = [...stats.flags];
        delete stats.flags; // Remove flags from stats to avoid double processing
      }
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

  // Save a player's high score for the Snake game
  public saveHighScore(scoreData: { username: string, score: number }): void {
    if (!scoreData.username || scoreData.score <= 0) return;

    // Get the username in standardized form
    const username = standardizeUsername(scoreData.username);
    
    // Check if the user exists
    if (!this.userExists(username)) return;
    
    // Find existing score for this user
    const existingScoreIndex = this.snakeScores.findIndex(s => s.username === username);
    
    if (existingScoreIndex >= 0) {
      // Only update if new score is higher
      if (scoreData.score > this.snakeScores[existingScoreIndex].score) {
        this.snakeScores[existingScoreIndex] = {
          username,
          score: scoreData.score,
          date: new Date()
        };
        
        // Save to file
        this.saveSnakeScores();
        systemLogger.info(`[UserManager] Updated snake high score for ${username}: ${scoreData.score}`);
      }
    } else {
      // New high score for this user
      this.snakeScores.push({
        username,
        score: scoreData.score,
        date: new Date()
      });
      
      // Save to file
      this.saveSnakeScores();
      systemLogger.info(`[UserManager] Added new snake high score for ${username}: ${scoreData.score}`);
    }
  }

  // Get all snake game high scores, sorted from highest to lowest
  public getSnakeHighScores(limit: number = 10): { username: string, score: number }[] {
    return this.snakeScores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(score => ({
        username: score.username,
        score: score.score
      }));
  }

  /**
   * Adds a flag to a user. Ensures no duplicates.
   * @param username The user to add the flag to
   * @param flag The flag string to add
   * @returns True if the flag was added, false otherwise (user not found or flag already exists)
   */
  public addFlag(username: string, flag: string): boolean {
    const user = this.getUser(username);
    if (!user) {
      systemLogger.error(`[UserManager] Cannot add flag: User ${username} not found.`);
      return false;
    }

    // Ensure flags array exists
    if (!user.flags) {
      user.flags = [];
    }

    // Check if flag already exists
    if (!user.flags.includes(flag)) {
      user.flags.push(flag);
      this.saveUsers();
      systemLogger.info(`[UserManager] Added flag '${flag}' to user ${username}.`);
      return true;
    } else {
      systemLogger.info(`[UserManager] Flag '${flag}' already exists for user ${username}.`);
      return false; // Indicate flag wasn't newly added
    }
  }

  /**
   * Removes a flag from a user.
   * @param username The user to remove the flag from
   * @param flag The flag string to remove
   * @returns True if the flag was removed, false otherwise (user not found or flag didn't exist)
   */
  public removeFlag(username: string, flag: string): boolean {
    const user = this.getUser(username);
    if (!user || !user.flags) {
      systemLogger.error(`[UserManager] Cannot remove flag: User ${username} not found or has no flags.`);
      return false;
    }

    const initialLength = user.flags.length;
    user.flags = user.flags.filter(f => f !== flag);

    if (user.flags.length < initialLength) {
      this.saveUsers();
      systemLogger.info(`[UserManager] Removed flag '${flag}' from user ${username}.`);
      return true;
    } else {
      systemLogger.info(`[UserManager] Flag '${flag}' not found for user ${username}.`);
      return false; // Indicate flag wasn't found/removed
    }
  }

  /**
   * Checks if a user has a specific flag.
   * @param username The user to check
   * @param flag The flag string to check for
   * @returns True if the user has the flag, false otherwise
   */
  public hasFlag(username: string, flag: string): boolean {
    const user = this.getUser(username);
    return !!user?.flags?.includes(flag);
  }

  /**
   * Gets all flags for a user.
   * @param username The user to get flags for
   * @returns An array of flag strings, or empty array if user has no flags, or null if user not found
   */
  public getFlags(username: string): string[] | null {
    const user = this.getUser(username);
    if (!user) return null;
    return [...(user.flags || [])]; // Return a copy or empty array
  }
}
